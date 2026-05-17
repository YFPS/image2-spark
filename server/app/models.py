"""SQLAlchemy 2.0 风格 ORM 模型"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
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
