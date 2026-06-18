"""create upstream request logs

Revision ID: 0007
Revises: 0006
Create Date: 2026-06-19

记录每一次真实主/备上游调用 attempt，用于聚合真实延迟、失败率和 fallback 情况。
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MYSQL_TABLE_KW = {
    "mysql_engine": "InnoDB",
    "mysql_charset": "utf8mb4",
    "mysql_collate": "utf8mb4_0900_ai_ci",
}


def upgrade() -> None:
    op.create_table(
        "upstream_request_logs",
        sa.Column("id", mysql.BIGINT(unsigned=True), primary_key=True, autoincrement=True),
        sa.Column("channel_id", mysql.BIGINT(unsigned=True), nullable=True),
        sa.Column("user_id", mysql.BIGINT(unsigned=True), nullable=True),
        sa.Column("conversation_id", mysql.BIGINT(unsigned=True), nullable=True),
        sa.Column("message_id", mysql.BIGINT(unsigned=True), nullable=True),
        sa.Column("endpoint", sa.String(64), nullable=False),
        sa.Column("base_url", sa.String(512), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("ok", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("used_fallback", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_code", sa.String(64), nullable=True),
        sa.Column("error_message", sa.String(512), nullable=True),
        sa.Column("image_count", sa.Integer(), nullable=True),
        sa.Column("model", sa.String(128), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(
            ["channel_id"], ["upstream_channels.id"], name="fk_upl_channel", ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_upl_user", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["conversation_id"], ["conversations.id"], name="fk_upl_conv", ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["message_id"], ["messages.id"], name="fk_upl_message", ondelete="SET NULL"
        ),
        **MYSQL_TABLE_KW,
    )
    op.create_index("idx_upl_channel_time", "upstream_request_logs", ["channel_id", "created_at"])
    op.create_index("idx_upl_message", "upstream_request_logs", ["message_id"])
    op.create_index("idx_upl_endpoint_time", "upstream_request_logs", ["endpoint", "created_at"])
    op.create_index("idx_upl_ok_time", "upstream_request_logs", ["ok", "created_at"])


def downgrade() -> None:
    op.drop_index("idx_upl_ok_time", table_name="upstream_request_logs")
    op.drop_index("idx_upl_endpoint_time", table_name="upstream_request_logs")
    op.drop_index("idx_upl_message", table_name="upstream_request_logs")
    op.drop_index("idx_upl_channel_time", table_name="upstream_request_logs")
    op.drop_table("upstream_request_logs")
