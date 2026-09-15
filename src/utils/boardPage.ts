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

export interface NodePageData {
  /** 页面标题（页头大字） */
  title: string;
  /** 页面背景图 */
  image: string;
  /** 面包屑，最后一项没有 url */
  trail: { title: string; url?: string }[];
  /** 下一层入口 */
  children: { title: string; url: string }[];
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

  return {
    title: flat.node.title,
    // 页面背景：没有自己的图就沿用所属大板块的
    image: flat.node.image ?? topBoardImage(all, flat.boardId),
    trail: flat.trail.map((n, i, arr) => {
      const f = all.find((x) => x.node === n);
      const last = i === arr.length - 1;
      return last ? { title: n.title } : { title: n.title, url: f?.url };
    }),
    children: (flat.node.children ?? []).map((c) => ({
      title: c.title,
      url: all.find((x) => x.node === c)?.url ?? '/',
    })),
    posts: posts[flat.node.id] ?? [],
  };
}

function topBoardImage(all: FlatNode[], boardId: string): string {
  const board = all.find((f) => f.depth === 0 && f.boardId === boardId);
  return board?.node.image ?? '';
}
