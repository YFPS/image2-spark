import { useEffect, useState, type CSSProperties } from "react";
import { getActiveAnnouncements, type Announcement } from "../api/announcements";

export function AnnouncementBar({ className = "" }: { className?: string }) {
  const [items, setItems] = useState<Announcement[]>([]);

  useEffect(() => {
    let alive = true;
    getActiveAnnouncements()
      .then((rows) => {
        if (!alive) return;
        setItems(rows);
      })
      .catch(() => {
        if (alive) setItems([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (items.length === 0) return null;

  const duration = `${Math.max(18, items.length * 10)}s`;

  return (
    <div className={`h-10 w-[360px] max-w-full ${className}`}>
      <div
        role="status"
        aria-live="polite"
        className="flex h-10 items-center gap-3 overflow-hidden rounded-full border border-white/[0.08] bg-[rgba(28,28,32,0.62)] px-3 text-[12px] text-white/72 backdrop-blur-[18px]"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/45" />
        <span className="shrink-0 font-medium text-white/88">公告</span>
        <div className="announcement-marquee-window min-w-0 flex-1">
          <div
            className="announcement-marquee-track"
            style={{ "--announcement-marquee-duration": duration } as CSSProperties}
          >
            <AnnouncementMarqueeItems items={items} />
            <AnnouncementMarqueeItems items={items} duplicate />
          </div>
        </div>
        {items.length > 1 && (
          <span className="shrink-0 tabular-nums text-[11px] text-white/35">
            {items.length} 条
          </span>
        )}
      </div>
    </div>
  );
}

function AnnouncementMarqueeItems({
  items,
  duplicate = false,
}: {
  items: Announcement[];
  duplicate?: boolean;
}) {
  return (
    <span
      aria-hidden={duplicate || undefined}
      data-announcement-duplicate={duplicate || undefined}
      className="inline-flex shrink-0 items-center"
    >
      {items.map((item) => (
        <span key={`${duplicate ? "copy" : "main"}-${item.id}`} className="inline-flex items-center gap-2 pr-12">
          <span className="font-medium text-white/88">{item.title}</span>
          <span className="text-white/24">/</span>
          <span className="text-white/56">{item.content}</span>
          {item.link_url && (
            <a
              href={item.link_url}
              target="_blank"
              rel="noreferrer"
              tabIndex={duplicate ? -1 : undefined}
              className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-white/78 hover:bg-white/[0.10] hover:text-white"
            >
              {item.link_label || "查看"}
            </a>
          )}
        </span>
      ))}
    </span>
  );
}
