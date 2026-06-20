"""上游渠道命名与修复工具。"""
from __future__ import annotations

from urllib.parse import urlparse

GENERIC_UPSTREAM_CHANNEL_NAMES = {"默认上游", "备用上游"}


def upstream_provider_name(base_url: str) -> str:
    """从 base_url 推导可读的服务商名称。"""
    host = (urlparse(base_url).hostname or "").lower()
    if host == "feiyuai.icu" or host.endswith(".feiyuai.icu"):
        return "飞鱼 AI"
    if host == "api2.tabcode.cc" or host.endswith(".tabcode.cc"):
        return "TabCode"
    if host == "api.openai.com":
        return "OpenAI"
    return host or "未知上游"


def upstream_channel_display_name(base_url: str, role: str = "primary") -> str:
    """生成后台渠道列表使用的默认显示名。"""
    prefix = "备用上游" if role == "backup" else "默认上游"
    return f"{prefix} · {upstream_provider_name(base_url)}"


def should_repair_upstream_channel_name(current_name: str | None, base_url: str) -> bool:
    """只有旧的通用名称才自动修复，避免覆盖管理员手动命名。"""
    if current_name in GENERIC_UPSTREAM_CHANNEL_NAMES:
        return True
    if not current_name:
        return True
    provider = upstream_provider_name(base_url)
    return current_name == provider
