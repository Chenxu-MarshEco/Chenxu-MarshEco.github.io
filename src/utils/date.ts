/**
 * 日期格式化工具。
 *
 * 统一用 UTC 取值，这样在本地构建和 GitHub Actions（UTC 时区）上
 * 生成的日期完全一致，不会出现"部署后日期差一天"的怪事。
 */

const pad = (n: number): string => String(n).padStart(2, '0');

/** 取日期的年 / 月 / 日 */
function parts(d: Date) {
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
  };
}

/** 2026-09-14 —— 用于 <time datetime=""> 和归档列表 */
export function toISODate(d: Date): string {
  const { y, m, d: day } = parts(d);
  return `${y}-${pad(m)}-${pad(day)}`;
}

/** 2026 年 9 月 14 日 —— 用于文章页 */
export function formatDateFull(d: Date): string {
  const { y, m, d: day } = parts(d);
  return `${y} 年 ${m} 月 ${day} 日`;
}

/** 09-14 —— 用于列表页这种空间紧张的地方 */
export function formatDateShort(d: Date): string {
  const { m, d: day } = parts(d);
  return `${pad(m)}-${pad(day)}`;
}

/** 2026-09 —— 用于按月归档 */
export function toYearMonth(d: Date): string {
  const { y, m } = parts(d);
  return `${y}-${pad(m)}`;
}

/** 相对时间：3 天前 / 2 个月前。只用于"最近更新"这类展示 */
export function relativeTime(d: Date, now: Date = new Date()): string {
  const diff = now.getTime() - d.getTime();
  const day = 86_400_000;

  if (diff < 0) return '就在刚刚';
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < day * 30) return `${Math.floor(diff / day)} 天前`;
  if (diff < day * 365) return `${Math.floor(diff / (day * 30))} 个月前`;
  return `${Math.floor(diff / (day * 365))} 年前`;
}
