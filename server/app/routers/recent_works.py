"""/api/me/recent-works —— 用户跨会话最近 AI 出图

设计要点见 docs/specs/2026-05-22-recent-works-card-design.md
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user
from ..models import Conversation, Message, User
from ..schemas import RecentWorkItem, RecentWorksOut

router = APIRouter(prefix="/api/me", tags=["recent_works"])

# 与前端 UI 容量一致；改此常量时前端不用同步改
RECENT_LIMIT = 12


@router.get("/recent-works", response_model=RecentWorksOut)
async def list_recent_works(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RecentWorksOut:
    """用户跨所有会话的最近 AI 出图，按 messages.created_at DESC 取前 RECENT_LIMIT 条。

    过滤条件：
      - conversation.user_id == 当前用户
      - conversation.deleted_at IS NULL（软删的会话整体隐藏）
      - message.role == 'ai'
      - message.status == 'done'
      - message.image_urls IS NOT NULL（DB 层）+ 非空列表（应用层兜底）
    """
    stmt = (
        select(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(
            and_(
                Conversation.user_id == user.id,
                Conversation.deleted_at.is_(None),
                Message.role == "ai",
                Message.status == "done",
                Message.image_urls.is_not(None),
            )
        )
        .order_by(Message.created_at.desc())
        .limit(RECENT_LIMIT)
    )
    rows = (await db.execute(stmt)).scalars().all()

    items: list[RecentWorkItem] = []
    for m in rows:
        urls = m.image_urls or []
        if not urls:
            # 双保险：MySQL JSON 长度过滤写法繁琐，应用层兜一下
            continue
        size = None
        if m.params and isinstance(m.params, dict):
            raw_size = m.params.get("size")
            if isinstance(raw_size, str):
                size = raw_size
        items.append(
            RecentWorkItem(
                message_id=m.id,
                conversation_id=m.conversation_id,
                image_url=urls[0],
                image_count=len(urls),
                all_image_urls=urls,
                size=size,
                created_at=m.created_at,
            )
        )
    return RecentWorksOut(items=items)
