"""email verification

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-22

新增邮箱验证支持：
- users.email_verified_at / users.signup_bonus_granted_at
- email_verification_tokens 表（只存 token_hash，明文随邮件发出）
- 旧用户回填：标记为"已验证"，已发过 signup_bonus 的标 signup_bonus_granted_at
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MYSQL_TABLE_KW = {
    "mysql_engine": "InnoDB",
    "mysql_charset": "utf8mb4",
    "mysql_collate": "utf8mb4_0900_ai_ci",
}


def upgrade() -> None:
    # users 增列
    op.add_column("users", sa.Column("email_verified_at", sa.DateTime(), nullable=True))
    op.add_column("users", sa.Column("signup_bonus_granted_at", sa.DateTime(), nullable=True))

    # 邮箱验证 token 表
    op.create_table(
        "email_verification_tokens",
        sa.Column("id", mysql.BIGINT(unsigned=True), primary_key=True, autoincrement=True),
        sa.Column("user_id", mysql.BIGINT(unsigned=True), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column(
            "purpose",
            sa.Enum("verify_email", name="email_verification_purpose"),
            nullable=False,
            server_default="verify_email",
        ),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used_at", sa.DateTime(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_evt_user", ondelete="CASCADE"
        ),
        sa.UniqueConstraint("token_hash", name="uk_evt_token_hash"),
        **MYSQL_TABLE_KW,
    )
    op.create_index(
        "idx_evt_user_created", "email_verification_tokens", ["user_id", "created_at"]
    )
    op.create_index("idx_evt_expires", "email_verification_tokens", ["expires_at"])

    # 旧用户回填：默认视为已验证，避免邮件验证上线后既有用户被锁出业务接口
    op.execute(
        """
        UPDATE users
        SET email_verified_at = COALESCE(email_verified_at, created_at)
        WHERE email_verified_at IS NULL
        """
    )
    # 已经发过 signup_bonus 流水的用户，回填发放时间为账号创建时间，避免后续二次发放
    op.execute(
        """
        UPDATE users u
        SET signup_bonus_granted_at = COALESCE(signup_bonus_granted_at, u.created_at)
        WHERE signup_bonus_granted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM credit_transactions ct
            WHERE ct.user_id = u.id AND ct.reason = 'signup_bonus'
          )
        """
    )


def downgrade() -> None:
    op.drop_index("idx_evt_expires", table_name="email_verification_tokens")
    op.drop_index("idx_evt_user_created", table_name="email_verification_tokens")
    op.drop_table("email_verification_tokens")
    op.drop_column("users", "signup_bonus_granted_at")
    op.drop_column("users", "email_verified_at")
