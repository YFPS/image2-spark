// 快速跳转时间轴 —— 当前会话内"消息级"导航条
//
// 每条 tick 对应一条 message：
//  - tick 颜色按 role 区分：user 暖灰 / ai 冷蓝灰；pinned 不参与（消息无 pin 概念）
//  - tick 宽度长短交替（6/12）+ 鱼眼放大（中心 24 / ±1 18 / ±2 13 / ±3 9）
//  - 当前视口顶部最近的 message 高亮加宽（24，selected）—— 由 scrollRef.scrollTop 算
//  - hover tick：浮出圆角 popover（#序号 · 角色 · 相对时间 + 文本预览 2 行）
//  - 点击 tick：scrollIntoView 到对应 message
import { useEffect, useRef, useState, type CSSProperties } from "react";

const FISHEYE_WIDTHS = [24, 18, 13, 9];
// 页面主色调电黄（FOXO），ai tick 用它做色彩区分
const FOXO = "#F0FE2D";
// ai tick 用的电黄 RGB 元组，便于带 alpha 拼 rgba
const FOXO_RGB = "240,254,45";

export type QuickJumpMessage = {
  id: number | string;
  role: "user" | "ai";
  text: string;
  created_at?: string;
};

type Props = {
  messages: QuickJumpMessage[];
  /** 聊天消息滚动容器 —— 用于读 scrollTop 算"当前消息"，以及响应点击 tick 滚到目标 */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  /** popover 浮出方向；默认 left */
  popoverSide?: "left" | "right";
};

export function TimelineQuickJump({ messages, scrollContainerRef, popoverSide = "left" }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [currentIdx, setCurrentIdx] = useState<number>(-1);

  // 监听聊天容器 scroll：算"视口顶部最近的 message"的索引并高亮
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || messages.length === 0) {
      setCurrentIdx(-1);
      return;
    }

    let raf = 0;
    const recompute = () => {
      const c = scrollContainerRef.current;
      if (!c) return;
      const containerTop = c.getBoundingClientRect().top;
      // 取容器顶部为参考线：找首个 bottom > 参考线的 message
      const items = c.querySelectorAll<HTMLElement>("[data-msg-id]");
      let foundIdx = -1;
      for (let i = 0; i < items.length; i++) {
        const r = items[i].getBoundingClientRect();
        if (r.bottom > containerTop + 4) {
          foundIdx = i;
          break;
        }
      }
      // 全滚到底：高亮最后一条
      if (foundIdx === -1 && items.length > 0) {
        foundIdx = items.length - 1;
      }
      setCurrentIdx(foundIdx);
    };

    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(recompute);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    // 初始计算一次
    recompute();
    // ResizeObserver 跟随容器尺寸变化（窗口 resize 也覆盖）
    const ro = new ResizeObserver(() => recompute());
    ro.observe(container);
    return () => {
      container.removeEventListener("scroll", onScroll);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [scrollContainerRef, messages.length]);

  const handleJump = (idx: number) => {
    const c = scrollContainerRef.current;
    if (!c) return;
    const target = c.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(String(messages[idx].id))}"]`);
    if (target) {
      // 用 scrollTo 比 scrollIntoView 更稳：避免 smooth 把整个页面也滚动
      const offset = target.offsetTop - 4;
      c.scrollTo({ top: offset, behavior: "smooth" });
    }
  };

  if (messages.length === 0) {
    return <div className="w-7 shrink-0" aria-hidden />;
  }

  const alignTickRight = popoverSide === "left";

  return (
    <aside
      className={`group/rail relative flex w-7 shrink-0 items-stretch ${alignTickRight ? "justify-end" : "justify-start"}`}
      aria-label="消息跳转时间轴"
    >
      <div className="flex max-h-full flex-1 flex-col items-stretch justify-center gap-0 overflow-y-auto py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {messages.map((m, i) => (
          <TickRow
            key={m.id}
            msg={m}
            index={i}
            total={messages.length}
            selected={i === currentIdx}
            hoverIdx={hoverIdx}
            popoverSide={popoverSide}
            onHoverEnter={() => setHoverIdx(i)}
            // 仅在 hoverIdx 仍指向自己时清空，避免 row1 延迟 timer 把 row2 设的覆盖
            onHoverLeave={() => setHoverIdx((prev) => (prev === i ? null : prev))}
            onJump={() => handleJump(i)}
          />
        ))}
      </div>
    </aside>
  );
}

/* ============== 单行 tick ============== */

type TickRowProps = {
  msg: QuickJumpMessage;
  index: number;
  total: number;
  selected: boolean;
  hoverIdx: number | null;
  popoverSide: "left" | "right";
  onHoverEnter: () => void;
  onHoverLeave: () => void;
  onJump: () => void;
};

