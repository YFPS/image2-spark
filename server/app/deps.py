"""FastAPI 鉴权依赖"""
from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import jwt

from .auth_service import decode_jwt, is_blacklisted
from .db import get_db
from .models import User
from .redis_client import get_redis

_bearer = HTTPBearer(auto_error=False)


def _unauthorized(code: str = "invalid_token") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"error": {"code": code, "message": code}},
        headers={"WWW-Authenticate": "Bearer"},
    )


def _forbidden(code: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={"error": {"code": code, "message": code}},
    )


async def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> User:
    if creds is None or not creds.credentials:
        raise _unauthorized()
    try:
        payload = decode_jwt(creds.credentials)
    except jwt.PyJWTError as e:
        raise _unauthorized() from e

    jti = payload.get("jti")
    sub = payload.get("sub")
    if not jti or not sub:
        raise _unauthorized()

    if await is_blacklisted(redis, jti):
        raise _unauthorized()

    try:
        user_id = int(sub)
    except (TypeError, ValueError) as e:
        raise _unauthorized() from e

    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise _unauthorized()
    if user.disabled:
        raise _forbidden("account_disabled")
    # 将 user_id 写入 request.state，供 AccessLogMiddleware 读取
    request.state.user_id = user.id
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise _forbidden("forbidden")
    return user


async def require_paid(user: User = Depends(get_current_user)) -> User:
    if user.role not in ("paid", "admin"):
        raise _forbidden("forbidden")
    return user
