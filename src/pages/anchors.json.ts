/**
 * 把每页能跳的锚点导出成 dist/anchors.json。
 *
 * 用途：编辑器里凡是填**地址**的地方（正文链接、地图图钉、时间轴的点/段、
 * 导航条目），都能先选页面、再选"落到这一页的哪儿"，不用凭记忆手打
 * `#桑芙` 这种锚点 —— 手打错了就是跳到页面顶部，看着像功能坏了。
 *
 * 规则只有一处（utils/anchors.ts，和页面渲染共用），这里只负责把
 * 「所有会生成页面的节点」和它们的块喂进去，不额外定义任何东西。
 */
import type { APIRoute } from 'astro';
import site from '../site.config';
import { flattenBoards, type BoardNode } from '../utils/boards';
import { blockAnchors } from '../utils/anchors';

export const prerender = true;

export const GET: APIRoute = async () => {
  const pages = flattenBoards(site.homeBoards as BoardNode[])
    // 链接版块没有自己的页面（点了直接跳到别处），不参与
    .filter((f) => !f.external)
    .map((f) => ({
      /** 页面地址（站内原样，编辑器存进链接字段用；base 由站点渲染时补） */
      href: f.url,
      /** 页面标题（面板里给人看） */
      title: f.node.title,
      /** 这一页在编辑器的哪个位置：方便面板里排序、也方便人找 */
      board: f.boardId,
      depth: f.depth,
      anchors: blockAnchors(
        f.node.page ?? [],
        /* 单张卡 / 卡片框里存的是子页面 id，面板上要显示名字（见 utils/anchors.ts 的 blockLabel） */
        new Map((f.node.children ?? []).map((k) => [k.id, k.title]))
      ),
    }))
    // 没有自己写内容的页面（比如纯卡片的目录页）没什么可跳的，不占位置
    .filter((p) => p.anchors.length > 0);

  return new Response(
    JSON.stringify(
      {
        count: pages.length,
        totalAnchors: pages.reduce((n, p) => n + p.anchors.length, 0),
        pages,
      },
      null,
      2
    ),
    { headers: { 'content-type': 'application/json; charset=utf-8' } }
  );
};
