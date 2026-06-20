from datetime import datetime, timedelta
from types import SimpleNamespace
import unittest

from app.routers import admin


class AnnouncementRoutesTests(unittest.TestCase):
    def test_admin_exposes_announcement_crud_routes(self):
        routes = {(route.path, frozenset(route.methods or set())) for route in admin.router.routes}

        self.assertIn(("/api/admin/announcements", frozenset({"GET"})), routes)
        self.assertIn(("/api/admin/announcements", frozenset({"POST"})), routes)
        self.assertIn(("/api/admin/announcements/{announcement_id}", frozenset({"PUT"})), routes)
        self.assertIn(("/api/admin/announcements/{announcement_id}", frozenset({"DELETE"})), routes)

    def test_admin_announcement_serializer_returns_management_fields(self):
        now = datetime(2026, 6, 20, 9, 30, 0)
        row = SimpleNamespace(
            id=12,
            title="维护通知",
            content="今晚 23:00 会有一次短暂维护",
            link_url="https://example.com/status",
            link_label="查看状态",
            enabled=True,
            pinned=False,
            priority=8,
            starts_at=now,
            ends_at=now + timedelta(hours=2),
            created_by=1,
            updated_by=2,
            created_at=now,
            updated_at=now,
        )

        data = admin._to_admin_announcement_item(row)

        self.assertEqual(data["id"], 12)
        self.assertEqual(data["title"], "维护通知")
        self.assertEqual(data["content"], "今晚 23:00 会有一次短暂维护")
        self.assertEqual(data["link_label"], "查看状态")
        self.assertEqual(data["priority"], 8)
        self.assertEqual(data["created_by"], 1)

    def test_public_announcements_router_exposes_active_list_route(self):
        from app.routers import announcements

        routes = {(route.path, frozenset(route.methods or set())) for route in announcements.router.routes}

        self.assertIn(("/api/announcements", frozenset({"GET"})), routes)

    def test_public_announcements_use_local_naive_now_for_admin_time_windows(self):
        from app.routers import announcements

        now = announcements._announcement_now()

        self.assertIsNone(now.tzinfo)
        self.assertLess(abs((datetime.now() - now).total_seconds()), 5)


if __name__ == "__main__":
    unittest.main()
