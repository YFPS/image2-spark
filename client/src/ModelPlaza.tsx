import { useState } from "react";

/**
 * 模型广场页面：暗色 + 紫调氛围 + 电黄 CTA。
 * 旗舰 4 卡 + 推荐 4 卡 + 分页。
 * 真实素材请替换 FEATURED[*].bg 与 RECOMMEND[*].thumb。
 */

// 顶部 hero 与卡片所需的占位渐变（无真实素材时的兜底视觉）。
const FEATURED = [
  {
    title: "GPT IMAGE2",
    chip: { label: "图像生成", color: "#A78BFA" },
    desc: "新一代图像生成模型，细节出众，创意无限。",
    stats: { hot: "98.7K", fav: "23.6K", calls: "1.2M", speed: "1.2s" },
    featured: true,
    badge: "旗舰模型",
    bg:
      "radial-gradient(120% 90% at 70% 35%, #6b3bd6 0%, #2a164d 35%, #050310 75%)," +
      "radial-gradient(60% 80% at 25% 80%, rgba(99,102,241,0.45), transparent 65%)",
  },
  {
    title: "BANANA",
    chip: { label: "对话模型", color: "#67E8F9" },
    desc: "轻松有趣的对话体验，\n你的创意好伙伴。",
    stats: { hot: "68.4K", fav: "12.1K", speed: "0.8s" },
    bg:
      "radial-gradient(110% 90% at 75% 30%, #f7c948 0%, #6c4413 40%, #0b0708 80%)," +
      "radial-gradient(60% 80% at 25% 80%, rgba(247,176,91,0.30), transparent 65%)",
  },
  {
    title: "NANO",
    chip: { label: "高速模型", color: "#7CE38B" },
    desc: "超快响应，低延迟输出，\n适合高频创作场景。",
    stats: { hot: "41.2K", fav: "8.7K", speed: "0.3s" },
    bg:
      "radial-gradient(110% 90% at 70% 35%, #1e90ff 0%, #142a55 40%, #06070d 80%)," +
      "radial-gradient(60% 80% at 25% 85%, rgba(99,179,255,0.30), transparent 65%)",
  },
  {
    title: "PRO",
    chip: { label: "专业版", color: "#F0FE2D" },
    desc: "专业级创作模型，\n满足高标准输出需求。",
    stats: { hot: "32.8K", fav: "6.3K", speed: "1.6s" },
    bg:
      "radial-gradient(110% 90% at 70% 30%, #b1b5bf 0%, #3b3d49 45%, #0a0a10 80%)," +
      "radial-gradient(60% 80% at 25% 85%, rgba(160,170,200,0.25), transparent 65%)",
  },
] as const;

const RECOMMEND = [
  {
    title: "VISION XL",
    chip: { label: "图像生成", color: "#A78BFA" },
    desc: "超清图像生成，支持复杂场景渲染。",
    hot: "28.1K",
    speed: "1.4s",
    thumb: "linear-gradient(135deg,#2a5b8e 0%,#0f1f33 60%,#070a13 100%)",
  },
  {
    title: "DREAMER",
    chip: { label: "图像生成", color: "#A78BFA" },
    desc: "艺术风格多样，激发无限想象。",
    hot: "19.7K",
    speed: "1.8s",
    thumb: "linear-gradient(135deg,#7a4cb7 0%,#2a1748 60%,#0a0612 100%)",
  },
  {
    title: "CHAT MASTER",
    chip: { label: "对话模型", color: "#67E8F9" },
    desc: "强大对话理解，精准回答各类问题。",
    hot: "17.3K",
    speed: "0.7s",
    thumb: "linear-gradient(135deg,#1f8e8e 0%,#0e2a3c 60%,#06121a 100%)",
  },
  {
    title: "MULTI MODAL",
    chip: { label: "多模态", color: "#FF7E87" },
    desc: "文本、图像、语音多模态理解。",
    hot: "15.6K",
    speed: "1.1s",
    thumb: "linear-gradient(135deg,#a44ad6 0%,#3b1755 60%,#0c0716 100%)",
  },
];

