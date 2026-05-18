# 模型广场液态玻璃重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `client/src/ModelPlaza.tsx` 及其 7 个子组件的视觉表现对齐 `DESIGN.md v0.2` —— 灰阶 UI / 颜色让给端口语义色 / 唯一电黄 CTA / Hero + 4 旗舰卡走 WebGL2 真液态玻璃 / 父子圆角 32 统一。

**Architecture:** 在已有的组件骨架上分步替换视觉表现：先做 5 个低风险小改（chip 色映射 + FilterBar/Paginator 激活态 + RecommendCard hover），再做两个结构性重写（Hero + FeaturedCard 的嵌套灰矩形 + 双层 layout），最后接入全局 `LiquidGlass` 组件让 Hero 和 4 张旗舰卡贡献 5 个 WebGL shape。每步独立可运行可验证，靠浏览器截图对照 `.tmp/plaza-mockup.png`。

**Tech Stack:** React 18 + Vite + TypeScript + Tailwind；复用项目已有 `client/src/LiquidGlass.tsx`（WebGL2 多通道着色器）和 `client/src/App.tsx` 中已挂的全屏液态玻璃 canvas + `setGenerateGlassShapes` 上报机制。

**前置参考：**
- 设计文档：`docs/specs/2026-05-19-model-plaza-glass-redesign.md`
- mockup HTML：`.tmp/model-plaza-mockup.html`
- mockup 截图：`.tmp/plaza-mockup.png`（1440×2300）
- 视觉铁律：`DESIGN.md`（v0.2 增补"嵌套式液态玻璃卡片"那一节是首要参照）

---

## File Structure

### 新建文件
- `client/src/plaza/constants.ts` — 导出 `PLAZA_GLASS_RADIUS = 32` 唯一常量，给所有液态玻璃父级 + 内层灰卡共用

### 修改文件
- `client/src/plaza/data.ts` — chip 颜色：业务分类色 → port 语义色
- `client/src/plaza/FilterBar.tsx` — chip 激活态去电黄，改 `glass-hi` + accent-robot 外环
- `client/src/plaza/Paginator.tsx` — 当前页按钮去电黄，改 `glass-hi` + accent-robot 外环
- `client/src/plaza/RecommendCard.tsx` — hover 态去金色 box-shadow，改 accent-robot 1px 外环；收藏 ⭐ active 仍允许 accent-foxo
- `client/src/plaza/HeroBanner.tsx` — 整体重写：去掉紫调 radial + 3D SVG，改成嵌套式（外层液态玻璃壳 + 内层灰矩形）+ 左标题 + 右三栏统计
- `client/src/plaza/FeaturedCard.tsx` — 整体重写：去掉金色边框 / 渐变标题 / 全图背景，改成嵌套式（外层液态玻璃壳 + 内层灰矩形）+ 上图下文双层 layout；第一张 trending 改为电黄空心徽章
- `client/src/ModelPlaza.tsx` — 接收 `onShapesChange` prop，用 `useLayoutEffect` + `ResizeObserver` 测 Hero + 4 旗舰共 5 个 ref 的 boundingClientRect，上报 `GlassShape[]`
- `client/src/App.tsx` — 第 968-969 行渲染 `<ModelPlaza />` 时传 `onShapesChange={setGenerateGlassShapes}` 即可（已有 state 复用）

---

## Task 1: 抽常量 + chip 色映射

**Files:**
- Create: `client/src/plaza/constants.ts`
- Modify: `client/src/plaza/data.ts`

- [ ] **Step 1: 新建常量文件**

写入 `client/src/plaza/constants.ts`：

```ts
// 模型广场视觉常量。
// 液态玻璃父级 shapeRadius 与所有直接子级内层卡 CSS rounded-[Npx] 必须使用同一像素值，避免漂移。
// 该值与 DESIGN.md v0.2 "圆角统一约束" 一致。
export const PLAZA_GLASS_RADIUS = 32;
```

- [ ] **Step 2: chip 颜色映射改 port 语义色**

修改 `client/src/plaza/data.ts`。把 5 处 `chip: { label, color }` 的颜色按下表替换：

