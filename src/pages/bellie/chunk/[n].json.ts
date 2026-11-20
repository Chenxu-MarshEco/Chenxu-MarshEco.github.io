/**
 * 精华页的**一簇**（`/salon/chunk/<n>.json`）。
 *
 * 为什么要这个接口（2026-11-20 站长）：
 *   「用户进入精华页还是十分慢 要加载很久 …… 把它由上到下切成好几个部分
 *     刚进入精华页时默认只加载出最新精华一部分的精华卡 直到用户继续上翻
 *     或是搜索跳转到对应精华时 才加载那个精华对应的精华卡部分」
 *
 * 所以页面自己只渲最新那一簇（`salonLastChunk()`），其余的簇由页面脚本按需取这里的
 * `html`（已经排好的标记，前端 `insertAdjacentHTML` 就行，不在浏览器里重建一份渲染器）。
 *
 * 字段：
 *   n / from / to   第几簇、覆盖的下标区间（半开 [from, to)）
 *   prev / next     上游 / 下游还有没有簇（没有就是 null）
 *   html            这一簇的完整标记（含跨簇的那两个年代 / 日期头，见 utils/salon-html.ts）
 */
import type { APIRoute } from 'astro';
import { essenceParams, salonTimelineId } from '../../../utils/bellie';
import { chunkHtml, chunkRange, bellieChunkCount as salonChunkCount } from '../../../utils/bellie-html';
import { getTimeline } from '../../../utils/timelines';

export const prerender = true;

/*
  时间轴上的位置要按页面选的那条轴算（`salon.json` 的 timelineId）——
  和页面首屏用的是同一套，取回来的条目才能和左边那条轴对上。
  没选轴就是空表：条目不带 data-tl-param，轴也不会去联动它们（页面本来就是这么退的）。
*/
const tl = salonTimelineId ? getTimeline(salonTimelineId) : undefined;
const PARAMS = tl ? essenceParams(tl) : new Map<string, number>();

export function getStaticPaths() {
  const total = salonChunkCount();
  return Array.from({ length: total }, (_, n) => ({ params: { n: String(n) } }));
}

export const GET: APIRoute = ({ params }) => {
  const n = Number(params.n);
  const total = salonChunkCount();
  if (!Number.isFinite(n) || n < 0 || n >= total) {
    return new Response(JSON.stringify({ error: 'no such chunk' }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  const { from, to } = chunkRange(n);
  return new Response(
    JSON.stringify({
      n,
      from,
      to,
      total,
      prev: n > 0 ? n - 1 : null,
      next: n < total - 1 ? n + 1 : null,
      html: chunkHtml(n, PARAMS),
    }),
    { headers: { 'content-type': 'application/json; charset=utf-8' } }
  );
};
