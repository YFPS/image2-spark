import { FILTERS, type FilterValue } from "./data";

// Hero 下方独立的过滤 chip 行：受控组件。
// 激活态走电黄 CTA 风格，非激活态走灰边胶囊。

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
