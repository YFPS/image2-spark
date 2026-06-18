# 生成图片资产长期架构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 AI 生成图片从 `messages.image_urls` 中独立为可迁移、可分页、可观测的资产索引，解决最近作品 500、历史图片失效、data URL 响应过大和 Redis 职责混乱问题。

**Architecture:** 新增 `generated_assets` 表作为作品真相源，新增 `AssetStorage` seam，先用本地 Adapter，后续切 COS Adapter。生成/编辑任务双写资产表和 `Message.image_urls` 兼容字段，作品接口逐步切到资产表，历史图片用幂等脚本迁移。

**Tech Stack:** FastAPI / SQLAlchemy 2.0 asyncio / MySQL 8 / Redis / local filesystem / optional COS / unittest / React 18 + TypeScript / Chrome MCP

**Spec:** `docs/specs/2026-06-19-generated-assets-production-architecture-design.md`

---

## 文件清单

| 文件 | 改动 |
|---|---|
| `server/app/models.py` | 新增 `GeneratedAsset` ORM 与枚举类型别名 |
| `server/alembic/versions/0006_generated_assets.py` | 新增资产表 migration |
| `server/app/asset_storage.py` | 新增资产存储 seam 与 `LocalAssetStorage` Adapter |
| `server/app/generated_assets_service.py` | 新增资产写入、查询、schema 转换逻辑 |
| `server/app/routers/images.py` | 生成/编辑完成时双写资产表 |
| `server/app/works_service.py` | 作品查询优先读资产表，保留 message fallback |
| `server/app/routers/recent_works.py` | 继续复用 `works_service`，接口形状不变 |
| `server/app/routers/works.py` | 继续复用 `works_service`，cursor 语义转为 asset id |
| `server/app/config.py` | 增加资产存储配置与 deep health 所需配置 |
| `server/app/main.py` | 如当前已有 `/api/health`，增加 `/api/health/deep` 或挂载 health router |
| `server/scripts/migrate_generated_assets.py` | 新增历史图片迁移脚本 |
| `server/tests/test_generated_assets_service.py` | 新增资产服务单测 |
| `server/tests/test_generated_assets_migration.py` | 新增迁移脚本单测 |
| `server/tests/test_recent_works.py` | 更新为资产表优先路径测试 |
| `server/tests/test_works.py` | 更新作品分页测试 |
| `client/tests/imageSrcAndTime.test.cjs` | 增加“不返回 data:image 时按 asset created_at 显示”的断言 |

---

## Task 1: 数据模型与 migration

**Files:**
- Modify: `server/app/models.py`
- Create: `server/alembic/versions/0006_generated_assets.py`

- [ ] **Step 1: 在 `server/app/models.py` 增加类型别名**

在 `MessageStatus` 后加入：

```python
GeneratedAssetStorageKind = Literal["local", "cos", "remote_legacy", "data_legacy", "missing"]
GeneratedAssetStatus = Literal["available", "missing", "quarantined"]
```

- [ ] **Step 2: 在 `server/app/models.py` 增加 `GeneratedAsset`**

放在 `Message` 后面：

