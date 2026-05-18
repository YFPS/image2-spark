// 历史时间轴 —— 窄柱 tick 列表
//
// 默认（折叠态 72px）：
//  - 整轴 tick 默认极暗（bg-white/15），几乎看不清
//  - 鼠标移入轴：通过 Tailwind named-group `group/rail` 级联，所有 tick 提到 bg-white/40 中灰
//  - 鼠标移入单个 tick：再提到 bg-white/95 + 宽度从 6/12 加到 16
//  - hover 单 tick 时左侧弹简版 tooltip（单行截断 …）
//  - 点击 tick → 切换 currentId
//
// 展开态（240px，点顶部 ⇄ 按钮切换）：
//  - tick 列保留，右侧多渲染胶囊标题
//  - hover 胶囊：浮出 ⭐ ✎ 🗑 inline 操作
//  - 点击胶囊也可切换
//
// v0.2 玻璃质感铁律：
//  - 外层 <aside> 透明壳，真液态玻璃由全屏 LiquidGlass 渲染
//  - 内层灰卡实心 #1e1e22 + rounded-[20px]
import { forwardRef, useEffect, useMemo, useState } from "react";
import type { UseConversations } from "./useConversations";
import { SessionGroup } from "./SessionGroup";

const PANEL_W_COLLAPSED = 72;
const PANEL_W_EXPANDED = 240;

type Props = {
  state: UseConversations;
  onNew: () => void;
  onSelectConversation: (id: number) => void;
};

