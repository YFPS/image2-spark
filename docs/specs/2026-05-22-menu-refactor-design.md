# 菜单重构：画廊页 + 日志页 + 删除灵感页 设计

- **日期**：2026-05-22
- **范围**：
  - 后端：新增 `routers/works.py`（`GET /api/me/works` 画廊接口）+ `routers/logs.py`（`GET /api/me/logs` 日志接口）+ schemas 追加
  - 前端：新建 `client/src/pages/GalleryPage.tsx`、`client/src/pages/LogsPage.tsx` + 2 个对应 hook + API 镜像
  - `client/src/App.tsx`：导航菜单删 `inspiration`、`history` 改 `logs`；增加 `activeNav === "gallery"` 与 `activeNav === "logs"` 的渲染分支
  - 清理无用代码：`InspirationIcon` 函数删除
- **不在范围**：
  - 删除作品 / 收藏 / 标签 / 公开分享
  - 画廊筛选（按 size / model / 日期范围）
  - 日志导出 CSV
  - 画廊里的「重新生成」/「复用 prompt」一键回写到工作室
  - 移动端适配（沿用桌面优先）
  - 充值流程接入（充值/订单/支付回调是独立项目）

---

## 一、背景

`client/src/App.tsx:1698-1704` 当前侧栏 5 项：

```tsx
{ key: "studio",      label: "工作室", icon: <StudioIcon /> },
{ key: "gallery",     label: "画廊",   icon: <GalleryIcon /> },
{ key: "inspiration", label: "灵感",   icon: <InspirationIcon /> },
{ key: "models",      label: "模型",   icon: <ModelsIcon /> },
{ key: "history",     label: "历史",   icon: <HistoryIcon /> },
```

但 `activeNav` 的渲染分支（`App.tsx:991`）只有：
- `activeNav === "models"` → `<ModelPlaza />`
- else → 工作室节点画布（MainCanvas）

也就是说**画廊 / 灵感 / 历史 三个菜单项是空壳**：点了切 state 但渲染不变。

后端数据基础：
- `messages` 表（`models.py:195`）含 `image_urls: list[str] | None`、`role`、`status`、`created_at`、`conversation_id`、`params`——画廊数据源
- `credit_transactions` 表（`models.py:86`）已有 `delta`、`balance_after`、`reason`（枚举：`signup_bonus`/`recharge`/`admin_grant`/`generate`/`edit`/`refund`/`adjust`）、`ref_type`/`ref_id`、`note`、`created_at`+ 已索引 `(user_id, created_at)`——日志数据源

**用户给的指引（brainstorming 已确认 + goal "你继续不要问我" 之后的合理默认）：**

| 决策点 | 选择 |
|---|---|
| 日志形态 | 事件时间线（一行一个事件） |
| 日志数据源 | `credit_transactions` 为主表倒序；`reason ∈ {generate, edit}` 的行额外 join `messages` 拿缩略图 + prompt 摘要 |
| 画廊布局 | 4 列瀑布流网格，无限滚动（cursor 分页） |
| 画廊点击 | 复用现有 Lightbox（与「最近作品」一致） |
| 灵感页 | 删除菜单项 + `InspirationIcon` 函数 |
| 历史菜单 | key `history` → `logs`，label "历史" → "日志"，icon 保留 `HistoryIcon` |
| 范围最小化 | 不带筛选/删除/收藏/导出/重新生成 |

---

## 二、后端设计

### 2.1 画廊接口（`server/app/routers/works.py`，新文件）