```python
class GeneratedAsset(Base):
    """AI 生成图片资产索引，一行对应一条 AI 消息里的一张图片。"""

    __tablename__ = "generated_assets"
    __table_args__ = (
        UniqueConstraint("message_id", "slot_index", name="uk_asset_message_slot"),
        Index("idx_asset_user_created", "user_id", "created_at", "id"),
        Index("idx_asset_user_id", "user_id", "id"),
        Index("idx_asset_status_kind", "status", "storage_kind"),
        {
            "mysql_engine": "InnoDB",
            "mysql_charset": "utf8mb4",
            "mysql_collate": "utf8mb4_0900_ai_ci",
        },
    )

    id: Mapped[int] = mapped_column(MyBigInt(unsigned=True), primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        MyBigInt(unsigned=True),
        ForeignKey("users.id", ondelete="CASCADE", name="fk_asset_user"),
        nullable=False,
    )
    conversation_id: Mapped[int] = mapped_column(
        MyBigInt(unsigned=True),
        ForeignKey("conversations.id", ondelete="CASCADE", name="fk_asset_conv"),
        nullable=False,
    )
    message_id: Mapped[int] = mapped_column(
        MyBigInt(unsigned=True),
        ForeignKey("messages.id", ondelete="CASCADE", name="fk_asset_msg"),
        nullable=False,
    )
    slot_index: Mapped[int] = mapped_column(nullable=False)
    storage_kind: Mapped[str] = mapped_column(
        Enum("local", "cos", "remote_legacy", "data_legacy", "missing", name="generated_asset_storage_kind"),
        nullable=False,
    )
    storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    public_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    width: Mapped[int | None] = mapped_column(nullable=True)
    height: Mapped[int | None] = mapped_column(nullable=True)
    bytes: Mapped[int | None] = mapped_column(MyBigInt(unsigned=True), nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(
        Enum("available", "missing", "quarantined", name="generated_asset_status"),
        nullable=False,
        default="available",
        server_default="available",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        server_onupdate=func.current_timestamp(),
    )
```

- [ ] **Step 3: 创建 Alembic migration**

创建 `server/alembic/versions/0006_generated_assets.py`：

```python
"""create generated_assets table

Revision ID: 0006
Revises: 0005
Create Date: 2026-06-19
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "generated_assets",
        sa.Column("id", mysql.BIGINT(unsigned=True), primary_key=True, autoincrement=True),
        sa.Column("user_id", mysql.BIGINT(unsigned=True), nullable=False),
        sa.Column("conversation_id", mysql.BIGINT(unsigned=True), nullable=False),
        sa.Column("message_id", mysql.BIGINT(unsigned=True), nullable=False),
        sa.Column("slot_index", sa.Integer(), nullable=False),
        sa.Column(
            "storage_kind",
            sa.Enum("local", "cos", "remote_legacy", "data_legacy", "missing", name="generated_asset_storage_kind"),
            nullable=False,
        ),
        sa.Column("storage_key", sa.String(length=512), nullable=True),
        sa.Column("public_url", sa.String(length=1024), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("mime_type", sa.String(length=64), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("bytes", mysql.BIGINT(unsigned=True), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column(
            "status",
            sa.Enum("available", "missing", "quarantined", name="generated_asset_status"),
            nullable=False,
            server_default="available",
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_asset_user", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], name="fk_asset_conv", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], name="fk_asset_msg", ondelete="CASCADE"),
        sa.UniqueConstraint("message_id", "slot_index", name="uk_asset_message_slot"),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_0900_ai_ci",
    )
    op.create_index("idx_asset_user_created", "generated_assets", ["user_id", "created_at", "id"])
    op.create_index("idx_asset_user_id", "generated_assets", ["user_id", "id"])
    op.create_index("idx_asset_status_kind", "generated_assets", ["status", "storage_kind"])


def downgrade() -> None:
    op.drop_index("idx_asset_status_kind", table_name="generated_assets")
    op.drop_index("idx_asset_user_id", table_name="generated_assets")
    op.drop_index("idx_asset_user_created", table_name="generated_assets")
    op.drop_table("generated_assets")
```

- [ ] **Step 4: 验证 migration**

Run:

```powershell
cd D:/webProject/image2/server
python -m py_compile alembic/versions/0006_generated_assets.py
python -c "from app.models import GeneratedAsset; print(GeneratedAsset.__tablename__)"
```

Expected:

```text
generated_assets
```

- [ ] **Step 5: 提交**

```bash
git add server/app/models.py server/alembic/versions/0006_generated_assets.py
git commit -m "feat(server): 新增生成图片资产表"
```

---

## Task 2: 资产存储 seam

**Files:**
- Modify: `server/app/config.py`
- Create: `server/app/asset_storage.py`
- Test: `server/tests/test_generated_assets_service.py`

