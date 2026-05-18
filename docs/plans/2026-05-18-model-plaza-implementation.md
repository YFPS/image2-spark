# 模型广场（Model Plaza）重写 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 520 行单文件 `client/src/ModelPlaza.tsx` 重写为入口 + 6 个子组件 + data/types/icons 模块化结构，对齐设计图（含纵向 16:9 大图封面式推荐卡），并接入 8 张 AI 生成的 webp 素材。

**Architecture:** 增量拆分 → 每 task 提交一次，每次都能 `npm run dev` 跑起来。把 mock 数据、SVG icons、各子组件按职责拆到 `client/src/plaza/` 下；最后整体替换 `ModelPlaza.tsx` 入口。

**Tech Stack:** React 18 + Vite + TypeScript + Tailwind CSS（项目内已有），不引入新依赖。

**Spec:** `docs/specs/2026-05-18-model-plaza-redesign.md`（git 5851f6d）

**前端无单元测试基础设施**（项目 CLAUDE.md 明确）。验证依靠：① TypeScript 编译通过 ② `npm run dev` 启动无 console.error ③ 浏览器对照 spec §7 验证清单 ④ 最后用 chrome-devtools MCP 跑一遍 §7.1–7.5。

---

## 任务总览与依赖

```
Task 1 (目录+types)
  └─ Task 2 (data.ts)
       └─ Task 3 (icons.tsx)
            └─ Task 4 (TopBar) ─┐
            └─ Task 5 (HeroBanner) ─┤
            └─ Task 6 (FilterBar) ─┼─ Task 10 (组装入口)
            └─ Task 7 (Paginator) ─┤        │
            └─ Task 8 (FeaturedGrid+Card) ─┤        ├─ Task 11 (8 张素材)
            └─ Task 9 (RecommendGrid+Card) ─┘        │     │
                                                 Task 12 (浏览器验证)
```

Task 4–9 内部彼此独立，可任意顺序。

---

## Task 1: 创建 plaza/ 目录与类型定义

**Files:**
- Create: `client/src/plaza/types.ts`

- [ ] **Step 1.1: 新建 `client/src/plaza/types.ts`**

```ts
export type Chip = { label: string; color: string };

export type Featured = {
  id: string;
  title: string;
  chip: Chip;
  desc: string;
  stats: { hot: string; fav: string; calls?: string; speed: string };
  /** 本地 webp import 后的字符串路径；undefined 时走 fallbackBg 渐变 */
  image?: string;
  /** 图片加载失败 / 缺图时使用的 CSS 渐变 */
  fallbackBg: string;
  featured?: boolean;
  badge?: string;
};

export type Recommend = {
  id: string;
  title: string;
  chip: Chip;
  desc: string;
  hot: string;
  speed: string;
  image?: string;
  fallbackBg: string;
};
```

- [ ] **Step 1.2: 验证 TypeScript 通过**

```bash
cd client && npx tsc --noEmit 2>&1 | head -20
```

Expected: 没有新错误（types.ts 没人引用，必须自身合法）

- [ ] **Step 1.3: Commit**

```bash
cd D:/webProject/image2
git add client/src/plaza/types.ts
git commit -m "feat(plaza): 新增模型广场类型定义"
```

---

## Task 2: 抽出 mock 数据到 data.ts

**Files:**
- Create: `client/src/plaza/data.ts`

- [ ] **Step 2.1: 新建 `client/src/plaza/data.ts`，含完整 mock 数据**

