# 最近作品卡片 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让前端「最近作品」横滑卡片真实工作 —— 跨会话拉用户最近 12 张已完成 AI 出图，点击预览，AI 消息 pending→done 时实时刷新，未登录隐藏整卡。

**Architecture:** 后端新增 `GET /api/me/recent-works` 单接口，从 `messages JOIN conversations` 筛 `role=ai AND status=done AND image_urls IS NOT NULL`，按 created_at 倒序取 12 条。前端抽出 `RecentWorksCard` 组件、`useRecentWorks` hook、`fetchRecentWorks` API、`formatRelativeTime` 工具。`MainCanvas` 监听 current 会话 AI done 计数上涨触发 `refresh()`。

**Tech Stack:** FastAPI / SQLAlchemy 2.0 asyncio / pydantic v2 / unittest IsolatedAsyncioTestCase / httpx ASGITransport / React 18 + TypeScript + Tailwind / chrome-devtools MCP E2E

**Spec：** `docs/specs/2026-05-22-recent-works-card-design.md`

---

## 文件清单

| 文件 | 改动 |
|---|---|
| `server/app/schemas.py` | 修改：追加 `RecentWorkItem` / `RecentWorksOut` |
| `server/app/routers/recent_works.py` | 创建：单 endpoint 路由 |
| `server/app/main.py` | 修改：注册新 router |
| `server/tests/test_recent_works.py` | 创建：8 个集成测试 |
| `client/src/api/gptImage.ts` | 修改：追加 `fetchRecentWorks` + 类型 |
| `client/src/utils/relativeTime.ts` | 创建：相对时间格式化纯函数 |
| `client/src/hooks/useRecentWorks.ts` | 创建：数据 hook |
| `client/src/components/RecentWorksCard.tsx` | 创建：UI 组件 |
| `client/src/App.tsx` | 修改：替换 1387-1409、加 done 计数监听 effect、import |

---

## Task 1: 后端 Pydantic schemas

**Files:**
- Modify: `server/app/schemas.py`（在文件末尾追加）

- [ ] **Step 1: 在 `server/app/schemas.py` 末尾追加两个模型**

```python
# ===== 最近作品（GET /api/me/recent-works）=====


class RecentWorkItem(BaseModel):
    """一条「最近作品」记录，对应一条已完成的 AI 消息（可能多图，取首张作主图）"""

    message_id: int
    conversation_id: int
    image_url: str
    image_count: int
    all_image_urls: list[str]
    size: str | None = None
    created_at: datetime


class RecentWorksOut(BaseModel):
    items: list[RecentWorkItem]
```

- [ ] **Step 2: 验证 Python 能正常导入新模型**

Run: `cd D:/webProject/image2/server && python -c "from app.schemas import RecentWorkItem, RecentWorksOut; print(RecentWorkItem.model_fields.keys())"`
Expected: 打印出 `dict_keys(['message_id', 'conversation_id', 'image_url', 'image_count', 'all_image_urls', 'size', 'created_at'])`

- [ ] **Step 3: 提交**

```bash
git add server/app/schemas.py
git commit -m "feat(server): 加 RecentWorkItem/RecentWorksOut schema"
```

---

## Task 2: 后端路由占位 + 注册到 main

先建一个返回空列表的占位实现，让路由可访问；业务逻辑留到 Task 4，方便 Task 3 的测试有路由可打。

**Files:**
- Create: `server/app/routers/recent_works.py`
- Modify: `server/app/main.py`（import + include_router）

- [ ] **Step 1: 创建 `server/app/routers/recent_works.py` 占位实现**

```python
"""/api/me/recent-works —— 用户跨会话最近 AI 出图

设计要点见 docs/specs/2026-05-22-recent-works-card-design.md
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user
from ..models import User
from ..schemas import RecentWorksOut

router = APIRouter(prefix="/api/me", tags=["recent_works"])

RECENT_LIMIT = 12


@router.get("/recent-works", response_model=RecentWorksOut)
async def list_recent_works(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RecentWorksOut:
    """占位：真实实现见 Task 4。当前返回空列表，仅保证路由可被打到 + 401 鉴权链路连通"""
    return RecentWorksOut(items=[])
```

- [ ] **Step 2: 在 `server/app/main.py` 把新 router 注册进 app**

在文件中找到这一行（约 20 行）：

```python
from .routers import auth, conversations, images
```

替换为：

```python
from .routers import auth, conversations, images, recent_works
```

并在文件末尾找到这一段（约 132-134 行）：