- [ ] **Step 1: 在 `server/app/config.py` 增加配置**

在 `generated_image_cache_timeout` 附近加入：

```python
self.asset_storage_backend: str = (
    os.getenv("ASSET_STORAGE_BACKEND", "local").strip().lower() or "local"
)
self.asset_public_base_url: str = os.getenv("ASSET_PUBLIC_BASE_URL", "").strip().rstrip("/")
```

- [ ] **Step 2: 创建 `server/app/asset_storage.py`**

```python
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
    if ext in {".jpe"}:
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
```

- [ ] **Step 3: 写存储单测**

在 `server/tests/test_generated_assets_service.py` 先加入本地存储测试：

```python
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
```

- [ ] **Step 4: 运行测试**

```powershell
cd D:/webProject/image2/server
python -m unittest tests.test_generated_assets_service.LocalAssetStorageTests -v
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/app/config.py server/app/asset_storage.py server/tests/test_generated_assets_service.py
git commit -m "feat(server): 增加生成图片资产存储 seam"
```

---

## Task 3: 资产服务模块

**Files:**
- Create: `server/app/generated_assets_service.py`
- Modify: `server/tests/test_generated_assets_service.py`

- [ ] **Step 1: 创建 `server/app/generated_assets_service.py`**

```python
"""生成图片资产服务。

这里集中处理：图片落库、作品分页、RecentWorkItem 兼容输出。
"""
from __future__ import annotations

import base64
import binascii
import re
from urllib.parse import urlparse

import httpx
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .asset_storage import AssetStorage, get_asset_storage
from .config import get_settings
from .models import GeneratedAsset
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
    storage: AssetStorage | None = None,
) -> list[str]:
    storage = storage or get_asset_storage()
    public_urls: list[str] = []
    for idx, src in enumerate(urls):
        try:
            if is_broken_source_url(src):
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
        except Exception:
            asset = GeneratedAsset(
                user_id=user_id,
                conversation_id=conversation_id,
                message_id=message_id,
                slot_index=idx,
                storage_kind="missing" if is_broken_source_url(src) else "remote_legacy",
                storage_key=None,
                public_url=None if is_broken_source_url(src) else src,
                source_url=src,
                status="missing" if is_broken_source_url(src) else "available",
            )
            if asset.public_url:
                public_urls.append(asset.public_url)
        db.add(asset)
    await db.flush()
    return public_urls


def asset_to_recent_work_item(asset: GeneratedAsset) -> RecentWorkItem | None:
    if asset.status != "available" or not asset.public_url:
        return None
    return RecentWorkItem(
        message_id=asset.message_id,
        conversation_id=asset.conversation_id,
        image_url=asset.public_url,
        image_count=1,
        all_image_urls=[asset.public_url],
        size=None,
        created_at=asset.created_at,
    )


async def list_user_assets(
    db: AsyncSession,
    user_id: int,
    *,
    cursor: int | None = None,
    limit: int = 12,
) -> tuple[list[RecentWorkItem], int | None]:
    where = [GeneratedAsset.user_id == user_id, GeneratedAsset.status == "available"]
    if cursor is not None:
        where.append(GeneratedAsset.id < cursor)
    rows = (
        await db.execute(
            select(GeneratedAsset)
            .where(and_(*where))
            .order_by(GeneratedAsset.id.desc())
            .limit(limit + 1)
        )
    ).scalars().all()
    items = [item for asset in rows[:limit] if (item := asset_to_recent_work_item(asset)) is not None]
    next_cursor = rows[limit].id if len(rows) > limit else None
    return items, next_cursor
```

- [ ] **Step 2: 给 `persist_generated_assets` 增加服务测试**

在 `server/tests/test_generated_assets_service.py` 追加一个使用临时 SQLite 不合适，因为当前模型依赖 MySQL 方言。这里使用现有集成测试环境，沿用 `test_recent_works.py` 的 DB fixture 方式。测试目标：

