from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app import openai_client
from app.openai_client import UpstreamError
from app.routers.admin import _is_upstream_health_ok
from app.upstream_channels import (
    GENERIC_UPSTREAM_CHANNEL_NAMES,
    upstream_channel_display_name,
)
from app.upstream_monitoring import UpstreamAttempt, summarize_upstream_metrics
from app.upstream_routing import ChannelCandidate, order_upstream_targets


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

    async def test_feiyu_generate_payload_uses_image_contract(self):
        settings = SimpleNamespace(
            openai_api_key="feiyu-key",
            openai_base_url="https://feiyuai.icu/v1",
            openai_api_key_backup="",
            openai_base_url_backup="",
            openai_timeout=30,
        )
        captured: list[dict] = []

        async def fake_post_json_once(_base_url, _api_key, _path, payload, _timeout):
            captured.append(payload)
            return {"data": [{"url": "https://cdn.example/image.png"}]}

        with (
            patch("app.openai_client.get_settings", return_value=settings),
            patch("app.openai_client._post_json_once", side_effect=fake_post_json_once),
        ):
            await openai_client.call_images_generate(
                {
                    "model": "gpt-image-2",
                    "prompt": "生成一张白底电商商品主图",
                    "size": "1536x864",
                    "quality": "low",
                    "n": 1,
                    "background": "auto",
                    "output_format": "png",
                    "moderation": "auto",
                }
            )

        self.assertEqual(
            captured[0],
            {
                "model": "gpt-image-2",
                "prompt": "生成一张白底电商商品主图",
                "size": "1536x864",
                "quality": "low",
                "aspect_ratio": "16:9",
                "response_format": "url",
            },
        )

    async def test_feiyu_edit_strips_mask_and_uses_primary_when_force_backup(self):
        settings = SimpleNamespace(
            openai_api_key="feiyu-key",
            openai_base_url="https://feiyuai.icu/v1",
            openai_api_key_backup="",
            openai_base_url_backup="",
            openai_timeout=30,
        )
        captured: list[tuple[dict, list[tuple[str, tuple[str, bytes, str]]]]] = []

        async def fake_post_multipart_once(_base_url, _api_key, _path, fields, files, _timeout):
            captured.append((fields, files))
            return {"data": [{"image_url": {"url": "https://cdn.example/edit.png"}}]}

        with (
            patch("app.openai_client.get_settings", return_value=settings),
            patch("app.openai_client._post_multipart_once", side_effect=fake_post_multipart_once),
        ):
            await openai_client.call_images_edit(
                {
                    "model": "gpt-image-2",
                    "prompt": "保留商品主体，换成高级电商背景",
                    "size": "1024x1024",
                    "quality": "medium",
                    "n": "1",
                    "background": "auto",
                },
                [
                    ("image", ("image.png", b"image", "image/png")),
                    ("mask", ("mask.png", b"mask", "image/png")),
                ],
                force_backup=True,
            )

        fields, files = captured[0]
        self.assertEqual(
            fields,
            {
                "model": "gpt-image-2",
                "prompt": "保留商品主体，换成高级电商背景",
                "size": "1024x1024",
                "quality": "medium",
                "aspect_ratio": "1:1",
                "response_format": "url",
            },
        )
        self.assertEqual([name for name, _file in files], ["image"])


class UpstreamChannelNameTests(unittest.TestCase):
    def test_display_name_distinguishes_known_providers(self):
        self.assertEqual(
            upstream_channel_display_name("https://feiyuai.icu/v1"),
            "默认上游 · 飞鱼 AI",
        )
        self.assertEqual(
            upstream_channel_display_name("https://api2.tabcode.cc/openai/draw/v1"),
            "默认上游 · TabCode",
        )

    def test_backup_display_name_keeps_provider(self):
        self.assertEqual(
            upstream_channel_display_name("https://feiyuai.icu/v1", role="backup"),
            "备用上游 · 飞鱼 AI",
        )

    def test_generic_channel_names_are_repairable(self):
        self.assertIn("默认上游", GENERIC_UPSTREAM_CHANNEL_NAMES)
        self.assertIn("备用上游", GENERIC_UPSTREAM_CHANNEL_NAMES)


class UpstreamRoutingTests(unittest.TestCase):
    def test_explicit_default_goes_first_and_auto_switch_fallback_follows(self):
        channels = [
            ChannelCandidate(
                id=1,
                name="TabCode",
                base_url="https://api2.tabcode.cc/openai/draw/v1",
                api_key="tabcode-key",
                enabled=True,
                priority=100,
                supports_edit=True,
                timeout_seconds=300,
                is_default=False,
                auto_switch_enabled=True,
            ),
            ChannelCandidate(
                id=2,
                name="Feiyu",
                base_url="https://feiyuai.icu/v1",
                api_key="feiyu-key",
                enabled=True,
                priority=80,
                supports_edit=True,
                timeout_seconds=300,
                is_default=True,
                auto_switch_enabled=False,
            ),
        ]

        targets = order_upstream_targets(channels, env_base_url="")

        self.assertEqual([target.id for target in targets], [2, 1])
        self.assertTrue(targets[0].is_default)
        self.assertFalse(targets[1].is_default)

    def test_disabled_auto_switch_channel_is_not_used_as_fallback(self):
        channels = [
            ChannelCandidate(
                id=1,
                name="Primary",
                base_url="https://primary.example/v1",
                api_key="primary-key",
                enabled=True,
                priority=10,
                supports_edit=True,
                timeout_seconds=300,
                is_default=True,
                auto_switch_enabled=False,
            ),
            ChannelCandidate(
                id=2,
                name="Fallback off",
                base_url="https://fallback.example/v1",
                api_key="fallback-key",
                enabled=True,
                priority=99,
                supports_edit=True,
                timeout_seconds=300,
                is_default=False,
                auto_switch_enabled=False,
            ),
        ]

        targets = order_upstream_targets(channels, env_base_url="")

        self.assertEqual([target.id for target in targets], [1])

    def test_env_matching_channel_becomes_default_when_no_flag_exists(self):
        channels = [
            ChannelCandidate(
                id=1,
                name="High priority",
                base_url="https://high.example/v1",
                api_key="high-key",
                enabled=True,
                priority=100,
                supports_edit=True,
                timeout_seconds=300,
                is_default=False,
                auto_switch_enabled=True,
            ),
            ChannelCandidate(
                id=2,
                name="Env match",
                base_url="https://feiyuai.icu/v1",
                api_key="feiyu-key",
                enabled=True,
                priority=1,
                supports_edit=True,
                timeout_seconds=300,
                is_default=False,
                auto_switch_enabled=False,
            ),
        ]

        targets = order_upstream_targets(
            channels,
            env_base_url="https://feiyuai.icu/v1",
        )

        self.assertEqual(targets[0].id, 2)
        self.assertTrue(targets[0].is_default)


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
