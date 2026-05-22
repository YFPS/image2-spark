import { forwardRef } from "react";

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
      <div ref={ref} className="flex shrink-0 flex-col rounded-[28px] p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12px] font-medium text-white/82">最近作品</span>
          {/* 「查看全部」本期隐藏 —— 等画廊页落地后再回填 */}
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-color:rgba(255,255,255,0.16)_transparent] [scrollbar-width:thin] [scrollbar-gutter:stable]">
          {loading && items.length === 0 ? (
            // 骨架：4 个静态占位块
            Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-[84px] w-[120px] shrink-0 animate-pulse rounded-[14px] bg-white/[0.03]"
              />
            ))
          ) : items.length === 0 ? (
            <span className="text-[12px] text-white/45">
              暂无作品，点击「生成」开始创作
            </span>
          ) : (
            items.map((it) => (
              <button
                key={it.message_id}
                type="button"
                onClick={() => onPreview(safeImageSrc(it.image_url))}
                className="group relative h-[84px] w-[120px] shrink-0 overflow-hidden rounded-[14px] border border-white/[0.05] bg-[#111114] transition-shadow hover:ring-1 hover:ring-white/10"
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
            ))
          )}
        </div>
      </div>
    );
  },
);
