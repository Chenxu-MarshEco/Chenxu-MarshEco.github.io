/**
 * 音乐 / 歌单的取数逻辑（构建期跑，产出给页面内联的一小包数据）。
 *
 * 数据结构见 src/data/music.json：
 *   { tracks: [{id,title,src}], pages: { <页面key>: { first, list } } }
 *
 * 「页面 key」是全站唯一的页面编号，编辑器和管理页共用同一套规则：
 *   home                        首页
 *   list:posts|notes|archive|tags|friends|about   列表页
 *   board:<板块地址去掉首尾斜杠>  大板块树里的页面（地址算法与 utils/boards.ts 一致）
 *   entry:posts:<文件名> / entry:notes:<文件名>    文章 / 手记详情页
 *   *                           所有页面通用歌单（页面自己没有歌单时的兜底）
 *
 * 播放器要跨页面判断「下一首是不是同一首」，所以除了本页歌单，还得知道
 * **别的页面各自认领的第一首是什么**。这些都在构建期算好，页面里内联一份，
 * 前端不再请求任何接口。
 */
import rawMusic from '../data/music.json';
import site from '../site.config';
import { flattenBoards, type BoardNode } from './boards';
import { entryUrl, getNotes, getPosts } from './content';

export interface MusicTrack {
  id: string;
  title: string;
  src: string;
  bytes?: number;
  addedAt?: string;
}

export interface Playlist {
  /** 进入这一页一定第一首播的那首；null = 没选定 */
  first: string | null;
  list: string[];
}

interface MusicFile {
  tracks?: MusicTrack[];
  pages?: Record<string, Playlist>;
}

/** 通用歌单用的伪页面 key */
export const ALL_PAGES_KEY = '*';

const DATA = rawMusic as MusicFile;

const TRACKS: MusicTrack[] = Array.isArray(DATA.tracks)
  ? DATA.tracks.filter((t) => t && typeof t.id === 'string' && typeof t.src === 'string')
  : [];

const PAGES: Record<string, Playlist> =
  DATA.pages && typeof DATA.pages === 'object' && !Array.isArray(DATA.pages) ? DATA.pages : {};

const BY_ID = new Map(TRACKS.map((t) => [t.id, t]));

/** 站点里的定长列表页（编辑器列页面清单时也用这一份） */
export const LIST_PAGES: { name: string; label: string; href: string }[] = [
  { name: 'posts', label: '文章列表', href: '/posts/' },
  { name: 'notes', label: '手记列表', href: '/notes/' },
  { name: 'archive', label: '归档', href: '/archive/' },
  { name: 'tags', label: '标签', href: '/tags/' },
  { name: 'friends', label: '友链', href: '/friends/' },
  { name: 'about', label: '关于', href: '/about/' },
];

/**
 * 地址归一化：去掉 base、查询串、锚点、末尾斜杠。
 * 归一化之后 `/posts/a/` 和 `/posts/a` 是同一个键，
 * 不然浏览器地址栏里的写法一变，「下一首是不是同一首」就判断错了。
 */
