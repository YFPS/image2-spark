import type { Recommend } from "./types";
import { RefreshIcon } from "./icons";
import { RecommendCard } from "./RecommendCard";

// 推荐 4 卡的 grid + "推荐模型" 标题 + 右侧"换一批"。
// items 为空时显示占位（防崩溃）。

type Props = {
  items: Recommend[];
  onCardClick: (m: Recommend) => void;
  onFavorite: (m: Recommend) => void;
  onRefresh: () => void;
};

export function RecommendGrid({ items, onCardClick, onFavorite, onRefresh }: Props) {
  if (items.length === 0) {
    return (
      <section className="mt-1">
        <h3 className="text-[15px] font-semibold text-white">推荐模型</h3>
        <div className="mt-3 grid h-32 place-items-center rounded-[14px] border border-white/[0.04] bg-white/[0.02] text-[12px] text-white/45">
          暂无推荐
        </div>
      </section>
    );
  }
  return (
    <section className="mt-1">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold text-white">推荐模型</h3>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1 text-[12px] text-white/55 hover:text-white"
        >
          <RefreshIcon />
          换一批
        </button>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-md:grid-cols-1">
        {items.map((m) => (
          <RecommendCard
            key={m.id}
            m={m}
            onClick={() => onCardClick(m)}
            onFavorite={() => onFavorite(m)}
          />
        ))}
      </div>
    </section>
  );
}
