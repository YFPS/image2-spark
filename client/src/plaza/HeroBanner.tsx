// Hero 大幅紫调横幅：标题 + 副标题 + 右侧 3D 装饰 SVG。
// 不含 Filter 行（已迁出到独立 FilterBar）。

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
