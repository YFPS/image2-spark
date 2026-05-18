import { useState } from "react";
import { FEATURED, RECOMMEND, TOTAL_PAGES, type FilterValue } from "./plaza/data";
import { TopBar } from "./plaza/TopBar";
import { HeroBanner } from "./plaza/HeroBanner";
import { FilterBar } from "./plaza/FilterBar";
import { FeaturedGrid } from "./plaza/FeaturedGrid";
import { RecommendGrid } from "./plaza/RecommendGrid";
import { Paginator } from "./plaza/Paginator";

/**
 * 模型广场（内嵌组件）。
 * 作为 App 主壳中 activeNav==='models' 分区的内容，由父级提供布局外壳与全局背景。
 * 旗舰 4 + 推荐 4（16:9 封面）+ 分页；所有点击交互暂仅 console.log 占位。
 */
export default function ModelPlaza() {
  const [activeFilter, setActiveFilter] = useState<FilterValue>("全部");
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div className="min-w-0 flex-1 space-y-5 overflow-y-auto px-1 pb-2">
      <TopBar searchQuery={searchQuery} onSearchChange={setSearchQuery} />
      <HeroBanner />
      <FilterBar activeFilter={activeFilter} onFilterChange={setActiveFilter} />
      <FeaturedGrid
        items={FEATURED}
        onCardClick={(c) => console.log("[plaza] featured selected", c.id)}
      />
      <RecommendGrid
        items={RECOMMEND}
        onCardClick={(m) => console.log("[plaza] recommend selected", m.id)}
        onFavorite={(m) => console.log("[plaza] favorite toggled", m.id)}
        onRefresh={() => console.log("[plaza] refresh recommend")}
      />
      <Paginator page={page} total={TOTAL_PAGES} onChange={setPage} />
    </div>
  );
}
