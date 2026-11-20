/**
 * ============================================================================
 * 「铃忆的冰室圣经」的取数（构建期）—— /bellie/
 * ----------------------------------------------------------------------------
 * 站长 2026-11-20 的原话：
 *   「做新页面：铃忆的冰室圣经  地址为 /bellie  这个页面与冰室精华的结构完全相同
 *    直接复制冰室精华的结构   lingyi机器人从今天起向网站内投递的不只是铃忆日记了
 *    还会每天附带一个群圣经的json  每天有五条  附带发送时间 发送者QQ号  正文部分
 *    铃忆评语四个部分  接收到文件以后 自动将其像精华一样填入圣经页面中
 *    明确时间和发送者（自动对QQ号）以便像精华一样可以同步时间轴以及查看发送成员
 *    和精华的唯一区别是正文部分 一张圣经卡片应分为正文和评语两个部分
 *    正文是成员在群内说的原句  要正常比例显示  而评语是lingyibot的AI每天对其的吐槽评析
 *    应用小的斜体写在下方部分」
 *
 * 数据放法（为什么一天一个文件）：
 *   机器人每天写 `src/data/bellie/days/<YYYY-MM-DD>.json`，**一天一个文件、只由它写**。
 *   这和「推流动态读 git 提交说明」是同一个思路：各人写各人的文件，结构上不可能撞车。
 *   站点这边把整个目录按日期倒序读进来，不需要任何合并步骤。
 *
 * 一条的形状：
 *   { time: "12:34", qq: "2567645574", text: "群友原句", comment: "铃忆的吐槽" }
 *   · time    发送时间（HH:MM，可省）
 *   · qq      发送者 QQ 号 —— 站点用 tools/salon/aliases.json 的 `qq` 那张表认人
 *   · text    正文（原句，正常字号）
 *   · comment 评语（铃忆写的，小字斜体放在下面）
 *
 * ⚠ 认不出 QQ 号时**不瞎编**：那一条照样显示，署名用群名片/QQ 号本身 ——
 *   和精华那边「认不出来的号会列出来等人补」一个态度。
 */
import fs from 'node:fs';
import path from 'node:path';
import config from '../data/bellie.json';
import { salonMembers, type SalonMember } from './salon';

export interface BibleEntry {
  /** 稳定 id：`b` + 日期（去横线）+ 当天序号，例如 b20261120-3 */
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM（可能为空串） */
  time: string;
  /** 发送者 QQ 号（原样保留） */
  qq: string;
  /** 认出来的成员 id 列表（认不出来就是空数组） */
  memberIds: string[];
  /** 正文：群友原句 */
  text: string;
  /** 评语：铃忆的吐槽评析（小字斜体） */
  comment: string;
  /** 这个成员在别名表里认不出来时，只能拿 QQ 号署名 */
  rawName: string;
}

interface DayFile {
  date?: string;
  entries?: { time?: string; qq?: string | number; text?: string; comment?: string; name?: string }[];
}

const DAYS_DIR = path.join(process.cwd(), 'src', 'data', 'bellie', 'days');
const ALIASES = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tools', 'salon', 'aliases.json'), 'utf8'));
  } catch {
    return {};
  }
})();

/** QQ 号 → 站里的成员名（`tools/salon/aliases.json` 的 qq 那一张表） */
const QQ_NAME: Record<string, string> = (ALIASES?.qq ?? {}) as Record<string, string>;
/** 名字 → 成员（名字必须和 salon.json 的 members[].name 一字不差） */
const BY_NAME = new Map<string, SalonMember>(salonMembers.map((m) => [m.name, m]));

const str = (v: unknown): string => String(v ?? '').trim();

function readDays(): DayFile[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(DAYS_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out: DayFile[] = [];
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DAYS_DIR, f), 'utf8')) as DayFile;
      /* 文件名就是日期时以文件名为准：机器人写错里面的 date 也不会串到别的天 */
      const fromFile = f.replace(/\.json$/, '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(fromFile)) data.date = fromFile;
      if (data.date) out.push(data);
    } catch {
      /* 坏文件跳过：一天写坏了不该把整页弄没 */
    }
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/** 全部圣经条目，**按日期倒序、同一天按时间倒序**（和精华页一样新的在前） */
export const bellieEntries: BibleEntry[] = (() => {
  const out: BibleEntry[] = [];
  for (const day of readDays()) {
    const date = str(day.date);
    const list = Array.isArray(day.entries) ? day.entries : [];
    list.forEach((e, i) => {
      const text = str(e?.text);
      if (!text) return;
      const qq = str(e?.qq);
      const name = QQ_NAME[qq] || str(e?.name);
      const member = name ? BY_NAME.get(name) : undefined;
      out.push({
        id: `b${date.replace(/-/g, '')}-${i + 1}`,
        date,
        time: str(e?.time),
        qq,
        memberIds: member ? [member.id] : [],
        text,
        comment: str(e?.comment),
        rawName: member ? member.name : name || qq,
      });
    });
  }
  /* 日期倒序；同一天里时间晚的在前（没有时间的排当天最后） */
  return out.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const at = a.time || '99:99';
    const bt = b.time || '99:99';
    if (at !== bt) return at < bt ? 1 : -1;
    return b.id.localeCompare(a.id);
  });
})();

export const bellieTitle: string = str((config as { title?: string }).title) || '铃忆的冰室圣经';
export const bellieUpdated: string = str((config as { updated?: string }).updated);
/** 这一页挂哪条时间轴（和精华页同一个字段名，留空 = 不挂） */
export const bellieTimelineId: string = str((config as { timelineId?: string }).timelineId);
export const bellieNote: string = str((config as { note?: string }).note);

/** 有名字的那些成员（成员栏按这个排） */
export const bellieMemberStats = (() => {
  const count = new Map<string, number>();
  for (const e of bellieEntries) for (const id of e.memberIds) count.set(id, (count.get(id) ?? 0) + 1);
  return salonMembers
    .filter((m) => count.has(m.id))
    .map((m) => ({ member: m, count: count.get(m.id) ?? 0 }))
    .sort((a, b) => b.count - a.count);
})();

/** 某条在时间轴上的位置（按日期算，和精华那边同一套） */
export function bellieParams(tl: { spans?: unknown; points?: { date?: string }[] }): Map<string, number> {
  const out = new Map<string, number>();
  const points = (tl?.points ?? []).map((p) => Date.parse(String(p.date ?? ''))).filter((t) => Number.isFinite(t));
  if (!points.length) {
    for (const e of bellieEntries) out.set(e.id, 0);
    return out;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(1, max - min);
  for (const e of bellieEntries) {
    const t = Date.parse(e.date);
    out.set(e.id, Number.isFinite(t) ? Math.min(1, Math.max(0, (t - min) / span)) : 0);
  }
  return out;
}

/* ------------------------------------------------------------------
   给 bellie.astro 用的**同名单**（那一页是 salon.astro 的拷贝）
   ------------------------------------------------------------------
   页面里通篇写的是 salonEssences / salonTitle / essenceParams / salonMemberStats …
   换数据源只要换 import 路径，所以这里按精华那边同样的名字再导出一次。
   别在别处用这些名字，它们只是"让拷贝过来的页面不用改"。
   ------------------------------------------------------------------ */
export const salonEssences = bellieEntries;
export const salonTitle = bellieTitle;
export const salonUpdated = bellieUpdated;
export const salonTimelineId = bellieTimelineId;
export const salonMemberStats = bellieMemberStats;
export const essenceParams = bellieParams;
