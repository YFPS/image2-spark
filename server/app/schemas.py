"""请求/响应 Pydantic 模型"""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

# gpt-image-2 字段取值约束
QualityT = Literal["auto", "low", "medium", "high"]
BackgroundT = Literal["auto", "opaque"]
OutputFormatT = Literal["png", "jpeg", "webp"]
ModerationT = Literal["auto", "low"]

# 尺寸字符串：auto，或 WxH（W、H 为正整数）
_SIZE_PATTERN = re.compile(r"^(auto|\d{2,4}x\d{2,4})$")


class GenerateRequest(BaseModel):
    """前端 → 后端 generate 请求体"""

    prompt: str = Field(..., min_length=1, max_length=32000)
    model: str = "gpt-image-2"
    size: str = "auto"
    quality: QualityT = "auto"
    n: int = Field(default=1, ge=1, le=10)
    background: BackgroundT = "auto"
    output_format: OutputFormatT = "png"
    output_compression: int | None = Field(default=None, ge=0, le=100)
    moderation: ModerationT = "auto"

    @field_validator("size")
    @classmethod
    def validate_size(cls, v: str) -> str:
        # 兼容前端传来的全角 ×
        v = v.replace("×", "x")
        if not _SIZE_PATTERN.match(v):
            raise ValueError("size 必须是 'auto' 或 'WxH' 格式")
        if v != "auto":
            w_str, h_str = v.split("x")
            w, h = int(w_str), int(h_str)
            if w % 16 != 0 or h % 16 != 0:
                raise ValueError("宽高必须是 16 的倍数")
            if w > 3840 or h > 3840:
                raise ValueError("单边不能超过 3840")
            total = w * h
            if total < 655_360 or total > 8_294_400:
                raise ValueError("总像素需在 655,360 ~ 8,294,400 之间")
            ratio = max(w, h) / min(w, h)
            if ratio > 3:
                raise ValueError("宽高比不能超过 3:1")
        return v


class GenerateImage(BaseModel):
    url: str | None = None
    b64_json: str | None = None


class GenerateUsage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0


class GenerateResponse(BaseModel):
    images: list[GenerateImage]
    usage: GenerateUsage
    model: str


class ErrorDetail(BaseModel):
    code: str
    message: str
    upstream_status: int | None = None


class ErrorResponse(BaseModel):
    error: ErrorDetail


class SegmentRequest(BaseModel):
    """抠图请求：源图 url + 用户矩形（自然像素坐标）"""

    url: str = Field(..., description="源图 https URL")
    x: float = Field(..., ge=0)
    y: float = Field(..., ge=0)
    w: float = Field(..., ge=16)
    h: float = Field(..., ge=16)
    padding_factor: float = Field(default=1.0, ge=0, le=3)
