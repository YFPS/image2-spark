"""create announcements

Revision ID: 0008
Revises: 0007
Create Date: 2026-06-20

站内公告表：前台顶部公告条读取，管理员后台维护。
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MYSQL_TABLE_KW = {
    "mysql_engine": "InnoDB",
    "mysql_charset": "utf8mb4",
    "mysql_collate": "utf8mb4_0900_ai_ci",
}


def upgrade() -> None:
    op.create_table(
        "announcements",
        sa.Column("id", mysql.BIGINT(unsigned=True), primary_key=True, autoincrement=True),
        sa.Column("title", sa.String(80), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("link_url", sa.String(512), nullable=True),
        sa.Column("link_label", sa.String(32), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("starts_at", sa.DateTime(), nullable=True),
        sa.Column("ends_at", sa.DateTime(), nullable=True),
        sa.Column("created_by", mysql.BIGINT(unsigned=True), nullable=True),
        sa.Column("updated_by", mysql.BIGINT(unsigned=True), nullable=True),
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
            server_default=sa.text("CURRENT_TIMESTAMP"),
            server_onupdate=sa.text("CURRENT_TIMESTAMP"),
        ),
        **MYSQL_TABLE_KW,
    )
    op.create_index(
        "idx_ann_active_order",
        "announcements",
        ["enabled", "pinned", "priority", "id"],
    )
    op.create_index("idx_ann_time_window", "announcements", ["starts_at", "ends_at"])


def downgrade() -> None:
    op.drop_index("idx_ann_time_window", table_name="announcements")
    op.drop_index("idx_ann_active_order", table_name="announcements")
    op.drop_table("announcements")
