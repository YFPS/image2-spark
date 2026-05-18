import type { Recommend } from "./types";
import { StarIcon, FlameIcon, BoltIcon } from "./icons";
import { PLAZA_GLASS_RADIUS, PLAZA_INNER_PADDING, PLAZA_INNER_RADIUS } from "./constants";

// 推荐卡：嵌套式 16:9 横版。
// 外层透明壳（CSS 玻璃，非 WebGL）padding 10，内层透明 + 上图下文双层。
// 上半作品图占 ~58% 高，下半信息区占 ~42%，背景透明让画布辉光雾透出，呈"炫彩"。
// 右上角收藏 ⭐ stopPropagation。
// 圆角嵌套规则同旗舰卡：内层 = 外层 − padding。

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
      className="group relative block w-full aspect-[16/9] overflow-hidden text-left transition-colors"
      style={{
        borderRadius: PLAZA_GLASS_RADIUS,
        background: "transparent",
        padding: PLAZA_INNER_PADDING,
      }}
    >
      <div
        className="flex h-full flex-col overflow-hidden border border-white/[0.06] bg-transparent transition-colors group-hover:border-white/[0.22]"
        style={{ borderRadius: PLAZA_INNER_RADIUS }}
      >
        {/* 作品图区（保留 fallbackBg 作占位） */}
        <div
          className="relative h-[58%] w-full overflow-hidden"
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
          {/* 右上角收藏 ⭐：浮在作品图上，玻璃风格 */}
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
            className="absolute right-2.5 top-2.5 z-10 grid h-7 w-7 cursor-pointer place-items-center rounded-full border border-white/[0.12] bg-[#1c1c2099] text-white/70 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-[18px] transition-colors hover:bg-white/[0.08] hover:text-accent-foxo"
          >
            <StarIcon />
          </span>
        </div>

        {/* 文字区：透明让 WebGL 辉光透出，text-shadow 保证可读 */}
        <div className="flex min-h-0 flex-1 flex-col justify-center px-3 [&_*]:[text-shadow:0_1px_4px_rgba(0,0,0,0.6)]">
          <div className="flex items-center gap-2">
            <Chip label={m.chip.label} color={m.chip.color} />
            <span className="ml-auto flex items-center gap-2.5 text-[10.5px] tabular-nums text-white/55">
              <span className="flex items-center gap-0.5">
                <FlameIcon />
                {m.hot}
              </span>
              <span className="flex items-center gap-0.5">
                <BoltIcon />
                {m.speed}
              </span>
            </span>
          </div>
          <h5 className="mt-1 text-[14px] font-medium tracking-tight text-white/95">
            {m.title}
          </h5>
          <p className="truncate text-[11px] text-white/70">{m.desc}</p>
        </div>
      </div>
    </button>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  // chip 颜色由 data.ts 提供，已映射到 port 语义色（蓝/绿/粉）。
  return (
    <span
      className="inline-flex items-center rounded-[6px] border px-1.5 py-[1px] text-[10px] font-medium leading-none"
      style={{ color, borderColor: color + "66", backgroundColor: color + "26" }}
    >
      {label}
    </span>
  );
}
