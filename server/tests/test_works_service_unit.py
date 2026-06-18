from __future__ import annotations

import unittest
from datetime import UTC, datetime
from unittest.mock import patch

from app.schemas import RecentWorkItem
from app.works_service import fetch_recent_work_items


class ExplodingDb:
    async def execute(self, _stmt):
        raise AssertionError("资产表有结果时不应回退扫描 messages")


class WorksServiceAssetPathTests(unittest.IsolatedAsyncioTestCase):
    async def test_fetch_recent_work_items_prefers_generated_assets(self):
        item = RecentWorkItem(
            message_id=42,
            conversation_id=8,
            image_url="/api/images/assets/42-0.png",
            image_count=1,
            all_image_urls=["/api/images/assets/42-0.png"],
            created_at=datetime.now(UTC),
        )

        async def fake_list_user_assets(db, user_id, *, cursor=None, limit=12):
            self.assertEqual(user_id, 7)
            self.assertIsNone(cursor)
            self.assertEqual(limit, 12)
            return [item], 42

        with patch("app.works_service.list_user_assets", side_effect=fake_list_user_assets):
            items, next_cursor = await fetch_recent_work_items(
                ExplodingDb(),  # type: ignore[arg-type]
                7,
                limit=12,
            )

        self.assertEqual(items, [item])
        self.assertEqual(next_cursor, 42)

    async def test_cursor_mode_does_not_fallback_to_message_scan(self):
        async def fake_list_user_assets(db, user_id, *, cursor=None, limit=12):
            self.assertEqual(cursor, 99)
            return [], None

        with patch("app.works_service.list_user_assets", side_effect=fake_list_user_assets):
            items, next_cursor = await fetch_recent_work_items(
                ExplodingDb(),  # type: ignore[arg-type]
                7,
                cursor=99,
                limit=12,
            )

        self.assertEqual(items, [])
        self.assertIsNone(next_cursor)
