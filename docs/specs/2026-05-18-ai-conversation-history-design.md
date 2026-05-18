# AI 对话历史 + 时间轴设计

- **日期**：2026-05-18
- **范围**：
  - 后端：新增 `Conversation` / `Message` 两张表 + 一个 `routers/conversations.py`（6 个 endpoints），接现有 auth
  - 前端：新增 `src/conversation/` 模块（5 个组件 + 1 个 hook + 1 个 api 镜像）
  - 改造 `client/src/App.tsx`：现有 `chatMessages` 数组从内存态升级为服务端持久化的 `currentConversation.messages`
  - UI：右侧 AI 聊天面板**左侧紧贴**一根纵向 timeline rail，节点画布"节点酱"风
- **不在范围**：
  - 图片二进制存储（只存 CDN URL；上游 CDN 失效则历史里图损，MVP 接受）
  - 实时跨标签同步（不上 SSE / WebSocket）
  - 全文索引（搜索仅做 `ILIKE %q%` 匹配 title + 首条 prompt）
  - 历史导出 / 分享
  - 协作多人共享会话
  - 移动端（≤1024px）的 timeline rail 适配（沿用 DESIGN.md 桌面优先策略，移动端隐藏）

---

## 一、背景

`client/src/App.tsx:545` 的 `chatMessages: ChatMsg[]` 是个**内存数组**：
- 每次发 prompt 推一条 user + 一条 ai pending；AI 出图回填 ai 那条
- 没有任何持久化，刷新页面就丢
- 没有"会话"概念——只有一根扁平消息流

后端 `server/app/` 现有：
- `auth_service.py` + `routers/auth.py`：注册/登录/me，JWT
- `routers/images.py`：图像生成代理 + 抠图
- `models.py` 里只有 `User` 一张表

**用户给的指引（brainstorming 已确认）：**

| 决策点 | 选择 |
|---|---|
| 存储方式 | 服务端持久化 |
| 记录单元 | 会话 Session（外层 session，里面多条 user/ai message） |
| 时间轴形态 | 纵向 timeline + 节点酱 |
| 入口位置 | 贴 AI 聊天面板左侧的双 dock（可手动折叠到 56px 节点轴） |
| 存图策略 | 只存对话文本 + 生成参数 + 图片 URL，不存二进制 |
| CRUD 范围 | 重命名 / 删除 / 收藏置顶 / 关键词搜索 |
| 时间分组 | pinned / 今天 / 昨天 / 过去 7 天 / 更早 |

---

## 二、后端设计

### 2.1 数据模型（`server/app/models.py` 追加）

```python
class Conversation(Base):
    __tablename__ = "conversations"

    id            = Column(Integer, primary_key=True)
    user_id       = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    title         = Column(String(120), default="", nullable=False)
    pinned        = Column(Boolean, default=False, nullable=False)
    created_at    = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at    = Column(DateTime, default=datetime.utcnow, nullable=False)  # 最后一条 message 时间
    deleted_at    = Column(DateTime, nullable=True, index=True)                # 软删除

    messages = relationship("Message", back_populates="conversation",
                            cascade="all, delete-orphan",
                            order_by="Message.id.asc()")

class Message(Base):
    __tablename__ = "messages"

    id              = Column(Integer, primary_key=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), index=True, nullable=False)
    role            = Column(String(16), nullable=False)   # "user" | "ai"
    text            = Column(Text, default="", nullable=False)
    image_urls      = Column(JSON, nullable=True)          # list[str] | None
    params          = Column(JSON, nullable=True)          # dict | None：size/model/quality/...
    created_at      = Column(DateTime, default=datetime.utcnow, nullable=False)

    conversation = relationship("Conversation", back_populates="messages")
```

