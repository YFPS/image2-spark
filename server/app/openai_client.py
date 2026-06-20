"""上游 OpenAI 兼容服务的 httpx 客户端薄封装"""
from __future__ import annotations

import asyncio
import base64
import logging
import math
import re
import secrets
import time
from typing import Any
from urllib.parse import quote, urlparse

import httpx

from .config import get_settings
from .upstream_routing import (
    load_upstream_model_targets,
    load_upstream_targets,
    prefer_auto_switch_targets_first,
)
from .upstream_monitoring import UpstreamAttempt

logger = logging.getLogger(__name__)

# 网络层（DNS / 连接 / SSL handshake / 读超时）失败时的重试次数
# 1 = 失败后再试 1 次。覆盖冷启动 DNS、SSL session 初次握手等偶发故障
_NETWORK_RETRY = 1
_NETWORK_RETRY_DELAY = 0.2  # 重试间隔（秒）


def _is_feiyu_base_url(base_url: str) -> bool:
    host = (urlparse(base_url).hostname or "").lower()
    return host == "feiyuai.icu" or host.endswith(".feiyuai.icu")


def _is_pollinations_base_url(base_url: str) -> bool:
    host = (urlparse(base_url).hostname or "").lower()
    return host in {
        "image.pollinations.ai",
        "gen.pollinations.ai",
        "pollinations.ai",
        "www.pollinations.ai",
    }


def _is_cloudflare_base_url(base_url: str) -> bool:
    return (urlparse(base_url).hostname or "").lower() == "api.cloudflare.com"


def _is_gemini_base_url(base_url: str) -> bool:
    return (urlparse(base_url).hostname or "").lower() == "generativelanguage.googleapis.com"


def _is_huggingface_base_url(base_url: str) -> bool:
    host = (urlparse(base_url).hostname or "").lower()
    return host in {"router.huggingface.co", "api-inference.huggingface.co"}


def _is_huggingface_fal_url(base_url: str) -> bool:
    parsed = urlparse(base_url)
    return (
        (parsed.hostname or "").lower() == "router.huggingface.co"
        and parsed.path.strip("/").startswith("fal-ai/")
    )


def _pollinations_prompt_base_url(base_url: str) -> str:
    host = (urlparse(base_url).hostname or "").lower()
    if host in {"gen.pollinations.ai", "pollinations.ai", "www.pollinations.ai"}:
        return "https://image.pollinations.ai"
    return base_url.rstrip("/")


def _pollinations_size_params(size: str) -> dict[str, int]:
    normalized = (size or "").strip().lower().replace("脳", "x")
    match = re.fullmatch(r"(\d{2,4})x(\d{2,4})", normalized)
    if not match:
        return {"width": 1024, "height": 1024}
    return {"width": int(match.group(1)), "height": int(match.group(2))}


def _pollinations_image_params(payload: dict[str, Any], index: int) -> dict[str, Any]:
    params: dict[str, Any] = _pollinations_size_params(str(payload.get("size") or ""))
    requested_model = str(
        payload.get("pollinations_model")
        or payload.get("provider_model")
        or ""
    ).strip()
    if not requested_model or requested_model == "gpt-image-2":
        requested_model = "flux"

    params.update(
        {
            "model": requested_model,
            "nologo": "true",
            "private": "true",
        }
    )

    seed = payload.get("seed")
    if seed not in (None, ""):
        try:
            params["seed"] = int(seed) + index
        except (TypeError, ValueError):
            params["seed"] = str(seed)
    elif index > 0:
        params["seed"] = secrets.randbelow(2_147_483_647)
    return params


def _requested_image_count(payload: dict[str, Any]) -> int:
    try:
        requested = int(payload.get("n") or 1)
    except (TypeError, ValueError):
        requested = 1
    return max(1, min(requested, 10))


def _quality_to_cloudflare_steps(quality: Any) -> int:
    value = str(quality or "").strip().lower()
    if value == "high":
        return 8
    if value == "medium":
        return 6
    return 4


