// iMessage 风格的会话时间格式化
//
// 规则（以 now 为基准）：
//  - 今天                  → "HH:mm"   例：14:30
//  - 昨天                  → "昨天"
//  - 本周内（前 2~6 天）    → 中文星期：周一 / 周二 / 周三 …
//  - 本年内                → "M/D"     例：5/12
//  - 跨年                  → "YYYY/M/D" 例：2025/11/3
//
// 周首日按 "周一" 起算（与中国习惯一致，不是 Sunday）。

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** 以周一为一周首日的"本周首日"零点 */
function startOfWeekMonday(d: Date): Date {
  const x = startOfDay(d);
  // getDay: 0=周日, 1=周一, … 6=周六
  // 想得到的偏移量：周一→0, 周二→1, …, 周日→6
  const offset = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - offset);
  return x;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * @param isoOrDate ISO 字符串或 Date
 * @param now       可注入"当前时刻"以便测试；默认 new Date()
 */
export function formatSessionTime(isoOrDate: string | Date, now: Date = new Date()): string {
  const t = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(t.getTime())) return "";

  const today = startOfDay(now);
  const target = startOfDay(t);
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86_400_000);

  if (diffDays === 0) {
    return `${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
  }
  if (diffDays === 1) {
    return "昨天";
  }

  // 本周内（周一为首日）：2~6 天前并且仍在同一周首日范围内
  if (diffDays >= 2 && diffDays <= 6) {
    const weekStart = startOfWeekMonday(now);
    if (target.getTime() >= weekStart.getTime()) {
      return WEEKDAYS[t.getDay()];
    }
  }

  // 本年内：M/D
  if (t.getFullYear() === now.getFullYear()) {
    return `${t.getMonth() + 1}/${t.getDate()}`;
  }

  // 跨年：YYYY/M/D
  return `${t.getFullYear()}/${t.getMonth() + 1}/${t.getDate()}`;
}

/** 给 hover popover 用的完整日期时间："YYYY/M/D HH:mm" */
export function formatSessionTimeFull(isoOrDate: string | Date): string {
  const t = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(t.getTime())) return "";
  return `${t.getFullYear()}/${t.getMonth() + 1}/${t.getDate()} ${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
}