export const TimelineRail = forwardRef<HTMLDivElement, Props>(function TimelineRail(
  { state, onNew, onSelectConversation },
  ref,
) {
  const [expanded, setExpanded] = useState(false);

  const { pinned, others } = useMemo(() => {
    const p: typeof state.list = [];
    const o: typeof state.list = [];
    for (const c of state.list) (c.pinned ? p : o).push(c);
    return { pinned: p, others: o };
  }, [state.list]);

  const ordered = useMemo(() => [...pinned, ...others], [pinned, others]);
  const currentIdx = ordered.findIndex((c) => c.id === state.currentId);
  const canPrev = currentIdx > 0;
  const canNext = currentIdx >= 0 && currentIdx < ordered.length - 1;

  useEffect(() => {
    if (state.currentId != null) onSelectConversation(state.currentId);
  }, [state.currentId, onSelectConversation]);

  const goPrev = () => {
    if (canPrev) state.setCurrentId(ordered[currentIdx - 1].id);
  };
  const goNext = () => {
    if (canNext) state.setCurrentId(ordered[currentIdx + 1].id);
  };

  return (
    <aside
      ref={ref}
      // 不用 h-full：父 flex 默认 align-items:stretch 已经把高度拉满，h-full 在 flex 子项里
      // 会按 100% 父 height 计算，配合 transition 在 reflow 时可能溢出。
      // 与 sidebar / chat aside 走同样的 stretch 模式保持等高。
      className="flex min-h-0 shrink-0 flex-col rounded-[28px] p-3 transition-[width] duration-200"
      style={{
        width: expanded ? PANEL_W_EXPANDED : PANEL_W_COLLAPSED,
        fontFamily:
          "Outfit, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* 内层灰卡 —— group/rail：整轴 hover 时所有 tick 提亮 */}
      <div
        className="group/rail group relative flex min-h-0 flex-1 flex-col items-stretch overflow-hidden rounded-[20px] py-3"
        style={{
          background: "#1e1e22",
          border: "1px solid rgba(255,255,255,0.04)",
        }}
      >
        {/* 顶部：+ 新对话 / ⇄ 展开折叠 —— 竖向 stack，各占一行 */}
        <div className="flex shrink-0 flex-col items-center gap-1 pb-2">
          <button
            type="button"
            onClick={onNew}
            title="新对话"
            aria-label="新对话"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors hover:bg-white/[0.08]"
            style={{ color: "rgba(255,255,255,0.85)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "折叠" : "展开"}
            aria-label={expanded ? "折叠" : "展开"}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors hover:bg-white/[0.06]"
            style={{ color: "rgba(255,255,255,0.55)" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {expanded ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
            </svg>
          </button>
        </div>

        {/* 中间：上一条 / tick 列从顶部往下 / 下一条 */}
        <div className="flex min-h-0 flex-1 flex-col items-stretch gap-1">
          {/* 上一条按钮 */}
          <button
            type="button"
            onClick={goPrev}
            disabled={!canPrev}
            title="上一条"
            aria-label="上一条"
            className="mx-auto grid h-7 w-7 shrink-0 place-items-center rounded-full opacity-0 transition-all duration-200 hover:bg-white/[0.06] group-hover:opacity-100 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:group-hover:opacity-30"
            style={{ color: "rgba(255,255,255,0.65)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
              <path d="M18 15L12 9L6 15" />
            </svg>
          </button>

          {/* tick / 胶囊列表 —— 从顶部往下排列（justify-start） */}
          <div
            className="flex max-h-full min-h-0 flex-1 flex-col items-stretch justify-start gap-0 overflow-y-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {state.loadingList && state.list.length === 0 && (
              <div className="px-2 text-center text-[10px]" style={{ color: "rgba(255,255,255,0.28)" }}>
                …
              </div>
            )}

            {!state.loadingList && state.list.length === 0 && (
              <div className="px-2 py-4 text-center text-[9px]" style={{ color: "rgba(255,255,255,0.28)" }}>
                ⌁
              </div>
            )}

            <SessionGroup
              items={pinned}
              indexOffset={0}
              expanded={expanded}
              currentId={state.currentId}
              onSelect={state.setCurrentId}
              onRename={state.rename}
              onTogglePin={state.togglePin}
              onDelete={state.remove}
            />
            <SessionGroup
              items={others}
              indexOffset={pinned.length}
              expanded={expanded}
              currentId={state.currentId}
              onSelect={state.setCurrentId}
              onRename={state.rename}
              onTogglePin={state.togglePin}
              onDelete={state.remove}
            />
          </div>

          {/* 下一条按钮 */}
          <button
            type="button"
            onClick={goNext}
            disabled={!canNext}
            title="下一条"
            aria-label="下一条"
            className="mx-auto grid h-7 w-7 shrink-0 place-items-center rounded-full opacity-0 transition-all duration-200 hover:bg-white/[0.06] group-hover:opacity-100 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:group-hover:opacity-30"
            style={{ color: "rgba(255,255,255,0.65)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
              <path d="M6 9L12 15L18 9" />
            </svg>
          </button>
        </div>

        {/* 底部：搜索切换 */}
        <div className="flex shrink-0 items-center justify-center px-2 pt-2">
          <SearchToggle value={state.searchQ} onChange={state.setSearchQ} expanded={expanded} />
        </div>
      </div>
    </aside>
  );
});

function SearchToggle({
  value, onChange, expanded,
}: { value: string; onChange: (v: string) => void; expanded: boolean }) {
  const [open, setOpen] = useState(false);

  // 展开态默认显示输入框
  if (open || expanded) {
    return (
      <div className="flex w-full items-center gap-1">
        <input
          autoFocus={open}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            if (!value) setOpen(false);
          }}
          placeholder="搜索"
          className="min-w-0 flex-1 rounded-md px-2 py-1 text-[11px] outline-none placeholder:text-white/30"
          style={{
            background: "rgba(0,0,0,0.4)",
            border: "1px solid rgba(255,255,255,0.06)",
            color: "rgba(255,255,255,0.85)",
          }}
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              if (!expanded) setOpen(false);
            }}
            title="清除"
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full transition-colors hover:bg-white/[0.06]"
            style={{ color: "rgba(255,255,255,0.55)" }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      title="搜索对话"
      aria-label="搜索对话"
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors hover:bg-white/[0.06]"
      style={{ color: value ? "#F0FE2D" : "rgba(255,255,255,0.55)" }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
    </button>
  );
}
