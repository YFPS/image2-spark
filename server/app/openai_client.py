"""上游 OpenAI 兼容服务的 httpx 客户端薄封装"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from .config import get_settings

logger = logging.getLogger(__name__)


class UpstreamError(Exception):
    """上游返回 4xx/5xx"""

    def __init__(self, status: int, message: str, body: dict | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.body = body or {}


class UpstreamTimeout(Exception):
    """上游超时"""


async def call_images_generate(payload: dict[str, Any]) -> dict[str, Any]:
    """调上游 /images/generations，返回解析后的 JSON"""
    settings = get_settings()
    if not settings.openai_api_key:
        raise UpstreamError(500, "服务端未配置 OPENAI_API_KEY")

    url = f"{settings.openai_base_url}/images/generations"
    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }

    # 日志截断 prompt 防长文
    safe_prompt = (payload.get("prompt") or "")[:200]
    logger.info(
        "→ upstream images.generations model=%s size=%s n=%s prompt=%s",
        payload.get("model"),
        payload.get("size"),
        payload.get("n"),
        safe_prompt,
    )

    try:
        async with httpx.AsyncClient(timeout=settings.openai_timeout) as client:
            r = await client.post(url, headers=headers, json=payload)
    except httpx.TimeoutException as e:
        raise UpstreamTimeout(str(e)) from e
    except httpx.HTTPError as e:
        raise UpstreamError(502, f"上游网络错误：{e}") from e

    if r.status_code >= 400:
        try:
            body = r.json()
        except ValueError:
            body = {"raw": r.text[:500]}
        msg = body.get("error", {}).get("message") if isinstance(body, dict) else None
        raise UpstreamError(r.status_code, msg or f"上游返回 {r.status_code}", body)

    return r.json()


async def call_images_edit(
    fields: dict[str, Any],
    files: dict[str, tuple[str, bytes, str]],
) -> dict[str, Any]:
    """调上游 /images/edits（multipart），返回解析后的 JSON。

    files 形如：{"image": ("image.png", bytes, "image/png"), "mask": (...)}
    fields 是其他文本字段。
    """
    settings = get_settings()
    if not settings.openai_api_key:
        raise UpstreamError(500, "服务端未配置 OPENAI_API_KEY")

    url = f"{settings.openai_base_url}/images/edits"
    headers = {"Authorization": f"Bearer {settings.openai_api_key}"}

    safe_prompt = (fields.get("prompt") or "")[:200]
    logger.info(
        "→ upstream images.edits model=%s size=%s n=%s prompt=%s",
        fields.get("model"),
        fields.get("size"),
        fields.get("n"),
        safe_prompt,
    )

    try:
        async with httpx.AsyncClient(timeout=settings.openai_timeout) as client:
            r = await client.post(url, headers=headers, data=fields, files=files)
    except httpx.TimeoutException as e:
        raise UpstreamTimeout(str(e)) from e
    except httpx.HTTPError as e:
        raise UpstreamError(502, f"上游网络错误：{e}") from e

    if r.status_code >= 400:
        try:
            body = r.json()
        except ValueError:
            body = {"raw": r.text[:500]}
        msg = body.get("error", {}).get("message") if isinstance(body, dict) else None
        raise UpstreamError(r.status_code, msg or f"上游返回 {r.status_code}", body)

    return r.json()
