"""/api/me/recent-works —— 用户跨会话最近 AI 出图

设计要点见 docs/specs/2026-05-22-recent-works-card-design.md
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user
from ..models import User
from ..schemas import RecentWorksOut

router = APIRouter(prefix="/api/me", tags=["recent_works"])

RECENT_LIMIT = 12


@router.get("/recent-works", response_model=RecentWorksOut)
async def list_recent_works(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RecentWorksOut:
    """占位：真实实现见 Task 4。当前返回空列表，仅保证路由可被打到 + 401 鉴权链路连通"""
    return RecentWorksOut(items=[])
