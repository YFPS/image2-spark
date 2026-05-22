"""/api/me/recent-works —— 用户跨会话最近 AI 出图（固定取 RECENT_LIMIT 条）

查询逻辑共享自 works_service；本路由是 works 的"快查"特化形态。
设计要点见 docs/specs/2026-05-22-recent-works-card-design.md
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user
from ..models import User
from ..schemas import RecentWorkItem, RecentWorksOut
from ..works_service import build_works_query, message_to_recent_work_item

router = APIRouter(prefix="/api/me", tags=["recent_works"])

# 与前端 UI 容量一致；改此常量时前端不用同步改
RECENT_LIMIT = 12


@router.get("/recent-works", response_model=RecentWorksOut)
async def list_recent_works(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RecentWorksOut:
    stmt = build_works_query(user.id, limit=RECENT_LIMIT)
    rows = (await db.execute(stmt)).scalars().all()
    items: list[RecentWorkItem] = []
    for m in rows:
        item = message_to_recent_work_item(m)
        if item is not None:
            items.append(item)
    return RecentWorksOut(items=items)
