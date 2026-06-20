from __future__ import annotations

import unittest

from app.model_catalog import (
    calculate_image_model_cost,
    image_model_matches_base_url,
    normalize_image_model_id,
)
from app.routers.images import _calculate_cost
from app.upstream_routing import ChannelCandidate, order_upstream_model_targets


class ImageModelCatalogTests(unittest.TestCase):
    def test_costs_follow_public_model_pricing(self):
        self.assertEqual(calculate_image_model_cost("image2", 2), 8)
        self.assertEqual(calculate_image_model_cost("gpt-image-2", 1), 4)
        self.assertEqual(calculate_image_model_cost("gemini", 3), 6)
        self.assertEqual(calculate_image_model_cost("cloudflare", 4), 4)
        self.assertEqual(calculate_image_model_cost("huggingface", 4), 4)
        self.assertEqual(calculate_image_model_cost("pollinations", 4), 4)
        self.assertEqual(_calculate_cost("image2", 2), 8)
        self.assertEqual(_calculate_cost("gemini", 2), 4)

    def test_model_aliases_are_normalized(self):
        self.assertEqual(normalize_image_model_id("gpt-image-2"), "image2")
        self.assertEqual(normalize_image_model_id("image2"), "image2")
        self.assertEqual(normalize_image_model_id("gemini-2.5-flash-image"), "gemini")
        self.assertEqual(normalize_image_model_id("cloudflare-flux"), "cloudflare")
        self.assertEqual(normalize_image_model_id("hf-flux"), "huggingface")

    def test_models_match_only_their_own_channel_hosts(self):
        self.assertTrue(image_model_matches_base_url("image2", "https://feiyuai.icu/v1"))
        self.assertTrue(image_model_matches_base_url("image2", "https://api2.tabcode.cc/openai/draw/v1"))
        self.assertTrue(
            image_model_matches_base_url(
                "gemini",
                "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-image:generateContent",
            )
        )
        self.assertTrue(
            image_model_matches_base_url(
                "cloudflare",
                "https://api.cloudflare.com/client/v4/accounts/demo/ai/run/@cf/black-forest-labs/flux-1-schnell",
            )
        )
        self.assertTrue(
            image_model_matches_base_url(
                "huggingface",
                "https://router.huggingface.co/fal-ai/fal-ai/flux/dev",
            )
        )
        self.assertTrue(image_model_matches_base_url("pollinations", "https://image.pollinations.ai"))
        self.assertFalse(image_model_matches_base_url("gemini", "https://image.pollinations.ai"))


class ImageModelRoutingTests(unittest.TestCase):
    def test_selected_model_does_not_fallback_to_other_models(self):
        channels = [
            ChannelCandidate(
                id=1,
                name="Image2",
                base_url="https://feiyuai.icu/v1",
                api_key="image2-key",
                enabled=False,
                priority=100,
                supports_edit=True,
                timeout_seconds=300,
                is_default=True,
                auto_switch_enabled=False,
            ),
            ChannelCandidate(
                id=2,
                name="Cloudflare",
                base_url="https://api.cloudflare.com/client/v4/accounts/demo/ai/run/@cf/black-forest-labs/flux-1-schnell",
                api_key="cf-token",
                enabled=True,
                priority=80,
                supports_edit=False,
                timeout_seconds=120,
                is_default=False,
                auto_switch_enabled=True,
            ),
            ChannelCandidate(
                id=3,
                name="Hugging Face",
                base_url="https://router.huggingface.co/fal-ai/fal-ai/flux/dev",
                api_key="hf-token",
                enabled=True,
                priority=70,
                supports_edit=False,
                timeout_seconds=120,
                is_default=False,
                auto_switch_enabled=True,
            ),
        ]

        self.assertEqual(order_upstream_model_targets(channels, "image2"), [])
        cloudflare_targets = order_upstream_model_targets(channels, "cloudflare")
        self.assertEqual([target.id for target in cloudflare_targets], [2])


if __name__ == "__main__":
    unittest.main()
