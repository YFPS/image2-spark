"""作品查询共享逻辑

供 `routers/recent_works.py`（固定取 12 条）和 `routers/works.py`（cursor 分页）共用。

设计要点见 docs/specs/2026-05-22-menu-refactor-design.md § 2.1
"""
from __future__ import annotations

from urllib.parse import urlparse

from sqlalchemy import Select, and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .generated_assets_service import list_user_assets
from .models import Conversation, Message
from .schemas import RecentWorkItem


def is_displayable_image_url(url: str) -> bool:
    """判断图片 URL 是否还应该交给前端展示。"""
    if not isinstance(url, str) or not url:
        return False
    parsed = urlparse(url)
    if not parsed.netloc:
        return True
    netloc = parsed.netloc.lower()
    hostname = (parsed.hostname or "").lower()
    dead_hosts = get_settings().broken_image_hosts
    return netloc not in dead_hosts and hostname not in dead_hosts


def filter_displayable_image_urls(urls: list[str] | None) -> list[str]:
    """过滤已知失效的历史图源，不修改数据库原始记录。"""
    return [url for url in (urls or []) if is_displayable_image_url(url)]


CONVERSATION_SCAN_BATCH = 50
MESSAGE_SCAN_LIMIT_MIN = 96


def build_works_query(user_id: int, *, cursor: int | None = None, limit: int = 12) -> Select:
    """构造 "用户跨会话最近 AI 出图" 的 SQLAlchemy select

    过滤条件：
      - conversation.user_id == user_id
      - conversation.deleted_at IS NULL（软删的会话隐藏）
      - message.role == 'ai'
      - message.status == 'done'
      - message.image_urls IS NOT NULL（DB 层）

    cursor 语义：返回 message.id < cursor 的下一批；None 表示从最新开始。
    排序：id DESC（与 created_at DESC 等价，因为 id 单调递增 + 应用层串行写入；
    这是 spec § 2.1 的明确约定）。
    """
    where = [
        Conversation.user_id == user_id,
        Conversation.deleted_at.is_(None),
        Message.role == "ai",
        Message.status == "done",
        Message.image_urls.is_not(None),
    ]
    if cursor is not None:
        where.append(Message.id < cursor)

    return (
        select(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(and_(*where))
        .order_by(Message.id.desc())
        .limit(limit)
    )


def message_to_recent_work_item(m: Message) -> RecentWorkItem | None:
    """Message ORM 对象 → RecentWorkItem schema。

    若 image_urls 为空列表（DB 层 IS NOT NULL 兜不住 "[]" 这种 JSON 空列表），
    返回 None 让调用方跳过——双保险。
    """
    urls = filter_displayable_image_urls(m.image_urls)
    if not urls:
        return None
    size: str | None = None
    if m.params and isinstance(m.params, dict):
        raw_size = m.params.get("size")
        if isinstance(raw_size, str):
            size = raw_size
    return RecentWorkItem(
        message_id=m.id,
        conversation_id=m.conversation_id,
        image_url=urls[0],
        image_count=len(urls),
        all_image_urls=urls,
        size=size,
        created_at=m.created_at,
    )


async def fetch_recent_work_items(
    db: AsyncSession,
    user_id: int,
    *,
    cursor: int | None = None,
    limit: int = 12,
) -> tuple[list[RecentWorkItem], int | None]:
    """按用户查询可展示作品，避免 MySQL 对跨表结果做全局 filesort。

    长期路径优先读取 generated_assets；迁移期只有当第一页完全没有资产记录时，
    才回退到旧 Message 扫描。cursor 模式下不回退，避免把 asset_id 当 message_id 使用。

    线上 RDS 在 `messages JOIN conversations ORDER BY messages.id DESC LIMIT N`
    上会触发 1038 sort buffer 错误。这里先用 conversations 的用户索引分批取
    会话，再按单个 conversation_id 走 `idx_msg_conv_id` 倒序扫描消息，最后在
    Python 合并少量候选项。
    """
    asset_items, asset_next_cursor = await list_user_assets(
        db,
        user_id,
        cursor=cursor,
        limit=limit,
    )
    if asset_items or cursor is not None:
        return asset_items, asset_next_cursor

    target = limit + 1
    candidates: list[RecentWorkItem] = []
    conv_cursor: tuple[object, int] | None = None
    message_scan_limit = max(MESSAGE_SCAN_LIMIT_MIN, target * 8)

    while len(candidates) < target:
        conv_where = [
            Conversation.user_id == user_id,
            Conversation.deleted_at.is_(None),
        ]
        if conv_cursor is not None:
            last_updated, last_id = conv_cursor
            conv_where.append(
                or_(
                    Conversation.updated_at < last_updated,
                    and_(
                        Conversation.updated_at == last_updated,
                        Conversation.id < last_id,
                    ),
                )
            )

        conv_rows = (
            await db.execute(
                select(Conversation.id, Conversation.updated_at)
                .where(and_(*conv_where))
                .order_by(Conversation.updated_at.desc(), Conversation.id.desc())
                .limit(CONVERSATION_SCAN_BATCH)
            )
        ).all()
        if not conv_rows:
            break

        for conv_id, _updated_at in conv_rows:
            msg_where = [
                Message.conversation_id == conv_id,
                Message.role == "ai",
                Message.status == "done",
                Message.image_urls.is_not(None),
            ]
            if cursor is not None:
                msg_where.append(Message.id < cursor)

            messages = (
                await db.execute(
                    select(Message)
                    .where(and_(*msg_where))
                    .order_by(Message.id.desc())
                    .limit(message_scan_limit)
                )
            ).scalars().all()

            for message in messages:
                item = message_to_recent_work_item(message)
                if item is not None:
                    candidates.append(item)

        candidates.sort(key=lambda item: item.message_id, reverse=True)
        candidates = candidates[:target]
        conv_cursor = (conv_rows[-1].updated_at, conv_rows[-1].id)

    page_items = candidates[:limit]
    next_cursor = page_items[-1].message_id if len(candidates) > limit and page_items else None
    return page_items, next_cursor