| label | 旧 color | 新 color | 来源 |
|---|---|---|---|
| 图像生成 | `#A78BFA` | `#4CB1FF` | `accent-robot` / image port |
| 对话模型 | `#67E8F9` | `#7CE38B` | `port-positive` |
| 高速模型 | `#7CE38B` | `#7CE38B` | 保持 `port-positive`（已对齐） |
| 专业版 | `#F0FE2D` | `rgba(255,255,255,0.55)` | 灰阶（电黄是唯一 CTA） |
| 多模态 | `#FF7E87` | `#FF7E87` | `accent-ptext` / output port（已对齐） |

替换后的 `FEATURED` 数组里所有 chip.color 值检查清单：
- `id: "gpt-image2"` 的 chip → color: `"#4CB1FF"`
- `id: "banana"` 的 chip → color: `"#7CE38B"`
- `id: "nano"` 的 chip → color: `"#7CE38B"`
- `id: "pro"` 的 chip → color: `"rgba(255,255,255,0.55)"`

替换后的 `RECOMMEND` 数组里所有 chip.color 值检查清单：
- `id: "vision-xl"` 的 chip → color: `"#4CB1FF"`
- `id: "dreamer"` 的 chip → color: `"#4CB1FF"`
- `id: "chat-master"` 的 chip → color: `"#7CE38B"`
- `id: "multi-modal"` 的 chip → color: `"#FF7E87"`（不变）

- [ ] **Step 3: 启动 dev 验证编译**

后端可以不启动（本任务不动后端）。检查前端：

Run（PowerShell）：
```powershell
cd D:\webProject\image2\client
npm run build
```

Expected: build 通过，无 TS 错误。

- [ ] **Step 4: Commit**

```bash
git add client/src/plaza/constants.ts client/src/plaza/data.ts
git commit -m "refactor(plaza): chip 颜色映射到 port 语义色 + 抽 PLAZA_GLASS_RADIUS 常量"
```

---

## Task 2: FilterBar 激活态对齐 DESIGN.md

**Files:**
- Modify: `client/src/plaza/FilterBar.tsx`

- [ ] **Step 1: 读取当前文件**

先读 `client/src/plaza/FilterBar.tsx`，找到 chip 激活态的样式（应该是 `bg-accent-foxo` + `text-black` + 金色发光）。

- [ ] **Step 2: 替换激活态样式**

把 chip 激活态从"电黄填充"改为"`glass-hi` + accent-robot 1px 外环"。
原激活态 class（用于参照搜索）：含 `bg-accent-foxo` 或 `bg-[#F0FE2D]` + `text-[#0D0D0D]` / `text-black` + `shadow-` 发光阴影。

新激活态 class 应该是：

```tsx
"bg-white/[0.08] text-white/95 shadow-[0_0_0_1px_rgba(76,177,255,1)]"
```

非激活态保持原值（应该是 `bg-white/[0.04] text-white/64` 类似）。
"自定义 +" outlined chip 保持原值（已有 1px 灰边）。

- [ ] **Step 3: 启动 dev 验证视觉**

Run（PowerShell，在另一个终端窗口）：
```powershell
cd D:\webProject\image2\client
npm run dev
```

浏览器打开 `http://localhost:5173/`，登录后切到左侧"模型"导航。

Expected: FilterBar "全部" chip 不再是电黄填充，改为略亮的玻璃底 + 一圈淡蓝色外环。其它 chip 灰阶。

- [ ] **Step 4: Commit**

```bash
git add client/src/plaza/FilterBar.tsx
git commit -m "fix(plaza): FilterBar 激活态去电黄，改 accent-robot 外环对齐 DESIGN.md"
```

---

## Task 3: Paginator 当前页对齐 DESIGN.md

**Files:**
- Modify: `client/src/plaza/Paginator.tsx`

- [ ] **Step 1: 读取当前文件**

读 `client/src/plaza/Paginator.tsx`，定位当前页按钮的"金色填充 + 黑字"样式。

- [ ] **Step 2: 替换当前页样式**

把当前页按钮从"电黄填充"改为"`glass-hi` + accent-robot 外环"。

新当前页 class：
```tsx
"bg-white/[0.08] text-white/95 font-medium shadow-[0_0_0_1px_rgba(76,177,255,1)]"
```