```ts
import type { Featured, Recommend } from "./types";

export const FILTERS = ["全部", "图像生成", "对话模型", "多模态", "专业版"] as const;
export type FilterValue = (typeof FILTERS)[number];

export const FEATURED: Featured[] = [
  {
    id: "gpt-image2",
    title: "GPT IMAGE2",
    chip: { label: "图像生成", color: "#A78BFA" },
    desc: "新一代图像生成模型，细节出众，创意无限。",
    stats: { hot: "98.7K", fav: "23.6K", calls: "1.2M", speed: "1.2s" },
    featured: true,
    badge: "旗舰模型",
    fallbackBg:
      "radial-gradient(120% 90% at 70% 35%, #6b3bd6 0%, #2a164d 35%, #050310 75%)," +
      "radial-gradient(60% 80% at 25% 80%, rgba(99,102,241,0.45), transparent 65%)",
  },
  {
    id: "banana",
    title: "BANANA",
    chip: { label: "对话模型", color: "#67E8F9" },
    desc: "轻松有趣的对话体验，\n你的创意好伙伴。",
    stats: { hot: "68.4K", fav: "12.1K", speed: "0.8s" },
    fallbackBg:
      "radial-gradient(110% 90% at 75% 30%, #f7c948 0%, #6c4413 40%, #0b0708 80%)," +
      "radial-gradient(60% 80% at 25% 80%, rgba(247,176,91,0.30), transparent 65%)",
  },
  {
    id: "nano",
    title: "NANO",
    chip: { label: "高速模型", color: "#7CE38B" },
    desc: "超快响应，低延迟输出，\n适合高频创作场景。",
    stats: { hot: "41.2K", fav: "8.7K", speed: "0.3s" },
    fallbackBg:
      "radial-gradient(110% 90% at 70% 35%, #1e90ff 0%, #142a55 40%, #06070d 80%)," +
      "radial-gradient(60% 80% at 25% 85%, rgba(99,179,255,0.30), transparent 65%)",
  },
  {
    id: "pro",
    title: "PRO",
    chip: { label: "专业版", color: "#F0FE2D" },
    desc: "专业级创作模型，\n满足高标准输出需求。",
    stats: { hot: "32.8K", fav: "6.3K", speed: "1.6s" },
    fallbackBg:
      "radial-gradient(110% 90% at 70% 30%, #b1b5bf 0%, #3b3d49 45%, #0a0a10 80%)," +
      "radial-gradient(60% 80% at 25% 85%, rgba(160,170,200,0.25), transparent 65%)",
  },
];

export const RECOMMEND: Recommend[] = [
  {
    id: "vision-xl",
    title: "VISION XL",
    chip: { label: "图像生成", color: "#A78BFA" },
    desc: "超清图像生成，支持复杂场景渲染。",
    hot: "28.1K",
    speed: "1.4s",
    fallbackBg: "linear-gradient(135deg,#2a5b8e 0%,#0f1f33 60%,#070a13 100%)",
  },
  {
    id: "dreamer",
    title: "DREAMER",
    chip: { label: "图像生成", color: "#A78BFA" },
    desc: "艺术风格多样，激发无限想象。",
    hot: "19.7K",
    speed: "1.8s",
    fallbackBg: "linear-gradient(135deg,#7a4cb7 0%,#2a1748 60%,#0a0612 100%)",
  },
  {
    id: "chat-master",
    title: "CHAT MASTER",
    chip: { label: "对话模型", color: "#67E8F9" },
    desc: "强大对话理解，精准回答各类问题。",
    hot: "17.3K",
    speed: "0.7s",
    fallbackBg: "linear-gradient(135deg,#1f8e8e 0%,#0e2a3c 60%,#06121a 100%)",
  },
  {
    id: "multi-modal",
    title: "MULTI MODAL",
    chip: { label: "多模态", color: "#FF7E87" },
    desc: "文本、图像、语音多模态理解。",
    hot: "15.6K",
    speed: "1.1s",
    fallbackBg: "linear-gradient(135deg,#a44ad6 0%,#3b1755 60%,#0c0716 100%)",
  },
];

export const TOTAL_PAGES = 5;
```

- [ ] **Step 2.2: TypeScript 验证**

```bash
cd client && npx tsc --noEmit 2>&1 | head -20
```

Expected: 没有新错误。

- [ ] **Step 2.3: Commit**

```bash
git add client/src/plaza/data.ts
git commit -m "feat(plaza): 抽出 mock 数据到 data.ts（FEATURED/RECOMMEND/FILTERS）"
```

---

## Task 3: 抽 SVG icons 到 icons.tsx

**Files:**
- Create: `client/src/plaza/icons.tsx`

复用现有 `ModelPlaza.tsx:428-518` 中所有 SVG 函数组件。

- [ ] **Step 3.1: 新建 `client/src/plaza/icons.tsx`**

```tsx
export function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function FilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h18M6 12h12M10 19h4" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 1 1 12 0v5l1.5 3h-15L6 13z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function FlameIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2s4 4 4 8a4 4 0 1 1-8 0c0-2 1-3 1-3s-3 2-3 6a6 6 0 1 0 12 0c0-5-6-11-6-11z" />
    </svg>
  );
}

export function HeartIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1L12 21l8.8-8.8a5 5 0 0 0 0-6.6z" />
    </svg>
  );
}

export function BarsIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V11M10 19V5M16 19v-7M22 19v-3" />
    </svg>
  );
}

export function BoltIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 2 4 14h6l-1 8 9-12h-6z" />
    </svg>
  );
}

export function CrownIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z" />
    </svg>
  );
}

export function StarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3l2.9 6.1L21 10l-5 4.5 1.4 6.5L12 17.8 6.6 21 8 14.5 3 10l6.1-.9z" />
    </svg>
  );
}

export function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5" />
    </svg>
  );
}

export function ChevLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function ChevRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}
```

