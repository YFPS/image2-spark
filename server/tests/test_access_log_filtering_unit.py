import unittest

from app.middleware.access_log import should_skip_access_log
from app.routers.admin import (
    IMAGE_GENERATION_ACCESS_PATHS,
    _image_generation_access_log_filter,
    dashboard,
    dau_stats,
    is_internal_access_path,
    traffic_stats,
)


class _FakeResult:
    def scalar(self):
        return 0

    def all(self):
        return []


class _FakeDb:
    def __init__(self):
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return _FakeResult()


def _access_log_sql(statements) -> list[str]:
    return [str(statement) for statement in statements if "access_logs" in str(statement)]


class AccessLogFilteringTests(unittest.TestCase):
    def test_access_log_middleware_skips_admin_and_internal_paths(self):
        skipped_paths = [
            "/api/admin/dashboard",
            "/api/admin/stats/traffic",
            "/api/admin/users",
            "/api/admin/logs/access",
            "/api/health",
            "/docs",
            "/openapi.json",
            "/redoc",
            "/static/app.js",
        ]

        for path in skipped_paths:
            with self.subTest(path=path):
                self.assertTrue(should_skip_access_log(path))

    def test_access_log_middleware_keeps_user_behavior_paths(self):
        logged_paths = [
            "/api/auth/me",
            "/api/images/generate",
            "/api/images/edit",
            "/api/conversations",
            "/api/adminish/not-admin",
        ]

        for path in logged_paths:
            with self.subTest(path=path):
                self.assertFalse(should_skip_access_log(path))

    def test_admin_stats_treat_admin_paths_as_internal_only(self):
        internal_paths = [
            "/api/admin/dashboard",
            "/api/admin/stats/dau",
            "/api/admin/stats/traffic",
            "/api/admin/logs/access",
            "/api/health",
            "/docs",
        ]
        external_paths = [
            "/api/auth/me",
            "/api/images/generate",
            "/api/images/proxy-image",
            "/api/adminish/not-admin",
        ]

        for path in internal_paths:
            with self.subTest(path=path):
                self.assertTrue(is_internal_access_path(path))

        for path in external_paths:
            with self.subTest(path=path):
                self.assertFalse(is_internal_access_path(path))


class AdminStatsFilteringTests(unittest.IsolatedAsyncioTestCase):
    def assert_filters_internal_access_paths(self, sql: str):
        self.assertIn("access_logs.path NOT IN", sql)
        self.assertIn("access_logs.path != :path_", sql)
        self.assertIn("access_logs.path NOT LIKE", sql)

    async def test_traffic_stats_queries_filter_internal_paths(self):
        db = _FakeDb()
        await traffic_stats(admin=object(), db=db)

        sql_statements = _access_log_sql(db.statements)
        self.assertEqual(len(sql_statements), 5)
        for sql in sql_statements:
            with self.subTest(sql=sql):
                self.assert_filters_internal_access_paths(sql)

    async def test_dau_stats_query_filters_internal_paths(self):
        db = _FakeDb()
        await dau_stats(admin=object(), db=db, days=30)

        sql_statements = _access_log_sql(db.statements)
        self.assertEqual(len(sql_statements), 1)
        self.assert_filters_internal_access_paths(sql_statements[0])

    async def test_dashboard_active_user_query_filters_internal_paths(self):
        db = _FakeDb()
        await dashboard(admin=object(), db=db)

        sql_statements = _access_log_sql(db.statements)
        self.assertEqual(len(sql_statements), 3)
        self.assert_filters_internal_access_paths(sql_statements[0])

    async def test_dashboard_image_count_uses_image_url_length(self):
        db = _FakeDb()
        await dashboard(admin=object(), db=db)

        sql_statements = [str(statement) for statement in db.statements if "messages" in str(statement)]
        self.assertEqual(len(sql_statements), 2)
        for sql in sql_statements:
            with self.subTest(sql=sql):
                self.assertIn("json_length", sql.lower())
                self.assertNotIn("count(messages.id)", sql.lower())

    def test_generation_request_filter_only_counts_generate_and_edit_paths(self):
        self.assertEqual(
            IMAGE_GENERATION_ACCESS_PATHS,
            ("/api/images/generate", "/api/images/edit"),
        )
        sql = str(_image_generation_access_log_filter())

        self.assertIn("access_logs.path IN", sql)


if __name__ == "__main__":
    unittest.main()
