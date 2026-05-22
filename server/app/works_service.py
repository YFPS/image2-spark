"""作品查询共享逻辑

供 `routers/recent_works.py`（固定取 12 条）和 `routers/works.py`（cursor 分页）共用。

设计要点见 docs/specs/2026-05-22-menu-refactor-design.md § 2.1
"""
from __future__ import annotations

from sqlalchemy import Select, and_, select

from .models import Conversation, Message
from .schemas import RecentWorkItem


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
    urls = m.image_urls or []
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
