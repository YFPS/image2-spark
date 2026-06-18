"""admin system tables

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-17

管理后台所需表：
- access_logs：HTTP 访问日志（中间件自动写入）
- admin_logs：管理员操作审计日志
- upstream_channels：上游 API 渠道配置
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MYSQL_TABLE_KW = {
    "mysql_engine": "InnoDB",
    "mysql_charset": "utf8mb4",
    "mysql_collate": "utf8mb4_0900_ai_ci",
}


def upgrade() -> None:
    op.create_table(
        "access_logs",
        sa.Column("id", mysql.BIGINT(unsigned=True), primary_key=True, autoincrement=True),
        sa.Column("method", sa.String(10), nullable=False),
        sa.Column("path", sa.String(512), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("ip", sa.String(64), nullable=True),
        sa.Column("user_id", mysql.BIGINT(unsigned=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        **MYSQL_TABLE_KW,
    )
    op.create_index("idx_al_time", "access_logs", ["created_at"])
    op.create_index("idx_al_user_time", "access_logs", ["user_id", "created_at"])
    op.create_index("idx_al_path", "access_logs", ["path", "created_at"])

    op.create_table(
        "admin_logs",
        sa.Column("id", mysql.BIGINT(unsigned=True), primary_key=True, autoincrement=True),
        sa.Column("admin_id", mysql.BIGINT(unsigned=True), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("target_type", sa.String(32), nullable=True),
        sa.Column("target_id", mysql.BIGINT(unsigned=True), nullable=True),
        sa.Column("detail", sa.JSON(), nullable=True),
        sa.Column("ip", sa.String(64), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        **MYSQL_TABLE_KW,
    )
    op.create_index("idx_admlog_admin_time", "admin_logs", ["admin_id", "created_at"])
    op.create_index("idx_admlog_target", "admin_logs", ["target_type", "target_id"])

    op.create_table(
        "upstream_channels",
        sa.Column("id", mysql.BIGINT(unsigned=True), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("base_url", sa.String(512), nullable=False),
        sa.Column("api_key", sa.String(256), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("supports_edit", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("max_concurrent", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False, server_default="300"),
        sa.Column("last_health_check", sa.DateTime(), nullable=True),
        sa.Column("last_health_ok", sa.Boolean(), nullable=True),
        sa.Column("last_latency_ms", sa.Integer(), nullable=True),
        sa.Column("total_requests", mysql.BIGINT(unsigned=True), nullable=False, server_default="0"),
        sa.Column("total_failures", mysql.BIGINT(unsigned=True), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at", sa.DateTime(), nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
        ),
        **MYSQL_TABLE_KW,
    )


def downgrade() -> None:
    op.drop_table("upstream_channels")
    op.drop_index("idx_admlog_target", table_name="admin_logs")
    op.drop_index("idx_admlog_admin_time", table_name="admin_logs")
    op.drop_table("admin_logs")
    op.drop_index("idx_al_path", table_name="access_logs")
    op.drop_index("idx_al_user_time", table_name="access_logs")
    op.drop_index("idx_al_time", table_name="access_logs")
    op.drop_table("access_logs")
