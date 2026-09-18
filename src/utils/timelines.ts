/**
 * 时间轴的数据与算法。
 *
 * 时间轴是**独立于页面**的一份数据（`src/data/timelines.json`）：
 * 一条时间轴可以被好几个页面共用，一个页面也可以换用别的时间轴。
 * 页面通过节点的 `timeline` 字段指过来，页面里的各个成分再各自认领
 * 一个时间点或时间段。
 *
 * 左右两侧是给「双线叙事」用的：同一个刻度上可以一边挂一个事件
 * （比如左边记花娅历、右边记冰室历）。
 *
 * 这里只放**构建期**就要算好的东西（时间范围、每个点落在轴上的什么位置）。
 * 屏幕上的位移、缩放、滚动都在 Timeline.astro 的那段脚本里做。
 */
import raw from '../data/timelines.json';

export type TimelineSide = 'left' | 'right';

/**
 * 时间段挂在哪一侧。
 *
 * `both` 是给「同一段年月，两边各有各的叫法」准备的：比如纷湖那几年，
 * 花娅历管它叫「纷湖年代」、冰室历管它叫「纯良年代」—— 那是同一段区间、
 * 两个名字，就在左边挂一条、右边挂一条。
 * （想要两个不同的名字，就加两条时间段、起点终点填一样的，各自选一侧。）
 */
export type TimelineSpanSide = TimelineSide | 'both';

/**
 * 时间点分两类：
 *
 * - `moment`（**时刻**）：轴上那些「大事」。图标是那颗大一些的落日色塔吊，
 *   文字也大一些。这是最早那版唯一的一种时间点，所以老数据没写 kind 的
 *   一律当 moment。
 * - `event`（**事件**）：同一天里那些零碎的记录。图标是**小一号的粉色塔吊**，
 *   旁边的文字也更小 —— 一眼能和大事件分开，又不至于把轴糊住。
 *
 * 两类**功能完全一样**（左右、日期、名字、链接、合并规则都共用一套代码），
 * 差别只在图标大小 / 颜色和字号。
 */
export type TimelinePointKind = 'moment' | 'event';

export interface TimelinePoint {
  id: string;
  side: TimelineSide;
  /** 时刻还是事件；没写就是时刻（老数据） */
  kind?: TimelinePointKind;
  /** ISO 日期 `yyyy-mm-dd` */
  date: string;
  /** 事件名，常驻显示在轴旁边 */
  label: string;
  /** 点它跳去哪：站内写 `/huaya/xxx`，站外写 `https://…`；留空就只是看看名字 */
  href?: string;
}

/** 这个时间点是「时刻」还是「事件」；没写的（老数据）当时刻 */
export const pointKind = (p: TimelinePoint): TimelinePointKind => (p.kind === 'event' ? 'event' : 'moment');

export interface TimelineSpan {
  id: string;
  /** 这段叫什么，比如「XX 年代」 */
  name: string;
  /** 两端各是一个时间点的 id。先后无所谓，用的时候按日期排 */
  from: string;
  to: string;
  /** 挂在哪一侧；老数据没这一项，按起点那个时间点的侧算 */
  side?: TimelineSpanSide;
  /** 点它跳去哪，和 TimePoint.href 一样的规矩 */
  href?: string;
}

export interface Timeline {
  id: string;
  title: string;
  /** 左侧那条线叫什么历（比如「花娅历」） */
  leftName: string;
  /** 右侧那条线叫什么历 */
  rightName: string;
  points: TimelinePoint[];
  spans: TimelineSpan[];
}

export const timelines: Timeline[] = ((raw as { timelines?: Timeline[] }).timelines ?? []).filter(
  (t) => t && typeof t.id === 'string'
);

export const getTimeline = (id?: string | null): Timeline | undefined =>
  id ? timelines.find((t) => t.id === id) : undefined;

/** `yyyy-mm-dd` → 天数。算排序和中点用，认不出来给 NaN */
export function dayOf(date: string): number {
  const s = String(date ?? '').trim();
  // 「实时」那个时间点：永远算今天（构建那天构建、打开页面那天由脚本重排）
  if (s === TODAY) return todayDay();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000;
}

/**
 * 「实时更新」的时间点用这个特殊日期值。
 *
 * 它是一个哨兵字符串，不是日期：写进 `date` 里，`dayOf` 认它、服务端也放行。
 * 为什么不干脆存今天的 `yyyy-mm-dd`、每天重建一次 —— 因为这个站是**静态**的，
 * 构建产物躺在 GitHub Pages 上，不重建就永远停在构建那天。
 * 所以：构建时按构建那天算（保证没 JS 时也不离谱），页面打开时再由脚本按
 * 访问者当天的日期把整条轴重排一遍。
 */
export const TODAY = 'today';

/** 这个日期是不是「实时」的 */
export const isLiveDate = (date: string): boolean => String(date ?? '').trim() === TODAY;

/**
 * 「今天」是第几天。
 *
 * 取的是**本地**的年月日（用户在自己时区的「今天」），但换算方式和 `dayOf`
 * 一样走 `Date.UTC` —— 这样两边在同一个坐标系里，跨时区不会差一天。
 */
export function todayDay(now: Date = new Date()): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000;
}