非当前页和 prev/next 箭头按钮的样式保持不动。数字字体新增 `tabular-nums`（如未加）：
```tsx
className="... tabular-nums"
```

- [ ] **Step 3: 视觉验证**

dev server 已在跑（沿用 Task 2 的）。刷新浏览器，滚动到广场最底部。

Expected: 当前页码不再是电黄底 + 黑字，改为 `glass-hi` + 淡蓝外环；数字使用 tabular-nums。

- [ ] **Step 4: Commit**

```bash
git add client/src/plaza/Paginator.tsx
git commit -m "fix(plaza): Paginator 当前页去电黄，改 accent-robot 外环 + tabular-nums"
```

---

## Task 4: RecommendCard 去金色发光

**Files:**
- Modify: `client/src/plaza/RecommendCard.tsx`

- [ ] **Step 1: 读取当前文件**

读 `client/src/plaza/RecommendCard.tsx`。当前的视觉问题：
- 第 18 行 hover 态：`hover:scale-[1.02] hover:border-accent-foxo/30 hover:shadow-[0_18px_36px_-12px_rgba(247,200,11,0.35)]`
- 第 34 行底部细线：`bg-gradient-to-r from-transparent via-accent-foxo/70 to-transparent`

这些都违反"只有 Generate 有发光 + UI 不允许金色边框"铁律。

- [ ] **Step 2: 替换 hover 态**

把第 18 行整段 className 中的 hover 部分换成：

```tsx
"... transition-all hover:border-white/[0.18] hover:shadow-[0_0_0_1px_rgba(76,177,255,0.5)]"
```

去掉 `hover:scale-[1.02]`（DESIGN.md 不允许 hover 时大幅变形）。
去掉 `hover:border-accent-foxo/30`。
去掉金色 box-shadow。

- [ ] **Step 3: 删掉底部金色细线**

完全删除 RecommendCard 中第 34 行那个底部金色细线 div：

```tsx
{/* 删除整行 */}
<div className="pointer-events-none absolute inset-x-3 bottom-0 h-px bg-gradient-to-r from-transparent via-accent-foxo/70 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
```

- [ ] **Step 4: 收藏 ⭐ active 态保留 accent-foxo**

⭐ 按钮当前 hover 态 `hover:text-accent-foxo` 保留（DESIGN.md 允许 user-toggled favorite 用 accent-foxo，是协作者 Paul 的身份色之一）。这一行不动。

- [ ] **Step 5: 视觉验证**

刷新浏览器，悬停推荐卡：

Expected:
- 不再放大
- 不再有金色阴影
- 改为：边框微微变白 + 1px 淡蓝外环
- 底部不再出现金色细线

- [ ] **Step 6: Commit**

```bash
git add client/src/plaza/RecommendCard.tsx
git commit -m "fix(plaza): RecommendCard 去 hover 金色发光与变形，改 accent-robot 外环"
```

---

## Task 5: HeroBanner 重写为嵌套结构

**Files:**
- Modify: `client/src/plaza/HeroBanner.tsx`

- [ ] **Step 1: 整体替换文件内容**

把 `client/src/plaza/HeroBanner.tsx` 整文件替换为：

