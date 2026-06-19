"""/api/admin/* 管理后台路由"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import and_, delete, func, not_, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

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
from ..customer_text import sanitize_customer_message_text
from ..db import get_db
from ..deps import require_admin
from ..models import (
    AccessLog,
    AdminLog,
    AuditLog,
    Conversation,
    CreditTransaction,
    EmailVerificationToken,
    GeneratedAsset,
    Message,
    UpstreamChannel,
    UpstreamRequestLog,
    User,
)
from ..schemas import MessageOut
from ..upstream_monitoring import UpstreamAttempt, summarize_upstream_metrics
from ..works_service import filter_displayable_image_urls

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])

_INTERNAL_ACCESS_PATHS = {"/api/health", "/docs", "/openapi.json", "/redoc"}
_INTERNAL_ACCESS_PREFIXES = ("/api/admin", "/static")


ADMIN_DATA_TABLES: dict[str, dict[str, Any]] = {
    "conversations": {
        "label": "会话",
        "model": Conversation,
        "columns": ["id", "user_id", "title", "pinned", "created_at", "updated_at", "deleted_at"],
        "search_columns": [Conversation.title],
        "filter_columns": {"user_id": Conversation.user_id},
    },
    "messages": {
        "label": "消息",
        "model": Message,
        "columns": ["id", "conversation_id", "role", "text", "image_urls", "params", "status", "created_at"],
        "search_columns": [Message.text, Message.status, Message.role],
        "filter_columns": {
            "conversation_id": Message.conversation_id,
            "status": Message.status,
        },
    },
    "credit_transactions": {
        "label": "积分流水",
        "model": CreditTransaction,
        "columns": [
            "id", "user_id", "delta", "balance_after", "reason",
            "ref_type", "ref_id", "note", "created_at",
        ],
        "search_columns": [
            CreditTransaction.reason,
            CreditTransaction.ref_type,
            CreditTransaction.ref_id,
            CreditTransaction.note,
        ],
        "filter_columns": {"user_id": CreditTransaction.user_id},
    },
    "email_verification_tokens": {
        "label": "邮箱验证",
        "model": EmailVerificationToken,
        "columns": ["id", "user_id", "token_hash", "purpose", "expires_at", "used_at", "created_at"],
        "search_columns": [EmailVerificationToken.purpose, EmailVerificationToken.token_hash],
        "filter_columns": {"user_id": EmailVerificationToken.user_id},
    },
    "generated_assets": {
        "label": "生成资产",
        "model": GeneratedAsset,
        "columns": [
            "id", "user_id", "conversation_id", "message_id", "slot_index",
            "storage_kind", "storage_key", "public_url", "source_url",
            "mime_type", "width", "height", "bytes", "sha256",
            "status", "created_at", "updated_at",
        ],
        "search_columns": [
            GeneratedAsset.storage_kind,
            GeneratedAsset.storage_key,
            GeneratedAsset.public_url,
            GeneratedAsset.source_url,
            GeneratedAsset.mime_type,
            GeneratedAsset.sha256,
            GeneratedAsset.status,
        ],
        "filter_columns": {
            "user_id": GeneratedAsset.user_id,
            "conversation_id": GeneratedAsset.conversation_id,
            "message_id": GeneratedAsset.message_id,
            "status": GeneratedAsset.status,
        },
    },
}


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


def _mask_hash(value: str | None) -> str | None:
    if value is None:
        return None
    if len(value) <= 16:
        return "****"
    return f"{value[:8]}...{value[-6:]}"


def _json_safe_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _serialize_admin_data_table_row(table_key: str, row: Any) -> dict[str, Any]:
    cfg = ADMIN_DATA_TABLES[table_key]
    data: dict[str, Any] = {}
    for col in cfg["columns"]:
        value = getattr(row, col)
        if table_key == "email_verification_tokens" and col == "token_hash":
            value = _mask_hash(value)
        data[col] = _json_safe_value(value)
    return data


def _row_conversation_id(
    table_key: str,
    row: Any,
    message_conversation_ids: dict[int, int] | None = None,
) -> int | None:
    if table_key == "conversations":
        return getattr(row, "id", None)
    if table_key in {"messages", "generated_assets"}:
        return getattr(row, "conversation_id", None)
    if table_key == "credit_transactions":
        ref_type = getattr(row, "ref_type", None)
        ref_id = getattr(row, "ref_id", None)
        if ref_type == "message" and ref_id is not None and str(ref_id).isdigit():
            return (message_conversation_ids or {}).get(int(ref_id))
    return None


def _serialize_admin_user_summary(user: User | None) -> dict[str, Any] | None:
    if user is None:
        return None
    return {
        "id": user.id,
        "email": user.email,
        "nickname": user.nickname,
        "role": user.role,
    }


def _serialize_admin_data_table_item(
    table_key: str,
    row: Any,
    user: User | None,
    message_conversation_ids: dict[int, int] | None = None,
) -> dict[str, Any]:
    data = _serialize_admin_data_table_row(table_key, row)
    data["_user"] = _serialize_admin_user_summary(user)
    data["_conversation_id"] = _row_conversation_id(table_key, row, message_conversation_ids)
    return data


async def _load_credit_message_conversation_ids(
    db: AsyncSession,
    table_key: str,
    rows: list[Any],
) -> dict[int, int]:
    if table_key != "credit_transactions":
        return {}
    message_ids = {
        int(row.ref_id)
        for row in rows
        if getattr(row, "ref_type", None) == "message"
        and getattr(row, "ref_id", None) is not None
        and str(row.ref_id).isdigit()
    }
    if not message_ids:
        return {}
    pairs = (await db.execute(
        select(Message.id, Message.conversation_id).where(Message.id.in_(message_ids))
    )).all()
    return {int(row.id): int(row.conversation_id) for row in pairs}


async def _load_admin_data_table_users_by_row_id(
    db: AsyncSession,
    table_key: str,
    rows: list[Any],
) -> dict[int, User | None]:
    if not rows:
        return {}

    row_user_ids: dict[int, int] = {}
    if table_key == "messages":
        conv_ids = [row.conversation_id for row in rows]
        conv_rows = (await db.execute(
            select(Conversation.id, Conversation.user_id).where(Conversation.id.in_(conv_ids))
        )).all()
        user_id_by_conv_id = {r.id: r.user_id for r in conv_rows}
        row_user_ids = {
            row.id: user_id_by_conv_id[row.conversation_id]
            for row in rows
            if row.conversation_id in user_id_by_conv_id
        }
    else:
        row_user_ids = {
            row.id: row.user_id
            for row in rows
            if getattr(row, "user_id", None) is not None
        }

    if not row_user_ids:
        return {row.id: None for row in rows}

    users = (await db.execute(
        select(User).where(User.id.in_(set(row_user_ids.values())))
    )).scalars().all()
    user_by_id = {u.id: u for u in users}
    return {
        row.id: user_by_id.get(row_user_ids.get(row.id))
        for row in rows
    }


def _admin_data_table_search_clause(table_key: str, search: str):
    cfg = ADMIN_DATA_TABLES[table_key]
    clauses = [col.like(f"%{search}%") for col in cfg["search_columns"]]
    if search.isdigit():
        value = int(search)
        model = cfg["model"]
        for col_name in ("id", "user_id", "conversation_id", "message_id"):
            if hasattr(model, col_name):
                clauses.append(getattr(model, col_name) == value)
    return or_(*clauses)


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


def _serialize_admin_image_asset_item(asset: GeneratedAsset, user: User | None) -> dict[str, Any]:
    return {
        "id": asset.id,
        "user_id": asset.user_id,
        "conversation_id": asset.conversation_id,
        "message_id": asset.message_id,
        "slot_index": asset.slot_index,
        "image_url": asset.public_url if asset.status == "available" else None,
        "storage_kind": asset.storage_kind,
        "status": asset.status,
        "width": asset.width,
        "height": asset.height,
        "bytes": asset.bytes,
        "created_at": asset.created_at,
        "updated_at": asset.updated_at,
        "_user": _serialize_admin_user_summary(user),
    }


@router.get("/images")
async def list_images(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user_id: int | None = Query(None),
    status: str | None = Query(None),
) -> dict[str, Any]:
    stmt = select(GeneratedAsset, User).outerjoin(User, User.id == GeneratedAsset.user_id)
    if user_id:
        stmt = stmt.where(GeneratedAsset.user_id == user_id)
    if status:
        stmt = stmt.where(GeneratedAsset.status == status)

    total = (await db.execute(
        select(func.count()).select_from(stmt.subquery())
    )).scalar() or 0
    rows = (await db.execute(
        stmt.order_by(
            GeneratedAsset.status.asc(),
            GeneratedAsset.id.desc(),
        ).offset((page - 1) * page_size).limit(page_size)
    )).all()

    items = [
        _serialize_admin_image_asset_item(asset, user)
        for asset, user in rows
    ]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.delete("/images/{asset_id}")
async def delete_image(
    asset_id: int,
    request: Request,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    asset = (await db.execute(
        select(GeneratedAsset).where(GeneratedAsset.id == asset_id)
    )).scalar_one_or_none()
    if asset is None:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    asset.public_url = None
    asset.status = "quarantined"
    await _write_admin_log(
        db, admin.id, "quarantine_image_asset", _client_ip(request),
        "generated_asset", asset_id,
    )
    await db.commit()
    return {"ok": True}


def _to_admin_msg_out(
    message: Message,
    asset_urls_by_message_id: dict[int, list[str]] | None = None,
) -> dict[str, Any]:
    asset_urls = (asset_urls_by_message_id or {}).get(message.id, [])
    image_urls = asset_urls or filter_displayable_image_urls(message.image_urls)
    text = message.text
    if message.image_urls and not image_urls and not text.strip():
        text = "历史图源已失效，无法预览。"
    out = MessageOut(
        id=message.id,
        role=message.role,
        text=sanitize_customer_message_text(text, message.role),
        image_urls=image_urls or None,
        params=message.params,
        status=getattr(message, "status", "done"),
        created_at=message.created_at,
    )
    return out.model_dump()


async def _load_admin_asset_urls_by_message_id(
    db: AsyncSession,
    messages: list[Message],
) -> dict[int, list[str]]:
    message_ids = [message.id for message in messages]
    if not message_ids:
        return {}
    rows = (await db.execute(
        select(GeneratedAsset.message_id, GeneratedAsset.public_url)
        .where(
            GeneratedAsset.message_id.in_(message_ids),
            GeneratedAsset.status == "available",
            GeneratedAsset.public_url.is_not(None),
        )
        .order_by(GeneratedAsset.message_id.asc(), GeneratedAsset.slot_index.asc())
    )).all()
    urls_by_message_id: dict[int, list[str]] = {}
    for row in rows:
        if row.public_url:
            urls_by_message_id.setdefault(row.message_id, []).append(row.public_url)
    return urls_by_message_id


async def _build_admin_conversation_item(db: AsyncSession, conv: Conversation) -> dict[str, Any]:
    first_user = await db.execute(
        select(Message.text)
        .where(and_(Message.conversation_id == conv.id, Message.role == "user"))
        .order_by(Message.id.asc())
        .limit(1)
    )
    preview = (first_user.scalar_one_or_none() or "").strip().replace("\n", " ")[:60]

    message_count = int((await db.execute(
        select(func.count(Message.id)).where(Message.conversation_id == conv.id)
    )).scalar_one() or 0)
    pending_count = int((await db.execute(
        select(func.count(Message.id)).where(
            and_(
                Message.conversation_id == conv.id,
                Message.role == "ai",
                Message.status == "pending",
            )
        )
    )).scalar_one() or 0)

    return {
        "id": conv.id,
        "title": conv.title,
        "pinned": conv.pinned,
        "preview": preview,
        "message_count": message_count,
        "has_pending": pending_count > 0,
        "created_at": conv.created_at,
        "updated_at": conv.updated_at,
        "deleted_at": conv.deleted_at,
    }


@router.get("/users/{user_id}/conversations")
async def list_admin_user_conversations(
    user_id: int,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    _ = admin
    rows = (await db.execute(
        select(Conversation)
        .where(Conversation.user_id == user_id)
        .order_by(Conversation.pinned.desc(), Conversation.updated_at.desc(), Conversation.id.desc())
        .limit(200)
    )).scalars().all()
    return [await _build_admin_conversation_item(db, row) for row in rows]


@router.get("/conversations/{conversation_id}")
async def get_admin_conversation(
    conversation_id: int,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _ = admin
    conv = (await db.execute(
        select(Conversation)
        .options(selectinload(Conversation.messages))
        .where(Conversation.id == conversation_id)
    )).scalar_one_or_none()
    if conv is None:
        raise HTTPException(
            status_code=404,
            detail={"error": {"code": "conversation_not_found", "message": "会话不存在"}},
        )

    item = await _build_admin_conversation_item(db, conv)
    asset_urls_by_message_id = await _load_admin_asset_urls_by_message_id(db, conv.messages)
    return {
        **item,
        "messages": [
            _to_admin_msg_out(message, asset_urls_by_message_id)
            for message in conv.messages
        ],
    }


# ===== 数据表管理 =====


@router.get("/data-tables")
async def list_admin_data_tables(
    admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    _ = admin
    return [
        {
            "key": key,
            "label": cfg["label"],
            "columns": cfg["columns"],
        }
        for key, cfg in ADMIN_DATA_TABLES.items()
    ]


@router.get("/data-tables/{table_key}")
async def list_admin_data_table_rows(
    table_key: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    user_id: int | None = Query(None),
    conversation_id: int | None = Query(None),
    message_id: int | None = Query(None),
    status: str | None = Query(None),
) -> dict[str, Any]:
    _ = admin
    cfg = ADMIN_DATA_TABLES.get(table_key)
    if cfg is None:
        raise HTTPException(status_code=404, detail={"error": {"code": "table_not_found"}})

    model = cfg["model"]
    where = []
    filters = {
        "user_id": user_id,
        "conversation_id": conversation_id,
        "message_id": message_id,
        "status": status,
    }
    for key, value in filters.items():
        column = cfg["filter_columns"].get(key)
        if value is not None and column is not None:
            where.append(column == value)
    if search:
        where.append(_admin_data_table_search_clause(table_key, search.strip()))

    stmt = select(model).where(and_(*where)) if where else select(model)
    total = (await db.execute(
        select(func.count()).select_from(stmt.subquery())
    )).scalar() or 0
    rows = (await db.execute(
        stmt.order_by(model.id.desc()).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    users_by_row_id = await _load_admin_data_table_users_by_row_id(db, table_key, rows)
    message_conversation_ids = await _load_credit_message_conversation_ids(db, table_key, rows)

    return {
        "table": table_key,
        "label": cfg["label"],
        "columns": cfg["columns"],
        "items": [
            _serialize_admin_data_table_item(
                table_key,
                row,
                users_by_row_id.get(row.id),
                message_conversation_ids,
            )
            for row in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


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


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


async def _recent_upstream_metrics(
    db: AsyncSession,
    channels: list[UpstreamChannel],
) -> dict[int, Any]:
    channel_ids = [ch.id for ch in channels]
    if not channel_ids:
        return {}
    since = datetime.now(tz=timezone.utc) - timedelta(days=1)
    rows = (
        await db.execute(
            select(UpstreamRequestLog)
            .where(
                UpstreamRequestLog.channel_id.in_(channel_ids),
                UpstreamRequestLog.created_at >= since.replace(tzinfo=None),
            )
            .order_by(UpstreamRequestLog.created_at.desc())
        )
    ).scalars().all()
    attempts = [
        UpstreamAttempt(
            channel_id=row.channel_id,
            endpoint=row.endpoint,
            base_url=row.base_url,
            ok=row.ok,
            latency_ms=row.latency_ms,
            status_code=row.status_code,
            error_code=row.error_code,
            error_message=row.error_message,
            used_fallback=row.used_fallback,
            model=row.model,
            image_count=row.image_count,
            created_at=_utc(row.created_at),
        )
        for row in rows
    ]
    return summarize_upstream_metrics(attempts, now=datetime.now(tz=timezone.utc))


def _upstream_health_item(
    ch: UpstreamChannel,
    metrics_by_channel: dict[int, Any],
) -> UpstreamHealthItem:
    failure_rate = (ch.total_failures / ch.total_requests * 100) if ch.total_requests > 0 else 0.0
    metrics = metrics_by_channel.get(ch.id)
    recent_requests = metrics.recent_requests if metrics else 0
    recent_failures = metrics.recent_failures if metrics else 0
    recent_failure_rate = (
        round(recent_failures / recent_requests * 100, 2) if recent_requests > 0 else 0.0
    )
    return UpstreamHealthItem(
        id=ch.id,
        name=ch.name,
        base_url=ch.base_url,
        enabled=ch.enabled,
        last_health_ok=ch.last_health_ok,
        last_latency_ms=ch.last_latency_ms,
        last_health_check=ch.last_health_check,
        total_requests=ch.total_requests,
        total_failures=ch.total_failures,
        failure_rate=round(failure_rate, 2),
        avg_latency_ms=metrics.avg_latency_ms if metrics else None,
        p95_latency_ms=metrics.p95_latency_ms if metrics else None,
        recent_requests=recent_requests,
        recent_failures=recent_failures,
        recent_failure_rate=recent_failure_rate,
        recent_p95_latency_ms=metrics.recent_p95_latency_ms if metrics else None,
    )


def _is_upstream_health_ok(status_code: int) -> bool:
    return 200 <= status_code < 400


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
            ok = _is_upstream_health_ok(resp.status_code)
    except Exception:
        ok = False
    latency = int((time.monotonic() - start) * 1000)

    ch.last_health_check = datetime.now(tz=timezone.utc)
    ch.last_health_ok = ok
    ch.last_latency_ms = latency
    await db.commit()
    await db.refresh(ch)

    return _upstream_health_item(ch, await _recent_upstream_metrics(db, [ch]))


@router.get("/upstreams/status", response_model=list[UpstreamHealthItem])
async def upstream_status(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[UpstreamHealthItem]:
    rows = (await db.execute(select(UpstreamChannel))).scalars().all()
    metrics = await _recent_upstream_metrics(db, rows)
    return [_upstream_health_item(ch, metrics) for ch in rows]
