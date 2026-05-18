import type { ReactNode } from "react";
import type { Featured } from "./types";
import { FlameIcon, HeartIcon, BarsIcon, BoltIcon, CrownIcon } from "./icons";

// 旗舰卡：260px 高，背景为 webp 铺满 + 底部黑色渐隐。
// 第一张走金色高亮 + 左上"热门推荐"胶囊 + 右上"旗舰模型 👑"角标 + 底部金色细线。

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
      {isFeatured && (
        <div className="pointer-events-none absolute inset-x-6 bottom-0 h-px bg-gradient-to-r from-transparent via-accent-foxo/70 to-transparent" />
      )}

      {/* 内容：顶部 title + chip + desc；底部 stats，靠 mt-auto 推到底 */}
      <div className="relative z-10 flex h-full flex-col p-4 pt-12">
        <h4
          className="font-bold tracking-wide text-white drop-shadow-[0_0_14px_rgba(0,0,0,0.6)]"
          style={{
            fontSize: isFeatured ? 30 : 22,
            lineHeight: 1.05,
            background: isFeatured
              ? "linear-gradient(90deg,#ff7af0 0%,#9b6cff 55%,#5fb0ff 100%)"
              : undefined,
            WebkitBackgroundClip: isFeatured ? "text" : undefined,
            WebkitTextFillColor: isFeatured ? "transparent" : undefined,
          }}
        >
          {card.title}
        </h4>
        <div className="mt-2">
          <Chip {...card.chip} />
        </div>
        <p className="mt-2 whitespace-pre-line text-[12px] leading-snug text-white/70 drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)]">
          {card.desc}
        </p>
        {/* 旗舰角标紧贴 desc 右下方（仅 featured） */}
        {isFeatured && card.badge && (
          <div className="mt-2 self-end flex items-center gap-1 rounded-md bg-accent-foxo px-2 py-1 text-[11px] font-bold text-black shadow-generate-glow">
            {card.badge}
            <CrownIcon />
          </div>
        )}
        {/* stats 行靠 mt-auto 推到底部 */}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-[11px] text-white/65">
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

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <span className="text-white/45">{icon}</span>
      <span className="text-white/45">{label}</span>
      <span className="font-semibold text-white/80">{value}</span>
    </span>
  );
}