```tsx
import { forwardRef } from "react";
import { PLAZA_GLASS_RADIUS } from "./constants";

// Hero：嵌套式液态玻璃壳（外层等待 LiquidGlass 注入 WebGL 渲染） + 内层 #1E1E22 实色灰矩形。
// 父子圆角必须一致 = PLAZA_GLASS_RADIUS。
// 左侧标题 + 副标题 + 路径，右侧三栏统计（在线模型 / 你的收藏 / 本周热门），数字 tabular-nums。
// 不允许：紫调 radial-gradient / 3D 装饰 SVG / 16px+ 营销标题。

export const HeroBanner = forwardRef<HTMLDivElement>(function HeroBanner(_, ref) {
  return (
    <section
      ref={ref}
      className="relative overflow-hidden border border-white/[0.14]"
      style={{
        borderRadius: PLAZA_GLASS_RADIUS,
        // 占位玻璃底 —— 当 LiquidGlass canvas 在其上方覆盖时这层不可见；
        // 万一 WebGL 失败也有 fallback。
        background: "rgba(28,28,32,0.6)",
        height: 160,
        padding: 10,
      }}
    >
      <div
        className="flex h-full items-stretch border border-white/[0.04] bg-[#1E1E22] px-7"
        style={{ borderRadius: PLAZA_GLASS_RADIUS }}
      >
        <div className="flex flex-1 flex-col justify-center">
          <h1 className="text-[22px] font-medium tracking-[-0.01em] text-white/95">
            模型广场
          </h1>
          <p className="mt-1.5 text-[13px] text-white/64">
            探索高质量创作模型 · 覆盖图像生成 / 对话 / 多模态
          </p>
          <p className="mt-1 text-[11px] tracking-wider text-white/40">
            首页 / 模型广场
          </p>
        </div>
        <div className="flex items-center gap-8 pr-2">
          <HeroStat label="在线模型" value="247" trend="+12 本周" trendClass="text-port-positive" />
          <HeroStat label="你的收藏" value="12" trend="上次 3 天前" divider />
          <HeroStat label="本周热门" value="38" trend="实时刷新" divider />
        </div>
      </div>
    </section>
  );
});

function HeroStat({
  label,
  value,
  trend,
  trendClass = "text-white/40",
  divider = false,
}: {
  label: string;
  value: string;
  trend: string;
  trendClass?: string;
  divider?: boolean;
}) {
  return (
    <div
      className={`flex min-w-[110px] flex-col gap-1 ${divider ? "border-l border-white/[0.08] pl-7" : ""}`}
    >
      <span className="text-[11px] tracking-wider text-white/40">{label}</span>
      <span className="text-[22px] font-medium leading-none tabular-nums text-white/95">
        {value}
      </span>
      <span className={`text-[11px] tracking-wider ${trendClass}`}>{trend}</span>
    </div>
  );
}
```

注意：用 `forwardRef` 把 section 的 DOM ref 暴露给 ModelPlaza（Task 7 会需要用 ref 测位置上报给 LiquidGlass）。

- [ ] **Step 2: 确认 tailwind 没有 text-port-positive token**

Run（PowerShell）：
```powershell
Select-String -Path "client\tailwind.config.js" -Pattern "port-positive|positive" -SimpleMatch
```

Expected：如果 `tailwind.config.js` 没有 `port-positive` 这个名，则把 `text-port-positive` 改为 `text-[#7CE38B]`：

```tsx
<HeroStat label="在线模型" value="247" trend="+12 本周" trendClass="text-[#7CE38B]" />
```

- [ ] **Step 3: 处理 ModelPlaza.tsx 调用方**

`client/src/ModelPlaza.tsx` 当前调用 `<HeroBanner />` 不传 ref。先保持不传 ref，等 Task 7 接入。HeroBanner 用了 forwardRef 但允许 ref 为 undefined，所以不会出错。

- [ ] **Step 4: 视觉验证**

刷新浏览器，看 Hero 区域：

Expected:
- 高度从原来的 220px 降到 160px
- 没有紫调背景
- 没有右侧 3D 立方体装饰
- 左侧"模型广场" 22px 标题 + 副标题 + 路径
- 右侧三栏统计：在线模型 247 / 你的收藏 12 / 本周热门 38，数字 tabular-nums
- 整体呈"嵌套式"：外层玻璃壳留 10px padding，内层是 `#1E1E22` 实色灰矩形

- [ ] **Step 5: Commit**

```bash
git add client/src/plaza/HeroBanner.tsx
git commit -m "feat(plaza): HeroBanner 重写为嵌套式液态玻璃壳 + 三栏统计"
```

---

## Task 6: FeaturedCard 重写为嵌套结构 + 上图下文

**Files:**
- Modify: `client/src/plaza/FeaturedCard.tsx`

- [ ] **Step 1: 整体替换文件内容**

把 `client/src/plaza/FeaturedCard.tsx` 整文件替换为：

