import type { LogItem } from "../api/logs";
import { formatRelativeTime } from "../utils/relativeTime";

type Props = {
  item: LogItem;
  onPreview: (src: string) => void;
};

const TYPE_LABEL: Record<LogItem["type"], string> = {
  signup_bonus: "注册赠送",
  recharge: "充值",
  admin_grant: "管理员发放",
  generate: "文生图",
  edit: "图像编辑",
  refund: "退款",
  adjust: "调整",
};

export function LogRow({ item, onPreview }: Props) {
  const isGen = item.type === "generate" || item.type === "edit";
  const thumb = item.ref?.thumbnail_url ?? null;
  const prompt = item.ref?.prompt_preview;
  const positive = item.delta > 0;

  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-white/[0.04] bg-white/[0.02] p-3 hover:bg-white/[0.04]">
      {/* 左侧缩略图 / 占位 */}
      {isGen && thumb ? (
        <button
          type="button"
          onClick={() => onPreview(thumb)}
          className="h-12 w-12 shrink-0 overflow-hidden rounded-[10px] border border-white/[0.05] bg-[#111114]"
        >
          <img
            src={thumb}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
            }}
          />
        </button>
      ) : (
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-[10px] bg-white/[0.04] text-[16px] text-white/55">
          {positive ? "+" : "—"}
        </div>
      )}

      {/* 中间：动作 + prompt 摘要 / note */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-white/92">{TYPE_LABEL[item.type]}</span>
          <span className="text-[11px] text-white/45">{formatRelativeTime(item.created_at)}</span>
        </div>
        {prompt ? (
          <div className="mt-0.5 truncate text-[12px] text-white/55">{prompt}</div>
        ) : item.note ? (
          <div className="mt-0.5 truncate text-[12px] text-white/45">{item.note}</div>
        ) : null}
      </div>

      {/* 右侧：积分变动 + 余额 */}
      <div className="flex shrink-0 flex-col items-end">
        <span
          className={`text-[14px] font-semibold tabular-nums ${
            positive ? "text-emerald-400" : "text-white/72"
          }`}
        >
          {positive ? "+" : ""}
          {item.delta}
        </span>
        <span className="text-[10px] text-white/40 tabular-nums">余 {item.balance_after}</span>
      </div>
    </div>
  );
}
