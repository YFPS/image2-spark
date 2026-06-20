import { forwardRef, type CSSProperties } from "react";
import { AnnouncementBar } from "./AnnouncementBar";
import { UserBadge } from "../auth/UserBadge";

type TopGlassBarProps = {
  style?: CSSProperties;
};

export const TopGlassBar = forwardRef<HTMLDivElement, TopGlassBarProps>(
  function TopGlassBar({ style }, ref) {
    return (
      <div
        ref={ref}
        style={style}
        className="pointer-events-none fixed top-2 z-[880] h-14 overflow-visible rounded-[28px] border border-white/[0.08] bg-white/[0.015] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_18px_50px_rgba(0,0,0,0.26)] max-lg:left-3 max-lg:right-3"
      >
        <div className="pointer-events-none absolute inset-px rounded-[27px] border border-white/[0.04]" />
        <div className="pointer-events-none absolute inset-[2px] rounded-[26px] bg-black/[0.04]" />
        <div className="relative z-[1] flex h-full items-center justify-between gap-4">
          <div className="pointer-events-auto shrink-0">
            <AnnouncementBar />
          </div>
          <div className="min-w-0 flex-1" />
          <div className="pointer-events-auto shrink-0">
            <UserBadge embedded />
          </div>
        </div>
      </div>
    );
  },
);
