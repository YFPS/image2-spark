"""生成图片资产存储 seam。

调用方只关心保存图片后得到稳定 public_url，不关心本地文件或对象存储细节。
"""
from __future__ import annotations

import asyncio
import hashlib
import mimetypes
import re
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .config import get_settings


@dataclass(frozen=True)
class StoredAsset:
    storage_kind: str
    storage_key: str
    public_url: str
    mime_type: str
    bytes: int
    sha256: str


class AssetStorage(Protocol):
    async def save_image(
        self,
        *,
        body: bytes,
        content_type: str,
        output_format: str,
        message_id: int,
        slot_index: int,
    ) -> StoredAsset:
        ...


def image_ext(content_type: str, output_format: str) -> str:
    ext = mimetypes.guess_extension((content_type or "").split(";", 1)[0].strip().lower())
    if ext == ".jpe":
        ext = ".jpg"
    if ext:
        return ext

    fallback = (output_format or "png").strip().lower().lstrip(".")
    if fallback == "jpeg":
        fallback = "jpg"
    if not re.fullmatch(r"[a-z0-9]+", fallback):
        fallback = "png"
    return f".{fallback}"


class LocalAssetStorage:
    def __init__(self, root: str | None = None) -> None:
        settings = get_settings()
        self.root = Path(root or settings.generated_image_dir).resolve()

    async def save_image(
        self,
        *,
        body: bytes,
        content_type: str,
        output_format: str,
        message_id: int,
        slot_index: int,
    ) -> StoredAsset:
        max_bytes = 50 * 1024 * 1024
        if len(body) > max_bytes:
            raise ValueError("生成图片超过 50 MB")

        self.root.mkdir(parents=True, exist_ok=True)
        mime_type = (content_type or f"image/{output_format or 'png'}").split(";", 1)[0].strip().lower()
        ext = image_ext(mime_type, output_format)
        filename = f"{message_id}-{slot_index}-{secrets.token_hex(8)}{ext}"
        path = (self.root / filename).resolve()
        path.relative_to(self.root)

        await asyncio.to_thread(path.write_bytes, body)
        sha256 = hashlib.sha256(body).hexdigest()
        return StoredAsset(
            storage_kind="local",
            storage_key=filename,
            public_url=f"/api/images/local/{filename}",
            mime_type=mime_type,
            bytes=len(body),
            sha256=sha256,
        )


def get_asset_storage() -> AssetStorage:
    settings = get_settings()
    if settings.asset_storage_backend == "local":
        return LocalAssetStorage()
    raise RuntimeError(f"未知资产存储后端：{settings.asset_storage_backend}")
