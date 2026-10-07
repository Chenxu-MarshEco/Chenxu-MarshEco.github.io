/**
 * 黎语堂（/liyutang）的取数逻辑。
 *
 * 两份数据，各管各的：
 *   src/data/liyutang.json   —— 版块表 + 评论系统的配置（编辑器 /liyutang-admin 那个页面写它）
 *   src/content/liyutang/    —— 帖子正文（一个 .md 一个帖子，**所在目录就是版块**）
 *
 * 这个文件只做三件事：把配置洗干净、把版块列出来、把帖子按版块分组并排好序。
 * 站点那边（论坛首页 / 版块页 / 帖子页）和后面可能加的工具都读这里，规则只写一遍。
 */
import { getCollection, type CollectionEntry } from 'astro:content';
import raw from '../data/liyutang.json';
import { withBase } from './url';

export type Topic = CollectionEntry<'liyutang'>;

export interface Board {
  id: string;
  title: string;
  desc: string;
  icon: string;
  /**
   * 版块公告（站长写的 Markdown，显示在版块页顶部）。
   * 2026-10-07 晚上加的 —— 用户要求「编辑器端可以编辑各个板块，类似编辑主网站的页面」，
   * 光有标题和一句话说明不够，得能写一段带图带链接的公告。
   * ⚠ 它和用户发的帖子走**同一个渲染器**（src/utils/liyutang-md.mjs），
   *   所以公告里写 HTML 标签会原样显示成文字，不会当标签解释。
   */
  notice: string;
}

/** 评论系统的配置。四个 provider 里当前用 twikoo（见 liyutang.json 的 _readme） */
export interface ForumConfig {
  enabled: boolean;
  provider: 'twikoo' | 'waline' | 'giscus' | 'none';
  twikoo: { envId: string; region: string };
  waline: { serverURL: string };
  giscus: {
    repo: string;
    repoId: string;
    category: string;
    categoryId: string;
    mapping: string;
    lang: string;
  };
}

const str = (v: unknown): string => String(v ?? '').trim();

/** 开发时显示草稿，正式构建时隐藏（和 utils/content.ts 一个规矩） */
const SHOW_DRAFTS = import.meta.env.DEV;

const cfg = raw as unknown as {
  forum?: Record<string, unknown>;
  boards?: unknown;
};

export function forum(): ForumConfig {
  const f = (cfg.forum ?? {}) as Record<string, unknown>;
  const t = (f.twikoo ?? {}) as Record<string, unknown>;
  const w = (f.waline ?? {}) as Record<string, unknown>;
  const g = (f.giscus ?? {}) as Record<string, unknown>;
  const provider = ['twikoo', 'waline', 'giscus', 'none'].includes(str(f.provider))
    ? (str(f.provider) as ForumConfig['provider'])
    : 'none';
  return {
    enabled: f.enabled === true,
    provider,
    twikoo: { envId: str(t.envId), region: str(t.region) || 'ap-shanghai' },
    waline: { serverURL: str(w.serverURL) },
    giscus: {
      repo: str(g.repo),
      repoId: str(g.repoId),
      category: str(g.category) || 'Announcements',
      categoryId: str(g.categoryId),
      mapping: str(g.mapping) || 'pathname',
      lang: str(g.lang) || 'zh-CN',
    },
  };
}

/**
 * 评论区这会儿该不该挂出来？
 * 三种情况都算「不该」：总开关关着、选了 none、或者选了那一套但配置还空着
 * （空着就挂的话页面上会出现一个报错的空盒子，比不挂更难看）。
 */
export function commentsReady(): boolean {
  if (!forum().enabled) return false;
  const f = forum();
  if (f.provider === 'twikoo') return f.twikoo.envId !== '';
  if (f.provider === 'waline') return f.waline.serverURL !== '';
  if (f.provider === 'giscus') return f.giscus.repo !== '' && f.giscus.repoId !== '' && f.giscus.categoryId !== '';
  return false;
}

/** 版块表（洗一遍：没标题的、id 不合法的都丢掉，免得画出一个点不进去的卡片） */
export function boards(): Board[] {
  const list = Array.isArray(cfg.boards) ? cfg.boards : [];
  const out: Board[] = [];
  const seen = new Set<string>();
  for (const b of list) {
    if (!b || typeof b !== 'object') continue;
    const one = b as Record<string, unknown>;
    const id = str(one.id);
    const title = str(one.title);
    /* id 就是网址里那一段，所以只认小写字母数字和连字符 */
    if (!id || !title || !/^[a-z0-9][a-z0-9-]*$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title, desc: str(one.desc), icon: str(one.icon), notice: str(one.notice) });
  }
  return out;
}

export const boardById = (id: string): Board | null => boards().find((b) => b.id === id) ?? null;

/** 版块页 / 帖子页的地址 */
export const boardUrl = (id: string): string => withBase(`/liyutang/${id}/`);
export const topicUrl = (entry: Topic): string => withBase(`/liyutang/${entry.id}/`);

/** 这条帖子属于哪个版块 = 它的 id 里第一段路径 */
export const boardOf = (entry: Topic): string => entry.id.split('/')[0] ?? '';

/** 全部帖子（草稿在正式构建时滤掉） */
export async function allTopics(): Promise<Topic[]> {
  const all = await getCollection('liyutang', ({ data }) => SHOW_DRAFTS || !data.draft);
  /* 置顶优先，然后按日期倒序；同一天按 id 稳定排，保证构建可复现 */
  return [...all].sort((a, b) => {
    if (a.data.pinned !== b.data.pinned) return b.data.pinned - a.data.pinned;
    const d = b.data.date.getTime() - a.data.date.getTime();
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });
}

/** 某个版块里的帖子（顺序同上） */
export async function topicsOf(boardId: string): Promise<Topic[]> {
  return (await allTopics()).filter((t) => boardOf(t) === boardId);
}

/** 版块 → 帖子数（论坛首页每个卡片上要显示） */
export async function boardCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const b of boards()) out[b.id] = 0;
  for (const t of await allTopics()) {
    const id = boardOf(t);
    if (id in out) out[id] += 1;
  }
  return out;
}
