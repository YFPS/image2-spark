# 菜单重构 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把侧栏菜单的「灵感」删除、「历史」改名为「日志」并增加真实日志页（积分流水时间线）、并补全「画廊」页（玩家全部出图，cursor 分页）。

**Architecture:** 后端新增 `GET /api/me/works`（画廊）+ `GET /api/me/logs`（日志），抽出 `works_service.py` 共享最近作品/画廊查询逻辑；前端新建 `pages/GalleryPage.tsx` + `pages/LogsPage.tsx` + 对应 hooks + API 镜像，App.tsx 加 2 个 activeNav 分支。

**Tech Stack:** FastAPI / SQLAlchemy 2.0 asyncio / pydantic v2 / unittest IsolatedAsyncioTestCase / React 18 + TypeScript + Tailwind / IntersectionObserver / chrome-devtools MCP

**Spec：** `docs/specs/2026-05-22-menu-refactor-design.md`

---

## 文件清单

| 文件 | 改动 |
|---|---|
| `server/app/works_service.py` | 创建：共享 `build_works_query` + `message_to_recent_work_item` |
| `server/app/routers/recent_works.py` | 修改：用新 service |
| `server/app/routers/works.py` | 创建：`GET /api/me/works` |
| `server/app/routers/logs.py` | 创建：`GET /api/me/logs` |
| `server/app/schemas.py` | 修改：追加 `WorksPage` / `LogType` / `LogRef` / `LogItem` / `LogsPage` |
| `server/app/main.py` | 修改：注册新路由 |
| `server/tests/test_works.py` | 创建：8 个集成测试 |
| `server/tests/test_logs.py` | 创建：8 个集成测试 |
| `client/src/api/gptImage.ts` | 修改：追加 `fetchWorks` + `WorksPage` |
| `client/src/api/logs.ts` | 创建 |
| `client/src/hooks/useGallery.ts` | 创建 |
| `client/src/hooks/useLogs.ts` | 创建 |
| `client/src/components/LogRow.tsx` | 创建 |
| `client/src/pages/GalleryPage.tsx` | 创建 |
| `client/src/pages/LogsPage.tsx` | 创建 |
| `client/src/App.tsx` | 修改：导航 list 4 项、删 `InspirationIcon`、加 gallery/logs 分支、改 measure 条件 |

---

## Task 1: 抽 works_service.py 公共 helper + 重构 recent_works

**Files:**
- Create: `D:\webProject\image2\server\app\works_service.py`
- Modify: `D:\webProject\image2\server\app\routers\recent_works.py`

- [ ] **Step 1：创建 `server/app/works_service.py`**

```python
"""作品查询共享逻辑

供 `routers/recent_works.py`（固定取 12 条）和 `routers/works.py`（cursor 分页）共用。

设计要点见 docs/specs/2026-05-22-menu-refactor-design.md § 2.1
"""
from __future__ import annotations

from sqlalchemy import Select, and_, select

from .models import Conversation, Message
from .schemas import RecentWorkItem


def build_works_query(user_id: int, *, cursor: int | None = None, limit: int = 12) -> Select:
    """构造 "用户跨会话最近 AI 出图" 的 SQLAlchemy select

    过滤条件：
      - conversation.user_id == user_id
      - conversation.deleted_at IS NULL（软删的会话隐藏）
      - message.role == 'ai'
      - message.status == 'done'
      - message.image_urls IS NOT NULL（DB 层）

    cursor 语义：返回 message.id < cursor 的下一批；None 表示从最新开始。
    排序：id DESC（与 created_at DESC 等价，因为 id 单调递增 + 应用层串行写入）。
    """
    where = [
        Conversation.user_id == user_id,
        Conversation.deleted_at.is_(None),
        Message.role == "ai",
        Message.status == "done",
        Message.image_urls.is_not(None),
    ]
    if cursor is not None:
        where.append(Message.id < cursor)

    return (
        select(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(and_(*where))
        .order_by(Message.id.desc())
        .limit(limit)
    )


def message_to_recent_work_item(m: Message) -> RecentWorkItem | None:
    """Message ORM 对象 → RecentWorkItem schema。

    若 image_urls 为空列表（DB 层 IS NOT NULL 兜不住 "[]" 这种 JSON 空列表），
    返回 None 让调用方跳过——双保险。
    """
    urls = m.image_urls or []
    if not urls:
        return None
    size: str | None = None
    if m.params and isinstance(m.params, dict):
        raw_size = m.params.get("size")
        if isinstance(raw_size, str):
            size = raw_size
    return RecentWorkItem(
        message_id=m.id,
        conversation_id=m.conversation_id,
        image_url=urls[0],
        image_count=len(urls),
        all_image_urls=urls,
        size=size,
        created_at=m.created_at,
    )
```

- [ ] **Step 2：重构 `server/app/routers/recent_works.py` 用新 service**

完整替换为：

```python
"""/api/me/recent-works —— 用户跨会话最近 AI 出图（固定取 RECENT_LIMIT 条）

查询逻辑共享自 works_service；本路由是 works 的"快查"特化形态。
设计要点见 docs/specs/2026-05-22-recent-works-card-design.md
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user
from ..models import User
from ..schemas import RecentWorkItem, RecentWorksOut
from ..works_service import build_works_query, message_to_recent_work_item

router = APIRouter(prefix="/api/me", tags=["recent_works"])

# 与前端 UI 容量一致；改此常量时前端不用同步改
RECENT_LIMIT = 12


@router.get("/recent-works", response_model=RecentWorksOut)
async def list_recent_works(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RecentWorksOut:
    stmt = build_works_query(user.id, limit=RECENT_LIMIT)
    rows = (await db.execute(stmt)).scalars().all()
    items: list[RecentWorkItem] = []
    for m in rows:
        item = message_to_recent_work_item(m)
        if item is not None:
            items.append(item)
    return RecentWorksOut(items=items)
```

- [ ] **Step 3：跑现有 recent_works 测试确认重构无回归**

```powershell
cd D:/webProject/image2/server
.venv/Scripts/activate
python -m unittest tests.test_recent_works -v
```

Expected: 8/8 全过、最末 `OK`。

如果有 FAIL，对照 Task 1 的代码与重构前的 `recent_works.py` 对比；不要继续。

- [ ] **Step 4：提交**

```bash
git -C D:/webProject/image2 add server/app/works_service.py server/app/routers/recent_works.py
git -C D:/webProject/image2 commit -m "refactor(server): 抽 works_service 共享作品查询逻辑"
```

---

## Task 2: 后端 schemas 追加

**Files:**
- Modify: `D:\webProject\image2\server\app\schemas.py`（在文件末尾追加）

- [ ] **Step 1：在 `schemas.py` 末尾追加**

```python
# ===== 画廊（GET /api/me/works）=====


class WorksPage(BaseModel):
    """画廊一页响应：items 复用 RecentWorkItem 的字段；next_cursor 为下一页起点"""

    items: list[RecentWorkItem]
    next_cursor: int | None = None


# ===== 日志（GET /api/me/logs）=====

LogType = Literal[
    "signup_bonus", "recharge", "admin_grant",
    "generate", "edit", "refund", "adjust",
]


class LogRef(BaseModel):
    """日志条目的业务关联（generate / edit 才有）"""

    kind: Literal["message"]
    message_id: int
    conversation_id: int
    thumbnail_url: str | None
    prompt_preview: str | None


class LogItem(BaseModel):
    id: int
    type: LogType
    delta: int
    balance_after: int
    note: str | None
    created_at: datetime
    ref: LogRef | None = None


class LogsPage(BaseModel):
    items: list[LogItem]
    next_cursor: int | None = None
```

