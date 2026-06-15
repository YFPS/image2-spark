import { useRef, useState, useCallback, useEffect, type ReactNode } from "react";

/**
 * 轻量虚拟滚动列表 —— 无外部依赖。
 *
 * 核心策略：
 * - 基于 scroll 事件 + scrollTop 计算可见窗口
 * - 首次渲染用 estimateSize 估算高度，DOM 挂载后测量真实高度并缓存
 * - 用 spacer div 占位维持正确滚动高度
 * - 仅渲染可见范围 + overscan 的 item，减少 DOM 节点数
 */
export function VirtualList<T>({
  items,
  renderItem,
  estimateSize,
  overscan = 5,
  className,
}: {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  estimateSize: (index: number) => number;
  overscan?: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  // 已测量的真实高度缓存（key = item index）
  const heightsRef = useRef<Map<number, number>>(new Map());
  // setMeasuredCount 触发重渲染以应用新测量值
  const [, setMeasuredCount] = useState(0);

  // 取某一项的高度：缓存值 > 估算值
  const getHeight = useCallback(
    (index: number) => heightsRef.current.get(index) ?? estimateSize(index),
    [estimateSize],
  );

  // 总高度
  const totalHeight = (() => {
    let h = 0;
    for (let i = 0; i < items.length; i++) h += getHeight(i);
    return h;
  })();

  // 可见区间（空列表时直接跳过计算）
  let startIdx = 0;
  let endIdx = -1;
  if (items.length > 0) {
    let acc = 0;
    for (let i = 0; i < items.length; i++) {
      const h = getHeight(i);
      if (acc + h >= scrollTop) { startIdx = i; break; }
      acc += h;
      if (i === items.length - 1) startIdx = i;
    }
    let endAcc = acc;
    endIdx = startIdx;
    for (let i = startIdx; i < items.length; i++) {
      endAcc += getHeight(i);
      endIdx = i;
      if (endAcc >= scrollTop + containerHeight) break;
    }
  }

  const renderStart = Math.max(0, startIdx - overscan);
  const renderEnd = Math.min(items.length - 1, endIdx + overscan);

  // 监听滚动
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (el) setScrollTop(el.scrollTop);
  }, []);

  // 监听容器尺寸
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerHeight(el.clientHeight);
    const ro = new ResizeObserver(([entry]) => {
      setContainerHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 测量已渲染 item 的真实高度
  const measureRef = useCallback((node: HTMLDivElement | null, index: number) => {
    if (!node) return;
    const measured = node.getBoundingClientRect().height;
    const cached = heightsRef.current.get(index);
    if (cached !== measured) {
      heightsRef.current.set(index, measured);
      setMeasuredCount((c) => c + 1);
    }
  }, []);

  // 构建渲染内容：spacer + 可见 items
  const children: ReactNode[] = [];
  let topSpacer = 0;
  let bottomSpacer = 0;
  for (let i = 0; i < items.length; i++) {
    if (i < renderStart) {
      topSpacer += getHeight(i);
    } else if (i > renderEnd) {
      bottomSpacer += getHeight(i);
    }
  }

  if (topSpacer > 0) {
    children.push(<div key="spacer-top" style={{ height: topSpacer }} />);
  }
  for (let i = renderStart; i <= renderEnd; i++) {
    children.push(
      <div key={i} ref={(node) => measureRef(node, i)}>
        {renderItem(items[i], i)}
      </div>,
    );
  }
  if (bottomSpacer > 0) {
    children.push(<div key="spacer-bottom" style={{ height: bottomSpacer }} />);
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`overflow-y-auto ${className ?? ""}`}
    >
      <div style={{ height: totalHeight }}>
        {children}
      </div>
    </div>
  );
}
