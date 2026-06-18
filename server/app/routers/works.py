"""/api/me/works —— 用户全部 AI 出图（cursor 分页）

设计要点见 docs/specs/2026-05-22-menu-refactor-design.md § 2.1
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user
from ..models import User
from ..schemas import WorksPage
from ..works_service import fetch_recent_work_items

router = APIRouter(prefix="/api/me", tags=["works"])

PAGE_LIMIT = 24
PAGE_LIMIT_MAX = 60


@router.get("/works", response_model=WorksPage)
async def list_works(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    cursor: int | None = Query(
        None,
        ge=1,
        description="上一页最后一条作品 id；资产表迁移前兼容 message_id",
    ),
    limit: int = Query(PAGE_LIMIT, ge=1, le=PAGE_LIMIT_MAX),
) -> WorksPage:
    items, next_cursor = await fetch_recent_work_items(
        db,
        user.id,
        cursor=cursor,
        limit=limit,
    )
    return WorksPage(items=items, next_cursor=next_cursor)