```python
"""/api/me/works —— 用户全部 AI 出图（cursor 分页）

设计要点见 docs/specs/2026-05-22-menu-refactor-design.md
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user
from ..models import Conversation, Message, User
from ..schemas import RecentWorkItem, WorksPage

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
    """与最近作品同样的过滤逻辑，但支持 cursor 分页 + limit 可调。

    cursor 语义：返回 message_id < cursor 的下一批；同 created_at DESC 排序下，
    cursor=上批 items[-1].message_id 即可拿到下一页（消息 id 单调递增，
    与 created_at 顺序一致——这是数据库自增 + 应用层串行写入保证的）。
    """
    where = [
        Conversation.user_id == user.id,
        Conversation.deleted_at.is_(None),
        Message.role == "ai",
        Message.status == "done",
        Message.image_urls.is_not(None),
    ]
    if cursor is not None:
        where.append(Message.id < cursor)

    stmt = (
        select(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(and_(*where))
        .order_by(Message.id.desc())  # id DESC 等价 created_at DESC 且能直接用作 cursor
        .limit(limit + 1)  # 多取一条判断是否还有下一页
    )
    rows = (await db.execute(stmt)).scalars().all()

    has_more = len(rows) > limit
    rows = rows[:limit]

    items: list[RecentWorkItem] = []
    for m in rows:
        urls = m.image_urls or []
        if not urls:
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

    next_cursor = items[-1].message_id if has_more and items else None
    return WorksPage(items=items, next_cursor=next_cursor)
```

**复用决定**：`RecentWorkItem` schema 直接重用——画廊每条与最近作品每条同形。`WorksPage` 是带 `next_cursor` 的分页包装。

**与最近作品的关系**：`/api/me/recent-works` 不动（仍是固定取 12 条的"快查"接口）；画廊接口是它的 superset 形态。`recent_works.py` 与 `works.py` 之间的查询过滤逻辑近 100% 一致——实施时**抽出一个共享 helper** `server/app/works_service.py`（沿用项目 `<name>_service.py` 命名惯例：`auth_service.py` / `segment_service.py` / `email_verification_service.py`），导出 `build_works_query(user_id, cursor=None, limit=N)` 和 `message_to_recent_work_item(m: Message) -> RecentWorkItem`，两个路由都调它。

### 2.2 日志接口（`server/app/routers/logs.py`，新文件）

```python
"""/api/me/logs —— 用户积分流水时间线（cursor 分页）

reason ∈ {generate, edit} 的行会额外查询对应 message 拿缩略图 + prompt 摘要。
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
PROMPT_PREVIEW_LEN = 80  # prompt 摘要截断长度


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

    # 批量加载 ref_type='message' 的 messages（不做 N+1）
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
                # 从 messages 的 sibling user 消息或 m.text 取 prompt——本期简化：
                # 直接用 m.text（AI 消息的 text 通常存的是 prompt 回显或空串）。
                # 真正的 prompt 在 sibling user message 上，但本期不查兄弟节点（YAGNI）。
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

**Prompt 来源说明（妥协）**：理论上"生图日志"展示的 prompt 应该来自该 AI 消息的**前一条 user 消息**（同 conversation 内）。本期为了避免再 join 一次 `messages` 拿 sibling 节点，**直接用 AI 消息自身的 `m.text`**——多数情况下 AI 消息的 text 会是空串或简短回显，可能导致 prompt_preview 为空字符串。这是 acceptable 的最小可用状；后续如果体验差再补 sibling 查询。

### 2.3 Schemas（`server/app/schemas.py` 追加）

```python
# ===== 画廊（GET /api/me/works）=====

class WorksPage(BaseModel):
    items: list[RecentWorkItem]  # 复用最近作品的 item shape
    next_cursor: int | None = None  # 下一页起点（上批最后一条 message_id），无更多则 None


# ===== 日志（GET /api/me/logs）=====

LogType = Literal[
    "signup_bonus", "recharge", "admin_grant",
    "generate", "edit", "refund", "adjust",
]


class LogRef(BaseModel):
    """日志条目的业务关联（generate/edit 才有）"""
    kind: Literal["message"]
    message_id: int
    conversation_id: int
    thumbnail_url: str | None  # image_urls[0]，可能 null（image_urls 为空时）
    prompt_preview: str | None  # 截断后的 prompt 文本


class LogItem(BaseModel):
    id: int
    type: LogType
    delta: int  # 有符号：+5 充值/赠送、-1 生图
    balance_after: int
    note: str | None
    created_at: datetime
    ref: LogRef | None = None  # 仅 type ∈ {generate, edit} 可能非 None


