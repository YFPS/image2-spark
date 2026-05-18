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
from ..segment_service import fetch_image_bytes, segment_brush_mobile_sam, segment_sync

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
    upstream_model = "gpt-image-2"

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
    if req.reasoning:
        payload["reasoning"] = True
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


@router.post("/brush-cutout")
async def brush_cutout(
    image: UploadFile = File(..., description="原图（PNG/JPEG）"),
    mask: UploadFile = File(..., description="笔刷蒙版 PNG，alpha>0 = 用户涂抹"),
    subject_type: str = Form("auto", description="auto|object|text（暂未启用 text 专精）"),
) -> Response:
    """笔刷 mask → 精细抠图（MobileSAM 三路 prompt：bbox + 点 + 低分 mask）。

    返回：与原图同尺寸的 RGBA PNG，alpha 通道是 SAM 精细 mask；
    前端可直接覆盖在原图上形成 PSD 分层效果（位置不偏移）。
    """
    _ = subject_type  # 预留：将来按 text 路由到 Hi-SAM
    image_bytes = await image.read()
    mask_bytes = await mask.read()
    if not image_bytes or not mask_bytes:
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "validation_error", "message": "image 或 mask 为空"}},
        )

    try:
        png_bytes = await asyncio.to_thread(
            segment_brush_mobile_sam, image_bytes, mask_bytes
        )
    except ValueError as e:
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "validation_error", "message": str(e)}},
        )
    except Exception as e:  # noqa: BLE001
        logger.exception("brush-cutout 失败")
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
    image: list[UploadFile] = File(..., description="参考图（1~N 张）；mask 仅对齐第 1 张"),
    mask: UploadFile = File(..., description="mask PNG，alpha=0 区域将被 AI 重画（对齐 image[0]）"),
    prompt: str = Form(..., min_length=1),
    model: str = Form("gpt-image-2"),
    size: str = Form("auto"),
    quality: str = Form("low"),
    n: int = Form(1),
    background: str = Form("auto"),
) -> JSONResponse:
    """Inpainting / 多参考图编辑：image[] + mask + prompt → 上游 /v1/images/edits → 新图。

    上游 OpenAI 协议支持多张参考图（字段名 image[] 或多次 image=）；mask 仅对齐第 1 张。
    """
    # 1) 字符映射：UI 用 ×，API 要 x
    api_size = size.replace("×", "x")

    upstream_model = "gpt-image-2"

    # 3) 读 multipart 字节
    if not image:
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "validation_error", "message": "至少需要 1 张参考图"}},
        )
    image_payloads: list[tuple[str, bytes, str]] = []
    for idx, up in enumerate(image):
        b = await up.read()
        if not b:
            return JSONResponse(
                status_code=400,
                content={"error": {"code": "validation_error", "message": f"image[{idx}] 为空"}},
            )
        image_payloads.append(
            (up.filename or f"image-{idx}.png", b, up.content_type or "image/png")
        )
    mask_bytes = await mask.read()
    if not mask_bytes:
        return JSONResponse(
            status_code=400,
            content={"error": {"code": "validation_error", "message": "mask 为空"}},
        )

    # 4) 转发到上游
    fields: dict = {
        "model": upstream_model,
        "prompt": prompt,
        "size": api_size,
        "quality": quality,
        "n": str(n),
        "background": background,
    }
    # httpx 接受 list[(name, (filename, bytes, content_type))] 来发同名多段
    files: list[tuple[str, tuple[str, bytes, str]]] = [
        ("image[]", p) for p in image_payloads
    ]
    files.append((
        "mask",
        ("mask.png", mask_bytes, "image/png"),
    ))

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