def _image_item_from_b64(encoded: str, mime: str = "image/jpeg") -> dict[str, str]:
    return {"b64_json": encoded, "url": f"data:{mime};base64,{encoded}"}


def _image_item_from_bytes(body: bytes, mime: str | None = None) -> dict[str, str]:
    resolved_mime = mime or _guess_image_mime(body)
    return _image_item_from_b64(base64.b64encode(body).decode("ascii"), resolved_mime)


def _guess_image_mime(body: bytes) -> str:
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if body.startswith(b"RIFF") and body[8:12] == b"WEBP":
        return "image/webp"
    return "image/jpeg"


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


_GEMINI_ASPECT_RATIOS = (
    "1:1",
    "2:3",
    "3:2",
    "3:4",
    "4:3",
    "4:5",
    "5:4",
    "9:16",
    "16:9",
    "21:9",
)


def _ratio_value(label: str) -> float:
    left, right = label.split(":", 1)
    return int(left) / int(right)


def _gemini_aspect_ratio(size: str) -> str:
    normalized = (size or "").strip().lower().replace("脳", "x")
    match = re.fullmatch(r"(\d{2,4})x(\d{2,4})", normalized)
    if not match:
        return "1:1"
    width, height = int(match.group(1)), int(match.group(2))
    if width <= 0 or height <= 0:
        return "1:1"
    source_ratio = width / height
    return min(_GEMINI_ASPECT_RATIOS, key=lambda item: abs(source_ratio - _ratio_value(item)))


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
        if _is_pollinations_base_url(base_url) and path == "/images/generations":
            data = await _pollinations_images_generate(base_url, payload, timeout)
        elif _is_cloudflare_base_url(base_url) and path == "/images/generations":
            data = await _cloudflare_images_generate(base_url, api_key, payload, timeout)
        elif _is_gemini_base_url(base_url) and path == "/images/generations":
            data = await _gemini_images_generate(base_url, api_key, payload, timeout)
        elif _is_huggingface_base_url(base_url) and path == "/images/generations":
            data = await _huggingface_images_generate(base_url, api_key, payload, timeout)
        else:
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


def _response_error_body(r: httpx.Response) -> dict[str, Any]:
    try:
        return r.json()
    except ValueError:
        return {"raw": r.text[:500]}


def _raise_response_error(r: httpx.Response, provider: str) -> None:
    body = _response_error_body(r)
    msg = body.get("error", {}).get("message") if isinstance(body, dict) else None
    raise UpstreamError(r.status_code, msg or f"{provider} 返回 {r.status_code}", body)


async def _post_json_response_once(
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any],
    timeout: float,
    provider: str,
) -> httpx.Response:
    r = await _do_with_network_retry(
        lambda: _send_json(url, headers, payload, timeout),
        label=f"POST {url}",
    )
    if r.status_code >= 400:
        _raise_response_error(r, provider)
    return r


def _cloudflare_payload(payload: dict[str, Any], index: int) -> dict[str, Any]:
    body: dict[str, Any] = {
        "prompt": str(payload.get("prompt") or "").strip(),
        "steps": _quality_to_cloudflare_steps(payload.get("quality")),
    }
    seed = payload.get("seed")
    if seed not in (None, ""):
        try:
            body["seed"] = int(seed) + index
        except (TypeError, ValueError):
            body["seed"] = str(seed)
    elif index > 0:
        body["seed"] = secrets.randbelow(2_147_483_647)
    return body