- [ ] **Step 3.2: TypeScript 验证**

```bash
cd client && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3.3: Commit**

```bash
git add client/src/plaza/icons.tsx
git commit -m "feat(plaza): 抽出 SVG icons 到独立模块"
```

---

## Task 4: TopBar 组件

**Files:**
- Create: `client/src/plaza/TopBar.tsx`

- [ ] **Step 4.1: 新建 `client/src/plaza/TopBar.tsx`**

```tsx
import { SearchIcon, FilterIcon, PlusIcon, BellIcon } from "./icons";

type Props = {
  searchQuery: string;
  onSearchChange: (v: string) => void;
  onNewProject: () => void;
  onNotification: () => void;
};

export function TopBar({ searchQuery, onSearchChange, onNewProject, onNotification }: Props) {
  return (
    <header className="flex items-center gap-4">
      <h1 className="shrink-0 bg-gradient-to-r from-white to-white/55 bg-clip-text text-[22px] font-bold tracking-wide text-transparent">
        模型广场
      </h1>
      <div className="relative ml-6 flex-1">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/35" />
        <input
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索模型名称、功能或关键词"
          className="h-10 w-full rounded-full border border-white/[0.08] bg-white/[0.03] pl-10 pr-4 text-[13px] text-white placeholder:text-white/30 focus:border-white/20 focus:outline-none"
        />
      </div>
      <button className="flex h-10 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 text-[13px] text-white/75 hover:bg-white/[0.06]">
        <FilterIcon />
        筛选 / 排序
      </button>
      <button
        onClick={onNewProject}
        className="flex h-10 items-center gap-1.5 rounded-full bg-accent-foxo px-5 text-[13px] font-semibold text-black shadow-generate-glow hover:brightness-110"
      >
        <PlusIcon />
        新建项目
      </button>
      <button
        onClick={onNotification}
        className="relative grid h-10 w-10 place-items-center rounded-full border border-white/[0.08] bg-white/[0.03] text-white/75 hover:bg-white/[0.06]"
      >
        <BellIcon />
        <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-accent-ptext" />
      </button>
      <div
        className="h-10 w-10 rounded-full"
        style={{
          background:
            "conic-gradient(from 210deg,#9c3bff 0%,#ff6cb4 30%,#ffd13b 60%,#5ad8ff 90%,#9c3bff 100%)",
        }}
      />
    </header>
  );
}
```

- [ ] **Step 4.2: Commit**

```bash
git add client/src/plaza/TopBar.tsx
git commit -m "feat(plaza): 拆出 TopBar 组件"
```

---

## Task 5: HeroBanner 组件

**Files:**
- Create: `client/src/plaza/HeroBanner.tsx`

- [ ] **Step 5.1: 新建 `client/src/plaza/HeroBanner.tsx`**

```tsx
export function HeroBanner() {
  return (
    <section
      className="relative overflow-hidden rounded-[20px] border border-white/[0.06]"
      style={{
        background:
          "radial-gradient(80% 120% at 12% 30%, rgba(120,40,180,0.65) 0%, rgba(48,20,90,0.55) 35%, rgba(15,8,28,0.95) 75%)," +
          "linear-gradient(135deg,#1a0f33 0%,#0a0716 100%)",
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_75%_55%,rgba(255,170,40,0.18),transparent_45%),radial-gradient(circle_at_85%_30%,rgba(150,80,255,0.28),transparent_45%)]" />
      <HeroDecoration />
      <div className="relative z-10 flex h-[220px] flex-col justify-end px-8 py-7">
        <h2 className="text-[26px] font-bold tracking-wide text-white drop-shadow-[0_0_18px_rgba(180,120,255,0.45)]">
          探索高质量创作模型
        </h2>
        <p className="mt-2 text-[13px] text-white/55">
          覆盖图像生成、对话、多模态等能力，满足你的创作需求
        </p>
      </div>
    </section>
  );
}

