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
  /* 首页最上面那两块大的（聊天室 / 久昭卿茶绘），见下面 halls() */
  halls?: unknown;
  /* 页面上那些「介绍 / 提示」文字，见下面 copy() */
  copy?: unknown;
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

/* ---------------------------------------------------------------- 大厅 */

/**
 * 「大厅」= 论坛首页最上面那两块大的（2026-10-09 用户要求）。
 *
 * 用户原话：「在黎语堂首页增加两个大板块 板块大小类似于花涧堂的甬城晴雨和花娅陌域
 * 剩下的可以自由添加的小版块全部都排列在它们下面 且每行排列四个」。
 *
 * 所以版式上分两层，数据也分两处：
 *   · `halls`（这个）—— 固定两块大的：聊天室、久昭卿茶绘，**不是**版块，不发帖，
 *     点进去是各自那个页面（聊天室 / 画板）；
 *   · `boards`（上面那张表）—— 站长随手加的小版块，排在两块大的下面、一行四个。
 *
 * 和 boards 的区别不只是"大"：大厅有背景图和自己的一句话说明，而且它的 href 是
 * **写死的站内路径**（不是 `<id>/`），因为聊天室和画板都是独立页面、不是版块页。
 */
export interface Hall {
  id: string;
  title: string;
  desc: string;
  icon: string;
  /** 背景图（public 下的路径，例如 /img/uploads/xxx.webp）；留空就用皮肤自带的渐变 */
  image: string;
  href: string;
}

/** 大厅表（洗法和 boards 一样：没 id / 没标题 / id 不合法的丢掉） */
export function halls(): Hall[] {
  const list = Array.isArray(cfg.halls) ? cfg.halls : [];
  const out: Hall[] = [];
  const seen = new Set<string>();
  for (const h of list) {
    if (!h || typeof h !== 'object') continue;
    const one = h as Record<string, unknown>;
    const id = str(one.id);
    const title = str(one.title);
    if (!id || !title || !/^[a-z0-9][a-z0-9-]*$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title,
      desc: str(one.desc),
      icon: str(one.icon),
      image: str(one.image),
      /* 地址以 / 开头就补 base，写成整条网址就原样用 */
      href: withBase(str(one.href) || `/liyutang/${id}/`),
    });
  }
  return out;
}

export const hallById = (id: string): Hall | null => halls().find((h) => h.id === id) ?? null;

/* ------------------------------------------------------------ 页面文案 */

/**
 * 页面上那些「介绍 / 提示」文字 —— **一律由站长在编辑器里填**（`liyutang.json` 的 `copy` 区）。
 *
 * 为什么要有这么一块（2026-10-09，用户原话，语气很重）：
 *   「当前的黎语堂网站里充斥着过多你自己胡编乱造的提示和简介 …… 这些句子可读性极差！！！
 *    对群友理解各个功能造成了极大的影响！！！！！请你全部删掉全部这一类你自己生造的句子
 *    并且给对应的位置留下编辑器接口以方便我去填写介绍和简介」。
 *
 * 所以规矩是硬的，改这一块之前先读三遍：
 *   · 页面代码里**一个字都不许写死**介绍 / 引导文字 —— 全从这个接口读；
 *   · **缺字段、字段为空串 → 都返回空串**，页面上那一块就**整块不渲染**
 *     （不留空 `<p>`、不留占位句子、也不许在代码里写兜底文案）；
 *   · 状态与报错（"还没有存档。"、"账号还在等站长审核"那一类）**不走这里** ——
 *     它们是"能不能做 / 出了什么事"，得由程序自己说，但要短、只讲事实。
 *
 * 键名和页面的对应关系（编辑器「页面文案」面板里的标签写的就是这个）：
 *   board.lead/hint/note/empty → /liyutang/teahouse/ 茶绘画板页
 *                                （empty = 「今天画过画的人」那一栏空着时那句）
 *   chat.lead/hint/note   → 聊天室三页（今天 / 搜历史 / 某一天存档）
 *   calendar.lead         → /liyutang/teahouse/calendar/ 画过的日子
 *   user.lead             → /liyutang/u/ 用户页
 *   home.lead/note        → /liyutang/ 首页（顶部引导 / 「发帖」旁边那行）
 *   post.hint/desc        → /liyutang/post/ 帖子页（作者那一行 / 搜索结果里那句描述）
 *   new.hint/desc         → /liyutang/new/ 发帖页（没有版块时那句 / 搜索结果里那句描述）
 *
 * ⚠ `*.desc` 是 `<meta name="description">` / `og:description`：页面正文里看不到，
 *   但它会出现在搜索结果和分享卡片上 —— 同样是"被写死就没法改"的文案，一样归站长填；
 *   留空就退回站点总描述（见 layouts/ForumLayout.astro 里 `description = site.description` 那个默认值）。
 */
export interface SiteCopy {
  board: { lead: string; hint: string; note: string; empty: string };
  chat: { lead: string; hint: string; note: string };
  calendar: { lead: string };
  user: { lead: string };
  home: { lead: string; note: string };
  post: { hint: string; desc: string };
  new: { hint: string; desc: string };
}

/** 洗一个分组：不是对象的当空对象，值一律 trim 成字符串（`undefined` → 空串，绝不给默认文案） */
function copyGroup(v: unknown, keys: string[]): Record<string, string> {
  const src = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = str(src[k]);
  return out;
}

/** 页面文案表（写法和 boards() / halls() 一样：读进来、洗一遍、缺什么给空串） */
export function copy(): SiteCopy {
  const c = cfg.copy && typeof cfg.copy === 'object' ? (cfg.copy as Record<string, unknown>) : {};
  const board = copyGroup(c.board, ['lead', 'hint', 'note', 'empty']);
  const chat = copyGroup(c.chat, ['lead', 'hint', 'note']);
  return {
    board: board as SiteCopy['board'],
    chat: chat as SiteCopy['chat'],
    calendar: copyGroup(c.calendar, ['lead']) as SiteCopy['calendar'],
    user: copyGroup(c.user, ['lead']) as SiteCopy['user'],
    home: copyGroup(c.home, ['lead', 'note']) as SiteCopy['home'],
    post: copyGroup(c.post, ['hint', 'desc']) as SiteCopy['post'],
    new: copyGroup(c.new, ['hint', 'desc']) as SiteCopy['new'],
  };
}

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
