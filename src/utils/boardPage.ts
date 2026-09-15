/**
 * 把大板块树里的一个节点，装配成页面需要的全部数据。
 *
 * 两个路由（/[board]/ 和 /[board]/[...path]/）都调这里，
 * 保证两边的取数逻辑完全一致。
 */
import { getNotes, getPosts } from './content';
import { toISODate } from './date';
import { flattenBoards, type BoardNode, type FlatNode } from './boards';
import site from '../site.config';

export interface SubPost {
  title: string;
  href: string;
  date: string;
}

/**
 * 版块页上的一个「框」（子版块）。
 *
 * 两种形态都是它：
 *   有 kids  → 一个面板，里面是子版块的卡片清单（可独立滚动）
 *   没有 kids → 一张封面大卡，整块可点，直接进它自己的页面
 */
export interface BlockItem {
  id: string;
  title: string;
  url: string;
  subtitle?: string;
  /** 自己的封面图；没设就交给样式用渐变兜底（不要回落到大板块的图，会和 hero 重复） */
  image?: string;
  /** 它下面的子版块，用来在框里铺卡片 */
  kids: { title: string; url: string; subtitle?: string; image?: string }[];
}

export interface NodePageData {
  /** 页面标题（页头大字） */
  title: string;
  /** 页面背景图 */
  image: string;
  /** 面包屑，最后一项没有 url */
  trail: { title: string; url?: string }[];
  /**
   * 上一级。顶层大板块没有上一级（那就在页面上回首页）。
   * 单独给一份而不是让页面自己从 trail 里取倒数第二项 ——
   * 路径推导只有一处（utils/boards.ts），这里也一样，别让调用方各自猜。
   */
  parent: { title: string; url: string } | null;
  /** 下一层入口（版块页会把它排成一块块的面板） */
  children: BlockItem[];
  /** 归到本节点的文章 */
  posts: SubPost[];
}

/** 所有节点的 id -> 该节点下的文章。构建时算一次就够。 */
async function articlesByNode(): Promise<Record<string, SubPost[]>> {
  const map: Record<string, SubPost[]> = {};

  for (const entry of [...(await getPosts()), ...(await getNotes())]) {
    for (const sub of entry.data.subs ?? []) {
      (map[sub] ??= []).push({
        title: entry.data.title,
        href: entry.collection === 'posts' ? `/posts/${entry.id}/` : `/notes/${entry.id}/`,
        date: toISODate(entry.data.date).slice(5),
      });
    }
  }
  return map;
}

/** 按 URL 组一个节点的页面数据 */
export async function nodePageData(url: string): Promise<NodePageData | null> {
  const all = flattenBoards(site.homeBoards as BoardNode[]);
  const flat = all.find((f) => f.url === url);
  if (!flat) return null;

  const posts = await articlesByNode();
  const parentNode = flat.trail.length > 1 ? flat.trail[flat.trail.length - 2] : null;

  return {
    title: flat.node.title,
    // 页面背景：没有自己的图就沿用所属大板块的
    image: flat.node.image ?? topBoardImage(all, flat.boardId),
    trail: flat.trail.map((n, i, arr) => {
      const f = all.find((x) => x.node === n);
      const last = i === arr.length - 1;
      return last ? { title: n.title } : { title: n.title, url: f?.url };
    }),
    parent: parentNode
      ? { title: parentNode.title, url: all.find((x) => x.node === parentNode)?.url ?? '/' }
      : null,
    children: (flat.node.children ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      subtitle: c.subtitle,
      image: c.image,
      url: all.find((x) => x.node === c)?.url ?? '/',
      kids: (c.children ?? []).map((g) => ({
        title: g.title,
        subtitle: g.subtitle,
        image: g.image,
        url: all.find((x) => x.node === g)?.url ?? '/',
      })),
    })),
    posts: posts[flat.node.id] ?? [],
  };
}

function topBoardImage(all: FlatNode[], boardId: string): string {
  const board = all.find((f) => f.depth === 0 && f.boardId === boardId);
  return board?.node.image ?? '';
}
