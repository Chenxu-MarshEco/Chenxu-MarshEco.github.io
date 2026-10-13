/*
 * ============================================================================
 * 日志字数：前一天的日志多长？长了就压。
 * ----------------------------------------------------------------------------
 * 站长 2026-10-13 的原话：
 *   「更新日志脚本再加一条 每天第一次与你对话时自动检查前一天的日志字数并自动压缩」
 *
 * 所以这是一个**每天开工先跑**的小仪式（写在 AGENTS.md 里，不靠记性）：
 *   node tools/memory/log-length.mjs --yesterday
 * 它只看**前一天**那一栏：没写 → 提示（不算错）；超上限 → 退出码 1，并告诉你压到多少。
 *
 * 怎么压（工具只能报数，压得你来写）：
 *   1. 把那一栏的事实留下：改了什么、为什么、怎么验的；
 *   2. 砍掉铺陈、重复、形容词，以及"我/我们"那种叙述腔；
 *   3. **原地覆盖**同一栏（append-log 同一天再写一次就是覆盖，不会多出一栏）：
 *        node tools/memory/append-log.mjs 2026.10.12 .tmp/log.txt --dry   # 先看
 *        node tools/memory/append-log.mjs 2026.10.12 .tmp/log.txt         # 写回
 *   4. 再跑一次本脚本确认不超了。
 *
 * ⚠ 数字是按**字符**算的（中文一个字算一个；用 [...text] 数，emoji 不会算成两个）。
 *   上限 / 目标就写在下面两个常量里，要改就改这里 —— AGENTS.md 里的说法跟着这个走。
 *
 * 用法：
 *   node tools/memory/log-length.mjs              # 最近 7 天各多少字（超的标出来）
 *   node tools/memory/log-length.mjs --yesterday  # 只看前一天；超了退出码 1
 *   node tools/memory/log-length.mjs --json       # 机读
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 一栏超过这么多字就该压 */
const LIMIT = 1000;
/** 压缩的目标（写多长合适） */
const TARGET = 600;
/** 默认列最近几天 */
const DAYS = 7;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FILE = path.join(ROOT, 'src', 'data', 'mianyu.json');

const argv = process.argv.slice(2);
const onlyYesterday = argv.includes('--yesterday');
const asJson = argv.includes('--json');

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
const stamp = (s) => {
  const m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/.exec(String(s ?? '').trim());
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : NaN;
};
const chars = (s) => [...String(s ?? '')].length;

let data = null;
try {
  data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (err) {
  console.error(`读不了 ${FILE}：${err?.message || err}`);
  process.exit(2);
}

const days = (data.entries ?? [])
  .map((e) => ({ date: String(e.date ?? '').trim(), n: chars(e.text), id: String(e.id ?? '') }))
  .filter((e) => Number.isFinite(stamp(e.date)))
  .sort((a, b) => stamp(a.date) - stamp(b.date));

const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
const yKey = ymd(yesterday);
const yDay = days.find((d) => d.date === yKey);
const recent = days.slice(-DAYS);
const over = (d) => d.n > LIMIT;

if (asJson) {
  console.log(`[result] ${JSON.stringify({
    limit: LIMIT, target: TARGET, yesterday: yKey,
    yesterdayChars: yDay ? yDay.n : null,
    recent: recent.map((d) => ({ date: d.date, chars: d.n, over: over(d) })),
  })}`);
  process.exit(onlyYesterday && yDay && over(yDay) ? 1 : 0);
}

const how = (date) => [
  `　　压缩步骤：`,
  `　　　① 写一份压过的正文（保留"改了什么 / 为什么 / 怎么验的"，砍掉铺陈），目标 ≤ ${TARGET} 字；`,
  `　　　② node tools/memory/append-log.mjs ${date} 正文文件 --dry   # 先看会写成什么样`,
  `　　　③ node tools/memory/append-log.mjs ${date} 正文文件         # 原地覆盖那一栏（不会多出一栏）`,
].join('\n');

if (onlyYesterday) {
  console.log(`惯例检查：前一天的日志（${yKey}），上限 ${LIMIT} 字`);
  if (!yDay) {
    console.log(`　· 前一天（${yKey}）没有日志 —— 那天没动过仓库就不用写；动过就该补上。`);
    process.exit(0);
  }
  if (over(yDay)) {
    console.log(`　✗ ${yDay.date} 有 ${yDay.n} 字，超了上限 ${LIMIT} —— 该压缩了。`);
    console.log(how(yDay.date));
    process.exit(1);
  }
  console.log(`　✓ ${yDay.date} ${yDay.n} 字，在上限内。`);
  process.exit(0);
}

console.log(`最近 ${recent.length} 天的日志字数（上限 ${LIMIT}，压缩目标 ≤ ${TARGET}）`);
for (const d of recent) {
  console.log(`　${over(d) ? '✗' : '·'} ${d.date}  ${String(d.n).padStart(5)} 字${over(d) ? '   ← 超了' : ''}`);
}
const bad = recent.filter(over);
if (bad.length) {
  console.log(`\n超上限的有 ${bad.length} 栏：${bad.map((d) => d.date).join(' ')}`);
  console.log(how(bad.at(-1).date));
  process.exit(1);
}
console.log('\n都在上限内。');
process.exit(0);
