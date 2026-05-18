// 历史记录下拉面板 —— AI 助手卡片右上角"历史"按钮的浮层
//
// 行结构：[★ 收藏] [标题 或 重命名输入框] [✎ 重命名] [🗑 删除]
//  - ★ 永远可见：pinned 时电黄实心 ★，否则灰色空心 ☆；点击 toggle
//  - ✎ 🗑 仅 hover 整行时浮现
//  - 🗑 在 pinned=true 时灰色 disabled（"收藏后不可删除"）
//  - ✎ 进入行内编辑：Enter / Blur 提交，Esc 取消
//  - 点行标题区切换会话
//  - 按 updated_at 分组：今天 / 昨天 / 本周内 / 本月 / 更早
import { useEffect, useMemo, useRef, useState } from "react";
import type { ConversationListItem } from "../api/conversations";

const FOXO = "#F0FE2D";

type Group = {
  key: "today" | "yesterday" | "week" | "month" | "older";
  label: string;
  items: ConversationListItem[];
};

type Props = {
  items: ConversationListItem[];
  currentId: number | null;
  onSelect: (id: number) => void;
  onRename: (id: number, title: string) => void;
  onTogglePin: (id: number) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
  /** 列表是否仍在初次加载（无缓存命中时为 true）；用于显示骨架 */
  loading?: boolean;
};

