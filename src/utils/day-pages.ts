/**
 * 「这一天」——把文章 / 手记和首页的「涣源溪水钟」接起来（2026-10-06 加）。
 *
 * 用户原话：
 *   「将文章和手记与涣源溪水钟日记进行联动 在日期旁增加一个勾选项 使其能否通过
 *    涣源溪水钟日历直接跳转 例如2026.10.04这篇宁波那天在勾选后 首页的涣源溪水钟处
 *    点击2026.10.4对应的日期泡泡就可以直接跳转到这篇文章 如果有多篇文章同时认领
 *    这一天 则跳转到一个类似索引的页面处 可以查看这一天对应的所有文章」
 *
 * 所以规则就三条，**日历那位和 /day/ 那位必须用同一份判断**（都在这里算）：
 *   · 一篇文章认领这一天        → 日历上那一天直接进这篇文章；
 *   · 两篇以上认领同一天        → 进 /day/<日期>/（这一天所有文章的索引页）；
 *   · 这一天本来还是个特殊日子（生日那种，自带 href）→ 也进 /day/<日期>/，
 *     因为那一天的格子上只能有一个链接，索引页里两样都能给到（特殊日子一张卡 + 文章列表）。
 *
 * 认领的开关在 frontmatter 的 `calendar: true`（编辑器：日期旁边那个勾选框）。
 * 只有**显式勾了**的文章才会被认领 —— 不勾的文章照旧不在日历上出现。
 */
import widgets from '../data/home-widgets.json';
import { getNotes, getPosts, entryUrl, type AnyEntry } from './content';
import { toISODate } from './date';
import { withBase } from './url';

export interface CalendarEvent {
  title?: string;
  href?: string;
  text?: string;
}

export interface DayClaim {
  /** YYYY-MM-DD */
  date: string;
  /** 这一天认领的文章 / 手记（按站里的排序：置顶优先、然后时间倒序） */
  entries: AnyEntry[];
  /** 这一天同时还是「特殊日子」时，带上它（同 home-widgets.json 里那份） */
  event?: CalendarEvent;
  /** 点日历上这一天会去哪（单篇 → 那篇；否则 → /day/<日期>/） */
  href: string;
  /** 悬停那句话（文章标题串起来） */
  label: string;
  /** 要不要单独给这一天生一页（多篇，或者它同时还是个特殊日子） */
  needsPage: boolean;
}

const events = ((widgets.calendar ?? {}) as { events?: Record<string, CalendarEvent> }).events ?? {};

/** 手上这些文章里，哪些「认领」了哪一天。键是 YYYY-MM-DD */
export async function claimedDays(): Promise<Map<string, DayClaim>> {
  const all: AnyEntry[] = [...(await getPosts()), ...(await getNotes())];
  const byDate = new Map<string, AnyEntry[]>();

  for (const entry of all) {
    if (!entry.data.calendar) continue;
    const key = toISODate(entry.data.date);
    const list = byDate.get(key) ?? [];
    list.push(entry);
    byDate.set(key, list);
  }

  const out = new Map<string, DayClaim>();
  for (const [date, entries] of byDate) {
    const event = events[date];
    const needsPage = entries.length > 1 || Boolean(event?.href);
    const titles = entries.map((e) => String(e.data.title || ''));
    out.set(date, {
      date,
      entries,
      event,
      href: withBase(needsPage ? `/day/${date}/` : entryUrl(entries[0])),
      label: entries.length > 1 ? `${titles.join(' / ')}（${entries.length} 篇）` : titles[0],
      needsPage,
    });
  }
  return out;
}

/** 日历那位要的那份精简数据：日期 → 点它去哪 / 提示写什么 / 有几篇 */
export async function calendarDayLinks(): Promise<Record<string, { href: string; label: string; count: number }>> {
  const out: Record<string, { href: string; label: string; count: number }> = {};
  for (const [date, day] of await claimedDays()) {
    out[date] = { href: day.href, label: day.label, count: day.entries.length };
  }
  return out;
}
