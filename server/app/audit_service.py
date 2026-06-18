"""安全审计与积分流水工具。"""
from __future__ import annotations

from typing import Any

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import AuditLog, CreditTransaction, User


class InsufficientCreditsError(Exception):
    """积分余额不足。"""

    def __init__(self, *, current: int, need: int):
        super().__init__("insufficient_credits")
        self.current = current
        self.need = need


def get_client_ip(request: Request | Any | None) -> str | None:
    """获取真实客户端 IP，优先信任反代写入的标准头。"""
    if request is None:
        return None
    headers = getattr(request, "headers", {}) or {}
    forwarded = headers.get("x-forwarded-for") or headers.get("X-Forwarded-For")
    if forwarded:
        first = forwarded.split(",", 1)[0].strip()
        if first:
            return first[:64]
    for key in ("x-real-ip", "X-Real-IP", "cf-connecting-ip", "CF-Connecting-IP"):
        value = headers.get(key)
        if value:
            return value.strip()[:64]
    client = getattr(request, "client", None)
    host = getattr(client, "host", None)
    return host[:64] if host else None


def get_user_agent(request: Request | Any | None) -> str | None:
    if request is None:
        return None
    headers = getattr(request, "headers", {}) or {}
    value = headers.get("user-agent") or headers.get("User-Agent")
    return value[:255] if value else None


async def write_audit_log(
    db: AsyncSession,
    *,
    event_type: str,
    request: Request | Any | None = None,
    user_id: int | None = None,
    email: str | None = None,
    detail: dict[str, Any] | None = None,
) -> AuditLog:
    """写入一条安全审计日志；调用方控制事务提交。"""
    row = AuditLog(
        event_type=event_type,
        user_id=user_id,
        email=(email or "").strip().lower()[:254] if email else None,
        ip=get_client_ip(request),
        user_agent=get_user_agent(request),
        detail=detail or {},
    )
    db.add(row)
    await db.flush()
    return row


async def apply_credit_delta(
    db: AsyncSession,
    *,
    user_id: int,
    delta: int,
    reason: str,
    ref_type: str | None = None,
    ref_id: str | None = None,
    note: str | None = None,
    request: Request | Any | None = None,
    actor_user_id: int | None = None,
    clamp_zero: bool = False,
) -> tuple[User, CreditTransaction]:
    """串行化修改积分，同时写积分流水和审计日志。

    使用 SELECT ... FOR UPDATE 获取用户行锁，确保 balance_after 是本次事务内
    真实余额快照，而不是并发请求下的旧快照。
    """
    user = (
        await db.execute(select(User).where(User.id == user_id).with_for_update())
    ).scalar_one()

    current = int(user.credits or 0)
    actual_delta = int(delta)
    next_balance = current + actual_delta
    if next_balance < 0:
        if not clamp_zero:
            raise InsufficientCreditsError(current=current, need=abs(actual_delta))
        actual_delta = -current
        next_balance = 0

    user.credits = next_balance
    await db.flush()

    tx = CreditTransaction(
        user_id=user.id,
        delta=actual_delta,
        balance_after=next_balance,
        reason=reason,
        ref_type=ref_type,
        ref_id=ref_id,
        note=note,
    )
    db.add(tx)
    await db.flush()

    event_type = "credit_grant" if actual_delta > 0 else "credit_charge"
    await write_audit_log(
        db,
        event_type=event_type,
        request=request,
        user_id=user.id,
        email=user.email,
        detail={
            "credit_transaction_id": tx.id,
            "delta": actual_delta,
            "balance_after": next_balance,
            "reason": reason,
            "ref_type": ref_type,
            "ref_id": ref_id,
            "note": note,
            "actor_user_id": actor_user_id,
        },
    )
    return user, tx


async def set_user_credits(
    db: AsyncSession,
    *,
    user_id: int,
    target_credits: int,
    reason: str,
    note: str | None = None,
    request: Request | Any | None = None,
    actor_user_id: int | None = None,
) -> tuple[User, CreditTransaction | None]:
    """把用户积分设置到目标值，并按实际差额写流水。"""
    user = (
        await db.execute(select(User).where(User.id == user_id).with_for_update())
    ).scalar_one()
    current = int(user.credits or 0)
    target = max(0, int(target_credits))
    delta = target - current
    if delta == 0:
        return user, None
    return await apply_credit_delta(
        db,
        user_id=user_id,
        delta=delta,
        reason=reason,
        note=note,
        request=request,
        actor_user_id=actor_user_id,
    )
