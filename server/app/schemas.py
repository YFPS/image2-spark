"""请求/响应 Pydantic 模型"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

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
    reasoning: bool = Field(default=False, description="是否启用思考模式（gpt-image-2 reasoning）")
    view_angle: int = Field(default=0, ge=0, le=12, description="视角选项：0 自动，1-6 基础方向，7-10 为 45° 斜向，11/12 为多视角合集")
    multi_view_grid: bool = Field(default=False, description="多视图合集是否使用带间隙的多宫格布局")

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


class AnnouncementItem(BaseModel):
    id: int
    title: str
    content: str
    link_url: str | None = None
    link_label: str | None = None
    pinned: bool
    priority: int
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    updated_at: datetime


class AnnouncementListOut(BaseModel):
    items: list[AnnouncementItem]


# ===== auth-foundation =====

UserRoleT = Literal["admin", "user", "paid"]

# 至少含一个字母 + 一个数字；长度由 Pydantic 字段约束
_PASSWORD_LETTER = re.compile(r"[A-Za-z]")
_PASSWORD_DIGIT = re.compile(r"\d")


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=72)
    nickname: str | None = Field(default=None, min_length=1, max_length=32)

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if not _PASSWORD_LETTER.search(v) or not _PASSWORD_DIGIT.search(v):
            raise ValueError("密码须同时包含字母与数字")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=200)


class UserPublic(BaseModel):
    """对外暴露的用户视图（不含 password_hash）"""

    id: int
    email: str
    nickname: str
    role: UserRoleT
    avatar_url: str | None = None
    credits: int
    # 邮箱验证时间；NULL 表示尚未验证
    email_verified_at: datetime | None = None
    # 派生字段，方便前端不重复算
    verification_required: bool = False
    last_login_at: datetime | None = None
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["Bearer"] = "Bearer"
    expires_in: int  # 秒
    user: UserPublic
    # 注册接口用：邮件 provider 临时故障时仍 201，但标 false 让前端提示重发
    verification_email_sent: bool = True


class VerifyEmailRequest(BaseModel):
    """验证邮箱：明文 token 从邮件链接 query 中取出。"""

    token: str = Field(min_length=16, max_length=256)


class ResendVerificationRequest(BaseModel):
    """重发验证邮件：仅需邮箱。响应固定 ok，无论邮箱是否存在/已验证。"""

    email: EmailStr


# ===== AI 对话历史 =====

MessageRoleT = Literal["user", "ai"]
# AI 消息异步生成的状态机：pending（后台 task 进行中）/done（已落库）/failed（上游异常）
# user 消息恒为 done；该字段用于前端识别"生成中"占位、刷新后接管轮询
MessageStatusT = Literal["done", "pending", "failed"]


class MessageOut(BaseModel):
    """单条消息的对外视图"""

    id: int
    role: MessageRoleT
    text: str
    image_urls: list[str] | None = None
    params: dict[str, Any] | None = None
    status: MessageStatusT = "done"
    created_at: datetime


class ConversationListOut(BaseModel):
    """会话列表项（不含 messages，只带 preview 用于卡片渲染）"""

    id: int
    title: str
    pinned: bool
    preview: str  # 首条 user.text 前 60 字
    message_count: int
    has_pending: bool = False
    created_at: datetime
    updated_at: datetime


class ConversationDetailOut(ConversationListOut):
    """会话详情 —— 列表项 + 完整 messages"""

    messages: list[MessageOut]


class ConversationPatchIn(BaseModel):
    """PATCH 请求：重命名 / 置顶（两者均可单独使用）"""

    title: str | None = Field(default=None, min_length=1, max_length=120)
    pinned: bool | None = None


class MessageCreateIn(BaseModel):
    """追加消息请求"""

    role: MessageRoleT
    text: str = Field(default="", max_length=20000)
    image_urls: list[str] | None = None
    params: dict[str, Any] | None = None

    @field_validator("image_urls")
    @classmethod
    def _validate_urls(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        # 仅检查是否为 http(s)；不做更严格 URL 解析（中转商有时返回非标准 URL）
        for url in v:
            if not isinstance(url, str) or not url.startswith(("http://", "https://")):
                raise ValueError("image_urls 必须是 http/https URL")
        return v


# ===== 最近作品（GET /api/me/recent-works）=====


class RecentWorkItem(BaseModel):
    """一条「最近作品」记录，对应一条已完成的 AI 消息（可能多图，取首张作主图）"""

    message_id: int
    conversation_id: int
    image_url: str
    image_count: int
    all_image_urls: list[str]
    size: str | None = None
    created_at: datetime


class RecentWorksOut(BaseModel):
    items: list[RecentWorkItem]


# ===== 画廊（GET /api/me/works）=====


class WorksPage(BaseModel):
    """画廊一页响应：items 复用 RecentWorkItem 的字段；next_cursor 为下一页起点"""

    items: list[RecentWorkItem]
    next_cursor: int | None = None


# ===== 日志（GET /api/me/logs）=====

LogType = Literal[
    "signup_bonus", "recharge", "admin_grant",
    "generate", "edit", "refund", "adjust",
]


class LogRef(BaseModel):
    """日志条目的业务关联（generate / edit 才有）"""

    kind: Literal["message"]
    message_id: int
    conversation_id: int
    thumbnail_url: str | None
    prompt_preview: str | None


class LogItem(BaseModel):
    id: int
    type: LogType
    delta: int
    balance_after: int
    note: str | None
    created_at: datetime
    ref: LogRef | None = None


class LogsPage(BaseModel):
    items: list[LogItem]
    next_cursor: int | None = None