```python
async def test_persist_generated_assets_writes_asset_and_returns_public_url(self):
    # 创建 user / conversation / message
    # 调 persist_generated_assets(..., urls=["data:image/png;base64,..."])
    # 断言返回 /api/images/local/
    # 断言 generated_assets 有一行 available local
```

- [ ] **Step 3: 运行测试**

```powershell
cd D:/webProject/image2/server
python -m unittest tests.test_generated_assets_service -v
```

Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add server/app/generated_assets_service.py server/tests/test_generated_assets_service.py
git commit -m "feat(server): 增加生成图片资产服务"
```

---

## Task 4: 生成/编辑双写资产表

**Files:**
- Modify: `server/app/routers/images.py`
- Test: `server/tests/test_generated_image_cache.py`

- [ ] **Step 1: 在 `images.py` 导入资产服务**

```python
from ..generated_assets_service import persist_generated_assets
```

- [ ] **Step 2: 替换 `_persist_generated_images` 调用**

在 `_run_generation_task` 与 `_run_edit_task` 中，把：

```python
urls = await _persist_generated_images(
    urls,
    output_format=output_format,
    ai_msg_id=ai_msg_id,
)
```

替换为：

```python
async with factory() as asset_db:
    urls = await persist_generated_assets(
        asset_db,
        user_id=user_id,
        conversation_id=conv_id,
        message_id=ai_msg_id,
        urls=urls,
        output_format=output_format,
    )
    await asset_db.commit()
```

- [ ] **Step 3: 保留 `_persist_generated_images` 一个版本作为临时 fallback**

短期不要删除旧函数。先用测试覆盖新路径，确认稳定后再移除旧函数，避免生成路径一次改太多。

- [ ] **Step 4: 更新测试**

在 `server/tests/test_generated_image_cache.py` 增加断言：

```python
# 生成完成后，messages.image_urls 仍然是 public URL 列表
# generated_assets 中有同样数量的 available 记录
# generated_assets.public_url 与 messages.image_urls 对齐
```

- [ ] **Step 5: 运行测试**

```powershell
cd D:/webProject/image2/server
python -m unittest tests.test_generated_image_cache -v
python -m unittest tests.test_recent_works -v
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add server/app/routers/images.py server/tests/test_generated_image_cache.py
git commit -m "feat(server): 生成图片双写资产索引"
```

---

## Task 5: 作品查询切到资产表

**Files:**
- Modify: `server/app/works_service.py`
- Modify: `server/tests/test_recent_works.py`
- Modify: `server/tests/test_works.py`

- [ ] **Step 1: 在 `works_service.py` 优先调用资产表查询**

在 `fetch_recent_work_items()` 开头加入：

```python
from .generated_assets_service import list_user_assets
```

然后在函数开头：

```python
asset_items, asset_next_cursor = await list_user_assets(
    db,
    user_id,
    cursor=cursor,
    limit=limit,
)
if asset_items:
    return asset_items, asset_next_cursor
```

保留原 message 扫描逻辑作为迁移期 fallback。

- [ ] **Step 2: 更新 recent works 测试**

增加用例：

```python
async def test_recent_works_prefers_generated_assets(self):
    # 同一个用户同时有 Message.image_urls 和 generated_assets
    # generated_assets.public_url 使用 /api/images/local/new.png
    # Message.image_urls 使用 data:image 或旧 URL
    # 断言接口返回 /api/images/local/new.png
```

- [ ] **Step 3: 更新 works 分页测试**

增加用例：

```python
async def test_works_cursor_uses_asset_id_without_duplicates(self):
    # 写入 15 个 generated_assets
    # 第一页 limit=10
    # 第二页 cursor=next_cursor
    # 断言两页 id 不重复，总数为 15
