"""SQLAlchemy 2.0 风格 ORM 模型"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.mysql import BIGINT as MyBigInt
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

UserRole = Literal["admin", "user", "paid"]
CreditReason = Literal[
    "signup_bonus",
    "recharge",
    "admin_grant",
    "generate",
    "edit",
    "refund",
    "adjust",
]
MessageRole = Literal["user", "ai"]
# AI 消息的生命周期：客户端发起生图请求后立即落 pending；后台 task 完成时改 done 或 failed
# user 消息恒为 done（无需 await 上游）
MessageStatus = Literal["done", "pending", "failed"]
GeneratedAssetStorageKind = Literal["local", "cos", "remote_legacy", "data_legacy", "missing"]
GeneratedAssetStatus = Literal["available", "missing", "quarantined"]


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("email", name="uk_users_email"),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_0900_ai_ci"},
    )

    # MySQL BIGINT UNSIGNED
    id: Mapped[int] = mapped_column(MyBigInt(unsigned=True), primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(72), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum("admin", "user", "paid", name="user_role"),
        nullable=False,
        default="user",
        server_default="user",
    )
    nickname: Mapped[str] = mapped_column(String(32), nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    credits: Mapped[int] = mapped_column(
        MyBigInt(unsigned=True), nullable=False, default=0, server_default="0"
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    disabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    # 邮箱验证完成时间；NULL 表示尚未验证（注册后不发 signup bonus，禁止 generate/edit）
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # signup bonus 发放时间；NULL 表示尚未发放（保证同一用户最多发一次）
    signup_bonus_granted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        server_onupdate=func.current_timestamp(),
    )

    credit_transactions: Mapped[list["CreditTransaction"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="raise"
    )


class CreditTransaction(Base):
    __tablename__ = "credit_transactions"
    __table_args__ = (
        Index("idx_ctx_user_time", "user_id", "created_at"),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_0900_ai_ci"},
    )

    id: Mapped[int] = mapped_column(MyBigInt(unsigned=True), primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        MyBigInt(unsigned=True),
        ForeignKey("users.id", ondelete="RESTRICT", name="fk_ctx_user"),
        nullable=False,
    )
    # delta 是有符号 BIGINT（+ 充值/赠送，- 消耗）
    delta: Mapped[int] = mapped_column(BigInteger, nullable=False)
    balance_after: Mapped[int] = mapped_column(MyBigInt(unsigned=True), nullable=False)
    reason: Mapped[CreditReason] = mapped_column(
        Enum(
            "signup_bonus", "recharge", "admin_grant",
            "generate", "edit", "refund", "adjust",
            name="credit_reason",
        ),
        nullable=False,
    )
    ref_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ref_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp()
    )

    user: Mapped[User] = relationship(back_populates="credit_transactions")


class EmailVerificationToken(Base):
    """邮箱验证 token：明文只通过邮件发出，库内只存 sha256 hash。"""

    __tablename__ = "email_verification_tokens"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uk_evt_token_hash"),
        Index("idx_evt_user_created", "user_id", "created_at"),
        Index("idx_evt_expires", "expires_at"),
        {
            "mysql_engine": "InnoDB",
            "mysql_charset": "utf8mb4",
            "mysql_collate": "utf8mb4_0900_ai_ci",
        },
    )

    id: Mapped[int] = mapped_column(MyBigInt(unsigned=True), primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        MyBigInt(unsigned=True),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_evt_user"),
        nullable=False,
    )
    # sha256(token_plain) 的小写 hex 串（64 字符）
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    purpose: Mapped[str] = mapped_column(
        Enum("verify_email", name="email_verification_purpose"),
        nullable=False,
        default="verify_email",
        server_default="verify_email",
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    # used_at IS NULL 表示未消费；任一 token 验证成功时，同一 user 其他未用 token 都置为 NOW()
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp()
    )


class AccessLog(Base):
    """HTTP 访问日志 —— 中间件自动写入"""

    __tablename__ = "access_logs"
    __table_args__ = (
        Index("idx_al_time", "created_at"),
        Index("idx_al_user_time", "user_id", "created_at"),
        Index("idx_al_path", "path", "created_at"),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_0900_ai_ci"},
    )

    id: Mapped[int] = mapped_column(MyBigInt(unsigned=True), primary_key=True, autoincrement=True)
    method: Mapped[str] = mapped_column(String(10), nullable=False)
    path: Mapped[str] = mapped_column(String(512), nullable=False)
    status_code: Mapped[int] = mapped_column(nullable=False)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_id: Mapped[int | None] = mapped_column(MyBigInt(unsigned=True), nullable=True)
    duration_ms: Mapped[int] = mapped_column(nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp()
    )


class AdminLog(Base):
    """管理员操作审计日志"""

    __tablename__ = "admin_logs"
    __table_args__ = (
        Index("idx_admlog_admin_time", "admin_id", "created_at"),
        Index("idx_admlog_target", "target_type", "target_id"),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_0900_ai_ci"},
    )

    id: Mapped[int] = mapped_column(MyBigInt(unsigned=True), primary_key=True, autoincrement=True)
    admin_id: Mapped[int] = mapped_column(MyBigInt(unsigned=True), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    target_id: Mapped[int | None] = mapped_column(MyBigInt(unsigned=True), nullable=True)
    detail: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp()
    )


class AuditLog(Base):
    """安全审计日志：记录注册、邮箱验证、积分变动等用户级安全事件。"""

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("idx_audit_event_time", "event_type", "created_at"),
        Index("idx_audit_user_time", "user_id", "created_at"),
        Index("idx_audit_ip_time", "ip", "created_at"),
        {
            "mysql_engine": "InnoDB",
            "mysql_charset": "utf8mb4",
            "mysql_collate": "utf8mb4_0900_ai_ci",
        },
    )

    id: Mapped[int] = mapped_column(MyBigInt(unsigned=True), primary_key=True, autoincrement=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    user_id: Mapped[int | None] = mapped_column(
        MyBigInt(unsigned=True),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_audit_user"),
        nullable=True,
    )
    email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    detail: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp()
    )


class UpstreamChannel(Base):
    """上游 API 渠道配置"""

    __tablename__ = "upstream_channels"
    __table_args__ = (
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_0900_ai_ci"},
    )

    id: Mapped[int] = mapped_column(MyBigInt(unsigned=True), primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    base_url: Mapped[str] = mapped_column(String(512), nullable=False)
    api_key: Mapped[str] = mapped_column(String(256), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    priority: Mapped[int] = mapped_column(nullable=False, default=0, server_default="0")
    supports_edit: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    max_concurrent: Mapped[int] = mapped_column(nullable=False, default=10, server_default="10")
    timeout_seconds: Mapped[int] = mapped_column(nullable=False, default=300, server_default="300")
    last_health_check: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_health_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    last_latency_ms: Mapped[int | None] = mapped_column(nullable=True)
    total_requests: Mapped[int] = mapped_column(MyBigInt(unsigned=True), nullable=False, default=0, server_default="0")
    total_failures: Mapped[int] = mapped_column(MyBigInt(unsigned=True), nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp()
    )


class Conversation(Base):
    """AI 对话会话 —— 一条记录对应一次完整的会话上下文"""

    __tablename__ = "conversations"
    __table_args__ = (
        Index("idx_conv_user_updated", "user_id", "updated_at"),
        Index("idx_conv_user_deleted", "user_id", "deleted_at"),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_0900_ai_ci"},
    )

    id: Mapped[int] = mapped_column(MyBigInt(unsigned=True), primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        MyBigInt(unsigned=True),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_conv_user"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(120), nullable=False, server_default="")
    pinned: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp()
    )
    # 仅由"追加消息"触发更新；重命名/置顶不会改 updated_at（避免扰乱 timeline 排序）
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp()
    )
    # 软删除时间；非空即视为已删
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.id.asc()",
        lazy="raise",
    )


class Message(Base):
    """会话内的一条消息 —— user 或 ai 各占一条；AI 出图把 url 放 image_urls"""

    __tablename__ = "messages"
    __table_args__ = (
        Index("idx_msg_conv_id", "conversation_id", "id"),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_0900_ai_ci"},
    )

    id: Mapped[int] = mapped_column(MyBigInt(unsigned=True), primary_key=True, autoincrement=True)
    conversation_id: Mapped[int] = mapped_column(
        MyBigInt(unsigned=True),
        ForeignKey("conversations.id", ondelete="CASCADE", name="fk_msg_conv"),
        nullable=False,
    )
    role: Mapped[MessageRole] = mapped_column(
        Enum("user", "ai", name="message_role"), nullable=False
    )
    # MySQL 不允许 TEXT 列带 server_default；空消息由应用层传 "" 写入
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # AI 出图：上游 CDN URL 列表；纯文本聊天为 None
    image_urls: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    # 生成参数：size / quality / model / ratio / n ... 还原 UI 用
    params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # 异步生成状态：done（落库完成）/pending（后台 task 进行中）/failed（上游异常）
    # user 消息恒为 done；AI 消息先写 pending、task 回写时 PATCH 到 done/failed
    # 用于前端刷新页面后接管轮询，避免上游响应在前端断开时丢失
    status: Mapped[str] = mapped_column(
        Enum("done", "pending", "failed", name="message_status"),
        nullable=False,
        default="done",
        server_default="done",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp()
    )

    conversation: Mapped[Conversation] = relationship(back_populates="messages")


class GeneratedAsset(Base):
    """AI 生成图片资产索引，一行对应一条 AI 消息里的一张图片。"""

    __tablename__ = "generated_assets"
    __table_args__ = (
        UniqueConstraint("message_id", "slot_index", name="uk_asset_message_slot"),
        Index("idx_asset_user_created", "user_id", "created_at", "id"),
        Index("idx_asset_user_id", "user_id", "id"),
        Index("idx_asset_status_kind", "status", "storage_kind"),
        {
            "mysql_engine": "InnoDB",
            "mysql_charset": "utf8mb4",
            "mysql_collate": "utf8mb4_0900_ai_ci",
        },
    )

    id: Mapped[int] = mapped_column(MyBigInt(unsigned=True), primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        MyBigInt(unsigned=True),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_asset_user"),
        nullable=False,
    )
    conversation_id: Mapped[int] = mapped_column(
        MyBigInt(unsigned=True),
        ForeignKey("conversations.id", ondelete="CASCADE", name="fk_asset_conv"),
        nullable=False,
    )
    message_id: Mapped[int] = mapped_column(
        MyBigInt(unsigned=True),
        ForeignKey("messages.id", ondelete="CASCADE", name="fk_asset_msg"),
        nullable=False,
    )
    slot_index: Mapped[int] = mapped_column(nullable=False)
    storage_kind: Mapped[GeneratedAssetStorageKind] = mapped_column(
        Enum(
            "local",
            "cos",
            "remote_legacy",
            "data_legacy",
            "missing",
            name="generated_asset_storage_kind",
        ),
        nullable=False,
    )
    storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    public_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    width: Mapped[int | None] = mapped_column(nullable=True)
    height: Mapped[int | None] = mapped_column(nullable=True)
    bytes: Mapped[int | None] = mapped_column(MyBigInt(unsigned=True), nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[GeneratedAssetStatus] = mapped_column(
        Enum("available", "missing", "quarantined", name="generated_asset_status"),
        nullable=False,
        default="available",
        server_default="available",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        server_onupdate=func.current_timestamp(),
    )
