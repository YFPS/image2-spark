"""客户可见文案清洗。

内部服务、环境变量和排障关键词不能直接展示给终端用户。
"""
from __future__ import annotations

from .openai_client import UpstreamError, UpstreamTimeout


INTERNAL_TEXT_MARKERS = (
    "OPENAI",
    "API_KEY",
    "BASE_URL",
    "upstream_error",
    "upstream",
    "上游",
)

GENERATION_CREDIT_UNAVAILABLE_TEXT = "失败：生成额度暂时不足，请联系管理员处理。"
GENERATION_CREDIT_REFUNDED_TEXT = "生图失败已退款：生成额度暂时不足，请联系管理员处理。"


def customer_failure_text(exc: Exception) -> str:
    if isinstance(exc, UpstreamTimeout):
        return "失败：生成服务响应超时，请稍后再试。"
    if isinstance(exc, UpstreamError):
        if exc.status == 402:
            return GENERATION_CREDIT_UNAVAILABLE_TEXT
        if exc.status in {429}:
            return "失败：生成服务繁忙，请稍后再试。"
        if exc.status in {400, 422}:
            return "失败：请求参数暂时无法处理，请调整提示词或尺寸后重试。"
        return "失败：生成服务暂时不可用，请稍后再试。"
    return "失败：任务处理异常，请稍后再试。"


def sanitize_customer_message_text(text: str, role: str | None = None) -> str:
    if role is not None and role != "ai":
        return text

    upper = text.upper()
    if text.startswith("失败：") and any(marker.upper() in upper for marker in INTERNAL_TEXT_MARKERS):
        if "402" in upper or "PAYMENT" in upper or "余额" in text or "额度" in text:
            return GENERATION_CREDIT_UNAVAILABLE_TEXT
        if "超时" in text or "TIMEOUT" in upper:
            return "失败：生成服务响应超时，请稍后再试。"
        return "失败：生成服务暂时不可用，请稍后再试。"

    sanitized = text
    sanitized = sanitized.replace("upstream_error：", "生成服务异常：")
    sanitized = sanitized.replace("upstream_error:", "生成服务异常：")
    sanitized = sanitized.replace("上游超时", "生成服务响应超时")
    sanitized = sanitized.replace("上游未返回任何图片", "生成服务未返回图片")
    sanitized = sanitized.replace("上游仅返回", "生成服务仅返回")
    sanitized = sanitized.replace("当前上游仅支持单图", "当前仅支持单图")
    sanitized = sanitized.replace("备用上游", "兼容模式")
    sanitized = sanitized.replace("上游", "生成服务")

    upper = sanitized.upper()
    if any(marker.upper() in upper for marker in ("OPENAI", "API_KEY", "BASE_URL", "KEY")):
        return "失败：生成服务暂时不可用，请稍后再试。"
    return sanitized


def sanitize_customer_note_text(text: str | None) -> str | None:
    if text is None:
        return None

    upper = text.upper()
    if text.startswith("生图失败退款"):
        if "402" in upper or "PAYMENT" in upper or "余额" in text or "额度" in text:
            return GENERATION_CREDIT_REFUNDED_TEXT
        if "超时" in text or "TIMEOUT" in upper:
            return "生图失败已退款：生成服务响应超时，请稍后再试。"
        if "未返回" in text or "DATA=[]" in upper:
            return "生图失败已退款：生成服务未返回图片。"
        if "仅返回" in text:
            return "部分图片生成失败，已退还未生成部分。"

        cleaned = sanitize_customer_message_text(text)
        if cleaned.startswith("失败："):
            return "生图失败已退款：生成服务暂时不可用，请稍后再试。"
        return cleaned.replace("生图失败退款：", "生图失败已退款：")

    return sanitize_customer_message_text(text)
