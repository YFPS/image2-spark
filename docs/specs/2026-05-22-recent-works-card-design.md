# 最近作品卡片功能设计

- **日期**：2026-05-22
- **范围**：
  - 后端：新增 `routers/recent_works.py`（1 个 endpoint：`GET /api/me/recent-works`）
  - 前端：新增 `client/src/components/RecentWorksCard.tsx` + `client/src/hooks/useRecentWorks.ts` + `client/src/utils/relativeTime.ts`，从 `App.tsx` 抽出现有硬编码卡片
  - `client/src/api/gptImage.ts` 追加 `fetchRecentWorks()`，沿用 `authFetch` 风格
- **不在范围**：
  - 「查看全部」按钮目标页面（"作品库"页）——本期**直接隐藏该按钮**，待后续做画廊页时再回填
  - 同批 N 张图的预览左右切换——本期点缩略图仅预览主图，其余靠跳回会话查看
  - 分页 / 无限滚动 / 搜索 / 删除作品 / 收藏
  - 跨标签实时同步（不上 SSE / WebSocket）
  - 服务端图片二进制存储——仍只引用上游 CDN URL，CDN 失效则历史里图损（与 AI 对话历史 spec 一致）
  - 未登录访客的占位/示例填充——未登录时**整卡不渲染**

---

## 一、背景

`client/src/App.tsx:1387-1409` 的「最近作品」横滑卡片当前是死数据：

```tsx
{["刚刚", "2 小时前", "昨天", "2 天前", "3 天前"].map((t) => (
  <div ...>
    <DemoBearArtwork />
    <span ...>{t}</span>
  </div>
))}
```

`DemoBearArtwork`（`App.tsx:3023`）是个 SVG 动画占位，5 个时间标签是硬编码字符串。「查看全部」按钮无 onClick。

后端已经具备数据基础（`server/app/models.py` 里的 `Conversation` 与 `Message`，由 `2026-05-18-ai-conversation-history-design.md` 引入）：

| 表 | 关键列 |
|---|---|
| `conversations` | `id`、`user_id`、`deleted_at`（软删）|
| `messages` | `conversation_id`、`role` (`user`/`ai`)、`image_urls` (JSON, nullable)、`params` (JSON, nullable)、`status` (`done`/`pending`/`failed`)、`created_at`|

所以"用户最近完成的 AI 出图"是个 `Message JOIN Conversation` 上的过滤+排序+LIMIT 查询，不需要新建任何表。

**用户给的指引（brainstorming 已确认）：**

| 决策点 | 选择 |
|---|---|
| 数据源 | 跨所有会话的最近 AI 出图（`role='ai' AND status='done' AND image_urls IS NOT NULL`）|
| 点击行为 | 复用现有 `setPreviewSrc` 打开大图 lightbox |
| 数量 | 固定 12 张，不分页；「查看全部」按钮本期隐藏 |
| 时间标签 | 相对时间（"刚刚" / "N 分钟前" / "N 小时前" / "昨天" / "N 天前"），一周外退化为 `MM/DD` |
| 一条消息 N 张图 | 主图 + 右下角 "+N" 角标；预览只展示主图，本期不做批内切换 |
| 未登录态 | 整卡不渲染（`useAuth().user` 为 null 时返回 null）|
| 实时刷新 | 当前会话内 AI 消息 `pending → done` 时，触发 `recentWorks.refresh()` |

---

## 二、后端设计

### 2.1 路由（`server/app/routers/recent_works.py`，新文件）

```python
from fastapi import APIRouter, Depends
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import get_current_user, get_db
from ..models import Conversation, Message, User
from ..schemas import RecentWorkItem, RecentWorksOut

router = APIRouter(prefix="/api/me", tags=["recent_works"])

RECENT_LIMIT = 12  # 与前端 UI 容量一致；改这个常量时前端不用同步改


@router.get("/recent-works", response_model=RecentWorksOut)
async def list_recent_works(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RecentWorksOut:
    """用户跨所有会话的最近 AI 出图，按 messages.created_at DESC 取前 12 条。

    过滤条件：
      - conversation.user_id == 当前用户
      - conversation.deleted_at IS NULL（软删的会话整体隐藏）
      - message.role == 'ai'
      - message.status == 'done'
      - message.image_urls IS NOT NULL AND JSON 长度 > 0
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
            # 双保险：DB 层 JSON 长度过滤 MySQL 写法繁琐，应用层兜一下
            continue
        items.append(
            RecentWorkItem(
                message_id=m.id,
                conversation_id=m.conversation_id,
                image_url=urls[0],
                image_count=len(urls),
                all_image_urls=urls,
                size=(m.params or {}).get("size") if m.params else None,
                created_at=m.created_at,
            )
        )
    return RecentWorksOut(items=items)
```

