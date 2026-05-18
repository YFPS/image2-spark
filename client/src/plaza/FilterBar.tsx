import { FILTERS, type FilterValue } from "./data";

// Hero 下方独立的过滤 chip 行：受控组件。
// 统一玻璃 chip 风格：半透明深底 + 1px 灰白边 + dock shadow + backdrop-blur。
// 激活态：底色略亮 + 文字加白；不加任何颜色外环（保持纯灰阶）。
// 非激活态：底色略暗，hover 加亮。
// 电黄是页面唯一 CTA 色，不用在过滤 chip 上。

type Props = {
  activeFilter: FilterValue;
  onFilterChange: (v: FilterValue) => void;
};

const BASE_CLASS =
  "rounded-full border border-white/[0.12] px-4 py-2 text-[12px] font-medium shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-[18px] transition hover:bg-white/[0.08] hover:text-white active:scale-[0.98]";

export function FilterBar({ activeFilter, onFilterChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {FILTERS.map((f) => (
        <button
          key={f}
          onClick={() => onFilterChange(f)}
          className={
            f === activeFilter
              ? BASE_CLASS + " bg-white/[0.08] text-white"
              : BASE_CLASS + " bg-[#1c1c2099] text-white/80"
          }
        >
          {f}
        </button>
      ))}
    </div>
  );
}
