"""管理后台请求/响应模型"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field, model_validator


# ===== 用户管理 =====

class AdminUserItem(BaseModel):
    id: int
    email: str
    nickname: str
    role: str
    credits: int
    disabled: bool
    email_verified_at: datetime | None = None
    last_login_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class AdminUserListOut(BaseModel):
    items: list[AdminUserItem]
    total: int
    page: int
    page_size: int


class AdminUserUpdate(BaseModel):
    nickname: str | None = Field(default=None, min_length=1, max_length=32)
    role: Literal["admin", "user", "paid"] | None = None
    disabled: bool | None = None
    credits: int | None = Field(default=None, ge=0)


class AdminCreditAdjust(BaseModel):
    delta: int = Field(..., description="调整积分（正数加，负数减）")
    note: str = Field(default="", max_length=255)


# ===== 公告管理 =====

class AdminAnnouncementBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=80)
    content: str = Field(..., min_length=1, max_length=500)
    link_url: str | None = Field(default=None, max_length=512)
    link_label: str | None = Field(default=None, max_length=32)
    enabled: bool = True
    pinned: bool = False
    priority: int = Field(default=0, ge=0, le=999)
    starts_at: datetime | None = None
    ends_at: datetime | None = None

    @model_validator(mode="after")
    def _validate_time_window(self) -> "AdminAnnouncementBase":
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("ends_at 必须晚于 starts_at")
        return self


class AdminAnnouncementCreate(AdminAnnouncementBase):
    pass


class AdminAnnouncementUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=80)
    content: str | None = Field(default=None, min_length=1, max_length=500)
    link_url: str | None = Field(default=None, max_length=512)
    link_label: str | None = Field(default=None, max_length=32)
    enabled: bool | None = None
    pinned: bool | None = None
    priority: int | None = Field(default=None, ge=0, le=999)
    starts_at: datetime | None = None
    ends_at: datetime | None = None

    @model_validator(mode="after")
    def _validate_time_window(self) -> "AdminAnnouncementUpdate":
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("ends_at 必须晚于 starts_at")
        return self


class AdminAnnouncementItem(BaseModel):
    id: int
    title: str
    content: str
    link_url: str | None = None
    link_label: str | None = None
    enabled: bool
    pinned: bool
    priority: int
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    created_by: int | None = None
    updated_by: int | None = None
    created_at: datetime
    updated_at: datetime


class AdminAnnouncementListOut(BaseModel):
    items: list[AdminAnnouncementItem]
    total: int
    page: int
    page_size: int


# ===== 日志 =====

class AdminAccessLogItem(BaseModel):
    id: int
    method: str
    path: str
    status_code: int
    ip: str | None = None
    user_id: int | None = None
    duration_ms: int
    created_at: datetime


class AdminAccessLogListOut(BaseModel):
    items: list[AdminAccessLogItem]
    total: int
    page: int
    page_size: int


class AdminLogItem(BaseModel):
    id: int
    admin_id: int
    action: str
    target_type: str | None = None
    target_id: int | None = None
    detail: dict[str, Any] | None = None
    ip: str | None = None
    created_at: datetime


class AdminLogListOut(BaseModel):
    items: list[AdminLogItem]
    total: int
    page: int
    page_size: int


class AdminAuditLogItem(BaseModel):
    id: int
    event_type: str
    user_id: int | None = None
    email: str | None = None
    ip: str | None = None
    user_agent: str | None = None
    detail: dict[str, Any] | None = None
    created_at: datetime


class AdminAuditLogListOut(BaseModel):
    items: list[AdminAuditLogItem]
    total: int
    page: int
    page_size: int


# ===== 统计 =====

class DAUItem(BaseModel):
    date: str
    count: int


class DashboardStats(BaseModel):
    total_users: int
    today_registrations: int
    today_active_users: int
    total_images_generated: int
    today_images_generated: int
    total_generation_requests: int
    today_generation_requests: int
    total_credits_consumed: int
    today_credits_consumed: int


class TrafficStats(BaseModel):
    total_requests: int
    today_requests: int
    avg_duration_ms: float
    error_rate: float
    top_paths: list[dict[str, Any]]


# ===== 上游渠道 =====

class UpstreamChannelItem(BaseModel):
    id: int
    name: str
    base_url: str
    api_key_masked: str
    enabled: bool
    is_default: bool
    auto_switch_enabled: bool
    priority: int
    supports_edit: bool
    max_concurrent: int
    timeout_seconds: int
    last_health_check: datetime | None = None
    last_health_ok: bool | None = None
    last_latency_ms: int | None = None
    total_requests: int
    total_failures: int
    created_at: datetime
    updated_at: datetime


class UpstreamChannelCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    base_url: str = Field(..., min_length=1, max_length=512)
    api_key: str = Field(..., min_length=1, max_length=256)
    enabled: bool = True
    auto_switch_enabled: bool = False
    priority: int = Field(default=0, ge=0)
    supports_edit: bool = True
    max_concurrent: int = Field(default=10, ge=1, le=100)
    timeout_seconds: int = Field(default=300, ge=10, le=600)


class UpstreamChannelUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    base_url: str | None = Field(default=None, min_length=1, max_length=512)
    api_key: str | None = Field(default=None, min_length=1, max_length=256)
    enabled: bool | None = None
    auto_switch_enabled: bool | None = None
    priority: int | None = Field(default=None, ge=0)
    supports_edit: bool | None = None
    max_concurrent: int | None = Field(default=None, ge=1, le=100)
    timeout_seconds: int | None = Field(default=None, ge=10, le=600)


class UpstreamHealthItem(BaseModel):
    id: int
    name: str
    base_url: str
    enabled: bool
    last_health_ok: bool | None = None
    last_latency_ms: int | None = None
    last_health_check: datetime | None = None
    total_requests: int
    total_failures: int
    failure_rate: float
    avg_latency_ms: int | None = None
    p95_latency_ms: int | None = None
    recent_requests: int = 0
    recent_failures: int = 0
    recent_failure_rate: float = 0.0
    recent_p95_latency_ms: int | None = None
