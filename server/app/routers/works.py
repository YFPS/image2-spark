"""/api/me/works —— 用户全部 AI 出图（cursor 分页）

设计要点见 docs/specs/2026-05-22-menu-refactor-design.md § 2.1
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user
from ..models import User
from ..schemas import RecentWorkItem, WorksPage
from ..works_service import build_works_query, message_to_recent_work_item

router = APIRouter(prefix="/api/me", tags=["works"])

PAGE_LIMIT = 24
PAGE_LIMIT_MAX = 60


@router.get("/works", response_model=WorksPage)
async def list_works(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    cursor: int | None = Query(None, ge=1, description="上一页最后一条 message_id；不传则取最新"),
    limit: int = Query(PAGE_LIMIT, ge=1, le=PAGE_LIMIT_MAX),
) -> WorksPage:
    # 多取一条用来判定 has_more
    stmt = build_works_query(user.id, cursor=cursor, limit=limit + 1)
    rows = (await db.execute(stmt)).scalars().all()
    has_more = len(rows) > limit
    rows = rows[:limit]

    items: list[RecentWorkItem] = []
    for m in rows:
        item = message_to_recent_work_item(m)
        if item is not None:
            items.append(item)

    next_cursor = items[-1].message_id if has_more and items else None
    return WorksPage(items=items, next_cursor=next_cursor)
