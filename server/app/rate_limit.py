"""限流 limiter 单例

slowapi 装饰器需要在路由文件 import 时就拿到 limiter 实例，而 main.py 又要
拿同一个实例来挂中间件。放在独立模块里，避免 main ↔ routers 循环依赖。

限流 key 策略：
- 默认 key = 客户端 IP（slowapi.util.get_remote_address）
- 鉴权后路由可传 key_func = user_id_key 改用 user.id，挡已登录用户的并发滥用
"""
from __future__ import annotations

from typing import Callable

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from .config import get_settings


def _default_key(request: Request) -> str:
    """默认按客户端 IP 限流"""
    return get_remote_address(request)


_limiter: Limiter | None = None


def get_limiter() -> Limiter:
    """全局 Limiter 单例。

    storage_uri 留空 = 进程内内存存储；多 worker 部署后改用 Redis URI 即可。
    应用级 default_limits 同步从 settings 读取。
    """
    global _limiter
    if _limiter is None:
        settings = get_settings()
        # config_filename 传一个肯定不存在的路径，避免 slowapi 内部用 starlette Config
        # 读 .env：Windows 默认 GBK 解码会被 .env 中的中文注释/特殊字节卡死
        _limiter = Limiter(
            key_func=_default_key,
            default_limits=[settings.rate_limit_global],
            config_filename="__slowapi_disable_dotenv__",
        )
    return _limiter


def user_id_key(request: Request) -> str:
    """已登录路由专用 key_func：按 user.id 限流，挡同一账号高并发。

    slowapi 中间件先于 dependency 执行，request.state.user 此时未填充，
    所以这里自己解 Authorization 头里的 JWT 拿 sub。验签失败/缺 token 都降级回 IP。
    （正式鉴权仍由 get_current_user 在路由层做，这里只是为限流取 key）
    """
    auth_header = request.headers.get("authorization") or request.headers.get("Authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()
        try:
            # 局部导入避免与 auth_service 循环依赖
            from .auth_service import decode_jwt

            payload = decode_jwt(token)
            sub = payload.get("sub")
            if sub:
                return f"user:{sub}"
        except Exception:  # noqa: BLE001
            # 无效 token：交给路由层拒，这里降级 IP 限流
            pass
    return get_remote_address(request)
