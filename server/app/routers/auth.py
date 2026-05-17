"""/api/auth/* 路由"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth_service import (
    AuthError,
    authenticate,
    blacklist_token,
    create_jwt,
    decode_jwt,
    register_user,
)
from ..db import get_db
from ..deps import get_current_user
from ..models import User
from ..redis_client import get_redis
from ..schemas import (
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UserPublic,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])
_bearer = HTTPBearer(auto_error=False)


def _user_public(u: User) -> UserPublic:
    return UserPublic(
        id=u.id,
        email=u.email,
        nickname=u.nickname,
        role=u.role,
        avatar_url=u.avatar_url,
        credits=u.credits,
        last_login_at=u.last_login_at,
        created_at=u.created_at,
    )


def _auth_error_response(err: AuthError) -> JSONResponse:
    body = {"error": {"code": err.code, "message": err.code, **err.extra}}
    return JSONResponse(status_code=err.http_status, content=body)


@router.post(
    "/register",
    status_code=status.HTTP_201_CREATED,
    response_model=TokenResponse,
)
async def register(
    req: RegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        user = await register_user(
            db, email=req.email, password=req.password, nickname=req.nickname
        )
    except AuthError as e:
        return _auth_error_response(e)

    token, exp_in, _jti = create_jwt(user_id=user.id, email=user.email, role=user.role)
    return JSONResponse(
        status_code=status.HTTP_201_CREATED,
        content=TokenResponse(
            access_token=token,
            token_type="Bearer",
            expires_in=exp_in,
            user=_user_public(user),
        ).model_dump(mode="json"),
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    req: LoginRequest,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
):
    try:
        user = await authenticate(db, redis, email=req.email, password=req.password)
    except AuthError as e:
        return _auth_error_response(e)

    token, exp_in, _jti = create_jwt(user_id=user.id, email=user.email, role=user.role)
    return JSONResponse(
        status_code=200,
        content=TokenResponse(
            access_token=token,
            token_type="Bearer",
            expires_in=exp_in,
            user=_user_public(user),
        ).model_dump(mode="json"),
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    redis: Redis = Depends(get_redis),
):
    # 没带 token 也直接 204（前端清掉本地存储即可）
    if creds is None or not creds.credentials:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    try:
        payload = decode_jwt(creds.credentials)
        jti = payload.get("jti")
        exp = int(payload.get("exp", 0))
        if jti and exp:
            await blacklist_token(redis, jti=jti, exp_unix=exp)
    except jwt.PyJWTError:
        # token 已无效，登出操作幂等
        pass
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserPublic)
async def me(user: User = Depends(get_current_user)) -> UserPublic:
    return _user_public(user)
