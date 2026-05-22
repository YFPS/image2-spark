# 修改流改进 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户能从聊天 AI 图一键继续修改、输入框支持粘贴/拖拽图片/手动拖大；刷新后修改模式自动认出"当前对话最后一张 AI 出图"为目标。

**Architecture:** 纯前端改动。新建 1 个工具文件 + 1 个组件文件；App.tsx 内 4 处定向修改（`lastResultSrc` 改 useMemo 派生 / `<input>` 升级 textarea / 输入条加 onPaste+onDrop / ChatBubble 加修改起点按钮）。

**Tech Stack:** React 18 + TypeScript + Tailwind / Vite / chrome-devtools MCP E2E

**Spec：** `docs/specs/2026-05-23-edit-flow-improvements-design.md`

---

## 文件清单

| 文件 | 改动 |
|---|---|
| `client/src/utils/imageInput.ts` | 创建：`REF_MAX` 常量 + `extractImageFilesFromEvent()` + `fileToDataURL()` |
| `client/src/components/RefImagesStrip.tsx` | 创建：输入框上方的横向参考图缩略图条 |
| `client/src/App.tsx` | 修改 4 处：派生 lastResultSrc / input→textarea / onPaste+onDrop / ChatBubble 修改起点按钮 |

---

## Task 1: imageInput 工具（独立纯函数）

**Files:**
- Create: `D:\webProject\image2\client\src\utils\imageInput.ts`

- [ ] **Step 1：创建 `client/src/utils/imageInput.ts`**

```ts
/**
 * 输入框图片粘贴/拖拽的共享工具。
 *
 * - REF_MAX：参考图上限，与左侧参考图卡保持一致
 * - extractImageFilesFromEvent：从 ClipboardEvent / DragEvent 里筛出 image/* File
 * - fileToDataURL：File → base64 dataURL（异步）
 */

export const REF_MAX = 5;

export function extractImageFilesFromEvent(
  e: React.ClipboardEvent | React.DragEvent,
): File[] {
  // ClipboardEvent.clipboardData.items / DragEvent.dataTransfer.items
  const items =
    "clipboardData" in e
      ? e.clipboardData?.items
      : e.dataTransfer?.items;
  const files: File[] = [];
  if (!items) return files;
  for (const item of Array.from(items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  return files;
}

export function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}
```

需要在文件顶部加 React 类型 import（用于 ClipboardEvent / DragEvent 的 React 版本）：

```ts
import type * as React from "react";
```

把这行加在 `export const REF_MAX` 之前（即文件第一行）。

最终文件第 1 行是 `import type * as React from "react";`，之后空一行接 docstring。

- [ ] **Step 2：tsc 验证**

```powershell
cd D:/webProject/image2/client
npm run build
```

Expected: 构建通过。

- [ ] **Step 3：提交**

```bash
git -C D:/webProject/image2 add client/src/utils/imageInput.ts
git -C D:/webProject/image2 commit -m "feat(client): 添加 imageInput 工具（粘贴/拖拽提取 image File + dataURL 转换）"
```

---

## Task 2: RefImagesStrip 组件

**Files:**
- Create: `D:\webProject\image2\client\src\components\RefImagesStrip.tsx`

- [ ] **Step 1：创建 `client/src/components/RefImagesStrip.tsx`**

