import type { Recommend } from "./types";
import { StarIcon, FlameIcon, BoltIcon } from "./icons";

// 推荐卡（本次最大改动）：16:9 纵向封面 + 底部黑色玻璃膜 + 白字。
// 右上角收藏 ⭐ stopPropagation；hover 时 scale-[1.02] + 金色阴影 + 底部金色细线。

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
