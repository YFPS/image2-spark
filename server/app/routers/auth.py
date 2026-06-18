"""/api/auth/* 路由"""

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
    normalize_email,
    register_user,
)
from ..audit_service import write_audit_log
from ..config import get_settings
from ..db import get_db
from ..deps import get_current_user
from ..email_verification_service import (
    VerificationError,
    create_verification_token,
    resend_verification,
    send_verification_email,
    verify_email_token,
)
from ..models import User
from ..redis_client import get_redis
from ..rate_limit import get_limiter
from ..schemas import (
    LoginRequest,
    RegisterRequest,
    ResendVerificationRequest,
    TokenResponse,
    UserPublic,
    VerifyEmailRequest,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])
_bearer = HTTPBearer(auto_error=False)
limiter = get_limiter()


def _user_public(u: User) -> UserPublic:
    return UserPublic(
        id=u.id,
        email=u.email,
        nickname=u.nickname,
        role=u.role,
        avatar_url=u.avatar_url,
        credits=u.credits,
        email_verified_at=u.email_verified_at,
        verification_required=u.email_verified_at is None,
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
@limiter.limit(lambda: get_settings().rate_limit_register)
async def register(
    request: Request,
    req: RegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    """注册：积分 0，先建 user + 验证 token，提交后发邮件。

    邮件发送失败不回滚事务：用户已建好，response 标记 verification_email_sent=false 让前端提示重发。
    """
    try:
        user = await register_user(
            db, email=req.email, password=req.password, nickname=req.nickname
        )
        token_plain = await create_verification_token(db, user)
        await db.commit()
        await db.refresh(user)
    except AuthError as e:
        try:
            await write_audit_log(
                db,
                event_type="auth_register_failed",
                request=request,
                email=normalize_email(req.email),
                detail={"code": e.code},
            )
            await db.commit()
        except Exception:  # noqa: BLE001
            logger.exception("写入注册失败审计日志失败")
        return _auth_error_response(e)

    verification_email_sent = True
    try:
        await send_verification_email(user, token_plain)
    except Exception:  # noqa: BLE001
        # provider 故障不影响注册成功；前端可走重发入口
        logger.exception("发送验证邮件失败 user_id=%s", user.id)
        verification_email_sent = False

    try:
        await write_audit_log(
            db,
            event_type="auth_register_success",
            request=request,
            user_id=user.id,
            email=user.email,
            detail={"verification_email_sent": verification_email_sent},
        )
        await db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("写入注册成功审计日志失败 user_id=%s", user.id)

    jwt_token, exp_in, _jti = create_jwt(
        user_id=user.id, email=user.email, role=user.role
    )
    return JSONResponse(
        status_code=status.HTTP_201_CREATED,
        content=TokenResponse(
            access_token=jwt_token,
            token_type="Bearer",
            expires_in=exp_in,
            user=_user_public(user),
            verification_email_sent=verification_email_sent,
        ).model_dump(mode="json"),
    )


@router.post("/verify-email")
@limiter.limit(lambda: get_settings().rate_limit_verify_email)
async def verify_email(
    request: Request,
    req: VerifyEmailRequest,
    db: AsyncSession = Depends(get_db),
):
    """消费验证 token：把 user 置为已验证并按需发放 signup bonus。"""
    try:
        user = await verify_email_token(db, req.token, request=request)
    except VerificationError as e:
        return JSONResponse(
            status_code=e.http_status,
            content={"error": {"code": e.code, "message": e.code}},
        )
    return {"ok": True, "user": _user_public(user).model_dump(mode="json")}


@router.post("/resend-verification")
@limiter.limit(lambda: get_settings().rate_limit_resend_verification)
async def resend_verification_email(
    request: Request,
    req: ResendVerificationRequest,
    db: AsyncSession = Depends(get_db),
):
    """重发验证邮件。对外固定 ok，避免邮箱存在性枚举。"""
    try:
        sent = await resend_verification(db, normalize_email(req.email))
        await write_audit_log(
            db,
            event_type="auth_verification_resend_requested",
            request=request,
            email=normalize_email(req.email),
            detail={"sent": sent},
        )
        await db.commit()
    except Exception:  # noqa: BLE001
        # 任何内部错误都吞掉；防止泄露邮箱状态。日志侧仍记录便于排查。
        logger.exception("重发验证邮件失败")
    return {"ok": True}


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