```tsx
import { useRef } from "react";

type Item = { id: string; dataURL: string };

type Props = {
  items: Item[];
  onRemove: (id: string) => void;
  onAddFiles: (files: File[]) => void;
};

/**
 * 聊天输入框上方的参考图横向缩略图条。
 *  - 仅当 items.length > 0 时显示（外部条件渲染）
 *  - 每张右上角 × 删除
 *  - 最右一个 + 触发文件 picker，传给 onAddFiles
 *  - 与左侧参考图卡共享同一份 state，删一处另一处即同步
 */
export function RefImagesStrip({ items, onRemove, onAddFiles }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      {items.map((it) => (
        <div
          key={it.id}
          className="group relative h-10 w-10 shrink-0 overflow-hidden rounded-[10px] border border-white/[0.06] bg-[#111114]"
        >
          <img
            src={it.dataURL}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
          <button
            type="button"
            onClick={() => onRemove(it.id)}
            className="absolute right-0 top-0 grid h-4 w-4 -translate-y-1/2 translate-x-1/2 place-items-center rounded-full bg-black/82 text-[10px] text-white/82 opacity-0 transition-opacity group-hover:opacity-100"
            title="移除"
            aria-label="移除参考图"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-dashed border-white/[0.10] text-[18px] text-white/45 hover:border-white/[0.20] hover:text-white/72"
        title="添加参考图"
        aria-label="添加参考图"
      >
        +
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onAddFiles(files);
          // 重置 value 让相同文件能再次触发 onChange
          e.target.value = "";
        }}
      />
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
git -C D:/webProject/image2 add client/src/components/RefImagesStrip.tsx
git -C D:/webProject/image2 commit -m "feat(client): 添加 RefImagesStrip 组件（输入框上方参考图缩略图条）"
```

---

## Task 3: App.tsx `lastResultSrc` 改 useMemo 派生

把 in-memory `useState` + `useEffect` 内的 `setLastResultSrc` 写法改成 `useMemo` 派生。刷新后从 `conversations.current.messages` 自动算出 → "修改"模式自动认出最后一张 AI 出图。

**Files:**
- Modify: `D:\webProject\image2\client\src\App.tsx`

- [ ] **Step 1：删除 `useState` 那行（约第 641 行）**

找到：

```tsx
  // Edit 模式下需要记住最后一张生成的图片 src
  const [lastResultSrc, setLastResultSrc] = useState<string | null>(null);
```

整段（含注释）替换为：

```tsx
  // Edit 模式的"目标图片"：从当前对话最后一张 done AI 消息派生（刷新后自动认出）
  // 注意：与 setResults/setUsage 那组 in-memory 预览状态分开，因为预览受 format 影响
  const lastResultSrc = useMemo<string | null>(() => {
    const { images } = extractConversationResults(conversations.current);
    return images[0] ? imageToSrc(images[0], format) : null;
  }, [conversations.current, format]);
```

- [ ] **Step 2：删除 useEffect 里 `setLastResultSrc(firstSrc)` 那一行（约第 862 行）**

找到 useEffect：

```tsx
  // 从当前会话的最新一轮 user prompt 后面的 done AI 消息恢复预览区。
  // 这让刷新后已完成的任务也能填充预览，而不是只依赖 pending → done 的瞬时变化。
  useEffect(() => {
    const { images, usage } = extractConversationResults(conversations.current);
    setResults(images);
    setUsage(usage);
    const firstSrc = images[0] ? imageToSrc(images[0], format) : null;
    if (firstSrc) setLastResultSrc(firstSrc);
  }, [conversations.current, format]);
```

把最后两行（`const firstSrc =` 和 `if (firstSrc) setLastResultSrc(firstSrc)`）整体删掉。改后：

```tsx
  // 从当前会话的最新一轮 user prompt 后面的 done AI 消息恢复预览区。
  // 这让刷新后已完成的任务也能填充预览，而不是只依赖 pending → done 的瞬时变化。
  useEffect(() => {
    const { images, usage } = extractConversationResults(conversations.current);
    setResults(images);
    setUsage(usage);
  }, [conversations.current, format]);
```

`lastResultSrc` 现在由 useMemo 派生，不需要 effect 写入。

- [ ] **Step 3：确认没有其他 `setLastResultSrc` 引用**

```powershell
Select-String -Path D:/webProject/image2/client/src/App.tsx -Pattern "setLastResultSrc"
```

Expected: **0 命中**。如果还有别处 setLastResultSrc 调用，按上同样模式删除。

- [ ] **Step 4：tsc 验证**

```powershell
cd D:/webProject/image2/client
npm run build
```

Expected: 构建通过。

