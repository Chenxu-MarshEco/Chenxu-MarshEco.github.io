/**
 * 「涣愿终池」的取数：把**同一个日子**在**所有年份**里发生过的东西凑到一块儿。
 *
 * 用户 2026-11-17 的原话：
 *   「显示每一年的这一天的冰室事件和精华 …… 四个板块：历年来的这一天的 1.精华
 *    2.时间轴事件与时刻 3.可考据的冰山词条 4.铃忆的冰室日记的跳转卡片
 *    例如我在今天 11.17 浏览 那么这个核心页面就需要列出所有年份里的 11.17 发生过的
 *    精华 / 时间轴时间时刻 / 冰山词条 / 当天的日记链接卡」
 *
 * 所以这里只有一件事：**按 `MM-DD` 建一张倒排表**。
 * 四份数据各自的"日子"来自：
 *   · 精华   —— `salon.json` 每条的 `date`（站长导入时就带着真实日期）
 *   · 时间轴 —— `timelines.json` 里那些点的 `date`；`today` 这种实时点跳过
 *   · 冰山   —— `iceberg.json` 里**填了归属时间**的词条（2026-11-17 新加的字段；空着不进）
 *   · 日记   —— `src/content/notes/*.md` 的 frontmatter `date`
 *
 * ⚠ 这份文件只在**构建期**跑（它 import 了 227KB 的 salon.json 和 astro:content），
 * 浏览器那边用的是 `/cistern.json`（见 `src/pages/cistern.json.ts`），
 * 两个地方吃的是**同一个函数**，所以"今天该显示什么"只有一套算法。
 */
import { getNotes } from './content';
import { toISODate } from './date';
import { iceberg } from './iceberg';
import { memberAvatar, memberName, salonEssences } from './salon';
import { pointKind, timelines, type TimelinePoint } from './timelines';
import { flattenBoards, type BoardNode } from './boards';
import site from '../site.config';
import { withBase } from './url';
import { variantUrl } from './images';

