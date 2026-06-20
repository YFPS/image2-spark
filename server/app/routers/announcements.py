"""前台公告读取接口。"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models import Announcement
from ..schemas import AnnouncementItem, AnnouncementListOut

router = APIRouter(prefix="/api/announcements", tags=["announcements"])


def _announcement_now() -> datetime:
    return datetime.now()


def _to_announcement_item(row: Announcement) -> AnnouncementItem:
    return AnnouncementItem(
        id=row.id,
        title=row.title,
        content=row.content,
        link_url=row.link_url,
        link_label=row.link_label,
        pinned=row.pinned,
        priority=row.priority,
        starts_at=row.starts_at,
        ends_at=row.ends_at,
        updated_at=row.updated_at,
    )


@router.get("", response_model=AnnouncementListOut)
async def list_active_announcements(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(5, ge=1, le=10),
) -> AnnouncementListOut:
    now = _announcement_now()
    rows = (await db.execute(
        select(Announcement)
        .where(
            and_(
                Announcement.enabled.is_(True),
                or_(Announcement.starts_at.is_(None), Announcement.starts_at <= now),
                or_(Announcement.ends_at.is_(None), Announcement.ends_at >= now),
            )
        )
        .order_by(Announcement.pinned.desc(), Announcement.priority.desc(), Announcement.id.desc())
        .limit(limit)
    )).scalars().all()

    return AnnouncementListOut(items=[_to_announcement_item(row) for row in rows])
