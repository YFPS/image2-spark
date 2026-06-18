"""修复历史积分/审计异常。

默认 dry-run，只打印将要修复的项目；加 --apply 才写库。

修复项：
- failed AI message 已扣费但未全额退款
- 超过阈值仍 pending 的 AI message：置 failed 并补退款
- 已有 signup_bonus 流水但 users.signup_bonus_granted_at 为空
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import select, text, update

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from app.audit_service import apply_credit_delta, write_audit_log  # noqa: E402
from app.db import get_engine, get_session_factory  # noqa: E402
from app.models import CreditTransaction, Message, User  # noqa: E402


def _json_default(value):
    if isinstance(value, datetime):
        return value.isoformat(sep=" ")
    return str(value)


async def _failed_not_refunded(db):
    rows = await db.execute(text("""
        WITH per_msg AS (
          SELECT ref_id,
                 SUM(CASE WHEN reason IN ('generate','edit') THEN -delta ELSE 0 END) AS charged,
                 SUM(CASE WHEN reason='refund' THEN delta ELSE 0 END) AS refunded
          FROM credit_transactions
          WHERE ref_type='message' AND ref_id REGEXP '^[0-9]+$'
          GROUP BY ref_id
        )
        SELECT m.id AS message_id, c.user_id, pm.charged, pm.refunded,
               pm.charged - pm.refunded AS missing_refund
        FROM per_msg pm
        JOIN messages m ON m.id = CAST(pm.ref_id AS UNSIGNED)
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.status='failed' AND pm.charged > pm.refunded
        ORDER BY m.id
    """))
    return [dict(r) for r in rows.mappings().all()]


async def _old_pending_charged(db, older_than: datetime):
    rows = await db.execute(text("""
        WITH per_msg AS (
          SELECT ref_id,
                 SUM(CASE WHEN reason IN ('generate','edit') THEN -delta ELSE 0 END) AS charged,
                 SUM(CASE WHEN reason='refund' THEN delta ELSE 0 END) AS refunded
          FROM credit_transactions
          WHERE ref_type='message' AND ref_id REGEXP '^[0-9]+$'
          GROUP BY ref_id
        )
        SELECT m.id AS message_id, c.user_id, m.created_at,
               COALESCE(pm.charged,0) AS charged,
               COALESCE(pm.refunded,0) AS refunded,
               COALESCE(pm.charged,0) - COALESCE(pm.refunded,0) AS missing_refund
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        LEFT JOIN per_msg pm ON pm.ref_id = CAST(m.id AS CHAR)
        WHERE m.role='ai'
          AND m.status='pending'
          AND m.created_at < :older_than
          AND COALESCE(pm.charged,0) > COALESCE(pm.refunded,0)
        ORDER BY m.id
    """), {"older_than": older_than.replace(tzinfo=None)})
    return [dict(r) for r in rows.mappings().all()]


async def _missing_signup_markers(db):
    rows = await db.execute(text("""
        SELECT u.id AS user_id, MIN(ct.created_at) AS marker_at
        FROM users u
        JOIN credit_transactions ct ON ct.user_id = u.id AND ct.reason='signup_bonus'
        WHERE u.signup_bonus_granted_at IS NULL
        GROUP BY u.id
        ORDER BY u.id
    """))
    return [dict(r) for r in rows.mappings().all()]


async def _apply_failed_refund(db, row, note_prefix: str) -> None:
    await apply_credit_delta(
        db,
        user_id=int(row["user_id"]),
        delta=int(row["missing_refund"]),
        reason="refund",
        ref_type="message",
        ref_id=str(row["message_id"]),
        note=f"{note_prefix}：message {row['message_id']}",
    )


async def run(*, apply: bool, pending_hours: int) -> dict:
    get_engine.cache_clear()
    get_session_factory.cache_clear()
    factory = get_session_factory()
    now = datetime.now(tz=timezone.utc)
    older_than = now - timedelta(hours=pending_hours)
    summary = {
        "apply": apply,
        "pending_hours": pending_hours,
        "failed_not_refunded": [],
        "old_pending_charged": [],
        "missing_signup_markers": [],
    }

    try:
        async with factory() as db:
            failed_rows = await _failed_not_refunded(db)
            pending_rows = await _old_pending_charged(db, older_than)
            marker_rows = await _missing_signup_markers(db)
            summary["failed_not_refunded"] = failed_rows
            summary["old_pending_charged"] = pending_rows
            summary["missing_signup_markers"] = marker_rows

            if not apply:
                return summary

            try:
                for row in failed_rows:
                    await _apply_failed_refund(db, row, "数据修复：失败消息补退款")

                for row in pending_rows:
                    await db.execute(
                        update(Message)
                        .where(Message.id == int(row["message_id"]))
                        .values(status="failed", text="失败：历史 pending 任务由数据修复脚本关闭")
                    )
                    await _apply_failed_refund(db, row, "数据修复：历史 pending 关闭退款")

                for row in marker_rows:
                    user = (
                        await db.execute(select(User).where(User.id == int(row["user_id"])))
                    ).scalar_one()
                    user.signup_bonus_granted_at = row["marker_at"]
                    await write_audit_log(
                        db,
                        event_type="data_repair",
                        user_id=user.id,
                        email=user.email,
                        detail={
                            "field": "signup_bonus_granted_at",
                            "value": _json_default(row["marker_at"]),
                        },
                    )

                await db.commit()
            except Exception:
                await db.rollback()
                raise
    finally:
        await get_engine().dispose()

    return summary


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="实际写入数据库；默认只 dry-run")
    parser.add_argument("--pending-hours", type=int, default=24, help="pending 超过多少小时视为历史异常")
    args = parser.parse_args()
    summary = asyncio.run(run(apply=args.apply, pending_hours=args.pending_hours))
    print(json.dumps(summary, ensure_ascii=False, indent=2, default=_json_default))


if __name__ == "__main__":
    main()
