import { forwardRef } from "react";
import { PLAZA_GLASS_RADIUS, PLAZA_INNER_PADDING, PLAZA_INNER_RADIUS } from "./constants";

// Hero：嵌套式液态玻璃壳（外层等待全局 LiquidGlass 注入 WebGL 渲染）+ 内层 #1E1E22 实色灰矩形。
// 圆角嵌套规则：内层 = 外层 − padding（几何同心），见 constants.ts。
// 左侧标题 + 副标题 + 路径，右侧三栏统计（在线模型 / 你的收藏 / 本周热门），数字 tabular-nums。
// 对齐 DESIGN.md：不允许紫调 radial-gradient / 3D 装饰 SVG / 16px+ 营销标题。

export const HeroBanner = forwardRef<HTMLDivElement>(function HeroBanner(_props, ref) {
  return (
    <section
      ref={ref}
      className="relative overflow-hidden"
      style={{
        borderRadius: PLAZA_GLASS_RADIUS,
        // 外层完全透明：全屏 LiquidGlass canvas 在此位置渲染 WebGL 玻璃，
        // 透过 padding 形成玻璃边框；canvas 在 ModelPlaza 之下，
        // 这里必须保持 background 透明才能让 canvas 透出来。
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
          <h1 className="text-[22px] font-medium leading-none tracking-[-0.01em] text-white/95">
            模型广场
          </h1>
          <p className="mt-2 text-[13px] text-white/64">
            探索高质量创作模型 · 覆盖图像生成 / 对话 / 多模态
          </p>
          <p className="mt-1.5 text-[11px] tracking-wider text-white/40">
            首页 / 模型广场
          </p>
        </div>
        <div className="flex items-center gap-7 pr-2">
          <HeroStat label="在线模型" value="247" trend="+12 本周" trendClass="text-[#7CE38B]" />
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
      className={`flex min-w-[110px] flex-col gap-1.5 ${divider ? "border-l border-white/[0.08] pl-7" : ""}`}
    >
      <span className="text-[11px] tracking-wider text-white/40">{label}</span>
      <span className="text-[22px] font-medium leading-none tabular-nums text-white/95">
        {value}
      </span>
      <span className={`text-[11px] tracking-wider ${trendClass}`}>{trend}</span>
    </div>
  );
}