class LogsPage(BaseModel):
    items: list[LogItem]
    next_cursor: int | None = None
```

### 2.4 注册路由

`server/app/main.py` 追加：

```python
from .routers import auth, conversations, images, logs, recent_works, works
...
app.include_router(works.router)
app.include_router(logs.router)
```

### 2.5 鉴权与错误

- 所有接口走 `Depends(get_current_user)` → 401
- cursor / limit 由 Pydantic 校验：传非法值（负数、超 max）→ FastAPI 默认 422
- 纯读接口、无副作用、无须限流

### 2.6 性能

- 画廊：`id DESC + WHERE id < cursor` + `LIMIT 25` → 走 `idx_msg_conv_id` + 主键，单页 < 10 ms
- 日志：`id DESC + WHERE user_id=? AND id < cursor` → 走 `idx_ctx_user_time`（已有），单页 < 10 ms
- 批量 join messages 时用 `WHERE id IN (...)` 一次查全，避免 N+1
- 不做 Redis 缓存（理由同最近作品）

---

## 三、前端设计

### 3.1 文件结构

```
client/src/
├── api/
│   ├── gptImage.ts                 # 已有；追加 fetchWorks() 与类型
│   └── logs.ts                     # 新文件：fetchLogs() + 类型
├── pages/                          # 新目录
│   ├── GalleryPage.tsx             # 新文件：画廊页根组件
│   └── LogsPage.tsx                # 新文件：日志页根组件
├── hooks/
│   ├── useRecentWorks.ts           # 已有
│   ├── useGallery.ts               # 新文件：画廊分页 hook
│   └── useLogs.ts                  # 新文件：日志分页 hook
├── components/
│   ├── RecentWorksCard.tsx         # 已有，不动
│   └── LogRow.tsx                  # 新文件：单条日志行组件（复杂度高，抽出）
└── App.tsx                         # 改动：导航 list + 两个 activeNav 分支
```

为什么 `logs.ts` 独立而不复用 `gptImage.ts`：`gptImage.ts` 是图像生成上下文的 API；日志接口语义独立，单独文件让 API 模块按业务垂直组织。

为什么 `LogRow.tsx` 独立而不内联进 `LogsPage`：单条日志行有图标 / 类型文案 / 缩略图 / prompt / delta / 余额 / 时间多个 slot，单独组件让 LogsPage 保持骨架级简洁。

### 3.2 API 层

**画廊**（`client/src/api/gptImage.ts` 追加）：

```ts
export type WorksPage = {
  items: RecentWorkItem[];
  next_cursor: number | null;
};

