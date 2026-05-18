// 单条 session 的"tick"渲染 —— 极简短横线
//
// 三级亮度（通过 Tailwind named-group CSS 级联响应整轴 hover）：
//  - 默认：bg-white/15      暗灰，几乎看不清
//  - 整轴 hover：bg-white/40 中灰，列表清晰可见
//  - 单 tick hover：bg-white/95 白色发亮（同时宽度从 6/12 加到 16）
//
// 状态覆盖（直接覆盖 background style）：
//  - selected：白色加宽
//  - pinned：电黄 + glow
//
// 折叠态：hover tick 显示**单行截断 tooltip**（前文 + …）
// 展开态：tick 右侧渲染胶囊标题 + hover 胶囊出 ⭐ ✎ 🗑 inline action
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ConversationListItem } from "../api/conversations";

const FOXO = "#F0FE2D";

type Props = {
  conv: ConversationListItem;
  selected: boolean;
  /** 列表内索引（决定 tick 短/长交替：偶 6px / 奇 12px）*/
  index: number;
  /** 展开态：rail 变宽，tick 右侧多渲染一个胶囊标题 */
  expanded: boolean;
  onSelect: () => void;
  onRename: (newTitle: string) => void;
  onTogglePin: () => void;
  onDelete: () => void;
};

export function SessionCard({
  conv, selected, index, expanded, onSelect, onRename, onTogglePin, onDelete,
}: Props) {
  const [tickHovering, setTickHovering] = useState(false);
  const [tooltipAnchor, setTooltipAnchor] = useState<{ left: number; top: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(conv.title);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<number | null>(null);

  const baseW = index % 2 === 0 ? 6 : 12;
  const width = tickHovering || selected ? 16 : baseW;

  // 颜色处理：default / group-hover/rail / group-hover/tick 三级靠 CSS class 链
  // selected 与 pinned 用 inline style 覆盖（最高优先级）
  const overrideStyle: CSSProperties = {};
  if (conv.pinned) {
    overrideStyle.background = FOXO;
    overrideStyle.boxShadow = `0 0 6px ${FOXO}`;
  } else if (selected) {
    overrideStyle.background = "rgba(255,255,255,0.92)";
    overrideStyle.boxShadow = "0 0 8px rgba(255,255,255,0.48)";
  }

  const useClassChain = !conv.pinned && !selected;

  const onMouseEnter = () => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    const rect = rowRef.current?.getBoundingClientRect();
    if (rect) {
      setTooltipAnchor({ left: rect.left, top: rect.top + rect.height / 2 });
    }
    setTickHovering(true);
  };
  const onMouseLeave = () => {
    closeTimer.current = window.setTimeout(() => setTickHovering(false), 120);
  };

  useEffect(() => {
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    };
  }, []);

  const title = conv.title || "未命名会话";
  const showTooltip = tickHovering && !expanded;

  return (
    // 固定行高 h-4：胶囊和 tick 都在其中垂直居中，保证 tick 列纵向间距不被胶囊撑大
    // flex-row-reverse：tick 永远贴容器右缘，胶囊在 tick 左侧（反方向布局）
    <div
      ref={rowRef}
      className="relative flex h-4 flex-row-reverse items-center gap-2"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* tick 按钮（永远贴右） */}
      <button
        type="button"
        onClick={onSelect}
        aria-label={title}
        className="group/tick relative flex h-4 w-10 shrink-0 items-center justify-end pr-1"
      >
        <div
          className={
            useClassChain
              ? "rounded-full bg-white/15 transition-all duration-150 group-hover/rail:bg-white/60 group-hover/rail:shadow-[0_0_6px_rgba(255,255,255,0.25)] group-hover/tick:bg-white/95 group-hover/tick:shadow-[0_0_10px_rgba(255,255,255,0.75)]"
              : "rounded-full transition-all duration-150"
          }
          style={{ height: 1, width, ...overrideStyle }}
        />
      </button>

      {/* 展开态：右侧胶囊标题 + inline 操作 */}
      {expanded && (
        <CapsuleTitle
          conv={conv}
          selected={selected}
          editing={editing}
          editValue={editValue}
          onEditChange={setEditValue}
          onStartEdit={() => {
            setEditValue(conv.title);
            setEditing(true);
          }}
          onCommitEdit={() => {
            onRename(editValue);
            setEditing(false);
          }}
          onCancelEdit={() => {
            setEditValue(conv.title);
            setEditing(false);
          }}
          onSelect={onSelect}
          onTogglePin={onTogglePin}
          onDelete={onDelete}
        />
      )}

      {/* 折叠态：单行截断 tooltip（仅 hover 触发） */}
      {showTooltip && tooltipAnchor && <SingleLineTooltip title={title} anchor={tooltipAnchor} />}
    </div>
  );
}

