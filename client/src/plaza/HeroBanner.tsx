import { forwardRef } from "react";
import type { ModelPageStats } from "./data";
import { PLAZA_GLASS_RADIUS, PLAZA_INNER_PADDING, PLAZA_INNER_RADIUS } from "./constants";

type Props = {
  stats: ModelPageStats;
};

export const HeroBanner = forwardRef<HTMLDivElement, Props>(function HeroBanner(
  { stats },
  ref,
) {
  return (
    <section
      ref={ref}
      className="relative overflow-hidden"
      style={{
        borderRadius: PLAZA_GLASS_RADIUS,
        background: "transparent",
        height: 160,
        padding: PLAZA_INNER_PADDING,
      }}
    >
      <div
        className="flex h-full items-stretch border border-white/[0.06] bg-transparent px-7 [&_*]:[text-shadow:0_1px_4px_rgba(0,0,0,0.55)]"
        style={{ borderRadius: PLAZA_INNER_RADIUS }}
      >
        <div className="flex flex-1 flex-col justify-center">
          <h1 className="text-[22px] font-medium leading-none tracking-normal text-white/95">
            模型广场
          </h1>
          <p className="mt-2 text-[13px] text-white/64">
            当前已接入的图像生成模型
          </p>
          <p className="mt-1.5 text-[11px] tracking-wider text-white/40">
            首页 / 模型广场
          </p>
        </div>
        <div className="flex items-center gap-7 pr-2">
          <HeroStat
            label="可用模型"
            value={String(stats.enabledModels)}
            trend={stats.defaultModel}
            trendClass="text-[#D7FF00]"
          />
          <HeroStat
            label="模型状态"
            value={stats.status}
            trend="按模型切换"
            divider
          />
          <HeroStat
            label="能力"
            value={stats.capabilities.includes("图生图") ? "2" : "1"}
            trend={stats.capabilities}
            divider
          />
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
      className={`flex min-w-[110px] flex-col gap-1.5 ${divider ? "border-l border-white/[0.08] pl-7" : ""}`}
    >
      <span className="text-[11px] tracking-wider text-white/40">{label}</span>
      <span className="text-[22px] font-medium leading-none tracking-normal tabular-nums text-white/95">
        {value}
      </span>
      <span className={`text-[11px] tracking-wider ${trendClass}`}>{trend}</span>
    </div>
  );
}
