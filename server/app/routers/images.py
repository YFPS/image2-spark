"""/api/images/* 路由"""
from __future__ import annotations

import logging

import asyncio

import httpx
from fastapi import APIRouter, File, Form, Query, UploadFile
from fastapi.responses import JSONResponse, Response

from ..config import get_settings
from ..openai_client import (
    UpstreamError,
    UpstreamTimeout,
    call_images_edit,
    call_images_generate,
)
from ..schemas import (
    ErrorDetail,
    ErrorResponse,
    GenerateImage,
    GenerateRequest,
    GenerateResponse,
    GenerateUsage,
    SegmentRequest,
)
from ..segment_service import fetch_image_bytes, segment_sync

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/images", tags=["images"])


@router.post(
    "/generate",
    response_model=GenerateResponse,
    responses={
        400: {"model": ErrorResponse},
        502: {"model": ErrorResponse},
        504: {"model": ErrorResponse},
    },
)
async def generate(req: GenerateRequest) -> JSONResponse:
    """文本生图代理"""
    # 中转商若有变体名（gpt-image-2-vip / -vip-4k 等），后端按 size 路由：
    #   边长 > 2048 → 走 4K 模型；否则走快速基础模型
    settings = get_settings()
    is_4k = False
    if req.size != "auto":
        try:
            w_str, h_str = req.size.split("x")
            if max(int(w_str), int(h_str)) > 2048:
                is_4k = True
        except ValueError:
            pass
    override = (
        settings.upstream_model_override_4k if is_4k else settings.upstream_model_override
    )
    upstream_model = override or req.model

    # 组装上游 payload（OpenAI 字段名）
    payload: dict = {
        "model": upstream_model,
        "prompt": req.prompt,
        "size": req.size,
        "quality": req.quality,
        "n": req.n,
        "background": req.background,
        "output_format": req.output_format,
        "moderation": req.moderation,
    }
    if req.output_format in {"jpeg", "webp"} and req.output_compression is not None:
        payload["output_compression"] = req.output_compression

    try:
        upstream_json = await call_images_generate(payload)
    except UpstreamTimeout as e:
        return JSONResponse(
            status_code=504,
            content=ErrorResponse(
                error=ErrorDetail(code="timeout", message=f"上游超时：{e}")
            ).model_dump(),
        )
    except UpstreamError as e:
        return JSONResponse(
            status_code=e.status if 400 <= e.status < 600 else 502,
            content=ErrorResponse(
                error=ErrorDetail(
                    code="upstream_error",
                    message=str(e),
                    upstream_status=e.status,
                )
            ).model_dump(),
        )

    # 解析上游返回；OpenAI 的 images 返回里每项含 url 或 b64_json
    data_list = upstream_json.get("data", []) or []
    images = [
        GenerateImage(
            url=item.get("url"),
            b64_json=item.get("b64_json"),
        )
        for item in data_list
    ]

    usage_raw = upstream_json.get("usage") or {}
    usage = GenerateUsage(
        input_tokens=int(usage_raw.get("input_tokens", 0)),
        output_tokens=int(usage_raw.get("output_tokens", 0)),
        total_tokens=int(usage_raw.get("total_tokens", 0)),
    )

    resp = GenerateResponse(
        images=images,
        usage=usage,
        model=upstream_json.get("model", req.model),
    )
    return JSONResponse(content=resp.model_dump())


