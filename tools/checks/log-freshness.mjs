/*
 * ============================================================================
 * 日志自检 —— 「今天动过仓库，今天的日志写了没有？」
 * ----------------------------------------------------------------------------
 * 站长 2026-10-12 的原话：
 *   「注意到你经常漏写日志或者放错位置 或者更换新一轮对话后会忘记
 *    请在本地文件里做一个保证每轮对话都提醒你去做日志的东西」
 *
 * 提醒写在 `AGENTS.md` 里（工作区一份、仓库一份，DSH 每次会话都会读），
 * 而这个脚本是**能自己验的那一半**：不靠记性，跑一下就知道漏没漏。
 *
 * 它管四件事：
 *   ① 数据本身没问题：src/data/mianyu.json 能解析、一天一栏（日期不重复）、
 *      日期是站上用的点号写法（2026.10.12）、正文不是空的、顺序是从早到晚；
 *   ② 日志**只应该在** src/data/mianyu.json 里 —— 顺手确认它没被写进
 *      home-boards.json 的「更新日志」页（2026-09-28 那次覆盖事故的老毛病）；
 *   ③ 今天要是动过仓库（有提交，或者工作区还脏着），今天就必须有一栏日志；
 *   ④ `--today`：严格模式，不管今天动没动，最后一天必须就是今天。
 *
 * 用法：
 *   node tools/checks/log-freshness.mjs           # 日常自检（收尾时跑）
 *   node tools/checks/log-freshness.mjs --today   # 严格：必须写到今天
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = path.join(SRC, 'src', 'data', 'mianyu.json');
const BOARDS = path.join(SRC, 'src', 'data', 'home-boards.json');
const strictToday = process.argv.includes('--today');

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

/** `2026.10.12` 这种写法 → 可以比大小的数字 */
const stamp = (d) => {
  const m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/.exec(String(d ?? '').trim());
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : NaN;
};
const ymd = (date) => `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
const git = (args) => {
  try {
    return execFileSync('git', args, { cwd: SRC, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

/* ---------------------------------------------------------------- 读数据 */
let data = null;
try {
  data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (err) {
  check('★ src/data/mianyu.json 能解析（JSON 没写坏）', false, String(err?.message || err).slice(0, 120));
}
if (!data) {
  console.log('\n================ 结果 ================');
  console.log(`PASS ${pass}   FAIL ${fail}`);
  process.exit(1);
}

const entries = Array.isArray(data.entries) ? data.entries : [];
check('★ 日志数据在 src/data/mianyu.json 里，一天一栏（entries 是个数组且有内容）',
  entries.length > 0, `${entries.length} 天`);

/* 每一条：日期写法 + 正文非空 */
const badDate = entries.filter((e) => !Number.isFinite(stamp(e?.date)));
check('★ 每天的日期都是站上用的点号写法（2026.10.12）',
  badDate.length === 0, badDate.map((e) => JSON.stringify(e?.date)).slice(0, 4).join(' ') || '全都合规');

const emptyText = entries.filter((e) => String(e?.text ?? '').trim().length < 8);
check('★ 每天都有正文（不是空栏、也不是凑数的两个字）',
  emptyText.length === 0, emptyText.map((e) => e?.date).slice(0, 4).join(' ') || '每天都有内容');

const noId = entries.filter((e) => !String(e?.id ?? '').trim());
check('每天都有 id（同一天覆盖靠它认）', noId.length === 0, noId.map((e) => e?.date).join(' ') || '都有');

/* 一天一栏：日期不许重复 */
const seen = new Map();
const dups = [];
for (const e of entries) {
  const key = stamp(e?.date);
  if (seen.has(key)) dups.push(e?.date);
  seen.set(key, true);
}
check('★ 一天只有一栏（没有同一天写了两条）',
  dups.length === 0, dups.length ? `重复：${dups.join(' ')}` : `${entries.length} 天各不相同`);

/* 顺序：从早到晚（写入端就是这么追加的，乱了说明有人手动搬过） */
const stamps = entries.map((e) => stamp(e?.date)).filter(Number.isFinite);
const ordered = stamps.every((v, i) => i === 0 || stamps[i - 1] <= v);
check('顺序是从早到晚（新的一天追加在后面）',
  ordered, ordered ? `${entries[0]?.date} → ${entries.at(-1)?.date}` : '顺序乱了');

/* ---------------------------------------------- 日志只应该在 mianyu.json */
let boardsHasLogText = false;
try {
  const boards = fs.readFileSync(BOARDS, 'utf8');
  /* 版块树里不该出现日志正文（出现说明又有谁往「更新日志」页里写了） */
  boardsHasLogText = entries.some((e) => {
    const t = String(e?.text ?? '').slice(0, 24);
    return t.length > 12 && boards.includes(t);
  });
} catch { /* 文件不在就算了 */ }
check('★ 日志没被写进 home-boards.json（编辑器一存就会覆盖它）',
  !boardsHasLogText, boardsHasLogText ? '版块树里出现了日志正文，快挪回 mianyu.json' : '干净');

/* ------------------------------------------------------------ 今天写了没 */
const today = ymd(new Date());
const newest = entries.at(-1)?.date ?? '';
info(`共 ${entries.length} 天；最后一天 ${newest}；今天 ${today}`);

const commitsToday = git(['log', '--since=midnight', '--format=%h %s'])
  .split('\n').map((l) => l.trim()).filter(Boolean);
const dirty = git(['status', '--porcelain']);
const changedToday = commitsToday.length > 0 || dirty.length > 0;
info(`今天动过仓库吗：${changedToday ? '动过' : '没有'}${
  commitsToday.length ? `（今天有 ${commitsToday.length} 个提交，最新：${commitsToday[0].slice(0, 60)}）` : ''}${
  dirty ? `（工作区还有 ${dirty.split('\n').length} 处没提交的改动）` : ''}`);

if (strictToday || changedToday) {
  check(`★ 今天动过仓库 → 今天的日志写了（${today}）`,
    stamp(newest) === stamp(today),
    stamp(newest) === stamp(today)
      ? '写了'
      : `最后一天是 ${newest} —— 用 node tools/memory/append-log.mjs ${today} <正文文件> 补上`);
} else {
  info('今天没动过仓库，跳过"今天必须写日志"那一条（只核对数据本身）');
}

const future = stamps.filter((v) => v > stamp(today));
check('没有"未来日期"的日志（写错年份最常见）',
  future.length === 0, future.length ? `往后写了：${future.join(' ')}` : '没有');

/*
  字数规矩（站长 2026-10-13 的原话：「每天第一次与你对话时自动检查前一天的日志字数
  并自动压缩」）。上限、压缩步骤、那个 --yesterday 的每日仪式都写在
  tools/memory/log-length.mjs 里 —— 那是**唯一**说这件事的地方，这里只把结果接进常规自检：
  「今天 / 前一天」两栏超了就红（更早的日子只提示、不拦发布 —— 那是历史）。
*/
const lenRun = spawnSync(process.execPath, [path.join(SRC, 'tools', 'memory', 'log-length.mjs'), '--json'], {
  cwd: SRC, encoding: 'utf8',
});
const lenLine = String(lenRun.stdout ?? '').split('\n').reverse().find((l) => l.startsWith('[result] '));
const len = lenLine ? JSON.parse(lenLine.slice('[result] '.length)) : null;
if (!len) {
  info('字数那条没读到（tools/memory/log-length.mjs 没跑起来），跳过');
} else {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yKey = ymd(y);
  const watch = (len.recent ?? []).filter((d) => d.over && (d.date === today || d.date === yKey));
  const older = (len.recent ?? []).filter((d) => d.over && d.date !== today && d.date !== yKey);
  check(`★ 今天 / 前一天的日志没超过字数上限（${len.limit} 字，超了就该压缩）`,
    watch.length === 0,
    watch.length
      ? `${watch.map((d) => `${d.date} ${d.chars} 字`).join('、')} —— 跑 node tools/memory/log-length.mjs --yesterday 看压缩步骤`
      : '都在上限内');
  if (older.length) info(`更早的日子还有 ${older.length} 栏偏长（${older.map((d) => `${d.date} ${d.chars} 字`).join('、')}）—— 不拦发布，顺手压了更好`);
}

console.log('\n================ 结果 ================');
console.log(`PASS ${pass}   FAIL ${fail}`);
if (fail > 0) process.exit(1);