**注册**：`server/app/main.py` 追加 `app.include_router(recent_works.router)`。

### 2.2 Schemas（`server/app/schemas.py` 追加）

```python
class RecentWorkItem(BaseModel):
    """一条「最近作品」记录，对应一条已完成的 AI 消息（可能多图，取首张作主图）"""
    message_id: int
    conversation_id: int
    image_url: str           # image_urls[0]
    image_count: int         # len(image_urls)，前端 image_count > 1 时显示 "+N" 角标
    all_image_urls: list[str]
    size: str | None = None  # 来自 params.size，无则 null
    created_at: datetime


class RecentWorksOut(BaseModel):
    items: list[RecentWorkItem]
```

`size` 为什么放进来：以后做 hover tooltip / 预览 metadata 时用得上；后端反正已经把整条 message 加载出来了，不返这字段没意义。

### 2.3 认证与错误

- 未登录 → `get_current_user` 401（沿用现有 auth 行为）
- DB 异常 → FastAPI 默认 500 + 全局错误包装（沿用 `routers/images.py` 错误形状不必要——这是只读列表接口，500 不需要 `upstream_status` 字段）
- 接口幂等、纯查询，无副作用，无须限流

### 2.4 性能

- 12 条 LIMIT，单查询走 `idx_msg_conv_id`（已存在）+ Conv 主键 join
- 没有 N+1：单次 `JOIN` 完成
- 不做 cache（用户量级下 < 5 ms；上 Redis 反而成 invalidation 负担）

---

## 三、前端设计

### 3.1 文件结构

```
client/src/
├── api/
│   └── gptImage.ts                 # 追加 fetchRecentWorks() 与类型
├── components/
│   └── RecentWorksCard.tsx         # 新文件，外层卡片 + 横滑容器 + 子缩略图
├── hooks/
│   └── useRecentWorks.ts           # 新文件
├── utils/
│   └── relativeTime.ts             # 新文件，纯函数
└── App.tsx                         # 用 <RecentWorksCard ref={recentCardRef} ... /> 替换 1387-1409
```

为什么 `RecentWorksCard.tsx` 单独抽出而不直接在 App.tsx 改写：加上 loading 骨架 / 空态 / 错误兜底 / 缩略图加载失败 fallback / "+N" 角标后会增加约 60 行，留在已 3000+ 行的 App.tsx 不利于阅读；卡片本身职责单一（拉数据、渲染、点击转发预览），符合 brainstorming 段落 "Design for isolation" 原则。

### 3.2 API 层（`client/src/api/gptImage.ts` 追加）

```ts
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

### 3.3 Hook（`client/src/hooks/useRecentWorks.ts`，新文件）

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { fetchRecentWorks, type RecentWorkItem } from "../api/gptImage";

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

  // 登入 / 登出 自动同步
  useEffect(() => {
    if (!user) {
      setState(INITIAL);
      reqSeqRef.current++;
      return;
    }
    void refresh();
  }, [user, refresh]);

  return { items: state.items, loading: state.loading, error: state.error, refresh };
}
```

### 3.4 实时刷新接入点

`useConversations.ts:216-246` 已经有 AI 消息状态轮询循环（每 2 s 重拉 current conv 直到所有 pending 翻 done/failed）。我们在这层之上、**在 `MainCanvas` 组件里**做监听：

```tsx
// App.tsx 内 MainCanvas 中（伪代码示意）
const recentWorks = useRecentWorks();
const messages = conversations.current?.messages ?? [];

// 跟踪当前 conv 的 ai-done 数量；同会话内 done 数量增加 → 触发 refresh
const lastDoneCountRef = useRef<{ convId: number | null; count: number }>({
  convId: null,
  count: 0,
});
useEffect(() => {
  const convId = conversations.current?.id ?? null;
  const doneCount = messages.filter(
    (m) => m.role === "ai" && m.status === "done" && (m.image_urls?.length ?? 0) > 0,
  ).length;

  const prev = lastDoneCountRef.current;
  if (prev.convId === convId && doneCount > prev.count) {
    // 同一会话内 done 计数上涨 → 新出图完成
    void recentWorks.refresh();
  }
  lastDoneCountRef.current = { convId, count: doneCount };
}, [messages, conversations.current?.id, recentWorks]);
```