如果报 `useMemo is not defined`：检查 App.tsx 顶部 import 是否含 `useMemo`，没有就加上：

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
```

- [ ] **Step 5：提交**

```bash
git -C D:/webProject/image2 add client/src/App.tsx
git -C D:/webProject/image2 commit -m "refactor(client): lastResultSrc 改 useMemo 从对话派生 刷新后自动恢复修改目标"
```

---

## Task 4: input → textarea 升级（含 resize-y + Enter/Shift+Enter）

**Files:**
- Modify: `D:\webProject\image2\client\src\App.tsx`

- [ ] **Step 1：替换聊天输入条的 `<input>` 为 `<textarea>`**

找到 `App.tsx` 第 ~1563 行附近：

```tsx
            {/* 输入条 */}
            <div className="flex shrink-0 items-center gap-2 rounded-[18px] border border-white/[0.04] bg-[#141418] px-3 py-2">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleGenerate();
                  }
                }}
                placeholder={
                  isGenerating
                    ? "生成中…"
                    : mode === "edit"
                      ? "描述你想如何修改图片，回车修改"
                      : mode === "reasoning"
                        ? "描述你想生成的画面（思考模式），回车出图"
                        : "描述你想生成的画面，回车出图"
                }
                disabled={isGenerating}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-white/90 placeholder:text-white/32 focus:outline-none disabled:opacity-50"
              />
```

替换为：

```tsx
            {/* 输入条 */}
            <div className="flex shrink-0 items-start gap-2 rounded-[18px] border border-white/[0.04] bg-[#141418] px-3 py-2">
              <textarea
                ref={chatInputRef}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  // Enter 提交、Shift+Enter 换行（与 ChatGPT 一致）
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleGenerate();
                  }
                }}
                rows={1}
                placeholder={
                  isGenerating
                    ? "生成中…"
                    : mode === "edit"
                      ? "描述你想如何修改图片，回车修改（Shift+Enter 换行）"
                      : mode === "reasoning"
                        ? "描述你想生成的画面（思考模式），回车出图"
                        : "描述你想生成的画面，回车出图"
                }
                disabled={isGenerating}
                className="min-h-[36px] max-h-[240px] min-w-0 flex-1 resize-y overflow-y-auto bg-transparent py-1 text-[13px] leading-relaxed text-white/90 placeholder:text-white/32 focus:outline-none disabled:opacity-50"
              />
```

改动要点（与原 `<input>` 对比）：
- 标签 `input` → `textarea`
- 根 div 的 `items-center` → `items-start`（textarea 长高时不会垂直居中错位）
- 新增 `ref={chatInputRef}`、`rows={1}`
- className 多了：`min-h-[36px] max-h-[240px] resize-y overflow-y-auto py-1 leading-relaxed`
- 编辑模式 placeholder 末尾加了 `（Shift+Enter 换行）` 提示

- [ ] **Step 2：在 App 函数体（约第 535-540 行 `chatScrollRef` 那一带）加 `chatInputRef`**

找到（约第 537-540 行）：

```tsx
  const chatPanelRef = useRef<HTMLDivElement | null>(null);
  ...
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
```

紧跟其后追加一行：

```tsx
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
```

- [ ] **Step 3：tsc 验证**

```powershell
cd D:/webProject/image2/client
npm run build
```

Expected: 构建通过。

- [ ] **Step 4：提交**

```bash
git -C D:/webProject/image2 add client/src/App.tsx
git -C D:/webProject/image2 commit -m "feat(client): 聊天输入框 input 升级为 textarea 支持 Shift+Enter 换行 + 拖右下角放大"
```

---

## Task 5: 输入条 onPaste + onDrop + 上方插入 RefImagesStrip

**Files:**
- Modify: `D:\webProject\image2\client\src\App.tsx`

- [ ] **Step 1：顶部追加 import**

App.tsx 顶部 import 区找一个合适位置（紧跟其他 `./components/` import 之后）追加：

```tsx
import { RefImagesStrip } from "./components/RefImagesStrip";
import { REF_MAX, extractImageFilesFromEvent, fileToDataURL } from "./utils/imageInput";
```

注意：项目已经有 `REF_MAX = 5` 的常量？如果 App.tsx 已经定义了 `REF_MAX`（grep 一下）：
- 若已存在 → 删除 App.tsx 内的 `REF_MAX = 5` 定义，统一从 utils 导入
- 若不存在 → 直接 import 就行

```powershell
Select-String -Path D:/webProject/image2/client/src/App.tsx -Pattern "REF_MAX\s*=\s*5|const REF_MAX"
```

如果有命中，删除 App.tsx 内的那一行常量定义。

- [ ] **Step 2：在 App 函数体加 `chatDragOver` state + 文件处理 helpers**

找到 `chatInputRef` 那行（Task 4 已加）的下一行追加：

```tsx
  const [chatDragOver, setChatDragOver] = useState(false);

  // 把粘贴/拖拽进来的 image File 追加到 refImages（不替换）
  const appendRefImagesFromFiles = async (files: File[]) => {
    const remaining = REF_MAX - refImages.length;
    if (remaining <= 0) {
      setErrorMsg(`参考图最多 ${REF_MAX} 张`);
      return;
    }
    const accepted = files.slice(0, remaining);
    try {
      const dataURLs = await Promise.all(accepted.map(fileToDataURL));
      setRefImages((prev) => [
        ...prev,
        ...dataURLs.map((d) => ({ id: rid(), dataURL: d })),
      ]);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "读取图片失败");
    }
  };