async def _cloudflare_images_generate(
    base_url: str, api_key: str, payload: dict[str, Any], timeout: float
) -> dict[str, Any]:
    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        raise UpstreamError(400, "缺少提示词")
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    images: list[dict[str, str]] = []
    for index in range(_requested_image_count(payload)):
        r = await _post_json_response_once(
            base_url.rstrip("/"),
            headers,
            _cloudflare_payload(payload, index),
            timeout,
            "Cloudflare Workers AI",
        )
        body = r.json()
        result = body.get("result") if isinstance(body, dict) else None
        encoded = None
        if isinstance(result, dict):
            encoded = result.get("image")
        if not encoded and isinstance(body, dict):
            encoded = body.get("image")
        if not encoded:
            raise UpstreamError(502, "Cloudflare Workers AI 没有返回图片", body)
        images.append(_image_item_from_b64(str(encoded), "image/jpeg"))
    return {"model": "cloudflare-workers-ai", "data": images}


def _gemini_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "contents": [
            {
                "parts": [
                    {
                        "text": str(payload.get("prompt") or "").strip(),
                    }
                ]
            }
        ],
        "generationConfig": {
            "responseFormat": {
                "image": {
                    "aspectRatio": _gemini_aspect_ratio(str(payload.get("size") or "")),
                }
            }
        },
    }


def _extract_gemini_image_items(body: dict[str, Any]) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for candidate in body.get("candidates", []):
        content = candidate.get("content") if isinstance(candidate, dict) else None
        parts = content.get("parts", []) if isinstance(content, dict) else []
        for part in parts:
            if not isinstance(part, dict):
                continue
            inline = part.get("inlineData") or part.get("inline_data")
            if not isinstance(inline, dict):
                continue
            encoded = inline.get("data")
            if not encoded:
                continue
            mime = inline.get("mimeType") or inline.get("mime_type") or "image/png"
            items.append(_image_item_from_b64(str(encoded), str(mime)))
    return items


async def _gemini_images_generate(
    base_url: str, api_key: str, payload: dict[str, Any], timeout: float
) -> dict[str, Any]:
    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        raise UpstreamError(400, "缺少提示词")
    headers = {"x-goog-api-key": api_key, "Content-Type": "application/json"}

    images: list[dict[str, str]] = []
    for _index in range(_requested_image_count(payload)):
        r = await _post_json_response_once(
            base_url.rstrip("/"),
            headers,
            _gemini_payload(payload),
            timeout,
            "Google Gemini",
        )
        body = r.json()
        images.extend(_extract_gemini_image_items(body))
    if not images:
        raise UpstreamError(502, "Google Gemini 没有返回图片", body if "body" in locals() else {})
    return {"model": "google-gemini", "data": images}


def _huggingface_payload(payload: dict[str, Any], index: int) -> dict[str, Any]:
    params: dict[str, Any] = _pollinations_size_params(str(payload.get("size") or ""))
    seed = payload.get("seed")
    if seed not in (None, ""):
        try:
            params["seed"] = int(seed) + index
        except (TypeError, ValueError):
            params["seed"] = str(seed)
    elif index > 0:
        params["seed"] = secrets.randbelow(2_147_483_647)
    return {
        "inputs": str(payload.get("prompt") or "").strip(),
        "parameters": params,
    }


def _huggingface_fal_payload(payload: dict[str, Any], index: int) -> dict[str, Any]:
    size = _pollinations_size_params(str(payload.get("size") or ""))
    body: dict[str, Any] = {
        "prompt": str(payload.get("prompt") or "").strip(),
        "image_size": size,
    }
    seed = payload.get("seed")
    if seed not in (None, ""):
        try:
            body["seed"] = int(seed) + index
        except (TypeError, ValueError):
            body["seed"] = str(seed)
    elif index > 0:
        body["seed"] = secrets.randbelow(2_147_483_647)
    return body


async def _download_image_once(url: str, timeout: float) -> tuple[bytes, str]:
    r = await _do_with_network_retry(
        lambda: _send_binary_get(url, timeout),
        label=f"GET {url}",
    )
    if r.status_code >= 400:
        _raise_response_error(r, "图片下载")
    content_type = r.headers.get("content-type", "").split(";", 1)[0].lower()
    if not content_type.startswith("image/"):
        raise UpstreamError(
            502,
            "图片下载没有返回图片",
            {"content_type": content_type, "raw": r.text[:500]},
        )
    return r.content, content_type