function HeroDecoration() {
  return (
    <svg
      className="pointer-events-none absolute right-6 top-1/2 z-0 -translate-y-1/2"
      width="340"
      height="200"
      viewBox="0 0 340 200"
    >
      <defs>
        <linearGradient id="hero-g1" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#9c4bff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#2a0e55" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="hero-g2" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#5ab8ff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#0e2a55" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="hero-g3" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#ffb04b" stopOpacity="0.85" />
          <stop offset="1" stopColor="#552a0e" stopOpacity="0.85" />
        </linearGradient>
        <radialGradient id="hero-ring" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.6" stopColor="rgba(150,80,255,0)" />
          <stop offset="0.85" stopColor="rgba(255,180,80,0.45)" />
          <stop offset="1" stopColor="rgba(255,180,80,0)" />
        </radialGradient>
      </defs>
      <ellipse cx="170" cy="110" rx="160" ry="46" fill="url(#hero-ring)" />
      <g transform="translate(60 30) rotate(-8)">
        <rect width="60" height="60" rx="10" fill="url(#hero-g1)" stroke="#c79dff" strokeOpacity="0.5" />
        <text x="30" y="38" textAnchor="middle" fill="#fff" fontSize="22">★</text>
      </g>
      <g transform="translate(140 18) rotate(0)">
        <rect width="78" height="78" rx="12" fill="url(#hero-g2)" stroke="#9fd0ff" strokeOpacity="0.55" />
        <path d="M14 56 L34 36 L48 50 L64 30" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="56" cy="22" r="5" fill="#fff" />
      </g>
      <g transform="translate(238 38) rotate(8)">
        <rect width="60" height="60" rx="10" fill="url(#hero-g3)" stroke="#ffd29c" strokeOpacity="0.55" />
        <path d="M16 22 H44 V40 L34 50 H16 Z" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinejoin="round" />
      </g>
    </svg>
  );
}
```

- [ ] **Step 5.2: Commit**

```bash
git add client/src/plaza/HeroBanner.tsx
git commit -m "feat(plaza): 拆出 HeroBanner 组件，移除 Hero 内的 Filter 行"
```

---

## Task 6: FilterBar 组件（独立行）

**Files:**
- Create: `client/src/plaza/FilterBar.tsx`

- [ ] **Step 6.1: 新建 `client/src/plaza/FilterBar.tsx`**

```tsx
import { FILTERS, type FilterValue } from "./data";

type Props = {
  activeFilter: FilterValue;
  onFilterChange: (v: FilterValue) => void;
};