**字段说明：**
- `title` 默认空串。**首次写入 user message 时**，若 title 仍为空，自动取该 message.text 前 30 字（trim、转单行）作为 title。
- `pinned` 收藏 / 置顶。
- `updated_at` 由 `POST /messages` 触发更新（不靠 SQLAlchemy 的 `onupdate`，因为只想在追加消息时刷新，不想在重命名时刷新——重命名不该改 timeline 排序）。
- `deleted_at` 软删除。所有列表查询 `WHERE deleted_at IS NULL`。
- `image_urls` 存 gpt-image-2 上游返回的 URL（可能多张）。
- `params` 存生成参数：`{size, quality, model, ratio, n, ...}`。供"还原会话"时回填 UI。

### 2.2 Pydantic schemas（`server/app/schemas.py` 追加）

```python
class MessageOut(BaseModel):
    id: int
    role: Literal["user", "ai"]
    text: str
    image_urls: list[str] | None = None
    params: dict | None = None
    created_at: datetime

class ConversationListOut(BaseModel):
    id: int
    title: str
    pinned: bool
    preview: str           # 首条 user.text 前 60 字（用于卡片预览）
    message_count: int
    created_at: datetime
    updated_at: datetime

class ConversationDetailOut(ConversationListOut):
    messages: list[MessageOut]

class ConversationPatchIn(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=120)
    pinned: bool | None = None

class MessageCreateIn(BaseModel):
    role: Literal["user", "ai"]
    text: str = Field("", max_length=20000)
    image_urls: list[HttpUrl] | None = None
    params: dict | None = None
```

### 2.3 路由（`server/app/routers/conversations.py` 新建）

```
GET    /api/conversations?q=<keyword>&pinned=<0|1>
       → list[ConversationListOut]
       排序：pinned DESC, updated_at DESC
       q 走 ILIKE %q% 匹配 title 和 (SELECT text FROM messages WHERE conversation_id=c.id ORDER BY id LIMIT 1)

POST   /api/conversations
       body 可空；返回 ConversationDetailOut（messages 为空数组）

GET    /api/conversations/{id}
       → ConversationDetailOut；404 如不属于当前 user 或已软删

PATCH  /api/conversations/{id}
       body: ConversationPatchIn；返回 ConversationListOut

DELETE /api/conversations/{id}
       软删（写 deleted_at=now()）；204 No Content

POST   /api/conversations/{id}/messages
       body: MessageCreateIn；返回 MessageOut
       副作用：① 更新 conversation.updated_at；② 若 conversation.title 为空且 role==user，回填 title=text[:30]
```

**权限**：所有 endpoint 用 `Depends(get_current_user)`，按 `user_id == current_user.id` 过滤。
**错误形状**：沿用 `{"error":{"code","message"}}`（参照 `routers/images.py` 错误返回）。

### 2.4 数据库迁移

项目当前**没有用 alembic**（看 `models.py` 用 `Base.metadata.create_all(bind=engine)` 自动建表）。沿用：在 `models.py` 导入新模型即可，启动时自动建表。

### 2.5 测试（`server/tests/test_conversations.py` 新建）

最小化覆盖：
- `test_create_conversation_with_first_message_autofills_title`
- `test_list_filters_by_user_and_excludes_soft_deleted`
- `test_search_by_keyword_matches_title_or_first_message`
- `test_patch_pin_and_rename`
- `test_delete_is_soft`

不测 happy-path 的 200 返回，那是 FastAPI 自带的。

---

## 三、前端设计

### 3.1 目录结构

```
client/src/
├─ api/
│   └─ conversations.ts            # TS 类型镜像 + fetch wrapper（getList/get/create/patch/del/postMessage）
├─ conversation/
│   ├─ TimelineRail.tsx            # 主容器：220px 展开 / 56px 折叠 双态
│   ├─ SessionGroup.tsx            # 时间分组：标签 + 卡片列表
│   ├─ SessionCard.tsx             # 单条 session 卡（节点酱风）
│   ├─ SessionMenu.tsx             # ⋯ 菜单：重命名 / 收藏 / 删除
│   ├─ useConversations.ts         # 状态 hook：fetch + cache + optimistic mutate
│   └─ groupByTime.ts              # 纯函数：list → {pinned, today, yesterday, last7, earlier}
└─ App.tsx                         # 改造：嵌入 TimelineRail + 重写 chatMessages 数据流
```

### 3.2 数据流改造（App.tsx）

