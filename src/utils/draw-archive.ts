/*
 * ============================================================================
 * 画板「存档」的读法（构建期，2026-10-09）
 * ----------------------------------------------------------------------------
 * 用户原话：「每天保存一次画 …… 其他用户以后也可以点开一个日历页面 查看每一天的画板上
 * 都画了什么」。这一页面的数据全在仓库里（tools/liyutang-archive.mjs 每天写）：
 *
 *   src/data/draw/index.json   有哪些天、每天多少笔、几个人画的、**那天动过笔的人（含头像）**
 *   src/data/draw/<日>.json    那天的笔划（矢量，带是谁画的、什么工具、什么颜色、点集）
 *   public/img/draw/<日>.svg   同一批笔划渲染成的一张图（日历/日页直接当图片用）
 *
 * 读法上有一个讲究：**用 import.meta.glob 而不是静态 import** ——
 * 一份存档都还没有的时候（刚上线那几天），`src/data/draw/index.json` 不存在，
 * 静态 import 会让构建直接炸；glob 拿不到就是空对象，页面走"还没有存档"那条路。
 *
 * ⚠ 2026-10-10：**不要再 glob `data/draw/*.json`**（哪怕不 eager）。一天的存档几 MB，
 * 天数一多就会把构建拖垮。日页要的东西（人表）已经在 index.json 里了，笔划文件只有
 * "真要重放笔划"的时候才需要，那时候再按需读单个文件。
 *
 * 这个文件和 src/utils/chat-archive.ts 是一对（聊天室那边也有一份同样的读法）。
 * ============================================================================
 */
import { withBase } from './url';

export interface DrawPainter {
  uk: string;
  nick: string;
  /** 那天用的头像（按人一份；笔划里不再各存一遍，那是 90% 的体积） */
  avatar?: string;
  count: number;
}

/** 索引里的一行 */
export interface DrawDayMeta {
  day: string;
  count: number;
  painters: number;
  users?: string[];
  /** 那天动过笔的人（日页那张表就靠它 —— 于是构建不必读每天的 <日>.json） */
  people?: DrawPainter[];
}

/** 某一天的存档（**构建期不读它**：一天几 MB，只有真要重放笔划时才用得上） */
export interface DrawArchive {
  day: string;
  archivedAt: string;
  count: number;
  people: DrawPainter[];
  strokes: Array<{
    id: string;
    uk: string;
    nick: string;
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
      people: Array.isArray(d.people)
        ? d.people
            .filter((p) => p && p.uk)
            .map((p) => ({
              uk: String(p.uk),
              nick: String(p.nick ?? ''),
              avatar: String(p.avatar ?? ''),
              count: Number(p.count) || 0,
            }))
        : [],
    }))
    .sort((a, b) => b.day.localeCompare(a.day));
}

export const drawDay = (day: string): DrawDayMeta | undefined => drawDays().find((d) => d.day === day);

/**
 * 那天动过笔的人（按笔数从多到少）。
 *
 * ⚠ 数据来自**索引**，不是每天的 `<日>.json` —— 2026-10-10 改的：
 * 原来这里 `import.meta.glob('../data/draw/*.json', { eager: true })` 把**每一天**的存档
 * 全读进构建（当时注释还写着"存档文件不大，一天几 KB"，实际一天 8MB），
 * 天数一多构建就会越来越慢、内存越来越高。现在人表提前写进 index.json（几十 KB），
 * 页面只要它 + 那张 SVG，于是**构建一个 <日>.json 都不用读**。
 */
export function drawPeople(day: string): DrawPainter[] {
  const meta = drawDay(day);
  if (!meta) return [];
  if (meta.people?.length) return [...meta.people].sort((a, b) => b.count - a.count);
  /* 老索引（还没带上 people 的那几天）：退回用昵称凑，别让页面空着 */
  return (meta.users ?? []).map((nick) => ({ uk: nick, nick, count: 0 }));
}

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
