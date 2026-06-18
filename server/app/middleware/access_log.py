"""访问日志中间件 —— 记录每个请求的方法、路径、状态码、耗时、IP、用户 ID"""
from __future__ import annotations

import logging
import time
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from ..audit_service import get_client_ip
from ..auth_service import decode_jwt
from ..db import get_session_factory
from ..models import AccessLog

logger = logging.getLogger(__name__)

# 不写入访问统计的内部路径。管理后台访问不应污染真实用户访问量。
_SKIP_PATHS = {"/api/health", "/docs", "/openapi.json", "/redoc"}
_SKIP_PREFIXES = ("/api/admin", "/static")


def _matches_path_prefix(path: str, prefix: str) -> bool:
    return path == prefix or path.startswith(f"{prefix}/")


def should_skip_access_log(path: str) -> bool:
    return path in _SKIP_PATHS or any(_matches_path_prefix(path, prefix) for prefix in _SKIP_PREFIXES)


def _extract_user_id(request: Request) -> int | None:
    """从 request.state 或 Authorization 头提取 user_id（如果有）"""
    uid = getattr(request.state, "user_id", None)
    if uid:
        return uid
    auth_header = request.headers.get("authorization") or request.headers.get("Authorization")
    if not auth_header or not auth_header.lower().startswith("bearer "):
        return None
    try:
        payload = decode_jwt(auth_header[7:].strip())
        sub = payload.get("sub")
        return int(sub) if sub else None
    except Exception:  # noqa: BLE001
        return None
    return None


def _client_ip(request: Request) -> str | None:
    return get_client_ip(request)


class AccessLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path
        if should_skip_access_log(path):
            return await call_next(request)

        start = time.monotonic()
        response = await call_next(request)
        duration_ms = int((time.monotonic() - start) * 1000)

        user_id = _extract_user_id(request)

        try:
            factory = get_session_factory()
            async with factory() as db:
                db.add(AccessLog(
                    method=request.method,
                    path=path[:512],
                    status_code=response.status_code,
                    ip=_client_ip(request),
                    user_id=user_id,
                    duration_ms=duration_ms,
                ))
                await db.commit()
        except Exception:
            logger.exception("写入访问日志失败")

        return response
