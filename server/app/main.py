"""image2 FastAPI 主入口"""
from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import Request
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text

from .config import get_settings
from .db import get_engine
from .rate_limit import get_limiter
from .redis_client import get_redis
from .middleware.access_log import AccessLogMiddleware
from .routers import admin, auth, conversations, images, logs, recent_works, works

logger = logging.getLogger("image2")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时强探活：DB / Redis / JWT_SECRET 任一缺失或不通，进程直接退出"""
    settings = get_settings()
    if not settings.jwt_secret:
        raise RuntimeError("JWT_SECRET 未配置，拒绝启动")

    # 生产环境邮件 provider 必须能真实发信
    if settings.app_env == "production":
        if settings.email_provider in {"console", "null"}:
            raise RuntimeError("生产环境禁止使用 console/null 邮件 provider")
        if not settings.email_verify_base_url.startswith("https://"):
            raise RuntimeError("生产环境 EMAIL_VERIFY_BASE_URL 必须使用 https")
    # SMTP provider 启用时校验基本配置（host/user/pass/from）
    if settings.email_provider == "smtp":
        required = [
            settings.smtp_host,
            settings.smtp_user,
            settings.smtp_pass,
            settings.smtp_from or settings.smtp_user,
        ]
        if not all(required):
            raise RuntimeError(
                "EMAIL_PROVIDER=smtp 但 SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_FROM 未配齐"
            )

    # DB 探活
    engine = get_engine()
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    logger.info("DB 探活 OK")

    # 启动时确保默认上游渠道存在（从环境变量自动创建）
    try:
        from .db import get_session_factory as _gsf
        from .models import UpstreamChannel as _UC
        from sqlalchemy import select as _sel

        _settings = get_settings()
        _factory = _gsf()
        async with _factory() as _db:
            _existing = (await _db.execute(
                _sel(_UC).where(_UC.base_url == _settings.openai_base_url).limit(1)
            )).scalar_one_or_none()
            if _existing is None and _settings.openai_api_key:
                _db.add(_UC(
                    name="默认上游",
                    base_url=_settings.openai_base_url,
                    api_key=_settings.openai_api_key,
                    enabled=True,
                    priority=100,
                    supports_edit=True,
                    max_concurrent=10,
                    timeout_seconds=int(_settings.openai_timeout),
                ))
                await _db.commit()
                logger.info("已自动创建默认上游渠道: %s", _settings.openai_base_url)
            # 备用上游渠道
            if _existing is None and _settings.openai_base_url_backup and _settings.openai_api_key_backup:
                _backup = (await _db.execute(
                    _sel(_UC).where(_UC.base_url == _settings.openai_base_url_backup).limit(1)
                )).scalar_one_or_none()
                if _backup is None:
                    _db.add(_UC(
                        name="备用上游",
                        base_url=_settings.openai_base_url_backup,
                        api_key=_settings.openai_api_key_backup,
                        enabled=True,
                        priority=50,
                        supports_edit=True,
                        max_concurrent=10,
                        timeout_seconds=int(_settings.openai_timeout),
                    ))
                    await _db.commit()
                    logger.info("已自动创建备用上游渠道: %s", _settings.openai_base_url_backup)
    except Exception:
        logger.warning("自动创建默认上游渠道跳过", exc_info=True)

    # 启动时自动加密存量明文 api_key（一次性迁移）
    try:
        from .crypto import encrypt_api_key as _enc_key, is_encrypted as _is_enc, is_encryption_configured as _enc_ok
        from .db import get_session_factory
        from .models import UpstreamChannel
        from sqlalchemy import select

        if _enc_ok():
            _factory = get_session_factory()
            async with _factory() as _db:
                _rows = (await _db.execute(
                    select(UpstreamChannel).where(UpstreamChannel.api_key.isnot(None))
                )).scalars().all()
                _migrated = 0
                for _ch in _rows:
                    if not _is_enc(_ch.api_key):
                        _ch.api_key = _enc_key(_ch.api_key)
                        _migrated += 1
                if _migrated > 0:
                    await _db.commit()
                    logger.info("已自动加密 %d 条明文 api_key", _migrated)
    except Exception:
        logger.warning("api_key 加密迁移跳过（API_KEY_ENCRYPTION_KEY 未配置或异常）")

    # Redis 探活
    redis = get_redis()
    pong = await redis.ping()
    if not pong:
        raise RuntimeError("Redis ping 未返回 PONG")
    logger.info("Redis 探活 OK")

    yield
    # 关闭时清理
    await engine.dispose()
    await redis.close()


app = FastAPI(title="image2", lifespan=lifespan)

# 限流：先把 limiter 挂到 app.state（slowapi 约定），再装中间件
# 装饰器在 routers/images.py 里使用，靠 limiter 共享同一实例
limiter = get_limiter()
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)


@app.exception_handler(RateLimitExceeded)
async def _rate_limit_handler(request: Request, exc: RateLimitExceeded):
    """限流命中统一返回 {"error":{"code":"rate_limited","message":...}}"""
    return JSONResponse(
        status_code=429,
        content={
            "error": {
                "code": "rate_limited",
                "message": "请求过于频繁，请稍后再试",
                "detail": str(exc.detail) if hasattr(exc, "detail") else None,
            }
        },
        headers={"Retry-After": "60"},
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def _validation_handler(request: Request, exc: RequestValidationError):
    """把 Pydantic 校验错误统一成 {"error":{"code","message"}} 形态

    具体 code 按字段命中映射；命中不了就回 invalid_request。
    """
    code = "invalid_request"
    msg = "请求参数不合法"
    for err in exc.errors():
        loc = err.get("loc", ())
        field = loc[-1] if loc else ""
        if field == "email":
            code = "email_invalid"
            msg = "邮箱格式不正确"
            break
        if field == "password":
            code = "password_weak"
            msg = "密码须 8–72 位且含字母与数字"
            break
        if field == "nickname":
            code = "nickname_invalid"
            msg = "昵称须为 1–32 字符"
            break
    return JSONResponse(
        status_code=400,
        content={"error": {"code": code, "message": msg}},
    )


app.add_middleware(AccessLogMiddleware)

app.include_router(images.router)
app.include_router(auth.router)
app.include_router(conversations.router)
app.include_router(recent_works.router)
app.include_router(works.router)
app.include_router(logs.router)
app.include_router(admin.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


async def _probe_db() -> dict[str, object]:
    started = time.perf_counter()
    try:
        engine = get_engine()
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return {"ok": True, "latency_ms": int((time.perf_counter() - started) * 1000)}
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "error": str(e),
        }


async def _probe_redis() -> dict[str, object]:
    started = time.perf_counter()
    try:
        redis = get_redis()
        pong = await redis.ping()
        if not pong:
            raise RuntimeError("Redis ping 未返回 PONG")
        return {"ok": True, "latency_ms": int((time.perf_counter() - started) * 1000)}
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "error": str(e),
        }


def _probe_asset_storage() -> dict[str, object]:
    try:
        settings = get_settings()
        if settings.asset_storage_backend != "local":
            return {"ok": True, "backend": settings.asset_storage_backend}
        root = Path(settings.generated_image_dir).resolve()
        root.mkdir(parents=True, exist_ok=True)
        return {"ok": root.is_dir(), "backend": "local", "path": str(root)}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


@app.get("/api/health/deep")
async def health_deep() -> dict[str, object]:
    db = await _probe_db()
    redis = await _probe_redis()
    asset_storage = _probe_asset_storage()
    status = "ok" if db["ok"] and redis["ok"] and asset_storage["ok"] else "degraded"
    return {
        "status": status,
        "db": db,
        "redis": redis,
        "asset_storage": asset_storage,
    }