```tsx
import { forwardRef, type ReactNode } from "react";
import type { Featured } from "./types";
import { FlameIcon, HeartIcon, BarsIcon, BoltIcon } from "./icons";
import { PLAZA_GLASS_RADIUS } from "./constants";

// FeaturedCard：嵌套式液态玻璃壳（外层待 LiquidGlass 注入 WebGL 渲染）+ 内层 #1E1E22 灰矩形。
// 内层上半部是 16:10 作品图（占满宽度），下半部 #1E1E22 实色文字区。
// 第一张 trending：右上电黄空心徽章（无填充无发光），不是金色边框。

type Props = {
  card: Featured;
  onClick: () => void;
};

export const FeaturedCard = forwardRef<HTMLButtonElement, Props>(function FeaturedCard(
  { card, onClick },
  ref,
) {
  const isFeatured = card.featured === true;
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className="group relative h-[240px] w-full overflow-hidden border border-white/[0.14] p-2.5 text-left transition-colors hover:border-white/[0.2]"
      style={{
        borderRadius: PLAZA_GLASS_RADIUS,
        background: "rgba(28,28,32,0.6)",
      }}
    >
      {isFeatured && (
        <div className="absolute right-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-[11px] border border-accent-foxo bg-accent-foxo/[0.08] px-2.5 py-1 text-[10px] font-medium tracking-[0.04em] text-accent-foxo">
          <span className="inline-block h-2 w-2 rounded-full border-[1.5px] border-accent-foxo" />
          trending
        </div>
      )}

      <div
        className="flex h-[220px] flex-col overflow-hidden border border-white/[0.04] bg-[#1E1E22]"
        style={{ borderRadius: PLAZA_GLASS_RADIUS }}
      >
        <div
          className="relative h-[132px] w-full overflow-hidden"
          style={{ background: card.fallbackBg }}
        >
          {card.image && (
            <img
              src={card.image}
              alt={card.title}
              className="absolute inset-0 h-full w-full object-cover"
              loading="eager"
              decoding="async"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          )}
        </div>

        <div className="flex flex-1 flex-col px-3.5 pt-3">
          <h4 className="text-[14px] font-medium tracking-[-0.01em] text-white/95">
            {card.title}
          </h4>
          <Chip label={card.chip.label} color={card.chip.color} />
          <p className="mt-1 line-clamp-1 whitespace-pre-line text-[11px] leading-snug text-white/55">
            {card.desc.replace(/\n/g, " · ")}
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1 pb-3 text-[11px] tracking-wider text-white/40 tabular-nums">
            <Stat icon={<FlameIcon />} value={card.stats.hot} />
            <Stat icon={<HeartIcon />} value={card.stats.fav} />
            {card.stats.calls && <Stat icon={<BarsIcon />} value={card.stats.calls} />}
            <Stat icon={<BoltIcon />} value={card.stats.speed} />
          </div>
        </div>
      </div>
    </button>
  );
});

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="mt-2 inline-flex w-fit items-center rounded-[4px] border px-1.5 py-[2px] text-[10px] font-medium leading-none"
      style={{ color, borderColor: color + "66", backgroundColor: color + "26" }}
    >
      {label}
    </span>
  );
}

function Stat({ icon, value }: { icon: ReactNode; value: string }) {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <span className="text-white/35">{icon}</span>
      <span className="text-white/65">{value}</span>
    </span>
  );
}
```

变化要点（对齐 DESIGN.md）：
- 用 `forwardRef<HTMLButtonElement>` 暴露 ref，给 Task 7 用
- 去掉 isFeatured 时的 `border-accent-foxo/40` + 金色 box-shadow → 统一灰边
- 去掉 30px 渐变文字标题 → 14px medium 灰阶白
- 去掉左上"热门推荐"红字胶囊
- 去掉 isFeatured 卡片下方的"旗舰模型 👑"金色徽章
- 去掉底部金色细线
- 上图下文双层结构，作品图 132px 高，文字区在下
- 数字加 tabular-nums

- [ ] **Step 2: 处理 FeaturedGrid 调用方**

`client/src/plaza/FeaturedGrid.tsx` 调用 `<FeaturedCard card={c} onClick={...} />`，没传 ref。Task 7 才需要 ref。先保持调用方不变。

- [ ] **Step 3: 视觉验证**

刷新浏览器，看 4 张旗舰卡：

Expected:
- 4 张卡等宽（原来第一张更宽 1.42 倍 → 现在 1fr × 4 等宽）
- 第一张（GPT IMAGE2）右上有电黄空心徽章"trending"，无金色发光
- 标题统一灰阶 14px，无彩色渐变
- 作品图在上 132px 高，文字区在下
- 整体呈嵌套式：外层玻璃壳 10px padding，内层 `#1E1E22`

