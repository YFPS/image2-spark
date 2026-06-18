from __future__ import annotations

import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.main import health_deep


class FakeConnection:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def execute(self, _stmt):
        return None


class FakeEngine:
    def connect(self):
        return FakeConnection()


class FakeRedis:
    async def ping(self):
        return True


class HealthDeepTests(unittest.IsolatedAsyncioTestCase):
    async def test_deep_health_returns_ok_when_db_and_redis_available(self):
        with tempfile.TemporaryDirectory() as tmp:
            settings = SimpleNamespace(
                asset_storage_backend="local",
                generated_image_dir=tmp,
            )
            with (
                patch("app.main.get_engine", return_value=FakeEngine()),
                patch("app.main.get_redis", return_value=FakeRedis()),
                patch("app.main.get_settings", return_value=settings),
            ):
                body = await health_deep()

        self.assertEqual(body["status"], "ok")
        self.assertTrue(body["db"]["ok"])
        self.assertTrue(body["redis"]["ok"])
        self.assertTrue(body["asset_storage"]["ok"])

    async def test_deep_health_degrades_when_redis_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            settings = SimpleNamespace(
                asset_storage_backend="local",
                generated_image_dir=tmp,
            )
            with (
                patch("app.main.get_engine", return_value=FakeEngine()),
                patch("app.main.get_redis", side_effect=RuntimeError("REDIS_URL 未配置")),
                patch("app.main.get_settings", return_value=settings),
            ):
                body = await health_deep()

        self.assertEqual(body["status"], "degraded")
        self.assertTrue(body["db"]["ok"])
        self.assertFalse(body["redis"]["ok"])
        self.assertIn("REDIS_URL 未配置", body["redis"]["error"])
