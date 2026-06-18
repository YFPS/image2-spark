"""上游 OpenAI 兼容服务的 httpx 客户端薄封装"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from .config import get_settings
from .upstream_monitoring import UpstreamAttempt

logger = logging.getLogger(__name__)

# 网络层（DNS / 连接 / SSL handshake / 读超时）失败时的重试次数
# 1 = 失败后再试 1 次。覆盖冷启动 DNS、SSL session 初次握手等偶发故障
_NETWORK_RETRY = 1
_NETWORK_RETRY_DELAY = 0.2  # 重试间隔（秒）


class UpstreamError(Exception):
    """上游返回 4xx/5xx"""

    def __init__(self, status: int, message: str, body: dict | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.body = body or {}


class UpstreamTimeout(Exception):
    """上游超时"""


# 触发回退到备用上游的错误类型：5xx / 429 限流 / 401 key 失效 / 超时 / 网络层错
# 4xx 中的参数错误（400/422）不回退——参数错的请求换上游一样会失败
def _should_fallback(exc: Exception) -> bool:
    if isinstance(exc, UpstreamTimeout):
        return True
    if isinstance(exc, UpstreamError):
        return exc.status >= 500 or exc.status in {401, 408, 429}
    return False


def _attempt_error_code(exc: Exception) -> str:
    if isinstance(exc, UpstreamTimeout):
        return "timeout"
    if isinstance(exc, UpstreamError):
        if exc.status >= 500:
            return "upstream_5xx"
        if exc.status == 429:
            return "rate_limited"
        if exc.status in {401, 403}:
            return "auth_error"
        return "upstream_4xx"
    return "unexpected_error"


def _append_attempt(
    attempts: list[UpstreamAttempt] | None,
    *,
    endpoint: str,
    base_url: str,
    model: str | None,
    used_fallback: bool,
    started: float,
    ok: bool,
    status_code: int | None,
    error_code: str | None = None,
    error_message: str | None = None,
) -> None:
    if attempts is None:
        return
    attempts.append(
        UpstreamAttempt(
            endpoint=endpoint,
            base_url=base_url,
            ok=ok,
            latency_ms=int((time.monotonic() - started) * 1000),
            status_code=status_code,
            error_code=error_code,
            error_message=error_message,
            used_fallback=used_fallback,
            model=model,
        )
    )


async def _post_json_attempt(
    base_url: str,
    api_key: str,
    path: str,
    payload: dict[str, Any],
    timeout: float,
    *,
    attempts: list[UpstreamAttempt] | None,
    used_fallback: bool,
) -> dict[str, Any]:
    started = time.monotonic()
    model = str(payload.get("model") or "") or None
    endpoint = path.strip("/").replace("/", ".")
    try:
        data = await _post_json_once(base_url, api_key, path, payload, timeout)
    except (UpstreamError, UpstreamTimeout) as exc:
        _append_attempt(
            attempts,
            endpoint=endpoint,
            base_url=base_url,
            model=model,
            used_fallback=used_fallback,
            started=started,
            ok=False,
            status_code=exc.status if isinstance(exc, UpstreamError) else None,
            error_code=_attempt_error_code(exc),
            error_message=str(exc),
        )
        raise
    except Exception as exc:
        _append_attempt(
            attempts,
            endpoint=endpoint,
            base_url=base_url,
            model=model,
            used_fallback=used_fallback,
            started=started,
            ok=False,
            status_code=None,
            error_code=_attempt_error_code(exc),
            error_message=str(exc),
        )
        raise
    _append_attempt(
        attempts,
        endpoint=endpoint,
        base_url=base_url,
        model=model,
        used_fallback=used_fallback,
        started=started,
        ok=True,
        status_code=200,
    )
    return data


async def _post_multipart_attempt(
    base_url: str,
    api_key: str,
    path: str,
    fields: dict[str, Any],
    files: dict[str, tuple[str, bytes, str]] | list[tuple[str, tuple[str, bytes, str]]],
    timeout: float,
    *,
    attempts: list[UpstreamAttempt] | None,
    used_fallback: bool,
) -> dict[str, Any]:
    started = time.monotonic()
    model = str(fields.get("model") or "") or None
    endpoint = path.strip("/").replace("/", ".")
    try:
        data = await _post_multipart_once(base_url, api_key, path, fields, files, timeout)
    except (UpstreamError, UpstreamTimeout) as exc:
        _append_attempt(
            attempts,
            endpoint=endpoint,
            base_url=base_url,
            model=model,
            used_fallback=used_fallback,
            started=started,
            ok=False,
            status_code=exc.status if isinstance(exc, UpstreamError) else None,
            error_code=_attempt_error_code(exc),
            error_message=str(exc),
        )
        raise
    except Exception as exc:
        _append_attempt(
            attempts,
            endpoint=endpoint,
            base_url=base_url,
            model=model,
            used_fallback=used_fallback,
            started=started,
            ok=False,
            status_code=None,
            error_code=_attempt_error_code(exc),
            error_message=str(exc),
        )
        raise
    _append_attempt(
        attempts,
        endpoint=endpoint,
        base_url=base_url,
        model=model,
        used_fallback=used_fallback,
        started=started,
        ok=True,
        status_code=200,
    )
    return data


async def _post_json_once(
    base_url: str,
    api_key: str,
    path: str,
    payload: dict[str, Any],
    timeout: float,
) -> dict[str, Any]:
    """向单个上游发一次 JSON POST。网络层错误（HTTPError/Timeout）会重试一次，HTTP 4xx/5xx 不重试"""
    url = f"{base_url}{path}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    r = await _do_with_network_retry(
        lambda: _send_json(url, headers, payload, timeout),
        label=f"POST {url}",
    )
    if r.status_code >= 400:
        try:
            body = r.json()
        except ValueError:
            body = {"raw": r.text[:500]}
        msg = body.get("error", {}).get("message") if isinstance(body, dict) else None
        raise UpstreamError(r.status_code, msg or f"上游返回 {r.status_code}", body)

    return r.json()


async def _send_json(
    url: str, headers: dict[str, str], payload: dict[str, Any], timeout: float
) -> httpx.Response:
    async with httpx.AsyncClient(timeout=timeout) as client:
        return await client.post(url, headers=headers, json=payload)


async def _send_multipart(
    url: str,
    headers: dict[str, str],
    fields: dict[str, Any],
    files: dict[str, tuple[str, bytes, str]] | list[tuple[str, tuple[str, bytes, str]]],
    timeout: float,
) -> httpx.Response:
    async with httpx.AsyncClient(timeout=timeout) as client:
        return await client.post(url, headers=headers, data=fields, files=files)


async def _do_with_network_retry(send, label: str) -> httpx.Response:
    """在网络层（HTTPError / Timeout）失败时重试 _NETWORK_RETRY 次。HTTP 4xx/5xx 不归这里管"""
    last_exc: Exception | None = None
    for attempt in range(_NETWORK_RETRY + 1):
        try:
            return await send()
        except httpx.TimeoutException as e:
            last_exc = e
            if attempt < _NETWORK_RETRY:
                logger.warning("%s timeout, retrying #%d", label, attempt + 1)
                await asyncio.sleep(_NETWORK_RETRY_DELAY)
                continue
            raise UpstreamTimeout(str(e) or "请求超时") from e
        except httpx.HTTPError as e:
            last_exc = e
            if attempt < _NETWORK_RETRY:
                logger.warning("%s network error %s, retrying #%d", label, type(e).__name__, attempt + 1)
                await asyncio.sleep(_NETWORK_RETRY_DELAY)
                continue
            raise UpstreamError(
                502, f"上游网络错误：{type(e).__name__}: {e or '(无详情)'}"
            ) from e
    # 不应到达
    raise UpstreamError(502, f"上游网络错误：{last_exc}")


async def _post_multipart_once(
    base_url: str,
    api_key: str,
    path: str,
    fields: dict[str, Any],
    files: dict[str, tuple[str, bytes, str]] | list[tuple[str, tuple[str, bytes, str]]],
    timeout: float,
) -> dict[str, Any]:
    """向单个上游发一次 multipart POST。网络层错误会重试一次"""
    url = f"{base_url}{path}"
    headers = {"Authorization": f"Bearer {api_key}"}
    r = await _do_with_network_retry(
        lambda: _send_multipart(url, headers, fields, files, timeout),
        label=f"POST {url}",
    )
    if r.status_code >= 400:
        try:
            body = r.json()
        except ValueError:
            body = {"raw": r.text[:500]}
        msg = body.get("error", {}).get("message") if isinstance(body, dict) else None
        raise UpstreamError(r.status_code, msg or f"上游返回 {r.status_code}", body)

    return r.json()


async def call_images_generate(
    payload: dict[str, Any],
    *,
    attempts: list[UpstreamAttempt] | None = None,
) -> dict[str, Any]:
    """调上游 /images/generations，返回解析后的 JSON。主上游失败按规则回退备用上游一次"""
    settings = get_settings()
    if not settings.openai_api_key:
        raise UpstreamError(500, "服务端未配置 OPENAI_API_KEY")

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
        return await _post_json_attempt(
            settings.openai_base_url,
            settings.openai_api_key,
            "/images/generations",
            payload,
            settings.openai_timeout,
            attempts=attempts,
            used_fallback=False,
        )
    except (UpstreamError, UpstreamTimeout) as primary_err:
        backup_url = settings.openai_base_url_backup
        backup_key = settings.openai_api_key_backup
        if not (backup_url and backup_key and _should_fallback(primary_err)):
            raise
        logger.warning(
            "primary upstream failed (%s)，回退备用上游 %s",
            primary_err,
            backup_url,
        )
        return await _post_json_attempt(
            backup_url,
            backup_key,
            "/images/generations",
            payload,
            settings.openai_timeout,
            attempts=attempts,
            used_fallback=True,
        )


async def call_images_edit(
    fields: dict[str, Any],
    files: dict[str, tuple[str, bytes, str]] | list[tuple[str, tuple[str, bytes, str]]],
    *,
    force_backup: bool = False,
    attempts: list[UpstreamAttempt] | None = None,
) -> dict[str, Any]:
    """调上游 /images/edits（multipart），返回解析后的 JSON。

    - force_backup=False（默认）：主上游失败按规则回退备用上游一次。
    - force_backup=True：直接走备用上游（多图时 tabcode 不支持，自动切飞鱼）。

    files 既可是 dict（单图：{"image": ("image.png", bytes, "image/png"), "mask": (...)}），
    也可是 list[(name, (filename, bytes, content_type))]（多图：同名多段，name 用 "image"）。
    fields 是其他文本字段。
    """
    settings = get_settings()
    if not settings.openai_api_key:
        raise UpstreamError(500, "服务端未配置 OPENAI_API_KEY")

    safe_prompt = (fields.get("prompt") or "")[:200]

    if force_backup:
        backup_url = settings.openai_base_url_backup
        backup_key = settings.openai_api_key_backup
        if not (backup_url and backup_key):
            raise UpstreamError(500, "备用上游未配置（OPENAI_API_KEY_BACKUP / OPENAI_BASE_URL_BACKUP）")
        logger.info(
            "→ [备用上游] upstream images.edits model=%s size=%s n=%s prompt=%s",
            fields.get("model"),
            fields.get("size"),
            fields.get("n"),
            safe_prompt,
        )
        return await _post_multipart_attempt(
            backup_url,
            backup_key,
            "/images/edits",
            fields,
            files,
            settings.openai_timeout,
            attempts=attempts,
            used_fallback=True,
        )

    logger.info(
        "→ upstream images.edits model=%s size=%s n=%s prompt=%s",
        fields.get("model"),
        fields.get("size"),
        fields.get("n"),
        safe_prompt,
    )

    try:
        return await _post_multipart_attempt(
            settings.openai_base_url,
            settings.openai_api_key,
            "/images/edits",
            fields,
            files,
            settings.openai_timeout,
            attempts=attempts,
            used_fallback=False,
        )
    except (UpstreamError, UpstreamTimeout) as primary_err:
        backup_url = settings.openai_base_url_backup
        backup_key = settings.openai_api_key_backup
        if not (backup_url and backup_key and _should_fallback(primary_err)):
            raise
        logger.warning(
            "primary upstream failed (%s)，回退备用上游 %s",
            primary_err,
            backup_url,
        )
        return await _post_multipart_attempt(
            backup_url,
            backup_key,
            "/images/edits",
            fields,
            files,
            settings.openai_timeout,
            attempts=attempts,
            used_fallback=True,
        )