**为什么不写进 `useConversations.ts`**：那个 hook 只关心会话本身的状态；让它"知道"还有最近作品要刷新会让职责模糊。在调用方（`MainCanvas`）做派生最干净。

**已知边界（acceptable）**：
1. 用户在会话 A 发起生图 → 切到会话 B → A 的 pending 仍在后台，但 `useConversations` 只轮询 current（即 B），所以 A 的 done 不会触发 refresh。下次回到 A 或下次页面刷新时才会出现。这是 `useConversations` 的现有边界，本设计不修。
2. 跨标签：标签 X 生图，标签 Y 不会自动出现。Acceptable（未在需求范围内）。

### 3.5 时间格式（`client/src/utils/relativeTime.ts`，新文件）

```ts
/**
 * ISO 时间戳 → 中文相对时间标签
 *  - <1 min     "刚刚"
 *  - <60 min    "N 分钟前"
 *  - <24 h      "N 小时前"
 *  - 昨日       "昨天"
 *  - <7 d       "N 天前"
 *  - 否则       "MM/DD"
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  const diffMs = now.getTime() - t.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;

  // 昨日判断：按"当地日历日"差
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
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

### 3.6 UI 组件（`client/src/components/RecentWorksCard.tsx`，新文件）

```tsx
import { forwardRef } from "react";
import { useAuth } from "../auth/AuthContext";
import { useRecentWorks } from "../hooks/useRecentWorks";
import { formatRelativeTime } from "../utils/relativeTime";

type Props = {
  /** 点击缩略图，向上抛 lightbox src */
  onPreview: (src: string) => void;
};

