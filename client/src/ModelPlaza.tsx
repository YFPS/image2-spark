import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  buildModelPageStats,
  imageModelToFeatured,
  imageModelToRecommend,
  sortImageModelsForDisplay,
  TOTAL_PAGES,
  type FilterValue,
} from "./plaza/data";
import { FALLBACK_IMAGE_MODELS, fetchImageModels, type ImageModelItem } from "./api/gptImage";
import { TopBar } from "./plaza/TopBar";
import { HeroBanner } from "./plaza/HeroBanner";
import { FilterBar } from "./plaza/FilterBar";
import { FeaturedGrid } from "./plaza/FeaturedGrid";
import { RecommendGrid } from "./plaza/RecommendGrid";
import { Paginator } from "./plaza/Paginator";
import { PLAZA_GLASS_RADIUS } from "./plaza/constants";
import type { GlassShape } from "./LiquidGlass";

type Props = {
  onShapesChange?: (shapes: GlassShape[]) => void;
};

function matchesFilter(chipLabel: string, filter: FilterValue) {
  return filter === "全部" || chipLabel === filter;
}

function matchesSearch(item: { id: string; title: string; desc: string }, query: string) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return true;
  return [item.id, item.title, item.desc].some((value) =>
    value.toLowerCase().includes(keyword),
  );
}

export default function ModelPlaza({ onShapesChange }: Props = {}) {
  const [activeFilter, setActiveFilter] = useState<FilterValue>("全部");
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [models, setModels] = useState<ImageModelItem[]>(FALLBACK_IMAGE_MODELS);

  const heroRef = useRef<HTMLDivElement>(null);
  const feat0Ref = useRef<HTMLButtonElement>(null);
  const feat1Ref = useRef<HTMLButtonElement>(null);
  const feat2Ref = useRef<HTMLButtonElement>(null);
  const feat3Ref = useRef<HTMLButtonElement>(null);
  const featRefs = useMemo(() => [feat0Ref, feat1Ref, feat2Ref, feat3Ref], []);

  const loadModels = useCallback(async () => {
    const items = await fetchImageModels();
    if (items.length > 0) setModels(items);
  }, []);

  useEffect(() => {
    let alive = true;
    loadModels().catch(() => {
      if (alive) setModels(FALLBACK_IMAGE_MODELS);
    });
    return () => {
      alive = false;
    };
  }, [loadModels]);

  const displayModels = useMemo(() => sortImageModelsForDisplay(models), [models]);
  const stats = useMemo(() => buildModelPageStats(displayModels), [displayModels]);

  const featuredItems = useMemo(
    () =>
      displayModels
        .slice(0, 4)
        .map(imageModelToFeatured)
        .filter(
          (item) =>
            matchesFilter(item.chip.label, activeFilter) && matchesSearch(item, searchQuery),
        ),
    [activeFilter, displayModels, searchQuery],
  );

  const recommendItems = useMemo(
    () =>
      displayModels
        .slice(4)
        .map(imageModelToRecommend)
        .filter(
          (item) =>
            matchesFilter(item.chip.label, activeFilter) && matchesSearch(item, searchQuery),
        ),
    [activeFilter, displayModels, searchQuery],
  );

  useEffect(() => {
    setPage(1);
  }, [activeFilter, searchQuery]);

  useLayoutEffect(() => {
    if (!onShapesChange) return;
    const measure = () => {
      const targets: (HTMLElement | null)[] = [
        heroRef.current,
        ...featRefs.map((r) => r.current),
      ];
      const shapes: GlassShape[] = targets
        .filter((el): el is HTMLElement => el !== null)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            centerX: r.left + r.width / 2,
            centerY: r.top + r.height / 2,
            width: r.width,
            height: r.height,
            radius: PLAZA_GLASS_RADIUS,
          };
        });
      onShapesChange(shapes);
    };
    const raf = requestAnimationFrame(measure);

    const observer = new ResizeObserver(() => requestAnimationFrame(measure));
    [heroRef.current, ...featRefs.map((r) => r.current)].forEach((el) => {
      if (el) observer.observe(el);
    });

    const onScrollOrResize = () => requestAnimationFrame(measure);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [featRefs, featuredItems.length, onShapesChange]);

  useEffect(() => {
    return () => {
      onShapesChange?.([]);
    };
  }, [onShapesChange]);

  return (
    <div className="min-w-0 flex-1 space-y-5 overflow-y-auto px-1 pb-2">
      <TopBar searchQuery={searchQuery} onSearchChange={setSearchQuery} />
      <HeroBanner ref={heroRef} stats={stats} />
      <FilterBar activeFilter={activeFilter} onFilterChange={setActiveFilter} />
      <FeaturedGrid
        items={featuredItems}
        cardRefs={featRefs}
        onCardClick={(card) => console.log("[plaza] model selected", card.id)}
      />
      <RecommendGrid
        items={recommendItems}
        onCardClick={(model) => console.log("[plaza] model selected", model.id)}
        onFavorite={(model) => console.log("[plaza] favorite toggled", model.id)}
        onRefresh={() => void loadModels()}
      />
      {TOTAL_PAGES > 1 && <Paginator page={page} total={TOTAL_PAGES} onChange={setPage} />}
    </div>
  );
}