- [ ] **Step 2：验证 Python 能正常导入**

```powershell
cd D:/webProject/image2/server
.venv/Scripts/activate
python -c "from app.schemas import WorksPage, LogItem, LogsPage, LogRef; print('OK')"
```

Expected: 打印 `OK`。

- [ ] **Step 3：提交**

```bash
git -C D:/webProject/image2 add server/app/schemas.py
git -C D:/webProject/image2 commit -m "feat(server): 加 WorksPage / LogItem / LogsPage / LogRef schema"
```

---

## Task 3: works 路由 + 测试 + 实现（RED → GREEN）

**Files:**
- Create: `D:\webProject\image2\server\app\routers\works.py`
- Create: `D:\webProject\image2\server\tests\test_works.py`
- Modify: `D:\webProject\image2\server\app\main.py`

- [ ] **Step 1：创建 `server/app/routers/works.py` 完整实现**（直接 GREEN，不走占位—— RED 阶段在测试 commit 那里）

```python
"""/api/me/works —— 用户全部 AI 出图（cursor 分页）

设计要点见 docs/specs/2026-05-22-menu-refactor-design.md § 2.1
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user
from ..models import User
from ..schemas import RecentWorkItem, WorksPage
from ..works_service import build_works_query, message_to_recent_work_item

router = APIRouter(prefix="/api/me", tags=["works"])

PAGE_LIMIT = 24
PAGE_LIMIT_MAX = 60


@router.get("/works", response_model=WorksPage)
async def list_works(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    cursor: int | None = Query(None, ge=1, description="上一页最后一条 message_id；不传则取最新"),
    limit: int = Query(PAGE_LIMIT, ge=1, le=PAGE_LIMIT_MAX),
) -> WorksPage:
    # 多取一条用来判定 has_more
    stmt = build_works_query(user.id, cursor=cursor, limit=limit + 1)
    rows = (await db.execute(stmt)).scalars().all()
    has_more = len(rows) > limit
    rows = rows[:limit]

    items: list[RecentWorkItem] = []
    for m in rows:
        item = message_to_recent_work_item(m)
        if item is not None:
            items.append(item)

    next_cursor = items[-1].message_id if has_more and items else None
    return WorksPage(items=items, next_cursor=next_cursor)
```

- [ ] **Step 2：修改 `server/app/main.py` 注册路由**

找到（约第 20 行）：
```python
from .routers import auth, conversations, images, recent_works
```
改为：
```python
from .routers import auth, conversations, images, recent_works, works
```

找到（约第 135 行）：
```python
app.include_router(recent_works.router)
```
之后追加一行：
```python
app.include_router(recent_works.router)
app.include_router(works.router)
```

- [ ] **Step 3：创建 `server/tests/test_works.py`**

