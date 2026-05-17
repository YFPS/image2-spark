"""image2 FastAPI 主入口"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .config import get_settings
from .db import get_engine
from .redis_client import get_redis
from .routers import auth, images

logger = logging.getLogger("image2")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时强探活：DB / Redis / JWT_SECRET 任一缺失或不通，进程直接退出"""
    settings = get_settings()
    if not settings.jwt_secret:
        raise RuntimeError("JWT_SECRET 未配置，拒绝启动")

    # DB 探活
    engine = get_engine()
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    logger.info("DB 探活 OK")

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


app.include_router(images.router)
app.include_router(auth.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