```

注意 `rid()` 是 App.tsx 已经有的 id 生成器（grep `function rid|const rid` 确认；如果项目里没有用 nanoid 之类，应该有自己实现的 `rid()`）。如果不存在，用 `crypto.randomUUID()` 或者本地一个简单实现替代。

如果项目里完全找不到 id 生成方式，定义一个最简版本（**仅当 grep 找不到时**才加；通常 RefItem 在 Task 1 之前就有 id，必然已有 generator）：

```tsx
const rid = () => Math.random().toString(36).slice(2, 10);
```

- [ ] **Step 3：在输入条根 div 加 drop handlers + RefImagesStrip 上方插入**

Task 4 已经改过的输入条根 div，再做两处增强：

**A. 根 div 加 drag handlers：**

把：

```tsx
            {/* 输入条 */}
            <div className="flex shrink-0 items-start gap-2 rounded-[18px] border border-white/[0.04] bg-[#141418] px-3 py-2">
```

改为：

```tsx
            {/* 输入条 */}
            <div
              className={`relative flex shrink-0 items-start gap-2 rounded-[18px] border bg-[#141418] px-3 py-2 transition-colors ${
                chatDragOver
                  ? "border-accent-foxo/50 ring-2 ring-accent-foxo/30"
                  : "border-white/[0.04]"
              }`}
              onDragEnter={(e) => {
                if (Array.from(e.dataTransfer.types || []).includes("Files")) {
                  e.preventDefault();
                  setChatDragOver(true);
                }
              }}
              onDragOver={(e) => {
                if (Array.from(e.dataTransfer.types || []).includes("Files")) {
                  e.preventDefault();
                }
              }}
              onDragLeave={(e) => {
                // 只在离开真正的容器边界时取消（避免子元素冒泡误触发）
                if (e.currentTarget === e.target) setChatDragOver(false);
              }}
              onDrop={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                setChatDragOver(false);
                const files = extractImageFilesFromEvent(e);
                if (files.length > 0) await appendRefImagesFromFiles(files);
              }}
            >
              {chatDragOver && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-[18px] bg-[#141418]/85 text-[12px] font-medium text-accent-foxo">
                  松开以添加参考图
                </div>
              )}
```

**B. textarea 加 `onPaste`：**

Task 4 已加好的 textarea，在 `onKeyDown` 之后追加 `onPaste` handler。找到：

```tsx
              <textarea
                ref={chatInputRef}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleGenerate();
                  }
                }}
```

改为：

```tsx
              <textarea
                ref={chatInputRef}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleGenerate();
                  }
                }}
                onPaste={async (e) => {
                  const files = extractImageFilesFromEvent(e);
                  if (files.length > 0) {
                    e.preventDefault();
                    await appendRefImagesFromFiles(files);
                  }
                  // 没有图片就 fallback 浏览器默认（粘贴文本）
                }}
