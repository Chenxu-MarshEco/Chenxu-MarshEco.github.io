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
 * 2026-11-22 加的第二条来源（站长：「每次收到lingyi的推流后都自动获取每天的这个json
 * 并把里面的群圣经部分转录到铃忆圣经里」）：
 *   lingyi 每天推上来的那份完整群总结（`public/data/group-summaries/*.json`）里
 *   `analysis_result.statistics.golden_quotes` 就是当天的五条群圣经。这里在构建期
 *   直接读它，**同一天已经有天文件就以天文件为准**（lingyi 自己投的那份更准，
 *   推导出来的不覆盖它）。于是推送一上来、部署一跑，圣经页就有了，中间不需要任何人跑脚本。
 *   想看某天会抄哪五条：`node tools/bellie/from-summary.mjs`。
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
import { dayOf, paramOf, type Timeline } from './timelines';
/*
 * 群总结里的群圣经（2026-11-22 加）。解析规则在 tools/bellie/summary.mjs 一处，
 * 构建期和 `node tools/bellie/from-summary.mjs` 共用，不会各写一套对不上。
 */
import { readSummaryDays } from '../../tools/bellie/summary.mjs';
import { dedupeByText } from '../../tools/bellie/dedupe.mjs';

export interface BibleEntry {
  /** 稳定 id：`b` + 日期（去横线）+ 当天序号，例如 b20261120-3 */
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM（可能为空串 —— 老格式的投递里没有具体时间） */
  time: string;
  /** 发送者 QQ 号（可能为空串 —— 老格式里只写群名片） */
  qq: string;
  /** 投递里写的发送者（群名片 / 马甲 / QQ 号，认不出来时原样当署名） */
  sender: string;
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
  /** 这一天是从哪来的（群总结推导出来的会写那份 JSON 的路径；天文件没有这一项） */
  source?: string;
  /**
   * 群总结里那些匿名号 → 群名片（`user-001` → `🏗隰辰煦🏗`）。
   * 只有从群总结推导出来的天才有；天文件直接投递的不需要（写的就是人）。
   */
  users?: Record<string, string>;
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
/** 马甲 → 成员：aliases.json 的 nick 那一区 + 成员自己身上的 aliases */
const BY_ALIAS = new Map<string, SalonMember>();
for (const m of salonMembers) {
  for (const a of m.aliases ?? []) if (a) BY_ALIAS.set(a, m);
}
for (const [nick, name] of Object.entries((ALIASES?.nick ?? {}) as Record<string, string>)) {
  const m = BY_NAME.get(name);
  if (m && nick) BY_ALIAS.set(nick, m);
}

/**
 * 把群名片上的装饰洗掉：表情、变体选择符、不可见的填充字符（ᅠ⁧‭ 这些）
 * 全去掉，只留中日韩文字、字母、数字。例如 `🏗隰辰煦🏗` → `隰辰煦`。
 */
const cleanName = (s: string): string =>
  s.replace(/[^\p{Script=Han}\p{L}\p{N}]/gu, '');

/**
 * 认人：QQ 号 → 群名片 → 马甲 → 洗过的群名片 / 马甲 → 「已知名字是它的前缀」。
 * 顺序有讲究：前三种是一字不差的匹配，最后两种才放宽，免得把 A 认成 B。
 */
function resolveMember(raw: string): SalonMember | undefined {
  const s = str(raw);
  if (!s) return undefined;
  const byQq = QQ_NAME[s];
  if (byQq && BY_NAME.get(byQq)) return BY_NAME.get(byQq);
  if (BY_NAME.has(s)) return BY_NAME.get(s);
  if (BY_ALIAS.has(s)) return BY_ALIAS.get(s);
  const cleaned = cleanName(s);
  if (cleaned) {
    if (BY_NAME.has(cleaned)) return BY_NAME.get(cleaned);
    if (BY_ALIAS.has(cleaned)) return BY_ALIAS.get(cleaned);
    /* 群名片后面常跟一串洗不掉的怪字符 / 后缀（`亚卡莱特ᅠ⁧呃呜喵⁧‭`）：
       已知名字是开头那一段就认它。要求至少 2 个字，免得单字撞上。 */
    for (const [key, m] of [...BY_NAME, ...BY_ALIAS]) {
      if (key.length >= 2 && cleaned.startsWith(key)) return m;
    }
  }
  return undefined;
}

/**
 * 正文 / 评语里出现的 QQ 号 → 成员名。
 * 站长 2026-11-20：「评语里面是有QQ号的 进入网站时自动把QQ号转化为群成员」——
 * 评语是铃忆写的原文，站点只负责把号换成名字（号本身留着，万一认不出来还是号）。
 *
 * 2026-11-21 补：铃忆点人的写法是**方括号包着号**（`承接 [2603693195] 的性器官蛋糕话题`），
 * 换完要是留着方括号就成了「承接 [盾返] 的…」—— 那对方括号本来只是"这是一个号"的记号，
 * 号一变成名字就多余了，所以连括号一起去掉。认不出来的号**原样不动**（括号也留着）。
 */
export function qqToNames(s: string): string {
  return String(s ?? '').replace(/\[(\d{5,12})\]|(\d{5,12})/g, (all, bracketed: string, bare: string) => {
    const name = QQ_NAME[bracketed || bare];
    return name || all;
  });
}

/**
 * 评语里的**匿名号**（`[user-004]` / 裸的 `user-004`）→ 成员名。
 *
 * 站长 2026-11-22：「11.22的圣经的评价里有问题 群成员都变成了user-00x」。
 * 根子不在站点：lingyi 推的群总结为了隐私把发送者换成了 `user-001…`
 * （`privacy.structured_user_ids`），铃忆写评语点人时写的就是这个号
 * （`「群友们还在正常聊烤鱼…，[user-004] 突然……」`）。`qqToNames` 只认**数字 QQ 号**，
 * `user-004` 不是数字，于是原样露在圣经卡片的评语里。
 *
 * 现在：群总结里自带的 `user_analysis[user-00X].nickname` 先把号对上群名片
 * （见 `tools/bellie/summary.mjs` 的 `nicknamesOf`），这里再用站点那张别名表
 * 换成**正式成员名**（`🏗隰辰煦🏗` → 隰辰煦、`妹妹大人（两个凡是版）` → Raw）。
 * 对不上的号**原样留着**（括号也留着），不瞎编 —— 那种情况解析那边会记一笔。
 * 方括号和 QQ 号那条一个道理：它只是"这是一个号"的记号，换成名字之后就多余了。
 */
function userIdsToNames(s: string, users: Record<string, string>): string {
  /*
   * 号按数字对齐：`user-004` 查不到时，`user_4` / `user0004` 这种写法也认
   * （导出的写法变一下不该又漏回页面上）。
   */
  const byNum: Record<string, string> = {};
  for (const [id, nick] of Object.entries(users)) {
    const digits = String(id).match(/\d+/);
    if (digits) byNum[String(Number(digits[0]))] = nick;
  }
  const name = (id: string) => {
    const digits = id.match(/\d+/);
    const nick = users[id] ?? (digits ? byNum[String(Number(digits[0]))] : undefined);
    if (!nick) return '';
    return resolveMember(nick)?.name ?? nick;
  };
  return String(s ?? '')
    .replace(/\[\s*(user[-_]?\d+)\s*\]/gi, (all, id: string) => name(id) || all)
    .replace(/(?<![\w-])(user[-_]?\d+)(?![\w-])/gi, (all, id: string) => name(id) || all);
}

const str = (v: unknown): string => String(v ?? '').trim();

function readDays(): DayFile[] {
  const out: DayFile[] = [];
  let files: string[] = [];
  try {
    files = fs.readdirSync(DAYS_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    /* 目录还没建（比如刚克隆、还没人投过）：不算错，下面还会看群总结 */
  }
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
  /*
   * 群总结里的群圣经（2026-11-22）：lingyi 每天推上来的那份完整群总结里
   * `statistics.golden_quotes` 就是当天的五条。**天文件优先** —— 同一天已经有人投过
   * 天文件就跳过，推导永远不覆盖直接投递（那是机器人自己挑的，比按金句抄更准）。
   * 只读不写：构建时一个字节都不往仓库里落。
   */
  const covered = new Set(out.map((d) => String(d.date)));
  for (const day of readSummaryDays({ root: process.cwd() }).days) {
    if (covered.has(day.date)) continue;
    out.push({ date: day.date, source: day.file, users: day.users, entries: day.entries as DayFile['entries'] });
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/** 全部圣经条目，**按日期倒序、同一天按时间倒序**（和精华页一样新的在前） */
export const bellieEntries: BibleEntry[] = (() => {
  const out: BibleEntry[] = [];
  for (const day of readDays()) {
    const date = str(day.date);
    const list = Array.isArray(day.entries) ? day.entries : [];
    const users = day.users ?? {};
    list.forEach((e, i) => {
      const text = str(e?.text);
      if (!text) return;
      /* 发送者三种写法都收：qq（新格式）/ name（老格式的群名片）/ 两个都给 */
      const qq = str(e?.qq);
      /* 万一发送者被导出成了匿名号（正常情况下是群名片），也先换成名字再认人 */
      const senderRaw = userIdsToNames(str(e?.name) || str(e?.qq), users);
      const member = resolveMember(qq) ?? resolveMember(senderRaw);
      out.push({
        id: `b${date.replace(/-/g, '')}-${i + 1}`,
        date,
        time: str(e?.time),
        qq,
        sender: senderRaw,
        memberIds: member ? [member.id] : [],
        /* 群总结推导出来的天，评语里点的是 `user-00X`：先换成成员名（正文同样处理，
           原句里万一也点到号，不能让它原样露在页面上） */
        text: userIdsToNames(text, users),
        comment: userIdsToNames(str(e?.comment), users),
        rawName: member ? member.name : senderRaw,
      });
    });
  }
  /*
   * **从早到晚**（和 `salon.ts` 的精华一条规则：`${date} ${time}` 升序，同刻按 id）。
   *
   * 2026-11-21 改的：原来是倒序，结果圣经页和精华页长得不一样 ——
   *   · 分块是从这个数组头尾切的（`chunk 0` = 数组最前 20 条），页面首屏预渲染的是
   *     **最后一块**；倒序时最后一块是最老的那天，于是一进 /bellie/ 停在 10-03，
   *     而 /salon/ 停在最新那天；
   *   · `data-tl-default` 取的是数组第一条的 param，倒序时算成轴的最末端（1），
   *     刻度高亮和点击跳转全对不上。
   * 改成和精华一样升序：首页那条「每日圣经」按 `dailyIndex` 取，跟顺序无关。
   */
  const sorted = out.sort(
    (a, b) =>
      `${a.date} ${a.time || '00:00'}`.localeCompare(`${b.date} ${b.time || '00:00'}`) ||
      a.id.localeCompare(b.id),
  );
  /*
   * 查重（2026-11-23 站长：「发现这种正文内容完全一样的两条圣经时 应直接删去后录入的
   * 只保留时间最早的一条」）。规则在 tools/bellie/dedupe.mjs —— 验收脚本用的是同一份。
   * 先排好序再查：留下的就是日期（+时间）最早的那条，署名 / 头像 / 成员计数都跟着它。
   */
  const { kept, dropped } = dedupeByText(sorted) as { kept: BibleEntry[]; dropped: { kept: BibleEntry; dropped: BibleEntry }[] };
  if (dropped.length) {
    console.log(`[bellie] 正文查重：删掉后录入的 ${dropped.length} 条（只留最早那条）`);
    for (const d of dropped.slice(0, 20)) {
      console.log(`  · 留 ${d.kept.date}（${d.kept.id}），删 ${d.dropped.date}（${d.dropped.id}）：${str(d.kept.text).slice(0, 24)}…`);
    }
  }
  return kept;
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

/**
 * 某条在时间轴上的位置（0~1），页面里写成 `data-tl-param`。
 *
 * ⚠ 必须走**和精华同一条路**：`paramOf(tl, dayOf(date))` 用的是这条轴自己的范围
 *   （含分轴 / 弧长），页面脚本才认得出「滚到哪 = 轴上哪个位置」，点轴上刻度也才
 *   比得出最近的那条。2026-11-21 之前这里是拿 points 的 min/max 自己线性的算的，
 *   结果首页那条「每日圣经」进了圣经页之后默认参数算成 1（轴的最末端），
 *   页面一打开就停在最老那一天，点刻度也不跳。
 */
export function bellieParams(tl: Timeline): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of bellieEntries) out.set(e.id, paramOf(tl, dayOf(e.date)));
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
