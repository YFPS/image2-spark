from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "migrate_generated_assets.py"
spec = importlib.util.spec_from_file_location("migrate_generated_assets", SCRIPT_PATH)
migration = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = migration
spec.loader.exec_module(migration)


class FakeDb:
    pass


class GeneratedAssetsMigrationTests(unittest.IsolatedAsyncioTestCase):
    def test_missing_indexed_urls_skips_existing_message_slot(self):
        urls = ["a.png", "b.png", "c.png"]

        pairs = migration.missing_indexed_urls(urls, {1})

        self.assertEqual(pairs, [(0, "a.png"), (2, "c.png")])

    async def test_migration_converts_data_url_to_asset(self):
        message = SimpleNamespace(
            id=42,
            conversation_id=8,
            conversation=SimpleNamespace(user_id=7),
            image_urls=["data:image/png;base64,aGVsbG8="],
            params={"request": {"output_format": "png"}},
        )
        calls = []

        async def fake_persist(db, **kwargs):
            calls.append(kwargs)
            return ["/api/images/assets/42-0.png"]

        with (
            patch.object(migration, "load_existing_slot_indexes", return_value=set()),
            patch.object(migration, "persist_generated_assets", side_effect=fake_persist),
        ):
            stats = await migration.migrate_message(FakeDb(), message, dry_run=False)

        self.assertEqual(stats.planned, 1)
        self.assertEqual(stats.created, 1)
        self.assertEqual(stats.skipped, 0)
        self.assertEqual(calls[0]["user_id"], 7)
        self.assertEqual(calls[0]["conversation_id"], 8)
        self.assertEqual(calls[0]["message_id"], 42)
        self.assertEqual(calls[0]["slot_indexes"], [0])
        self.assertEqual(calls[0]["urls"], ["data:image/png;base64,aGVsbG8="])

    async def test_migration_marks_known_broken_host_missing(self):
        message = SimpleNamespace(
            id=42,
            conversation_id=8,
            conversation=SimpleNamespace(user_id=7),
            image_urls=["http://67.21.86.146:3015/dead.png"],
            params={},
        )
        calls = []

        async def fake_persist(db, **kwargs):
            calls.append(kwargs)
            return []

        with (
            patch.object(migration, "load_existing_slot_indexes", return_value=set()),
            patch.object(migration, "persist_generated_assets", side_effect=fake_persist),
        ):
            stats = await migration.migrate_message(FakeDb(), message, dry_run=False)

        self.assertEqual(stats.planned, 1)
        self.assertEqual(stats.created, 1)
        self.assertEqual(stats.missing, 1)
        self.assertEqual(calls[0]["slot_indexes"], [0])

    async def test_dry_run_does_not_write_assets(self):
        message = SimpleNamespace(
            id=42,
            conversation_id=8,
            conversation=SimpleNamespace(user_id=7),
            image_urls=["data:image/png;base64,aGVsbG8="],
            params={},
        )

        with (
            patch.object(migration, "load_existing_slot_indexes", return_value=set()),
            patch.object(migration, "persist_generated_assets") as persist_mock,
        ):
            stats = await migration.migrate_message(FakeDb(), message, dry_run=True)

        self.assertEqual(stats.planned, 1)
        self.assertEqual(stats.created, 0)
        persist_mock.assert_not_called()
