"""生成图片资产服务。

这里集中处理图片落库、作品分页和 RecentWorkItem 兼容输出。
"""
from __future__ import annotations

import base64
import binascii
import re
from collections.abc import Iterable
from urllib.parse import urlparse

import httpx
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .asset_storage import AssetStorage, canonical_image_url, get_asset_storage
from .config import get_settings
from .models import Conversation, GeneratedAsset, Message
from .schemas import RecentWorkItem

DATA_IMAGE_RE = re.compile(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", re.DOTALL)


def is_broken_source_url(src: str) -> bool:
    parsed = urlparse(src)
    netloc = parsed.netloc.lower()
    hostname = (parsed.hostname or "").lower()
    dead_hosts = get_settings().broken_image_hosts
    return netloc in dead_hosts or hostname in dead_hosts


async def load_image_bytes(src: str, output_format: str) -> tuple[bytes, str]:
    if src.startswith("data:"):
        match = DATA_IMAGE_RE.match(src)
        if not match:
            raise ValueError("无法识别 data:image")
        content_type, b64 = match.groups()
        try:
            return base64.b64decode(b64, validate=True), content_type
        except binascii.Error as e:
            raise ValueError("data:image base64 无效") from e

    parsed = urlparse(src)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("图片 URL 必须是 http/https 或 data:image")

    timeout = httpx.Timeout(get_settings().generated_image_cache_timeout, connect=5.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        resp = await client.get(src)
        resp.raise_for_status()
        content_type = resp.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if not content_type.startswith("image/"):
            raise ValueError(f"非图片 Content-Type：{content_type}")
        return resp.content, content_type or f"image/{output_format or 'png'}"


async def persist_generated_assets(
    db: AsyncSession,
    *,
    user_id: int,
    conversation_id: int,
    message_id: int,
    urls: list[str],
    output_format: str,
    slot_indexes: list[int] | None = None,
    storage: AssetStorage | None = None,
) -> list[str]:
    storage = storage or get_asset_storage()
    public_urls: list[str] = []
    if slot_indexes is not None and len(slot_indexes) != len(urls):
        raise ValueError("slot_indexes 长度必须与 urls 一致")
    indexed_urls = list(enumerate(urls)) if slot_indexes is None else list(zip(slot_indexes, urls))

    for idx, src in indexed_urls:
        broken = is_broken_source_url(src)
        try:
            if broken:
                raise FileNotFoundError("已知失效图源")
            body, content_type = await load_image_bytes(src, output_format)
            stored = await storage.save_image(
                body=body,
                content_type=content_type,
                output_format=output_format,
                message_id=message_id,
                slot_index=idx,
            )
            asset = GeneratedAsset(
                user_id=user_id,
                conversation_id=conversation_id,
                message_id=message_id,
                slot_index=idx,
                storage_kind=stored.storage_kind,
                storage_key=stored.storage_key,
                public_url=stored.public_url,
                source_url=src if src.startswith("http") else "data:image",
                mime_type=stored.mime_type,
                bytes=stored.bytes,
                sha256=stored.sha256,
                status="available",
            )
            public_urls.append(stored.public_url)
        except Exception:  # noqa: BLE001
            asset = GeneratedAsset(
                user_id=user_id,
                conversation_id=conversation_id,
                message_id=message_id,
                slot_index=idx,
                storage_kind="missing" if broken else "remote_legacy",
                storage_key=None,
                public_url=None if broken else src,
                source_url=src,
                status="missing" if broken else "available",
            )
            if asset.public_url:
                public_urls.append(asset.public_url)

        db.add(asset)

    await db.flush()
    return public_urls


def _message_size(message: Message) -> str | None:
    if message.params and isinstance(message.params, dict):
        raw_size = message.params.get("size")
        if isinstance(raw_size, str):
            return raw_size
    return None


def asset_rows_to_recent_work_items(
    rows: Iterable[tuple[GeneratedAsset, Message]],
    *,
    limit: int,
) -> list[RecentWorkItem]:
    grouped: dict[int, tuple[Message, list[GeneratedAsset]]] = {}
    for asset, message in rows:
        if asset.status != "available" or not asset.public_url:
            continue
        if message.id not in grouped:
            grouped[message.id] = (message, [])
        grouped[message.id][1].append(asset)

    items: list[RecentWorkItem] = []
    for message, assets in grouped.values():
        assets.sort(key=lambda asset: asset.slot_index)
        urls = [
            canonical_image_url(asset.public_url)
            for asset in assets
            if asset.public_url
        ]
        if not urls:
            continue
        items.append(
            RecentWorkItem(
                message_id=message.id,
                conversation_id=message.conversation_id,
                image_url=urls[0],
                image_count=len(urls),
                all_image_urls=urls,
                size=_message_size(message),
                created_at=message.created_at,
            )
        )
        if len(items) >= limit:
            break
    return items


def asset_to_recent_work_item(asset: GeneratedAsset, message: Message) -> RecentWorkItem | None:
    items = asset_rows_to_recent_work_items([(asset, message)], limit=1)
    if not items:
        return None
    return items[0]


async def list_user_assets(
    db: AsyncSession,
    user_id: int,
    *,
    cursor: int | None = None,
    limit: int = 12,
) -> tuple[list[RecentWorkItem], int | None]:
    where = [
        GeneratedAsset.user_id == user_id,
        GeneratedAsset.status == "available",
        GeneratedAsset.public_url.is_not(None),
        Conversation.user_id == user_id,
        Conversation.deleted_at.is_(None),
        Message.role == "ai",
        Message.status == "done",
    ]
    if cursor is not None:
        where.append(Message.id < cursor)

    message_ids = (
        await db.execute(
            select(GeneratedAsset.message_id)
            .join(Message, Message.id == GeneratedAsset.message_id)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(and_(*where))
            .group_by(GeneratedAsset.message_id)
            .order_by(GeneratedAsset.message_id.desc())
            .limit(limit + 1)
        )
    ).scalars().all()

    page_message_ids = message_ids[:limit]
    if not page_message_ids:
        return [], None

    rows = (
        await db.execute(
            select(GeneratedAsset, Message)
            .join(Message, Message.id == GeneratedAsset.message_id)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(
                and_(
                    *where,
                    GeneratedAsset.message_id.in_(page_message_ids),
                )
            )
            .order_by(GeneratedAsset.message_id.desc(), GeneratedAsset.slot_index.asc())
        )
    ).all()

    items = asset_rows_to_recent_work_items(rows, limit=limit)
    next_cursor = page_message_ids[-1] if len(message_ids) > limit and page_message_ids else None
    return items, next_cursor