**新增 state：**
```ts
const [currentConvId, setCurrentConvId] = useState<number | null>(null);
```

**chatMessages 改为派生：**
不再用本地 `useState<ChatMsg[]>`，而是用 `useConversations()` 返回的 `current.messages` 派生：
```ts
const { current, list, refresh, createConversation, appendMessage, ... } = useConversations(currentConvId);
const chatMessages: ChatMsg[] = (current?.messages ?? []).map(toChatMsg);
```

**消息提交流程：**
1. 用户点 "生成" → `prompt = chatInput.trim()`
2. 若 `currentConvId == null` → `const conv = await createConversation()` → `setCurrentConvId(conv.id)`
3. `appendMessage(currentConvId, { role: "user", text: prompt })`（乐观更新本地缓存）
4. 调 `generateImages(...)` 出图
5. 出图成功 → `appendMessage(currentConvId, { role: "ai", text: "...", image_urls, params })`

**会话切换：**
点 timeline 卡 → `setCurrentConvId(cardId)` → `useConversations` 自动拉详情 → chatMessages 替换

**"新对话"按钮：**
现有 App.tsx:1409 已有"新对话"按钮，改成 `() => setCurrentConvId(null)`。下一次提交时再创建。

### 3.3 TimelineRail 视觉

**展开态（220px）：**
```
┌──────────────────────┐
│ 🔍 搜索…              + │  ← 顶栏：搜索框 + 新对话按钮
│ ◈ 收藏                  │
│   ○ sky walk         ☆ │  ← 圆环=未选 / 实心=选中 / 金黄=收藏
│ · 今天                   │
│   ● neo tokyo      ⋯   │  ← hover 出 ⋯ 菜单
│   ○ grass field         │
│ · 昨天                   │
│   ○ deep ocean          │
│ · 过去 7 天               │
│   ○ ...                 │
│ · 更早                   │
│   ○ ...                 │
└──────────────────────┘
```

**折叠态（56px）：节点轴**
```
┌──┐
│ ◈│
│ ○│
│ ●│  ← 只显示圆点，hover 出 tooltip 看 title
│ ○│
│ ○│
└──┘
```

**视觉细节：**
- 容器：`rgba(28,28,32,0.6)` + `backdrop-filter: blur(18px) saturate(140%)` + 1px `rgba(255,255,255,0.08)` border + 14px 圆角
- 节点轴左缘：1px 虚线 `rgba(255,255,255,0.06)`（从顶到底贯穿）
- 圆点：`h-2.5 w-2.5 rounded-full` + 2px 画布色外环 + 6px glow
  - 未选：空心白圆环 `border:1.5px rgba(255,255,255,0.85)`
  - 选中：实心 `#FFFFFF`
  - 收藏：实心 `#F0FE2D`（accent-foxo），外加 6px 黄 glow
- 卡片：12px 圆角，padding 8/10，hover `rgba(255,255,255,0.04)` 高光；selected 加 1px `#4CB1FF` 外环
- 时间分组标签：caption 11px text-muted，前面 `·` 小点
- 顶栏搜索框：透明 + 1px 灰 border + focus 加 1px 天蓝 ring
- 折叠按钮：右上 16×16 chevron，hover 浅高光

**布局定位：**
- TimelineRail `position: fixed`，`right: <chat panel 宽度>`，`top/bottom: 16`，整个右侧形成"timeline + chat"双 dock 簇
- 折叠/展开切换平滑过渡 `transition: width 200ms ease-out`
- chat panel 左 margin 不动（让 TimelineRail 浮在其左侧的玻璃边缘上，构成"两片玻璃贴在一起"的视觉）

### 3.4 useConversations hook