async def _huggingface_images_generate(
    base_url: str, api_key: str, payload: dict[str, Any], timeout: float
) -> dict[str, Any]:
    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        raise UpstreamError(400, "缺少提示词")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "image/png",
    }

    images: list[dict[str, str]] = []
    for index in range(_requested_image_count(payload)):
        request_payload = (
            _huggingface_fal_payload(payload, index)
            if _is_huggingface_fal_url(base_url)
            else _huggingface_payload(payload, index)
        )
        r = await _post_json_response_once(
            base_url.rstrip("/"),
            headers,
            request_payload,
            timeout,
            "Hugging Face",
        )
        content_type = r.headers.get("content-type", "").split(";", 1)[0].lower()
        if content_type.startswith("image/"):
            images.append(_image_item_from_bytes(r.content, content_type))
            continue

        body = r.json()
        image_url = None
        if isinstance(body, dict):
            response_images = body.get("images")
            if isinstance(response_images, list) and response_images:
                first = response_images[0]
                if isinstance(first, dict):
                    image_url = first.get("url")
            if not image_url:
                image_url = body.get("url") or body.get("image_url")
        if not image_url:
            raise UpstreamError(
                502,
                "Hugging Face 没有返回图片",
                {"content_type": content_type, "raw": r.text[:500]},
            )
        body_bytes, downloaded_type = await _download_image_once(str(image_url), timeout)
        images.append(_image_item_from_bytes(body_bytes, downloaded_type))
    return {"model": "hugging-face", "data": images}


async def _send_binary_get(url: str, timeout: float) -> httpx.Response:
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        return await client.get(url)


async def _send_pollinations_get(
    url: str, params: dict[str, Any], timeout: float
) -> httpx.Response:
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        return await client.get(url, params=params)


async def _send_pollinations_image_once(
    base_url: str, prompt: str, params: dict[str, Any], timeout: float
) -> bytes:
    prompt_path = quote((prompt or "").strip() or "image", safe="")
    url = f"{_pollinations_prompt_base_url(base_url)}/prompt/{prompt_path}"
    r = await _do_with_network_retry(
        lambda: _send_pollinations_get(url, params, timeout),
        label=f"GET {url}",
    )
    if r.status_code >= 400:
        try:
            body = r.json()
        except ValueError:
            body = {"raw": r.text[:500]}
        msg = body.get("error", {}).get("message") if isinstance(body, dict) else None
        raise UpstreamError(r.status_code, msg or f"Pollinations 返回 {r.status_code}", body)

    content_type = r.headers.get("content-type", "").lower()
    if not content_type.startswith("image/"):
        raise UpstreamError(
            502,
            "Pollinations 没有返回图片",
            {"content_type": content_type, "raw": r.text[:500]},
        )
    return r.content


async def _pollinations_images_generate(
    base_url: str, payload: dict[str, Any], timeout: float
) -> dict[str, Any]:
    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        raise UpstreamError(400, "缺少提示词")

    images: list[dict[str, str]] = []
    for index in range(_requested_image_count(payload)):
        body = await _send_pollinations_image_once(
            base_url,
            prompt,
            _pollinations_image_params(payload, index),
            timeout,
        )
        encoded = base64.b64encode(body).decode("ascii")
        mime = _guess_image_mime(body)
        images.append(
            {
                "b64_json": encoded,
                "url": f"data:{mime};base64,{encoded}",
            }
        )

    return {"model": "pollinations", "data": images}


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
    model_id: str | None = None,
) -> dict[str, Any]:
    """调用 /images/generations，并按后台渠道配置自动切换。"""
    settings = get_settings()
    targets = (
        await load_upstream_model_targets(model_id, settings=settings)
        if model_id
        else await load_upstream_targets(settings=settings)
    )
    if not targets:
        raise UpstreamError(503, "所选模型暂无可用渠道")

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
