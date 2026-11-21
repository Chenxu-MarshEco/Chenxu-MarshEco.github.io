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
 * 五份数据各自的"日子"来自：
 *   · 精华   —— `salon.json` 每条的 `date`（站长导入时就带着真实日期）
 *   · 圣经   —— `src/data/bellie/days/<日期>.json`（2026-11-21 加：站长说
 *                「在涣愿终池的精华下加一条圣经 显示历史上的今天出现过的群圣经
 *                 参考精华在涣愿终池里的引用方法」）
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
import { bellieEntries } from './bellie';
import { memberAvatar, memberName, salonEssences, salonMembers } from './salon';
import { pointKind, timelines, type TimelinePoint } from './timelines';
import { dedupePoints, type CisternPoint, type CisternPointRow } from './cistern-dedupe';
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

/**
 * 一条群圣经（2026-11-21 加）。
 *
 * 和精华那一条长得几乎一样（头像 + 名字 + 时间 + 正文），只多一段评语：
 * 圣经页本来就是「正文 + 铃忆的评语」两截（见 utils/bellie.ts），
 * 这里照同样的规矩搬过来，评语字段留给页面上那句话用小字斜体压着。
 */
export interface CisternBible {
  id: string;
  /** `YYYY-MM-DD` */
  date: string;
  time: string;
  member: string;
  avatar: string;
  /** 正文（群友原句，保留换行） */
  text: string;
  /** 铃忆的评语（可以空） */
  comment: string;
  /** 点它去哪（圣经页那一条的锚点） */
  href: string;
}

/**
 * 时间轴上的一个点（事件 / 时刻）。
 *
 * 形状和查重后的那一份一样（见 `cistern-dedupe.ts`）：除了轴的名字，
 * 还多一个 `showAxis` —— 名字前面要不要带「轴名·」。
 */
export type { CisternPoint };

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
  bibles: CisternBible[];
  points: CisternPoint[];
  iceberg: CisternIce[];
  notes: CisternNote[];
}

