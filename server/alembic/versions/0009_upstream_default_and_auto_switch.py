"""add upstream default and auto switch flags

Revision ID: 0009
Revises: 0008
Create Date: 2026-06-20

上游渠道增加唯一默认选择与自动切换开关。
"""
from __future__ import annotations

import os
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _normalize_base_url(value: str | None) -> str:
    return (value or "").strip().rstrip("/")


def upgrade() -> None:
    op.add_column(
        "upstream_channels",
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default="0"),
    )
    op.add_column(
        "upstream_channels",
        sa.Column("auto_switch_enabled", sa.Boolean(), nullable=False, server_default="0"),
    )

    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, base_url, enabled, priority FROM upstream_channels")
    ).mappings().all()
    enabled_rows = [row for row in rows if bool(row["enabled"])]
    env_base_url = _normalize_base_url(os.getenv("OPENAI_BASE_URL", ""))

    default_id = None
    if env_base_url:
        for row in enabled_rows:
            if _normalize_base_url(row["base_url"]) == env_base_url:
                default_id = row["id"]
                break
    if default_id is None and enabled_rows:
        default_id = sorted(
            enabled_rows,
            key=lambda row: (-int(row["priority"] or 0), int(row["id"])),
        )[0]["id"]

    if default_id is not None:
        conn.execute(
            sa.text("UPDATE upstream_channels SET is_default = CASE WHEN id = :id THEN 1 ELSE 0 END"),
            {"id": default_id},
        )
        conn.execute(
            sa.text(
                "UPDATE upstream_channels "
                "SET auto_switch_enabled = CASE WHEN enabled = 1 AND id <> :id THEN 1 ELSE 0 END"
            ),
            {"id": default_id},
        )


def downgrade() -> None:
    op.drop_column("upstream_channels", "auto_switch_enabled")
    op.drop_column("upstream_channels", "is_default")
