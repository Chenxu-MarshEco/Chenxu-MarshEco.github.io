#!/usr/bin/env node
/*
 * ============================================================================
 * 把群总结 JSON 里的群圣经抄进 `src/data/bellie/days/<YYYY-MM-DD>.json`
 * ----------------------------------------------------------------------------
 * 站长 2026-11-22：「每次收到lingyi的推流后都自动获取每天的这个json并把里面的
 * 群圣经部分转录到铃忆圣经里」。
 *
 * **站点构建时不需要跑这个**（`src/utils/bellie.ts` 直接读群总结，推上来就上线）。
 * 这个命令是给两种场合用的：
 *   · 人工核对某天到底会抄进去哪五条 —— 什么都不加就是只读报告；
 *   · 想把它们落成天文件（比如以后 group-summaries 要清理）—— 加 `--write`。
 *
 * 用法：
 *   node tools/bellie/from-summary.mjs                # 报告：每天会抄哪几条
 *   node tools/bellie/from-summary.mjs --write        # 只写「还没有天文件」的那些天
 *   node tools/bellie/from-summary.mjs --write --force  # 连天文件也重写（慎用）
 *   node tools/bellie/from-summary.mjs --date 2026-11-21
 *
 * 安全线：
 *   · 天文件已经存在（lingyi 自己投的、或人写的）→ **默认不碰**，只报「已有，跳过」；
 *   · 只有本工具生成的（文件里有 "source" 那一块）才会被重跑覆盖，除非 --force；
 *   · 只写 `src/data/bellie/days/<date>.json`，别的一律不动。
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSummaryDays } from './summary.mjs';

/*
 * ⚠ 别用 `new URL(import.meta.url).pathname` 取路径：仓库路径里有中文，
 *   pathname 是百分号转义过的（和 ingest.mjs 头上那个坑同一条）。
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DAYS = path.join(ROOT, 'src', 'data', 'bellie', 'days');

const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const flag = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? String(argv[i + 1] ?? '') : '';
};

const WRITE = has('write');
const FORCE = has('force');
const only = flag('date');

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const { days, problems } = readSummaryDays({ root: ROOT });

if (only && !days.some((d) => d.date === only)) {
  console.error(`✗ 群总结里没有 ${only} 这一天（有：${days.map((d) => d.date).join('、') || '一份都没有'}）`);
  process.exit(1);
}

if (days.length === 0) {
  console.log('群总结目录里还没有能抄的东西（public/data/group-summaries/）。');
  for (const p of problems) console.log(`  · ${p}`);
  process.exit(0);
}

const pick = only ? days.filter((d) => d.date === only) : days;
const written = [];

for (const day of pick) {
  const out = path.join(DAYS, `${day.date}.json`);
  const exists = fs.existsSync(out);
  let generated = false;
  if (exists) {
    try {
      generated = Boolean(JSON.parse(fs.readFileSync(out, 'utf8'))?.source);
    } catch {
      generated = false;
    }
  }

  console.log(`\n${day.date}  ←  ${day.file}`);
  for (const [i, e] of day.entries.entries()) {
    const who = e.name || e.qq || '(没有署名)';
    const head = e.text.replace(/\s+/g, ' ').slice(0, 40);
    console.log(`   ${i + 1}. ${who} ｜ ${head}${e.text.length > 40 ? '…' : ''} ｜ ${e.text.length} / ${e.comment.length} 字`);
  }
  if (day.long.length) console.log(`   ⚠ 有超过 500/300 字的条目：${day.long.join('、')}`);

  if (!WRITE) {
    console.log(exists ? `   → ${rel(out)} 已存在，写的话会被跳过` : `   → 会写 ${rel(out)}`);
    continue;
  }

  if (exists && !generated && !FORCE) {
    console.log(`   → ${rel(out)} 已存在（不是本工具生成的），跳过；确认要覆盖加 --force`);
    continue;
  }

  const body = `${JSON.stringify(
    {
      date: day.date,
      source: { summary: day.file, tool: 'tools/bellie/from-summary.mjs' },
      /* 匿名号 → 群名片要一起落下来：不然落成天文件之后，评语里的 `[user-004]`
         就再没人能换成名字了（站点只认天文件里这一块）。 */
      ...(Object.keys(day.users ?? {}).length ? { users: day.users } : {}),
      entries: day.entries,
    },
    null,
    2,
  )}\n`;
  fs.mkdirSync(DAYS, { recursive: true });
  fs.writeFileSync(out, body, 'utf8');
  written.push(day.date);
  console.log(`   → ${exists ? '重写' : '写入'} ${rel(out)}`);
}

if (problems.length) {
  console.log('\n另外：');
  for (const p of problems) console.log(`  · ${p}`);
}

if (WRITE) {
  console.log(
    written.length
      ? `\n✓ 写了 ${written.length} 天：${written.join('、')}（站点构建读的是天文件 + 群总结，提交后 /bellie/ 就会更新）`
      : '\n没有可写的（都已经有天文件了）。',
  );
}