const FILTERS = ["全部", "图像生成", "对话模型", "多模态", "专业版"];

export default function ModelPlaza() {
  const [activeFilter, setActiveFilter] = useState("全部");
  const [page, setPage] = useState(1);

  return (
    <div className="min-h-screen w-full bg-[#070708] text-white font-sans">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-5 px-8 py-6">
        {/* 顶栏 */}
        <header className="flex items-center gap-4">
          <h1 className="shrink-0 bg-gradient-to-r from-white to-white/55 bg-clip-text text-[22px] font-bold tracking-wide text-transparent">
            模型广场
          </h1>
          <div className="relative ml-6 flex-1">
            <SearchIcon className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/35" />
            <input
              placeholder="搜索模型名称、功能或关键词"
              className="h-10 w-full rounded-full border border-white/[0.08] bg-white/[0.03] pl-10 pr-4 text-[13px] text-white placeholder:text-white/30 focus:border-white/20 focus:outline-none"
            />
          </div>
          <button className="flex h-10 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 text-[13px] text-white/75 hover:bg-white/[0.06]">
            <FilterIcon />
            筛选 / 排序
          </button>
          <button className="flex h-10 items-center gap-1.5 rounded-full bg-accent-foxo px-5 text-[13px] font-semibold text-black shadow-[0_0_24px_rgba(240,254,45,0.35)] hover:brightness-110">
            <PlusIcon />
            新建项目
          </button>
          <button className="relative grid h-10 w-10 place-items-center rounded-full border border-white/[0.08] bg-white/[0.03] text-white/75 hover:bg-white/[0.06]">
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

        {/* Hero */}
        <section
          className="relative overflow-hidden rounded-[20px] border border-white/[0.06]"
          style={{
            background:
              "radial-gradient(80% 120% at 12% 30%, rgba(120,40,180,0.65) 0%, rgba(48,20,90,0.55) 35%, rgba(15,8,28,0.95) 75%)," +
              "linear-gradient(135deg,#1a0f33 0%,#0a0716 100%)",
          }}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_75%_55%,rgba(255,170,40,0.18),transparent_45%),radial-gradient(circle_at_85%_30%,rgba(150,80,255,0.28),transparent_45%)]" />
          {/* 右侧 3D 装饰（占位 SVG 立方组） */}
          <HeroDecoration />
          <div className="relative z-10 flex h-[220px] flex-col justify-between px-8 py-7">
            <div>
              <h2 className="text-[26px] font-bold tracking-wide text-white drop-shadow-[0_0_18px_rgba(180,120,255,0.45)]">
                探索高质量创作模型
              </h2>
              <p className="mt-2 text-[13px] text-white/55">
                覆盖图像生成、对话、多模态等能力，满足你的创作需求
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setActiveFilter(f)}
                  className={
                    f === activeFilter
                      ? "h-8 rounded-full bg-accent-foxo px-4 text-[12px] font-semibold text-black shadow-[0_0_18px_rgba(240,254,45,0.4)]"
                      : "h-8 rounded-full border border-white/[0.12] bg-white/[0.04] px-4 text-[12px] text-white/70 hover:bg-white/[0.08]"
                  }
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* 旗舰 4 卡 */}
        <section className="grid grid-cols-[1.42fr_1fr_1fr_1fr] gap-4">
          {FEATURED.map((card) => (
            <FeaturedCard key={card.title} card={card} />
          ))}
        </section>

        {/* 推荐模型 */}
        <section className="mt-1">
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-semibold text-white">推荐模型</h3>
            <button className="flex items-center gap-1 text-[12px] text-white/55 hover:text-white">
              <RefreshIcon />
              换一批
            </button>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-4">
            {RECOMMEND.map((m) => (
              <RecommendCard key={m.title} m={m} />
            ))}
          </div>
        </section>

        {/* 分页 */}
        <nav className="mt-4 flex items-center justify-center gap-1.5 pb-4">
          <PageBtn onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevLeftIcon />
          </PageBtn>
          {[1, 2, 3, 4, 5].map((n) => (
            <PageBtn key={n} active={page === n} onClick={() => setPage(n)}>
              {n}
            </PageBtn>
          ))}
          <PageBtn onClick={() => setPage((p) => Math.min(5, p + 1))}>
            <ChevRightIcon />
          </PageBtn>
        </nav>
      </div>
    </div>
  );
}

