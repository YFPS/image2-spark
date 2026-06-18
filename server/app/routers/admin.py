"""/api/admin/* 管理后台路由"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import and_, delete, func, not_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..admin_schemas import (
    AdminAuditLogItem,
    AdminAuditLogListOut,
    AdminAccessLogItem,
    AdminAccessLogListOut,
    AdminCreditAdjust,
    AdminLogItem,
    AdminLogListOut,
    AdminUserItem,
    AdminUserListOut,
    AdminUserUpdate,
    DAUItem,
    DashboardStats,
    TrafficStats,
    UpstreamChannelCreate,
    UpstreamChannelItem,
    UpstreamChannelUpdate,
    UpstreamHealthItem,
)
from ..audit_service import apply_credit_delta, set_user_credits
from ..config import get_settings
from ..crypto import decrypt_api_key, encrypt_api_key, is_encryption_configured
from ..db import get_db
from ..deps import require_admin
from ..models import (
    AccessLog,
    AdminLog,
    AuditLog,
    Conversation,
    CreditTransaction,
    Message,
    UpstreamChannel,
    User,
)
from ..schemas import MessageOut

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])

_INTERNAL_ACCESS_PATHS = {"/api/health", "/docs", "/openapi.json", "/redoc"}
_INTERNAL_ACCESS_PREFIXES = ("/api/admin", "/static")


def _matches_path_prefix(path: str, prefix: str) -> bool:
    return path == prefix or path.startswith(f"{prefix}/")


def is_internal_access_path(path: str) -> bool:
    return path in _INTERNAL_ACCESS_PATHS or any(
        _matches_path_prefix(path, prefix) for prefix in _INTERNAL_ACCESS_PREFIXES
    )


def _external_access_log_filter():
    clauses = [AccessLog.path.notin_(tuple(_INTERNAL_ACCESS_PATHS))]
    for prefix in _INTERNAL_ACCESS_PREFIXES:
        clauses.append(AccessLog.path != prefix)
        clauses.append(not_(AccessLog.path.like(f"{prefix}/%")))
    return and_(*clauses)


def _mask_key(key: str) -> str:
    """对 api_key 脱敏显示；如果是加密格式先解密再 mask"""
    if is_encryption_configured():
        key = decrypt_api_key(key)
    if len(key) <= 8:
        return "****"
    return key[:4] + "****" + key[-4:]


def _client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


async def _write_admin_log(
    db: AsyncSession,
    admin_id: int,
    action: str,
    ip: str | None = None,
    target_type: str | None = None,
    target_id: int | None = None,
    detail: dict[str, Any] | None = None,
) -> None:
    db.add(AdminLog(
        admin_id=admin_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        detail=detail,
        ip=ip,
    ))
    await db.flush()


# ===== 仪表盘 =====


@router.get("/dashboard", response_model=DashboardStats)
async def dashboard(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> DashboardStats:
    now = datetime.now(tz=timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    total_users = (await db.execute(select(func.count(User.id)))).scalar() or 0
    today_reg = (await db.execute(
        select(func.count(User.id)).where(User.created_at >= today_start)
    )).scalar() or 0

    traffic_filter = _external_access_log_filter()
    today_active = (await db.execute(
        select(func.count(func.distinct(AccessLog.user_id)))
        .where(and_(traffic_filter, AccessLog.created_at >= today_start, AccessLog.user_id.isnot(None)))
    )).scalar() or 0

    total_images = (await db.execute(
        select(func.count(Message.id)).where(Message.role == "ai").where(Message.status == "done")
    )).scalar() or 0
    today_images = (await db.execute(
        select(func.count(Message.id))
        .where(Message.role == "ai")
        .where(Message.status == "done")
        .where(Message.created_at >= today_start)
    )).scalar() or 0

    total_credits = (await db.execute(
        select(func.sum(func.abs(CreditTransaction.delta)))
        .where(CreditTransaction.reason.in_(["generate", "edit"]))
    )).scalar() or 0
    today_credits = (await db.execute(
        select(func.sum(func.abs(CreditTransaction.delta)))
        .where(CreditTransaction.reason.in_(["generate", "edit"]))
        .where(CreditTransaction.created_at >= today_start)
    )).scalar() or 0

    return DashboardStats(
        total_users=total_users,
        today_registrations=today_reg,
        today_active_users=today_active,
        total_images_generated=total_images,
        today_images_generated=today_images,
        total_credits_consumed=total_credits,
        today_credits_consumed=today_credits,
    )


# ===== 用户管理 =====


@router.get("/users", response_model=AdminUserListOut)
async def list_users(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None, description="搜索邮箱或昵称"),
    role: str | None = Query(None),
    disabled: bool | None = Query(None),
) -> AdminUserListOut:
    where = []
    if search:
        like = f"%{search}%"
        where.append((User.email.like(like)) | (User.nickname.like(like)))
    if role:
        where.append(User.role == role)
    if disabled is not None:
        where.append(User.disabled == disabled)

    stmt = select(User).where(and_(*where)) if where else select(User)
    total = (await db.execute(
        select(func.count()).select_from(stmt.subquery())
    )).scalar() or 0

    rows = (await db.execute(
        stmt.order_by(User.id.desc()).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    items = [
        AdminUserItem(
            id=u.id, email=u.email, nickname=u.nickname, role=u.role,
            credits=u.credits, disabled=u.disabled,
            email_verified_at=u.email_verified_at,
            last_login_at=u.last_login_at,
            created_at=u.created_at, updated_at=u.updated_at,
        )
        for u in rows
    ]
    return AdminUserListOut(items=items, total=total, page=page, page_size=page_size)


@router.get("/users/{user_id}", response_model=AdminUserItem)
async def get_user(
    user_id: int,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminUserItem:
    u = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if u is None:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    return AdminUserItem(
        id=u.id, email=u.email, nickname=u.nickname, role=u.role,
        credits=u.credits, disabled=u.disabled,
        email_verified_at=u.email_verified_at,
        last_login_at=u.last_login_at,
        created_at=u.created_at, updated_at=u.updated_at,
    )


@router.put("/users/{user_id}", response_model=AdminUserItem)
async def update_user(
    user_id: int,
    body: AdminUserUpdate,
    request: Request,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminUserItem:
    u = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if u is None:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})

    changes: dict[str, Any] = {}
    if body.nickname is not None:
        u.nickname = body.nickname
        changes["nickname"] = body.nickname
    if body.role is not None:
        u.role = body.role
        changes["role"] = body.role
    if body.disabled is not None:
        u.disabled = body.disabled
        changes["disabled"] = body.disabled
    if body.credits is not None:
        u, _tx = await set_user_credits(
            db,
            user_id=user_id,
            target_credits=body.credits,
            reason="adjust",
            note=f"管理员设定积分为 {body.credits}",
            request=request,
            actor_user_id=admin.id,
        )
        changes["credits"] = body.credits

    if changes:
        await _write_admin_log(
            db, admin.id, "update_user", _client_ip(request),
            "user", user_id, changes,
        )
        await db.commit()
        await db.refresh(u)

    return AdminUserItem(
        id=u.id, email=u.email, nickname=u.nickname, role=u.role,
        credits=u.credits, disabled=u.disabled,
        email_verified_at=u.email_verified_at,
        last_login_at=u.last_login_at,
        created_at=u.created_at, updated_at=u.updated_at,
    )


@router.post("/users/{user_id}/adjust-credits")
async def adjust_credits(
    user_id: int,
    body: AdminCreditAdjust,
    request: Request,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    u = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if u is None:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})

    u, tx = await apply_credit_delta(
        db,
        user_id=user_id,
        delta=body.delta,
        reason="admin_grant",
        note=body.note or f"管理员调整 {body.delta:+d}",
        request=request,
        actor_user_id=admin.id,
        clamp_zero=True,
    )
    await _write_admin_log(
        db, admin.id, "adjust_credits", _client_ip(request),
        "user", user_id, {
            "requested_delta": body.delta,
            "actual_delta": tx.delta,
            "note": body.note,
            "credit_transaction_id": tx.id,
        },
    )
    await db.commit()
    return {"ok": True, "credits": u.credits}


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    request: Request,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail={"error": {"code": "cannot_delete_self"}})
    u = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if u is None:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})

    await _write_admin_log(
        db, admin.id, "delete_user", _client_ip(request),
        "user", user_id, {"email": u.email},
    )
    await db.delete(u)
    await db.commit()
    return {"ok": True}


# ===== 用户积分流水 =====


@router.get("/users/{user_id}/transactions")
async def user_transactions(
    user_id: int,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    total = (await db.execute(
        select(func.count()).where(CreditTransaction.user_id == user_id)
    )).scalar() or 0
    rows = (await db.execute(
        select(CreditTransaction)
        .where(CreditTransaction.user_id == user_id)
        .order_by(CreditTransaction.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).scalars().all()
    items = [
        {
            "id": t.id, "delta": t.delta, "balance_after": t.balance_after,
            "reason": t.reason, "ref_type": t.ref_type, "ref_id": t.ref_id,
            "note": t.note, "created_at": t.created_at,
        }
        for t in rows
    ]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


# ===== 访问日志 =====


@router.get("/logs/access", response_model=AdminAccessLogListOut)
async def list_access_logs(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    user_id: int | None = Query(None),
    path: str | None = Query(None),
    status_code: int | None = Query(None),
) -> AdminAccessLogListOut:
    where = []
    if user_id:
        where.append(AccessLog.user_id == user_id)
    if path:
        where.append(AccessLog.path.like(f"%{path}%"))
    if status_code:
        where.append(AccessLog.status_code == status_code)

    stmt = select(AccessLog).where(and_(*where)) if where else select(AccessLog)
    total = (await db.execute(
        select(func.count()).select_from(stmt.subquery())
    )).scalar() or 0
    rows = (await db.execute(
        stmt.order_by(AccessLog.id.desc()).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    items = [
        AdminAccessLogItem(
            id=r.id, method=r.method, path=r.path, status_code=r.status_code,
            ip=r.ip, user_id=r.user_id, duration_ms=r.duration_ms,
            created_at=r.created_at,
        )
        for r in rows
    ]
    return AdminAccessLogListOut(items=items, total=total, page=page, page_size=page_size)


# ===== 管理员操作日志 =====


@router.get("/logs/operations", response_model=AdminLogListOut)
async def list_admin_logs(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    admin_id: int | None = Query(None),
    action: str | None = Query(None),
) -> AdminLogListOut:
    where = []
    if admin_id:
        where.append(AdminLog.admin_id == admin_id)
    if action:
        where.append(AdminLog.action == action)

    stmt = select(AdminLog).where(and_(*where)) if where else select(AdminLog)
    total = (await db.execute(
        select(func.count()).select_from(stmt.subquery())
    )).scalar() or 0
    rows = (await db.execute(
        stmt.order_by(AdminLog.id.desc()).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    items = [
        AdminLogItem(
            id=r.id, admin_id=r.admin_id, action=r.action,
            target_type=r.target_type, target_id=r.target_id,
            detail=r.detail, ip=r.ip, created_at=r.created_at,
        )
        for r in rows
    ]
    return AdminLogListOut(items=items, total=total, page=page, page_size=page_size)


@router.get("/logs/audit", response_model=AdminAuditLogListOut)
async def list_audit_logs(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    user_id: int | None = Query(None),
    event_type: str | None = Query(None),
    ip: str | None = Query(None),
) -> AdminAuditLogListOut:
    where = []
    if user_id is not None:
        where.append(AuditLog.user_id == user_id)
    if event_type:
        where.append(AuditLog.event_type == event_type)
    if ip:
        where.append(AuditLog.ip == ip)

    stmt = select(AuditLog).where(and_(*where)) if where else select(AuditLog)
    total = (await db.execute(
        select(func.count()).select_from(stmt.subquery())
    )).scalar() or 0
    rows = (await db.execute(
        stmt.order_by(AuditLog.id.desc()).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    items = [
        AdminAuditLogItem(
            id=r.id,
            event_type=r.event_type,
            user_id=r.user_id,
            email=r.email,
            ip=r.ip,
            user_agent=r.user_agent,
            detail=r.detail,
            created_at=r.created_at,
        )
        for r in rows
    ]
    return AdminAuditLogListOut(items=items, total=total, page=page, page_size=page_size)


# ===== 日活统计 =====


@router.get("/stats/dau", response_model=list[DAUItem])
async def dau_stats(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    days: int = Query(30, ge=1, le=90),
) -> list[DAUItem]:
    now = datetime.now(tz=timezone.utc)
    start = now - timedelta(days=days)
    traffic_filter = _external_access_log_filter()
    rows = (await db.execute(
        select(
            func.date(AccessLog.created_at).label("d"),
            func.count(func.distinct(AccessLog.user_id)).label("c"),
        )
        .where(and_(traffic_filter, AccessLog.created_at >= start, AccessLog.user_id.isnot(None)))
        .group_by(func.date(AccessLog.created_at))
        .order_by(func.date(AccessLog.created_at))
    )).all()
    return [DAUItem(date=str(r.d), count=r.c) for r in rows]


# ===== 流量统计 =====


@router.get("/stats/traffic", response_model=TrafficStats)
async def traffic_stats(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> TrafficStats:
    now = datetime.now(tz=timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    traffic_filter = _external_access_log_filter()

    total = (await db.execute(
        select(func.count(AccessLog.id)).where(traffic_filter)
    )).scalar() or 0
    today = (await db.execute(
        select(func.count(AccessLog.id)).where(and_(traffic_filter, AccessLog.created_at >= today_start))
    )).scalar() or 0
    avg_dur = (await db.execute(
        select(func.avg(AccessLog.duration_ms)).where(traffic_filter)
    )).scalar() or 0.0

    total_5xx = (await db.execute(
        select(func.count(AccessLog.id)).where(and_(traffic_filter, AccessLog.status_code >= 500))
    )).scalar() or 0
    error_rate = (total_5xx / total * 100) if total > 0 else 0.0

    top_rows = (await db.execute(
        select(AccessLog.path, func.count(AccessLog.id).label("c"))
        .where(traffic_filter)
        .group_by(AccessLog.path)
        .order_by(func.count(AccessLog.id).desc())
        .limit(10)
    )).all()
    top_paths = [{"path": r.path, "count": r.c} for r in top_rows]

    return TrafficStats(
        total_requests=total,
        today_requests=today,
        avg_duration_ms=round(avg_dur, 1),
        error_rate=round(error_rate, 2),
        top_paths=top_paths,
    )


# ===== 图片管理 =====


@router.get("/images")
async def list_images(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user_id: int | None = Query(None),
) -> dict[str, Any]:
    # 使用 JOIN 一次性拿到 Message + Conversation.user_id，避免 N+1 查询
    stmt = (
        select(Message, Conversation.user_id.label("conv_user_id"))
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(Message.role == "ai", Message.image_urls.isnot(None))
    )
    if user_id:
        stmt = stmt.where(Conversation.user_id == user_id)

    total = (await db.execute(
        select(func.count()).select_from(stmt.subquery())
    )).scalar() or 0
    rows = (await db.execute(
        stmt.order_by(Message.id.desc()).offset((page - 1) * page_size).limit(page_size)
    )).all()

    items = [
        {
            "id": m.id,
            "conversation_id": m.conversation_id,
            "user_id": conv_user_id,
            "image_urls": m.image_urls,
            "status": m.status,
            "created_at": m.created_at,
        }
        for m, conv_user_id in rows
    ]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.delete("/images/{message_id}")
async def delete_image(
    message_id: int,
    request: Request,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    m = (await db.execute(select(Message).where(Message.id == message_id))).scalar_one_or_none()
    if m is None:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    m.image_urls = None
    await _write_admin_log(
        db, admin.id, "delete_image", _client_ip(request),
        "message", message_id,
    )
    await db.commit()
    return {"ok": True}


# ===== 上游渠道管理 =====


@router.get("/upstreams", response_model=list[UpstreamChannelItem])
async def list_upstreams(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[UpstreamChannelItem]:
    rows = (await db.execute(
        select(UpstreamChannel).order_by(UpstreamChannel.priority.desc(), UpstreamChannel.id)
    )).scalars().all()
    return [
        UpstreamChannelItem(
            id=r.id, name=r.name, base_url=r.base_url,
            api_key_masked=_mask_key(r.api_key),
            enabled=r.enabled, priority=r.priority,
            supports_edit=r.supports_edit,
            max_concurrent=r.max_concurrent,
            timeout_seconds=r.timeout_seconds,
            last_health_check=r.last_health_check,
            last_health_ok=r.last_health_ok,
            last_latency_ms=r.last_latency_ms,
            total_requests=r.total_requests,
            total_failures=r.total_failures,
            created_at=r.created_at, updated_at=r.updated_at,
        )
        for r in rows
    ]


@router.post("/upstreams", response_model=UpstreamChannelItem)
async def create_upstream(
    body: UpstreamChannelCreate,
    request: Request,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> UpstreamChannelItem:
    # 加密存储 api_key（如果配置了加密密钥）
    stored_key = encrypt_api_key(body.api_key) if is_encryption_configured() else body.api_key
    ch = UpstreamChannel(
        name=body.name, base_url=body.base_url, api_key=stored_key,
        enabled=body.enabled, priority=body.priority,
        supports_edit=body.supports_edit,
        max_concurrent=body.max_concurrent,
        timeout_seconds=body.timeout_seconds,
    )
    db.add(ch)
    await _write_admin_log(
        db, admin.id, "create_upstream", _client_ip(request),
        "upstream", None, {"name": body.name},
    )
    await db.commit()
    await db.refresh(ch)
    return UpstreamChannelItem(
        id=ch.id, name=ch.name, base_url=ch.base_url,
        api_key_masked=_mask_key(ch.api_key),
        enabled=ch.enabled, priority=ch.priority,
        supports_edit=ch.supports_edit,
        max_concurrent=ch.max_concurrent,
        timeout_seconds=ch.timeout_seconds,
        last_health_check=ch.last_health_check,
        last_health_ok=ch.last_health_ok,
        last_latency_ms=ch.last_latency_ms,
        total_requests=ch.total_requests,
        total_failures=ch.total_failures,
        created_at=ch.created_at, updated_at=ch.updated_at,
    )


@router.put("/upstreams/{channel_id}", response_model=UpstreamChannelItem)
async def update_upstream(
    channel_id: int,
    body: UpstreamChannelUpdate,
    request: Request,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> UpstreamChannelItem:
    ch = (await db.execute(
        select(UpstreamChannel).where(UpstreamChannel.id == channel_id)
    )).scalar_one_or_none()
    if ch is None:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})

    changes: dict[str, Any] = {}
    for field in ["name", "base_url", "api_key", "enabled", "priority",
                   "supports_edit", "max_concurrent", "timeout_seconds"]:
        val = getattr(body, field)
        if val is not None:
            if field == "api_key" and is_encryption_configured():
                # api_key 加密存储，审计日志不记录明文
                setattr(ch, field, encrypt_api_key(val))
                changes["api_key"] = "***"
            else:
                setattr(ch, field, val)
                changes[field] = val

    if changes:
        await _write_admin_log(
            db, admin.id, "update_upstream", _client_ip(request),
            "upstream", channel_id, changes,
        )
        await db.commit()
        await db.refresh(ch)

    return UpstreamChannelItem(
        id=ch.id, name=ch.name, base_url=ch.base_url,
        api_key_masked=_mask_key(ch.api_key),
        enabled=ch.enabled, priority=ch.priority,
        supports_edit=ch.supports_edit,
        max_concurrent=ch.max_concurrent,
        timeout_seconds=ch.timeout_seconds,
        last_health_check=ch.last_health_check,
        last_health_ok=ch.last_health_ok,
        last_latency_ms=ch.last_latency_ms,
        total_requests=ch.total_requests,
        total_failures=ch.total_failures,
        created_at=ch.created_at, updated_at=ch.updated_at,
    )


@router.delete("/upstreams/{channel_id}")
async def delete_upstream(
    channel_id: int,
    request: Request,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    ch = (await db.execute(
        select(UpstreamChannel).where(UpstreamChannel.id == channel_id)
    )).scalar_one_or_none()
    if ch is None:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    await _write_admin_log(
        db, admin.id, "delete_upstream", _client_ip(request),
        "upstream", channel_id, {"name": ch.name},
    )
    await db.delete(ch)
    await db.commit()
    return {"ok": True}


@router.post("/upstreams/{channel_id}/health-check")
async def health_check_upstream(
    channel_id: int,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> UpstreamHealthItem:
    ch = (await db.execute(
        select(UpstreamChannel).where(UpstreamChannel.id == channel_id)
    )).scalar_one_or_none()
    if ch is None:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})

    import time
    start = time.monotonic()
    ok = False
    # 解密 api_key 用于实际请求
    plain_key = decrypt_api_key(ch.api_key) if is_encryption_configured() else ch.api_key
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{ch.base_url}/models", headers={
                "Authorization": f"Bearer {plain_key}",
            })
            ok = resp.status_code < 500
    except Exception:
        ok = False
    latency = int((time.monotonic() - start) * 1000)

    ch.last_health_check = datetime.now(tz=timezone.utc)
    ch.last_health_ok = ok
    ch.last_latency_ms = latency
    await db.commit()
    await db.refresh(ch)

    failure_rate = (ch.total_failures / ch.total_requests * 100) if ch.total_requests > 0 else 0.0
    return UpstreamHealthItem(
        id=ch.id, name=ch.name, base_url=ch.base_url,
        enabled=ch.enabled,
        last_health_ok=ch.last_health_ok,
        last_latency_ms=ch.last_latency_ms,
        last_health_check=ch.last_health_check,
        total_requests=ch.total_requests,
        total_failures=ch.total_failures,
        failure_rate=round(failure_rate, 2),
    )


@router.get("/upstreams/status", response_model=list[UpstreamHealthItem])
async def upstream_status(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[UpstreamHealthItem]:
    rows = (await db.execute(select(UpstreamChannel))).scalars().all()
    result = []
    for ch in rows:
        failure_rate = (ch.total_failures / ch.total_requests * 100) if ch.total_requests > 0 else 0.0
        result.append(UpstreamHealthItem(
            id=ch.id, name=ch.name, base_url=ch.base_url,
            enabled=ch.enabled,
            last_health_ok=ch.last_health_ok,
            last_latency_ms=ch.last_latency_ms,
            last_health_check=ch.last_health_check,
            total_requests=ch.total_requests,
            total_failures=ch.total_failures,
            failure_rate=round(failure_rate, 2),
        ))
    return result