```

- [ ] **Step 4: 运行测试**

```powershell
cd D:/webProject/image2/server
python -m unittest tests.test_recent_works -v
python -m unittest tests.test_works -v
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/app/works_service.py server/tests/test_recent_works.py server/tests/test_works.py
git commit -m "feat(server): 作品列表优先读取生成资产表"
```

---

## Task 6: 历史图片迁移脚本

**Files:**
- Create: `server/scripts/migrate_generated_assets.py`
- Create: `server/tests/test_generated_assets_migration.py`

- [ ] **Step 1: 创建迁移脚本**

脚本必须支持：

```text
--batch-size 200
--dry-run
--after-message-id
```

核心流程：

```python
# 1. 扫描 role='ai' status='done' image_urls IS NOT NULL 的 Message
# 2. 跳过 generated_assets 已存在的 message_id + slot_index
# 3. 调 persist_generated_assets()
# 4. dry-run 时只打印 planned，不写库不写文件
# 5. 每批 commit，失败 rollback 当前批
```

- [ ] **Step 2: 增加幂等测试**

`server/tests/test_generated_assets_migration.py` 覆盖：

```python
async def test_migration_skips_existing_message_slot(self):
    # 已有 message_id + slot_index
    # 跑迁移
    # 断言没有重复记录

async def test_migration_converts_data_url_to_local_asset(self):
    # Message.image_urls = ["data:image/png;base64,..."]
    # 跑迁移
    # 断言 generated_assets.storage_kind == "local"

async def test_migration_marks_known_broken_host_missing(self):
    # Message.image_urls = ["http://67.21.86.146:3015/x.png"]
    # 跑迁移
    # 断言 status == "missing"
```

- [ ] **Step 3: 运行 dry-run**

```powershell
cd D:/webProject/image2/server
python scripts/migrate_generated_assets.py --batch-size 20 --dry-run
```

Expected: 输出 planned 数量，不修改数据库。

- [ ] **Step 4: 运行测试**

```powershell
cd D:/webProject/image2/server
python -m unittest tests.test_generated_assets_migration -v
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/scripts/migrate_generated_assets.py server/tests/test_generated_assets_migration.py
git commit -m "feat(server): 增加历史生成图片资产迁移脚本"
```

---

## Task 7: Redis 与 deep health

**Files:**
- Modify: `server/app/main.py` 或 Create: `server/app/routers/health.py`
- Create: `scripts/start-dev-redis-tunnel.ps1`
- Test: `server/tests/test_health_deep.py`

- [ ] **Step 1: 增加 `/api/health/deep`**

响应形状：

```json
{
  "status": "ok",
  "db": {"ok": true, "latency_ms": 3},
  "redis": {"ok": true, "latency_ms": 2},
  "asset_storage": {"ok": true}
}
```

Redis 失败时：

```json
{
  "status": "degraded",
  "redis": {"ok": false, "error": "connection refused"}
}
```

作品读取不依赖 Redis，因此 Redis degraded 不应该让 health endpoint 500。

- [ ] **Step 2: 创建本地 Redis 隧道脚本**

`scripts/start-dev-redis-tunnel.ps1`：

```powershell
$ErrorActionPreference = "Stop"
$LocalPort = 6381
$RemoteHost = "127.0.0.1"
$RemotePort = 6380
$Server = "82.157.179.191"
$User = "ubuntu"
$Key = "$env:USERPROFILE\.ssh\r6_server"

Write-Host "Starting Redis tunnel: 127.0.0.1:$LocalPort -> $Server:$RemotePort"
ssh -i $Key -N -L "$LocalPort`:$RemoteHost`:$RemotePort" "$User@$Server"
```

- [ ] **Step 3: 增加 health 测试**

覆盖：

```python
async def test_deep_health_returns_ok_when_db_and_redis_available(self):
    ...

async def test_deep_health_degrades_when_redis_fails(self):
    ...
