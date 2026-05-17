"""异步 SQLAlchemy engine / session 工厂

单例 engine + sessionmaker；FastAPI 依赖 get_db 产 session 并自动提交/回滚。
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from .config import get_settings


class Base(DeclarativeBase):
    """所有 ORM 模型的基类（SQLAlchemy 2.0 风格）"""


@lru_cache
def get_engine() -> AsyncEngine:
    """单例异步 engine。pool_pre_ping 用于云数据库长连接保活"""
    settings = get_settings()
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL 未配置")
    return create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        pool_recycle=3600,  # 一小时强制回收，规避 RDS 默认 wait_timeout
        echo=False,
    )


@lru_cache
def get_session_factory() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(
        bind=get_engine(),
        expire_on_commit=False,
        autoflush=False,
    )


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI 依赖：每次请求一个 session，请求结束自动关闭"""
    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
