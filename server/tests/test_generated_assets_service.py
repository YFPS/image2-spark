from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.asset_storage import LocalAssetStorage, StoredAsset
from app.generated_assets_service import persist_generated_assets


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
            self.assertTrue(asset.public_url.startswith("/api/images/assets/42-0-"))
            self.assertEqual(asset.bytes, len(body))
            self.assertEqual(len(asset.sha256), 64)
            self.assertTrue((Path(d) / asset.storage_key).is_file())


class FakeDb:
    def __init__(self) -> None:
        self.added = []
        self.flushed = False

    def add(self, obj) -> None:
        self.added.append(obj)

    async def flush(self) -> None:
        self.flushed = True


class FakeStorage:
    def __init__(self) -> None:
        self.saved = []

    async def save_image(
        self,
        *,
        body: bytes,
        content_type: str,
        output_format: str,
        message_id: int,
        slot_index: int,
    ) -> StoredAsset:
        self.saved.append(
            {
                "body": body,
                "content_type": content_type,
                "output_format": output_format,
                "message_id": message_id,
                "slot_index": slot_index,
            }
        )
        return StoredAsset(
            storage_kind="local",
            storage_key=f"{message_id}-{slot_index}.png",
            public_url=f"/api/images/assets/{message_id}-{slot_index}.png",
            mime_type=content_type,
            bytes=len(body),
            sha256="a" * 64,
        )


class GeneratedAssetsServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_persist_generated_assets_writes_asset_and_returns_public_url(self):
        db = FakeDb()
        storage = FakeStorage()

        urls = await persist_generated_assets(
            db,  # type: ignore[arg-type]
            user_id=7,
            conversation_id=8,
            message_id=42,
            urls=["data:image/png;base64,aGVsbG8="],
            output_format="png",
            storage=storage,
        )

        self.assertEqual(urls, ["/api/images/assets/42-0.png"])
        self.assertTrue(db.flushed)
        self.assertEqual(storage.saved[0]["body"], b"hello")
        asset = db.added[0]
        self.assertEqual(asset.user_id, 7)
        self.assertEqual(asset.conversation_id, 8)
        self.assertEqual(asset.message_id, 42)
        self.assertEqual(asset.slot_index, 0)
        self.assertEqual(asset.storage_kind, "local")
        self.assertEqual(asset.public_url, "/api/images/assets/42-0.png")
        self.assertEqual(asset.source_url, "data:image")
        self.assertEqual(asset.status, "available")

    async def test_persist_generated_assets_marks_known_broken_host_missing(self):
        db = FakeDb()
        storage = FakeStorage()

        urls = await persist_generated_assets(
            db,  # type: ignore[arg-type]
            user_id=7,
            conversation_id=8,
            message_id=42,
            urls=["http://67.21.86.146:3015/dead.png"],
            output_format="png",
            storage=storage,
        )

        self.assertEqual(urls, [])
        self.assertEqual(storage.saved, [])
        asset = db.added[0]
        self.assertEqual(asset.storage_kind, "missing")
        self.assertIsNone(asset.public_url)
        self.assertEqual(asset.status, "missing")

    async def test_persist_generated_assets_respects_explicit_slot_indexes(self):
        db = FakeDb()
        storage = FakeStorage()

        await persist_generated_assets(
            db,  # type: ignore[arg-type]
            user_id=7,
            conversation_id=8,
            message_id=42,
            urls=["data:image/png;base64,aGVsbG8="],
            output_format="png",
            slot_indexes=[3],
            storage=storage,
        )

        self.assertEqual(storage.saved[0]["slot_index"], 3)
        self.assertEqual(db.added[0].slot_index, 3)
