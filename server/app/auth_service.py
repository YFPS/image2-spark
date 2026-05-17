"""鉴权业务层 —— 密码哈希、JWT、注册、登录、黑名单、登录限流"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from passlib.context import CryptContext
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .models import CreditTransaction, User

# ===== 密码 =====

_pwd_ctx: CryptContext | None = None


def _get_pwd_ctx() -> CryptContext:
    global _pwd_ctx
    if _pwd_ctx is None:
        rounds = get_settings().bcrypt_rounds
        _pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=rounds)
    return _pwd_ctx


def hash_password(plain: str) -> str:
    return _get_pwd_ctx().hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _get_pwd_ctx().verify(plain, hashed)
    except ValueError:
        # 哈希格式异常视为不匹配
        return False


# ===== JWT =====

JWT_ALG = "HS256"


def create_jwt(*, user_id: int, email: str, role: str) -> tuple[str, int, str]:
    """签发 access token。返回 (token, expires_in_seconds, jti)。"""
    settings = get_settings()
    if not settings.jwt_secret:
        raise RuntimeError("JWT_SECRET 未配置")
    now = datetime.now(tz=timezone.utc)
    exp = now + timedelta(days=settings.jwt_exp_days)
    jti = uuid.uuid4().hex
    payload = {
        "sub": str(user_id),
        "email": email,
        "role": role,
        "jti": jti,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALG)
    expires_in = int((exp - now).total_seconds())
    return token, expires_in, jti


def decode_jwt(token: str) -> dict[str, Any]:
    """解 JWT；过期 / 非法签名抛 jwt.PyJWTError 子类"""
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret, algorithms=[JWT_ALG])


# ===== Redis 黑名单 =====


def _blacklist_key(jti: str) -> str:
    return f"jwt:blacklist:{jti}"


async def blacklist_token(redis: Redis, *, jti: str, exp_unix: int) -> None:
    """登出时把 jti 写黑名单，TTL = 剩余有效期"""
    now = int(datetime.now(tz=timezone.utc).timestamp())
    ttl = max(1, exp_unix - now)
    await redis.set(_blacklist_key(jti), "1", ex=ttl)


async def is_blacklisted(redis: Redis, jti: str) -> bool:
    return bool(await redis.exists(_blacklist_key(jti)))


# ===== 登录限流 =====


# Lua 原子脚本：INCR 失败计数，超阈值同时写锁
_LUA_INC_FAIL = """
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
if n >= tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'EX', ARGV[3])
end
return n
"""


def _fail_key(email: str) -> str:
    return f"login:fail:{email}"


def _lock_key(email: str) -> str:
    return f"login:lock:{email}"


async def check_login_lock(redis: Redis, email: str) -> int:
    """返回剩余锁定秒数；0 表示未锁。"""
    ttl = await redis.ttl(_lock_key(email))
    return ttl if ttl and ttl > 0 else 0


async def record_login_failure(redis: Redis, email: str) -> None:
    settings = get_settings()
    await redis.eval(
        _LUA_INC_FAIL,
        2,
        _fail_key(email),
        _lock_key(email),
        settings.login_fail_window,
        settings.login_fail_max,
        settings.login_lock_ttl,
    )


async def clear_login_failure(redis: Redis, email: str) -> None:
    await redis.delete(_fail_key(email))


# ===== 业务流程 =====


def normalize_email(email: str) -> str:
    return email.strip().lower()


class AuthError(Exception):
    """业务异常，由路由层捕获并转 HTTP 错误"""

    def __init__(self, code: str, http_status: int = 400, extra: dict | None = None):
        super().__init__(code)
        self.code = code
        self.http_status = http_status
        self.extra = extra or {}


async def register_user(
    session: AsyncSession,
    *,
    email: str,
    password: str,
    nickname: str | None,
) -> User:
    """注册 + 同事务赠送积分。任何一步失败回滚。"""
    settings = get_settings()
    email_norm = normalize_email(email)
    nick = (nickname or email_norm.split("@", 1)[0])[:32].strip() or email_norm.split("@", 1)[0]
    user = User(
        email=email_norm,
        password_hash=hash_password(password),
        nickname=nick,
        role="user",
        credits=settings.signup_bonus_credits,
    )
    session.add(user)
    try:
        await session.flush()  # 拿到 user.id；同时触发 UNIQUE 冲突
    except IntegrityError as e:
        await session.rollback()
        raise AuthError("email_taken", http_status=409) from e

    # 写赠送流水
    tx = CreditTransaction(
        user_id=user.id,
        delta=settings.signup_bonus_credits,
        balance_after=settings.signup_bonus_credits,
        reason="signup_bonus",
        note="新用户注册赠送",
    )
    session.add(tx)
    await session.commit()
    await session.refresh(user)
    return user


async def authenticate(
    session: AsyncSession,
    redis: Redis,
    *,
    email: str,
    password: str,
) -> User:
    """登录校验。失败按业务规则计数 + 抛 AuthError。"""
    email_norm = normalize_email(email)

    lock_ttl = await check_login_lock(redis, email_norm)
    if lock_ttl > 0:
        raise AuthError(
            "too_many_attempts",
            http_status=429,
            extra={"lock_remaining": lock_ttl},
        )

    result = await session.execute(select(User).where(User.email == email_norm))
    user = result.scalar_one_or_none()

    if user is None or not verify_password(password, user.password_hash):
        await record_login_failure(redis, email_norm)
        raise AuthError("invalid_credentials", http_status=401)

    if user.disabled:
        # 封号不计入失败次数（你密码是对的）
        raise AuthError("account_disabled", http_status=403)

    await clear_login_failure(redis, email_norm)
    user.last_login_at = datetime.now(tz=timezone.utc)
    await session.commit()
    await session.refresh(user)
    return user
