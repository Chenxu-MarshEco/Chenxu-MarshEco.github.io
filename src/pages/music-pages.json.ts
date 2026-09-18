/**
 * 把「全站可挂歌单的页面清单」输出成 dist/music-pages.json。
 *
 * 这份清单是站点自己按地址规则算出来的（见 utils/music.ts），
 * 本地编辑器的「音乐」面板用它跟自己的那份对照，确认两边认的是同一批页面 key ——
 * 页面对不上，歌单就会挂到不存在的键上，页面上什么都不会响。
 *
 * 页面 key 的算法只有一份（utils/music.ts），这里只是把它导出成 JSON，
 * 不额外定义任何规则。
 */
import type { APIRoute } from 'astro';
import { allMusicPages, musicKeyForPath, playlistFor } from '../utils/music';

export const prerender = true;

export const GET: APIRoute = async () => {
  const pages = await allMusicPages();
  const out = pages.map((p) => {
    const { first, tracks } = playlistFor(p.key);
    return {
      key: p.key,
      label: p.label,
      href: p.href,
      kind: p.kind,
      // 站点自己按地址反查这个页面，应该正好查到它自己的 key
      resolved: musicKeyForPath(p.href || '/', pages),
      songs: tracks.length,
      first: first ? first.title : null,
    };
  });
  return new Response(JSON.stringify({ count: out.length, pages: out }, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};
