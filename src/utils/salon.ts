/**
 * 冰室精华（群精华）的取数逻辑（构建期）。
 *
 * 数据在 `src/data/salon.json`，三块：
 *   members    成员表 —— 头像 + 名字都在这里，精华里只存 memberIds
 *   essences   精华条目 —— 每条 = 成员（**可以多个**）+ 时间 + 内容（文字 / 图片）
 *   eras       五个年代 —— 只用于**列表**里的分段小标题（不再拿来造时间轴）
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
 * 左边那条时间轴**不再自己生成**：编辑器里选一条站点已有的时间轴（存 `timelineId`），
 * 页面上原样渲染那一条，一个点都不加、不改（见下面 salonTimelineId 的说明）。
 */
import raw from '../data/salon.json';
import { dailyIndex } from './daily';
import { dayOf, paramOf, type Timeline } from './timelines';

export interface SalonMember {
  id: string;
  name: string;
  /** 头像（/img/... 或外链）；留空就显示一个占位圆 */
  avatar: string;
  /**
   * 这个人的「介绍页」地址（站内路径或外链）。留空 = 站点正文里出现的这个名字
   * 只浮现名片、点不动（页面还没做好时就是这个状态）。
   * 由 tools/memlink 在构建期读它，把全站正文里的名字自动链上。
   */
  url?: string;
  /**
   * 还要按哪些别的写法一起链（默认空数组）。
   * ⚠ 只按这里写的 + `name` 来链 —— 所以旧名（比如「花花」）只要不写进来，
   * 正文里出现多少次都不会被链接。想链旧名就自己往这里加一条。
   */
  aliases?: string[];
  /** 名片里名字下面那行小字（Raw 是「冰室之主」）；留空就不显示 */
  title?: string;
  /** 名片上半画一轮蒸汽波落日（只有需要"特殊化"的成员才开） */
  sun?: boolean;
  /**
   * 鼠标移到头像上时，放大框里固定显示这张图（留空 = 就用头像那张）。
   * 例：Raw 用的是他自己那张立绘。站内路径 / 外链都行。
   */
  zoom?: string;
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

export const salonMembers: SalonMember[] = (DATA.members ?? [])
  .filter((m) => m && m.id && m.name)
  /* url / aliases / title / sun / zoom 都是后加的字段，老数据里没有 —— 这里补成空值，
     免得页面各处都要写 `m.url ?? ''`（tools/memlink 读的是同一个文件，也这么兜底） */
  .map((m) => ({
    ...m,
    url: String(m.url ?? '').trim(),
    title: String(m.title ?? '').trim(),
    zoom: String(m.zoom ?? '').trim(),
    sun: m.sun === true,
    aliases: (Array.isArray(m.aliases) ? m.aliases : []).map((a) => String(a ?? '').trim()).filter(Boolean),
  }));
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
   左边那条时间轴：**原样**用站点里已有的某一条
   ------------------------------------------------------------------ */

/**
 * 冰室精华页左边放哪条时间轴 —— 由编辑器在「精华」面板里选（存 `salon.json` 的 `timelineId`）。
 *
 * 这里**只存一个 id**，页面上直接把 `getTimeline(id)` 拿到的那条时间轴原样渲染：
 * 点、段、塔吊图标、比例尺全是那条轴自己的，本站一个都不加、不删、不改
 * （以前这里是自己按精华日期生成 431/450 个点、还写死 tickDays 2 把轴拉长到 17 万像素，
 * 又卡又超出用户要求 —— 用户原话：「不要做任何改动」）。
 *
 * 页面上唯一额外加的行为是：点轴上的刻度/塔吊 → 滚到**离那个刻度最近**的一条精华
 * （见 salon.astro 里那段脚本）。轴的数据改了，这里自然跟着变，不用重新生成任何东西。
 */
export const salonTimelineId: string = String((DATA as { timelineId?: string }).timelineId || '');

/**
 * 每条精华在时间轴上的位置（0~1），页面里写成 `data-tl-param`。
 *
 * 用的是**所选那条时间轴自己的**范围（`paramOf`），所以：
 *   · 轴脚本照旧能靠它把"页面滚到哪"和轴上的"当前"对上（左边那条轴跟着页面走）；
 *   · 点轴上的刻度时，拿刻度的 param 去比每条精华的 param，最近的那条就是要跳的那条 ——
 *     不需要解析日期，也不受"这条轴上没画精华日期"的影响。
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
