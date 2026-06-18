from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.asset_storage import StoredAsset
from app.generated_assets_repair_service import (
    repair_generated_asset,
    replace_image_url_at_slot,
)


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
            sha256="b" * 64,
        )


class GeneratedAssetsRepairServiceTests(unittest.IsolatedAsyncioTestCase):
    def test_replace_image_url_at_slot_preserves_other_slots(self):
        urls = ["old-a.png", "old-b.png"]

        updated = replace_image_url_at_slot(urls, 1, "/api/images/assets/42-1.png")

        self.assertEqual(updated, ["old-a.png", "/api/images/assets/42-1.png"])

    async def test_repair_generated_asset_saves_source_and_updates_message_slot(self):
        asset = SimpleNamespace(
            id=9,
            source_url="http://old.example/image.png",
            message_id=42,
            slot_index=1,
        )
        message = SimpleNamespace(
            id=42,
            image_urls=["old-a.png", "http://old.example/image.png"],
            params={"request": {"output_format": "png"}},
        )
        storage = FakeStorage()

        with patch(
            "app.generated_assets_repair_service.load_image_bytes",
            return_value=(b"image-body", "image/png"),
        ):
            result = await repair_generated_asset(asset, message, storage=storage)

        self.assertEqual(result.status, "repaired")
        self.assertEqual(result.public_url, "/api/images/assets/42-1.png")
        self.assertEqual(asset.storage_kind, "local")
        self.assertEqual(asset.storage_key, "42-1.png")
        self.assertEqual(asset.public_url, "/api/images/assets/42-1.png")
        self.assertEqual(asset.mime_type, "image/png")
        self.assertEqual(asset.bytes, len(b"image-body"))
        self.assertEqual(asset.sha256, "b" * 64)
        self.assertEqual(asset.status, "available")
        self.assertEqual(message.image_urls[1], "/api/images/assets/42-1.png")
        self.assertEqual(storage.saved[0]["slot_index"], 1)

    async def test_dry_run_validates_source_without_mutating_asset(self):
        asset = SimpleNamespace(
            id=9,
            source_url="http://old.example/image.png",
            message_id=42,
            slot_index=0,
            status="missing",
            public_url=None,
        )
        message = SimpleNamespace(id=42, image_urls=["http://old.example/image.png"], params={})
        storage = FakeStorage()

        with patch(
            "app.generated_assets_repair_service.load_image_bytes",
            return_value=(b"image-body", "image/png"),
        ):
            result = await repair_generated_asset(asset, message, storage=storage, dry_run=True)

        self.assertEqual(result.status, "valid")
        self.assertEqual(result.public_url, None)
        self.assertEqual(asset.status, "missing")
        self.assertEqual(asset.public_url, None)
        self.assertEqual(message.image_urls, ["http://old.example/image.png"])
        self.assertEqual(storage.saved, [])

    async def test_unavailable_source_keeps_asset_missing(self):
        asset = SimpleNamespace(
            id=9,
            source_url="http://old.example/image.png",
            message_id=42,
            slot_index=0,
            status="missing",
            public_url=None,
        )
        message = SimpleNamespace(id=42, image_urls=["http://old.example/image.png"], params={})

        with patch(
            "app.generated_assets_repair_service.load_image_bytes",
            side_effect=TimeoutError("timeout"),
        ):
            result = await repair_generated_asset(asset, message, storage=FakeStorage())

        self.assertEqual(result.status, "unavailable")
        self.assertEqual(asset.status, "missing")
        self.assertEqual(asset.public_url, None)


if __name__ == "__main__":
    unittest.main()
