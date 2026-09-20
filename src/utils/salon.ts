/**
 * 冰室精华（群精华）的取数逻辑（构建期）。
 *
 * 数据在 `src/data/salon.json`，三块：
 *   members   成员表 —— 头像 + 名字都在这里，精华里只存 memberIds
 *   eras      五个年代 —— 时间轴上的"段"
 *   essences  精华条目 —— 每条 = 成员（**可以多个**）+ 时间 + 内容（文字 / 图片）
 *
 * 数据是**一条都没丢**的完整版：文字 732 + 完美对话 45 + AI 创作 7 = 784 条
 * （`tools/salon/import.mjs` 跑完会拿"年代 × 类别"的条数和原导出文件里的注记
 * 逐项核对，全 OK 才写出数据）。
 *
 * 为什么成员要单独一张表：用户要求"成员改名或换头像之后，他所有的精华
 * （包括首页那条每日精华）都跟着变"。所以精华里**只存 id**，
 * 名字和头像渲染时现查 —— 和导航分类库、时间轴是同一个套路。
 * 一条精华可以有多个成员（例：2023-07-19 的完美对话 = 花花、虹星），
 * 页面会把每个人的名字和头像都列出来。
 *
 * 时间轴（那个左侧常驻的那条）也是从这里推出来的：
 *   · 年代 -> spans（时间轴的"段"）
 *   · 精华的日期（去重）-> points（时间轴的"点"，href 指向当天第一条精华）
 * 所以时间轴不需要单独维护一份数据，加一条精华就自动多一个点。
 */
import raw from '../data/salon.json';
import { dailyIndex } from './daily';
import { dayOf, paramOf, type Timeline, type TimelinePoint, type TimelineSpan } from './timelines';

export interface SalonMember {
  id: string;
  name: string;
  /** 头像（/img/... 或外链）；留空就显示一个占位圆 */
  avatar: string;
}

export interface SalonEra {
  id: string;
  title: string;
  from: string;
  to: string;
  note?: string;
}

/** 条目的来源类别。站点页面**不按它分组**，只是数据留档 + 编辑器里用 */
export type SalonKind = 'text' | 'perfect' | 'ai';

export interface SalonEssence {
  id: string;
  /**
   * 这条精华属于哪些成员（**可以多个**）。
   * 例：2023-07-19 的完美对话是「花花、虹星」两个人一起说的。
   * 顺序 = 原对话里出现的顺序；OCR 解析不出人名时是空数组。
   */
  memberIds: string[];
  /** 老数据兼容：早期版本只存一个 memberId，读的时候会自动并进 memberIds */
  memberId?: string;
  /** text 文字 / perfect 完美对话 / ai AI 创作 */
  kind?: SalonKind;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM，可能为空（完美对话只有日期，原数据里有的也没写时刻） */
  time: string;
  text: string;
  /** 正文是截图 OCR 自动转录的（尚未人工校对） */
  ocr?: boolean;
  images: string[];
  eraId: string;
}

interface SalonFile {
  title?: string;
  updated?: string;
  note?: string;
  members?: SalonMember[];
  eras?: SalonEra[];
  essences?: SalonEssence[];
}

const DATA = raw as SalonFile;

export const salonTitle: string = DATA.title || '冰室群精华';
export const salonUpdated: string = DATA.updated || '';
export const salonNote: string = DATA.note || '';

export const salonMembers: SalonMember[] = (DATA.members ?? []).filter((m) => m && m.id && m.name);
export const salonEras: SalonEra[] = (DATA.eras ?? []).filter((e) => e && e.id && e.from && e.to);

/** 按时间正序（数据里已经排过，这里再兜一次底，免得手工编辑插错位置） */
export const salonEssences: SalonEssence[] = [...(DATA.essences ?? [])]
  .filter((e) => e && e.id && e.date)
  /* 老数据里可能只有 memberId：读进来就归一到 memberIds，后面所有渲染只认 memberIds */
  .map((e) => ({ ...e, memberIds: essenceIds(e) }))
  .sort((a, b) => `${a.date} ${a.time || '00:00'}`.localeCompare(`${b.date} ${b.time || '00:00'}`) || a.id.localeCompare(b.id));

const MEMBERS = new Map(salonMembers.map((m) => [m.id, m]));

