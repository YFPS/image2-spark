# 修改流改进：聊天图复用 + 输入框粘贴拖拽 + 刷新自动派生

- **日期**：2026-05-23
- **范围**：
  - 前端 `client/src/App.tsx`：三处改动 + 抽出一个小子组件
  - 不改后端、不改 schema、不改路由
- **不在范围**：
  - 持久化 `refImages` 到 localStorage / 服务端（数据量大，YAGNI）
  - 跨会话沿用参考图（语义不清；切会话即换上下文）
  - 输入框文本与图片混合粘贴的高级处理（HTML 富文本剪贴板）
  - 多模型/多 prompt 模板的"修改起点"区分

---

## 一、背景

`client/src/App.tsx` 当前的修改（edit）流有三个体验断点：

1. **聊天里的 AI 出图无法被复用为"修改起点"**：用户看到一张图想继续改，只能去左侧"参考图"卡重新上传——而那张图就在 chat bubble 里。
2. **聊天输入框只接文字 + 单行 + 不可放大**：当前是 `<input>` 单行（`App.tsx:1563`）——没有 `onPaste`、没有 `onDrop`、没法多行（长 prompt 看不全）、没法拖右下角放大。用户从别的网页 Ctrl+C 一张图想 Ctrl+V 当参考图——做不到；想写大段 prompt——一行内滚屏不直观。
3. **`lastResultSrc` 是 in-memory state 刷新即丢**（`App.tsx:641`）：
   - 生图成功时 `setLastResultSrc(url)` 写入
   - 切「修改」模式时若无 `refImages`，降级用 `lastResultSrc`（`App.tsx:773`）
   - 刷新后 `lastResultSrc=null`，即使当前对话里明明躺着一张刚生的图，「修改」模式仍报"没有可修改的图片"

这三点合起来让用户感觉「想继续改一张图很麻烦」。

### 用户工作流（实际诉求）

- 在 chat 里看到刚生成的图 → 一键设为"修改起点" → 输入 prompt → 在原图基础上继续改（典型 GPT 图像对话流）
- 从别处复制图片 / 拖文件到输入框 → 自动当参考图，无需绕到左侧上传
- 关浏览器、几小时后回来 → 当前对话最后一张图自动可被"修改"模式锁定为目标

---

## 二、相关现状代码点

| 位置 | 当前实现 |
|---|---|
| `App.tsx:641` | `const [lastResultSrc, setLastResultSrc] = useState(null)` —— in-memory，刷新即丢 |
| `App.tsx:644` | `const [refImages, setRefImages] = useState<RefItem[]>([])` —— in-memory |
| `App.tsx:725` | `canGenerate &= (mode !== "edit" || lastResultSrc != null)` —— edit 模式要求 lastResultSrc |
| `App.tsx:773` | `const sources = refImages.length > 0 ? refImages.map(r => r.dataURL) : lastResultSrc ? [lastResultSrc] : []` —— edit 请求构造 |
| `App.tsx:1024-1156` | 左侧"参考图"卡（拖拽 + 点击上传）—— 唯一上传入口 |
| `App.tsx:1490-1505` | chatScrollRef 内 `ChatBubble` 渲染消息，多图用 `imageUrls.map` 出 `<img>` —— **没有任何 action 按钮覆盖在图上** |
| `App.tsx:1494-1505` `<ChatBubble>` Props | `imageUrls?, size?, onImageClick?`（只支持点击预览）|
| 输入框 | 在 chatPanel 的输入条里（`App.tsx:~1560` 附近），是个 `<textarea>` 风格的输入 —— 无 onPaste/onDrop/图片按钮 |

---

## 三、设计

### 3.1 改 A：聊天 AI 图加「作为修改起点」按钮

**位置**：`ChatBubble` 组件渲染 image 那段（`App.tsx:~1804` 附近 `imageUrls.map`），每张图加 hover overlay。

**视觉**：每张 AI 出图右上角加 2 个 hover 按钮（与图同 `relative` 容器、`absolute right-2 top-2`）：
- ✏️ **作为修改起点**（新增）—— icon-only button，hover 显示中文 tooltip
- 🔍 现有的点击预览（已经在）

颜色 / 圆角参考最近作品卡的时间胶囊（`rounded-full bg-black/55 px-2 py-1`），但要标注是"action"性质——一个小笔图标 + 微亮 ring。