> ⚠ FeaturedGrid 默认 grid 列宽可能是 `1.42fr 1fr 1fr 1fr`（旧版第一张更宽）。如果是，改成 `repeat(4, 1fr)`。

- [ ] **Step 4: 如果 FeaturedGrid 还在用非等宽列宽，改成等宽**

读 `client/src/plaza/FeaturedGrid.tsx`，把 grid-template-columns 改为：

```tsx
className="grid grid-cols-4 gap-4"
```

或样式里：
```tsx
style={{ gridTemplateColumns: "repeat(4, 1fr)" }}
```

去掉 `1.42fr 1fr 1fr 1fr` 的写法。

- [ ] **Step 5: Commit**

```bash
git add client/src/plaza/FeaturedCard.tsx client/src/plaza/FeaturedGrid.tsx
git commit -m "feat(plaza): FeaturedCard 重写为嵌套式 + 上图下文 + 等宽 4 列 + trending 改电黄空心徽章"
```

---

## Task 7: ModelPlaza 接入 LiquidGlass shapes

**Files:**
- Modify: `client/src/ModelPlaza.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/plaza/FeaturedGrid.tsx`（需把 4 个卡的 ref 透传出来）

- [ ] **Step 1: 改 FeaturedGrid 接受 refs 数组**

读 `client/src/plaza/FeaturedGrid.tsx` 当前定义。把它改成可以接受一个 refs 数组，把每个 FeaturedCard 的 ref 挂上去。

把 `client/src/plaza/FeaturedGrid.tsx` 整文件替换为：

```tsx
import type { RefObject } from "react";
import type { Featured } from "./types";
import { FeaturedCard } from "./FeaturedCard";

type Props = {
  items: Featured[];
  onCardClick: (card: Featured) => void;
  cardRefs?: RefObject<HTMLButtonElement | null>[];
};

export function FeaturedGrid({ items, onCardClick, cardRefs }: Props) {
  return (
    <section className="grid grid-cols-4 gap-4">
      {items.map((c, i) => (
        <FeaturedCard
          key={c.id}
          ref={cardRefs?.[i]}
          card={c}
          onClick={() => onCardClick(c)}
        />
      ))}
    </section>
  );
}
```

- [ ] **Step 2: ModelPlaza 上报 shapes**

整体替换 `client/src/ModelPlaza.tsx`：

