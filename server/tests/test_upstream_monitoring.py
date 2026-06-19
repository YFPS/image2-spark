from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app import openai_client
from app.openai_client import UpstreamError
from app.routers.admin import _is_upstream_health_ok
from app.upstream_monitoring import UpstreamAttempt, summarize_upstream_metrics


class UpstreamClientAttemptTests(unittest.IsolatedAsyncioTestCase):
    async def test_generate_records_primary_failure_and_backup_success_attempts(self):
        attempts: list[UpstreamAttempt] = []
        settings = SimpleNamespace(
            openai_api_key="primary-key",
            openai_base_url="https://primary.example/v1",
            openai_api_key_backup="backup-key",
            openai_base_url_backup="https://backup.example/v1",
            openai_timeout=30,
        )
        calls: list[str] = []

        async def fake_post_json_once(base_url, _api_key, _path, _payload, _timeout):
            calls.append(base_url)
            if base_url == "https://primary.example/v1":
                raise UpstreamError(500, "primary failed")
            return {"data": [{"url": "https://cdn.example/image.png"}]}

        with (
            patch("app.openai_client.get_settings", return_value=settings),
            patch("app.openai_client._post_json_once", side_effect=fake_post_json_once),
        ):
            result = await openai_client.call_images_generate({"model": "gpt-image-2"}, attempts=attempts)

        self.assertEqual(result["data"][0]["url"], "https://cdn.example/image.png")
        self.assertEqual(calls, ["https://primary.example/v1", "https://backup.example/v1"])
        self.assertEqual(len(attempts), 2)
        self.assertFalse(attempts[0].ok)
        self.assertEqual(attempts[0].status_code, 500)
        self.assertEqual(attempts[0].base_url, "https://primary.example/v1")
        self.assertFalse(attempts[0].used_fallback)
        self.assertTrue(attempts[1].ok)
        self.assertEqual(attempts[1].base_url, "https://backup.example/v1")
        self.assertTrue(attempts[1].used_fallback)


class UpstreamMetricsSummaryTests(unittest.TestCase):
    def test_summary_counts_total_recent_failures_and_p95_latency(self):
        now = datetime(2026, 6, 19, 12, 0, tzinfo=timezone.utc)
        attempts = [
            UpstreamAttempt(
                channel_id=1,
                endpoint="images.generations",
                base_url="https://primary.example/v1",
                ok=True,
                latency_ms=100,
                created_at=now - timedelta(hours=2),
            ),
            UpstreamAttempt(
                channel_id=1,
                endpoint="images.generations",
                base_url="https://primary.example/v1",
                ok=False,
                latency_ms=300,
                status_code=500,
                error_code="upstream_error",
                created_at=now - timedelta(hours=1),
            ),
            UpstreamAttempt(
                channel_id=1,
                endpoint="images.edits",
                base_url="https://primary.example/v1",
                ok=True,
                latency_ms=900,
                created_at=now - timedelta(days=3),
            ),
        ]

        metrics = summarize_upstream_metrics(
            attempts,
            now=now,
            recent_window=timedelta(days=1),
        )[1]

        self.assertEqual(metrics.total_requests, 3)
        self.assertEqual(metrics.total_failures, 1)
        self.assertEqual(metrics.failure_rate, 33.33)
        self.assertEqual(metrics.recent_requests, 2)
        self.assertEqual(metrics.recent_failures, 1)
        self.assertEqual(metrics.avg_latency_ms, 433)
        self.assertEqual(metrics.p95_latency_ms, 900)
        self.assertEqual(metrics.recent_p95_latency_ms, 300)


class UpstreamHealthCheckTests(unittest.TestCase):
    def test_health_check_treats_402_as_unhealthy(self):
        self.assertTrue(_is_upstream_health_ok(200))
        self.assertTrue(_is_upstream_health_ok(302))
        self.assertFalse(_is_upstream_health_ok(402))
        self.assertFalse(_is_upstream_health_ok(500))


if __name__ == "__main__":
    unittest.main()
