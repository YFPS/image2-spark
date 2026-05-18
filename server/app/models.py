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
