"""异步 Redis 客户端单例"""
from __future__ import annotations

import hashlib
from functools import lru_cache

from redis.asyncio import Redis, from_url

from .config import get_settings


@lru_cache
def get_redis() -> Redis:
    """单例异步 Redis；FastAPI 依赖直接 Depends(get_redis)"""
    settings = get_settings()
    if not settings.redis_url:
        raise RuntimeError("REDIS_URL 未配置")
    # decode_responses=True：所有返回值按 utf-8 解码为 str
    return from_url(settings.redis_url, decode_responses=True)


# ── 二进制缓存（绕过 decode_responses 存图片） ──

_IMG_CACHE_TTL = 3600  # 1 小时
_IMG_CACHE_PREFIX = "img:"


def _img_cache_key(url: str) -> str:
    return f"{_IMG_CACHE_PREFIX}{hashlib.sha256(url.encode()).hexdigest()}"


async def cache_image_get(url: str) -> bytes | None:
    """从 Redis 获取缓存的图片 bytes。miss 返回 None"""
    r = get_redis()
    # execute_command 绕过 decode_responses
    val = await r.execute_command("GET", _img_cache_key(url))
    return val if val is None else bytes(val)


async def cache_image_set(url: str, data: bytes) -> None:
    """将图片 bytes 存入 Redis（覆盖 + 更新 TTL）"""
    r = get_redis()
    await r.execute_command("SET", _img_cache_key(url), data, "EX", _IMG_CACHE_TTL)
