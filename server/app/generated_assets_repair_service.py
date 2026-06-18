from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .asset_storage import AssetStorage, get_asset_storage
from .generated_assets_service import load_image_bytes


@dataclass(frozen=True)
class AssetRepairResult:
    asset_id: int | None
    message_id: int | None
    source_url: str | None
    status: str
    public_url: str | None = None
    error: str | None = None
    bytes: int | None = None


def guess_output_format(message: Any) -> str:
    params = getattr(message, "params", None)
    if not isinstance(params, dict):
        return "png"
    request = params.get("request") if isinstance(params.get("request"), dict) else {}
    raw = request.get("output_format") or params.get("output_format") or "png"
    return str(raw or "png")


def replace_image_url_at_slot(raw_urls: Any, slot_index: int, public_url: str) -> Any:
    if isinstance(raw_urls, list):
        next_urls = list(raw_urls)
        if 0 <= slot_index < len(next_urls):
            next_urls[slot_index] = public_url
            return next_urls
        if slot_index == len(next_urls):
            next_urls.append(public_url)
            return next_urls
        return raw_urls
    if slot_index == 0:
        return [public_url]
    return raw_urls


async def repair_generated_asset(
    asset: Any,
    message: Any,
    *,
    storage: AssetStorage | None = None,
    dry_run: bool = False,
) -> AssetRepairResult:
    asset_id = getattr(asset, "id", None)
    message_id = getattr(asset, "message_id", None)
    source_url = getattr(asset, "source_url", None)
    slot_index = int(getattr(asset, "slot_index", 0) or 0)

    if not isinstance(source_url, str) or not source_url:
        return AssetRepairResult(
            asset_id=asset_id,
            message_id=message_id,
            source_url=None,
            status="skipped",
            error="source_url_empty",
        )

    output_format = guess_output_format(message)
    try:
        body, content_type = await load_image_bytes(source_url, output_format)
    except Exception as exc:  # noqa: BLE001
        return AssetRepairResult(
            asset_id=asset_id,
            message_id=message_id,
            source_url=source_url,
            status="unavailable",
            error=type(exc).__name__,
        )

    if dry_run:
        return AssetRepairResult(
            asset_id=asset_id,
            message_id=message_id,
            source_url=source_url,
            status="valid",
            bytes=len(body),
        )

    storage = storage or get_asset_storage()
    stored = await storage.save_image(
        body=body,
        content_type=content_type,
        output_format=output_format,
        message_id=int(message_id),
        slot_index=slot_index,
    )

    asset.storage_kind = stored.storage_kind
    asset.storage_key = stored.storage_key
    asset.public_url = stored.public_url
    asset.mime_type = stored.mime_type
    asset.bytes = stored.bytes
    asset.sha256 = stored.sha256
    asset.status = "available"
    message.image_urls = replace_image_url_at_slot(
        getattr(message, "image_urls", None),
        slot_index,
        stored.public_url,
    )

    return AssetRepairResult(
        asset_id=asset_id,
        message_id=message_id,
        source_url=source_url,
        status="repaired",
        public_url=stored.public_url,
        bytes=stored.bytes,
    )