```

- [ ] **Step 4: 运行测试**

```powershell
cd D:/webProject/image2/server
python -m unittest tests.test_health_deep -v
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/app/main.py scripts/start-dev-redis-tunnel.ps1 server/tests/test_health_deep.py
git commit -m "feat(server): 增加深度健康检查与 Redis 隧道脚本"
```

---

## Task 8: 前端与接口验收

**Files:**
- Modify: `client/tests/imageSrcAndTime.test.cjs`

- [ ] **Step 1: 增加前端数据约束测试**

在 `client/tests/imageSrcAndTime.test.cjs` 增加：

```js
assert(!item.image_url.startsWith("data:image"), "作品列表不应返回 data:image");
assert(item.created_at, "作品列表必须返回 created_at");
```

- [ ] **Step 2: 构建前端**

```powershell
cd D:/webProject/image2/client
npm run build
```

Expected: PASS。

- [ ] **Step 3: Chrome MCP 验证**

真实浏览器验证：

```text
登录
打开首页
观察 /api/me/recent-works 200
Network 响应不包含 data:image
最新作品缩略图可以显示
时间标签与 asset.created_at 对齐
Redis 临时断开时，作品列表仍可读取
```

- [ ] **Step 4: 提交**

```bash
git add client/tests/imageSrcAndTime.test.cjs
git commit -m "test(client): 校验作品图片 URL 与时间字段"
```

---

## Task 9: 迁移与切流

**Files:**
- Modify: `docs/specs/2026-06-19-generated-assets-production-architecture-design.md`

- [ ] **Step 1: 本地执行 migration**

```powershell
cd D:/webProject/image2/server
python scripts/migrate_generated_assets.py --batch-size 200 --dry-run
python scripts/migrate_generated_assets.py --batch-size 200
```

Expected:

```text
planned=N
created=N
missing=M
skipped=K
failed=0
```

- [ ] **Step 2: 压测最近作品接口**

```powershell
cd D:/webProject/image2
for ($i = 0; $i -lt 100; $i++) {
  Invoke-RestMethod http://127.0.0.1:5173/api/me/recent-works -Headers @{Authorization="Bearer <token>"} | Out-Null
}
```

Expected: 100 次无 500。

- [ ] **Step 3: 检查 MySQL 执行计划**

```sql
EXPLAIN SELECT *
FROM generated_assets
WHERE user_id = <user_id>
  AND status = 'available'
ORDER BY id DESC
LIMIT 12;
```

Expected: 使用 `idx_asset_user_id` 或等价索引，不出现大表 filesort。

- [ ] **Step 4: 更新 spec 的实际迁移结果**

在 spec “上线阶段”后追加：

```markdown
## 迁移执行记录

- 执行时间：
- 环境：
- dry-run planned：
- created：
- missing：
- skipped：
- failed：
- 验证结果：
```

- [ ] **Step 5: 提交**

```bash
git add docs/specs/2026-06-19-generated-assets-production-architecture-design.md
git commit -m "docs: 记录生成资产迁移结果"
```

---

## 完成定义

- `generated_assets` 表已创建并有索引。
- 新生成/编辑图片会写入 `generated_assets`。
- `/api/me/recent-works` 与 `/api/me/works` 优先读资产表。
- 历史迁移脚本 dry-run 与真实运行都可重复执行。
- 作品接口不返回 `data:image`。
- 旧死链不会再进入前端展示列表。
- Redis 断开不影响作品列表读取。
- `python -m unittest tests.test_recent_works -v` PASS。
- `python -m unittest tests.test_works -v` PASS。
- `python -m unittest tests.test_generated_assets_service -v` PASS。
- `python -m unittest tests.test_generated_assets_migration -v` PASS。
- `npm run build` PASS。
- Chrome MCP 验证最近作品图片真实渲染。

---

## Self-Review

- Spec 覆盖：资产表、存储 seam、双写、读路径、历史迁移、Redis 定位、上线阶段都有对应任务。
- 占位扫描：未发现空任务、泛化描述或需要执行者自行补全的步骤。
- 类型一致性：`GeneratedAsset`、`GeneratedAsset.storage_kind`、`GeneratedAsset.status`、`persist_generated_assets()`、`list_user_assets()` 在任务间命名一致。
- 风险控制：读路径先保留 message fallback，迁移完成后再移除，避免一次切换导致历史作品消失。
