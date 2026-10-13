/**
 * 助手日志（眠鱼志）—— **一天一条**，读取端只有这一处。
 *
 * 用户 2026-10-12 的要求（原话）：
 *   「优化一下日志页面 现在这样会越堆越长 可以把每一天都改为一篇手记
 *    就像铃忆的冰室日记一样」
 *
 * 于是日志从「一页里堆三十天的大长条」改成：
 *   · 列表页（`/huaya/memory/mianyu`）：**一天一张卡**，一页 {@link LOGS_PER_PAGE} 天，翻页；
 *   · 每一天有自己的页面：`/logs/2026-09-14/`，和手记一样能单独打开、能分享；
 *   · 卡上只放日期 + 头一段摘要，正文在单日页里（所以列表不会再被撑长）。
 *
 * 数据仍然是 `src/data/mianyu.json` 那一份，**写入端没变**
 * （`tools/memory/append-log.mjs`，一天一栏、同一天再写一次=就地覆盖）。
 * 为什么不做成 Astro 内容集：那份数据是**助手自动写**的，而内容集要编辑器管；
 * 2026-09-28 就是因为两边都写同一个文件才出的事故，这里继续保持"各写各的"。
 */
import site from '../site.config';
import mianyu from '../data/mianyu.json';
import { flattenBoards, type BoardNode } from './boards';
import { withBase } from './url';

/**
 * 列表一页几天。
 * 用户 2026-10-12 定的是 **37**（不是常见的 10/20 —— 他说「全部一页37条」）。
 */
export const LOGS_PER_PAGE = 37;

export interface LogDay {
  /** 站点上显示的写法，原样来自数据：`2026.9.14` */
  date: string;
  /** URL / 文件名里的写法：`2026-09-14`（补零，能直接按字符串排序） */
  iso: string;
  /** 单日页的地址（已带 base） */
  href: string;
  /** 正文原文（Markdown），单日页渲染它 */
  text: string;
  /** 列表卡上那段摘要（纯文本，去掉了 Markdown 记号） */
  excerpt: string;
}

/** `2026.9.14` → `2026-09-14`；认不出来就把点换成横线，URL 里照样能用 */
function toIso(date: string): string {
  const m = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/.exec(date.trim());
  if (!m) return date.trim().replace(/[.\s/]+/g, '-');
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

/**
 * 摘出正文的头一段当预览。
 * 刻意**把 Markdown 记号去掉再截**：连着半截 `**` 截出来的摘要会很难看，
 * 而在半截语法上做渲染又会生成坏标签，所以这里只做纯文本。
 */
export function excerptOf(text: string, max = 84): string {
  const firstPara = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .find((s) => s && !/^[-*_]{3,}$/.test(s)) ?? '';
  const plain = firstPara
    .replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1') // 悬停卡片语法 [[名字|图]]
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')             // 图
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')          // 链接留文字
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}

/** 单日页地址：`/logs/2026-09-14/` */
export function logHref(iso: string): string {
  return withBase(`/logs/${iso}/`);
}

/**
 * 全部日志，**最新在前**（列表第一页就是最近几天）。
 * 一天一条：同一天在数据里出现两次的话，后面的那条以前面那条为准。
 */
export function logDays(): LogDay[] {
  const seen = new Set<string>();
  const days: LogDay[] = [];
  for (const raw of (mianyu.entries ?? []) as { date?: string; text?: string }[]) {
    const date = String(raw.date ?? '').trim();
    if (!date) continue;
    const iso = toIso(date);
    if (seen.has(iso)) continue;
    seen.add(iso);
    days.push({
      date,
      iso,
      href: logHref(iso),
      text: String(raw.text ?? ''),
      excerpt: excerptOf(String(raw.text ?? '')),
    });
  }
  return days.sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0));
}

/** 某一天的日志（单日页用）；找不到就是 undefined */
export function logDay(iso: string): LogDay | undefined {
  return logDays().find((d) => d.iso === iso);
}

/** 这一天前面 / 后面那一天的日志（单日页底部的「上一日 / 下一日」） */
export function logNeighbors(iso: string): { prev?: LogDay; next?: LogDay } {
  const days = logDays();
  const i = days.findIndex((d) => d.iso === iso);
  if (i < 0) return {};
  /* 列表是「最新在前」，所以数组里后一条 = 更早的那一天 */
  return { prev: days[i + 1], next: days[i - 1] };
}

/**
 * 哪个版块页挂着「助手日志」块 —— 单日页的「← 回眠鱼志」要用它。
 * 为什么不写死 `/huaya/memory/mianyu`：那个地址站长随时能在编辑器里改，
 * 写死的话改完单日页的返回按钮就指到空处了。找不到就返回空串（页面自己会省掉那颗按钮）。
 */
export function logBoardHref(): string {
  const hit = flattenBoards(site.homeBoards as unknown as BoardNode[]).find((f) =>
    ((f.node as { page?: { type?: string }[] }).page ?? []).some((b) => b?.type === 'logs'),
  );
  return hit ? withBase(hit.url) : '';
}
