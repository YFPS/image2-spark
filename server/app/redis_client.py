"""异步 Redis 客户端单例"""
from __future__ import annotations

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
