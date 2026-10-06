/**
 * 「曼沫砾总线」（本站公告栏）的工具函数。
 *
 * 数据结构见 src/data/announcements.json（编辑器「公告」面板写的就是它）：
 * 一份清单，每条要么是**事项公告**（有正文，自己一页），要么是**更新提醒公告**
 * （一句话 + 一个去处，不生成页面）。
 *
 * 这个文件只做三件事：洗干净、排好序、算出「点它去哪」。
 * 站点那边（首页板块卡 / 公告栏页 / 单条公告页）和编辑器那边的规矩必须一致，
 * 所以地址规则只写在这里一处 —— 编辑器保存时算一遍、站点渲染时再算一遍，
 * 两边算出来的东西不一样的话，列表里点进去就是 404。
 */
import raw from '../data/announcements.json';
import { withBase } from './url';

/** 公告的两种：事项公告 / 更新提醒公告 */
export type AnnounceKind = 'notice' | 'update';

export interface Announcement {
  id: string;
  kind: AnnounceKind;
  /** YYYY-MM-DD，排序和显示都用它 */
  date: string;
  title: string;
  /** 事项公告的正文（Markdown）；更新提醒公告恒为空串 */
  body: string;
  /** 可选封面图（public 下的路径） */
  cover: string;
  /** 更新提醒公告的去处；事项公告恒为空串 */
  href: string;
}

/** 事项公告在站内的地址（更新提醒公告没有页面，不走这里） */
export const NOTICE_BASE = '/zongxian';
/** 公告栏自己那一页 */
export const ANNOUNCE_BOARD = `${NOTICE_BASE}/`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v: unknown): string => String(v ?? '').trim();

/**
 * 洗干净一条。
 *
 * 认不出来的（没标题 / 没 id / 日期不是 YYYY-MM-DD）直接丢掉 ——
 * 日期不合法的话排序会乱、首页那张卡上还会出现一个空日期；
 * 没有标题的一条在页面上就是一行空白，纯属噪音。
 *
 * kind 只认这两个值，别的当事项公告（老数据没有这个字段时就是它）。
 * 两个字段互相排斥：事项公告不留 href、更新公告不留正文，
 * 免得出现「一条既跳出去又有正文」的自相矛盾状态。
 */
function normalize(item: unknown): Announcement | null {
  if (!item || typeof item !== 'object') return null;
  const raw = item as Record<string, unknown>;
  const id = str(raw.id);
  const title = str(raw.title);
  const date = str(raw.date);
  if (!id || !title || !DATE_RE.test(date)) return null;

  const kind: AnnounceKind = raw.kind === 'update' ? 'update' : 'notice';
  if (kind === 'update') {
    return { id, kind, date, title, body: '', cover: '', href: str(raw.href) };
  }
  return { id, kind, date, title, body: String(raw.body ?? ''), cover: str(raw.cover), href: '' };
}

/**
 * 全部公告，新的在前。
 *
 * 排序只按日期倒序，**同一天里保持文件里的顺序**（Array.sort 是稳定的）——
 * 一天里想怎么排就怎么排，不用去凑 id 或者时间。
 */
export function announceList(): Announcement[] {
  const items = Array.isArray((raw as { items?: unknown[] }).items) ? (raw as { items: unknown[] }).items : [];
  return items
    .map(normalize)
    .filter((x): x is Announcement => x !== null)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** 公告栏这一块自己的名字和首页显示条数 */
export function announceBoard(): { title: string; subtitle: string; latest: number; updated: string } {
  const cfg = raw as { title?: string; subtitle?: string; latest?: number; updated?: string };
  const latest = Number(cfg.latest);
  return {
    title: str(cfg.title) || '曼沫砾总线',
    subtitle: str(cfg.subtitle),
    latest: Number.isFinite(latest) && latest > 0 ? Math.min(Math.floor(latest), 20) : 5,
    updated: str(cfg.updated),
  };
}

/** 首页板块卡上要显示的那几条 */
export function latestAnnounces(): Announcement[] {
  const { latest } = announceBoard();
  return announceList().slice(0, latest);
}

/** 有正文的事项公告（单条公告页按这个生成） */
export function noticeAnnounces(): Announcement[] {
  return announceList().filter((a) => a.kind === 'notice');
}

/** 站内地址补上 base；站外原样返回 */
export const siteHref = (href: string): string => (/^https?:/i.test(href) ? href : withBase(href));

/**
 * 这一条点下去去哪 —— 列表、首页板块卡、单条公告页的「相邻公告」都用这一个。
 * 事项公告进它自己的页；更新提醒公告直接去 href（没填 href 就返回空串，
 * 页面上会把它画成不可点的一条）。
 */
export function announceHref(item: Announcement): string {
  if (item.kind === 'notice') return siteHref(`${NOTICE_BASE}/${item.id}/`);
  return item.href ? siteHref(item.href) : '';
}

/** 站外链接要新开标签页（站内的不） */
export const announceExternal = (item: Announcement): boolean =>
  item.kind === 'update' && /^https?:/i.test(item.href);

/** 两种公告在界面上的名字 */
export const ANNOUNCE_KIND_LABEL: Record<AnnounceKind, string> = {
  notice: '事项公告',
  update: '更新提醒',
};

/** 「2026-10-06」→「2026 年 10 月 6 日」，列表和详情页上显示用 */
export function announceDateText(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return `${m[1]} 年 ${Number(m[2])} 月 ${Number(m[3])} 日`;
}

/** 按年月分组，给公告栏页当小标题用 */
export function announceGroups(items: Announcement[] = announceList()): { key: string; label: string; items: Announcement[] }[] {
  const map = new Map<string, Announcement[]>();
  for (const it of items) {
    const key = it.date.slice(0, 7);
    const list = map.get(key) ?? [];
    list.push(it);
    map.set(key, list);
  }
  return [...map.entries()].map(([key, list]) => {
    const [y, m] = key.split('-');
    return { key, label: `${y} 年 ${Number(m)} 月`, items: list };
  });
}