```ts
function useConversations(currentId: number | null) {
  // 列表：单次 fetch + 本地 cache，所有 mutate 走乐观更新
  const [list, setList] = useState<ConversationListItem[]>([]);
  const [current, setCurrent] = useState<ConversationDetail | null>(null);
  const [searchQ, setSearchQ] = useState("");

  // 初始 + 搜索时拉列表
  useEffect(() => { void fetchList(searchQ); }, [searchQ]);

  // 切换 currentId 时拉详情
  useEffect(() => {
    if (currentId == null) { setCurrent(null); return; }
    void fetchDetail(currentId).then(setCurrent);
  }, [currentId]);

  return {
    list, current, searchQ, setSearchQ,
    createConversation: async () => { ... },           // POST /conversations → 返回 detail
    appendMessage: async (id, msg) => { ... },         // optimistic：先本地 push，失败回滚
    rename: async (id, title) => { ... },              // PATCH
    togglePin: async (id) => { ... },                  // PATCH
    remove: async (id) => { ... },                     // DELETE
    refresh: () => fetchList(searchQ),
  };
}
```

不引入 React Query / SWR 这类库——MVP 一个 hook + useState 够用，避免新依赖。

### 3.5 时间分组（`groupByTime.ts`）

```ts
type Group = "pinned" | "today" | "yesterday" | "last7" | "earlier";

export function groupByTime(list: ConversationListItem[]): Record<Group, ConversationListItem[]> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400_000);
  const last7Start = new Date(todayStart.getTime() - 7 * 86400_000);

  // pinned 单独分组（即使时间在 today 也只算 pinned，不重复）
  // 其余按 updated_at 落入 today / yesterday / last7 / earlier
}
```

排序：组内按 `updated_at desc`。

---

## 四、关键决策记录

| 决策点 | 选择 | 备注 |
|---|---|---|
| 后端持久化 | **服务端 + SQLAlchemy** | 跨设备同步，沿用现有 db 栈 |
| 颗粒度 | **Session（外层）+ Message（内层）** | 经典 ChatGPT 模型 |
| 入口 | **AI 聊天面板左侧紧贴 timeline rail** | 双 dock 簇，可折叠 |
| 折叠态 | **56px 节点轴**（只剩圆点 + tooltip） | 给画布让出 viewport |
| 图片存储 | **只存 CDN URL** | 不占磁盘；CDN 失效时图损是 MVP 可接受成本 |
| 实时同步 | **不做 SSE/WS** | MVP 仅手动 refresh |
| 搜索 | **ILIKE %q% 匹配 title + 首条 prompt** | 不上全文索引 |
| CRUD | **rename / pin / delete（软）/ search 全要** | 用户明确点了 |
| 删除策略 | **软删除** | 误删可恢复（虽然 MVP 不开放恢复 UI） |
| 数据 hook | **自写 useState + useEffect** | 不引 React Query / SWR |
| 数据库迁移 | **沿用 Base.metadata.create_all** | 项目无 alembic |

---

## 五、风险与回滚

**风险：**
1. **App.tsx 改造面积大**：现有 chatMessages 流转代码（~280 行 in App.tsx）要全替换。一旦 hook 有 bug，整个生成流程瘫痪。
2. **乐观更新失败回滚复杂**：appendMessage 失败时本地缓存要正确回滚到追加前。
3. **TimelineRail 与 chat panel 拼接的视觉精度**：贴边玻璃在亚像素层面可能露缝，要测试主流浏览器。

**回滚：**
- 后端：仅新增表，不动现有 schema；rollback 删除 `routers/conversations.py` + `models.py` 里两个新 class，drop 两张表即可。
- 前端：保留 `chatMessages: ChatMsg[]` 的纯本地版本作为 fallback flag（feature flag `VITE_HISTORY_ENABLED=0` 时回到内存态）。**MVP 不实现 flag**，先直接切换；如果发版前发现问题，git revert 那一个 commit。

---

## 六、实施顺序

按依赖顺序：

1. **后端模型 + schema** —— 一次落地，不动现有代码
2. **后端路由 + 测试** —— 独立可验证
3. **前端 api 镜像 + hook + 时间分组工具** —— 不动 UI，可单测
4. **TimelineRail / SessionCard / SessionGroup / SessionMenu 视觉壳** —— 用 mock 数据先看视觉
5. **App.tsx 改造**：嵌入 TimelineRail + 把 chatMessages 改为派生
6. **E2E 验证**：注册新账号 → 发 3 条消息 → 切到另一个会话 → 重命名 / 收藏 / 删除 → 搜索

