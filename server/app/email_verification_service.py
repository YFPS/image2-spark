"""邮箱验证服务：token 生命周期 + 验证后 signup bonus 发放 + 重发 + verified guard。

设计要点（详见 docs/superpowers/specs/2026-05-20-auth-p2-email-verification-design.md）：
- 明文 token 只通过邮件发出；库内只存 sha256(token)。
- token 默认 24 小时有效；同一用户可同时存在多个未使用 token。
- 任一 token 验证成功 → user.email_verified_at = NOW()，并把该用户其他未消费 token 全部置为 used。
- 同一用户只发放一次 signup bonus（signup_bonus_granted_at 单调置位）。
- 验证流程在同一事务里完成 user / token / 积分流水写入。
- resend 接口对外不区分"邮箱不存在 / 已验证 / 未验证"——固定返回 ok。
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .email_provider import get_email_provider
from .models import CreditTransaction, EmailVerificationToken, User


class VerificationError(Exception):
    """业务异常：由路由层统一映射为 {error: {code, message}}。"""

    def __init__(self, code: str, http_status: int = 400):
        super().__init__(code)
        self.code = code
        self.http_status = http_status


# ===== 纯函数 =====


def hash_verification_token(token: str) -> str:
    """sha256(token) 小写 hex；幂等且无随机性。"""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def build_verify_url(base_url: str, token: str) -> str:
    """在 base_url 上拼 ?token=... 或 &token=...。"""
    separator = "&" if "?" in base_url else "?"
    return f"{base_url}{separator}{urlencode({'token': token})}"


def _utcnow_naive() -> datetime:
    """返回 naive UTC datetime（MySQL DATETIME 列与现有 user.created_at 一致）。"""
    return datetime.now(tz=timezone.utc).replace(tzinfo=None)


def _new_token() -> str:
    """URL-safe 高熵 token；至少 32 字节随机性。"""
    return secrets.token_urlsafe(32)


# ===== token 生命周期 =====


async def create_verification_token(session: AsyncSession, user: User) -> str:
    """生成新 token，落库 hash，返回明文 token。

    调用方负责 commit；本函数只 flush 拿到行 id。
    """
    settings = get_settings()
    token = _new_token()
    row = EmailVerificationToken(
        user_id=user.id,
        token_hash=hash_verification_token(token),
        expires_at=_utcnow_naive()
        + timedelta(hours=settings.email_verify_token_ttl_hours),
    )
    session.add(row)
    await session.flush()
    return token


async def send_verification_email(user: User, token: str) -> None:
    """通过当前 provider 发出验证邮件；失败抛异常，由路由层捕获。"""
    settings = get_settings()
    verify_url = build_verify_url(settings.email_verify_base_url, token)
    provider = get_email_provider()
    await provider.send_verification_email(
        to_email=user.email,
        nickname=user.nickname,
        verify_url=verify_url,
        expires_hours=settings.email_verify_token_ttl_hours,
    )


# ===== 验证 =====


async def verify_email_token(session: AsyncSession, token: str) -> User:
    """消费 token：用户置为已验证，必要时发放 signup bonus。

    幂等规则（与 spec 一致）：
    - token 不存在 → verification_token_invalid (400)
    - token 已过期且 user 未验证 → verification_token_expired (400)
    - token 已用且 user 已验证 → 返回 user（不再发积分）
    - 正常路径 → 设 email_verified_at，必要时发 bonus，把同用户其他未用 token 置为 used
    """
    token_hash = hash_verification_token(token)
    token_row = (
        await session.execute(
            select(EmailVerificationToken)
            .where(EmailVerificationToken.token_hash == token_hash)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if token_row is None:
        raise VerificationError("verification_token_invalid")

    user = (
        await session.execute(
            select(User).where(User.id == token_row.user_id).with_for_update()
        )
    ).scalar_one()

    now = _utcnow_naive()

    # 已使用 token 的幂等返回
    if token_row.used_at is not None:
        if user.email_verified_at is not None:
            return user
        raise VerificationError("verification_token_invalid")

    # 已过期 token：把它置为 used 后抛异常（避免后续被误用）
    if token_row.expires_at < now:
        if user.email_verified_at is not None:
            return user
        token_row.used_at = now
        await session.commit()
        raise VerificationError("verification_token_expired")

    # 正常路径
    if user.email_verified_at is None:
        user.email_verified_at = now

    settings = get_settings()
    if user.signup_bonus_granted_at is None:
        user.signup_bonus_granted_at = now
        bonus = settings.signup_bonus_credits
        if bonus > 0:
            user.credits = (user.credits or 0) + bonus
            session.add(
                CreditTransaction(
                    user_id=user.id,
                    delta=bonus,
                    balance_after=user.credits,
                    reason="signup_bonus",
                    note="邮箱验证后注册赠送",
                )
            )

    # 同用户其他未使用 token 一并标 used，避免一份链接验证后另一份仍能复用
    await session.execute(
        update(EmailVerificationToken)
        .where(
            EmailVerificationToken.user_id == user.id,
            EmailVerificationToken.used_at.is_(None),
        )
        .values(used_at=now)
    )
    await session.commit()
    await session.refresh(user)
    return user


# ===== 重发 =====


async def resend_verification(session: AsyncSession, email: str) -> bool:
    """重发验证邮件。

    返回值仅供调用方记日志；对外响应必须固定 ok，不暴露此处的返回。
    """
    email_norm = (email or "").strip().lower()
    if not email_norm:
        return False
    user = (
        await session.execute(select(User).where(User.email == email_norm))
    ).scalar_one_or_none()
    if user is None or user.email_verified_at is not None:
        return False
    token = await create_verification_token(session, user)
    await session.commit()
    await session.refresh(user)
    await send_verification_email(user, token)
    return True


# ===== Dep / Guard =====


def require_verified_user(user: User) -> None:
    """供生图/改图路由调用：未验证用户返回 403 email_not_verified。"""
    if user.email_verified_at is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": {"code": "email_not_verified", "message": "请先验证邮箱"}},
        )
