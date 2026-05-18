import { forwardRef, type ReactNode } from "react";
import type { Featured } from "./types";
import { FlameIcon, HeartIcon, BarsIcon, BoltIcon } from "./icons";
import { PLAZA_GLASS_RADIUS, PLAZA_INNER_PADDING, PLAZA_INNER_RADIUS } from "./constants";

// FeaturedCard：嵌套式液态玻璃壳（外层待全局 LiquidGlass 注入 WebGL 渲染）+ 内层 #1E1E22 灰矩形。
// 内层上半部 132px 是作品图占满宽度，下半部是 #1E1E22 实色文字区。
// 圆角嵌套规则：内层 = 外层 − padding（几何同心），见 constants.ts。
// 第一张 trending：右上电黄空心徽章（无填充无 box-shadow 发光），不是金色边框。
// 对齐 DESIGN.md：去掉金色边框 / 渐变标题 / 全图背景 / 渐隐叠层。

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
      className="group relative h-[240px] w-full overflow-hidden text-left"
      style={{
        borderRadius: PLAZA_GLASS_RADIUS,
        // 外层完全透明：全屏 LiquidGlass canvas 在此位置渲染 WebGL 玻璃，
        // 透过 padding 形成玻璃边框；canvas 在 ModelPlaza 之下，
        // background 必须透明才能透出 WebGL。
        background: "transparent",
        padding: PLAZA_INNER_PADDING,
      }}
    >
      {isFeatured && (
        <div className="absolute right-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-[11px] border border-accent-foxo bg-accent-foxo/[0.08] px-2.5 py-1 text-[10px] font-medium tracking-[0.04em] text-accent-foxo">
          <span className="inline-block h-2 w-2 rounded-full border-[1.5px] border-accent-foxo" />
          trending
        </div>
      )}

      <div
        className="flex h-[220px] flex-col overflow-hidden border border-white/[0.06] bg-transparent"
        style={{ borderRadius: PLAZA_INNER_RADIUS }}
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

        <div className="flex min-h-0 flex-1 flex-col px-3.5 pt-3 [&_h4]:[text-shadow:0_1px_4px_rgba(0,0,0,0.7)] [&_p]:[text-shadow:0_1px_3px_rgba(0,0,0,0.65)] [&_div>span]:[text-shadow:0_1px_3px_rgba(0,0,0,0.65)]">
          <h4 className="text-[14px] font-medium leading-none tracking-[-0.01em] text-white/95">
            {card.title}
          </h4>
          <Chip label={card.chip.label} color={card.chip.color} />
          <p className="mt-1.5 line-clamp-1 text-[11px] leading-snug text-white/70">
            {card.desc.replace(/\n/g, " · ")}
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1 pb-3 text-[11px] tabular-nums tracking-wider text-white/55">
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
  // chip 颜色由 data.ts 提供，已映射到 port 语义色（蓝/绿/粉/灰白）。
  // 若是灰白色（"rgba(255,255,255,...)"），border / bg 用同色加 alpha；text 直接用同色。
  const isGray = color.startsWith("rgba");
  return (
    <span
      className="mt-2 inline-flex w-fit items-center rounded-[4px] border px-1.5 py-[2px] text-[10px] font-medium leading-none"
      style={{
        color,
        borderColor: isGray ? "rgba(255,255,255,0.18)" : color + "66",
        backgroundColor: isGray ? "rgba(255,255,255,0.06)" : color + "26",
      }}
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