**`ChatBubble` Props 追加**：
```ts
onEditFromImage?: (src: string) => void;
```

**调用方传递**：在 App.tsx 的 ChatBubble 调用点写：
```tsx
onEditFromImage={(src) => handleSetAsEditTarget(src)}
```

**`handleSetAsEditTarget(src: string)` 行为**：
1. `setRefImages([{ id: rid(), dataURL: src }])` —— 替换为单张（用户意图明确，"换基底"）
2. `setRefMaskBlob(null)` —— 清掉旧 mask（mask 是相对前一张主图的）
3. `handleModeChange("edit")` —— 切修改模式（沿用现有 mode 切换 helper）
4. 聚焦输入框：`chatInputRef.current?.focus()`（需要给 textarea 加 ref）

### 3.2 改 B：input → textarea 升级 + 粘贴/拖拽 + 视觉态

**第一步 HTML 改造（必须先做，前提）**：把 `App.tsx:1563` 的 `<input>` 换为 `<textarea>`：

- 默认 1 行高（`rows={1}`、`min-h-[36px]`）
- 允许垂直拖拽放大（`resize-y`）
- 最大高度 240px（`max-h-[240px]` + `overflow-y-auto`），避免拉到把整个 chat 面板顶飞
- 移除 input 的 `disabled` 时的滚动 reset，textarea 用同样 disabled 样式
- `onKeyDown` 改为：
  - `Enter`（无修饰）→ 提交（与现状一致）
  - `Shift+Enter` → 在 textarea 内插入换行（textarea 默认行为，不 preventDefault）
  - 其他按键沿用默认

**HTML 改动**：
- 给输入条根 div 加 `onDragEnter` / `onDragOver` / `onDragLeave` / `onDrop`
- 给 textarea 加 `onPaste`
- 加 `chatInputRef` 给 textarea，便于 `handleSetAsEditTarget` 聚焦

**处理函数**（共享逻辑放进一个 helper）：

```ts
async function extractImageFilesFromEvent(
  e: React.ClipboardEvent | React.DragEvent
): Promise<File[]> {
  const items =
    "clipboardData" in e ? e.clipboardData?.items : e.dataTransfer?.items;
  const files: File[] = [];
  for (const item of Array.from(items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  return files;
}

async function appendRefImagesFromFiles(files: File[]) {
  const remaining = REF_MAX - refImages.length;
  const accepted = files.slice(0, Math.max(0, remaining));
  if (accepted.length === 0) {
    // 提示用户已满
    setErrorMsg(`参考图最多 ${REF_MAX} 张`);
    return;
  }
  const dataURLs = await Promise.all(accepted.map(fileToDataURL));
  setRefImages((prev) => [
    ...prev,
    ...dataURLs.map((d) => ({ id: rid(), dataURL: d })),
  ]);
}
```

**onPaste**：
```ts
const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
  const files = await extractImageFilesFromEvent(e);
  if (files.length > 0) {
    e.preventDefault();  // 阻止把图片二进制塞进 textarea 文本
    await appendRefImagesFromFiles(files);
  }
};
```

**onDrop（输入条上）**：
```ts
const handleDrop = async (e: React.DragEvent) => {
  e.preventDefault();
  setChatDragOver(false);
  const files = await extractImageFilesFromEvent(e);
  if (files.length > 0) await appendRefImagesFromFiles(files);
};
```

**视觉**：`chatDragOver` 为 true 时，输入条加 `ring-2 ring-accent-foxo/50` + 文案"松开以添加参考图"（用 absolute overlay 显示，盖在输入条上方），仿左侧参考图卡的 dropzone 视觉。

**已有左侧参考图卡 onDrop 保持不变**——同一份 state，双 dropzone 都可用。

### 3.3 改 C：`lastResultSrc` 从当前会话派生

**删除 in-memory state**：
```diff
- const [lastResultSrc, setLastResultSrc] = useState<string | null>(null);
+ const lastResultSrc = useMemo<string | null>(() => {
+   const msgs = conversations.current?.messages ?? [];
+   for (let i = msgs.length - 1; i >= 0; i--) {
+     const m = msgs[i];
+     if (m.role === "ai" && m.status === "done" && (m.image_urls?.length ?? 0) > 0) {
+       return m.image_urls![0];
+     }
+   }
+   return null;
+ }, [conversations.current?.messages]);
```