/* ============== Tooltip（折叠态 hover 单行） ============== */

function SingleLineTooltip({
  title,
  anchor,
}: {
  title: string;
  anchor: { left: number; top: number };
}) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[1000] max-w-[260px] truncate rounded-full px-3 py-1 text-[11px]"
      style={{
        left: Math.max(12, anchor.left - 12),
        top: anchor.top,
        transform: "translate(-100%, -50%)",
        background: "#171717",
        border: "1px solid rgba(255,255,255,0.08)",
        color: "rgba(255,255,255,0.92)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
      }}
    >
      {title}
    </div>
  );
}

/* ============== 展开态胶囊 ============== */

type CapsuleProps = {
  conv: ConversationListItem;
  selected: boolean;
  editing: boolean;
  editValue: string;
  onEditChange: (v: string) => void;
  onStartEdit: () => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onSelect: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
};

function CapsuleTitle(props: CapsuleProps) {
  const title = props.conv.title || "未命名会话";

  // selected 时胶囊用稍亮的底；非 selected 默认极淡
  const bg = props.selected ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)";
  const fg = props.selected ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.65)";

  // 胶囊固定高度 = h-4（14px 内容 + 1px 上下边距 ≈ 16px 容器），与 SessionCard 行高一致
  // inline action 浮在胶囊**左缘**（远离 tick，避免按钮组覆盖 tick）
  return (
    <div className="group/capsule relative flex h-4 max-w-[170px] flex-1 items-center gap-1">
      {props.editing ? (
        <input
          autoFocus
          value={props.editValue}
          onChange={(e) => props.onEditChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") props.onCommitEdit();
            else if (e.key === "Escape") props.onCancelEdit();
          }}
          onBlur={props.onCommitEdit}
          className="h-4 min-w-0 flex-1 rounded-full px-2.5 text-[10.5px] leading-none outline-none"
          style={{
            background: "rgba(0,0,0,0.4)",
            border: "1px solid rgba(76,177,255,0.4)",
            color: "rgba(255,255,255,0.92)",
          }}
        />
      ) : (
        <button
          type="button"
          onClick={props.onSelect}
          title={title}
          className="h-4 min-w-0 flex-1 truncate rounded-full px-2.5 text-left text-[10.5px] leading-none transition-colors"
          style={{ background: bg, color: fg }}
        >
          {title}
        </button>
      )}

      {/* hover 胶囊时浮出 inline 操作（绝对定位避免挤压胶囊宽度）
          —— 浮在胶囊左缘，远离 tick，避免按钮组覆盖 tick */}
      {!props.editing && (
        <div
          className="absolute -left-1 top-1/2 z-30 hidden -translate-y-1/2 -translate-x-full items-center gap-0.5 rounded-full px-1 py-0.5 group-hover/capsule:flex"
          style={{
            background: "#171717",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 6px 16px rgba(0,0,0,0.45)",
          }}
        >
          <CapsuleAction title={props.conv.pinned ? "取消收藏" : "收藏"} active={props.conv.pinned} onClick={props.onTogglePin}>
            <StarIcon filled={props.conv.pinned} />
          </CapsuleAction>
          <CapsuleAction title="重命名" onClick={props.onStartEdit}>
            <PencilIcon />
          </CapsuleAction>
          <CapsuleAction title="删除" danger onClick={props.onDelete}>
            <TrashIcon />
          </CapsuleAction>
        </div>
      )}
    </div>
  );
}

function CapsuleAction(props: {
  title: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={props.title}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
      className="grid h-5 w-5 place-items-center rounded-full transition-colors hover:bg-white/[0.08]"
      style={{
        color: props.danger
          ? "#FF8A8A"
          : props.active
          ? FOXO
          : "rgba(255,255,255,0.65)",
      }}
    >
      {props.children}
    </button>
  );
}

/* ============== icons ============== */

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
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
