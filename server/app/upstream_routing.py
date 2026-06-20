"""上游渠道选择与故障切换规则。"""
from __future__ import annotations

import logging
from dataclasses import dataclass, replace
from typing import Iterable

from sqlalchemy import select

from .config import get_settings
from .crypto import decrypt_api_key, is_encryption_configured
from .db import get_session_factory
from .model_catalog import image_model_matches_base_url
from .upstream_channels import upstream_channel_supports_edit

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ChannelCandidate:
    id: int | None
    name: str
    base_url: str
    api_key: str
    enabled: bool
    priority: int
    supports_edit: bool
    timeout_seconds: int
    is_default: bool = False
    auto_switch_enabled: bool = False


def _normalize_base_url(base_url: str) -> str:
    return (base_url or "").strip().rstrip("/")


def _candidate_key(candidate: ChannelCandidate) -> tuple[int | None, str]:
    return candidate.id, _normalize_base_url(candidate.base_url)


def _priority_key(candidate: ChannelCandidate) -> tuple[int, int]:
    return -int(candidate.priority or 0), int(candidate.id or 0)


def order_upstream_targets(
    channels: Iterable[ChannelCandidate],
    *,
    env_base_url: str,
    require_edit: bool = False,
) -> list[ChannelCandidate]:
    """按“唯一默认 + 自动切换”规则排序可用上游。

    返回列表第一个永远是本次请求的默认上游；后续只包含打开自动切换的候选。
    """
    env_base_url = _normalize_base_url(env_base_url)
    eligible = [
        replace(channel, base_url=_normalize_base_url(channel.base_url))
        for channel in channels
        if channel.enabled
        and channel.api_key
        and _normalize_base_url(channel.base_url)
        and (not require_edit or channel.supports_edit)
    ]
    if not eligible:
        return []

    default = next((channel for channel in eligible if channel.is_default), None)
    if default is None and env_base_url:
        default = next(
            (channel for channel in eligible if channel.base_url == env_base_url),
            None,
        )
    if default is None:
        default = sorted(eligible, key=_priority_key)[0]

    default_key = _candidate_key(default)
    normalized_default = replace(default, is_default=True)
    fallbacks = [
        replace(channel, is_default=False)
        for channel in eligible
        if _candidate_key(channel) != default_key and channel.auto_switch_enabled
    ]
    fallbacks.sort(key=_priority_key)
    return [normalized_default, *fallbacks]


def order_upstream_model_targets(
    channels: Iterable[ChannelCandidate],
    model_id: str,
    *,
    require_edit: bool = False,
) -> list[ChannelCandidate]:
    """按用户选择的模型过滤候选，避免一次请求跨模型自动切换。"""
    eligible = [
        replace(channel, base_url=_normalize_base_url(channel.base_url))
        for channel in channels
        if channel.enabled
        and channel.api_key
        and _normalize_base_url(channel.base_url)
        and image_model_matches_base_url(model_id, channel.base_url)
        and (not require_edit or channel.supports_edit)
    ]
    if not eligible:
        return []

    default = next((channel for channel in eligible if channel.is_default), None)
    if default is None:
        default = sorted(eligible, key=_priority_key)[0]

    default_key = _candidate_key(default)
    normalized_default = replace(default, is_default=True)
    fallbacks = [
        replace(channel, is_default=False)
        for channel in eligible
        if _candidate_key(channel) != default_key and channel.auto_switch_enabled
    ]
    fallbacks.sort(key=_priority_key)
    return [normalized_default, *fallbacks]


def prefer_auto_switch_targets_first(
    targets: Iterable[ChannelCandidate],
) -> list[ChannelCandidate]:
    """旧的 force_backup 场景使用：有自动切换候选时先尝试候选。"""
    rows = list(targets)
    fallbacks = [target for target in rows if not target.is_default]
    defaults = [target for target in rows if target.is_default]
    return [*fallbacks, *defaults] if fallbacks else rows