**搜删所有 `setLastResultSrc(...)` 调用**——它们不再需要：
- 生图成功后的 finalize、conversationResults 回填等位置（grep 找出全部）

**`canGenerate` 与 edit 模式 sources 构造保持不变**——`lastResultSrc` 仍然是同一个 string 值，只是来源换了。

**派生路径的副作用**：
- 切对话 → `conversations.current.messages` 变 → 自动重新派生（正确）
- 删除/重命名当前会话末尾消息 → 派生跟着变（与 UI 一致）
- 当前对话还没生成过图（空对话） → `lastResultSrc=null` → "修改"模式仍 disable（与现状一致）

### 3.4 改 D：输入框上方"当前选中参考图"缩略图区

**位置**：聊天输入框正上方（输入条根 div 内、textarea 上方），仅当 `refImages.length > 0` 时显示。

**视觉**：横排小缩略图（40×40 圆角 `[10px]`），每张右上角 × 删除；最右一个 `+` 调起 file picker（与左侧参考图卡 onChange 共用）。

**目的**：用户在聊天里看到「当前修改起点是这张图」——比左侧卡的间接关联更直观。两处共享同一份 `refImages` state，删一处另一处也更新。

### 3.5 textarea 自适应高度（可选 nice-to-have）

**默认行为**：用户拖右下角手动 resize（CSS `resize-y` 已经支持，无需 JS）。

**进阶（不在本期，YAGNI）**：根据内容自动撑高（auto-grow），可用 `useLayoutEffect` 监听 `chatInput` 变化、设 `el.style.height = "auto"; el.style.height = el.scrollHeight + "px"`。但与"用户手动拖"冲突——一旦用户拖了，自动 grow 会盖掉用户的尺寸。需要 sticky 状态判定。本期**不做**自动 grow，**只做手动 resize**。

### 3.6 抽出小组件（DRY + 可读性）

为避免 App.tsx 再膨胀 100+ 行，抽两个小辅助：

| 文件 | 内容 |
|---|---|
| `client/src/utils/imageInput.ts`（新）| `extractImageFilesFromEvent` / `fileToDataURL` / `REF_MAX` 常量集中 |
| `client/src/components/RefImagesStrip.tsx`（新）| 输入框上方的横排缩略图组件，props `{ items, onRemove, onAdd }` |

`ChatBubble` 的修改起点按钮不抽组件——只是几行 JSX，留在原地最易读。

---

## 四、数据流（修改后）

```
用户点 chat 里 AI 图的 ✏️
  → onEditFromImage(src)
  → setRefImages([{id, dataURL: src}])
  → setRefMaskBlob(null)
  → handleModeChange("edit")
  → chatInputRef.focus()
  → 输入框上方缩略图区显示这张图
  → 用户敲 prompt 回车
  → /api/images/edit (复用现有路径)

用户粘贴/拖图到输入框
  → onPaste / onDrop
  → extractImageFilesFromEvent
  → appendRefImagesFromFiles (push,不替换)
  → 缩略图区可见

刷新页面
  → 拉 currentConversation (含 messages)
  → useMemo 算出 lastResultSrc
  → 用户切 "修改" → canGenerate=true
  → 用户敲 prompt → sources=[lastResultSrc] (refImages 为空时降级)
```

---

## 五、错误 / 边界

