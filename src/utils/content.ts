/**
 * 内容查询工具。
 *
 * 页面里统一用这里的函数取数据，好处是：
 *  - 草稿过滤、排序规则只写一次，全站一致；
 *  - 以后想改排序方式（比如改成置顶优先 + 日期倒序），只改这里。
 */

import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;
export type Note = CollectionEntry<'notes'>;
export type AnyEntry = Post | Note;

/** 开发模式下显示草稿，正式构建时隐藏。这样本地预览和线上表现一致 */
const SHOW_DRAFTS = import.meta.env.DEV;

/** 按日期倒序；置顶的排最前，置顶之间按 pinned 数值再按日期 */
export function sortEntries<T extends AnyEntry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const pinA = 'pinned' in a.data ? (a.data.pinned as number) : 0;
    const pinB = 'pinned' in b.data ? (b.data.pinned as number) : 0;
    if (pinA !== pinB) return pinB - pinA;
    return b.data.date.getTime() - a.data.date.getTime();
  });
}

/** 取全部文章（已过滤草稿并排好序） */
export async function getPosts(): Promise<Post[]> {
  const all = await getCollection('posts', ({ data }) => SHOW_DRAFTS || !data.draft);
  return sortEntries(all);
}

/** 取全部手记 */
export async function getNotes(): Promise<Note[]> {
  const all = await getCollection('notes', ({ data }) => SHOW_DRAFTS || !data.draft);
  return sortEntries(all);
}

/** 统计标签出现次数，按次数倒序 */
export function collectTags(entries: AnyEntry[]): { tag: string; count: number }[] {
  const map = new Map<string, number>();
  for (const entry of entries) {
    for (const tag of entry.data.tags ?? []) {
      map.set(tag, (map.get(tag) ?? 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-Hans-CN'));
}

/** 按标签筛选 */
export function filterByTag<T extends AnyEntry>(entries: T[], tag: string): T[] {
  return entries.filter((e) => (e.data.tags ?? []).includes(tag));
}

/** 按年份分组，用于归档页 */
export function groupByYear(entries: AnyEntry[]): { year: number; items: AnyEntry[] }[] {
  const map = new Map<number, AnyEntry[]>();
  for (const entry of entries) {
    const year = entry.data.date.getUTCFullYear();
    const list = map.get(year) ?? [];
    list.push(entry);
    map.set(year, list);
  }
  return [...map.entries()]
    .map(([year, items]) => ({ year, items: sortEntries(items) }))
    .sort((a, b) => b.year - a.year);
}

/** 估算阅读时长（分钟）。中文按 350 字/分钟粗算 */
export function readingTime(body: string | undefined): number {
  if (!body) return 1;
  // 去掉代码块，避免被代码里的字符数拉高
  const text = body.replace(/```[\s\S]*?```/g, '');
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  const words = (text.match(/[A-Za-z0-9]+/g) ?? []).length;
  return Math.max(1, Math.round(cjk / 350 + words / 200));
}

/** 取纯文本摘要：优先用 frontmatter 的 summary，没有就从正文里截 */
export function excerpt(entry: AnyEntry, maxLength = 120): string {
  const summary = (entry.data as { summary?: string }).summary;
  if (summary) return summary;
  const body = (entry as { body?: string }).body ?? '';
  const text = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`_~-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/** 文章的 URL。文章在 /posts/xxx/，手记在 /notes/xxx/ */
export function entryUrl(entry: AnyEntry): string {
  const base = entry.collection === 'posts' ? '/posts' : '/notes';
  return `${base}/${entry.id}/`;
}

/** 取相邻的上一篇 / 下一篇（输入需已按时间倒序） */
export function neighbors<T extends AnyEntry>(entries: T[], id: string) {
  const index = entries.findIndex((e) => e.id === id);
  if (index === -1) return { prev: null, next: null };
  // entries 是新的在前，所以 index-1 是更新的那篇
  return {
    prev: index > 0 ? entries[index - 1] : null,
    next: index < entries.length - 1 ? entries[index + 1] : null,
  };
}