/* ─────────── 卡片 ─────────── */

function FeaturedCard({ card }: { card: (typeof FEATURED)[number] }) {
  const isFeatured = "featured" in card && card.featured;
  return (
    <article
      className={
        "group relative h-[260px] overflow-hidden rounded-[16px] border transition-all " +
        (isFeatured
          ? "border-accent-foxo/40 shadow-[0_0_0_1px_rgba(240,254,45,0.12),0_20px_60px_-20px_rgba(240,254,45,0.35)]"
          : "border-white/[0.06] hover:border-white/[0.16]")
      }
      style={{ background: card.bg }}
    >
      {/* 底部黑色渐隐保证字可读 */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
      {/* 顶部热门胶囊（仅 GPT IMAGE2） */}
      {isFeatured && (
        <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-accent-ptext backdrop-blur-sm">
          <FlameIcon />
          热门推荐
        </div>
      )}
      {/* 旗舰角标 */}
      {isFeatured && (
        <div className="absolute right-3 top-[122px] z-10 flex items-center gap-1 rounded-md bg-accent-foxo px-2 py-1 text-[11px] font-bold text-black shadow-[0_0_18px_rgba(240,254,45,0.45)]">
          {card.badge}
          <CrownIcon />
        </div>
      )}
      {/* 底部电黄发丝（仅旗舰） */}
      {isFeatured && (
        <div className="pointer-events-none absolute inset-x-6 bottom-0 h-px bg-gradient-to-r from-transparent via-accent-foxo/70 to-transparent" />
      )}

      <div className="relative z-10 flex h-full flex-col justify-between p-4">
        <div className="flex-1" />
        <div>
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
          <p className="mt-2 whitespace-pre-line text-[12px] leading-snug text-white/65">
            {card.desc}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/55">
            <Stat icon={<FlameIcon />} label="热度" value={card.stats.hot} />
            <Stat icon={<HeartIcon />} label="收藏" value={card.stats.fav} />
            {"calls" in card.stats && (
              <Stat icon={<BarsIcon />} label="调用次数" value={card.stats.calls} />
            )}
            <Stat icon={<BoltIcon />} label="响应速度" value={card.stats.speed} />
          </div>
        </div>
      </div>
    </article>
  );
}

function RecommendCard({ m }: { m: (typeof RECOMMEND)[number] }) {
  return (
    <article className="group flex h-[96px] gap-3 rounded-[14px] border border-white/[0.06] bg-white/[0.025] p-3 transition-all hover:border-white/[0.16] hover:bg-white/[0.05]">
      <div
        className="h-[72px] w-[72px] shrink-0 rounded-[10px] border border-white/[0.06]"
        style={{ background: m.thumb }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2">
          <h5 className="truncate text-[13px] font-semibold text-white">{m.title}</h5>
          <button className="text-white/35 hover:text-accent-foxo">
            <StarIcon />
          </button>
        </div>
        <div className="mt-1">
          <Chip {...m.chip} small />
        </div>
        <p className="mt-1 truncate text-[11px] text-white/45">{m.desc}</p>
        <div className="mt-1 flex items-center gap-3 text-[10.5px] text-white/45">
          <span className="flex items-center gap-1">
            <FlameIcon />
            热度 {m.hot}
          </span>
          <span className="flex items-center gap-1">
            <BoltIcon />
            响应速度 {m.speed}
          </span>
        </div>
      </div>
    </article>
  );
}

/* ─────────── 小元素 ─────────── */

function Chip({ label, color, small }: { label: string; color: string; small?: boolean }) {
  return (
    <span
      className={
        "inline-flex items-center rounded-[6px] border " +
        (small ? "px-1.5 py-[1px] text-[10px]" : "px-2 py-[2px] text-[11px]")
      }
      style={{
        color,
        borderColor: color + "55",
        backgroundColor: color + "1A",
      }}
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

function PageBtn({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "grid h-8 min-w-8 place-items-center rounded-md border px-2 text-[12px] transition-colors " +
        (active
          ? "border-accent-foxo/60 bg-accent-foxo/20 text-accent-foxo"
          : "border-white/[0.08] bg-white/[0.03] text-white/65 hover:bg-white/[0.08]")
      }
    >
      {children}
    </button>
  );
}

function HeroDecoration() {
  // 三个发光"玻璃方块"占位（无真实素材时的兜底）
  return (
    <svg
      className="pointer-events-none absolute right-6 top-1/2 z-0 -translate-y-1/2"
      width="340"
      height="200"
      viewBox="0 0 340 200"
    >
      <defs>
        <linearGradient id="g1" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#9c4bff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#2a0e55" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="g2" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#5ab8ff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#0e2a55" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="g3" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#ffb04b" stopOpacity="0.85" />
          <stop offset="1" stopColor="#552a0e" stopOpacity="0.85" />
        </linearGradient>
        <radialGradient id="ring" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.6" stopColor="rgba(150,80,255,0)" />
          <stop offset="0.85" stopColor="rgba(255,180,80,0.45)" />
          <stop offset="1" stopColor="rgba(255,180,80,0)" />
        </radialGradient>
      </defs>
      <ellipse cx="170" cy="110" rx="160" ry="46" fill="url(#ring)" />
      <g transform="translate(60 30) rotate(-8)">
        <rect width="60" height="60" rx="10" fill="url(#g1)" stroke="#c79dff" strokeOpacity="0.5" />
        <text x="30" y="38" textAnchor="middle" fill="#fff" fontSize="22">★</text>
      </g>
      <g transform="translate(140 18) rotate(0)">
        <rect width="78" height="78" rx="12" fill="url(#g2)" stroke="#9fd0ff" strokeOpacity="0.55" />
        <path
          d="M14 56 L34 36 L48 50 L64 30"
          stroke="#fff"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="56" cy="22" r="5" fill="#fff" />
      </g>
      <g transform="translate(238 38) rotate(8)">
        <rect width="60" height="60" rx="10" fill="url(#g3)" stroke="#ffd29c" strokeOpacity="0.55" />
        <path
          d="M16 22 H44 V40 L34 50 H16 Z"
          stroke="#fff"
          strokeWidth="2.5"
          fill="none"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

/* ─────────── 内联 SVG 图标（避免新增依赖） ─────────── */

function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
function FilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h18M6 12h12M10 19h4" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 1 1 12 0v5l1.5 3h-15L6 13z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}
function FlameIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2s4 4 4 8a4 4 0 1 1-8 0c0-2 1-3 1-3s-3 2-3 6a6 6 0 1 0 12 0c0-5-6-11-6-11z" />
    </svg>
  );
}
function HeartIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1L12 21l8.8-8.8a5 5 0 0 0 0-6.6z" />
    </svg>
  );
}
function BarsIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V11M10 19V5M16 19v-7M22 19v-3" />
    </svg>
  );
}
function BoltIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 2 4 14h6l-1 8 9-12h-6z" />
    </svg>
  );
}
function CrownIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z" />
    </svg>
  );
}
function StarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3l2.9 6.1L21 10l-5 4.5 1.4 6.5L12 17.8 6.6 21 8 14.5 3 10l6.1-.9z" />
    </svg>
  );
}
function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5" />
    </svg>
  );
}
function ChevLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
function ChevRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}
