"""上游 OpenAI 兼容服务的 httpx 客户端薄封装"""
from __future__ import annotations

import asyncio
import logging
import math
import re
import time
from typing import Any
from urllib.parse import urlparse

import httpx

from .config import get_settings
from .upstream_routing import load_upstream_targets, prefer_auto_switch_targets_first
from .upstream_monitoring import UpstreamAttempt

logger = logging.getLogger(__name__)

# 网络层（DNS / 连接 / SSL handshake / 读超时）失败时的重试次数
# 1 = 失败后再试 1 次。覆盖冷启动 DNS、SSL session 初次握手等偶发故障
_NETWORK_RETRY = 1
_NETWORK_RETRY_DELAY = 0.2  # 重试间隔（秒）


def _is_feiyu_base_url(base_url: str) -> bool:
    host = (urlparse(base_url).hostname or "").lower()
    return host == "feiyuai.icu" or host.endswith(".feiyuai.icu")


def _aspect_ratio_from_size(size: str) -> str | None:
    normalized = (size or "").strip().lower().replace("×", "x")
    match = re.fullmatch(r"(\d{2,4})x(\d{2,4})", normalized)
    if not match:
        return None
    width, height = int(match.group(1)), int(match.group(2))
    if width <= 0 or height <= 0:
        return None
    divisor = math.gcd(width, height)
    return f"{width // divisor}:{height // divisor}"


def _feiyu_image_fields(source: dict[str, Any]) -> dict[str, Any]:
    size = str(source.get("size") or "").strip().replace("×", "x")
    if not size or size == "auto":
        size = "1024x1024"

    fields: dict[str, Any] = {}
    for key in ("model", "prompt"):
        value = source.get(key)
        if value is not None and value != "":
            fields[key] = value

    fields["size"] = size

    quality = source.get("quality")
    if quality is not None and quality != "":
        fields["quality"] = quality

    aspect_ratio = source.get("aspect_ratio") or _aspect_ratio_from_size(size)
    if aspect_ratio:
        fields["aspect_ratio"] = aspect_ratio

    fields["response_format"] = "url"
    return fields


def _adapt_json_payload_for_upstream(
    base_url: str, path: str, payload: dict[str, Any]
) -> dict[str, Any]:
    if _is_feiyu_base_url(base_url) and path == "/images/generations":
        return _feiyu_image_fields(payload)
    return payload


def _adapt_multipart_for_upstream(
    base_url: str,
    path: str,
    fields: dict[str, Any],
    files: dict[str, tuple[str, bytes, str]] | list[tuple[str, tuple[str, bytes, str]]],
) -> tuple[
    dict[str, Any],
    dict[str, tuple[str, bytes, str]] | list[tuple[str, tuple[str, bytes, str]]],
]:
    if not (_is_feiyu_base_url(base_url) and path == "/images/edits"):
        return fields, files

    adapted_fields = _feiyu_image_fields(fields)
    if isinstance(files, dict):
        return adapted_fields, {
            name: file_payload for name, file_payload in files.items() if name == "image"
        }
    return adapted_fields, [
        (name, file_payload) for name, file_payload in files if name == "image"
    ]


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
    upstream_payload = _adapt_json_payload_for_upstream(base_url, path, payload)
    try:
        data = await _post_json_once(base_url, api_key, path, upstream_payload, timeout)
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
    upstream_fields, upstream_files = _adapt_multipart_for_upstream(
        base_url, path, fields, files
    )
    try:
        data = await _post_multipart_once(
            base_url, api_key, path, upstream_fields, upstream_files, timeout
        )
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
    """调用 /images/generations，并按后台渠道配置自动切换。"""
    settings = get_settings()
    targets = await load_upstream_targets(settings=settings)
    if not targets:
        raise UpstreamError(500, "服务端未配置可用上游渠道")

    safe_prompt = (payload.get("prompt") or "")[:200]
    logger.info(
        "upstream images.generations model=%s size=%s n=%s prompt=%s",
        payload.get("model"),
        payload.get("size"),
        payload.get("n"),
        safe_prompt,
    )

    last_err: Exception | None = None
    for index, target in enumerate(targets):
        try:
            return await _post_json_attempt(
                target.base_url,
                target.api_key,
                "/images/generations",
                payload,
                target.timeout_seconds,
                attempts=attempts,
                used_fallback=not target.is_default,
            )
        except (UpstreamError, UpstreamTimeout) as err:
            last_err = err
            if index >= len(targets) - 1 or not _should_fallback(err):
                raise
            logger.warning(
                "upstream %s failed (%s)，自动切换到下一个渠道",
                target.base_url,
                err,
            )

    if last_err is not None:
        raise last_err
    raise UpstreamError(500, "服务端未配置可用上游渠道")


async def call_images_edit(
    fields: dict[str, Any],
    files: dict[str, tuple[str, bytes, str]] | list[tuple[str, tuple[str, bytes, str]]],
    *,
    force_backup: bool = False,
    attempts: list[UpstreamAttempt] | None = None,
) -> dict[str, Any]:
    """调用 /images/edits（multipart），并按后台渠道配置自动切换。"""
    settings = get_settings()
    targets = await load_upstream_targets(require_edit=True, settings=settings)
    if force_backup:
        targets = prefer_auto_switch_targets_first(targets)
    if not targets:
        raise UpstreamError(500, "服务端未配置可用上游渠道")

    safe_prompt = (fields.get("prompt") or "")[:200]
    logger.info(
        "upstream images.edits model=%s size=%s n=%s prompt=%s",
        fields.get("model"),
        fields.get("size"),
        fields.get("n"),
        safe_prompt,
    )

    last_err: Exception | None = None
    for index, target in enumerate(targets):
        try:
            return await _post_multipart_attempt(
                target.base_url,
                target.api_key,
                "/images/edits",
                fields,
                files,
                target.timeout_seconds,
                attempts=attempts,
                used_fallback=not target.is_default,
            )
        except (UpstreamError, UpstreamTimeout) as err:
            last_err = err
            if index >= len(targets) - 1 or not _should_fallback(err):
                raise
            logger.warning(
                "upstream %s failed (%s)，自动切换到下一个渠道",
                target.base_url,
                err,
            )

    if last_err is not None:
        raise last_err
    raise UpstreamError(500, "服务端未配置可用上游渠道")