function TickRow({
  msg, index, total, selected, hoverIdx, popoverSide,
  onHoverEnter, onHoverLeave, onJump,
}: TickRowProps) {
  const [popoverAnchor, setPopoverAnchor] = useState<{ left: number; right: number; top: number } | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<number | null>(null);

  const isHoverCenter = hoverIdx === index;
  const distance = hoverIdx == null ? Infinity : Math.abs(hoverIdx - index);

  // 宽度：鱼眼覆盖（0..3）> selected > 长短交替基线（6/12）
  const baseW = index % 2 === 0 ? 6 : 12;
  let width: number;
  if (distance <= 3) {
    width = FISHEYE_WIDTHS[distance];
  } else if (selected) {
    width = 22;
  } else {
    width = baseW;
  }

  // 颜色按 role 区分：
  //  - user 中性白
  //  - ai 用页面主色 FOXO（电黄），与发光 CTA 一脉相承
  //  - selected：role 色基础上加亮加 glow
  //  - hover 中心：全白 + 强 glow（中性强调，避免和 ai 黄色混在一起难辨）
  //  - 鱼眼邻居：role 色随距离衰减
  const isUser = msg.role === "user";
  const overrideStyle: CSSProperties = {};
  if (isHoverCenter) {
    overrideStyle.background = "rgba(255,255,255,0.95)";
    overrideStyle.boxShadow = "0 0 10px rgba(255,255,255,0.75)";
  } else if (selected) {
    overrideStyle.background = isUser ? "rgba(255,255,255,0.92)" : FOXO;
    overrideStyle.boxShadow = isUser
      ? "0 0 8px rgba(255,255,255,0.48)"
      : `0 0 8px rgba(${FOXO_RGB},0.55)`;
  } else if (distance <= 3) {
    const alpha = 0.7 - distance * 0.15;
    overrideStyle.background = isUser
      ? `rgba(255,255,255,${alpha})`
      : `rgba(${FOXO_RGB},${alpha})`;
  }
  const useClassChain = !selected && !(distance <= 3);

  // 类链默认色：user 白系；ai 电黄系。Tailwind JIT 解析任意值 hex + opacity modifier 字面量
  const baseClass = isUser
    ? "rounded-full bg-white/15 transition-all duration-200 ease-out group-hover/rail:bg-white/45"
    : "rounded-full bg-[#F0FE2D]/20 transition-all duration-200 ease-out group-hover/rail:bg-[#F0FE2D]/50";

  const captureAnchor = () => {
    const rect = rowRef.current?.getBoundingClientRect();
    if (rect) setPopoverAnchor({ left: rect.left, right: rect.right, top: rect.top + rect.height / 2 });
  };

  const onMouseEnter = () => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    captureAnchor();
    onHoverEnter();
  };
  const onMouseLeave = () => {
    closeTimer.current = window.setTimeout(() => {
      onHoverLeave();
      setPopoverAnchor(null);
    }, 220);
  };
  const onPopoverEnter = () => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    onHoverEnter();
  };

  useEffect(() => {
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    };
  }, []);

  const showPopover = isHoverCenter && popoverAnchor;

  return (
    <div
      ref={rowRef}
      className="relative flex h-3 items-center justify-end"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <button
        type="button"
        onClick={onJump}
        aria-label={`跳转到第 ${index + 1} 条消息`}
        className="relative flex h-3 w-full items-center justify-end pr-1"
      >
        <div
          className={useClassChain ? baseClass : "rounded-full transition-all duration-200 ease-out"}
          style={{ height: 1, width, ...overrideStyle }}
        />
      </button>

      {showPopover && (
        <HoverPopover
          msg={msg}
          index={index}
          total={total}
          anchor={popoverAnchor}
          side={popoverSide}
          onMouseEnter={onPopoverEnter}
          onMouseLeave={onMouseLeave}
        />
      )}
    </div>
  );
}

/* ============== Hover popover ============== */

type PopoverProps = {
  msg: QuickJumpMessage;
  index: number;
  total: number;
  anchor: { left: number; right: number; top: number };
  side: "left" | "right";
  onMouseEnter: () => void;
  onMouseLeave: () => void;
};

function HoverPopover({ msg, index, total, anchor, side, onMouseEnter, onMouseLeave }: PopoverProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  const roleLabel = msg.role === "ai" ? "AI" : "你";
  const text = msg.text?.trim() || "（空消息）";
  const timeLabel = msg.created_at ? relTime(msg.created_at) : "";

  const isRight = side === "right";
  const positionStyle: CSSProperties = isRight
    ? {
        left: anchor.right + 8,
        top: anchor.top,
        transform: `translate(0, -50%) scale(${mounted ? 1 : 0.96})`,
        transformOrigin: "left center",
      }
    : {
        left: anchor.left - 8,
        top: anchor.top,
        transform: `translate(-100%, -50%) scale(${mounted ? 1 : 0.96})`,
        transformOrigin: "right center",
      };

  return (
    <div
      role="dialog"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="fixed z-[1000] w-[260px] rounded-[14px] p-3"
      style={{
        ...positionStyle,
        opacity: mounted ? 1 : 0,
        transition: "opacity 160ms ease-out, transform 160ms cubic-bezier(0.2,0.9,0.3,1.2)",
        background: "rgba(23,23,23,0.96)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
        color: "rgba(255,255,255,0.92)",
      }}
    >
      {/* 元行：#N · 角色 · 时间 */}
      <div className="flex items-center gap-1.5 text-[10.5px] tabular-nums" style={{ color: "rgba(255,255,255,0.45)" }}>
        <span className="font-semibold" style={{ color: "rgba(255,255,255,0.72)" }}>
          #{index + 1}
          <span style={{ color: "rgba(255,255,255,0.32)" }}> / {total}</span>
        </span>
        <span>·</span>
        <span style={{ color: msg.role === "ai" ? FOXO : "rgba(255,255,255,0.78)" }}>
          {roleLabel}
        </span>
        {timeLabel && (
          <>
            <span>·</span>
            <span>{timeLabel}</span>
          </>
        )}
      </div>
      {/* 消息正文：2 行截断 */}
      <div
        className="mt-1.5 overflow-hidden text-[12px] leading-[1.5]"
        style={{
          color: "rgba(255,255,255,0.92)",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          wordBreak: "break-word",
        }}
      >
        {text}
      </div>
    </div>
  );
}

/* ============== 相对时间格式化（轻量版） ============== */
function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diffSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (diffSec < 60) return "刚刚";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  const days = Math.floor(diffSec / 86400);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(months / 12)} 年前`;
}
