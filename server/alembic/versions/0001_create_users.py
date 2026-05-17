"""create users + credit_transactions

Revision ID: 0001
Revises:
Create Date: 2026-05-17

auth-foundation 初始 schema：
- users：邮箱+密码、角色、积分余额、封号位
- credit_transactions：追加式积分流水（含 balance_after 快照）
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MYSQL_TABLE_KW = {
    "mysql_engine": "InnoDB",
    "mysql_charset": "utf8mb4",
    "mysql_collate": "utf8mb4_0900_ai_ci",
}


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", mysql.BIGINT(unsigned=True), primary_key=True, autoincrement=True),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("password_hash", sa.String(72), nullable=False),
        sa.Column(
            "role",
            sa.Enum("admin", "user", "paid", name="user_role"),
            nullable=False,
            server_default="user",
        ),
        sa.Column("nickname", sa.String(32), nullable=False),
        sa.Column("avatar_url", sa.String(512), nullable=True),
        sa.Column("credits", mysql.BIGINT(unsigned=True), nullable=False, server_default="0"),
        sa.Column("last_login_at", sa.DateTime(), nullable=True),
        sa.Column("disabled", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint("email", name="uk_users_email"),
        **MYSQL_TABLE_KW,
    )

    op.create_table(
        "credit_transactions",
        sa.Column("id", mysql.BIGINT(unsigned=True), primary_key=True, autoincrement=True),
        sa.Column("user_id", mysql.BIGINT(unsigned=True), nullable=False),
        sa.Column("delta", sa.BigInteger(), nullable=False),
        sa.Column("balance_after", mysql.BIGINT(unsigned=True), nullable=False),
        sa.Column(
            "reason",
            sa.Enum(
                "signup_bonus", "recharge", "admin_grant",
                "generate", "edit", "refund", "adjust",
                name="credit_reason",
            ),
            nullable=False,
        ),
        sa.Column("ref_type", sa.String(32), nullable=True),
        sa.Column("ref_id", sa.String(64), nullable=True),
        sa.Column("note", sa.String(255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_ctx_user", ondelete="RESTRICT"
        ),
        **MYSQL_TABLE_KW,
    )
    op.create_index(
        "idx_ctx_user_time", "credit_transactions", ["user_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("idx_ctx_user_time", table_name="credit_transactions")
    op.drop_table("credit_transactions")
    op.drop_table("users")
