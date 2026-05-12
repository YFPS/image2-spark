/**
 * 液态玻璃实时调节面板 —— 移植自 liquid-glass-studio/Controls.tsx，
 * 但不依赖 Leva：用项目自家的灰卡风格（#1e1e22 + hairline + Outfit）。
 *
 * 形态：
 *  - 收起态：左侧居中悬浮胶囊按钮（⚙ Glass），点击展开
 *  - 展开态：左侧滑出面板（280px 宽，#1e1e22 灰卡），分组折叠 + 滑块
 *  - 不参与 LiquidGlass 渲染（不创建新玻璃形状），避免 shader 成本与视觉干扰
 *
 * 持久化：参数写入 localStorage("image2.glass.params")，刷新保留。
 */
import { useEffect, useState, type ReactNode, type CSSProperties } from "react";

/* ---------- 参数定义 ---------- */
export type GlassParams = {
  // 折射
  refThickness: number;
  refFactor: number;
  refDispersion: number;
  // 菲涅尔
  refFresnelRange: number;
  refFresnelHardness: number; // 0..100 → 实际 /100
  refFresnelFactor: number;   // 0..100 → 实际 /100
  // 斜向高光
  glareRange: number;
  glareHardness: number;      // 0..100 → /100
  glareConvergence: number;   // 0..100 → /100
  glareOppositeFactor: number; // 0..100 → /100
  glareFactor: number;
  glareAngle: number;         // -180..180 度
  // 模糊
  blurRadius: number;         // 1..30（>30 会明显掉帧）
  blurEdge: boolean;
  // 形状
  shapeRoundness: number;     // 2..7
  // 投影
  shadowExpand: number;
  shadowFactor: number;       // 0..100 → /100
  shadowPositionX: number;    // -20..20
  shadowPositionY: number;    // -20..20
  // 染色
  tintR: number; tintG: number; tintB: number; // 0..255
  tintA: number;              // 0..100 → /100
};

// 调谐目标：参考图风格 —— 明亮的环形菲涅尔高光 + 明显下投影 + 内部偏暗
export const DEFAULT_GLASS_PARAMS: GlassParams = {
  refThickness: 20,
  refFactor: 1.4,
  refDispersion: 7,
  refFresnelRange: 30,
  refFresnelHardness: 20,
  refFresnelFactor: 20,
  glareRange: 30,
  glareHardness: 20,
  glareConvergence: 50,
  glareOppositeFactor: 80,
  glareFactor: 0,
  glareAngle: -45,
  blurRadius: 1,
  blurEdge: true,
  shapeRoundness: 2.5,
  shadowExpand: 25,
  shadowFactor: 15,
  shadowPositionX: 0,
  shadowPositionY: -10,
  tintR: 255, tintG: 255, tintB: 255, tintA: 0,
};

const STORAGE_KEY = "image2.glass.params.v02";

export function loadStoredParams(): GlassParams {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_GLASS_PARAMS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_GLASS_PARAMS, ...parsed };
  } catch {
    return { ...DEFAULT_GLASS_PARAMS };
  }
}

