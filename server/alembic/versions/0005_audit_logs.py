"""audit logs

Revision ID: 0005
Revises: 0004
Create Date: 2026-06-18

新增用户级安全审计日志：
- 注册 / 验证 / 重发验证邮件
- 所有积分变动，尤其是正向获得积分
- 真实客户端 IP 与 User-Agent
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MYSQL_TABLE_KW = {
    "mysql_engine": "InnoDB",
    "mysql_charset": "utf8mb4",
    "mysql_collate": "utf8mb4_0900_ai_ci",
}


def upgrade() -> None:
    op.create_table(
        "audit_logs",
        sa.Column("id", mysql.BIGINT(unsigned=True), primary_key=True, autoincrement=True),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("user_id", mysql.BIGINT(unsigned=True), nullable=True),
        sa.Column("email", sa.String(254), nullable=True),
        sa.Column("ip", sa.String(64), nullable=True),
        sa.Column("user_agent", sa.String(255), nullable=True),
        sa.Column("detail", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_audit_user", ondelete="SET NULL"
        ),
        **MYSQL_TABLE_KW,
    )
    op.create_index("idx_audit_event_time", "audit_logs", ["event_type", "created_at"])
    op.create_index("idx_audit_user_time", "audit_logs", ["user_id", "created_at"])
    op.create_index("idx_audit_ip_time", "audit_logs", ["ip", "created_at"])


def downgrade() -> None:
    op.drop_index("idx_audit_ip_time", table_name="audit_logs")
    op.drop_index("idx_audit_user_time", table_name="audit_logs")
    op.drop_index("idx_audit_event_time", table_name="audit_logs")
    op.drop_table("audit_logs")
