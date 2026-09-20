/**
 * 把「导航分类库」导出成 dist/nav-categories.json。
 *
 * 用途和 dist/music-pages.json 一样：让本地编辑器的「导航」面板能拿站点这份
 * 跟它自己算的那份对照 —— 分类 id 对不上，页面里引用的就是空引用。
 *
 * 规则只有一处（utils/navs.ts），这里只是导出，不额外定义任何东西。
 */
import type { APIRoute } from 'astro';
import { navCategories, countNavItems } from '../utils/navs';

export const prerender = true;

export const GET: APIRoute = async () => {
  const out = navCategories.map((c) => ({
    id: c.id,
    title: c.title,
    note: c.note ?? '',
    groups: c.groups.length,
    items: countNavItems(c),
    /** 每个子分类各有多少条目，面板里想显示细一点时用得上 */
    detail: c.groups.map((g) => ({ id: g.id, title: g.title, items: g.items.length })),
  }));
  return new Response(
    JSON.stringify({ count: out.length, categories: out, totalItems: out.reduce((n, c) => n + c.items, 0) }, null, 2),
    { headers: { 'content-type': 'application/json; charset=utf-8' } }
  );
};