```python
"""works 路由集成测试

跑：
  cd D:/webProject/image2/server
  python -m unittest tests.test_works
"""
from __future__ import annotations

import os
import unittest
import uuid
from datetime import datetime, timedelta
from urllib.parse import urlparse, urlunparse

from dotenv import load_dotenv

load_dotenv()
os.environ["EMAIL_PROVIDER"] = "null"

_redis_test_url = os.getenv("REDIS_URL_TEST")
if not _redis_test_url:
    _orig = os.getenv("REDIS_URL", "")
    if _orig:
        parsed = urlparse(_orig)
        os.environ["REDIS_URL"] = urlunparse(parsed._replace(path="/15"))
else:
    os.environ["REDIS_URL"] = _redis_test_url

_DB_OK = bool(os.getenv("DATABASE_URL"))
_REDIS_OK = bool(os.getenv("REDIS_URL"))
_JWT_OK = bool(os.getenv("JWT_SECRET"))

if _DB_OK and _REDIS_OK and _JWT_OK:
    import httpx  # noqa: E402
    from sqlalchemy import delete  # noqa: E402

    from app.db import get_engine, get_session_factory  # noqa: E402
    from app.main import app  # noqa: E402
    from app.models import (  # noqa: E402
        Conversation,
        CreditTransaction,
        EmailVerificationToken,
        Message,
        User,
    )
    from app.redis_client import get_redis  # noqa: E402


def _rand_email() -> str:
    return f"test-{uuid.uuid4().hex[:12]}@example.com"


@unittest.skipUnless(
    _DB_OK and _REDIS_OK and _JWT_OK,
    "DATABASE_URL / REDIS_URL / JWT_SECRET 未配置，跳过集成测试",
)
class WorksTests(unittest.IsolatedAsyncioTestCase):
    created_emails: list[str]
    created_conv_ids: list[int]

    async def asyncSetUp(self) -> None:
        self.created_emails = []
        self.created_conv_ids = []

        get_engine.cache_clear()
        get_session_factory.cache_clear()
        get_redis.cache_clear()

        redis = get_redis()
        await redis.flushdb()

        transport = httpx.ASGITransport(app=app)
        self.client = httpx.AsyncClient(transport=transport, base_url="http://test")
        await self.client.__aenter__()

    async def asyncTearDown(self) -> None:
        factory = get_session_factory()
        async with factory() as s:
            if self.created_conv_ids:
                await s.execute(
                    delete(Conversation).where(Conversation.id.in_(self.created_conv_ids))
                )
            if self.created_emails:
                rows = await s.execute(
                    User.__table__.select().where(User.email.in_(self.created_emails))
                )
                ids = [r.id for r in rows.fetchall()]
                if ids:
                    await s.execute(
                        delete(EmailVerificationToken).where(EmailVerificationToken.user_id.in_(ids))
                    )
                    await s.execute(
                        delete(CreditTransaction).where(CreditTransaction.user_id.in_(ids))
                    )
                    await s.execute(delete(User).where(User.id.in_(ids)))
            await s.commit()
        await self.client.__aexit__(None, None, None)
        await get_engine().dispose()
        await get_redis().aclose()

    # ===== helpers =====

    async def _register_and_login(self) -> tuple[int, str]:
        email = _rand_email()
        self.created_emails.append(email.lower())
        r = await self.client.post(
            "/api/auth/register",
            json={"email": email, "password": "Hunter2_pw"},
        )
        self.assertEqual(r.status_code, 201, r.text)
        body = r.json()
        return body["user"]["id"], body["access_token"]

    async def _create_conv(self, user_id: int, deleted: bool = False) -> int:
        factory = get_session_factory()
        async with factory() as s:
            conv = Conversation(user_id=user_id, title="test")
            if deleted:
                conv.deleted_at = datetime.utcnow()
            s.add(conv)
            await s.flush()
            cid = conv.id
            await s.commit()
        self.created_conv_ids.append(cid)
        return cid

    async def _add_msg(
        self,
        conv_id: int,
        *,
        image_urls: list[str] | None = None,
        params: dict | None = None,
        created_at: datetime | None = None,
    ) -> int:
        factory = get_session_factory()
        async with factory() as s:
            m = Message(
                conversation_id=conv_id,
                role="ai",
                text="",
                image_urls=image_urls,
                params=params,
                status="done",
            )
            if created_at:
                m.created_at = created_at
            s.add(m)
            await s.flush()
            mid = m.id
            await s.commit()
        return mid

    def _auth(self, token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    # ===== 用例 =====

    async def test_unauthorized_returns_401(self):
        r = await self.client.get("/api/me/works")
        self.assertEqual(r.status_code, 401)

    async def test_empty_returns_empty_items(self):
        _uid, token = await self._register_and_login()
        r = await self.client.get("/api/me/works", headers=self._auth(token))
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertEqual(data["items"], [])
        self.assertIsNone(data["next_cursor"])

    async def test_first_page_default_limit_24(self):
        """写 26 条 → 返 24 条 + next_cursor 非空"""
        uid, token = await self._register_and_login()
        cid = await self._create_conv(uid)
        base = datetime.utcnow()
        for i in range(26):
            await self._add_msg(
                cid,
                image_urls=[f"img-{i}.png"],
                created_at=base - timedelta(minutes=i),
            )
        r = await self.client.get("/api/me/works", headers=self._auth(token))
        data = r.json()
        self.assertEqual(len(data["items"]), 24)
        self.assertIsNotNone(data["next_cursor"])

    async def test_pagination_with_cursor(self):
        """24 条第一页 + 用 next_cursor 拿剩下"""
        uid, token = await self._register_and_login()
        cid = await self._create_conv(uid)
        base = datetime.utcnow()
        ids = []
        for i in range(30):
            mid = await self._add_msg(
                cid,
                image_urls=[f"img-{i}.png"],
                created_at=base - timedelta(minutes=i),
            )
            ids.append(mid)

        r1 = await self.client.get("/api/me/works", headers=self._auth(token))
        d1 = r1.json()
        self.assertEqual(len(d1["items"]), 24)
        cursor = d1["next_cursor"]
        self.assertIsNotNone(cursor)

        r2 = await self.client.get(
            f"/api/me/works?cursor={cursor}", headers=self._auth(token)
        )
        d2 = r2.json()
        self.assertEqual(len(d2["items"]), 6)  # 30 - 24
        self.assertIsNone(d2["next_cursor"])

    async def test_custom_limit(self):
        uid, token = await self._register_and_login()
        cid = await self._create_conv(uid)
        for i in range(10):
            await self._add_msg(cid, image_urls=[f"img-{i}.png"])
        r = await self.client.get(
            "/api/me/works?limit=5", headers=self._auth(token)
        )
        data = r.json()
        self.assertEqual(len(data["items"]), 5)
        self.assertIsNotNone(data["next_cursor"])

    async def test_limit_over_max_returns_422(self):
        _uid, token = await self._register_and_login()
        r = await self.client.get("/api/me/works?limit=100", headers=self._auth(token))
        self.assertEqual(r.status_code, 422)

    async def test_isolates_other_users(self):
        a_uid, a_token = await self._register_and_login()
        a_cid = await self._create_conv(a_uid)
        for i in range(5):
            await self._add_msg(a_cid, image_urls=[f"a-{i}.png"])

        b_uid, _b_token = await self._register_and_login()
        b_cid = await self._create_conv(b_uid)
        for i in range(3):
            await self._add_msg(b_cid, image_urls=[f"b-{i}.png"])

        r = await self.client.get("/api/me/works", headers=self._auth(a_token))
        urls = [it["image_url"] for it in r.json()["items"]]
        self.assertEqual(len(urls), 5)
        self.assertTrue(all(u.startswith("a-") for u in urls))

    async def test_excludes_soft_deleted_conv(self):
        uid, token = await self._register_and_login()
        live_cid = await self._create_conv(uid)
        dead_cid = await self._create_conv(uid, deleted=True)
        await self._add_msg(live_cid, image_urls=["live.png"])
        await self._add_msg(dead_cid, image_urls=["dead.png"])

        r = await self.client.get("/api/me/works", headers=self._auth(token))
        items = r.json()["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["image_url"], "live.png")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 4：跑测试，预期 8/8 PASS（已直接实现，不走 RED 阶段）**

```powershell
cd D:/webProject/image2/server
.venv/Scripts/activate
python -m unittest tests.test_works -v
```

Expected: `Ran 8 tests`、最末 `OK`。

如果有 FAIL，按报错对照 spec § 2.1 + Task 1 的 service 函数。不要继续。

- [ ] **Step 5：再跑一次 recent_works 测试确保未回归**

```powershell
python -m unittest tests.test_recent_works -v
```

Expected: 8/8 PASS。

- [ ] **Step 6：提交**

```bash
git -C D:/webProject/image2 add server/app/routers/works.py server/app/main.py server/tests/test_works.py
git -C D:/webProject/image2 commit -m "feat(server): GET /api/me/works 画廊接口 + 8 集成测试"
```

---

## Task 4: logs 路由 + 测试

**Files:**
- Create: `D:\webProject\image2\server\app\routers\logs.py`
- Create: `D:\webProject\image2\server\tests\test_logs.py`
- Modify: `D:\webProject\image2\server\app\main.py`

- [ ] **Step 1：创建 `server/app/routers/logs.py`**

```python
"""/api/me/logs —— 用户积分流水时间线（cursor 分页）

reason ∈ {generate, edit} 的行会额外 join messages 拿缩略图 + prompt 摘要。
设计要点见 docs/specs/2026-05-22-menu-refactor-design.md § 2.2
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user
from ..models import CreditTransaction, Message, User
from ..schemas import LogItem, LogRef, LogsPage

router = APIRouter(prefix="/api/me", tags=["logs"])

PAGE_LIMIT = 50
PAGE_LIMIT_MAX = 200
PROMPT_PREVIEW_LEN = 80


@router.get("/logs", response_model=LogsPage)
async def list_logs(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    cursor: int | None = Query(None, ge=1),
    limit: int = Query(PAGE_LIMIT, ge=1, le=PAGE_LIMIT_MAX),
) -> LogsPage:
    where = [CreditTransaction.user_id == user.id]
    if cursor is not None:
        where.append(CreditTransaction.id < cursor)

    stmt = (
        select(CreditTransaction)
        .where(and_(*where))
        .order_by(CreditTransaction.id.desc())
        .limit(limit + 1)
    )
    rows = (await db.execute(stmt)).scalars().all()
    has_more = len(rows) > limit
    rows = rows[:limit]

    # 批量加载 ref_type='message' 的 messages（避免 N+1）
    msg_ids: list[int] = []
    for r in rows:
        if r.ref_type == "message" and r.ref_id is not None:
            try:
                msg_ids.append(int(r.ref_id))
            except ValueError:
                continue
    msgs_by_id: dict[int, Message] = {}
    if msg_ids:
        m_stmt = select(Message).where(Message.id.in_(msg_ids))
        for m in (await db.execute(m_stmt)).scalars().all():
            msgs_by_id[m.id] = m

    items: list[LogItem] = []
    for tx in rows:
        ref: LogRef | None = None
        if tx.ref_type == "message" and tx.ref_id is not None:
            try:
                mid = int(tx.ref_id)
            except ValueError:
                mid = None
            if mid is not None and mid in msgs_by_id:
                m = msgs_by_id[mid]
                urls = m.image_urls or []
                prompt = (m.text or "").strip()[:PROMPT_PREVIEW_LEN] if m.text else None
                ref = LogRef(
                    kind="message",
                    message_id=m.id,
                    conversation_id=m.conversation_id,
                    thumbnail_url=urls[0] if urls else None,
                    prompt_preview=prompt,
                )
        items.append(
            LogItem(
                id=tx.id,
                type=tx.reason,
                delta=tx.delta,
                balance_after=tx.balance_after,
                note=tx.note,
                created_at=tx.created_at,
                ref=ref,
            )
        )

    next_cursor = items[-1].id if has_more and items else None
    return LogsPage(items=items, next_cursor=next_cursor)
```

- [ ] **Step 2：修改 `server/app/main.py` 注册路由**

找到上一个 task 已经注册的 works：
```python
from .routers import auth, conversations, images, recent_works, works
```
改为：
```python
from .routers import auth, conversations, images, logs, recent_works, works
```

找到（约第 136 行 Task 3 已加的）：
```python
app.include_router(works.router)
```
之后追加：
```python
app.include_router(works.router)
app.include_router(logs.router)
```

- [ ] **Step 3：创建 `server/tests/test_logs.py`**

```python
"""logs 路由集成测试

