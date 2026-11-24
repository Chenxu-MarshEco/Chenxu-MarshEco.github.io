/*
 * 群圣经查重验收（2026-11-23）
 * ---------------------------------------------------------------------------
 * 站长原话：「…因为机器人并没有隔天的上下文记忆 所以可能会录入复读的重复圣经
 *   应保证圣经的首发性 … 发现这种正文内容完全一样的两条圣经时 应直接删去后录入的
 *   只保留时间最早的一条」（例子：11-22 Raw 的「梅莉家徒四壁…」被 11-23 隰辰煦
 *   复读一遍，bot 又录了一次）。
 *
 * 这条分两段量：
 *   ① **规则本身**（tools/bellie/dedupe.mjs）：两天同文只留早的、同一天留时间早的、
 *      只差换行/空格也算同一条、不同正文都留、三条同文只留一条、空正文不参与；
 *   ② **站点真的用上了**：拿源数据（天文件 + 群总结，天文件优先）按站点的规则重算一遍
 *      "该留哪些 id"，再和 `dist/bellie.json` 逐个对；顺带确认页面上没有任何一条
 *      正文出现两次，以及 10-09 / 10-11 那对真实复读留在 10-09。
 * 跑法：node tools/checks/bellie-dedupe-check.mjs [dist]   （先构建）
 */
import fs from 'node:fs';
import path from 'node:path';
import { dedupeByText, normText } from '../bellie/dedupe.mjs';

const ROOT = process.cwd();
const DIST = path.resolve(process.argv[2] || 'dist');
const SUMMARIES = path.join(ROOT, 'public', 'data', 'group-summaries');
const DAYS = path.join(ROOT, 'src', 'data', 'bellie', 'days');

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};

/* ================= ① 规则 ================= */
console.log('================ 查重规则 ================');

const A = { id: 'a', date: '2026-11-22', text: '梅莉家徒四壁，却唯独享受着莲子的内壁。' };
const B = { id: 'b', date: '2026-11-23', text: '梅莉家徒四壁，却唯独享受着莲子的内壁。' };

{
  /* 故意把"后录入的"放在前面：规则不能看输入顺序，要看日期 */
  const { kept, dropped } = dedupeByText([B, A]);
  check('★ 两天同文：只留日期早的那条（不管它俩谁先读进来）', kept.length === 1 && kept[0].date === '2026-11-22' && dropped.length === 1 && dropped[0].dropped.date === '2026-11-23', JSON.stringify({ kept: kept.map((e) => e.date), dropped: dropped.map((d) => d.dropped.date) }));
}
{
  const early = { id: 'c', date: '2026-11-23', time: '09:05', text: '同一句话' };
  const late = { id: 'd', date: '2026-11-23', time: '21:30', text: '同一句话' };
  const { kept, dropped } = dedupeByText([late, early]);
  check('★ 同一天同文：留时间早的那条（09:05 留，21:30 删）', kept.length === 1 && kept[0].id === 'c' && dropped.length === 1, JSON.stringify(kept.map((e) => `${e.time}`)));
}
{
  const one = { id: 'e', date: '2026-11-23', text: '梅莉家徒四壁，\n 却唯独享受着莲子的内壁。' };
  const two = { id: 'f', date: '2026-11-23', text: '梅莉家徒四壁， 却唯独享受着莲子的内壁。' };
  const { dropped } = dedupeByText([one, two]);
  check('只差换行 / 多余空格的也算同一条（复读常常多带一个换行）', dropped.length === 1);
}
{
  const { kept } = dedupeByText([
    { id: 'g', date: '2026-11-23', text: '这一句' },
    { id: 'h', date: '2026-11-23', text: '那一句' },
  ]);
  check('正文不一样的都要留着（查重只认"完全一样"）', kept.length === 2);
}
{
  const { kept, dropped } = dedupeByText([
    { id: 'i', date: '2026-11-20', text: '复读三遍' },
    { id: 'j', date: '2026-11-21', text: '复读三遍' },
    { id: 'k', date: '2026-11-22', text: '复读三遍' },
  ]);
  check('同一条复读三次：只留最早一条、另外两条都删', kept.length === 1 && kept[0].id === 'i' && dropped.length === 2);
}
{
  const { kept } = dedupeByText([
    { id: 'l', date: '2026-11-23', text: '   ' },
    { id: 'm', date: '2026-11-23', text: '' },
  ]);
  check('正文是空的（理论上不会有）不参与查重，不会把页弄丢', kept.length === 2);
}