export function normalizePath(pathname: string): string {
  let p = String(pathname ?? '/').trim();
  const q = p.search(/[?#]/);
  if (q >= 0) p = p.slice(0, q);
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  if (base && p.startsWith(base)) p = p.slice(base.length) || '/';
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/+$/, '');
  return p || '/';
}

export function boardMusicKey(url: string): string {
  return `board:${normalizePath(url).replace(/^\//, '')}`;
}

export function entryMusicKey(collection: string, id: string): string {
  return `entry:${collection}:${id}`;
}

export function listMusicKey(name: string): string {
  return `list:${name}`;
}

/**
 * **其它页面**（既不是大板块页、也不是定长列表页 / 文章页）的 key。
 *
 * 用户 2026-09-22 的原话：「编辑器里的每一个带有编辑页面能力的功能都应该能修改到
 * 所有页面！！！例如我现在根本无法在音乐页面中为冰室冰山，冰室精华，隐秘页面等页面
 * 添加音乐！请把这些目前无法用编辑器互动的页面也加入到编辑器里」。
 *
 * 以前这些页面的 key 算出来是 null，只能落到「所有页面（通用歌单）」，没法单独配。
 * 现在按地址给每个页面一个自己的 key（`/iceberg/` → `page:iceberg`），
 * 编辑器那边会把构建出来的每一页都列出来（见 server.mjs 的 musicPages）。
 */
export function pageMusicKey(path: string): string {
  return `page:${normalizePath(path).replace(/^\//, '')}`;
}

export interface MusicPageRef {
  key: string;
  label: string;
  /** 站内地址；通用歌单是空串（它不对应某个真实页面） */
  href: string;
  kind: 'all' | 'home' | 'list' | 'board' | 'entry';
}

/** 全站所有能挂歌单的页面（构建期枚举一遍，顺便给编辑器当清单） */
export async function allMusicPages(): Promise<MusicPageRef[]> {
  const out: MusicPageRef[] = [
    { key: ALL_PAGES_KEY, label: '所有页面（通用歌单）', href: '', kind: 'all' },
    { key: 'home', label: '首页', href: '/', kind: 'home' },
  ];
  for (const p of LIST_PAGES) {
    out.push({ key: listMusicKey(p.name), label: p.label, href: p.href, kind: 'list' });
  }
  // 链接版块点了直接跳外站，站里没有它的页面，不能挂歌单
  for (const f of flattenBoards(site.homeBoards as BoardNode[])) {
    if (f.external) continue;
    out.push({
      key: boardMusicKey(f.url),
      label: f.node.title || f.url,
      href: f.url,
      kind: 'board',
    });
  }
  const [posts, notes] = await Promise.all([getPosts(), getNotes()]);
  for (const e of posts) {
    out.push({ key: entryMusicKey('posts', e.id), label: e.data.title, href: entryUrl(e), kind: 'entry' });
  }
  for (const e of notes) {
    out.push({ key: entryMusicKey('notes', e.id), label: e.data.title, href: entryUrl(e), kind: 'entry' });
  }
  return out;
}

/**
 * 地址 -> 页面 key。
 * 先精确匹配；匹配不到就一层层往上退（`/tags/某标签` 退到 `/tags`，
 * 于是每个标签页都自动用「标签」那条歌单，不用逐页配）。
 * 一层都没命中（`/iceberg/`、`/salon/`、`/about-me/` 这种「其它页面」）
 * 就退回**它自己的页面 key**（`page:iceberg`）—— 这样这些页面也能单独配歌单；
 * 自己没配的话 `playlistFor` 照样落到通用歌单，行为和以前一样。
 */
export function musicKeyForPath(pathname: string, pages: MusicPageRef[]): string | null {
  const map = new Map<string, string>();
  for (const r of pages) {
    if (!r.href) continue;
    map.set(normalizePath(r.href), r.key);
  }
  const own = normalizePath(pathname);
  let cur = own;
  for (;;) {
    const hit = map.get(cur);
    if (hit) return hit;
    const i = cur.lastIndexOf('/');
    if (i <= 0) break;
    cur = cur.slice(0, i);
  }
  return own && own !== '/' ? pageMusicKey(own) : null;
}

/**
 * 这一页实际的歌单。
 * 自己那份非空就用自己的，否则退回通用歌单（`*`）。
 * first 不在 list 里的话补进歌单开头 —— 不然「选定第一首」会在随机轮播里丢掉。
 */
export function playlistFor(key: string | null): { first: MusicTrack | null; tracks: MusicTrack[] } {
  const own = key ? PAGES[key] : undefined;
  const generic = PAGES[ALL_PAGES_KEY];
  const ownOk = !!own && ((own.list?.length ?? 0) > 0 || !!own.first);
  const use = ownOk ? own : generic;

  const tracks: MusicTrack[] = [];
  for (const id of use?.list ?? []) {
    const t = BY_ID.get(id);
    if (t && !tracks.includes(t)) tracks.push(t);
  }
  const first = use?.first ? BY_ID.get(use.first) ?? null : null;
  if (first && !tracks.includes(first)) tracks.unshift(first);
  return { first, tracks };
}

export interface MusicContext {
  /** 这一页的 key；认不出来就是 null（只可能用上通用歌单） */
  key: string | null;
  /** 这一页的歌单 */
  tracks: MusicTrack[];
  /** 进入这一页一定第一首播的那首；null = 没选定 */
  first: MusicTrack | null;
  /**
   * 每个页面 key -> 它认领的第一首的**地址**（null = 有歌单但没选定第一首）。
   * 跨页面时用它判断「下一首是不是我正在听的这首」。
   */
  pageFirst: Record<string, string | null>;
  /** 归一化地址 -> 页面 key，前端点链接时反查目标页 */
  map: Record<string, string>;
}

/** 这一页要内联给播放器的全部数据；返回 null 表示这一页没有歌单（不出按钮、不播） */
export async function musicContext(currentPath: string): Promise<MusicContext | null> {
  const pages = await allMusicPages();
  const key = musicKeyForPath(currentPath, pages);
  const { first, tracks } = playlistFor(key);
  if (!tracks.length) return null;

  const map: Record<string, string> = {};
  for (const r of pages) {
    if (!r.href) continue;
    map[normalizePath(r.href)] = r.key;
  }
  /*
    「其它页面」的 key（page:xxx）也得进这张表：播放器判断「目标页第一首是不是我正在
    听的那首」靠它反查。这些页面不在 allMusicPages 的清单里（构建期看不到 dist），
    但**用户配过歌单的**都在 PAGES 里 —— 从 key 反推地址就够用了。
  */
  for (const k of Object.keys(PAGES)) {
    if (!k.startsWith('page:')) continue;
    const p = normalizePath(`/${k.slice('page:'.length)}`);
    if (p && !map[p]) map[p] = k;
  }

  const pageFirst: Record<string, string | null> = {};
  const keys = new Set<string>([...Object.keys(PAGES), ALL_PAGES_KEY]);
  for (const k of keys) {
    const p = playlistFor(k);
    if (p.tracks.length) pageFirst[k] = p.first ? p.first.src : null;
  }

  return { key, tracks, first, pageFirst, map };
}