```tsx
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FEATURED, RECOMMEND, TOTAL_PAGES, type FilterValue } from "./plaza/data";
import { TopBar } from "./plaza/TopBar";
import { HeroBanner } from "./plaza/HeroBanner";
import { FilterBar } from "./plaza/FilterBar";
import { FeaturedGrid } from "./plaza/FeaturedGrid";
import { RecommendGrid } from "./plaza/RecommendGrid";
import { Paginator } from "./plaza/Paginator";
import { PLAZA_GLASS_RADIUS } from "./plaza/constants";
import type { GlassShape } from "./LiquidGlass";

// 模型广场（内嵌组件）。
// 作为 App 主壳中 activeNav==='models' 分区的内容，由父级提供布局外壳与全局背景。
// Hero + 4 张 FeaturedCard 通过 onShapesChange 把 boundingClientRect 上报给 App，
// App 把它们传给全局 LiquidGlass canvas 做 WebGL 渲染。

type Props = {
  onShapesChange?: (shapes: GlassShape[]) => void;
};

export default function ModelPlaza({ onShapesChange }: Props = {}) {
  const [activeFilter, setActiveFilter] = useState<FilterValue>("全部");
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");

  const heroRef = useRef<HTMLDivElement | null>(null);
  // 4 个旗舰卡 ref。固定 4 个 — FEATURED 数组固定 4 条
  const feat0Ref = useRef<HTMLButtonElement | null>(null);
  const feat1Ref = useRef<HTMLButtonElement | null>(null);
  const feat2Ref = useRef<HTMLButtonElement | null>(null);
  const feat3Ref = useRef<HTMLButtonElement | null>(null);
  const featRefs = [feat0Ref, feat1Ref, feat2Ref, feat3Ref];

  useLayoutEffect(() => {
    if (!onShapesChange) return;
    const measure = () => {
      const targets: (HTMLElement | null)[] = [heroRef.current, ...featRefs.map((r) => r.current)];
      const shapes: GlassShape[] = targets
        .filter((el): el is HTMLElement => el !== null)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            centerX: r.left + r.width / 2,
            centerY: r.top + r.height / 2,
            width: r.width,
            height: r.height,
            radius: PLAZA_GLASS_RADIUS,
          };
        });
      onShapesChange(shapes);
    };
    const raf = requestAnimationFrame(measure);
    const observer = new ResizeObserver(() => requestAnimationFrame(measure));
    const allRefs: (HTMLElement | null)[] = [heroRef.current, ...featRefs.map((r) => r.current)];
    allRefs.forEach((el) => el && observer.observe(el));
    const onScroll = () => requestAnimationFrame(measure);
    const onResize = () => requestAnimationFrame(measure);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [onShapesChange]);

  // 卸载时清空 shapes，避免在切换 nav 后 LiquidGlass 还在画上一次的位置
  useEffect(() => {
    return () => {
      onShapesChange?.([]);
    };
  }, [onShapesChange]);

  return (
    <div className="min-w-0 flex-1 space-y-5 overflow-y-auto px-1 pb-2">
      <TopBar searchQuery={searchQuery} onSearchChange={setSearchQuery} />
      <HeroBanner ref={heroRef} />
      <FilterBar activeFilter={activeFilter} onFilterChange={setActiveFilter} />
      <FeaturedGrid
        items={FEATURED}
        cardRefs={featRefs}
        onCardClick={(c) => console.log("[plaza] featured selected", c.id)}
      />
      <RecommendGrid
        items={RECOMMEND}
        onCardClick={(m) => console.log("[plaza] recommend selected", m.id)}
        onFavorite={(m) => console.log("[plaza] favorite toggled", m.id)}
        onRefresh={() => console.log("[plaza] refresh recommend")}
      />
      <Paginator page={page} total={TOTAL_PAGES} onChange={setPage} />
    </div>
  );
}
```

注意要点：
- Hero ref 类型 `HTMLDivElement | null`，因为 HeroBanner 用 `forwardRef<HTMLDivElement>`
- FeaturedCard ref 类型 `HTMLButtonElement | null`
- `useLayoutEffect` 在浏览器 paint 前测位置，避免闪烁
- ResizeObserver 监听所有 5 个元素大小变化；scroll/resize 也触发重测
- 卸载时清空 shapes 防止残影

- [ ] **Step 3: App.tsx 传递 onShapesChange**

修改 `client/src/App.tsx` 第 968-970 行（`<ModelPlaza />` 渲染处）。原代码：

```tsx
{activeNav === "models" ? (
  <ModelPlaza />
) : (
```

改为：

```tsx
{activeNav === "models" ? (
  <ModelPlaza onShapesChange={setGenerateGlassShapes} />
) : (
```

注意：`setGenerateGlassShapes` 已经在 App.tsx 顶层定义（line 211 `useState<GlassShape[]>([])`），且 line 405 在 mode !== "workflow" 时使用它。activeNav === "models" 时 mode 默认是 "generate"（line 207），所以 glassShapes 就是 ModelPlaza 上报的 5 个 shape。

- [ ] **Step 4: 视觉验证（关键步骤）**

dev server 继续跑。刷新浏览器，切到"模型"导航：

Expected:
- Hero 区域是真液态玻璃（背景有折射 / 色散 / 菲涅尔 / 阴影），不是 CSS 半透明
- 4 张旗舰卡也是真液态玻璃
- 滚动页面时玻璃 shape 位置跟随
- 推荐卡 / 顶栏 / FilterBar / 分页都不是 WebGL 玻璃（保持 CSS 玻璃仿色）

如果 Hero 和卡片只是 CSS 玻璃没有 WebGL 效果：
1. 检查 `client/src/App.tsx` line 410 `<LiquidGlass shapes={glassShapes} params={glassParams} />` 是否在 activeNav === "models" 时也渲染
2. 检查浏览器 console 有无 `[LiquidGlass] init failed` 报错
3. 检查 `glassShapes` 数组在 React DevTools 里是否有 5 项

