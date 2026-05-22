import { useEffect, useRef } from "react";

import { useAuth } from "../auth/AuthContext";
import { useLogs } from "../hooks/useLogs";
import { LogRow } from "../components/LogRow";

type Props = {
  onPreview: (src: string) => void;
};

export function LogsPage({ onPreview }: Props) {
  const { user } = useAuth();
  const { items, loading, loadingMore, endReached, loadMore } = useLogs();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const el = sentinelRef.current;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "240px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  if (!user) {
    return (
      <div className="grid h-full place-items-center text-[14px] text-white/45">
        请先登录以查看你的积分日志
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 px-1">
        <h1 className="text-[22px] font-medium leading-tight text-white/95">日志</h1>
        <span className="text-[12px] text-white/45">生成记录与积分明细</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-[28px] bg-white/[0.02] p-4 [scrollbar-color:rgba(255,255,255,0.16)_transparent] [scrollbar-width:thin]">
        {loading && items.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-[14px] bg-white/[0.03]" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="grid h-40 place-items-center text-[13px] text-white/45">
            暂无记录
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {items.map((it) => (
                <LogRow key={it.id} item={it} onPreview={onPreview} />
              ))}
            </div>
            <div ref={sentinelRef} className="h-10" aria-hidden="true" />
            {loadingMore && (
              <div className="mt-3 text-center text-[12px] text-white/45">加载中…</div>
            )}
            {endReached && items.length > 20 && (
              <div className="mt-3 text-center text-[12px] text-white/30">— 没有更多了 —</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