```python
app.include_router(images.router)
app.include_router(auth.router)
app.include_router(conversations.router)
```

追加一行：

```python
app.include_router(images.router)
app.include_router(auth.router)
app.include_router(conversations.router)
app.include_router(recent_works.router)
```

- [ ] **Step 3: 启动后端跑一次 health 探活，确保新 router 不打破启动**

先杀掉占 8000 的旧进程，再启动：

```powershell
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object -Expand OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }
cd D:/webProject/image2/server
.venv/Scripts/activate
uvicorn app.main:app --port 8000
```

新开终端跑一次 health：
```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
```
Expected: `status : ok`

未带 token 调新接口：
```powershell
try { Invoke-RestMethod http://127.0.0.1:8000/api/me/recent-works } catch { $_.Exception.Response.StatusCode }
```
Expected: `Unauthorized`（401）

跑完关掉 uvicorn（Ctrl+C）。

- [ ] **Step 4: 提交**

```bash
git add server/app/routers/recent_works.py server/app/main.py
git commit -m "feat(server): 新增 GET /api/me/recent-works 路由占位 + 注册"
```

---

## Task 3: 集成测试 8 个用例（RED 阶段）

写完整测试文件。此时业务逻辑还是占位，预期：401 测试通过，其他 7 个失败（因为占位永远返回空 items）。

**Files:**
- Create: `server/tests/test_recent_works.py`

- [ ] **Step 1: 创建 `server/tests/test_recent_works.py`**