每步可独立提交，方便回滚。

---

## 七、实施偏离记录（与 spec 不一致的最终实现）

实施过程中根据用户视觉反馈做了几处调整，记录在此让 spec 与现实对齐。

### 7.1 TimelineRail 视觉：从"卡片列表"演变为"tick 列"

**原 spec**：每条 session = 一张卡（圆点 + 标题 + preview + 时间 + ⋯ 菜单）。

**实际实现**：每条 session = 一根 `h-[1px]` 的短横线 tick（参考 Claude.ai 右侧消息 timeline）。
- 长短交替（按 index parity 6 / 12px）形成视觉节奏
- 三级亮度（Tailwind named-group CSS 级联）：
  - 默认 `bg-white/15`，几乎隐形
  - 整轴 hover `group-hover/rail:bg-white/40`
  - 单 tick hover `group-hover/tick:bg-white/95` + 宽度加到 16
- `selected` 直接覆盖为白色加宽，`pinned` 覆盖为电黄 + glow

### 7.2 时间分组标签去除

**原 spec**：5 个时间分组 today / yesterday / last7 / earlier / pinned，每组渲染中文标签。

**实际实现**：只保留 `pinned`（最上）和 `others`（按 `updated_at desc`）两段，**不渲染分组标签**——更接近 Claude.ai 视觉。
- `groupByTime.ts` 文件已删除
- 时间信息保留在 tooltip / 胶囊内

### 7.3 CRUD 操作的入口位置

**原 spec**：卡片 hover 时浮 `⋯ SessionMenu` 弹层。

**实际实现**：
- 折叠态：hover tick 显示**单行 tooltip 仅标题**，无操作按钮
- 展开态（240px）：tick 右侧渲染**胶囊标题**，hover 胶囊浮出 `⭐ pin / ✎ rename / 🗑 delete` inline 操作组
- `SessionMenu.tsx` 文件已删除

### 7.4 双态尺寸调整

**原 spec**：220 / 56px（展开 / 折叠）

**实际实现**：240 / 72px——折叠态 72 给上下导航箭头 + tick 列预留居中空间，展开态 240 给胶囊标题更舒适的宽度。

### 7.5 新增"上一条 / 下一条"导航

整组 hover 时顶部 / 底部 fade-in 两个圆形按钮，按 `[...pinned, ...others]` 顺序前后切换 currentId。

### 7.6 默认会话欢迎语降级

切换 currentId 到 null 或选中空会话时，chat 面板渲染本地默认欢迎气泡（`"你好，把你想生成的画面..."`），不与持久化数据混淆。

### 7.7 删除的模块

- `client/src/conversation/groupByTime.ts`（不再分时间段）
- `client/src/conversation/SessionMenu.tsx`（操作整合进胶囊 inline）

### 7.8 修复的代码审查发现

- **乐观 message id 撞 id**：`-Date.now()` 改为单调递减 ref counter（`optimisticSeqRef`），同毫秒连发多条消息也不会冲突
- **搜索按键无 debounce**：`useEffect` 内对非空 `searchQ` 加 250ms debounce，避免每个按键打后端

### 7.9 v0.2 玻璃质感铁律的应用

`DESIGN.md` v0.2 明确要求：真液态玻璃只用于父级容器，由 WebGL 渲染；内层是实心灰矩形；不允许 `backdrop-filter`。本功能严格落地：

- TimelineRail 外层 `<aside>` **透明壳**，`rounded-[28px] p-3`，通过 `forwardRef` 注册到 `App.tsx::SimpleGenerateView` 的 `glassShapes` 数组，由全屏 `<LiquidGlass>` 在它的 boundingRect 上渲染真折射 / 色散 / 菲涅尔反射
- 内层 list 容器实心 `#1e1e22` + `rounded-[20px]`（= 父级 28 - padding 8，几何同心圆）+ 1px hairline border
- Tooltip / popover 实心 `#171717`（DESIGN.md popover token），无 `backdrop-filter`