/** 这条精华的成员 id 列表（去重、去掉查不到的），单个/多个都走它 */
export function essenceIds(e: Pick<SalonEssence, 'memberIds' | 'memberId'>): string[] {
  const raw = Array.isArray(e.memberIds) ? e.memberIds : [];
  const list = raw.length ? raw : e.memberId ? [e.memberId] : [];
  const out: string[] = [];
  for (const id of list) {
    const s = String(id || '');
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** 这条精华的所有成员（查不到的被丢掉；全查不到就是空数组） */
export const membersOf = (e: SalonEssence): SalonMember[] =>
  essenceIds(e)
    .map((id) => MEMBERS.get(id))
    .filter((m): m is SalonMember => Boolean(m));

/** 这条精华在时间轴提示卡里用的名字：多个成员用「、」连起来 */
export const memberName = (e: SalonEssence): string =>
  membersOf(e)
    .map((m) => m.name)
    .join('、') || '冰室群成员';

/** 第一个成员的头像（首页那条小卡片用）；没设就返回空串，渲染层画占位圆 */
export const memberAvatar = (e: SalonEssence): string => membersOf(e)[0]?.avatar || '';

/* ------------------------------------------------------------------
   时间轴
   ------------------------------------------------------------------ */

export const SALON_TL_ID = 'salon-hishitsu';

/** 同一天可能有好几条精华，时间轴上一个日期一个点，点进去看当天第一条 */
const firstByDate = (): Map<string, SalonEssence> => {
  const map = new Map<string, SalonEssence>();
  for (const e of salonEssences) if (!map.has(e.date)) map.set(e.date, e);
  return map;
};

/** 日期显示成 23.01.10（时间轴上字小，短一点才排得开） */
const shortDate = (d: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${m[1].slice(2)}.${m[2]}.${m[3]}` : d;
};

/**
 * 把 salon.json 拼成一条本站时间轴。
 *
 * 点是「有精华的日期」（去重），段是五个年代。用 kind:'event' 是因为
 * 时间轴默认把「时刻」那类名字关掉（轴上一大堆大字太吵）—— 这里想让日期
 * 直接看得见，就归到「事件」那一类。
 */export function salonTimeline(): Timeline {
  const days = [...firstByDate().entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const points: TimelinePoint[] = days.map(([date, first], i) => ({
    id: `salon-${date}`,
    // 左右交替，免得相邻日期的字挤在同一侧
    side: i % 2 === 0 ? 'left' : 'right',
    kind: 'event',
    date,
    label: shortDate(date),
    href: `#${first.id}`,
  }));

  const spans: TimelineSpan[] = salonEras.map((era) => ({
    id: era.id,
    name: era.title,
    from: era.from,
    to: era.to,
    side: 'both',
  }));

  return {
    id: SALON_TL_ID,
    title: '冰室精华',
    leftName: '精华',
    rightName: '精华',
    /*
      比例尺必须写死（一刻度 2 天），不能用默认档。
      为什么：这条轴有 **450 个日期点**、跨 3 年多。按默认（约 19 天/格）算出来
      整条轴只有 ~1800px，450 个点平均 4px 一个 —— 时间轴会把 22px 以内的点
      **合并成一组**，于是几乎全轴并成几个巨大的提示卡（实测一个 tip 里塞了 93 行、
      整页 DOM 涨到 21 万节点）。一刻度 2 天 → 轴长约 17500px、点间距 ~40px，
      不再合并；代价是要滚动才看得全，而这个页面的轴本来就跟页面滚动联动。
    */
    tickDays: 2,
    points,
    spans,
  };
}

/**
 * 每条精华在时间轴上的位置（0~1），页面里写成 `data-tl-param`。
 * 时间轴脚本会用它把"当前滚到哪一段"和轴对上 —— 左边那条轴跟着页面走。
 */
export function essenceParams(tl: Timeline): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of salonEssences) out.set(e.id, paramOf(tl, dayOf(e.date)));
  return out;
}

/* ------------------------------------------------------------------
   首页「每日精华」
   ------------------------------------------------------------------ */

/**
 * 首页那条「每日精华」。
 *
 * 为什么要按日期算而不是每次随机：静态站点一次构建之后页面就不动了，
 * 用 `Math.random()` 会让同一天刷新出不同的东西（用户要的是"每天抽一条"）。
 * 按日期做种子 = 一天之内固定、第二天自动换 —— 而且**不需要重新构建**，
 * 首页脚本拿到 /salon.json 之后自己在浏览器里挑。
 *
 * 具体挑法在 utils/daily.ts（那份计算构建期和浏览器里共用，见那儿的说明）。
 */
export function dailyEssence(dateStr: string, list: readonly SalonEssence[] = salonEssences): SalonEssence | undefined {
  const i = dailyIndex(dateStr, list.length);
  return i < 0 ? undefined : list[i];
}