- [ ] **Step 5: 切换 nav 验证 shapes 清空**

在浏览器中：模型 → 工作台 → 模型 来回切换 2 次，检查 WebGL canvas 不残留旧的旗舰卡位置。

- [ ] **Step 6: 性能粗测**

在 Chrome DevTools Performance 面板录制 5 秒滚动 + 切换 nav 的交互。

Expected: 帧率不低于 50fps。如果低于 40fps，记录为已知问题，后续考虑兜底方案（只 Hero + 第一张 trending 卡走 WebGL，其余 CSS 仿色）。

- [ ] **Step 7: Commit**

```bash
git add client/src/ModelPlaza.tsx client/src/plaza/FeaturedGrid.tsx client/src/App.tsx
git commit -m "feat(plaza): 接入全局 LiquidGlass，Hero + 4 旗舰卡贡献 5 个 WebGL shape"
```

---

## Task 8: 端到端视觉验证 + 与 mockup 截图对照

**Files:**
- 不修改任何代码；只截图对比

- [ ] **Step 1: 启动 dev server + 后端**

如果未启动：

```powershell
# 终端 1（前端）
cd D:\webProject\image2\client
npm run dev
```

```powershell
# 终端 2（后端，登录需要）
cd D:\webProject\image2\server
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --port 8000
```

- [ ] **Step 2: 浏览器测试**

打开 `http://localhost:5173/`，登录后切到"模型"导航。

逐项对照 `docs/specs/2026-05-19-model-plaza-glass-redesign.md` 第五章"视觉验证清单"5.1 & 5.2 的勾选项。

- [ ] **Step 3: 截图对照**

用 Chrome DevTools MCP 或 Windows 自带截图，截一张完整页（1440 宽，整页滚动到底）。

对照 `.tmp/plaza-mockup.png`：
- Hero 三栏统计是否齐
- 4 旗舰卡 trending 徽章位置
- chip 颜色是否对应 port 语义
- 整体灰阶 + 唯一电黄 = 顶栏右上 + 新建项目

- [ ] **Step 4: console 检查**

DevTools Console 应该无 React warning、无 LiquidGlass 报错。

- [ ] **Step 5: 已知问题登记**

如果发现任何不符（例如某 chip 颜色还有残留旧色），把它写到 `.tmp/plaza-known-issues.md`，由用户决定是否新建 follow-up 任务。

- [ ] **Step 6: Final commit if any tweaks**

如果验证过程中改动了视觉细节：

```bash
git add client/src/plaza/
git commit -m "fix(plaza): 视觉验证微调（详见 commit body）"
```

如无改动，本任务到此为止。

---

## Self-Review Notes

**Spec coverage（spec 第 4 节"落地代码改动清单"对照）：**
- ✅ Task 1 覆盖：抽常量 + chip 色映射
- ✅ Task 2 覆盖：FilterBar 激活态
- ✅ Task 3 覆盖：Paginator 当前页
- ✅ Task 4 覆盖：RecommendCard hover 态
- ✅ Task 5 覆盖：HeroBanner 重写
- ✅ Task 6 覆盖：FeaturedCard 重写
- ✅ Task 7 覆盖：液态玻璃接入（spec 5.2 "性能粗测"）
- ✅ Task 8 覆盖：端到端视觉验证（spec 5.1 全部铁律对齐项）

**Type 一致性检查：**
- `HeroBanner` ref type `HTMLDivElement`，`ModelPlaza` 用 `useRef<HTMLDivElement | null>` ✓
- `FeaturedCard` ref type `HTMLButtonElement`，`FeaturedGrid` 用 `RefObject<HTMLButtonElement | null>[]` ✓
- `GlassShape` import from `LiquidGlass.tsx`（line 17-23 定义） ✓
- `PLAZA_GLASS_RADIUS` 在 Task 1 创建，Tasks 5/6/7 引用 ✓

**Placeholder 扫描：** 已确认没有 TBD / TODO / "fill in details" / "similar to Task N" 等占位语句。每个代码步骤都有完整代码块。

**Scope 检查：** 这是一个聚焦在 `client/src/plaza/` + `ModelPlaza.tsx` + `App.tsx` 局部的视觉重做，单一 implementation plan 范围合理，不需要拆子项目。