export async function fetchWorks(opts?: { cursor?: number | null; limit?: number }): Promise<WorksPage> {
  const params = new URLSearchParams();
  if (opts?.cursor != null) params.set("cursor", String(opts.cursor));
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const res = await authFetch(`/api/me/works${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`fetchWorks failed: ${res.status}`);
  return (await res.json()) as WorksPage;
}
```

**日志**（`client/src/api/logs.ts`，新文件）：

```ts
import { authFetch } from "./auth";

export type LogType =
  | "signup_bonus" | "recharge" | "admin_grant"
  | "generate" | "edit" | "refund" | "adjust";

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

export async function fetchLogs(opts?: { cursor?: number | null; limit?: number }): Promise<LogsPage> {
  const params = new URLSearchParams();
  if (opts?.cursor != null) params.set("cursor", String(opts.cursor));
  if (opts?.limit != null) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const res = await authFetch(`/api/me/logs${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`fetchLogs failed: ${res.status}`);
  return (await res.json()) as LogsPage;
}
```

### 3.3 分页 hook（`useGallery` / `useLogs`）

两个 hook 结构高度相似（cursor 分页 + 触底加载 + 防竞态 + 登入态同步），共享设计但不强行抽象为通用 hook（YAGNI；只有 2 处复用且业务字段不同）。

**`client/src/hooks/useGallery.ts`**（示意核心：`useLogs` 同形）：

```ts
import { useCallback, useEffect, useRef, useState } from "react";

import { fetchWorks, type RecentWorkItem } from "../api/gptImage";
import { useAuth } from "../auth/AuthContext";

type State = {
  items: RecentWorkItem[];
  nextCursor: number | null;
  loading: boolean;        // 初次加载
  loadingMore: boolean;    // 触底翻页中
  error: string | null;
  endReached: boolean;     // next_cursor === null
};

const INITIAL: State = {
  items: [], nextCursor: null, loading: false, loadingMore: false, error: null, endReached: false,
};

export function useGallery() {
  const { user } = useAuth();
  const [state, setState] = useState<State>(INITIAL);
  const reqSeqRef = useRef(0);

  // 首次加载或登入态变化
  const reload = useCallback(async () => {
    if (!user) {
      setState(INITIAL);
      return;
    }
    const seq = ++reqSeqRef.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const page = await fetchWorks();
      if (seq !== reqSeqRef.current) return;
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
    // 三道闸：未登录 / 已到底 / 正在加载
    if (!user) return;
    setState((s) => {
      if (s.endReached || s.loading || s.loadingMore || s.nextCursor == null) return s;
      return { ...s, loadingMore: true };
    });
    // 用一个独立 ref 拿当前 cursor，避免闭包陈旧
    // 但更简洁：把上面的状态判断重做一遍取当前 cursor
    const currentCursor = state.nextCursor;
    if (currentCursor == null) return;

    const seq = ++reqSeqRef.current;
    try {
      const page = await fetchWorks({ cursor: currentCursor });
      if (seq !== reqSeqRef.current) return;
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
  }, [user, state.nextCursor]);

  useEffect(() => {
    if (!user) {
      setState(INITIAL);
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

`useLogs` 形态相同，把 `fetchWorks` 替换为 `fetchLogs`、`RecentWorkItem` 替换为 `LogItem`。

### 3.4 GalleryPage（`client/src/pages/GalleryPage.tsx`，新文件）

视觉规约：沿用 DESIGN.md 灰阶；4 列瀑布流网格；每张卡 `aspect-square` + 圆角 14px；hover ring-1；时间标签 + +N 角标复用最近作品的样式；触底用 IntersectionObserver 触发 loadMore。

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
    // 未登录态：整页占位文字
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
              <div key={i} className="aspect-square animate-pulse rounded-[14px] bg-white/[0.03]" />
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

### 3.5 LogsPage（`client/src/pages/LogsPage.tsx` + `components/LogRow.tsx`，新文件）

**`components/LogRow.tsx`**：

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

      {/* 中间：动作 + prompt 摘要 */}
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
          {positive ? "+" : ""}{item.delta}
        </span>
        <span className="text-[10px] text-white/40 tabular-nums">余 {item.balance_after}</span>
      </div>
    </div>
  );
}
```

**`pages/LogsPage.tsx`**：

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

### 3.6 App.tsx 改动

**导航 list**（`App.tsx:1698-1704`）改为 4 项：

```tsx
const SIDEBAR_ITEMS: ReadonlyArray<{ key: string; label: string; icon: ReactNode }> = [
  { key: "studio",  label: "工作室", icon: <StudioIcon /> },
  { key: "gallery", label: "画廊",   icon: <GalleryIcon /> },
  { key: "models",  label: "模型",   icon: <ModelsIcon /> },
  { key: "logs",    label: "日志",   icon: <HistoryIcon /> },  // 复用 HistoryIcon
];
```

删除 `InspirationIcon` 函数（`App.tsx:1879`）。

**渲染分支**（`App.tsx:991`）从二叉分支扩展为多叉：

```tsx
{activeNav === "models" ? (
  <ModelPlaza onShapesChange={onShapesChange} />
) : activeNav === "gallery" ? (
  <GalleryPage onPreview={(src) => setPreviewSrc(src)} />
) : activeNav === "logs" ? (
  <LogsPage onPreview={(src) => setPreviewSrc(src)} />
) : (
  // 工作室视图（原 MainCanvas 主区，不动）
  <div className="flex min-w-0 flex-1 flex-col gap-3">
    ...
  </div>
)}
```

`onShapesChange`：画廊页和日志页**不参与玻璃外壳测量**（页面是个大滚动卡片，不是节点画布的多个外壳合集）。当前 `measure()` effect 在 `App.tsx:870-902` 里已经有 `if (activeNav === "models") return;`——我们扩展为 **`if (activeNav !== "studio") return;`**，对 gallery / logs / models 都跳过同样的逻辑。同时把 `onShapesChange([])` 在切到这些页时主动调一次，清空外层玻璃 shapes，避免上次工作室的影子残留。

### 3.7 Lightbox 复用

画廊、日志两页都通过 `onPreview={(src) => setPreviewSrc(src)}` 把 src 抛给 App.tsx 父组件的 `previewSrc` state，**复用现有 Lightbox 组件**（与最近作品卡片同链路），零改造。

---

## 四、数据流

```
后端
  GET /api/me/works?cursor=&limit=24
    -> 同最近作品的过滤 + LIMIT 25 (多取一条判断 has_more)
    -> { items: [...], next_cursor: <id|null> }

  GET /api/me/logs?cursor=&limit=50
    -> SELECT credit_transactions WHERE user_id=? AND id<cursor ORDER BY id DESC LIMIT 51
    -> 批量加载 ref_type='message' 行的 messages
    -> { items: [{...含 ref}], next_cursor: <id|null> }

前端
  useGallery() / useLogs()
    user 变化 -> reload()
    sentinelRef 触底 -> loadMore() (cursor=state.nextCursor)
    next_cursor null -> endReached=true

  GalleryPage / LogsPage
    用 hook items 渲染
    点击 onPreview -> setPreviewSrc (App.tsx 父组件)

  App.tsx
    activeNav 切换 -> 渲染不同页面
    measure() effect 在非 studio 时跳过 + 清空 shapes
```

---

## 五、错误处理

| 场景 | 表现 |
|---|---|
| 未登录调接口 | 401，前端 hook 不发请求 |
| cursor 非法（负数）| 422 by Pydantic |
| limit 越界 | 422 by Pydantic |
| 5xx | 静默 fallback + console.warn，UI 显示空态文案 |
| 触底加载失败 | loadingMore 复位，next_cursor 不变，下次进入可见区域时重试 |
| 缩略图 URL 失效 | 同最近作品 `<img onError>` visibility hidden |
| log_item.ref.thumbnail_url 为 null（image_urls 为空） | LogRow 左侧显示 `+/—` 占位而不是 img |

---

## 六、测试

### 6.1 后端单测

**`server/tests/test_works.py`**（新文件，8 个用例）：

| 用例 | 断言 |
|---|---|
| `test_unauthorized_returns_401` | 无 token → 401 |
| `test_empty_returns_empty_items` | 用户无消息 → `items=[]`, `next_cursor=null` |
| `test_first_page_default_limit_24` | 写 26 条 → 返 24 条 + `next_cursor` 非空 |
| `test_pagination_with_cursor` | 取第一页 → 用其 next_cursor 取第二页 → 返剩余 + `next_cursor=null` |
| `test_custom_limit` | `limit=5` → 返 5 条 |
| `test_limit_max_60` | `limit=100` → 422（超过 max） |
| `test_isolates_other_users` | A/B 用户隔离（沿用最近作品同名用例） |
| `test_excludes_soft_deleted_conv` | 沿用 |

**`server/tests/test_logs.py`**（新文件，8 个用例）：

| 用例 | 断言 |
|---|---|
| `test_unauthorized_returns_401` | 401 |
| `test_empty_returns_empty_items` | 新用户 → `items=[]` |
| `test_includes_all_reason_types` | 写 7 种 reason 各一条 → 全在 items 里 |
| `test_ordered_desc_by_id` | 按 id DESC |
| `test_pagination_with_cursor` | 同 works 分页测试 |
| `test_generate_row_has_ref_with_thumbnail` | reason=generate + ref_type='message' + image_urls 非空 → `ref.thumbnail_url == image_urls[0]` |
| `test_recharge_row_has_no_ref` | reason=recharge → `ref=null` |
| `test_isolates_other_users` | 用户隔离 |

跑：`cd D:/webProject/image2/server && python -m unittest tests.test_works tests.test_logs`

### 6.2 前端 E2E（chrome-devtools MCP）

- 登录 → 切到「画廊」→ 看到所有已生图作为 4 列网格 + 时间标签
- 滚动到底 → loadMore 自动触发 → 拼接下一页
- 切到「日志」→ 看到积分流水时间线（含生图行有缩略图、充值行无缩略图）
- 点击日志里的缩略图 → Lightbox 打开
- 切回「工作室」→ 节点画布 + 玻璃外壳重新测量
- 删「灵感」→ 侧栏只有 4 项（工作室/画廊/模型/日志），无「灵感」

---

## 七、风险与权衡

1. **Prompt 来源妥协**：本期 `prompt_preview` 取自 AI 消息自身 `text` 而非 sibling user 消息。多数 AI 消息 text 为空——展示出来会是 null。**Acceptable**：日志的核心信息是"扣了多少、剩多少、什么时间、什么动作"；缩略图已经能让用户认出是哪张图。后续如要补 prompt，是独立 follow-up。
2. **画廊与最近作品的查询函数重复**：实施时抽 `services/works_query.py` 共享 helper，否则两路由有几乎一样的 50 行代码。**实施时纳入 plan 的第一个任务**。
3. **`next_cursor` 用 `message_id` 而非 timestamp**：依赖"id 单调递增与 created_at 同序"假设。MySQL 自增 + 应用层串行写入下成立。若未来引入分布式 ID（雪花算法之类）需重审。本期接受。
4. **触底无虚拟列表**：4 列网格滚动到几百张时 DOM 节点 ~1000 个 + 每张图 base64 数 MB → 浏览器卡。**这是 [仍未解决的] base64 存储问题的放大**，与本任务无关；与之前最近作品的 README 说明一致——上线前必须改 CDN URL。
5. **不做 search/筛选**：画廊上百张后翻找特定图体验差。Acceptable for MVP；列表会按时间倒序，最近的图就在最前。

---

## 八、变更清单（实施时按此对照）

**后端**
- [ ] 新增 `server/app/works_service.py`（公共查询 helper，最近作品 + 画廊共用）
- [ ] 重构 `server/app/routers/recent_works.py` 使用新 helper
- [ ] 新增 `server/app/routers/works.py`
- [ ] 新增 `server/app/routers/logs.py`
- [ ] `server/app/schemas.py` 追加 `WorksPage` / `LogType` / `LogRef` / `LogItem` / `LogsPage`
- [ ] `server/app/main.py` 注册新路由
- [ ] 新增 `server/tests/test_works.py`、`server/tests/test_logs.py`

**前端**
- [ ] `client/src/api/gptImage.ts` 追加 `fetchWorks` + `WorksPage` 类型
- [ ] 新增 `client/src/api/logs.ts`
- [ ] 新增 `client/src/hooks/useGallery.ts`
- [ ] 新增 `client/src/hooks/useLogs.ts`
- [ ] 新增 `client/src/components/LogRow.tsx`
- [ ] 新增 `client/src/pages/GalleryPage.tsx`
- [ ] 新增 `client/src/pages/LogsPage.tsx`
- [ ] `client/src/App.tsx`：
  - 删 `SIDEBAR_ITEMS` 的 inspiration 项
  - 改 history → logs（key + label）
  - 删 `InspirationIcon` 函数
  - 加 gallery / logs 渲染分支
  - 改 `measure()` effect 跳过条件为 `activeNav !== "studio"`
  - import 新页面与 hook