/** 天数 → `yyyy-mm-dd`（展示用） */
export function dateOf(day: number): string {
  const d = new Date(day * 86400000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * 一条轴的时间范围。
 *
 * 上下各留 6% 的余量，免得首尾两个事件正好顶在轴的两端 ——
 * 那儿是弧线拐弯的地方，挤在边上的话标签会顶出画布。
 * 只有一个点（或所有点同一天）时，人为撑开一天，不然除数为 0。
 */
export function rangeOf(tl: Timeline): { min: number; max: number } {
  const days = tl.points.map((p) => dayOf(p.date)).filter((d) => Number.isFinite(d));
  if (!days.length) return { min: 0, max: 1 };
  let min = Math.min(...days);
  let max = Math.max(...days);
  if (max - min < 1) {
    min -= 0.5;
    max += 0.5;
  }
  const pad = (max - min) * 0.06;
  return { min: min - pad, max: max + pad };
}

/** 某一天在这条轴上的位置，0（最早）~ 1（最晚） */
export function paramOf(tl: Timeline, day: number): number {
  const { min, max } = rangeOf(tl);
  if (!Number.isFinite(day)) return 0.5;
  return (day - min) / (max - min);
}

/** 时间点的位置 */
export function pointParam(tl: Timeline, p: TimelinePoint): number {
  return paramOf(tl, dayOf(p.date));
}

/**
 * 时间段的位置：取两端日期的中点。
 * 页面滚到「对应这个时间段的那个成分」时，轴就停在这个位置。
 */
export function spanParam(tl: Timeline, s: TimelineSpan): number {
  const a = tl.points.find((p) => p.id === s.from);
  const b = tl.points.find((p) => p.id === s.to);
  const da = a ? dayOf(a.date) : NaN;
  const db = b ? dayOf(b.date) : NaN;
  if (!Number.isFinite(da) && !Number.isFinite(db)) return 0.5;
  if (!Number.isFinite(da)) return paramOf(tl, db);
  if (!Number.isFinite(db)) return paramOf(tl, da);
  return paramOf(tl, (da + db) / 2);
}

/** 时间段两端的位置（画那条范围带用），排好先后 */
export function spanEdges(tl: Timeline, s: TimelineSpan): { from: number; to: number } {
  const a = tl.points.find((p) => p.id === s.from);
  const b = tl.points.find((p) => p.id === s.to);
  const da = a ? dayOf(a.date) : NaN;
  const db = b ? dayOf(b.date) : NaN;
  if (!Number.isFinite(da) || !Number.isFinite(db)) {
    const one = spanParam(tl, s);
    return { from: one, to: one };
  }
  const lo = paramOf(tl, Math.min(da, db));
  const hi = paramOf(tl, Math.max(da, db));
  return { from: lo, to: hi };
}

/**
 * 这段时间段要画在哪几侧。
 *
 * 数据里写了 `side` 就听数据的；老数据没有这一项，就跟着**起点那个时间点**
 * 的侧走（这是这一版之前的行为，不能因为加了字段就让老数据变样）。
 */
export function spanSides(tl: Timeline, s: TimelineSpan): TimelineSide[] {
  if (s.side === 'both') return ['left', 'right'];
  if (s.side === 'left' || s.side === 'right') return [s.side];
  const from = tl.points.find((p) => p.id === s.from);
  return [from?.side === 'right' ? 'right' : 'left'];
}

/**
 * 给同一侧的时间段**分层**：时间上有重叠的排到不同的「层」。
 *
 * 为什么需要：两个时间段如果时间上重合（比如「北大年代」和「花娅年代」
 * 在右边叠了四分之一条轴），它们会画在弧线的同一个偏移上、用同一套落日色，
 * 看起来就是一条压着另一条，根本分不出哪段是哪段。
 * 分层之后重叠的那些各自往外让一档、各用各的颜色，重合的那一段一眼能看出是两条。
 *
 * 算法就是经典的区间着色（贪心）：按起点排序，能塞进已有的层就塞，
 * 塞不下就新开一层。层数等于「同一时刻最多有几段叠着」，所以不会乱开。
 * 首尾正好相接（一段的结束 == 另一段的开始）不算重叠，还是同一层。
 */
export function assignSpanLanes<T extends { id: string; side: TimelineSide; lo: number; hi: number }>(
  spans: T[]
): Map<string, number> {
  const out = new Map<string, number>();
  for (const side of ['left', 'right'] as const) {
    const list = spans.filter((s) => s.side === side).sort((a, b) => a.lo - b.lo);
    const ends: number[] = [];
    for (const s of list) {
      let lane = ends.findIndex((end) => end <= s.lo);
      if (lane < 0) {
        lane = ends.length;
        ends.push(s.hi);
      } else {
        ends[lane] = s.hi;
      }
      out.set(s.id, lane);
    }
  }
  return out;
}

/**
 * 页面上的一个成分认领了哪个时间点 / 时间段。
 *
 * 块和子版块都可能有，取数时统一成这一个形状。
 */
export interface TimeRef {
  point?: string;
  span?: string;
}

/** 认领的东西在这一页用的那条轴上落在哪（0~1）；没认领返回 null */
export function refParam(tl: Timeline | undefined, ref: TimeRef | undefined): number | null {
  if (!tl || !ref) return null;
  if (ref.span) {
    const s = tl.spans.find((x) => x.id === ref.span);
    if (s) return spanParam(tl, s);
  }
  if (ref.point) {
    const p = tl.points.find((x) => x.id === ref.point);
    if (p) return pointParam(tl, p);
  }
  return null;
}

/** 认领的名字（鼠标提示 / 无障碍标签用） */
export function refLabel(tl: Timeline | undefined, ref: TimeRef | undefined): string | null {
  if (!tl || !ref) return null;
  if (ref.span) {
    const s = tl.spans.find((x) => x.id === ref.span);
    if (s) return s.name;
  }
  if (ref.point) {
    const p = tl.points.find((x) => x.id === ref.point);
    if (p) return p.label;
  }
  return null;
}