export function HistoryDropdown({
  items, currentId, onSelect, onRename, onTogglePin, onDelete, onClose, loading,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 点击外部 / Esc 关闭
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // setTimeout 让"打开"那次 click 不立即触发关闭
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", onDocClick);
    }, 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const groups = useMemo(() => groupByUpdatedAt(items), [items]);

  return (
    <div
      ref={rootRef}
      role="menu"
      className="absolute right-0 top-[calc(100%+6px)] z-[60] w-[280px] origin-top-right rounded-[16px] p-2 shadow-2xl"
      style={{
        background: "rgba(28,28,32,0.96)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.08)",
        animation: "history-pop 160ms cubic-bezier(0.2,0.9,0.3,1.2) both",
      }}
    >
      <style>{`
        @keyframes history-pop {
          from { opacity: 0; transform: scale(0.96) translateY(-4px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      <div className="max-h-[420px] overflow-y-auto pr-0.5 [scrollbar-color:rgba(255,255,255,0.16)_transparent] [scrollbar-width:thin]">
        {items.length === 0 && loading ? (
          // 首次加载且无缓存：骨架占位（5 行渐隐）
          <div className="space-y-1 px-1.5 py-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-7 rounded-[10px]"
                style={{
                  background: `rgba(255,255,255,${0.06 - i * 0.01})`,
                  animation: `history-skel 1.2s ease-in-out ${i * 0.08}s infinite alternate`,
                }}
              />
            ))}
            <style>{`
              @keyframes history-skel {
                from { opacity: 0.55; }
                to   { opacity: 0.95; }
              }
            `}</style>
          </div>
        ) : items.length === 0 ? (
          <div className="px-2 py-6 text-center text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>
            还没有历史对话
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.key} className="mb-2 last:mb-0">
              <div
                className="px-2 pb-1 pt-1 text-[10.5px] font-medium uppercase tracking-wide"
                style={{ color: "rgba(255,255,255,0.38)" }}
              >
                {g.label}
              </div>
              <div className="flex flex-col gap-px">
                {g.items.map((c) => (
                  <ItemRow
                    key={c.id}
                    conv={c}
                    selected={c.id === currentId}
                    onSelect={() => {
                      onSelect(c.id);
                      onClose();
                    }}
                    onRename={(title) => onRename(c.id, title)}
                    onTogglePin={() => onTogglePin(c.id)}
                    onDelete={() => onDelete(c.id)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ============== 单条会话行（含操作） ============== */

type ItemRowProps = {
  conv: ConversationListItem;
  selected: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onTogglePin: () => void;
  onDelete: () => void;
};

function ItemRow({ conv, selected, onSelect, onRename, onTogglePin, onDelete }: ItemRowProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(conv.title);
  const [hovering, setHovering] = useState(false);
  // commitRef 防止 Blur 在 Enter 提交后又跑一次
  const committedRef = useRef(false);

  const beginEdit = () => {
    setEditValue(conv.title);
    committedRef.current = false;
    setEditing(true);
  };
  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const next = editValue.trim();
    if (next && next !== conv.title) onRename(next);
    setEditing(false);
  };
  const cancel = () => {
    committedRef.current = true;
    setEditValue(conv.title);
    setEditing(false);
  };

  // pinned 时禁删
  const canDelete = !conv.pinned;
  const title = conv.title || "未命名会话";

  return (
    <div
      role="menuitem"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className="group/item relative flex h-8 items-center gap-1 rounded-[10px] px-1.5 transition-colors"
      style={{
        background: selected
          ? "rgba(255,255,255,0.10)"
          : hovering
            ? "rgba(255,255,255,0.05)"
            : "transparent",
      }}
    >
      {/* ★ 收藏按钮（永远可见） */}
      <button
        type="button"
        title={conv.pinned ? "取消收藏" : "收藏"}
        aria-label={conv.pinned ? "取消收藏" : "收藏"}
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full transition-colors hover:bg-white/[0.08]"
        style={{ color: conv.pinned ? FOXO : "rgba(255,255,255,0.42)" }}
      >
        <StarIcon filled={conv.pinned} />
      </button>

      {/* 标题 / 输入框 */}
      {editing ? (
        <input
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={commit}
          onClick={(e) => e.stopPropagation()}
          maxLength={120}
          className="min-w-0 flex-1 rounded-md px-1.5 py-0.5 text-[12px] leading-tight outline-none"
          style={{
            background: "rgba(0,0,0,0.45)",
            border: "1px solid rgba(76,177,255,0.45)",
            color: "rgba(255,255,255,0.96)",
          }}
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          title={title}
          className="min-w-0 flex-1 truncate rounded-md text-left text-[12px] leading-tight"
          style={{
            color: selected ? "rgba(255,255,255,0.96)" : "rgba(255,255,255,0.78)",
            background: "transparent",
          }}
        >
          {title}
        </button>
      )}

      {/* ✎ 🗑 仅 hover 整行时显示（编辑态隐藏） */}
      {!editing && (
        <div
          className="flex shrink-0 items-center gap-0.5 transition-opacity"
          style={{ opacity: hovering ? 1 : 0, pointerEvents: hovering ? "auto" : "none" }}
        >
          <button
            type="button"
            title="重命名"
            aria-label="重命名"
            onClick={(e) => {
              e.stopPropagation();
              beginEdit();
            }}
            className="grid h-5 w-5 place-items-center rounded-full transition-colors hover:bg-white/[0.08]"
            style={{ color: "rgba(255,255,255,0.65)" }}
          >
            <PencilIcon />
          </button>
          <button
            type="button"
            title={canDelete ? "删除" : "已收藏 · 不能删除"}
            aria-label="删除"
            aria-disabled={!canDelete}
            onClick={(e) => {
              e.stopPropagation();
              if (canDelete) onDelete();
            }}
            className="grid h-5 w-5 place-items-center rounded-full transition-colors"
            style={{
              color: canDelete ? "#FF8A8A" : "rgba(255,255,255,0.22)",
              cursor: canDelete ? "pointer" : "not-allowed",
            }}
            onMouseEnter={(e) => {
              if (canDelete) e.currentTarget.style.background = "rgba(255,138,138,0.12)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <TrashIcon />
          </button>
        </div>
      )}
    </div>
  );
}

/* ============== icons ============== */

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3l2.5 5.5L20 9.5l-4.5 3.5 1.5 6L12 16l-5 3 1.5-6L4 9.5l5.5-1z" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 4l6 6-10 10H4v-6z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" />
    </svg>
  );
}

/* ============== 分组工具 ============== */

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeekMonday(d: Date): Date {
  const x = startOfDay(d);
  const offset = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - offset);
  return x;
}

function startOfMonth(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

function groupByUpdatedAt(items: ConversationListItem[]): Group[] {
  const now = new Date();
  const today = startOfDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekStart = startOfWeekMonday(now);
  const monthStart = startOfMonth(now);

  const groups: Group[] = [
    { key: "today", label: "今天", items: [] },
    { key: "yesterday", label: "昨天", items: [] },
    { key: "week", label: "本周内", items: [] },
    { key: "month", label: "本月", items: [] },
    { key: "older", label: "更早", items: [] },
  ];

  for (const c of items) {
    const t = new Date(c.updated_at || c.created_at);
    const day = startOfDay(t);
    if (day.getTime() === today.getTime()) {
      groups[0].items.push(c);
    } else if (day.getTime() === yesterday.getTime()) {
      groups[1].items.push(c);
    } else if (day.getTime() >= weekStart.getTime()) {
      groups[2].items.push(c);
    } else if (day.getTime() >= monthStart.getTime()) {
      groups[3].items.push(c);
    } else {
      groups[4].items.push(c);
    }
  }

  return groups.filter((g) => g.items.length > 0);
}
