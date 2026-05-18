import { SearchIcon, FilterIcon } from "./icons";

// 顶栏：仅保留页面标题 + 搜索框 + 筛选/排序按钮。
// 原"新建项目 / 通知 / 头像"已由 App 主侧栏承担，避免重复。

type Props = {
  searchQuery: string;
  onSearchChange: (v: string) => void;
};

export function TopBar({ searchQuery, onSearchChange }: Props) {
  return (
    <header className="flex items-center gap-4">
      <h1 className="shrink-0 bg-gradient-to-r from-white to-white/55 bg-clip-text text-[22px] font-bold tracking-wide text-transparent">
        模型广场
      </h1>
      <div className="relative ml-6 flex-1">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/35" />
        <input
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索模型名称、功能或关键词"
          className="h-10 w-full rounded-full border border-white/[0.08] bg-white/[0.03] pl-10 pr-4 text-[13px] text-white placeholder:text-white/30 focus:border-white/20 focus:outline-none"
        />
      </div>
      <button className="flex h-10 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 text-[13px] text-white/75 hover:bg-white/[0.06]">
        <FilterIcon />
        筛选 / 排序
      </button>
    </header>
  );
}