```

- [ ] **Step 4：在输入条上方插入 RefImagesStrip**

找到 Task 4 已加的"输入条"那个 div。在它**外层**（同一父 div 内、输入条之前）加上 RefImagesStrip。

具体：找到 `{/* 输入条 */}` 注释那一行，把它（含整个输入条 div + 末尾的 `</div>`）外面包一层 `<>` Fragment，并在 `{/* 输入条 */}` 注释之前插入 RefImagesStrip 块。

最小且明确的改法：找到下面的代码块（Task 4 改好之后的）：

```tsx
            {/* 输入条 */}
            <div
              className={`relative flex shrink-0 items-start gap-2 rounded-[18px] ...
```

在 `{/* 输入条 */}` 这一行**之前**插入：

```tsx
            {refImages.length > 0 && (
              <RefImagesStrip
                items={refImages}
                onRemove={(id) =>
                  setRefImages((prev) => prev.filter((it) => it.id !== id))
                }
                onAddFiles={(files) => appendRefImagesFromFiles(files)}
              />
            )}
```

- [ ] **Step 5：tsc 验证**

```powershell
cd D:/webProject/image2/client
npm run build
```

Expected: 构建通过。

- [ ] **Step 6：提交**

```bash
git -C D:/webProject/image2 add client/src/App.tsx
git -C D:/webProject/image2 commit -m "feat(client): 输入条支持图片粘贴/拖拽 上方加 RefImagesStrip 缩略图条"
```

---

## Task 6: ChatBubble 加「作为修改起点」按钮

**Files:**
- Modify: `D:\webProject\image2\client\src\App.tsx`

- [ ] **Step 1：扩 ChatBubble Props + 在 imageUrls.map 内加按钮**

找到 ChatBubble（约第 1772 行起），扩展 Props 接口：

把：

```tsx
}: {
  role: "ai" | "user";
  pending?: boolean;
  status?: "done" | "pending" | "failed";
  /** done 后的产出图：直接在 bubble 内渲染缩略图（点击放大走 onImageClick） */
  imageUrls?: string[] | null;
  /** 生图任务的请求 size，如 "1024x1024"；用于 done 时缩略图比例 */
  size?: string;
  onImageClick?: (src: string) => void;
  children: ReactNode;
}) {
```

改为（加 `onEditFromImage`）：

```tsx
}: {
  role: "ai" | "user";
  pending?: boolean;
  status?: "done" | "pending" | "failed";
  /** done 后的产出图：直接在 bubble 内渲染缩略图（点击放大走 onImageClick） */
  imageUrls?: string[] | null;
  /** 生图任务的请求 size，如 "1024x1024"；用于 done 时缩略图比例 */
  size?: string;
  onImageClick?: (src: string) => void;
  /** AI 图右上角"作为修改起点"按钮回调；提供时才渲染按钮 */
  onEditFromImage?: (src: string) => void;
  children: ReactNode;
}) {
```

也要修改外侧函数签名形参解构（约第 1772-1780 行），加上 `onEditFromImage`：

把：

```tsx
function ChatBubble({
  role,
  pending,
  status,
  imageUrls,
  size,
  onImageClick,
  children,
}: {
```

改为：

```tsx
function ChatBubble({
  role,
  pending,
  status,
  imageUrls,
  size,
  onImageClick,
  onEditFromImage,
  children,
}: {
```

- [ ] **Step 2：在 imageUrls.map 内的 `<button>` 后面加 hover overlay 按钮**

找到（约第 1821-1837 行）：

```tsx
              {imageUrls!.map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => onImageClick?.(safeImageSrc(u))}
                  className="block overflow-hidden rounded-[10px] ring-1 ring-inset ring-white/[0.06] transition-transform hover:scale-[1.02]"
                  style={{ aspectRatio: aspect }}
                >
                  <img
                    src={safeImageSrc(u)}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                </button>
              ))}
```

替换为（包裹一层 relative 容器，里面除了原 button 还多一个 ✏️ overlay）：

```tsx
              {imageUrls!.map((u) => (
                <div key={u} className="group relative">
                  <button
                    type="button"
                    onClick={() => onImageClick?.(safeImageSrc(u))}
                    className="block overflow-hidden rounded-[10px] ring-1 ring-inset ring-white/[0.06] transition-transform hover:scale-[1.02]"
                    style={{ aspectRatio: aspect }}
                  >
                    <img
                      src={safeImageSrc(u)}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  </button>
                  {onEditFromImage && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditFromImage(safeImageSrc(u));
                      }}
                      title="作为修改起点"
                      aria-label="作为修改起点"
                      className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white/82 opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/72 hover:text-white group-hover:opacity-100"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path
                          d="M11.5 2.5 13.5 4.5 4.5 13.5 2 14 2.5 11.5z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
```

- [ ] **Step 3：在 App 函数体加 `handleSetAsEditTarget` + 传给 ChatBubble**

找到 App.tsx 第 ~866 行的 `handleModeChange`：

```tsx
  // 模式切换时清理
  const handleModeChange = (newMode: "generate" | "edit" | "reasoning") => {
    setMode(newMode);
  };
```

紧跟其后追加：

```tsx
  // 从聊天里的 AI 图一键切到修改模式：替换 refImages 为单张、清旧 mask、聚焦输入框
  const handleSetAsEditTarget = (src: string) => {
    setRefImages([{ id: rid(), dataURL: src }]);
    setRefMaskBlob(null);
    handleModeChange("edit");
    // 微延迟让 mode 切换的重渲染完成再 focus
    setTimeout(() => chatInputRef.current?.focus(), 0);
  };
```

- [ ] **Step 4：把 `onEditFromImage` 传给 ChatBubble**

找到 ChatBubble 的调用点（约第 1503 行）：

```tsx
                  <ChatBubble
                    role={m.role}
                    pending={m.pending}
                    status={m.status}
                    imageUrls={m.image_urls}
                    size={m.size}
                    onImageClick={(src) => setPreviewSrc(src)}
                  >
                    {m.text}
                  </ChatBubble>
```

加一行 `onEditFromImage`：

```tsx
                  <ChatBubble
                    role={m.role}
                    pending={m.pending}
                    status={m.status}
                    imageUrls={m.image_urls}
                    size={m.size}
                    onImageClick={(src) => setPreviewSrc(src)}
                    onEditFromImage={(src) => handleSetAsEditTarget(src)}
                  >
                    {m.text}
                  </ChatBubble>
```

- [ ] **Step 5：tsc 验证**

```powershell
cd D:/webProject/image2/client
npm run build
```

Expected: 构建通过。

- [ ] **Step 6：提交**

```bash
git -C D:/webProject/image2 add client/src/App.tsx
git -C D:/webProject/image2 commit -m "feat(client): ChatBubble AI 图加 作为修改起点 按钮 + handleSetAsEditTarget"
```

---

## Task 7: E2E 验证（chrome-devtools MCP）

按项目规约「改完先 E2E 再交付」。如 8000 端口被孤儿 socket 占（Windows 偶发），临时改 vite.config.ts proxy 到 8002 + 起 uvicorn 8002，测完改回（参考前两次 E2E 截图归档 README）。

**Files:** 无新代码改动；E2E 截图 + commit 到 `docs/superpowers/e2e-screenshots/2026-05-23-edit-flow/`

前置：

```powershell
# 起后端
cd D:/webProject/image2/server
.venv/Scripts/activate
uvicorn app.main:app --port 8000   # 或临时 8002
```

新终端：

```powershell
cd D:/webProject/image2/client
npm run dev
```

用账号 `2859098803@qq.com` 登录（注入 token + reload，参考前两次 E2E 套路）。

- [ ] **Step 1：点 chat 里 AI 图右上 ✏️ → 自动切修改模式 + refImages 替换为这张图**

1. 进任意有 AI 图的对话
2. 鼠标 hover AI 图缩略图 → 右上角应浮现笔图标
3. 点笔图标
4. 断言：
   - mode 变成 "edit"
   - 输入框上方 RefImagesStrip 出现这张图
   - textarea focused（cursor 闪在 textarea 里）
5. 截图存 `docs/superpowers/e2e-screenshots/2026-05-23-edit-flow/01-set-as-edit-target.png`

evaluate_script 辅助验证：
```js
async () => {
  const aiImgBtn = document.querySelector('button[title="作为修改起点"]');
  if (!aiImgBtn) return { err: 'no edit button' };
  aiImgBtn.click();
  await new Promise(r => setTimeout(r, 200));
  const strip = document.querySelector('.flex.flex-wrap.items-center.gap-2');
  const stripImgs = strip ? strip.querySelectorAll('img').length : 0;
  const focused = document.activeElement?.tagName;
  return { stripImgs, focused };
}
```
期望：`stripImgs >= 1, focused: "TEXTAREA"`

- [ ] **Step 2：粘贴图片 → 追加到 refImages**

用 evaluate_script 模拟 paste（DataTransfer + ClipboardEvent dispatch）：

```js
async () => {
  // 拿一张 chat 里的 AI 图 src 当 paste 源
  const img = document.querySelector('button[title="作为修改起点"] + button img, .group.relative img');
  if (!img) return { err: 'no source img' };
  // 转 File（dataURL → Blob → File）
  const resp = await fetch(img.src);
  const blob = await resp.blob();
  const file = new File([blob], 'pasted.png', { type: blob.type || 'image/png' });

  // 在 textarea 上派发 paste
  const ta = document.querySelector('textarea');
  const dt = new DataTransfer();
  dt.items.add(file);
  const evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  ta.dispatchEvent(evt);
  await new Promise(r => setTimeout(r, 400));
  const strip = document.querySelector('.flex.flex-wrap.items-center.gap-2');
  return { stripImgs: strip ? strip.querySelectorAll('img').length : 0 };
}
```

期望：`stripImgs` 相比 Step 1 多 1 张。截图存 `02-paste-image.png`。

- [ ] **Step 3：拖拽图片到输入条 → 追加**

evaluate_script：

```js
async () => {
  const img = document.querySelector('.group.relative img');
  const resp = await fetch(img.src);
  const blob = await resp.blob();
  const file = new File([blob], 'dropped.png', { type: blob.type || 'image/png' });

  const inputRow = document.querySelector('textarea').closest('.relative.flex');
  const dt = new DataTransfer();
  dt.items.add(file);

  const dragOver = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
  inputRow.dispatchEvent(dragOver);
  await new Promise(r => setTimeout(r, 100));

  const dropEvt = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
  inputRow.dispatchEvent(dropEvt);
  await new Promise(r => setTimeout(r, 400));

  const strip = document.querySelector('.flex.flex-wrap.items-center.gap-2');
  return { stripImgs: strip ? strip.querySelectorAll('img').length : 0 };
}
```

期望：`stripImgs` 再 +1。截图存 `03-drop-image.png`。

- [ ] **Step 4：拖文本输入框右下角 → 拖大**

mcp__chrome-devtools__drag 模拟拖右下角：

```js
async () => {
  const ta = document.querySelector('textarea');
  const r = ta.getBoundingClientRect();
  return { initialH: r.height, x: r.right - 8, y: r.bottom - 8 };
}
```

拿到坐标后用 `mcp__chrome-devtools__drag` 从 (x, y) 拖到 (x, y + 100)。然后查 textarea 高度。期望比 initialH 大 ~100px（受 max-h-[240px] 限制）。截图存 `04-textarea-resize.png`。

> 如果 chrome-devtools MCP 的 drag 工具不支持非元素坐标拖拽，可手动用 mouse events dispatch：先 `mousedown` 在右下角、`mousemove` 增 100px、`mouseup`。或者直接静态检查 textarea computed style 含 `resize: vertical`。

- [ ] **Step 5：Shift+Enter 换行 vs Enter 提交**

```js
async () => {
  const ta = document.querySelector('textarea');
  ta.focus();
  // 输入文本
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, 'line1');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  // Shift+Enter
  ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  return { valueAfterShiftEnter: ta.value };
}
```

期望：`valueAfterShiftEnter` 仍是 "line1"（不会被 preventDefault；浏览器原生处理 Shift+Enter 在 textarea 插换行——这里通过 dispatch 模拟可能拿不到换行，但至少 `value` 不会被清空（提交后 value 会被清空到 ""）。

实际更严格的验证：手动在浏览器 textarea 里按 Shift+Enter，看是否出现换行。

- [ ] **Step 6：刷新后切修改模式 → 可生成**

1. 在一个已经有 AI 图的对话里，按 F5 / Ctrl+R 刷新
2. 等对话加载完成
3. 点底部「修改」按钮
4. 在 textarea 输入文字
5. 「修改」按钮应该 **enabled**（说明 lastResultSrc 派生成功）
6. 截图存 `05-refresh-edit-mode.png`

evaluate_script 辅助：

```js
() => {
  const editBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === '修改');
  const sendBtn = document.querySelector('button[title="出图"], button[title*="修改"]');
  return { editBtnExists: !!editBtn, sendDisabled: sendBtn?.disabled };
}
```

- [ ] **Step 7：写 README + commit 截图**

```powershell
mkdir D:/webProject/image2/docs/superpowers/e2e-screenshots/2026-05-23-edit-flow -ErrorAction SilentlyContinue
```

创建 `docs/superpowers/e2e-screenshots/2026-05-23-edit-flow/README.md`：

```md
# 修改流改进 E2E 验证

- 日期：2026-05-23
- spec：docs/specs/2026-05-23-edit-flow-improvements-design.md
- plan：docs/plans/2026-05-23-edit-flow-improvements.md
- 账号：2859098803@qq.com

## 验证项

| # | 项 | 截图 | 结论 |
|---|---|---|---|
| 1 | 点 chat ✏️ → refImages 替换 + mode=edit + focus | 01-set-as-edit-target.png | ✅ |
| 2 | textarea onPaste 追加 refImages | 02-paste-image.png | ✅ |
| 3 | 输入条 onDrop 追加 refImages | 03-drop-image.png | ✅ |
| 4 | 拖 textarea 右下角放大 | 04-textarea-resize.png | ✅ |
| 5 | Shift+Enter 换行 / Enter 提交 | （inline） | ✅ |
| 6 | 刷新后 lastResultSrc 派生成功 → 修改模式可生成 | 05-refresh-edit-mode.png | ✅ |
```

提交：

```bash
git -C D:/webProject/image2 add docs/superpowers/e2e-screenshots/2026-05-23-edit-flow/
git -C D:/webProject/image2 commit -m "test(e2e): 修改流改进 chrome-devtools MCP 验证截图"
```

---

## Self-Review 留痕

写完后已自审：
- 7 个 task 对应 spec § 3 全部 4 改 + § 3.5 抽工具 + § 3.6 抽组件 + § 六.2 E2E
- 无 TBD / 占位；每步都有完整可粘贴的代码或命令
- 类型/函数名一致：`extractImageFilesFromEvent` / `fileToDataURL` / `REF_MAX` / `RefImagesStrip` / `appendRefImagesFromFiles` / `handleSetAsEditTarget` / `chatInputRef` / `chatDragOver` / `onEditFromImage` 在全部 task 内拼写统一
- Task 顺序无 forward reference：Task 1 → utils；Task 2 → component（独立）；Task 3 → 派生 lastResultSrc（独立 refactor）；Task 4 → textarea（Task 5 / 6 前提）；Task 5 → onPaste/onDrop 用 Task 1 工具 + Task 2 组件；Task 6 → ChatBubble 改 + handleSetAsEditTarget 用 Task 4 的 chatInputRef + setRefImages
- 关键 spec § 七 风险已对应在实施（stopPropagation 在 onDrop / preventDefault 在 onPaste 仅图片才阻止 / 切对话短暂 null 可接受）

## 完成定义（Definition of Done）

- `npm run build` 构建通过
- chrome-devtools MCP E2E 6 个验证点截图 + README 归档
- 实测：聊天 AI 图点 ✏️ 后能直接在 textarea 输 prompt 出修改后的图
- 实测：复制别处一张图 paste 到输入框 → 缩略图出现
- 实测：拖文件到输入条 → 缩略图出现
- 实测：拖 textarea 右下角能放大
- 实测：刷新后切修改模式仍能生图（lastResultSrc 派生）
