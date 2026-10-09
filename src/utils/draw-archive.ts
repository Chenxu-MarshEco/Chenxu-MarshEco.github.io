/*
 * ============================================================================
 * 画板「存档」的读法（构建期，2026-10-09）
 * ----------------------------------------------------------------------------
 * 用户原话：「每天保存一次画 …… 其他用户以后也可以点开一个日历页面 查看每一天的画板上
 * 都画了什么」。这一页面的数据全在仓库里（tools/liyutang-archive.mjs 每天写）：
 *
 *   src/data/draw/index.json   有哪些天、每天多少笔、几个人画的
 *   src/data/draw/<日>.json    那天的笔划（矢量，带是谁画的、什么工具、什么颜色、点集）
 *   public/img/draw/<日>.svg   同一批笔划渲染成的一张图（日历/日页直接当图片用）
 *
 * 读法上有一个讲究：**用 import.meta.glob 而不是静态 import** ——
 * 一份存档都还没有的时候（刚上线那几天），`src/data/draw/<日>.json` 一个文件都不存在，
 * 静态 import 会让构建直接炸；glob 拿不到就是空数组，页面走"还没有存档"那条路。
 *
 * 这个文件和 src/utils/chat-archive.ts 是一对（聊天室那边也有一份同样的读法）。
 * ============================================================================
 */
import { withBase } from './url';

export interface DrawPainter {
  uk: string;
  nick: string;
  count: number;
}

/** 索引里的一行 */
export interface DrawDayMeta {
  day: string;
  count: number;
  painters: number;
  users?: string[];
}

/** 某一天的存档 */
export interface DrawArchive {
  day: string;
  archivedAt: string;
  count: number;
  painters: DrawPainter[];
  strokes: Array<{
    id: string;
    uk: string;
    nick: string;
    avatar: string;
    tool: string;
    color: string;
    size: number;
    points: number[][];
    createdAt: number;
  }>;
}

/* 索引：可能有、也可能没有（还没有任何存档时） */
const indexFiles = import.meta.glob<{ days?: DrawDayMeta[] }>('../data/draw/index.json', { eager: true });
const rawIndex = Object.values(indexFiles)[0];

/** 所有有存档的日子（日期倒序，新的在前） */
export function drawDays(): DrawDayMeta[] {
  const list = Array.isArray(rawIndex?.days) ? rawIndex!.days : [];
  return list
    .filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(String(d.day)))
    .map((d) => ({
      day: String(d.day),
      count: Number(d.count) || 0,
      painters: Number(d.painters) || 0,
      users: Array.isArray(d.users) ? d.users.map((u) => String(u)) : [],
    }))
    .sort((a, b) => b.day.localeCompare(a.day));
}

export const drawDay = (day: string): DrawDayMeta | undefined => drawDays().find((d) => d.day === day);

/* 每天的笔划：一次 glob 全读进来（存档文件不大，一天几 KB） */
const dayFiles = import.meta.glob<DrawArchive>('../data/draw/*.json', { eager: true });
const archives = new Map<string, DrawArchive>();
for (const [file, mod] of Object.entries(dayFiles)) {
  const name = file.split('/').pop() ?? '';
  if (name === 'index.json') continue;
  const fromName = name.replace(/\.json$/, '');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(mod?.day ?? '')) ? String(mod.day) : fromName;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
  archives.set(day, mod);
}

/** 某一天的笔划（没有就是 undefined） */
export const drawArchive = (day: string): DrawArchive | undefined => archives.get(day);

/** 那一天的板长什么样（存档脚本渲染好的 SVG，放在 public 下） */
export const drawSvgUrl = (day: string): string => withBase(`/img/draw/${day}.svg`);

/** 画板本体（今天那块，可以画） */
export const boardUrl = (): string => withBase('/liyutang/teahouse/');

/** 日历（所有画过的日子） */
export const drawCalendarUrl = (): string => withBase('/liyutang/teahouse/calendar/');

/** 某一天的板（只读，回看） */
export const drawDayUrl = (day: string): string => withBase(`/liyutang/teahouse/${day}/`);

/** 「2026-10-08」→「2026 年 10 月 8 日（周三）」 */
export function drawDateText(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  const d = new Date(`${day}T00:00:00Z`);
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getUTCDay()] ?? '';
  return `${Number(m[1])} 年 ${Number(m[2])} 月 ${Number(m[3])} 日（${week}）`;
}
