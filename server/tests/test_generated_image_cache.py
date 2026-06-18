"""生成结果本地缓存单测。

历史作品如果只保存上游 URL，上游图床超时后页面就只能显示加载失败。
新生成的图应先落到本地，再把本地 URL 写回消息，避免“最新作品”继续依赖短期图床。
"""
from __future__ import annotations

import base64
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.routers import images


class GeneratedImageCacheTests(unittest.IsolatedAsyncioTestCase):
    async def test_data_uri_is_saved_as_local_image_url(self) -> None:
        png_bytes = b"\x89PNG\r\n\x1a\nfake"
        data_uri = "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")

        with tempfile.TemporaryDirectory() as tmp:
            fake_settings = SimpleNamespace(
                generated_image_dir=tmp,
                generated_image_cache_timeout=5.0,
            )
            with patch("app.routers.images.get_settings", return_value=fake_settings):
                urls = await images._persist_generated_images(
                    [data_uri],
                    output_format="png",
                    ai_msg_id=123,
                )

            self.assertEqual(len(urls), 1)
            self.assertTrue(urls[0].startswith("/api/images/local/123-0-"))
            saved = Path(tmp) / urls[0].rsplit("/", 1)[-1]
            self.assertEqual(saved.read_bytes(), png_bytes)

    async def test_asset_index_path_returns_public_urls(self) -> None:
        class FakeSession:
            committed = False

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def commit(self):
                self.committed = True

        session = FakeSession()

        def factory():
            return session

        async def fake_persist(db, **kwargs):
            self.assertIs(db, session)
            self.assertEqual(kwargs["user_id"], 7)
            self.assertEqual(kwargs["conversation_id"], 8)
            self.assertEqual(kwargs["message_id"], 123)
            self.assertEqual(kwargs["urls"], ["data:image/png;base64,aGVsbG8="])
            return ["/api/images/local/123-0.png"]

        with patch("app.routers.images.persist_generated_assets", side_effect=fake_persist):
            urls = await images._persist_generated_assets_for_message(
                factory,
                ["data:image/png;base64,aGVsbG8="],
                output_format="png",
                ai_msg_id=123,
                conv_id=8,
                user_id=7,
            )

        self.assertTrue(session.committed)
        self.assertEqual(urls, ["/api/images/local/123-0.png"])


if __name__ == "__main__":
    unittest.main()