/* ================= ② 站点真的用上了 ================= */
console.log('\n================ 站点数据 ================');

/** 源数据：天文件优先；没天文件的那天才用群总结（和 src/utils/bellie.ts 一个规则） */
function sourceDays() {
  const days = new Map();
  for (const f of fs.readdirSync(DAYS).filter((n) => n.endsWith('.json'))) {
    const j = JSON.parse(fs.readFileSync(path.join(DAYS, f), 'utf8'));
    const date = /^\d{4}-\d{2}-\d{2}$/.test(f.slice(0, 10)) ? f.slice(0, 10) : String(j.date || '');
    if (!date) continue;
    days.set(date, {
      date,
      from: 'days',
      entries: (j.entries ?? []).map((e) => ({
        time: String(e.time ?? ''),
        text: String(e.text ?? ''),
        comment: String(e.comment ?? ''),
        sender: String(e.name ?? e.qq ?? ''),
        users: j.users ?? {},
      })),
    });
  }
  for (const f of fs.readdirSync(SUMMARIES).filter((n) => n.endsWith('.json'))) {
    const j = JSON.parse(fs.readFileSync(path.join(SUMMARIES, f), 'utf8'));
    const date = String(j?.source?.date || f.slice(0, 10));
    if (days.has(date)) continue;
    const quotes = j?.analysis_result?.statistics?.golden_quotes;
    if (!Array.isArray(quotes)) continue;
    days.set(date, {
      date,
      from: 'summary',
      entries: quotes.slice(0, 5).map((q) => ({ time: '', text: String(q.content ?? ''), comment: String(q.reason ?? ''), sender: String(q.sender ?? ''), users: {} })),
    });
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const srcDays = sourceDays();
const sourceEntries = [];
for (const d of srcDays) {
  d.entries.forEach((e, i) => {
    if (!String(e.text).trim()) return;
    sourceEntries.push({
      id: `b${d.date.replace(/-/g, '')}-${i + 1}`,
      date: d.date,
      time: e.time,
      text: e.text,
      comment: e.comment,
      from: d.from,
    });
  });
}
const { kept, dropped } = dedupeByText(sourceEntries);

console.log(`      · 源数据 ${sourceEntries.length} 条；查重删掉 ${dropped.length} 条`);
for (const d of dropped.slice(0, 10)) console.log(`        - 删 ${d.dropped.date}（${d.dropped.id}），留 ${d.kept.date}（${d.kept.id}）`);

check('源数据里确实有复读（不然这条验收没意义）', dropped.length > 0, `${dropped.length} 条`);
check('10-09 / 10-11 那对真实复读：留 10-09、删 10-11',
  kept.some((e) => e.date === '2026-10-09' && normText(e.text).startsWith('有没有可能就是有人拉完屎不擦呢'))
  && !kept.some((e) => e.date === '2026-10-11' && normText(e.text).startsWith('有没有可能就是有人拉完屎不擦呢')),
  dropped.map((d) => `${d.dropped.date}→${d.kept.date}`).filter((s) => s.includes('2026-10-11')).join('') || '没有这一对');

const distFile = path.join(DIST, 'bellie.json');
if (!fs.existsSync(distFile)) {
  check(`产物里有 bellie.json（先 node node_modules/astro/bin/astro.mjs build）`, false, distFile);
} else {
  const data = JSON.parse(fs.readFileSync(distFile, 'utf8'));
  const got = Array.isArray(data.entries) ? data.entries : [];
  check('产物条数 = 源数据查重后该留的条数', got.length === kept.length && Number(data.count) === kept.length, `${got.length} / 该留 ${kept.length} / count ${data.count}`);
  const gotIds = got.map((e) => e.id);
  const wantIds = kept.map((e) => e.id);
  const missing = wantIds.filter((id) => !gotIds.includes(id));
  const extra = gotIds.filter((id) => !wantIds.includes(id));
  check('该留的都在、该删的都不在（按 id 逐个对）', missing.length === 0 && extra.length === 0, missing.concat(extra).slice(0, 6).join('、') || '完全对上');
  check('产物里的顺序和"按时间排 + 查重"的结果一致', gotIds.join(',') === wantIds.join(','));

  const seen = new Map();
  const dups = [];
  for (const e of got) {
    const k = normText(e.text);
    if (seen.has(k)) dups.push(`${seen.get(k).date}/${e.date}`);
    else seen.set(k, e);
  }
  check('★ 页面上没有任何一条正文出现两次', dups.length === 0, dups.slice(0, 4).join('、') || `${got.length} 条各不相同`);
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
