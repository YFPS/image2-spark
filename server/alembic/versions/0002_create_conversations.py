"""create conversations + messages

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-18

AI 对话历史功能：
- conversations：会话头（标题、置顶、软删时间）
- messages：会话内消息流，含 AI 出图的 image_urls 与生成参数 params（JSON）
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MYSQL_TABLE_KW = {
    "mysql_engine": "InnoDB",
    "mysql_charset": "utf8mb4",
    "mysql_collate": "utf8mb4_0900_ai_ci",
}


def upgrade() -> None:
    op.create_table(
        "conversations",
        sa.Column("id", mysql.BIGINT(unsigned=True), primary_key=True, autoincrement=True),
        sa.Column("user_id", mysql.BIGINT(unsigned=True), nullable=False),
        sa.Column("title", sa.String(120), nullable=False, server_default=""),
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.text("0")),
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
        ),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_conv_user", ondelete="CASCADE"
        ),
        **MYSQL_TABLE_KW,
    )
    op.create_index("idx_conv_user_updated", "conversations", ["user_id", "updated_at"])
    op.create_index("idx_conv_user_deleted", "conversations", ["user_id", "deleted_at"])

    op.create_table(
        "messages",
        sa.Column("id", mysql.BIGINT(unsigned=True), primary_key=True, autoincrement=True),
        sa.Column("conversation_id", mysql.BIGINT(unsigned=True), nullable=False),
        sa.Column(
            "role",
            sa.Enum("user", "ai", name="message_role"),
            nullable=False,
        ),
        # MySQL 不允许 TEXT/JSON 列带 DEFAULT；应用层负责传入空串
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("image_urls", sa.JSON(), nullable=True),
        sa.Column("params", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"], ["conversations.id"], name="fk_msg_conv", ondelete="CASCADE"
        ),
        **MYSQL_TABLE_KW,
    )
    op.create_index("idx_msg_conv_id", "messages", ["conversation_id", "id"])


def downgrade() -> None:
    op.drop_index("idx_msg_conv_id", table_name="messages")
    op.drop_table("messages")
    op.drop_index("idx_conv_user_deleted", table_name="conversations")
    op.drop_index("idx_conv_user_updated", table_name="conversations")
    op.drop_table("conversations")
