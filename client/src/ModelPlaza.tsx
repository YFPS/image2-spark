import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FEATURED, RECOMMEND, TOTAL_PAGES, type FilterValue } from "./plaza/data";
import { TopBar } from "./plaza/TopBar";
import { HeroBanner } from "./plaza/HeroBanner";
import { FilterBar } from "./plaza/FilterBar";
import { FeaturedGrid } from "./plaza/FeaturedGrid";
import { RecommendGrid } from "./plaza/RecommendGrid";
import { Paginator } from "./plaza/Paginator";
import { PLAZA_GLASS_RADIUS } from "./plaza/constants";
import type { GlassShape } from "./LiquidGlass";

// 模型广场（内嵌组件）。
// 作为 App 主壳中 activeNav==='models' 分区的内容，由父级提供布局外壳与全局背景。
// Hero + 4 张 FeaturedCard 通过 onShapesChange 把 boundingClientRect 上报给 App，
// App 把它们传给全局 LiquidGlass canvas 做 WebGL2 渲染（折射 / 色散 / 菲涅尔 / 投影）。
// 其余区块（TopBar / FilterBar / RecommendCard / Paginator）用 CSS 玻璃仿色，不进 WebGL。

type Props = {
  onShapesChange?: (shapes: GlassShape[]) => void;
};

export default function ModelPlaza({ onShapesChange }: Props = {}) {
  const [activeFilter, setActiveFilter] = useState<FilterValue>("全部");
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");

  // 用 useRef<T>(null) 形式（不带 | null）：返回 RefObject<T>，
  // 与 FeaturedCard / HeroBanner 的 forwardRef ref 参数类型兼容。
  const heroRef = useRef<HTMLDivElement>(null);
  // 4 个旗舰卡 ref —— FEATURED 数组固定 4 条
  const feat0Ref = useRef<HTMLButtonElement>(null);
  const feat1Ref = useRef<HTMLButtonElement>(null);
  const feat2Ref = useRef<HTMLButtonElement>(null);
  const feat3Ref = useRef<HTMLButtonElement>(null);
  const featRefs = [feat0Ref, feat1Ref, feat2Ref, feat3Ref];

  // 测量 Hero + 4 旗舰卡的屏幕位置，上报给全局 LiquidGlass。
  // 用 useLayoutEffect + ResizeObserver + scroll/resize 监听保证一致性。
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
    // 滚动监听用 capture，因为滚动容器是 ModelPlaza 内部 overflow-y-auto 的 div
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onShapesChange]);

  // 卸载时清空 shapes：切到其它 nav 后 LiquidGlass 不残留广场卡片轮廓
  useEffect(() => {
    return () => {
      onShapesChange?.([]);
    };
  }, [onShapesChange]);

  return (
    <div className="min-w-0 flex-1 space-y-5 overflow-y-auto px-1 pb-2">
      <TopBar searchQuery={searchQuery} onSearchChange={setSearchQuery} />
      <HeroBanner ref={heroRef} />
      <FilterBar activeFilter={activeFilter} onFilterChange={setActiveFilter} />
      <FeaturedGrid
        items={FEATURED}
        cardRefs={featRefs}
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