/** 一条精华（够拼卡片就行：正文只截一小段，点进去看全文） */
export interface CisternEssence {
  id: string;
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:MM` 那种；可能空 */
  time: string;
  /** 说话的人（一条可能好几个人，这里是拼好的那串） */
  member: string;
  avatar: string;
  /** 正文摘要（已经压成一行） */
  text: string;
  /** 头一张图的缩略图；没有就空串 */
  image: string;
  /** 点它去哪（精华页那一条的锚点） */
  href: string;
}

/** 时间轴上的一个点（事件 / 时刻） */
export interface CisternPoint {
  id: string;
  /** 属于哪条轴（「花娅年代记」这种）—— 页面上要标明出处 */
  timeline: string;
  /** 那条轴的 id（跳转按钮按它去查"这一页在哪"） */
  timelineId: string;
  date: string;
  label: string;
  /** moment 时刻 / event 事件（难考据那种没有具体日子，进不来） */
  kind: string;
  /** 填了就点得动 */
  href: string;
}

/** 冰山词条 */
export interface CisternIce {
  id: string;
  date: string;
  name: string;
  desc: string;
  /** 归在哪一层（「冰室前庭」…） */
  layer: string;
  /** 主分类的名字（那个 emoji 也给上，一眼认出是冰室怪谈还是花娅奇闻） */
  category: string;
  emoji: string;
  /** 词条自己的链接；没有就指去冰山页 */
  href: string;
}

/** 铃忆的冰室日记（只给跳转卡，不搬全文） */
export interface CisternNote {
  id: string;
  date: string;
  title: string;
  /** 正文开头一小段（卡片上做摘要用） */
  excerpt: string;
  href: string;
}

export interface CisternDay {
  /** `MM-DD` */
  key: string;
  essences: CisternEssence[];
  points: CisternPoint[];
  iceberg: CisternIce[];
  notes: CisternNote[];
}

export interface CisternIndex {
  /** `MM-DD` → 那一天的全部内容（只留**真的有东西**的日子） */
  days: Record<string, CisternDay>;
  /** 一共凑出了多少个日子（验收 / 调试用） */
  dayCount: number;
  /** 四类各有多少条（验收 / 调试用） */
  counts: { essences: number; points: number; iceberg: number; notes: number };
  /** 轴 id → 放那条轴的那一页（页面上的跳转按钮用它） */
  timelineHref: Record<string, string>;
}

/** `2026-11-17` → `11-17`；认不出来就空串 */
export function monthDay(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? '').trim());
  return m ? `${m[2]}-${m[3]}` : '';
}

/** 把一段 Markdown 压成一行摘要 */
function plain(text: string, max = 120): string {
  const s = String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[#>\-*\s]+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * 保留换行的截断（精华那一段用）。
 *
 * 「精华就按原格式」—— 群聊原文是**一行一句**的，压成一行就认不出来了。
 * 所以这里只截长度、不动换行；被截断的那条末尾补个省略号（标点不算文案）。
 */
function clip(text: string, max: number): string {
  const s = String(text ?? '').replace(/\r\n/g, '\n').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** 时间轴上的一个点能不能进涣愿终池：只认有具体日子的（`today` 那种实时点不算） */
function pointDay(p: TimelinePoint): string {
  const d = String(p.date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  return d;
}

/**
 * 时间轴读**全部**轴（用户 2026-11-17 改的口径）：
 * 「因为一些服务器的分轴里还有一些更小的事件 所以……所有时间轴都读取 但是标明轴出处」。
 *
 * 所以每个点都带上 `timeline`（轴的名字）和 `timelineId`，页面上的跳转按钮
 * 按轴分别给一个，按钮上写着是哪条轴 —— 读者知道这条是从哪条轴上捞上来的。
 */

/**
 * 建整张倒排表。构建期调一次就够（Astro 每个页面各调一次也没关系：
 * 数据在 JSON 里，真正的排序和分组很便宜）。
 */
export async function cisternIndex(): Promise<CisternIndex> {
  const days: Record<string, CisternDay> = {};
  const counts = { essences: 0, points: 0, iceberg: 0, notes: 0 };

  const bucket = (date: string): CisternDay | null => {
    const key = monthDay(date);
    if (!key) return null;
    return (days[key] ??= { key, essences: [], points: [], iceberg: [], notes: [] });
  };

  /* ---------- 1. 精华 ---------- */
  for (const e of salonEssences) {
    const b = bucket(e.date);
    if (!b) continue;
    b.essences.push({
      id: e.id,
      date: e.date,
      time: e.time,
      member: memberName(e),
      avatar: memberAvatar(e) ? variantUrl(memberAvatar(e), 400) : '',
      /* 保留换行（群聊一行一句），只截长度 —— 见上面 clip() 的注释 */
      text: clip(e.text, 400),
      image: e.images[0] ? variantUrl(e.images[0], 500) : '',
      /* 精华页每一条都有自己的 id，深链接（站内搜索也用这个写法） */
      href: withBase(`/salon/#${e.id}`),
    });
    counts.essences += 1;
  }

  /* ---------- 2. 时间轴的事件与时刻（所有轴，点上都标明出处） ---------- */
  for (const tl of timelines) {
    for (const p of tl.points) {
      const day = pointDay(p);
      if (!day) continue;
      const kind = pointKind(p);
      /* 「难以考据」那种本来就没有日子，进不来 */
      if (kind === 'fuzzy') continue;
      const b = bucket(day);
      if (!b) continue;
      b.points.push({
        id: p.id,
        timeline: tl.title || '',
        timelineId: tl.id,
        date: day,
        label: p.label || '',
        kind,
        href: String(p.href ?? '').trim(),
      });
      counts.points += 1;
    }
  }

  /* ---------- 3. 可考据的冰山词条 ---------- */
  for (const layer of iceberg.layers) {
    for (const it of layer.items) {
      const b = bucket(it.date);
      if (!b) continue;
      const cat = iceberg.categories.find((c) => c.id === it.categoryIds[0]);
      b.iceberg.push({
        id: it.id,
        date: it.date,
        name: it.name,
        /* 完整描述，不截断：页面上要「详细铺开完备描述」 */
        desc: String(it.desc ?? '').trim(),
        layer: layer.title || '',
        category: cat?.name || '',
        emoji: (cat as { emoji?: string } | undefined)?.emoji || '',
        href: it.href || '/iceberg/',
      });
      counts.iceberg += 1;
    }
  }

  /* ---------- 4. 铃忆的冰室日记（只给跳转卡） ---------- */
  for (const n of await getNotes()) {
    const b = bucket(toISODate(n.data.date));
    if (!b) continue;
    b.notes.push({
      id: n.id,
      date: toISODate(n.data.date),
      title: n.data.title || '无题',
      excerpt: plain(n.body ?? '', 90),
      href: `/notes/${n.id}/`,
    });
    counts.notes += 1;
  }

  /*
    每一类内部都按**日期倒序**（最近的一年先出现）：
    读者点开这一刻最想知道的是"去年的今天"，而不是 2023 年那一条。
    同一类的年月日都相同的，再按原来的顺序（稳定排序，构建结果可复现）。
  */
  for (const d of Object.values(days)) {
    d.essences.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
    d.points.sort((a, b) => b.date.localeCompare(a.date));
    d.iceberg.sort((a, b) => b.date.localeCompare(a.date));
    d.notes.sort((a, b) => b.date.localeCompare(a.date));
  }

  /*
    每条轴"住在哪一页"：页面上那个跳转按钮要跳到放这条轴的地方。
    一个轴可能被好几页共用，取**第一页**（按树里的先序）就够了 ——
    同一份数据，跳到哪一页看到的都一样。
  */
  const timelineHref: Record<string, string> = {};
  for (const f of flattenBoards(site.homeBoards as BoardNode[])) {
    if (f.external) continue;
    const id = String(f.node.timeline ?? '').trim();
    if (!id || timelineHref[id]) continue;
    timelineHref[id] = withBase(f.url);
  }

  return { days, dayCount: Object.keys(days).length, counts, timelineHref };
}

/** `MM-DD` 那天的内容；没有就返回四个空数组（页面上显示"这天还没有记录"） */
export function dayOf(index: CisternIndex, key: string): CisternDay {
  return index.days[key] ?? { key, essences: [], points: [], iceberg: [], notes: [] };
}