```python
"""recent_works 路由集成测试

环境与依赖（与 test_auth_routes_int.py 相同）：
- DATABASE_URL / REDIS_URL / JWT_SECRET 必须配置
- Redis 用 DB 15 隔离
- 集成测试自带 teardown 清理痕迹

跑：
  cd D:/webProject/image2/server
  python -m unittest tests.test_recent_works
"""
from __future__ import annotations

import asyncio
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
        new_path = "/15"
        os.environ["REDIS_URL"] = urlunparse(parsed._replace(path=new_path))
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
class RecentWorksTests(unittest.IsolatedAsyncioTestCase):
    created_emails: list[str]
    created_user_ids: list[int]
    created_conv_ids: list[int]

    async def asyncSetUp(self) -> None:
        self.created_emails = []
        self.created_user_ids = []
        self.created_conv_ids = []

        # 每个用例新事件循环，得清掉 lru_cache 的旧连接
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
            # 先删 conversations（messages 是级联），再删 user
            if self.created_conv_ids:
                await s.execute(
                    delete(Conversation).where(Conversation.id.in_(self.created_conv_ids))
                )
            if self.created_emails:
                rows = await s.execute(
                    User.__table__.select().where(User.email.in_(self.created_emails))
                )
                ids = [r.id for r in rows.fetchall()]
                ids.extend(self.created_user_ids)
                ids = list(set(ids))
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
        """注册一个新用户并返回 (user_id, access_token)"""
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
        """直接走 DB 建一个 conversation（不通过 /api，因为出图消息不能由前端 POST）"""
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
        role: str = "ai",
        status: str = "done",
        image_urls: list[str] | None = None,
        params: dict | None = None,
        created_at: datetime | None = None,
    ) -> int:
        """直接走 DB 落一条 message"""
        factory = get_session_factory()
        async with factory() as s:
            m = Message(
                conversation_id=conv_id,
                role=role,
                text="",
                image_urls=image_urls,
                params=params,
                status=status,
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
        r = await self.client.get("/api/me/recent-works")
        self.assertEqual(r.status_code, 401)

    async def test_empty_returns_empty_items(self):
        _uid, token = await self._register_and_login()
        r = await self.client.get("/api/me/recent-works", headers=self._auth(token))
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json(), {"items": []})

    async def test_only_ai_done_with_images_listed(self):
        """混入 user / pending / failed / image_urls 为 null 的 ai 消息 —— 仅 ai+done+非空图返回"""
        uid, token = await self._register_and_login()
        cid = await self._create_conv(uid)
        # 不该出现的：
        await self._add_msg(cid, role="user", image_urls=["should-not-appear-user.png"])
        await self._add_msg(cid, role="ai", status="pending", image_urls=["should-not-appear-pending.png"])
        await self._add_msg(cid, role="ai", status="failed", image_urls=["should-not-appear-failed.png"])
        await self._add_msg(cid, role="ai", status="done", image_urls=None)
        # 该出现的：
        good_id = await self._add_msg(cid, role="ai", status="done", image_urls=["good.png"])

        r = await self.client.get("/api/me/recent-works", headers=self._auth(token))
        self.assertEqual(r.status_code, 200, r.text)
        items = r.json()["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["message_id"], good_id)
        self.assertEqual(items[0]["image_url"], "good.png")

    async def test_ordered_desc_by_created_at(self):
        uid, token = await self._register_and_login()
        cid = await self._create_conv(uid)
        base = datetime.utcnow()
        ids = []
        for i in range(5):
            mid = await self._add_msg(
                cid,
                image_urls=[f"img-{i}.png"],
                created_at=base - timedelta(hours=i),
            )
            ids.append(mid)
        # ids[0] 最新（i=0），ids[4] 最旧（i=4）
        r = await self.client.get("/api/me/recent-works", headers=self._auth(token))
        items = r.json()["items"]
        self.assertEqual([it["message_id"] for it in items], ids)

    async def test_limit_12(self):
        uid, token = await self._register_and_login()
        cid = await self._create_conv(uid)
        base = datetime.utcnow()
        ids = []
        for i in range(15):
            mid = await self._add_msg(
                cid,
                image_urls=[f"img-{i}.png"],
                created_at=base - timedelta(minutes=i),
            )
            ids.append(mid)
        r = await self.client.get("/api/me/recent-works", headers=self._auth(token))
        items = r.json()["items"]
        self.assertEqual(len(items), 12)
        # 最新 12 条 = ids[0..11]
        self.assertEqual([it["message_id"] for it in items], ids[:12])

    async def test_isolates_other_users(self):
        a_uid, a_token = await self._register_and_login()
        a_cid = await self._create_conv(a_uid)
        for i in range(5):
            await self._add_msg(a_cid, image_urls=[f"a-{i}.png"])

        b_uid, b_token = await self._register_and_login()
        b_cid = await self._create_conv(b_uid)
        for i in range(3):
            await self._add_msg(b_cid, image_urls=[f"b-{i}.png"])

        ra = await self.client.get("/api/me/recent-works", headers=self._auth(a_token))
        rb = await self.client.get("/api/me/recent-works", headers=self._auth(b_token))
        self.assertEqual(len(ra.json()["items"]), 5)
        self.assertEqual(len(rb.json()["items"]), 3)
        # 确认 A 看不到 B 的图
        a_urls = [it["image_url"] for it in ra.json()["items"]]
        self.assertTrue(all(u.startswith("a-") for u in a_urls))

    async def test_excludes_soft_deleted_conv(self):
        uid, token = await self._register_and_login()
        live_cid = await self._create_conv(uid)
        dead_cid = await self._create_conv(uid, deleted=True)
        await self._add_msg(live_cid, image_urls=["live.png"])
        await self._add_msg(dead_cid, image_urls=["dead.png"])

        r = await self.client.get("/api/me/recent-works", headers=self._auth(token))
        items = r.json()["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["image_url"], "live.png")

    async def test_image_count_and_size_fields(self):
        uid, token = await self._register_and_login()
        cid = await self._create_conv(uid)
        urls = ["a.png", "b.png", "c.png"]
        await self._add_msg(
            cid,
            image_urls=urls,
            params={"size": "1024x1024", "quality": "high"},
        )

        r = await self.client.get("/api/me/recent-works", headers=self._auth(token))
        item = r.json()["items"][0]
        self.assertEqual(item["image_count"], 3)
        self.assertEqual(item["all_image_urls"], urls)
        self.assertEqual(item["image_url"], "a.png")
        self.assertEqual(item["size"], "1024x1024")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 跑测试，预期：1 个 pass（401 用例），其他 7 个 fail**

```powershell
cd D:/webProject/image2/server
.venv/Scripts/activate
python -m unittest tests.test_recent_works -v
```

Expected:
- `test_unauthorized_returns_401` PASS（占位路由也走 `get_current_user` 401 路径）
- 其他 7 个 FAIL（占位返回空 items，与期望不符）

如果 401 用例也 FAIL，先排查环境（DATABASE_URL / REDIS_URL / JWT_SECRET），不要继续。

- [ ] **Step 3: 提交（RED）**

```bash
git add server/tests/test_recent_works.py
git commit -m "test(server): recent_works 8 个集成用例（RED）"
```

---

## Task 4: 实现 recent_works 真实查询（GREEN）

把 Task 2 的占位换成真实的 JOIN 查询。

**Files:**
- Modify: `server/app/routers/recent_works.py`

- [ ] **Step 1: 把整个 `recent_works.py` 替换为完整实现**

```python
"""/api/me/recent-works —— 用户跨会话最近 AI 出图

设计要点见 docs/specs/2026-05-22-recent-works-card-design.md
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user
from ..models import Conversation, Message, User
from ..schemas import RecentWorkItem, RecentWorksOut

router = APIRouter(prefix="/api/me", tags=["recent_works"])

# 与前端 UI 容量一致；改此常量时前端不用同步改
RECENT_LIMIT = 12


@router.get("/recent-works", response_model=RecentWorksOut)
async def list_recent_works(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RecentWorksOut:
    """用户跨所有会话的最近 AI 出图，按 messages.created_at DESC 取前 RECENT_LIMIT 条。

    过滤条件：
      - conversation.user_id == 当前用户
      - conversation.deleted_at IS NULL（软删的会话整体隐藏）
      - message.role == 'ai'
      - message.status == 'done'
      - message.image_urls IS NOT NULL（DB 层）+ 非空列表（应用层兜底）
    """
    stmt = (
        select(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(
            and_(
                Conversation.user_id == user.id,
                Conversation.deleted_at.is_(None),
                Message.role == "ai",
                Message.status == "done",
                Message.image_urls.is_not(None),
            )
        )
        .order_by(Message.created_at.desc())
        .limit(RECENT_LIMIT)
    )
    rows = (await db.execute(stmt)).scalars().all()

    items: list[RecentWorkItem] = []
    for m in rows:
        urls = m.image_urls or []
        if not urls:
            # 双保险：MySQL JSON 长度过滤写法繁琐，应用层兜一下
            continue
        size = None
        if m.params and isinstance(m.params, dict):
            raw_size = m.params.get("size")
            if isinstance(raw_size, str):
                size = raw_size
        items.append(
            RecentWorkItem(
                message_id=m.id,
                conversation_id=m.conversation_id,
                image_url=urls[0],
                image_count=len(urls),
                all_image_urls=urls,
                size=size,
                created_at=m.created_at,
            )
        )
    return RecentWorksOut(items=items)
```

- [ ] **Step 2: 跑完整测试套件，预期全 8 个 PASS**

```powershell
cd D:/webProject/image2/server
.venv/Scripts/activate
python -m unittest tests.test_recent_works -v
```

Expected: 全 8 个用例 PASS（`Ran 8 tests`, `OK`）

如果有 FAIL，按报错对照 spec 修复后再跑；不要继续到下一步。

- [ ] **Step 3: 提交（GREEN）**

```bash
git add server/app/routers/recent_works.py
git commit -m "feat(server): 实现 GET /api/me/recent-works 真实查询"
```

---

## Task 5: 前端 API 镜像

把后端 schema 在 `gptImage.ts` 映射为 TS 类型 + fetch 函数。

**Files:**
- Modify: `client/src/api/gptImage.ts`（在文件末尾追加）

- [ ] **Step 1: 在 `client/src/api/gptImage.ts` 末尾追加**

```ts
// ===== 最近作品（GET /api/me/recent-works）=====

export type RecentWorkItem = {
  message_id: number;
  conversation_id: number;
  image_url: string;
  image_count: number;
  all_image_urls: string[];
  size: string | null;
  created_at: string; // ISO
};

export type RecentWorksOut = {
  items: RecentWorkItem[];
};

/** 拉用户最近完成的 AI 出图（最多 12 条，按 created_at 倒序）*/
export async function fetchRecentWorks(): Promise<RecentWorkItem[]> {
  const res = await authFetch("/api/me/recent-works");
  if (!res.ok) {
    throw new Error(`fetchRecentWorks failed: ${res.status}`);
  }
  const data = (await res.json()) as RecentWorksOut;
  return data.items;
}
```

- [ ] **Step 2: 跑 tsc 确保类型 OK**

```powershell
cd D:/webProject/image2/client
npm run build
```

Expected: 构建通过（无 TS 报错）。允许 vite build 输出 chunk 大小警告之类，但不能有 type error。

- [ ] **Step 3: 提交**

```bash
git add client/src/api/gptImage.ts
git commit -m "feat(client): 添加 fetchRecentWorks API 镜像"
```

---

## Task 6: 相对时间工具

**Files:**
- Create: `client/src/utils/relativeTime.ts`

- [ ] **Step 1: 创建 `client/src/utils/relativeTime.ts`**

```ts
/**
 * ISO 时间戳 → 中文相对时间标签
 *  - <1 min     "刚刚"
 *  - <60 min    "N 分钟前"
 *  - <24 h      "N 小时前"
 *  - 昨日       "昨天"
 *  - <7 d       "N 天前"
 *  - 否则       "MM/DD"
 *
 * @param iso ISO 时间戳字符串（如 "2026-05-22T10:14:33Z"）
 * @param now 用于测试的"当前时间"，默认 new Date()
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  const diffMs = now.getTime() - t.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;

  // 昨日按"当地日历日"差判断（不是按 24 小时差）
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDay = Math.round(
    (startOfDay(now).getTime() - startOfDay(t).getTime()) / 86_400_000,
  );
  if (diffDay === 1) return "昨天";
  if (diffDay < 7) return `${diffDay} 天前`;

  const mm = String(t.getMonth() + 1).padStart(2, "0");
  const dd = String(t.getDate()).padStart(2, "0");
  return `${mm}/${dd}`;
}
```

- [ ] **Step 2: 在浏览器 console 跑 ad-hoc smoke test（项目无前端 test 框架）**

启动 dev server 后在 console 里贴：

```js
const { formatRelativeTime } = await import("/src/utils/relativeTime.ts");
const now = new Date("2026-05-22T12:00:00Z");
console.assert(formatRelativeTime("2026-05-22T11:59:30Z", now) === "刚刚");
console.assert(formatRelativeTime("2026-05-22T11:30:00Z", now) === "30 分钟前");
console.assert(formatRelativeTime("2026-05-22T08:00:00Z", now) === "4 小时前");
console.assert(formatRelativeTime("2026-05-21T12:00:00Z", now) === "昨天");
console.assert(formatRelativeTime("2026-05-19T12:00:00Z", now) === "3 天前");
console.assert(formatRelativeTime("2026-04-22T12:00:00Z", now) === "04/22");
console.log("all asserts ok");
```

Expected: `all asserts ok`，无 AssertionError。

> 注：「昨天/N 天前」用本地日历日差，受执行时机器时区影响。Windows 默认 +08，上面字面值已按 +08 校准；若机器在别的时区，"昨天" 那条可能轻微偏离一天——这不算 bug。

- [ ] **Step 3: 提交**

```bash
git add client/src/utils/relativeTime.ts
git commit -m "feat(client): 添加 formatRelativeTime 工具"
```

---

## Task 7: useRecentWorks hook

**Files:**
- Create: `client/src/hooks/useRecentWorks.ts`

- [ ] **Step 1: 检查 hooks 目录是否存在，不存在则在创建文件时一并创建**

```powershell
ls D:/webProject/image2/client/src/hooks/ 2>$null
```

Expected: 如果不存在会报路径不存在；直接在下一步用 Write 写文件会自动建目录。

- [ ] **Step 2: 创建 `client/src/hooks/useRecentWorks.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";

import { fetchRecentWorks, type RecentWorkItem } from "../api/gptImage";
import { useAuth } from "../auth/AuthContext";

type State = {
  items: RecentWorkItem[];
  loading: boolean;
  error: string | null;
};

const INITIAL: State = { items: [], loading: false, error: null };

/**
 * 最近作品 hook：
 *  - 用户登录后挂载即首拉
 *  - 用户登出 / 切换时清空
 *  - 通过 refresh() 让外部触发重拉（实时刷新场景：AI 消息 pending→done）
 */
export function useRecentWorks() {
  const { user } = useAuth();
  const [state, setState] = useState<State>(INITIAL);
  // 防止竞态：旧请求迟回时不要覆盖新结果
  const reqSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!user) {
      setState(INITIAL);
      return;
    }
    const seq = ++reqSeqRef.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const items = await fetchRecentWorks();
      if (seq !== reqSeqRef.current) return; // 旧请求，丢弃
      setState({ items, loading: false, error: null });
    } catch (e) {
      if (seq !== reqSeqRef.current) return;
      // 静默 fallback —— 最近作品失败不该影响主流程
      console.warn("[recentWorks] refresh failed:", e);
      setState((s) => ({ ...s, loading: false, error: String(e) }));
    }
  }, [user]);

  // 登入 / 登出自动同步
  useEffect(() => {
    if (!user) {
      setState(INITIAL);
      reqSeqRef.current++;
      return;
    }
    void refresh();
  }, [user, refresh]);

  return {
    items: state.items,
    loading: state.loading,
    error: state.error,
    refresh,
  };
}
```

- [ ] **Step 3: 跑 tsc 确保 import 路径都对**

```powershell
cd D:/webProject/image2/client
npm run build
```

Expected: 构建通过。

如果 `useAuth` 路径报错，去 `client/src/auth/AuthContext.tsx` 看具体导出名 + 调整 import。

- [ ] **Step 4: 提交**

```bash
git add client/src/hooks/useRecentWorks.ts
git commit -m "feat(client): 添加 useRecentWorks hook"
```

---

## Task 8: RecentWorksCard 组件

**Files:**
- Create: `client/src/components/RecentWorksCard.tsx`

- [ ] **Step 1: 创建 `client/src/components/RecentWorksCard.tsx`**

```tsx
import { forwardRef } from "react";

import { useAuth } from "../auth/AuthContext";
import { useRecentWorks } from "../hooks/useRecentWorks";
import { formatRelativeTime } from "../utils/relativeTime";

type Props = {
  /** 点击缩略图时把图 URL 抛给上层（复用现有 lightbox setPreviewSrc）*/
  onPreview: (src: string) => void;
};

export const RecentWorksCard = forwardRef<HTMLDivElement, Props>(
  function RecentWorksCard({ onPreview }, ref) {
    const { user } = useAuth();
    const { items, loading } = useRecentWorks();

    // 未登录：整卡不渲染（连占位都不画）
    if (!user) return null;

    return (
      <div ref={ref} className="flex shrink-0 flex-col rounded-[28px] p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12px] font-medium text-white/82">最近作品</span>
          {/* 「查看全部」本期隐藏 —— 等画廊页落地后再回填 */}
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-color:rgba(255,255,255,0.16)_transparent] [scrollbar-width:thin] [scrollbar-gutter:stable]">
          {loading && items.length === 0 ? (
            // 骨架：4 个静态占位块
            Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-[84px] w-[120px] shrink-0 animate-pulse rounded-[14px] bg-white/[0.03]"
              />
            ))
          ) : items.length === 0 ? (
            <span className="text-[12px] text-white/45">
              暂无作品，点击「生成」开始创作
            </span>
          ) : (
            items.map((it) => (
              <button
                key={it.message_id}
                type="button"
                onClick={() => onPreview(it.image_url)}
                className="group relative h-[84px] w-[120px] shrink-0 overflow-hidden rounded-[14px] border border-white/[0.05] bg-[#111114] transition-shadow hover:ring-1 hover:ring-white/10"
              >
                <img
                  src={it.image_url}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    // 加载失败：藏掉 img，让深底色 + 时间标签露出
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
            ))
          )}
        </div>
      </div>
    );
  },
);
```

- [ ] **Step 2: 跑 tsc 确保编译通过**

```powershell
cd D:/webProject/image2/client
npm run build
```

Expected: 构建通过。

- [ ] **Step 3: 提交**

```bash
git add client/src/components/RecentWorksCard.tsx
git commit -m "feat(client): 添加 RecentWorksCard 组件"
```

---

## Task 9: App.tsx 集成

替换硬编码块、加 done 计数监听、加 import。

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: 在 `client/src/App.tsx` 的 import 区追加**

定位现有 import 区（约前 50 行），追加一行：

```tsx
import { RecentWorksCard } from "./components/RecentWorksCard";
import { useRecentWorks } from "./hooks/useRecentWorks";
```

具体插入位置：紧跟现有的 `import { LiquidGlass, ... } from "./LiquidGlass";` 之后即可（位置不严格，只要在 App 组件顶部使用前导入）。

- [ ] **Step 2: 替换 1387-1409 行的硬编码块**

定位（搜索 "最近作品横滑" 注释，约 1387 行）：

```tsx
        {/* 最近作品横滑 */}
        <div
          ref={recentCardRef}
          className="flex shrink-0 flex-col rounded-[28px] p-4"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-medium text-white/82">最近作品</span>
            <button className="text-[11px] text-white/45 hover:text-white/72">查看全部</button>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-color:rgba(255,255,255,0.16)_transparent] [scrollbar-width:thin] [scrollbar-gutter:stable]">
            {["刚刚", "2 小时前", "昨天", "2 天前", "3 天前"].map((t) => (
              <div
                key={t}
                className="relative h-[84px] w-[120px] shrink-0 overflow-hidden rounded-[14px] border border-white/[0.05] bg-[#111114]"
              >
                <DemoBearArtwork />
                <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white/82">
                  {t}
                </span>
              </div>
            ))}
          </div>
        </div>
```

替换为：

```tsx
        {/* 最近作品横滑 */}
        <RecentWorksCard
          ref={recentCardRef}
          onPreview={(src) => setPreviewSrc(src)}
        />
```

- [ ] **Step 3: 在 MainCanvas 组件顶部（526 行 `const { user } = useAuth();` 那一带）追加 hook 调用**

找到：

```tsx
function MainCanvas({ activeNav, onShapesChange }: {
  activeNav: NavKey;
  onShapesChange: (shapes: GlassShape[]) => void;
}) {
  const { user } = useAuth();
```

在 `const { user } = useAuth();` 后面追加：

```tsx
  const { user } = useAuth();
  const recentWorks = useRecentWorks();
```

- [ ] **Step 4: 在 MainCanvas 内追加 done 计数监听 effect**

找到 `useConversations()` 调用所在位置（搜索 `useConversations(` 在 MainCanvas 内的调用）。紧跟其后追加（如果会话 hook 暴露的对象名不是 `conversations`，按实际名调整）：

```tsx
  // 监听当前会话内 AI done 计数上涨 → 实时刷新最近作品
  // 切换会话时（convId 变化）只更新基线、不触发 refresh
  const recentWorksDoneRef = useRef<{ convId: number | null; count: number }>({
    convId: null,
    count: 0,
  });
  useEffect(() => {
    const currentConv = conversations.current;
    const convId = currentConv?.id ?? null;
    const doneCount = (currentConv?.messages ?? []).filter(
      (m) =>
        m.role === "ai" &&
        m.status === "done" &&
        (m.image_urls?.length ?? 0) > 0,
    ).length;

    const prev = recentWorksDoneRef.current;
    if (prev.convId === convId && doneCount > prev.count) {
      void recentWorks.refresh();
    }
    recentWorksDoneRef.current = { convId, count: doneCount };
  }, [conversations.current, recentWorks]);
```

> 注：如果 MainCanvas 中已经没有顶部的 `useRef` import，要确认 React 已经导入 `useRef`、`useEffect`。原代码已经在用这两个 hook（532 行用了 `useRef`，855 行有大 `useEffect`），所以 import 通常已具备。

- [ ] **Step 5: 跑 tsc 确保整个 App.tsx 编译通过**

```powershell
cd D:/webProject/image2/client
npm run build
```

Expected: 构建通过。

如果报 `conversations.current` 字段不存在 / 名不同，去 useConversations.ts 看实际暴露的 state 形状，调整 effect 里的字段引用。spec 假设是 `conversations.current.messages`，与现有代码一致（`useConversations.ts:228` 用了 `s.current`）。

- [ ] **Step 6: 提交**

```bash
git add client/src/App.tsx
git commit -m "feat(client): 接入 RecentWorksCard + done 计数实时刷新"
```

---

## Task 10: E2E 验证（chrome-devtools MCP）

按项目规约「改完先 E2E 再交付」走真实浏览器跑一遍。

**Files:** 无新文件改动，只跑测试。可能根据发现 bug 回到前面任务修。

前置：
- 后端在 8000 端口起着
- 前端 dev server 在 5173 起着
- Chrome 装好 chrome-devtools MCP

启动两个 server（开两个 PowerShell）：

```powershell
# 终端 1
cd D:/webProject/image2/server
.venv/Scripts/activate
uvicorn app.main:app --reload --port 8000
```

```powershell
# 终端 2
cd D:/webProject/image2/client
npm run dev
```

- [ ] **Step 1: 黄金路径 —— 登录已有账号 → 触发一次生图 → 等 done → 卡片立即出现新图（左侧第一位）**

用 chrome-devtools MCP：
1. `mcp__chrome-devtools__new_page` 打开 http://localhost:5173
2. 登录账号（取 `bulvikdaniel177@gmail.com` 或现有测试账号）
3. 在 AI 助手里输入一条 prompt 触发生图
4. 等 status 从 pending 翻 done（轮询周期 2s，加上上游可能 5-30s）
5. `mcp__chrome-devtools__take_screenshot` 抓最近作品卡片所在区域，断言：第一位缩略图 src 与刚生成的图一致

通过条件：刚生成的图出现在卡片第一位，时间标签显示「刚刚」。

- [ ] **Step 2: 未登录态 —— 卡片整体不渲染**

1. 退出登录
2. 检查左侧画布区域是否还有「最近作品」标题；DOM 里 `recentCardRef` 节点应不存在
3. 截图归档

通过条件：标题与缩略图完全消失，外层布局不报错（玻璃外壳少绘一块衬底可接受）。

- [ ] **Step 3: 空态 —— 新注册账号未生过图**

1. 注册一个新邮箱（先验邮箱通过）
2. 不发任何生图请求
3. 看卡片显示 "暂无作品，点击「生成」开始创作"

通过条件：卡片标题在、横滑区显示空态文案、无骨架卡死。

- [ ] **Step 4: 多图角标 —— 一次生 n=2**

1. 用主账号在 AI 助手里把 n 调到 2，发一条 prompt
2. 等 done
3. 检查卡片新出现的项目右下角有 "+1" 角标

通过条件：角标出现且 +N 算的是 `image_count - 1`。

- [ ] **Step 5: 时间标签准确**

1. 看卡片现有几张图的时间标签
2. 与右侧 AI 助手对应消息的时间对比
3. 不要求精确到分钟，但分钟/小时/昨天的范围要对

通过条件：标签符合相对时间格式（"刚刚"/"N 分钟前"/"N 小时前"/"昨天"/"N 天前"/"MM/DD"）。

- [ ] **Step 6: 点击预览**

1. 点击卡片任一缩略图
2. 现有 Lightbox 应打开，src 等于卡片的 `image_url`

通过条件：Lightbox 打开正确的图。

- [ ] **Step 7: 图片 URL 失效 —— graceful fallback**

模拟方法：用 DevTools network 拦截一张图改返 404。

```js
// 在浏览器 console 跑（chrome-devtools MCP evaluate_script）
// 拦截某个具体 CDN URL，让它返 404
// 或者直接改 DOM 用一个不存在的 img src 验证 onError 行为
```

或者更简单：直接 inspect 一张卡片的 img 元素，改它的 src 到一个 404 URL，看是否变成深底色（visibility:hidden）而不报红。

通过条件：失败的图变成深底色 + 时间标签仍可见，其他卡片正常。

- [ ] **Step 8: 截图归档 + 写 verification note**

把过程截图存到 `docs/superpowers/e2e-screenshots/2026-05-22-recent-works/` 下（与现有 e2e-screenshots 目录同级习惯）：

```powershell
mkdir D:/webProject/image2/docs/superpowers/e2e-screenshots/2026-05-22-recent-works -ErrorAction SilentlyContinue
```

把上面 1-6 步的截图分别命名为 `01-golden-path.png`、`02-unauthed.png` 等，复制进去。

- [ ] **Step 9: 提交 E2E 截图**

```bash
git add docs/superpowers/e2e-screenshots/2026-05-22-recent-works/
git commit -m "test(e2e): 最近作品卡片 chrome-devtools MCP 验证截图"
```

- [ ] **Step 10: 若发现 bug，回到对应 Task 修，再回 Task 10 重跑相关步骤**

可能踩的坑（已预想 + 应对）：
- **白屏 / 报 useAuth 找不到**：确认 `client/src/auth/AuthContext.tsx` 真实 export 名字是 `useAuth`，必要时调整 import
- **`conversations.current` 字段名不一致**：去 `useConversations.ts` 看暴露给外部的 state 形状，调整 Task 9 effect 中字段引用
- **未登录隐藏卡片后玻璃外壳重叠**：Task 9 后用户登入登出时第一帧无玻璃衬底，已在 spec 风险段说明，本期不修
- **跨标签生图**：标签 X 生图，标签 Y 不立即出现是已知边界，不修
- **CORS**：后端 allowlist 已含 5173，不应该出现；若出现先看 console 报错具体 origin

---

## Self-Review 留痕

写完计划后已经做过一次自审：
- 所有任务都对应 spec 章节（schemas / 路由 / 测试 / API 镜像 / 工具 / hook / 组件 / 集成 / E2E）
- 无 TBD / 待补片段，所有代码块完整
- 类型与函数命名前后一致：`fetchRecentWorks` / `useRecentWorks` / `formatRelativeTime` / `RecentWorksCard` 在所有任务里同一拼法
- 测试用 `_create_conv` + `_add_msg` 直插 DB，规避「没有"创建 ai done 图片消息"的对外 API」的问题；与现有 Conversation/Message 模型字段名严格对齐
- Task 10 包括了 spec 第六章列的 8 个 E2E 检查项

---

## 完成定义（Definition of Done）

- 后端 `python -m unittest tests.test_recent_works -v` 8 个全过
- `npm run build` 构建通过（无 TS 报错）
- chrome-devtools MCP E2E 至少跑通 Task 10 Step 1-7
- 主分支 git log 看到 Task 1-9 各自的 commit
- E2E 截图存档（Task 10 Step 8-9）
- 与 spec `docs/specs/2026-05-22-recent-works-card-design.md` 的"变更清单"逐项对得上
