#!/usr/bin/env node
/*
 * ============================================================================
 * 铃忆投递「群圣经」的收件台 —— 校验 + 落盘成一天一个文件
 * ----------------------------------------------------------------------------
 * 站长 2026-11-20 的原话：
 *   「lingyi机器人从今天起向网站内投递的不只是铃忆日记了 还会每天附带一个
 *    群圣经的json  每天有五条  附带发送时间 发送者QQ号  正文部分  铃忆评语四个部分
 *    接收到文件以后 自动将其像精华一样填入圣经页面中」
 *
 * 机器人只要把当天那份 JSON 写成
 *   node tools/bellie/ingest.mjs <投递文件.json>
 * 就会：校验 → 规整 → 写进 src/data/bellie/days/<YYYY-MM-DD>.json（**一天一个文件**）。
 *
 * 为什么一天一个文件：谁写谁的文件，两个人同时投递也不会撞车；
 * 站点构建时整个目录按日期倒序读（见 src/utils/bellie.ts），不需要任何合并步骤。
 *
 * ⚠ 这个脚本**只碰** `src/data/bellie/days/` 下面那一个文件，别的一律不写。
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(HERE, '..', '..');
const DAYS = path.join(ROOT, 'src', 'data', 'bellie', 'days');

/** 一天最多收几条 —— 站长定的「每天五条」 */
const PER_DAY = 5;

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const DRY = argv.includes('--dry');

const die = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

if (!file) {
  console.log(
    [
      '用法：node tools/bellie/ingest.mjs <投递文件.json> [--dry]',
      '',
      '投递文件（UTF-8 JSON）长这样 —— 字段见仓库根目录的「铃忆投递指引.md」：',
      '  {',
      '    "date": "2026-11-20",',
      '    "entries": [',
      '      { "time": "12:34", "qq": "2567645574", "text": "群友原句", "comment": "铃忆的评语" }',
      '    ]',
      '  }',
      '',
      `--dry 只校验、不写文件（写之前建议先跑一遍）`,
    ].join('\n'),
  );
  process.exit(0);
}

const abs = path.resolve(process.cwd(), file);
if (!fs.existsSync(abs)) die(`找不到文件：${abs}`);

let raw;
try {
  raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
} catch (e) {
  die(`不是合法 JSON：${e.message}`);
}

/* ---------------------------------------------------------------- 校验 */

const str = (v) => String(v ?? '').trim();
const dateOf = (v) => {
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  /* 2026-02-31 这种「格式对、日子不存在」的也要拦下来 */
  return d.toISOString().slice(0, 10) === s ? s : '';
};

const date = dateOf(raw?.date) || dateOf(path.basename(abs, '.json'));
if (!date) die('缺少日期：顶层要写 "date": "YYYY-MM-DD"，或者把文件名写成 YYYY-MM-DD.json');

const list = Array.isArray(raw?.entries) ? raw.entries : [];
if (list.length === 0) die('entries 是空的：一天要投 5 条');
if (list.length > PER_DAY) die(`entries 有 ${list.length} 条，一天最多 ${PER_DAY} 条`);

const problems = [];
const entries = list.map((e, i) => {
  const at = `第 ${i + 1} 条`;
  const time = str(e?.time);
  const qq = str(e?.qq);
  const text = str(e?.text);
  const comment = str(e?.comment);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) && time && !/^\d{1,2}:\d{2}$/.test(time)) {
    problems.push(`${at}：time 要是 "HH:MM"（现在是 ${JSON.stringify(time)}）`);
  }
  if (!/^[1-9]\d{4,11}$/.test(qq)) problems.push(`${at}：qq 要是纯数字的 QQ 号（现在是 ${JSON.stringify(qq)}）`);
  if (!text) problems.push(`${at}：text（群友原句）不能为空`);
  if (!comment) problems.push(`${at}：comment（铃忆的评语）不能为空`);
  if (text.length > 500) problems.push(`${at}：text 太长了（${text.length} 字，上限 500）`);
  if (comment.length > 300) problems.push(`${at}：comment 太长了（${comment.length} 字，上限 300）`);

  /* 正文/评语里不许夹 HTML：页面是按纯文本转义的，夹了只会原样显示成字符 */
  if (/<[a-z/][^>]*>/i.test(text) || /<[a-z/][^>]*>/i.test(comment)) {
    problems.push(`${at}：text / comment 里不要写 HTML 标签`);
  }

  return {
    time: /^\d{1,2}:\d{2}$/.test(time) ? time.padStart(5, '0') : '',
    qq,
    text,
    comment,
  };
});

if (problems.length) {
  console.error('✗ 这份投递有这些问题，没有写盘：');
  for (const p of problems) console.error(`   · ${p}`);
  process.exit(1);
}

/* ---------------------------------------------------------------- 落盘 */

fs.mkdirSync(DAYS, { recursive: true });
const out = path.join(DAYS, `${date}.json`);
const body = `${JSON.stringify({ date, entries }, null, 2)}\n`;

if (DRY) {
  console.log(`（--dry）会写成 ${path.relative(ROOT, out).replace(/\\/g, '/')}：\n`);
  console.log(body);
  process.exit(0);
}

fs.writeFileSync(out, body, 'utf8');
console.log(`✓ 收到 ${entries.length} 条（${date}）→ ${path.relative(ROOT, out).replace(/\\/g, '/')}`);
console.log('  下一步：把它提交上去，站点构建时会自动收进 /bellie/。');