跑：
  cd D:/webProject/image2/server
  python -m unittest tests.test_logs
"""
from __future__ import annotations

import os
import unittest
import uuid
from datetime import datetime
from urllib.parse import urlparse, urlunparse

from dotenv import load_dotenv

load_dotenv()
os.environ["EMAIL_PROVIDER"] = "null"

_redis_test_url = os.getenv("REDIS_URL_TEST")
if not _redis_test_url:
    _orig = os.getenv("REDIS_URL", "")
    if _orig:
        parsed = urlparse(_orig)
        os.environ["REDIS_URL"] = urlunparse(parsed._replace(path="/15"))
else:
    os.environ["REDIS_URL"] = _redis_test_url

_DB_OK = bool(os.getenv("DATABASE_URL"))
_REDIS_OK = bool(os.getenv("REDIS_URL"))
_JWT_OK = bool(os.getenv("JWT_SECRET"))

if _DB_OK and _REDIS_OK and _JWT_OK:
    import httpx  # noqa: E402
    from sqlalchemy import delete  # noqa: E402

    from app.db import get_engine, get_session_factory  # noqa: E402
    from app.main import app  # noqa: E402
    from app.models import (  # noqa: E402
        Conversation,
        CreditTransaction,
        EmailVerificationToken,
        Message,
        User,
    )
    from app.redis_client import get_redis  # noqa: E402


def _rand_email() -> str:
    return f"test-{uuid.uuid4().hex[:12]}@example.com"


@unittest.skipUnless(
    _DB_OK and _REDIS_OK and _JWT_OK,
    "DATABASE_URL / REDIS_URL / JWT_SECRET 未配置，跳过集成测试",
)
class LogsTests(unittest.IsolatedAsyncioTestCase):
    created_emails: list[str]
    created_conv_ids: list[int]

    async def asyncSetUp(self) -> None:
        self.created_emails = []
        self.created_conv_ids = []

        get_engine.cache_clear()
        get_session_factory.cache_clear()
        get_redis.cache_clear()

        redis = get_redis()
        await redis.flushdb()

        transport = httpx.ASGITransport(app=app)
        self.client = httpx.AsyncClient(transport=transport, base_url="http://test")
        await self.client.__aenter__()

    async def asyncTearDown(self) -> None:
        factory = get_session_factory()
        async with factory() as s:
            if self.created_conv_ids:
                await s.execute(
                    delete(Conversation).where(Conversation.id.in_(self.created_conv_ids))
                )
            if self.created_emails:
                rows = await s.execute(
                    User.__table__.select().where(User.email.in_(self.created_emails))
                )
                ids = [r.id for r in rows.fetchall()]
                if ids:
                    await s.execute(
                        delete(EmailVerificationToken).where(EmailVerificationToken.user_id.in_(ids))
                    )
                    await s.execute(
                        delete(CreditTransaction).where(CreditTransaction.user_id.in_(ids))
                    )
                    await s.execute(delete(User).where(User.id.in_(ids)))
            await s.commit()
        await self.client.__aexit__(None, None, None)
        await get_engine().dispose()
        await get_redis().aclose()

    # ===== helpers =====

    async def _register_and_login(self) -> tuple[int, str]:
        email = _rand_email()
        self.created_emails.append(email.lower())
        r = await self.client.post(
            "/api/auth/register",
            json={"email": email, "password": "Hunter2_pw"},
        )
        self.assertEqual(r.status_code, 201, r.text)
        body = r.json()
        return body["user"]["id"], body["access_token"]

    async def _create_conv(self, user_id: int) -> int:
        factory = get_session_factory()
        async with factory() as s:
            conv = Conversation(user_id=user_id, title="test")
            s.add(conv)
            await s.flush()
            cid = conv.id
            await s.commit()
        self.created_conv_ids.append(cid)
        return cid

    async def _add_msg(
        self,
        conv_id: int,
        *,
        text: str = "",
        image_urls: list[str] | None = None,
    ) -> int:
        factory = get_session_factory()
        async with factory() as s:
            m = Message(
                conversation_id=conv_id,
                role="ai",
                text=text,
                image_urls=image_urls,
                status="done",
            )
            s.add(m)
            await s.flush()
            mid = m.id
            await s.commit()
        return mid

    async def _add_txn(
        self,
        user_id: int,
        *,
        delta: int,
        balance_after: int,
        reason: str,
        ref_type: str | None = None,
        ref_id: str | None = None,
        note: str | None = None,
    ) -> int:
        factory = get_session_factory()
        async with factory() as s:
            tx = CreditTransaction(
                user_id=user_id,
                delta=delta,
                balance_after=balance_after,
                reason=reason,
                ref_type=ref_type,
                ref_id=ref_id,
                note=note,
            )
            s.add(tx)
            await s.flush()
            tid = tx.id
            await s.commit()
        return tid

    def _auth(self, token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    # ===== 用例 =====

    async def test_unauthorized_returns_401(self):
        r = await self.client.get("/api/me/logs")
        self.assertEqual(r.status_code, 401)

    async def test_empty_returns_empty_items(self):
        _uid, token = await self._register_and_login()
        # 注册流程不发 signup_bonus（spec 已说明：要等邮箱验证），所以这里 items=[]
        r = await self.client.get("/api/me/logs", headers=self._auth(token))
        self.assertEqual(r.status_code, 200, r.text)
        data = r.json()
        self.assertEqual(data["items"], [])
        self.assertIsNone(data["next_cursor"])

    async def test_includes_all_reason_types(self):
        """7 种 reason 各一条都应该出现"""
        uid, token = await self._register_and_login()
        reasons = ["signup_bonus", "recharge", "admin_grant", "generate", "edit", "refund", "adjust"]
        for i, reason in enumerate(reasons):
            await self._add_txn(uid, delta=1 if i % 2 == 0 else -1, balance_after=10 + i, reason=reason)

        r = await self.client.get("/api/me/logs", headers=self._auth(token))
        items = r.json()["items"]
        self.assertEqual(len(items), 7)
        types = {it["type"] for it in items}
        self.assertEqual(types, set(reasons))

    async def test_ordered_desc_by_id(self):
        uid, token = await self._register_and_login()
        ids = []
        for i in range(5):
            tid = await self._add_txn(uid, delta=1, balance_after=i, reason="adjust")
            ids.append(tid)
        # ids 升序生成，期望返回时是降序
        r = await self.client.get("/api/me/logs", headers=self._auth(token))
        items = r.json()["items"]
        self.assertEqual([it["id"] for it in items], list(reversed(ids)))

    async def test_pagination_with_cursor(self):
        uid, token = await self._register_and_login()
        for i in range(60):
            await self._add_txn(uid, delta=1, balance_after=i, reason="adjust")
        r1 = await self.client.get("/api/me/logs", headers=self._auth(token))
        d1 = r1.json()
        self.assertEqual(len(d1["items"]), 50)
        cursor = d1["next_cursor"]
        self.assertIsNotNone(cursor)

        r2 = await self.client.get(
            f"/api/me/logs?cursor={cursor}", headers=self._auth(token)
        )
        d2 = r2.json()
        self.assertEqual(len(d2["items"]), 10)  # 60 - 50
        self.assertIsNone(d2["next_cursor"])

    async def test_generate_row_has_ref_with_thumbnail(self):
        uid, token = await self._register_and_login()
        cid = await self._create_conv(uid)
        mid = await self._add_msg(
            cid, text="一只猫坐在窗台", image_urls=["thumb.png", "x.png"]
        )
        await self._add_txn(
            uid,
            delta=-1,
            balance_after=4,
            reason="generate",
            ref_type="message",
            ref_id=str(mid),
        )
        r = await self.client.get("/api/me/logs", headers=self._auth(token))
        item = r.json()["items"][0]
        self.assertEqual(item["type"], "generate")
        self.assertIsNotNone(item["ref"])
        self.assertEqual(item["ref"]["kind"], "message")
        self.assertEqual(item["ref"]["message_id"], mid)
        self.assertEqual(item["ref"]["thumbnail_url"], "thumb.png")
        self.assertEqual(item["ref"]["prompt_preview"], "一只猫坐在窗台")

    async def test_recharge_row_has_no_ref(self):
        uid, token = await self._register_and_login()
        await self._add_txn(uid, delta=10, balance_after=15, reason="recharge", note="test pay")
        r = await self.client.get("/api/me/logs", headers=self._auth(token))
        item = r.json()["items"][0]
        self.assertEqual(item["type"], "recharge")
        self.assertIsNone(item["ref"])
        self.assertEqual(item["note"], "test pay")

    async def test_isolates_other_users(self):
        a_uid, a_token = await self._register_and_login()
        for _ in range(3):
            await self._add_txn(a_uid, delta=1, balance_after=10, reason="adjust", note="A")

        b_uid, _b_token = await self._register_and_login()
        for _ in range(5):
            await self._add_txn(b_uid, delta=1, balance_after=10, reason="adjust", note="B")

        r = await self.client.get("/api/me/logs", headers=self._auth(a_token))
        items = r.json()["items"]
        self.assertEqual(len(items), 3)
        self.assertTrue(all(it["note"] == "A" for it in items))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 4：跑测试 8/8 PASS**

```powershell
cd D:/webProject/image2/server
.venv/Scripts/activate
python -m unittest tests.test_logs -v
```

Expected: `Ran 8 tests`、`OK`。

- [ ] **Step 5：跑全量后端测试确认无回归**

```powershell
python -m unittest tests.test_logs tests.test_works tests.test_recent_works -v
```

Expected: 24 个用例全过。

- [ ] **Step 6：提交**

```bash
git -C D:/webProject/image2 add server/app/routers/logs.py server/app/main.py server/tests/test_logs.py
git -C D:/webProject/image2 commit -m "feat(server): GET /api/me/logs 日志接口 + 8 集成测试"
```

---

## Task 5: 前端 API 镜像（fetchWorks + logs.ts）

**Files:**
- Modify: `D:\webProject\image2\client\src\api\gptImage.ts`（末尾追加）
- Create: `D:\webProject\image2\client\src\api\logs.ts`

- [ ] **Step 1：在 `gptImage.ts` 末尾追加**

```ts
// ===== 画廊（GET /api/me/works）=====

export type WorksPage = {
  items: RecentWorkItem[];
  next_cursor: number | null;
};

export async function fetchWorks(opts?: {
  cursor?: number | null;
  limit?: number;
}): Promise<WorksPage> {
  const params = new URLSearchParams();
  if (opts?.cursor != null) params.set("cursor", String(opts.cursor));
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const res = await authFetch(`/api/me/works${qs ? `?${qs}` : ""}`);
  if (!res.ok) {
    throw new Error(`fetchWorks failed: ${res.status}`);
  }
  return (await res.json()) as WorksPage;
}
```

- [ ] **Step 2：创建 `client/src/api/logs.ts`**

```ts
import { authFetch } from "./auth";

export type LogType =
  | "signup_bonus"
  | "recharge"
  | "admin_grant"
  | "generate"
  | "edit"
  | "refund"
  | "adjust";

export type LogRef = {
  kind: "message";
  message_id: number;
  conversation_id: number;
  thumbnail_url: string | null;
  prompt_preview: string | null;
};

export type LogItem = {
  id: number;
  type: LogType;
  delta: number;
  balance_after: number;
  note: string | null;
  created_at: string; // ISO
  ref: LogRef | null;
};

export type LogsPage = {
  items: LogItem[];
  next_cursor: number | null;
};

export async function fetchLogs(opts?: {
  cursor?: number | null;
  limit?: number;
}): Promise<LogsPage> {
  const params = new URLSearchParams();
  if (opts?.cursor != null) params.set("cursor", String(opts.cursor));
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const res = await authFetch(`/api/me/logs${qs ? `?${qs}` : ""}`);
  if (!res.ok) {
    throw new Error(`fetchLogs failed: ${res.status}`);
  }
  return (await res.json()) as LogsPage;
}
```

- [ ] **Step 3：tsc 验证**

```powershell
cd D:/webProject/image2/client
npm run build
```

Expected: 构建通过。

- [ ] **Step 4：提交**

```bash
git -C D:/webProject/image2 add client/src/api/gptImage.ts client/src/api/logs.ts
git -C D:/webProject/image2 commit -m "feat(client): 添加 fetchWorks / fetchLogs API 镜像"
```

---

## Task 6: useGallery hook

**Files:**
- Create: `D:\webProject\image2\client\src\hooks\useGallery.ts`

- [ ] **Step 1：创建 `client/src/hooks/useGallery.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";

import { fetchWorks, type RecentWorkItem } from "../api/gptImage";
import { useAuth } from "../auth/AuthContext";

type State = {
  items: RecentWorkItem[];
  nextCursor: number | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  endReached: boolean;
};

const INITIAL: State = {
  items: [],
  nextCursor: null,
  loading: false,
  loadingMore: false,
  error: null,
  endReached: false,
};

/**
 * 画廊分页 hook：
 *  - 登入后挂载 reload 拿第一页
 *  - loadMore 拿下一页（用 state.nextCursor）
 *  - 防竞态：reqSeqRef 递增、旧请求丢弃
 *  - endReached: next_cursor === null
 */
export function useGallery() {
  const { user } = useAuth();
  const [state, setState] = useState<State>(INITIAL);
  const reqSeqRef = useRef(0);
  // 用 ref 跟踪当前 cursor，避免闭包陈旧
  const cursorRef = useRef<number | null>(null);

  const reload = useCallback(async () => {
    if (!user) {
      setState(INITIAL);
      cursorRef.current = null;
      return;
    }
    const seq = ++reqSeqRef.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const page = await fetchWorks();
      if (seq !== reqSeqRef.current) return;
      cursorRef.current = page.next_cursor;
      setState({
        items: page.items,
        nextCursor: page.next_cursor,
        loading: false,
        loadingMore: false,
        error: null,
        endReached: page.next_cursor === null,
      });
    } catch (e) {
      if (seq !== reqSeqRef.current) return;
      console.warn("[gallery] reload failed:", e);
      setState((s) => ({ ...s, loading: false, error: String(e) }));
    }
  }, [user]);

  const loadMore = useCallback(async () => {
    if (!user) return;
    const cursor = cursorRef.current;
    if (cursor == null) return;
    // 用 setState 的 functional form 避免重复加载
    let shouldFire = false;
    setState((s) => {
      if (s.endReached || s.loading || s.loadingMore) return s;
      shouldFire = true;
      return { ...s, loadingMore: true };
    });
    if (!shouldFire) return;

    const seq = ++reqSeqRef.current;
    try {
      const page = await fetchWorks({ cursor });
      if (seq !== reqSeqRef.current) return;
      cursorRef.current = page.next_cursor;
      setState((s) => ({
        ...s,
        items: [...s.items, ...page.items],
        nextCursor: page.next_cursor,
        loadingMore: false,
        endReached: page.next_cursor === null,
      }));
    } catch (e) {
      if (seq !== reqSeqRef.current) return;
      console.warn("[gallery] loadMore failed:", e);
      setState((s) => ({ ...s, loadingMore: false, error: String(e) }));
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setState(INITIAL);
      cursorRef.current = null;
      reqSeqRef.current++;
      return;
    }
    void reload();
  }, [user, reload]);

  return {
    items: state.items,
    loading: state.loading,
    loadingMore: state.loadingMore,
    error: state.error,
    endReached: state.endReached,
    reload,
    loadMore,
  };
}
```

- [ ] **Step 2：tsc 验证**

```powershell
cd D:/webProject/image2/client
npm run build
```

Expected: 构建通过。

- [ ] **Step 3：提交**

```bash
git -C D:/webProject/image2 add client/src/hooks/useGallery.ts
git -C D:/webProject/image2 commit -m "feat(client): 添加 useGallery hook（cursor 分页）"
```

---

## Task 7: useLogs hook

**Files:**
- Create: `D:\webProject\image2\client\src\hooks\useLogs.ts`

- [ ] **Step 1：创建 `client/src/hooks/useLogs.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";

import { fetchLogs, type LogItem } from "../api/logs";
import { useAuth } from "../auth/AuthContext";

type State = {
  items: LogItem[];
  nextCursor: number | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  endReached: boolean;
};

const INITIAL: State = {
  items: [],
  nextCursor: null,
  loading: false,
  loadingMore: false,
  error: null,
  endReached: false,
};

/**
 * 日志分页 hook：与 useGallery 同形，只是 item shape 不同。
 */
export function useLogs() {
  const { user } = useAuth();
  const [state, setState] = useState<State>(INITIAL);
  const reqSeqRef = useRef(0);
  const cursorRef = useRef<number | null>(null);

  const reload = useCallback(async () => {
    if (!user) {
      setState(INITIAL);
      cursorRef.current = null;
      return;
    }
    const seq = ++reqSeqRef.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const page = await fetchLogs();
      if (seq !== reqSeqRef.current) return;
      cursorRef.current = page.next_cursor;
      setState({
        items: page.items,
        nextCursor: page.next_cursor,
        loading: false,
        loadingMore: false,
        error: null,
        endReached: page.next_cursor === null,
      });
    } catch (e) {
      if (seq !== reqSeqRef.current) return;
      console.warn("[logs] reload failed:", e);
      setState((s) => ({ ...s, loading: false, error: String(e) }));
    }
  }, [user]);

  const loadMore = useCallback(async () => {
    if (!user) return;
    const cursor = cursorRef.current;
    if (cursor == null) return;
    let shouldFire = false;
    setState((s) => {
      if (s.endReached || s.loading || s.loadingMore) return s;
      shouldFire = true;
      return { ...s, loadingMore: true };
    });
    if (!shouldFire) return;

    const seq = ++reqSeqRef.current;
    try {
      const page = await fetchLogs({ cursor });
      if (seq !== reqSeqRef.current) return;
      cursorRef.current = page.next_cursor;
      setState((s) => ({
        ...s,
        items: [...s.items, ...page.items],
        nextCursor: page.next_cursor,
        loadingMore: false,
        endReached: page.next_cursor === null,
      }));
    } catch (e) {
      if (seq !== reqSeqRef.current) return;
      console.warn("[logs] loadMore failed:", e);
      setState((s) => ({ ...s, loadingMore: false, error: String(e) }));
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setState(INITIAL);
      cursorRef.current = null;
      reqSeqRef.current++;
      return;
    }
    void reload();
  }, [user, reload]);

  return {
    items: state.items,
    loading: state.loading,
    loadingMore: state.loadingMore,
    error: state.error,
    endReached: state.endReached,
    reload,
    loadMore,
  };
}
```

- [ ] **Step 2：tsc 验证**

```powershell
cd D:/webProject/image2/client
npm run build
```

Expected: 构建通过。

- [ ] **Step 3：提交**

```bash
git -C D:/webProject/image2 add client/src/hooks/useLogs.ts
git -C D:/webProject/image2 commit -m "feat(client): 添加 useLogs hook（cursor 分页）"
```

---

## Task 8: LogRow 组件

**Files:**
- Create: `D:\webProject\image2\client\src\components\LogRow.tsx`

- [ ] **Step 1：创建 `client/src/components/LogRow.tsx`**

```tsx
import type { LogItem } from "../api/logs";
import { formatRelativeTime } from "../utils/relativeTime";

type Props = {
  item: LogItem;
  onPreview: (src: string) => void;
};

const TYPE_LABEL: Record<LogItem["type"], string> = {
  signup_bonus: "注册赠送",
  recharge: "充值",
  admin_grant: "管理员发放",
  generate: "文生图",
  edit: "图像编辑",
  refund: "退款",
  adjust: "调整",
};

export function LogRow({ item, onPreview }: Props) {
  const isGen = item.type === "generate" || item.type === "edit";
  const thumb = item.ref?.thumbnail_url ?? null;
  const prompt = item.ref?.prompt_preview;
  const positive = item.delta > 0;

  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-white/[0.04] bg-white/[0.02] p-3 hover:bg-white/[0.04]">
      {/* 左侧缩略图 / 占位 */}
      {isGen && thumb ? (
        <button
          type="button"
          onClick={() => onPreview(thumb)}
          className="h-12 w-12 shrink-0 overflow-hidden rounded-[10px] border border-white/[0.05] bg-[#111114]"
        >
          <img
            src={thumb}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
            }}
          />
        </button>
      ) : (
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-[10px] bg-white/[0.04] text-[16px] text-white/55">
          {positive ? "+" : "—"}
        </div>
      )}

      {/* 中间：动作 + prompt 摘要 / note */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-white/92">{TYPE_LABEL[item.type]}</span>
          <span className="text-[11px] text-white/45">{formatRelativeTime(item.created_at)}</span>
        </div>
        {prompt ? (
          <div className="mt-0.5 truncate text-[12px] text-white/55">{prompt}</div>
        ) : item.note ? (
          <div className="mt-0.5 truncate text-[12px] text-white/45">{item.note}</div>
        ) : null}
      </div>

      {/* 右侧：积分变动 + 余额 */}
      <div className="flex shrink-0 flex-col items-end">
        <span
          className={`text-[14px] font-semibold tabular-nums ${
            positive ? "text-emerald-400" : "text-white/72"
          }`}
        >
          {positive ? "+" : ""}
          {item.delta}
        </span>
        <span className="text-[10px] text-white/40 tabular-nums">余 {item.balance_after}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2：tsc 验证**

```powershell
cd D:/webProject/image2/client
npm run build
```

Expected: 构建通过。

- [ ] **Step 3：提交**

```bash
git -C D:/webProject/image2 add client/src/components/LogRow.tsx
git -C D:/webProject/image2 commit -m "feat(client): 添加 LogRow 组件"
```

---

## Task 9: GalleryPage

**Files:**
- Create: `D:\webProject\image2\client\src\pages\GalleryPage.tsx`

- [ ] **Step 1：创建 `client/src/pages/GalleryPage.tsx`**

```tsx
import { useEffect, useRef } from "react";

import { useAuth } from "../auth/AuthContext";
import { useGallery } from "../hooks/useGallery";
import { formatRelativeTime } from "../utils/relativeTime";

type Props = {
  onPreview: (src: string) => void;
};

export function GalleryPage({ onPreview }: Props) {
  const { user } = useAuth();
  const { items, loading, loadingMore, endReached, loadMore } = useGallery();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // IntersectionObserver 触底加载
  useEffect(() => {
    if (!sentinelRef.current) return;
    const el = sentinelRef.current;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "240px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  if (!user) {
    return (
      <div className="grid h-full place-items-center text-[14px] text-white/45">
        请先登录以查看你的作品
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 px-1">
        <h1 className="text-[22px] font-medium leading-tight text-white/95">画廊</h1>
        <span className="text-[12px] text-white/45">你的全部作品</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-[28px] bg-white/[0.02] p-4 [scrollbar-color:rgba(255,255,255,0.16)_transparent] [scrollbar-width:thin]">
        {loading && items.length === 0 ? (
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="aspect-square animate-pulse rounded-[14px] bg-white/[0.03]"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="grid h-40 place-items-center text-[13px] text-white/45">
            暂无作品，去工作室创作第一张
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-3">
              {items.map((it) => (
                <button
                  key={it.message_id}
                  type="button"
                  onClick={() => onPreview(it.image_url)}
                  className="group relative aspect-square overflow-hidden rounded-[14px] border border-white/[0.05] bg-[#111114] transition-shadow hover:ring-1 hover:ring-white/10"
                >
                  <img
                    src={it.image_url}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                    }}
                  />
                  <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white/82">
                    {formatRelativeTime(it.created_at)}
                  </span>
                  {it.image_count > 1 && (
                    <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] text-white/82">
                      +{it.image_count - 1}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div ref={sentinelRef} className="h-10" aria-hidden="true" />
            {loadingMore && (
              <div className="mt-3 text-center text-[12px] text-white/45">加载中…</div>
            )}
            {endReached && items.length > 12 && (
              <div className="mt-3 text-center text-[12px] text-white/30">— 没有更多了 —</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2：tsc 验证**

```powershell
cd D:/webProject/image2/client
npm run build
```

Expected: 构建通过。

- [ ] **Step 3：提交**

```bash
git -C D:/webProject/image2 add client/src/pages/GalleryPage.tsx
git -C D:/webProject/image2 commit -m "feat(client): 添加 GalleryPage 页面"
```

---

## Task 10: LogsPage

**Files:**
- Create: `D:\webProject\image2\client\src\pages\LogsPage.tsx`

- [ ] **Step 1：创建 `client/src/pages/LogsPage.tsx`**

```tsx
import { useEffect, useRef } from "react";

import { useAuth } from "../auth/AuthContext";
import { useLogs } from "../hooks/useLogs";
import { LogRow } from "../components/LogRow";

type Props = {
  onPreview: (src: string) => void;
};

export function LogsPage({ onPreview }: Props) {
  const { user } = useAuth();
  const { items, loading, loadingMore, endReached, loadMore } = useLogs();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const el = sentinelRef.current;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "240px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  if (!user) {
    return (
      <div className="grid h-full place-items-center text-[14px] text-white/45">
        请先登录以查看你的积分日志
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 px-1">
        <h1 className="text-[22px] font-medium leading-tight text-white/95">日志</h1>
        <span className="text-[12px] text-white/45">生成记录与积分明细</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-[28px] bg-white/[0.02] p-4 [scrollbar-color:rgba(255,255,255,0.16)_transparent] [scrollbar-width:thin]">
        {loading && items.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-[14px] bg-white/[0.03]" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="grid h-40 place-items-center text-[13px] text-white/45">
            暂无记录
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {items.map((it) => (
                <LogRow key={it.id} item={it} onPreview={onPreview} />
              ))}
            </div>
            <div ref={sentinelRef} className="h-10" aria-hidden="true" />
            {loadingMore && (
              <div className="mt-3 text-center text-[12px] text-white/45">加载中…</div>
            )}
            {endReached && items.length > 20 && (
              <div className="mt-3 text-center text-[12px] text-white/30">— 没有更多了 —</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2：tsc 验证**

```powershell
cd D:/webProject/image2/client
npm run build
```

Expected: 构建通过。

- [ ] **Step 3：提交**

```bash
git -C D:/webProject/image2 add client/src/pages/LogsPage.tsx
git -C D:/webProject/image2 commit -m "feat(client): 添加 LogsPage 页面"
```

---

## Task 11: App.tsx 集成

**Files:**
- Modify: `D:\webProject\image2\client\src\App.tsx`

- [ ] **Step 1：在 App.tsx 的 import 区追加两行**

定位 import 区（约前 50 行）。在 `import { RecentWorksCard } from "./components/RecentWorksCard";` 之后追加：

```tsx
import { GalleryPage } from "./pages/GalleryPage";
import { LogsPage } from "./pages/LogsPage";
```

- [ ] **Step 2：修改 SIDEBAR_ITEMS（约 1698-1704 行）**

找到：
```tsx
const SIDEBAR_ITEMS: ReadonlyArray<{ key: string; label: string; icon: ReactNode }> = [
  { key: "studio", label: "工作室", icon: <StudioIcon /> },
  { key: "gallery", label: "画廊", icon: <GalleryIcon /> },
  { key: "inspiration", label: "灵感", icon: <InspirationIcon /> },
  { key: "models", label: "模型", icon: <ModelsIcon /> },
  { key: "history", label: "历史", icon: <HistoryIcon /> },
];
```
替换为：
```tsx
const SIDEBAR_ITEMS: ReadonlyArray<{ key: string; label: string; icon: ReactNode }> = [
  { key: "studio",  label: "工作室", icon: <StudioIcon /> },
  { key: "gallery", label: "画廊",   icon: <GalleryIcon /> },
  { key: "models",  label: "模型",   icon: <ModelsIcon /> },
  { key: "logs",    label: "日志",   icon: <HistoryIcon /> },
];
```

- [ ] **Step 3：grep 确认 `InspirationIcon` 没有其他引用，然后删除函数定义**

```powershell
# 用 PowerShell 跑：
Select-String -Path D:/webProject/image2/client/src/App.tsx -Pattern "InspirationIcon"
```

Expected: 只剩 1 处（函数定义本身，约 1879 行；Step 2 已经从 SIDEBAR_ITEMS 删了 import 引用，所以现在零引用）

打开 `App.tsx` 第 1879 行附近，找到 `function InspirationIcon() { ... }` 整个函数定义（约 12 行），**删除整个函数**（包括函数体的 SVG）。

如果 grep 还显示有别的地方引用 InspirationIcon（不是函数定义自身），**不要删，停下来报 BLOCKED**。

- [ ] **Step 4：修改渲染分支（约 991 行）**

找到：
```tsx
{activeNav === "models" ? (
  <ModelPlaza onShapesChange={onShapesChange} />
) : (
```

替换为：
```tsx
{activeNav === "models" ? (
  <ModelPlaza onShapesChange={onShapesChange} />
) : activeNav === "gallery" ? (
  <GalleryPage onPreview={(src) => setPreviewSrc(src)} />
) : activeNav === "logs" ? (
  <LogsPage onPreview={(src) => setPreviewSrc(src)} />
) : (
```

- [ ] **Step 5：修改 measure() effect 的跳过条件（约 870-872 行）**

找到：
```tsx
    // 当 activeNav === "models" 时，由 ModelPlaza 主导上报 5 个广场 shape，
    // 这里跳过，避免两个来源相互覆盖。
    if (activeNav === "models") return;
```

替换为：
```tsx
    // 当 activeNav 不是 "studio" 时（models/gallery/logs），由对应页面主导玻璃 shape，
    // MainCanvas 的 7 张玻璃壳测量跳过；同时清空 shapes，避免上次工作室的影子残留。
    if (activeNav !== "studio") {
      onShapesChange([]);
      return;
    }
```

- [ ] **Step 6：tsc 全量构建**

```powershell
cd D:/webProject/image2/client
npm run build
```

Expected: 构建通过、无 TS 错误。

如果报 `InspirationIcon` 找不到 → 说明删函数的位置没找对，或者 Step 2 漏改 SIDEBAR_ITEMS。重做 Step 2-3。

如果报 `setPreviewSrc` 找不到 → 它应该是 MainCanvas 已有的 state setter，定位 `App.tsx` grep 一下确认存在；如果在子组件 scope 外不可见，可能要把 setPreviewSrc 提升到 MainCanvas 或者从 props 传。

- [ ] **Step 7：提交**

```bash
git -C D:/webProject/image2 add client/src/App.tsx
git -C D:/webProject/image2 commit -m "feat(client): 菜单重构 删灵感 / 历史改日志 / 加画廊与日志分支"
```

---

## Task 12: E2E 验证 + 最终代码 review

**Files:** 无新文件改动；只做验证 + 截图归档

### E2E 步骤

前置：后端在 8000 端口起着、前端 5173 起着（按项目规约杀进程不换端口）：

```powershell
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object -Expand OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }
cd D:/webProject/image2/server
.venv/Scripts/activate
uvicorn app.main:app --reload --port 8000
```

新终端：
```powershell
cd D:/webProject/image2/client
npm run dev
```

- [ ] **Step 1：未登录态 —— 侧栏新菜单结构**

用 chrome-devtools MCP：
1. 打开 http://127.0.0.1:5173
2. snapshot 侧栏：应看到 4 个按钮：工作室 / 画廊 / 模型 / 日志（**无灵感**）
3. 未登录时切到画廊 → 提示"请先登录以查看你的作品"
4. 截图存 `docs/superpowers/e2e-screenshots/2026-05-22-menu-refactor/01-sidebar-unauthed.png`

- [ ] **Step 2：登入态 —— 画廊页**

1. 用账号 `2859098803@qq.com` 登入（参考最近作品 E2E：注入 token + reload）
2. 切到「画廊」
3. 看到所有出图作为 4 列网格（数据源同最近作品但全量）
4. 滚动到底 → 触发 loadMore → 拼接下一页（如果数据 < 24 条则看到"没有更多了"）
5. 点击任一缩略图 → Lightbox 打开
6. 截图存 `02-gallery-loggedin.png`

- [ ] **Step 3：登入态 —— 日志页**

1. 切到「日志」
2. 看到积分流水时间线（注册赠送 +5 / 等行）
3. 检查至少一个 `generate` reason 的行：左侧有缩略图、中间有 prompt（或 note）、右侧显示 `-1 余 4` 之类
4. 点击日志行左侧的缩略图 → Lightbox 打开
5. 截图存 `03-logs-loggedin.png`

- [ ] **Step 4：切回工作室 —— 玻璃外壳恢复**

1. 切回「工作室」
2. 看到节点画布 + 玻璃外壳重新渲染（4 张外层卡的玻璃衬底回来）
3. 截图存 `04-back-to-studio.png`

- [ ] **Step 5：写 verification README**

创建 `docs/superpowers/e2e-screenshots/2026-05-22-menu-refactor/README.md`：

```md
# 菜单重构 E2E 验证

- 执行日期：2026-05-22
- spec：`docs/specs/2026-05-22-menu-refactor-design.md`
- plan：`docs/plans/2026-05-22-menu-refactor.md`

## 验证项

| # | 项 | 截图 | 结论 |
|---|---|---|---|
| 1 | 侧栏菜单去掉灵感、增加日志 | 01-sidebar-unauthed.png | ✅ 4 项：工作室/画廊/模型/日志 |
| 2 | 画廊页登入态 + 滚动加载 + 点击预览 | 02-gallery-loggedin.png | ✅ |
| 3 | 日志页时间线 + generate 行带缩略图 | 03-logs-loggedin.png | ✅ |
| 4 | 切回工作室玻璃外壳恢复 | 04-back-to-studio.png | ✅ |

## 已知边界
- prompt_preview 来自 AI 消息自身 text，多数为空字符串（spec § 七.1 已说明，follow-up 后续补 sibling 查询）
- 触底无虚拟列表（spec § 七.4，依赖 CDN URL 改造）
```

- [ ] **Step 6：提交 E2E 截图**

```bash
git -C D:/webProject/image2 add docs/superpowers/e2e-screenshots/2026-05-22-menu-refactor/
git -C D:/webProject/image2 commit -m "test(e2e): 菜单重构 chrome-devtools MCP 验证截图"
```

- [ ] **Step 7：最终全量代码 review（subagent-driven）**

让一个 reviewer subagent 跑全量 review：
- BASE_SHA: `218b0da`（spec commit）
- HEAD_SHA: 最后一个 commit
- 检查：端到端契约一致性、数据流闭环、测试覆盖、`InspirationIcon` 真的删干净、命名一致、commit messages 中文、不动无关文件

- [ ] **Step 8：调 finishing-a-development-branch**

跑测试 + 决定 push 还是 keep。

---

## Self-Review 留痕

写完后已自审：
- 所有 task 都对应 spec 章节（service helper / schemas / 路由 / 测试 / 前端 API / hooks / 组件 / 页面 / App 集成 / E2E）
- 无 TBD / 占位
- 类型与函数命名前后一致：`fetchWorks` / `fetchLogs` / `useGallery` / `useLogs` / `GalleryPage` / `LogsPage` / `LogRow` / `RecentWorkItem`（复用）/ `LogItem` / `LogsPage` 全文统一
- `RecentWorkItem` 在 works 和 recent-works 共用（spec § 2.1 设计）
- Task 4（logs）的 8 个用例覆盖 spec § 6.1 列出的所有日志测试点
- Task 11 的 grep + 删 `InspirationIcon` 步骤防止半成品状态

## 完成定义（Definition of Done）

- 后端测试 24 个全过（`recent_works` 8 + `works` 8 + `logs` 8）
- `npm run build` 构建通过
- chrome-devtools MCP E2E 4 个步骤截图归档
- 侧栏侧无「灵感」、有「日志」按钮，画廊与日志页可用
- 与 spec `docs/specs/2026-05-22-menu-refactor-design.md` 的"变更清单"逐项对得上