export const RecentWorksCard = forwardRef<HTMLDivElement, Props>(function RecentWorksCard(
  { onPreview },
  ref,
) {
  const { user } = useAuth();
  const { items, loading } = useRecentWorks();

  // 未登录：整卡不渲染（连占位都不画）
  if (!user) return null;

  return (
    <div ref={ref} className="flex shrink-0 flex-col rounded-[28px] p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-medium text-white/82">最近作品</span>
        {/* 「查看全部」本期隐藏 —— 待画廊页落地后再回填 */}
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
                  // 加载失败：藏掉 img，让深底色露出
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
});
```

### 3.7 App.tsx 接入

替换 `App.tsx:1387-1409` 整块为：

```tsx
<RecentWorksCard ref={recentCardRef} onPreview={(src) => setPreviewSrc(src)} />
```

并在 MainCanvas 顶部加 3.4 节那块「done 计数监听」effect。

---

## 四、数据流

```
后端
  GET /api/me/recent-works
    -> SELECT msg JOIN conv WHERE ... ORDER BY created_at DESC LIMIT 12
    -> RecentWorksOut { items: [...] }

前端
  useRecentWorks()
    user 变化 -> refresh() -> fetch /api/me/recent-works
    refresh() 可由外部调用

  MainCanvas effect
    当前会话内 AI done 计数 +1 -> recentWorks.refresh()

  RecentWorksCard
    用 items 渲染 12 个缩略图
    点击 -> onPreview(image_url) -> 父组件 setPreviewSrc -> 现有 Lightbox 接管
```

---

## 五、错误处理

| 场景 | 表现 |
|---|---|
| 未登录访问 `/api/me/recent-works` | 401，前端 hook 早就因 `user` null 不发请求 |
| 后端 5xx | hook 静默 fallback，console.warn，UI 显示空态文案 |
| 网络中断 | 同上，下次 refresh() 时自动重试 |
| 图片 URL 失效（上游 CDN 删除） | `<img onError>` 隐藏 img，深底色 + 时间标签仍可见，不影响其他卡 |
| `image_urls` 是 `[]`（异常数据） | 后端应用层兜底跳过；前端不会收到 image_url 为空的 item |

---

## 六、测试

### 6.1 后端单测（`server/tests/test_recent_works.py`，新文件）

| 用例 | 断言 |
|---|---|
| `test_unauthorized_returns_401` | 无 token 调 endpoint → 401 |
| `test_empty_returns_empty_items` | 用户无任何 AI 消息 → `items=[]` |
| `test_only_ai_done_with_images_listed` | 混入 user / pending / failed / image_urls 为 null 的 ai 消息 → 仅 ai+done+非空图返回 |
| `test_ordered_desc_by_created_at` | 5 条不同时间 → 严格倒序 |
| `test_limit_12` | 写入 15 条 → 返回 12 条且为最新 12 |
| `test_isolates_other_users` | 用户 A 有 5 条、B 有 3 条 → A 调接口只看到 A 的 5 条 |
| `test_excludes_soft_deleted_conv` | conv.deleted_at 设置后 → 该会话下的消息不出现 |
| `test_image_count_field` | image_urls 是 `["a","b","c"]` → `image_count=3`、`all_image_urls=["a","b","c"]` |

跑：`cd server && python -m unittest tests.test_recent_works`

### 6.2 前端验证（chrome-devtools MCP，遵循项目规约「改完先 E2E 再交付」）

- 黄金路径：登录 → 触发一次生图 → 等 done → 「最近作品」卡片立即出现新图（左侧第一个位置）
- 切会话不刷新：切到一个没 pending 的旧会话 → 卡片内容稳定（不重置）
- 未登录：登出 → 卡片消失
- 空态：新注册用户从未生过图 → 空态文案显示
- 点击预览：点缩略图 → Lightbox 打开正确 URL
- N 张图角标：若上游有 n=2/3 的生成 → 卡片显示 "+1" / "+2" 角标
- 图片加载失败：用 devtools 拦截一个图 URL 返 404 → 该卡不报红、其他卡正常

---

## 七、风险与权衡

1. **批内多图无切换**：用户选了 "+N 角标" 而不是拆分单图，又选了"本次只预览主图"。代价是看不到批次里第 2 张及以后；缓解：用户可以跳到对应会话里看（右侧 AI 助手已经把 N 张全展示）。可接受。
2. **`useConversations` 只轮询 current**：跨会话的后台生图不会推到最近作品。这是现有 hook 的边界，本设计不扩展轮询范围。可接受。
3. **`size` 字段从 `params` 取**：依赖前端发请求时确实把 size 写进 params。已抽查 `useConversations.appendMessage` 与 `gptImage.ts` 任务化生图链路，params 包含 size。若历史脏数据缺 size，`get` 返 None、UI 不依赖此字段，安全。
4. **无 Redis 缓存**：12 条 LIMIT 查询单用户单页面冷启动只触发一次；done→refresh 是一次重拉。流量不构成压力。
5. **登入态切换时的玻璃外壳测量**：父组件 `MainCanvas` 的 `measure()` effect（`App.tsx:855`）依赖 `recentCardRef.current` 在 ResizeObserver 启动时存在。未登录 → 登入后，`RecentWorksCard` 从返回 null 变成挂载真实 DOM，此时 ref 在 observer 已经初始化之后才到位，外层 LiquidGlass 不会立刻把这块加到 shapes 数组里——要等下一次窗口 resize 或 activeNav 切换重跑 effect。表现：登入后第一帧最近作品卡片**没有外层玻璃壳衬底**，看起来就是裸的横滑区。可接受（登入流程结束后用户通常会有一次窗口聚焦/操作触发 resize），不在本期修复范围；若真要修，独立任务里处理（让 effect 监听 `user` 即可）。

---

## 八、变更清单（实施时按此对照）

**后端**
- [ ] 新增 `server/app/routers/recent_works.py`
- [ ] `server/app/schemas.py` 追加 `RecentWorkItem` / `RecentWorksOut`
- [ ] `server/app/main.py` 注册新路由
- [ ] 新增 `server/tests/test_recent_works.py`

**前端**
- [ ] `client/src/api/gptImage.ts` 追加 `fetchRecentWorks` + 类型
- [ ] 新增 `client/src/utils/relativeTime.ts`
- [ ] 新增 `client/src/hooks/useRecentWorks.ts`
- [ ] 新增 `client/src/components/RecentWorksCard.tsx`
- [ ] `client/src/App.tsx` 替换 1387-1409 为 `<RecentWorksCard>`、增加 done 计数监听 effect、import 清理