def _env_candidates(settings) -> list[ChannelCandidate]:
    candidates: list[ChannelCandidate] = []
    if getattr(settings, "openai_api_key", "") and getattr(settings, "openai_base_url", ""):
        candidates.append(
            ChannelCandidate(
                id=None,
                name="env-primary",
                base_url=settings.openai_base_url,
                api_key=settings.openai_api_key,
                enabled=True,
                priority=100,
                supports_edit=upstream_channel_supports_edit(settings.openai_base_url),
                timeout_seconds=int(getattr(settings, "openai_timeout", 120)),
                is_default=True,
                auto_switch_enabled=False,
            )
        )
    if getattr(settings, "openai_api_key_backup", "") and getattr(
        settings, "openai_base_url_backup", ""
    ):
        candidates.append(
            ChannelCandidate(
                id=None,
                name="env-backup",
                base_url=settings.openai_base_url_backup,
                api_key=settings.openai_api_key_backup,
                enabled=True,
                priority=50,
                supports_edit=upstream_channel_supports_edit(
                    settings.openai_base_url_backup
                ),
                timeout_seconds=int(getattr(settings, "openai_timeout", 120)),
                is_default=False,
                auto_switch_enabled=True,
            )
        )
    return candidates


async def load_upstream_targets(
    *,
    require_edit: bool = False,
    settings=None,
) -> list[ChannelCandidate]:
    """从数据库加载上游；没有数据库配置时回退到 env 主备配置。"""
    settings = settings or get_settings()
    env_base_url = getattr(settings, "openai_base_url", "")

    if getattr(settings, "database_url", ""):
        try:
            from .models import UpstreamChannel

            factory = get_session_factory()
            async with factory() as db:
                rows = (
                    await db.execute(
                        select(UpstreamChannel).order_by(
                            UpstreamChannel.priority.desc(),
                            UpstreamChannel.id.asc(),
                        )
                    )
                ).scalars().all()
            decrypt = decrypt_api_key if is_encryption_configured() else (lambda value: value)
            candidates = [
                ChannelCandidate(
                    id=row.id,
                    name=row.name,
                    base_url=row.base_url,
                    api_key=decrypt(row.api_key),
                    enabled=row.enabled,
                    priority=row.priority,
                    supports_edit=row.supports_edit
                    and upstream_channel_supports_edit(row.base_url),
                    timeout_seconds=row.timeout_seconds,
                    is_default=bool(getattr(row, "is_default", False)),
                    auto_switch_enabled=bool(
                        getattr(row, "auto_switch_enabled", False)
                    ),
                )
                for row in rows
            ]
            targets = order_upstream_targets(
                candidates,
                env_base_url=env_base_url,
                require_edit=require_edit,
            )
            if targets:
                return targets
        except Exception:
            logger.warning("加载数据库上游渠道失败，回退到环境变量配置", exc_info=True)

    return order_upstream_targets(
        _env_candidates(settings),
        env_base_url=env_base_url,
        require_edit=require_edit,
    )


async def load_upstream_candidates(*, settings=None) -> list[ChannelCandidate]:
    """加载后台登记的所有渠道；数据库不可用时回退到 env 配置。"""
    settings = settings or get_settings()
    if getattr(settings, "database_url", ""):
        try:
            from .models import UpstreamChannel

            factory = get_session_factory()
            async with factory() as db:
                rows = (
                    await db.execute(
                        select(UpstreamChannel).order_by(
                            UpstreamChannel.priority.desc(),
                            UpstreamChannel.id.asc(),
                        )
                    )
                ).scalars().all()
            decrypt = decrypt_api_key if is_encryption_configured() else (lambda value: value)
            return [
                ChannelCandidate(
                    id=row.id,
                    name=row.name,
                    base_url=row.base_url,
                    api_key=decrypt(row.api_key),
                    enabled=row.enabled,
                    priority=row.priority,
                    supports_edit=row.supports_edit
                    and upstream_channel_supports_edit(row.base_url),
                    timeout_seconds=row.timeout_seconds,
                    is_default=bool(getattr(row, "is_default", False)),
                    auto_switch_enabled=bool(
                        getattr(row, "auto_switch_enabled", False)
                    ),
                )
                for row in rows
            ]
        except Exception:
            logger.warning("加载数据库上游渠道失败，回退到环境变量配置", exc_info=True)

    return _env_candidates(settings)


async def load_upstream_model_targets(
    model_id: str,
    *,
    require_edit: bool = False,
    settings=None,
) -> list[ChannelCandidate]:
    """加载某个模型可用的渠道；不会跨模型返回 fallback。"""
    candidates = await load_upstream_candidates(settings=settings)
    return order_upstream_model_targets(
        candidates,
        model_id,
        require_edit=require_edit,
    )
