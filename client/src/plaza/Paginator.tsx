import type { ReactNode } from "react";
import { ChevLeftIcon, ChevRightIcon } from "./icons";

// 分页器：边界处箭头自动禁用 + opacity 弱化。
// 当前页用电黄淡填充，非当前页走灰玻璃。

type Props = {
  page: number;
  total: number;
  onChange: (p: number) => void;
};

export function Paginator({ page, total, onChange }: Props) {
  const goto = (p: number) => onChange(Math.max(1, Math.min(total, p)));
  return (
    <nav className="mt-4 flex items-center justify-center gap-1.5 pb-4">
      <PageBtn onClick={() => goto(page - 1)} disabled={page === 1}>
        <ChevLeftIcon />
      </PageBtn>
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
        <PageBtn key={n} active={page === n} onClick={() => goto(n)}>
          {n}
        </PageBtn>
      ))}
      <PageBtn onClick={() => goto(page + 1)} disabled={page === total}>
        <ChevRightIcon />
      </PageBtn>
    </nav>
  );
}

function PageBtn({
  children,
  active,
  disabled,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={
        "grid h-8 min-w-8 place-items-center rounded-md border px-2 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-30 " +
        (active
          ? "border-accent-foxo/60 bg-accent-foxo/20 text-accent-foxo"
          : "border-white/[0.08] bg-white/[0.03] text-white/65 hover:bg-white/[0.08]")
      }
    >
      {children}
    </button>
  );
}