@router.get("/proxy-image")
async def proxy_image(url: str = Query(..., description="上游图片 URL")) -> Response:
    """反代上游 CDN 图片，规避前端 canvas 跨域 taint。

    安全策略（开发环境）：
    - 协议必须 https
    - 上游响应 Content-Type 必须以 image/ 开头
    - 单文件上限 50 MB
    """
    if not url.startswith("https://"):
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "validation_error", "message": "仅支持 https URL"}},
        )

    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=settings.openai_timeout) as client:
            r = await client.get(url)
    except httpx.HTTPError as e:
        return JSONResponse(
            status_code=502,
            content={
                "error": {"code": "upstream_error", "message": f"拉取图片失败：{e}"}
            },
        )

    if r.status_code >= 400:
        return JSONResponse(
            status_code=r.status_code,
            content={
                "error": {
                    "code": "upstream_error",
                    "message": f"上游返回 {r.status_code}",
                    "upstream_status": r.status_code,
                }
            },
        )

    content_type = r.headers.get("Content-Type", "")
    if not content_type.startswith("image/"):
        return JSONResponse(
            status_code=400,
            content={
                "error": {
                    "code": "validation_error",
                    "message": f"非图片 Content-Type：{content_type}",
                }
            },
        )

    body = r.content
    if len(body) > 50 * 1024 * 1024:
        return JSONResponse(
            status_code=413,
            content={"error": {"code": "too_large", "message": "图片超过 50 MB"}},
        )

    return Response(
        content=body,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.post("/segment")
async def segment(req: SegmentRequest) -> Response:
    """ML 抠图：在用户矩形周围 ROI 扩展，rembg 显著性分割，紧凑 bbox 返回透明 PNG"""
    # 1) 拉源图
    try:
        img_bytes, _ct = await fetch_image_bytes(req.url)
    except ValueError as e:
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "validation_error", "message": str(e)}},
        )
    except (httpx.TimeoutException, httpx.HTTPError) as e:
        return JSONResponse(
            status_code=502,
            content={
                "error": {"code": "upstream_error", "message": f"拉取图片失败：{e}"}
            },
        )

    # 2) CPU 密集型 ML 推理放线程池，不阻塞 event loop
    try:
        png_bytes = await asyncio.to_thread(
            segment_sync,
            img_bytes,
            req.x,
            req.y,
            req.w,
            req.h,
            req.padding_factor,
        )
    except ValueError as e:
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "validation_error", "message": str(e)}},
        )
    except Exception as e:  # noqa: BLE001
        return JSONResponse(
            status_code=500,
            content={"error": {"code": "model_error", "message": f"抠图失败：{e}"}},
        )

    return Response(content=png_bytes, media_type="image/png")


@router.post(
    "/edit",
    response_model=GenerateResponse,
    responses={
        400: {"model": ErrorResponse},
        502: {"model": ErrorResponse},
        504: {"model": ErrorResponse},
    },
)
async def edit(
    image: UploadFile = File(..., description="源图（PNG/WebP），与 mask 同尺寸"),
    mask: UploadFile = File(..., description="mask PNG，alpha=0 区域将被 AI 重画"),
    prompt: str = Form(..., min_length=1),
    model: str = Form("gpt-image-2"),
    size: str = Form("auto"),
    quality: str = Form("low"),
    n: int = Form(1),
) -> JSONResponse:
    """Inpainting 编辑：image + mask + prompt → 上游 /v1/images/edits → 新图。

    复用 generate 路由的模型映射策略（按 size 自动选 vip / vip-4k）。
    """
    # 1) 字符映射：UI 用 ×，API 要 x
    api_size = size.replace("×", "x")

    # 2) 模型 override（与 generate 一致）
    settings = get_settings()
    is_4k = False
    if api_size != "auto":
        try:
            w_str, h_str = api_size.split("x")
            if max(int(w_str), int(h_str)) > 2048:
                is_4k = True
        except ValueError:
            pass
    override = (
        settings.upstream_model_override_4k if is_4k else settings.upstream_model_override
    )
    upstream_model = override or model

    # 3) 读 multipart 字节
    image_bytes = await image.read()
    mask_bytes = await mask.read()
    if not image_bytes or not mask_bytes:
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "validation_error", "message": "image 或 mask 为空"}},
        )

    # 4) 转发到上游
    fields: dict = {
        "model": upstream_model,
        "prompt": prompt,
        "size": api_size,
        "quality": quality,
        "n": str(n),
    }
    files = {
        "image": (image.filename or "image.png", image_bytes, image.content_type or "image/png"),
        "mask": (mask.filename or "mask.png", mask_bytes, mask.content_type or "image/png"),
    }

    try:
        upstream_json = await call_images_edit(fields, files)
    except UpstreamTimeout as e:
        return JSONResponse(
            status_code=504,
            content=ErrorResponse(
                error=ErrorDetail(code="timeout", message=f"上游超时：{e}")
            ).model_dump(),
        )
    except UpstreamError as e:
        return JSONResponse(
            status_code=e.status if 400 <= e.status < 600 else 502,
            content=ErrorResponse(
                error=ErrorDetail(
                    code="upstream_error",
                    message=str(e),
                    upstream_status=e.status,
                )
            ).model_dump(),
        )

    # 5) 解析返回（复用 generate 的形状）
    data_list = upstream_json.get("data", []) or []
    images = [
        GenerateImage(url=item.get("url"), b64_json=item.get("b64_json"))
        for item in data_list
    ]
    usage_raw = upstream_json.get("usage") or {}
    usage = GenerateUsage(
        input_tokens=int(usage_raw.get("input_tokens", 0)),
        output_tokens=int(usage_raw.get("output_tokens", 0)),
        total_tokens=int(usage_raw.get("total_tokens", 0)),
    )
    resp = GenerateResponse(
        images=images,
        usage=usage,
        model=upstream_json.get("model", model),
    )
    return JSONResponse(content=resp.model_dump())
