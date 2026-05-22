"""/api/me/logs —— 用户积分流水时间线（cursor 分页）

reason ∈ {generate, edit} 的行会额外 join messages 拿缩略图 + prompt 摘要。
设计要点见 docs/specs/2026-05-22-menu-refactor-design.md § 2.2
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user
from ..models import CreditTransaction, Message, User
from ..schemas import LogItem, LogRef, LogsPage

router = APIRouter(prefix="/api/me", tags=["logs"])

PAGE_LIMIT = 50
PAGE_LIMIT_MAX = 200
PROMPT_PREVIEW_LEN = 80


@router.get("/logs", response_model=LogsPage)
async def list_logs(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    cursor: int | None = Query(None, ge=1),
    limit: int = Query(PAGE_LIMIT, ge=1, le=PAGE_LIMIT_MAX),
) -> LogsPage:
    where = [CreditTransaction.user_id == user.id]
    if cursor is not None:
        where.append(CreditTransaction.id < cursor)

    stmt = (
        select(CreditTransaction)
        .where(and_(*where))
        .order_by(CreditTransaction.id.desc())
        .limit(limit + 1)
    )
    rows = (await db.execute(stmt)).scalars().all()
    has_more = len(rows) > limit
    rows = rows[:limit]

    # 批量加载 ref_type='message' 的 messages（避免 N+1）
    msg_ids: list[int] = []
    for r in rows:
        if r.ref_type == "message" and r.ref_id is not None:
            try:
                msg_ids.append(int(r.ref_id))
            except ValueError:
                continue
    msgs_by_id: dict[int, Message] = {}
    if msg_ids:
        m_stmt = select(Message).where(Message.id.in_(msg_ids))
        for m in (await db.execute(m_stmt)).scalars().all():
            msgs_by_id[m.id] = m

    items: list[LogItem] = []
    for tx in rows:
        ref: LogRef | None = None
        if tx.ref_type == "message" and tx.ref_id is not None:
            try:
                mid = int(tx.ref_id)
            except ValueError:
                mid = None
            if mid is not None and mid in msgs_by_id:
                m = msgs_by_id[mid]
                urls = m.image_urls or []
                prompt = (m.text or "").strip()[:PROMPT_PREVIEW_LEN] or None
                ref = LogRef(
                    kind="message",
                    message_id=m.id,
                    conversation_id=m.conversation_id,
                    thumbnail_url=urls[0] if urls else None,
                    prompt_preview=prompt,
                )
        items.append(
            LogItem(
                id=tx.id,
                type=tx.reason,
                delta=tx.delta,
                balance_after=tx.balance_after,
                note=tx.note,
                created_at=tx.created_at,
                ref=ref,
            )
        )

    next_cursor = items[-1].id if has_more and items else None
    return LogsPage(items=items, next_cursor=next_cursor)
