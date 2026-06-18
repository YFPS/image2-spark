"""把历史 Message.image_urls 迁移到 generated_assets。

用法：
  python scripts/migrate_generated_assets.py --batch-size 200 --dry-run
  python scripts/migrate_generated_assets.py --batch-size 200
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from app.db import get_engine, get_session_factory  # noqa: E402
from app.generated_assets_service import is_broken_source_url, persist_generated_assets  # noqa: E402
from app.models import GeneratedAsset, Message  # noqa: E402


@dataclass
class MigrationStats:
    planned: int = 0
    created: int = 0
    missing: int = 0
    skipped: int = 0
    failed: int = 0

    def add(self, other: "MigrationStats") -> None:
        self.planned += other.planned
        self.created += other.created
        self.missing += other.missing
        self.skipped += other.skipped
        self.failed += other.failed


def normalize_image_urls(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    return [u for u in raw if isinstance(u, str) and u]


def missing_indexed_urls(urls: list[str], existing_slots: set[int]) -> list[tuple[int, str]]:
    return [(idx, url) for idx, url in enumerate(urls) if idx not in existing_slots]


async def load_existing_slot_indexes(db: AsyncSession, message_id: int) -> set[int]:
    rows = (
        await db.execute(
            select(GeneratedAsset.slot_index).where(GeneratedAsset.message_id == message_id)
        )
    ).scalars().all()
    return {int(slot) for slot in rows}


async def migrate_message(
    db: AsyncSession,
    message: Message,
    *,
    dry_run: bool,
) -> MigrationStats:
    stats = MigrationStats()
    urls = normalize_image_urls(message.image_urls)
    if not urls:
        return stats

    existing_slots = await load_existing_slot_indexes(db, message.id)
    indexed_urls = missing_indexed_urls(urls, existing_slots)
    stats.skipped += len(urls) - len(indexed_urls)
    stats.planned += len(indexed_urls)
    stats.missing += sum(1 for _idx, url in indexed_urls if is_broken_source_url(url))

    if dry_run or not indexed_urls:
        return stats

    slot_indexes = [idx for idx, _url in indexed_urls]
    pending_urls = [url for _idx, url in indexed_urls]
    await persist_generated_assets(
        db,
        user_id=message.conversation.user_id,
        conversation_id=message.conversation_id,
        message_id=message.id,
        urls=pending_urls,
        output_format=_guess_output_format(message),
        slot_indexes=slot_indexes,
    )
    stats.created += len(indexed_urls)
    return stats


def _guess_output_format(message: Message) -> str:
    params = message.params if isinstance(message.params, dict) else {}
    request = params.get("request") if isinstance(params.get("request"), dict) else {}
    raw = request.get("output_format") or params.get("output_format") or "png"
    return str(raw or "png")


async def fetch_batch(
    db: AsyncSession,
    *,
    after_message_id: int,
    last_seen_id: int,
    batch_size: int,
) -> list[Message]:
    where = [
        Message.id > max(after_message_id, last_seen_id),
        Message.role == "ai",
        Message.status == "done",
        Message.image_urls.is_not(None),
    ]
    return (
        await db.execute(
            select(Message)
            .where(and_(*where))
            .order_by(Message.id.asc())
            .limit(batch_size)
        )
    ).scalars().all()


async def run_migration(*, batch_size: int, dry_run: bool, after_message_id: int) -> MigrationStats:
    factory = get_session_factory()
    total = MigrationStats()
    last_seen_id = 0

    while True:
        async with factory() as db:
            messages = await fetch_batch(
                db,
                after_message_id=after_message_id,
                last_seen_id=last_seen_id,
                batch_size=batch_size,
            )
            if not messages:
                break

            for message in messages:
                last_seen_id = int(message.id)
                try:
                    stats = await migrate_message(db, message, dry_run=dry_run)
                    total.add(stats)
                    if not dry_run:
                        await db.commit()
                except Exception:  # noqa: BLE001
                    total.failed += 1
                    await db.rollback()
                    print(f"failed message_id={message.id}", file=sys.stderr)

        print(
            "progress "
            f"last_seen={last_seen_id} planned={total.planned} created={total.created} "
            f"missing={total.missing} skipped={total.skipped} failed={total.failed}"
        )

    await get_engine().dispose()
    return total


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="迁移历史生成图片资产")
    parser.add_argument("--batch-size", type=int, default=200)
    parser.add_argument("--after-message-id", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


async def amain() -> None:
    args = parse_args()
    stats = await run_migration(
        batch_size=args.batch_size,
        dry_run=args.dry_run,
        after_message_id=args.after_message_id,
    )
    print(
        f"planned={stats.planned} created={stats.created} missing={stats.missing} "
        f"skipped={stats.skipped} failed={stats.failed}"
    )


if __name__ == "__main__":
    asyncio.run(amain())
