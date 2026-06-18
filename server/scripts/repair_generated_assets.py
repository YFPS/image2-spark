from __future__ import annotations

import argparse
import asyncio
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from app.asset_storage import get_asset_storage  # noqa: E402
from app.db import get_engine, get_session_factory  # noqa: E402
from app.generated_assets_repair_service import (  # noqa: E402
    AssetRepairResult,
    repair_generated_asset,
)
from app.models import GeneratedAsset, Message  # noqa: E402


@dataclass
class RepairStats:
    checked: int = 0
    repaired: int = 0
    valid: int = 0
    unavailable: int = 0
    skipped: int = 0

    def add(self, other: "RepairStats") -> None:
        self.checked += other.checked
        self.repaired += other.repaired
        self.valid += other.valid
        self.unavailable += other.unavailable
        self.skipped += other.skipped


def stats_from_results(results: Iterable[AssetRepairResult]) -> RepairStats:
    stats = RepairStats()
    for result in results:
        stats.checked += 1
        if result.status == "repaired":
            stats.repaired += 1
        elif result.status == "valid":
            stats.valid += 1
        elif result.status == "unavailable":
            stats.unavailable += 1
        elif result.status == "skipped":
            stats.skipped += 1
    return stats


async def fetch_candidates(
    db: AsyncSession,
    *,
    after_asset_id: int,
    batch_size: int,
    include_remote_legacy: bool,
) -> list[tuple[GeneratedAsset, Message]]:
    filters = [
        GeneratedAsset.id > after_asset_id,
        GeneratedAsset.source_url.is_not(None),
    ]
    repairable = [GeneratedAsset.status == "missing"]
    if include_remote_legacy:
        repairable.append(GeneratedAsset.storage_kind == "remote_legacy")
    filters.append(or_(*repairable))

    return (
        await db.execute(
            select(GeneratedAsset, Message)
            .join(Message, Message.id == GeneratedAsset.message_id)
            .where(and_(*filters))
            .order_by(GeneratedAsset.id.asc())
            .limit(batch_size)
        )
    ).all()


async def repair_rows(
    rows: list[tuple[GeneratedAsset, Message]],
    *,
    dry_run: bool,
    concurrency: int,
) -> list[AssetRepairResult]:
    storage = None if dry_run else get_asset_storage()
    sem = asyncio.Semaphore(max(1, concurrency))

    async def run_one(asset: GeneratedAsset, message: Message) -> AssetRepairResult:
        async with sem:
            return await repair_generated_asset(
                asset,
                message,
                storage=storage,
                dry_run=dry_run,
            )

    return await asyncio.gather(*(run_one(asset, message) for asset, message in rows))


async def run_repair(
    *,
    batch_size: int,
    after_asset_id: int,
    max_assets: int | None,
    dry_run: bool,
    concurrency: int,
    include_remote_legacy: bool,
) -> RepairStats:
    factory = get_session_factory()
    total = RepairStats()
    last_seen_id = after_asset_id
    remaining = max_assets

    try:
        while True:
            limit = batch_size if remaining is None else min(batch_size, remaining)
            if limit <= 0:
                break

            async with factory() as db:
                rows = await fetch_candidates(
                    db,
                    after_asset_id=last_seen_id,
                    batch_size=limit,
                    include_remote_legacy=include_remote_legacy,
                )
                if not rows:
                    break

                last_seen_id = max(int(asset.id) for asset, _message in rows)
                results = await repair_rows(rows, dry_run=dry_run, concurrency=concurrency)
                batch_stats = stats_from_results(results)
                total.add(batch_stats)
                if not dry_run:
                    await db.commit()

                for result in results:
                    print(
                        "asset "
                        f"id={result.asset_id} status={result.status} "
                        f"message_id={result.message_id} "
                        f"public_url={result.public_url or '-'} "
                        f"error={result.error or '-'}"
                    )
                print(
                    "progress "
                    f"last_asset_id={last_seen_id} checked={total.checked} "
                    f"repaired={total.repaired} valid={total.valid} "
                    f"unavailable={total.unavailable} skipped={total.skipped}"
                )

            if remaining is not None:
                remaining -= len(rows)
    finally:
        await get_engine().dispose()

    return total


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="验证并修复历史生成图片资产")
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--after-asset-id", type=int, default=0)
    parser.add_argument("--max-assets", type=int, default=None)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--skip-remote-legacy",
        action="store_true",
        help="只扫描缺失记录，不扫描仍指向旧远程地址的资产",
    )
    return parser.parse_args()


async def amain() -> None:
    args = parse_args()
    stats = await run_repair(
        batch_size=args.batch_size,
        after_asset_id=args.after_asset_id,
        max_assets=args.max_assets,
        dry_run=args.dry_run,
        concurrency=args.concurrency,
        include_remote_legacy=not args.skip_remote_legacy,
    )
    print(
        f"checked={stats.checked} repaired={stats.repaired} valid={stats.valid} "
        f"unavailable={stats.unavailable} skipped={stats.skipped}"
    )


if __name__ == "__main__":
    asyncio.run(amain())