/* ---------- 主组件 ---------- */
export function GlassControls({
  params,
  onChange,
}: {
  params: GlassParams;
  onChange: (next: GlassParams) => void;
}) {
  const [open, setOpen] = useState(false);

  // 写入 localStorage（节流靠 React 自身 diff 已经够用，参数变化频率不高）
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
    } catch {
      // 忽略隐私模式 / 配额溢出
    }
  }, [params]);

  const set = <K extends keyof GlassParams>(k: K, v: GlassParams[K]) =>
    onChange({ ...params, [k]: v });

  return (
    <>
      {/* 收起态胶囊按钮 —— 左侧居中悬浮 */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="打开液态玻璃调节面板"
          className="fixed left-3 top-1/2 z-40 flex -translate-y-1/2 items-center gap-2 rounded-full border border-white/[0.06] bg-[#1e1e22]/95 px-4 py-2.5 text-[12px] font-medium text-white/85 shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-md hover:bg-[#26262a] hover:text-white"
        >
          <GearIcon />
          <span>玻璃</span>
        </button>
      )}

      {/* 展开态左侧面板 */}
      <aside
        className={
          "fixed bottom-4 left-3 top-20 z-40 flex w-[280px] flex-col rounded-[18px] border border-white/[0.06] bg-[#1a1a1e]/95 shadow-[0_8px_32px_rgba(0,0,0,0.55)] backdrop-blur-md transition-all duration-200 " +
          (open
            ? "translate-x-0 opacity-100"
            : "-translate-x-[120%] pointer-events-none opacity-0")
        }
      >
        {/* 标题栏 */}
        <header className="flex items-center gap-2 px-4 pb-3 pt-4">
          <GearIcon />
          <span className="text-[13px] font-medium text-white/95">液态玻璃</span>
          <button
            onClick={() => onChange({ ...DEFAULT_GLASS_PARAMS })}
            className="ml-auto rounded-full border border-white/[0.06] bg-[#26262a] px-2.5 py-1 text-[10px] font-medium text-white/70 hover:bg-[#2c2c32] hover:text-white"
            title="重置为默认值"
          >
            重置
          </button>
          <button
            onClick={() => setOpen(false)}
            aria-label="收起"
            className="grid h-7 w-7 place-items-center rounded-[8px] border border-white/[0.06] bg-[#26262a] text-white/65 hover:bg-[#2c2c32] hover:text-white"
          >
            <Chevron dir="left" />
          </button>
        </header>

        {/* 滚动内容 */}
        <div className="flex-1 overflow-y-auto px-3 pb-3 pt-1 [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]">
          <Section title="折射 Refraction">
            <Slider label="厚度" value={params.refThickness} min={1} max={80} step={0.1} onChange={(v) => set("refThickness", v)} />
            <Slider label="折射率" value={params.refFactor} min={1} max={4} step={0.01} onChange={(v) => set("refFactor", v)} />
            <Slider label="色散" value={params.refDispersion} min={0} max={50} step={0.1} onChange={(v) => set("refDispersion", v)} />
          </Section>

          <Section title="菲涅尔 Fresnel">
            <Slider label="范围" value={params.refFresnelRange} min={0} max={100} step={0.1} onChange={(v) => set("refFresnelRange", v)} />
            <Slider label="硬度" value={params.refFresnelHardness} min={0} max={100} step={0.1} onChange={(v) => set("refFresnelHardness", v)} />
            <Slider label="强度" value={params.refFresnelFactor} min={0} max={100} step={0.1} onChange={(v) => set("refFresnelFactor", v)} />
          </Section>

          <Section title="斜向高光 Glare" defaultCollapsed>
            <Slider label="强度" value={params.glareFactor} min={0} max={120} step={0.1} onChange={(v) => set("glareFactor", v)} />
            <Slider label="角度" value={params.glareAngle} min={-180} max={180} step={1} suffix="°" onChange={(v) => set("glareAngle", v)} />
            <Slider label="范围" value={params.glareRange} min={0} max={100} step={0.1} onChange={(v) => set("glareRange", v)} />
            <Slider label="硬度" value={params.glareHardness} min={0} max={100} step={0.1} onChange={(v) => set("glareHardness", v)} />
            <Slider label="收敛" value={params.glareConvergence} min={0} max={100} step={0.1} onChange={(v) => set("glareConvergence", v)} />
            <Slider label="对侧" value={params.glareOppositeFactor} min={0} max={100} step={0.1} onChange={(v) => set("glareOppositeFactor", v)} />
          </Section>

          <Section title="背景模糊 Blur">
            <Slider label="半径" value={params.blurRadius} min={1} max={30} step={1} onChange={(v) => set("blurRadius", Math.round(v))} />
            <Toggle label="边缘模糊" checked={params.blurEdge} onChange={(v) => set("blurEdge", v)} />
          </Section>

          <Section title="形状 Shape">
            <Slider label="圆润度" value={params.shapeRoundness} min={2} max={7} step={0.01} onChange={(v) => set("shapeRoundness", v)} />
          </Section>

          <Section title="投影 Shadow" defaultCollapsed>
            <Slider label="扩展" value={params.shadowExpand} min={2} max={100} step={0.1} onChange={(v) => set("shadowExpand", v)} />
            <Slider label="强度" value={params.shadowFactor} min={0} max={100} step={0.1} onChange={(v) => set("shadowFactor", v)} />
            <Slider label="偏移 X" value={params.shadowPositionX} min={-20} max={20} step={0.1} onChange={(v) => set("shadowPositionX", v)} />
            <Slider label="偏移 Y" value={params.shadowPositionY} min={-20} max={20} step={0.1} onChange={(v) => set("shadowPositionY", v)} />
          </Section>

          <Section title="染色 Tint" defaultCollapsed>
            <Slider label="R" value={params.tintR} min={0} max={255} step={1} onChange={(v) => set("tintR", Math.round(v))} />
            <Slider label="G" value={params.tintG} min={0} max={255} step={1} onChange={(v) => set("tintG", Math.round(v))} />
            <Slider label="B" value={params.tintB} min={0} max={255} step={1} onChange={(v) => set("tintB", Math.round(v))} />
            <Slider label="A" value={params.tintA} min={0} max={100} step={0.1} onChange={(v) => set("tintA", v)} />
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-white/55">预览</span>
              <div
                className="h-5 flex-1 rounded-[6px] border border-white/[0.06]"
                style={{
                  background: `rgba(${params.tintR}, ${params.tintG}, ${params.tintB}, ${params.tintA / 100})`,
                }}
              />
            </div>
          </Section>
        </div>
      </aside>
    </>
  );
}

