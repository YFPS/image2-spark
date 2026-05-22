import { useEffect, useRef } from "react";

import { useAuth } from "../auth/AuthContext";
import { useGallery } from "../hooks/useGallery";
import { safeImageSrc } from "../api/gptImage";
import { formatRelativeTime } from "../utils/relativeTime";

type Props = {
  onPreview: (src: string) => void;
};

export function GalleryPage({ onPreview }: Props) {
  const { user } = useAuth();
  const { items, loading, loadingMore, endReached, loadMore } = useGallery();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // IntersectionObserver 触底加载
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
        请先登录以查看你的作品
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 px-1">
        <h1 className="text-[22px] font-medium leading-tight text-white/95">画廊</h1>
        <span className="text-[12px] text-white/45">你的全部作品</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-[28px] bg-white/[0.02] p-4 [scrollbar-color:rgba(255,255,255,0.16)_transparent] [scrollbar-width:thin]">
        {loading && items.length === 0 ? (
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="aspect-square animate-pulse rounded-[14px] bg-white/[0.03]"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="grid h-40 place-items-center text-[13px] text-white/45">
            暂无作品，去工作室创作第一张
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-3">
              {items.map((it) => (
                <button
                  key={it.message_id}
                  type="button"
                  onClick={() => onPreview(safeImageSrc(it.image_url))}
                  className="group relative aspect-square overflow-hidden rounded-[14px] border border-white/[0.05] bg-[#111114] transition-shadow hover:ring-1 hover:ring-white/10"
                >
                  <img
                    src={safeImageSrc(it.image_url)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                    }}
                  />
                  <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white/82">
                    {formatRelativeTime(it.created_at)}
                  </span>
                  {it.image_count > 1 && (
                    <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] text-white/82">
                      +{it.image_count - 1}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div ref={sentinelRef} className="h-10" aria-hidden="true" />
            {loadingMore && (
              <div className="mt-3 text-center text-[12px] text-white/45">加载中…</div>
            )}
            {endReached && items.length > 12 && (
              <div className="mt-3 text-center text-[12px] text-white/30">— 没有更多了 —</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