export interface CisternIndex {
  /** `MM-DD` → 那一天的全部内容（只留**真的有东西**的日子） */
  days: Record<string, CisternDay>;
  /** 一共凑出了多少个日子（验收 / 调试用） */
  dayCount: number;
  /** 五类各有多少条（查重之后的条数；验收 / 调试用） */
  counts: { essences: number; bibles: number; points: number; iceberg: number; notes: number };
  /** 主轴（全站总轴）的 id；查重时"主轴里有的不带前缀"就靠它（验收 / 调试用） */
  mainAxis: string;
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
 * 「因为一些服务器的分轴里还有一些更小的事件 所以……所有时间轴都读取 但是标明轴出处」
 * 「时刻应该读取本网站所有已存在的时间轴并去重后显示」。
 *
 * 所以每个点都带上 `timeline`（轴的名字）和 `timelineId`；同一天里「名字 + 时间」
 * 完全一样的按 `dedupePoints()` 那四条规则合并（主轴里有的不带前缀，分轴独有的带）。
 */

/**
 * 主轴（全站总轴）是哪条。
 *
 * 站长 2026-11-17：「这个花娅年代记是全站的总轴」。数据里没有哪一项专门写
 * 「我是总轴」，所以按版块树推：**挂在最浅那一页上的那条轴**就是总轴
 * （`/huaya` 比 `/huaya/years/fenhu` 浅）。同样是浅的就比谁的点多，
 * 再一样就比数据里的先后 —— 这样"总轴"不会因为随手加一条分轴就跑掉。
 */
function mainAxisOf(boards: BoardNode[]): string {
  /** 轴 id → 它挂过的最浅那一页的 depth */
  const shallowest = new Map<string, number>();
  for (const f of flattenBoards(boards)) {
    if (f.external) continue;
    const id = String(f.node.timeline ?? '').trim();
    if (!id) continue;
    const prev = shallowest.get(id);
    shallowest.set(id, prev === undefined ? f.depth : Math.min(prev, f.depth));
  }

  let best = '';
  let bestDepth = Infinity;
  let bestPoints = -1;
  for (const tl of timelines) {
    const depth = shallowest.get(tl.id);
    if (depth === undefined) continue;
    const count = tl.points.filter((p) => pointDay(p)).length;
    if (depth < bestDepth || (depth === bestDepth && count > bestPoints)) {
      best = tl.id;
      bestDepth = depth;
      bestPoints = count;
    }
  }
  return best;
}

/**
 * 建整张倒排表。构建期调一次就够（Astro 每个页面各调一次也没关系：
 * 数据在 JSON 里，真正的排序和分组很便宜）。
 */
export async function cisternIndex(): Promise<CisternIndex> {
  const days: Record<string, CisternDay> = {};
  /** 查重之前的时间轴点（一条轴上每个点各算一份，等全部收完再按规则合并） */
  const pointRows: Record<string, CisternPointRow[]> = {};
  const counts = { essences: 0, bibles: 0, points: 0, iceberg: 0, notes: 0 };

  const bucket = (date: string): CisternDay | null => {
    const key = monthDay(date);
    if (!key) return null;
    return (days[key] ??= { key, essences: [], bibles: [], points: [], iceberg: [], notes: [] });
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

  /* ---------- 2. 群圣经（2026-11-21 加；和精华一个取法，按日期落进同一天） ---------- */
  /*
    圣经的数据只有一份（机器人每天写的 `src/data/bellie/days/<日期>.json`，
    见 utils/bellie.ts），这里**不另算一遍"谁是谁"**：认人用的是它算好的 `memberIds` /
    `rawName`，头像回成员表里取 —— 两边认出来的人必须是同一个，否则名片和头像会对不上。
  */
  const memberById = new Map(salonMembers.map((m) => [m.id, m]));
  for (const b of bellieEntries) {
    const hit = bucket(b.date);
    if (!hit) continue;
    const who = b.memberIds.length ? memberById.get(b.memberIds[0]) : undefined;
    hit.bibles.push({
      id: b.id,
      date: b.date,
      time: b.time,
      member: b.rawName || b.sender || '',
      avatar: who?.avatar ? variantUrl(who.avatar, 400) : '',
      /* 正文保留换行（群聊一行一句），只截长度 */
      text: clip(b.text, 400),
      comment: clip(b.comment, 400),
      href: withBase(`/bellie/#${b.id}`),
    });
    counts.bibles += 1;
  }

  /* ---------- 3. 时间轴的事件与时刻（所有轴，同一天里按规则查重） ---------- */
  for (const tl of timelines) {
    for (const p of tl.points) {
      const day = pointDay(p);
      if (!day) continue;
      const kind = pointKind(p);
      /* 「难以考据」那种本来就没有日子，进不来 */
      if (kind === 'fuzzy') continue;
      const b = bucket(day);
      if (!b) continue;
      const row: CisternPointRow = {
        id: p.id,
        timeline: tl.title || '',
        timelineId: tl.id,
        date: day,
        label: p.label || '',
        kind,
        /* 轴上这个刻度自己填的链接；没填就是空串（点了不动） */
        href: String(p.href ?? '').trim() ? withBase(String(p.href).trim()) : '',
      };
      (pointRows[b.key] ??= []).push(row);
    }
  }

  /* ---------- 4. 可考据的冰山词条 ---------- */
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

  /* ---------- 5. 铃忆的冰室日记（只给跳转卡） ---------- */
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
    时间轴的点收齐了，按「名字 + 时间」查重：
    主轴里有的只留一条（名字不带前缀），只有分轴里有的每条轴各留一条（带轴前缀）。
    规则和用例在 `cistern-dedupe.ts`，验收脚本直接 import 那个文件跑四种情形。
  */
  const mainAxis = mainAxisOf(site.homeBoards as BoardNode[]);
  for (const [key, rows] of Object.entries(pointRows)) {
    const merged = dedupePoints(rows, mainAxis);
    days[key].points = merged;
    counts.points += merged.length;
  }

  /*
    每一类内部都按**日期倒序**（最近的一年先出现）：
    读者点开这一刻最想知道的是"去年的今天"，而不是 2023 年那一条。
    同一类的年月日都相同的，再按原来的顺序（稳定排序，构建结果可复现）。
  */
  for (const d of Object.values(days)) {
    d.essences.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
    d.bibles.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
    d.points.sort((a, b) => b.date.localeCompare(a.date));
    d.iceberg.sort((a, b) => b.date.localeCompare(a.date));
    d.notes.sort((a, b) => b.date.localeCompare(a.date));
  }

  return { days, dayCount: Object.keys(days).length, counts, mainAxis };
}

/** `MM-DD` 那天的内容；没有就返回五个空数组（页面上显示"这天还没有记录"） */
export function dayOf(index: CisternIndex, key: string): CisternDay {
  return index.days[key] ?? { key, essences: [], bibles: [], points: [], iceberg: [], notes: [] };
}
