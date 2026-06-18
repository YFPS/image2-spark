"""create generated assets

Revision ID: 0006
Revises: 0005
Create Date: 2026-06-19

新增 AI 生成图片资产索引表：
- 一行对应一条 AI 消息里的一张图片
- 作品列表按 user_id + id / created_at 走索引
- Message.image_urls 后续降级为兼容字段
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MYSQL_TABLE_KW = {
    "mysql_engine": "InnoDB",
    "mysql_charset": "utf8mb4",
    "mysql_collate": "utf8mb4_0900_ai_ci",
}


def upgrade() -> None:
    op.create_table(
        "generated_assets",
        sa.Column("id", mysql.BIGINT(unsigned=True), primary_key=True, autoincrement=True),
        sa.Column("user_id", mysql.BIGINT(unsigned=True), nullable=False),
        sa.Column("conversation_id", mysql.BIGINT(unsigned=True), nullable=False),
        sa.Column("message_id", mysql.BIGINT(unsigned=True), nullable=False),
        sa.Column("slot_index", sa.Integer(), nullable=False),
        sa.Column(
            "storage_kind",
            sa.Enum(
                "local",
                "cos",
                "remote_legacy",
                "data_legacy",
                "missing",
                name="generated_asset_storage_kind",
            ),
            nullable=False,
        ),
        sa.Column("storage_key", sa.String(length=512), nullable=True),
        sa.Column("public_url", sa.String(length=1024), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("mime_type", sa.String(length=64), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("bytes", mysql.BIGINT(unsigned=True), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column(
            "status",
            sa.Enum("available", "missing", "quarantined", name="generated_asset_status"),
            nullable=False,
            server_default="available",
        ),
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
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_asset_user", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["conversation_id"], ["conversations.id"], name="fk_asset_conv", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], name="fk_asset_msg", ondelete="CASCADE"),
        sa.UniqueConstraint("message_id", "slot_index", name="uk_asset_message_slot"),
        **MYSQL_TABLE_KW,
    )
    op.create_index("idx_asset_user_created", "generated_assets", ["user_id", "created_at", "id"])
    op.create_index("idx_asset_user_id", "generated_assets", ["user_id", "id"])
    op.create_index("idx_asset_status_kind", "generated_assets", ["status", "storage_kind"])


def downgrade() -> None:
    op.drop_index("idx_asset_status_kind", table_name="generated_assets")
    op.drop_index("idx_asset_user_id", table_name="generated_assets")
    op.drop_index("idx_asset_user_created", table_name="generated_assets")
    op.drop_table("generated_assets")