/* ---------- 子组件：可折叠分组 ---------- */
function Section({
  title,
  defaultCollapsed = false,
  children,
}: {
  title: string;
  defaultCollapsed?: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <section className="mt-2 overflow-hidden rounded-[12px] border border-white/[0.04] bg-[#1e1e22]">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-white/[0.025]"
      >
        <span className="text-[11px] font-medium uppercase tracking-wider text-white/55">{title}</span>
        <Chevron dir={collapsed ? "right" : "down"} />
      </button>
      {!collapsed && <div className="space-y-2 px-3 pb-3 pt-1">{children}</div>}
    </section>
  );
}

/* ---------- 子组件：滑块 ---------- */
function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  // 决定显示精度：step 越细，小数位越多
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const trackStyle: CSSProperties = {
    background: `linear-gradient(to right, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.55) ${pct}%, rgba(255,255,255,0.10) ${pct}%, rgba(255,255,255,0.10) 100%)`,
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-white/65">{label}</span>
        <span className="tnum text-white/85">
          {value.toFixed(decimals)}
          {suffix ?? ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={trackStyle}
        className="h-1 w-full cursor-pointer appearance-none rounded-full
          [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-white/95
          [&::-webkit-slider-thumb]:shadow-[0_0_0_2px_rgba(0,0,0,0.4)]
          [&::-webkit-slider-thumb]:cursor-pointer
          [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3
          [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:bg-white/95"
      />
    </div>
  );
}

/* ---------- 子组件：开关 ---------- */
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between py-1 text-left"
    >
      <span className="text-[11px] text-white/65">{label}</span>
      <span
        className={
          "relative h-[18px] w-8 rounded-full transition-colors " +
          (checked ? "bg-white/65" : "bg-white/10")
        }
      >
        <span
          className={
            "absolute top-[2px] h-[14px] w-[14px] rounded-full bg-[#0d0d0d] transition-transform " +
            (checked ? "translate-x-[16px]" : "translate-x-[2px]")
          }
        />
      </span>
    </button>
  );
}

/* ---------- 图标 ---------- */
function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-white/80">
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.5v2 M8 12.5v2 M14.5 8h-2 M3.5 8h-2 M12.6 3.4l-1.4 1.4 M4.8 11.2l-1.4 1.4 M12.6 12.6l-1.4-1.4 M4.8 4.8L3.4 3.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Chevron({ dir }: { dir: "up" | "down" | "left" | "right" }) {
  const paths = {
    up: "M 1 7 L 6 2 L 11 7",
    down: "M 1 5 L 6 10 L 11 5",
    left: "M 8 1 L 3 6 L 8 11",
    right: "M 4 1 L 9 6 L 4 11",
  };
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" className="text-white/55">
      <path d={paths[dir]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
