/**
 * `/cistern.json` —— 涣愿终池那张「哪一天有什么」的倒排表。
 *
 * 为什么要吐成 JSON 而不是直接烘进页面：
 * 用户要的是「**每天都会更新**，今天的页面明天就被盖掉」。
 * 站点是静态的，构建那一天算出来的"今天"过两天就错了 ——
 * 所以真正的"今天"必须在**浏览器里**算，页面脚本 fetch 这一份再挑那天。
 * （首页那条「每日精华」用的是同一套办法，见 pages/salon.json.ts。）
 *
 * 内容全由 `utils/cistern.ts` 一处算（构建期和浏览器吃的是同一张表）。
 */
import type { APIRoute } from 'astro';
import { cisternIndex } from '../utils/cistern';

export const prerender = true;

export const GET: APIRoute = async () => {
  const index = await cisternIndex();
  return new Response(JSON.stringify(index), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      /*
        一天一刷就够：跨天之后浏览器才会重新取。
        别设成 no-store —— 用户来回翻这一页不必每次都下这 200KB。
      */
      'cache-control': 'public, max-age=1800',
    },
  });
};
