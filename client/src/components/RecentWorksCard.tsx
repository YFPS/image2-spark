import { forwardRef, useState } from "react";

import { useAuth } from "../auth/AuthContext";
import { safeImageSrc, type RecentWorkItem } from "../api/gptImage";
import { formatRelativeTime } from "../utils/relativeTime";

type Props = {
  items: RecentWorkItem[];
  loading: boolean;
  /** 点击缩略图时把图 URL 抛给上层（复用现有 lightbox setPreviewSrc）*/
  onPreview: (src: string) => void;
};

export const RecentWorksCard = forwardRef<HTMLDivElement, Props>(
  function RecentWorksCard({ items, loading, onPreview }, ref) {
    const { user } = useAuth();

    // 未登录：整卡不渲染（连占位都不画）
    if (!user) return null;

    return (
      <div ref={ref} className="flex shrink-0 flex-col rounded-[28px] p-3 sm:p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12px] font-medium text-white/82">最近作品</span>
          {/* 「查看全部」本期隐藏 —— 等画廊页落地后再回填 */}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-3 sm:overflow-x-auto sm:pb-1 [scrollbar-color:rgba(255,255,255,0.16)_transparent] [scrollbar-width:thin] [scrollbar-gutter:stable]">
          {loading && items.length === 0 ? (
            // 骨架：4 个静态占位块
            Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="aspect-[3/2] animate-pulse rounded-[14px] bg-white/[0.03] sm:h-[84px] sm:w-[120px] sm:shrink-0"
              />
            ))
          ) : items.length === 0 ? (
            <span className="col-span-2 text-[12px] text-white/45">
              暂无作品，点击「生成」开始创作
            </span>
          ) : (
            items.map((it) => (
              <RecentWorkThumb key={it.message_id} item={it} onPreview={onPreview} />
            ))
          )}
        </div>
      </div>
    );
  },
);

function RecentWorkThumb({
  item,
  onPreview,
}: {
  item: RecentWorkItem;
  onPreview: (src: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  const src = safeImageSrc(item.image_url);

  return (
    <button
      type="button"
      onClick={() => {
        if (!failed) onPreview(src);
      }}
      aria-disabled={failed}
      className="group relative aspect-[3/2] overflow-hidden rounded-[14px] border border-white/[0.05] bg-[#111114] transition-shadow hover:ring-1 hover:ring-white/10 sm:h-[84px] sm:w-[120px] sm:shrink-0"
    >
      {failed ? (
        <div className="grid h-full w-full place-items-center bg-[#151519] px-2 text-center">
          <span className="text-[10px] leading-tight text-white/42" aria-label="图片加载失败">
            图片加载失败
          </span>
        </div>
      ) : (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
      <span className="absolute left-1.5 top-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] text-white/82 sm:left-2 sm:top-2 sm:px-2">
        {formatRelativeTime(item.created_at)}
      </span>
      {item.image_count > 1 && (
        <span className="absolute bottom-1 right-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] text-white/82 sm:bottom-1.5 sm:right-1.5">
          +{item.image_count - 1}
        </span>
      )}
    </button>
  );
}