export function FilterBar({ activeFilter, onFilterChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {FILTERS.map((f) => (
        <button
          key={f}
          onClick={() => onFilterChange(f)}
          className={
            f === activeFilter
              ? "h-8 rounded-full bg-accent-foxo px-4 text-[12px] font-semibold text-black shadow-generate-glow"
              : "h-8 rounded-full border border-white/[0.12] bg-white/[0.04] px-4 text-[12px] text-white/70 hover:bg-white/[0.08]"
          }
        >
          {f}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 6.2: Commit**

```bash
git add client/src/plaza/FilterBar.tsx
git commit -m "feat(plaza): 新增 FilterBar 独立行组件"
```

---

## Task 7: Paginator 组件

**Files:**
- Create: `client/src/plaza/Paginator.tsx`

- [ ] **Step 7.1: 新建 `client/src/plaza/Paginator.tsx`**

```tsx
import { ChevLeftIcon, ChevRightIcon } from "./icons";

type Props = {
  page: number;
  total: number;
  onChange: (p: number) => void;
};

export function Paginator({ page, total, onChange }: Props) {
  const goto = (p: number) => onChange(Math.max(1, Math.min(total, p)));
  return (
    <nav className="mt-4 flex items-center justify-center gap-1.5 pb-4">
      <PageBtn onClick={() => goto(page - 1)} disabled={page === 1}>
        <ChevLeftIcon />
      </PageBtn>
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
        <PageBtn key={n} active={page === n} onClick={() => goto(n)}>
          {n}
        </PageBtn>
      ))}
      <PageBtn onClick={() => goto(page + 1)} disabled={page === total}>
        <ChevRightIcon />
      </PageBtn>
    </nav>
  );
}

function PageBtn({
  children,
  active,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={
        "grid h-8 min-w-8 place-items-center rounded-md border px-2 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-30 " +
        (active
          ? "border-accent-foxo/60 bg-accent-foxo/20 text-accent-foxo"
          : "border-white/[0.08] bg-white/[0.03] text-white/65 hover:bg-white/[0.08]")
      }
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 7.2: Commit**

```bash
git add client/src/plaza/Paginator.tsx
git commit -m "feat(plaza): 新增 Paginator 组件，边界处箭头禁用"
```

---

## Task 8: FeaturedGrid + FeaturedCard

**Files:**
- Create: `client/src/plaza/FeaturedGrid.tsx`
- Create: `client/src/plaza/FeaturedCard.tsx`

- [ ] **Step 8.1: 新建 `client/src/plaza/FeaturedCard.tsx`**

```tsx
import type { Featured } from "./types";
import { FlameIcon, HeartIcon, BarsIcon, BoltIcon, CrownIcon } from "./icons";

export function FeaturedCard({ card, onClick }: { card: Featured; onClick: () => void }) {
  const isFeatured = card.featured === true;
  return (
    <button
      onClick={onClick}
      type="button"
      className={
        "group relative h-[260px] overflow-hidden rounded-[16px] border text-left transition-all " +
        (isFeatured
          ? "border-accent-foxo/40 shadow-[0_0_0_1px_rgba(240,254,45,0.12),0_20px_60px_-20px_rgba(240,254,45,0.35)]"
          : "border-white/[0.06] hover:border-white/[0.16]")
      }
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
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
      {isFeatured && (
        <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-accent-ptext backdrop-blur-sm">
          <FlameIcon />
          热门推荐
        </div>
      )}
      {isFeatured && card.badge && (
        <div className="absolute right-3 top-[122px] z-10 flex items-center gap-1 rounded-md bg-accent-foxo px-2 py-1 text-[11px] font-bold text-black shadow-generate-glow">
          {card.badge}
          <CrownIcon />
        </div>
      )}
      {isFeatured && (
        <div className="pointer-events-none absolute inset-x-6 bottom-0 h-px bg-gradient-to-r from-transparent via-accent-foxo/70 to-transparent" />
      )}

      <div className="relative z-10 flex h-full flex-col justify-end p-4">
        <h4
          className="font-bold tracking-wide text-white drop-shadow-[0_0_14px_rgba(0,0,0,0.6)]"
          style={{
            fontSize: isFeatured ? 26 : 22,
            background: isFeatured
              ? "linear-gradient(90deg,#ff7af0 0%,#9b6cff 55%,#5fb0ff 100%)"
              : undefined,
            WebkitBackgroundClip: isFeatured ? "text" : undefined,
            WebkitTextFillColor: isFeatured ? "transparent" : undefined,
          }}
        >
          {card.title}
        </h4>
        <div className="mt-1.5">
          <Chip {...card.chip} />
        </div>
        <p className="mt-2 whitespace-pre-line text-[12px] leading-snug text-white/65">{card.desc}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/55">
          <Stat icon={<FlameIcon />} label="热度" value={card.stats.hot} />
          <Stat icon={<HeartIcon />} label="收藏" value={card.stats.fav} />
          {card.stats.calls && <Stat icon={<BarsIcon />} label="调用次数" value={card.stats.calls} />}
          <Stat icon={<BoltIcon />} label="响应速度" value={card.stats.speed} />
        </div>
      </div>
    </button>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded-[6px] border px-2 py-[2px] text-[11px]"
      style={{ color, borderColor: color + "55", backgroundColor: color + "1A" }}
    >
      {label}
    </span>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <span className="text-white/45">{icon}</span>
      <span className="text-white/45">{label}</span>
      <span className="font-semibold text-white/80">{value}</span>
    </span>
  );
}
```

- [ ] **Step 8.2: 新建 `client/src/plaza/FeaturedGrid.tsx`**

```tsx
import type { Featured } from "./types";
import { FeaturedCard } from "./FeaturedCard";

type Props = {
  items: Featured[];
  onCardClick: (card: Featured) => void;
};

export function FeaturedGrid({ items, onCardClick }: Props) {
  return (
    <section className="grid grid-cols-[1.42fr_1fr_1fr_1fr] gap-4 max-lg:grid-cols-2 max-md:grid-cols-1">
      {items.map((card) => (
        <FeaturedCard key={card.id} card={card} onClick={() => onCardClick(card)} />
      ))}
    </section>
  );
}
```

- [ ] **Step 8.3: Commit**

```bash
git add client/src/plaza/FeaturedGrid.tsx client/src/plaza/FeaturedCard.tsx
git commit -m "feat(plaza): 拆出 FeaturedGrid/FeaturedCard，第一张走金色高亮变体"
```

---

## Task 9: 重写 RecommendGrid + RecommendCard（本次最大改动）

**Files:**
- Create: `client/src/plaza/RecommendGrid.tsx`
- Create: `client/src/plaza/RecommendCard.tsx`

视觉规格（spec §5.5）：
- 容器 `aspect-[16/9]` 圆角 14px
- 背景 = `<img>` 铺满（或 fallbackBg 渐变）
- 顶层叠加 `from-black/85 via-black/40 to-transparent`
- 标题左下角，16px 粗白字
- 收藏 ⭐ 右上角，hover 金黄；stopPropagation
- hover 卡片 `scale-[1.02]` + 金色阴影
- 底部 hover 时 1px 浅金色细线

- [ ] **Step 9.1: 新建 `client/src/plaza/RecommendCard.tsx`**

```tsx
import type { Recommend } from "./types";
import { StarIcon, FlameIcon, BoltIcon } from "./icons";

type Props = {
  m: Recommend;
  onClick: () => void;
  onFavorite: () => void;
};

export function RecommendCard({ m, onClick, onFavorite }: Props) {
  return (
    <button
      onClick={onClick}
      type="button"
      className="group relative block aspect-[16/9] w-full overflow-hidden rounded-[14px] border border-white/[0.06] text-left transition-all hover:scale-[1.02] hover:border-accent-foxo/30 hover:shadow-[0_18px_36px_-12px_rgba(247,200,11,0.35)]"
      style={{ background: m.fallbackBg }}
    >
      {m.image && (
        <img
          src={m.image}
          alt={m.title}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
      <div className="pointer-events-none absolute inset-x-3 bottom-0 h-px bg-gradient-to-r from-transparent via-accent-foxo/70 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

      <span
        onClick={(e) => {
          e.stopPropagation();
          onFavorite();
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onFavorite();
          }
        }}
        className="absolute right-3 top-3 z-10 grid h-7 w-7 cursor-pointer place-items-center rounded-full bg-black/40 text-white/55 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-accent-foxo"
      >
        <StarIcon />
      </span>

      <div className="relative z-10 flex h-full flex-col justify-end p-3">
        <div className="mb-1">
          <Chip {...m.chip} />
        </div>
        <h5 className="text-[16px] font-bold tracking-wide text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">
          {m.title}
        </h5>
        <p className="mt-0.5 truncate text-[11px] text-white/65">{m.desc}</p>
        <div className="mt-1 flex items-center gap-3 text-[10.5px] text-white/55">
          <span className="flex items-center gap-1">
            <FlameIcon />
            {m.hot}
          </span>
          <span className="flex items-center gap-1">
            <BoltIcon />
            {m.speed}
          </span>
        </div>
      </div>
    </button>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded-[6px] border px-1.5 py-[1px] text-[10px]"
      style={{ color, borderColor: color + "55", backgroundColor: color + "26" }}
    >
      {label}
    </span>
  );
}
```

- [ ] **Step 9.2: 新建 `client/src/plaza/RecommendGrid.tsx`**

```tsx
import type { Recommend } from "./types";
import { RefreshIcon } from "./icons";
import { RecommendCard } from "./RecommendCard";

type Props = {
  items: Recommend[];
  onCardClick: (m: Recommend) => void;
  onFavorite: (m: Recommend) => void;
  onRefresh: () => void;
};

export function RecommendGrid({ items, onCardClick, onFavorite, onRefresh }: Props) {
  if (items.length === 0) {
    return (
      <section className="mt-1">
        <h3 className="text-[15px] font-semibold text-white">推荐模型</h3>
        <div className="mt-3 grid h-32 place-items-center rounded-[14px] border border-white/[0.04] bg-white/[0.02] text-[12px] text-white/45">
          暂无推荐
        </div>
      </section>
    );
  }
  return (
    <section className="mt-1">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold text-white">推荐模型</h3>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1 text-[12px] text-white/55 hover:text-white"
        >
          <RefreshIcon />
          换一批
        </button>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-md:grid-cols-1">
        {items.map((m) => (
          <RecommendCard
            key={m.id}
            m={m}
            onClick={() => onCardClick(m)}
            onFavorite={() => onFavorite(m)}
          />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 9.3: Commit**

```bash
git add client/src/plaza/RecommendGrid.tsx client/src/plaza/RecommendCard.tsx
git commit -m "feat(plaza): 重写推荐卡为纵向 16:9 大图封面卡（本次核心改动）"
```

---

## Task 10: 组装新 ModelPlaza.tsx 入口

**Files:**
- Modify: `client/src/ModelPlaza.tsx`（完整替换）

- [ ] **Step 10.1: 把 `client/src/ModelPlaza.tsx` 整体替换为以下内容**

```tsx
import { useState } from "react";
import { FEATURED, RECOMMEND, TOTAL_PAGES, type FilterValue } from "./plaza/data";
import { TopBar } from "./plaza/TopBar";
import { HeroBanner } from "./plaza/HeroBanner";
import { FilterBar } from "./plaza/FilterBar";
import { FeaturedGrid } from "./plaza/FeaturedGrid";
import { RecommendGrid } from "./plaza/RecommendGrid";
import { Paginator } from "./plaza/Paginator";

/**
 * 模型广场页面入口。
 * - 暗色 + 紫调氛围 + 电黄 CTA
 * - 旗舰 4 卡（第一张高亮）+ 推荐 4 卡（16:9 封面）+ 分页
 * - 所有点击交互暂仅 console.log
 */
export default function ModelPlaza() {
  const [activeFilter, setActiveFilter] = useState<FilterValue>("全部");
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div className="min-h-screen w-full bg-[#070708] text-white font-sans">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-5 px-8 py-6">
        <TopBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onNewProject={() => console.log("[plaza] new project")}
          onNotification={() => console.log("[plaza] notification")}
        />
        <HeroBanner />
        <FilterBar activeFilter={activeFilter} onFilterChange={setActiveFilter} />
        <FeaturedGrid
          items={FEATURED}
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
    </div>
  );
}
```

- [ ] **Step 10.2: TypeScript 验证**

```bash
cd client && npx tsc --noEmit 2>&1 | head -30
```

Expected: 没有错误。

- [ ] **Step 10.3: 启动 dev server，访问 `http://localhost:5173/#/plaza`**

```bash
cd client && npm run dev
```

打开浏览器，确认：
- 页面无 console.error
- 顶栏 / Hero / FilterBar / 4 旗舰卡 / 4 推荐卡 / 分页 都渲染
- 推荐卡为 **16:9 横版**（这是本次最关键的视觉验收）
- FilterBar 在 Hero **下方**而不是内部
- 点击各模型卡，console 有对应日志

- [ ] **Step 10.4: Commit**

```bash
git add client/src/ModelPlaza.tsx
git commit -m "refactor(plaza): 重写 ModelPlaza 入口为组装层，body 缩减到 ~50 行"
```

---

## Task 11: AI 生成 8 张素材并接入

**Files:**
- Create: `client/src/assets/plaza/featured-gpt.webp`
- Create: `client/src/assets/plaza/featured-banana.webp`
- Create: `client/src/assets/plaza/featured-nano.webp`
- Create: `client/src/assets/plaza/featured-pro.webp`
- Create: `client/src/assets/plaza/rec-vision.webp`
- Create: `client/src/assets/plaza/rec-dreamer.webp`
- Create: `client/src/assets/plaza/rec-chat.webp`
- Create: `client/src/assets/plaza/rec-multi.webp`
- Modify: `client/src/plaza/data.ts`（添加 import + image 字段）

- [ ] **Step 11.1: 调用 `draw-ui` skill，依次生成 8 张图**

prompts 参见 spec §8.2：

| 文件名 | Prompt | 尺寸 |
|---|---|---|
| featured-gpt | 紫色星云背景，神秘几何元素，cinematic lighting | 1024×768 |
| featured-banana | 暖橙色香蕉静物，电影感打光，深褐色背景 | 1024×768 |
| featured-nano | 翠绿色赛车，速度感模糊，黑色背景 | 1024×768 |
| featured-pro | 希腊雕塑头像特写，粉紫氛围光，戏剧感 | 1024×768 |
| rec-vision | 写实人像特写，深色背景，高清纤毫毕现 | 1024×576 |
| rec-dreamer | 梦幻超现实场景，紫色色调 | 1024×576 |
| rec-chat | 神秘 AI 拟人头像，青色光晕 | 1024×576 |
| rec-multi | 多模态视觉拼贴，文本/图像/音波交融 | 1024×576 |

- [ ] **Step 11.2: 用 sharp 或在线工具压缩到 webp**

旗舰图目标 ≤ 250KB，推荐图 ≤ 150KB。

放到：`D:/webProject/image2/client/src/assets/plaza/<filename>.webp`

- [ ] **Step 11.3: 修改 `client/src/plaza/data.ts`，在顶部加入 import + 给 FEATURED/RECOMMEND 每条加 `image` 字段**

在文件顶部加：

```ts
import gptImg from "../assets/plaza/featured-gpt.webp";
import bananaImg from "../assets/plaza/featured-banana.webp";
import nanoImg from "../assets/plaza/featured-nano.webp";
import proImg from "../assets/plaza/featured-pro.webp";
import visionImg from "../assets/plaza/rec-vision.webp";
import dreamerImg from "../assets/plaza/rec-dreamer.webp";
import chatImg from "../assets/plaza/rec-chat.webp";
import multiImg from "../assets/plaza/rec-multi.webp";
```

然后在 FEATURED 各对象中添加 `image: gptImg` / `image: bananaImg` 等；RECOMMEND 同理。

- [ ] **Step 11.4: 刷新浏览器，确认 8 张图都加载**

打开 DevTools Network 面板，确认 8 个 .webp 请求全部 200，无 404。
确认图片 + 黑色渐隐 + 文字叠加效果正常。

- [ ] **Step 11.5: Commit**

```bash
git add client/src/assets/plaza/ client/src/plaza/data.ts
git commit -m "feat(plaza): 接入 8 张 AI 生成的封面素材（旗舰 4 + 推荐 4）"
```

---

## Task 12: 浏览器集成验证（chrome-devtools MCP）

**Files:** 无修改，验证步骤

按 spec §7 验证清单逐项跑：

- [ ] **Step 12.1: 启动 dev server**

```bash
cd client && npm run dev
```

确认端口 5173 启动；如冲突，按 CLAUDE.md 杀进程：

```powershell
Get-NetTCPConnection -LocalPort 5173 | Select-Object -Expand OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }
```

- [ ] **Step 12.2: 用 chrome-devtools MCP 打开 `http://localhost:5173/#/plaza`**

调用 mcp__chrome-devtools__navigate_page。

- [ ] **Step 12.3: 视觉对照（spec §7.1）**

截图，对比设计图：
- 顶栏间距 / 搜索框宽度
- Hero 高 ~220px，无 Filter 行
- FilterBar 在 Hero 下方独立一行
- 4 旗舰卡比例 1.42:1:1:1，第一张金色高亮
- 推荐卡 16:9 横版（最关键）
- 分页器当前页金黄

- [ ] **Step 12.4: 交互验证（spec §7.2）**

- 点 filter chip，验证激活态切换
- 点分页 1→5，验证当前页切换；点第一页时 ← 灰；点第五页时 → 灰
- 点旗舰卡 / 推荐卡 / ⭐ / 新建项目 CTA / 通知，看 console 输出对应日志
- 点 ⭐ 时验证整卡 onClick 不被触发（stopPropagation）

- [ ] **Step 12.5: 响应式验证（spec §7.3）**

调 viewport 到 1440 / 1024 / 768 / 480，分别检查布局是否正常退化。

- [ ] **Step 12.6: 健壮性验证（spec §7.4）**

在 DevTools 里临时修改 `data.ts` 中某个 image import 为不存在的路径，确认渐变 fallback 生效，文字仍可读。还原。

确认整体无 console.error。

- [ ] **Step 12.7: 集成验证（spec §7.5）**

- 导航到 `http://localhost:5173/`（不带 hash），确认进入节点画布（App.tsx）正常
- 导航到 `http://localhost:5173/#/plaza`，确认进入广场
- 退出登录态后访问，确认 AuthGate 拦截

- [ ] **Step 12.8: （可选）补一次清理 commit**

如果验证过程中发现细节问题需要 hotfix，单独 commit：

```bash
git commit -m "fix(plaza): <具体修复>"
```

---

## Spec 覆盖自检

| Spec 章节 | 覆盖任务 |
|---|---|
| §3 文件结构 | Task 1–10（建出全部文件） |
| §4 数据 schema | Task 1 (types) + Task 2 (data) |
| §5.1 TopBar | Task 4 |
| §5.2 Hero | Task 5 |
| §5.3 FilterBar | Task 6 |
| §5.4 FeaturedCard | Task 8 |
| §5.5 RecommendCard | **Task 9（核心）** |
| §5.6 Paginator | Task 7 |
| §6 交互 / 边界 / 回退 | Task 9 (stopPropagation) + Task 7 (disabled) + Task 8/9 (onError fallback) + Task 10 (state) |
| §7 验证清单 | Task 12 |
| §8 素材接入 | Task 11 |
| §9 实施顺序 | 本计划全部 |

无遗漏。

---

**Plan complete and saved to `docs/plans/2026-05-18-model-plaza-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — 我每个 task 派一个 fresh subagent，task 之间我做 review；优点：上下文隔离、能逐步质检每段输出；缺点：略多往返。

**2. Inline Execution** — 我在当前会话直接连续执行多个 task，按 checkpoint 拆分让你审；优点：快；缺点：上下文压力大，到后期可能模糊。

**Which approach?**
