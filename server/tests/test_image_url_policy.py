"""历史图片 URL 展示策略测试。"""
from __future__ import annotations

import unittest

from app.config import get_settings
from app.works_service import filter_displayable_image_urls, is_displayable_image_url


class ImageUrlPolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        get_settings.cache_clear()

    def tearDown(self) -> None:
        get_settings.cache_clear()

    def test_filters_known_broken_history_host(self):
        urls = [
            "http://67.21.86.146:3015/images/old.png",
            "https://cdn.example.com/images/new.png",
            "/api/images/assets/123-0.png",
        ]

        self.assertEqual(
            filter_displayable_image_urls(urls),
            [
                "https://cdn.example.com/images/new.png",
                "/api/images/assets/123-0.png",
            ],
        )

    def test_keeps_relative_and_data_like_urls_displayable(self):
        self.assertTrue(is_displayable_image_url("/api/images/assets/123-0.png"))
        self.assertTrue(is_displayable_image_url("data:image/png;base64,abc"))


if __name__ == "__main__":
    unittest.main()
