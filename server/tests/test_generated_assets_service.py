from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.asset_storage import LocalAssetStorage


class LocalAssetStorageTests(unittest.IsolatedAsyncioTestCase):
    async def test_save_image_writes_file_and_returns_public_url(self):
        with tempfile.TemporaryDirectory() as d:
            storage = LocalAssetStorage(root=d)
            body = b"\x89PNG\r\n\x1a\nfake"

            asset = await storage.save_image(
                body=body,
                content_type="image/png",
                output_format="png",
                message_id=42,
                slot_index=0,
            )

            self.assertEqual(asset.storage_kind, "local")
            self.assertTrue(asset.public_url.startswith("/api/images/local/42-0-"))
            self.assertEqual(asset.bytes, len(body))
            self.assertEqual(len(asset.sha256), 64)
            self.assertTrue((Path(d) / asset.storage_key).is_file())
