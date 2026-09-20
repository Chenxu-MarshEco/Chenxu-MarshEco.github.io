/**
 * 「每日精华」的挑法 —— 单独放一个文件，因为**构建期和浏览器里都要用同一套**。
 *
 * 为什么不能放在 utils/salon.ts 里让首页脚本直接 import：
 * 那个文件 import 了 227KB 的 salon.json，一进客户端 bundle 就白搭。
 * 所以把"按日期挑第几条"这点纯计算抽出来，两边共用，保证服务端先渲染的
 * 那条和浏览器里重挑的那条是**同一条**（不一致的话页面会闪一下换内容）。
 *
 * 挑法：把日期字符串哈希成一个数，再对条数取模。
 *   · 同一天：永远是同一条（刷新不变）
 *   · 换一天：自动换一条（不需要重新构建站点）
 * 不是"真随机"，但对"每天一条"来说这正是想要的确定性。
 */
export function dailyIndex(dateStr: string, count: number): number {
  if (count <= 0) return -1;
  let h = 2166136261;
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % count;
}

/** 本地日期 -> YYYY-MM-DD（不能用 toISOString：那是 UTC，晚上会差一天） */
export function localDateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