| 场景 | 行为 |
|---|---|
| 粘贴/拖入超 REF_MAX | 截断为 `REF_MAX - 当前数`，剩下丢弃 + setErrorMsg "参考图最多 N 张" |
| 粘贴的不是图（HTML/text） | `extractImageFilesFromEvent` 返空数组 → 不调 preventDefault → 浏览器默认行为（贴文本到 textarea）|
| 拖文件夹/混合内容 | 只挑 image/* MIME → 忽略其他 |
| 数据 URI 超大（base64 几 MB） | 沿用现状（已知 follow-up：image_url 改 CDN），不在本期范围 |
| 切到没有 AI 出图的对话 + 切修改模式 | `lastResultSrc=null` & `refImages=[]` → `canGenerate=false` + 现有提示"暂无图片可修改"沿用 |
| `handleSetAsEditTarget` 用户已在 edit 模式且有 refImages | 替换（一致性：按钮语义是"换基底"，不是"加多一张"）|

---

## 六、测试

### 6.1 不写后端单测（无后端改动）

### 6.2 前端 E2E（chrome-devtools MCP）

| # | 步骤 | 断言 |
|---|---|---|
| 1 | 登录 → 在 chat 里点一张 AI 图的 ✏️ | refImages 变为这张图 + mode=edit + 输入框 focused + 输入框上方缩略图区出现这张 |
| 2 | 粘贴一张 PNG（用 evaluate_script 模拟 ClipboardEvent，因为 chrome-devtools MCP 无 OS 剪贴板 API；改成模拟 dataTransfer drop） | refImages.length +1 |
| 3 | 拖一个 PNG 文件到输入条 | 同上 |
| 4 | 拖入超过 REF_MAX 张 | 显示 errorMsg |
| 5 | 刷新页面后切修改模式 | "修改"按钮 enable（说明 lastResultSrc 派生成功）|
| 6 | 切到空对话 + 修改模式 | "修改"按钮 disable + 提示"暂无图片可修改" |
| 7 | 输入框上方缩略图区 × 删除 | refImages 这一项被移除，左侧参考图卡同步更新 |

### 6.3 不依赖 chrome-devtools 的本地手动验证

```bash
cd D:/webProject/image2/client && npm run dev
# 浏览器登录 → 操作步骤 1-7 手动复现
```

---

## 七、风险与权衡

1. **拖拽冲突**：聊天输入条与左侧参考图卡都接 onDrop。拖到聊天框落聊天框、拖到左侧卡落左侧卡—— DragEvent 默认会冒泡到最近的 onDrop，需要 `e.stopPropagation()` 防误触双 handler。已在 design 中体现。

2. **派生 lastResultSrc 的对话切换瞬间**：切对话时 `conversations.current` 短暂为 null（加载详情中），lastResultSrc=null，edit 模式按钮一闪 disable。可接受（< 200ms）。

3. **`onPaste` 阻止默认行为**：当且仅当**找到 image file**时调 `preventDefault`。粘贴文本不阻止——textarea 正常贴文本。

4. **`handleSetAsEditTarget` 替换语义可能违背用户意图**：用户可能想"再加一张作参考"而不是"换基底"。但聊天里"作为修改起点"语义就是替换；想加用 onPaste/拖拽路径。两条路径语义分明。

5. **图片来源的 cross-origin**：聊天里 AI 出图的 src 是 base64 data URI（已知 follow-up）或上游 CDN URL（未来）。两者 `setRefImages` 都接受（都是 string），不涉及 fetch；data URI 不会被 CORS 拦。CDN URL 未来才有，到时再讨论是否需要 proxy 转 dataURL。

---

## 八、变更清单（实施时按此对照）

**前端**
- [ ] 新增 `client/src/utils/imageInput.ts`（`extractImageFilesFromEvent` / `fileToDataURL` / `REF_MAX` 导出）
- [ ] 新增 `client/src/components/RefImagesStrip.tsx`（输入框上方缩略图横条）
- [ ] `client/src/App.tsx`：
  - **`<input>` → `<textarea>`**（`App.tsx:1563`）：`rows={1}` / `min-h-[36px]` / `max-h-[240px]` / `resize-y` / `overflow-y-auto`
  - onKeyDown：`Enter` 提交、`Shift+Enter` 换行
  - 删 `useState<string|null>(null)` 的 `lastResultSrc`，改 `useMemo` 派生
  - grep 删所有 `setLastResultSrc(...)` 调用
  - `refImages` / `refMaskBlob` 维持现状
  - 新增 `chatInputRef`（指向 textarea）、`chatDragOver` state
  - `handleSetAsEditTarget(src)` 新函数
  - 聊天输入条：根 div 加 onDragEnter/Over/Leave/Drop + 高亮态 + 上方插 `<RefImagesStrip>`
  - textarea 加 `onPaste` + `ref={chatInputRef}`
  - 拖拽视觉态文案、ring 高亮
  - import 新工具与组件
- [ ] `ChatBubble`（同 App.tsx 内）：
  - Props 加 `onEditFromImage?: (src: string) => void`
  - 在 imageUrls.map 每张图加 hover ✏️ 按钮（仅 AI 消息显示）
  - 现有 onImageClick（点图预览）保留
