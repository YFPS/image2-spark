/**
 * ISO 时间戳 → 中文相对时间标签
 *  - <1 min     "刚刚"
 *  - <60 min    "N 分钟前"
 *  - <24 h      "N 小时前"
 *  - 昨日       "昨天"
 *  - <7 d       "N 天前"
 *  - 否则       "MM/DD"
 *
 * @param iso ISO 时间戳字符串（如 "2026-05-22T10:14:33Z"）
 * @param now 用于测试的"当前时间"，默认 new Date()
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  const diffMs = now.getTime() - t.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;

  // 昨日按"当地日历日"差判断（不是按 24 小时差）
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDay = Math.round(
    (startOfDay(now).getTime() - startOfDay(t).getTime()) / 86_400_000,
  );
  if (diffDay === 1) return "昨天";
  if (diffDay < 7) return `${diffDay} 天前`;

  const mm = String(t.getMonth() + 1).padStart(2, "0");
  const dd = String(t.getDate()).padStart(2, "0");
  return `${mm}/${dd}`;
}
