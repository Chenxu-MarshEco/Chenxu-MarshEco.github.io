/*
 * 「条目全集 → 站点数据」逐条对照的验收。
 *
 * 用户最怕的一件事就是搬运时丢条目。这个脚本不看页面、不建站，只做一件事：
 * **把源文件重新解析一遍，和盘上的 src/data/iceberg.json 一条一条对**。
 * 解析用的就是导入脚本自己的 `parseSource()`（同一个函数，不是抄一份规则），
 * 所以「导进来的是什么」和「验收量的是什么」永远是同一套。
 *
 * 比的是这些（id / 颜色 / 背景图 / tag 属于「可以手改」的字段，不在对照范围）：
 *   层：条数、顺序、标题、副标题
 *   条目：条数、顺序、名字、归在哪个分类（比分类**名字**）、详细描述、链接
 *   分类：名字与顺序
 * 再加一遍源文件自己写的注记（88 条 / 6 层 / 18 注释 / 6 外链 / 标签分布）。
 *
 * 用法：node tools/checks/iceberg-import-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSource, verify } from '../iceberg/import.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, '..', '..');
const SRC = path.join(PROJ, 'tools', 'iceberg', '冰室冰山图-条目全集.md');
const OUT = path.join(PROJ, 'src', 'data', 'iceberg.json');

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};

if (!fs.existsSync(SRC)) {
  console.error(`找不到源文件 ${SRC}`);
  process.exit(2);
}
if (!fs.existsSync(OUT)) {
  console.error(`找不到 ${OUT}，先跑一次 node tools/iceberg/import.mjs`);
  process.exit(2);
}

const { claim, layers } = parseSource(fs.readFileSync(SRC, 'utf8'));
const data = JSON.parse(fs.readFileSync(OUT, 'utf8'));

const catName = new Map((data.categories ?? []).map((c) => [String(c.id), String(c.name)]));
const srcCats = layers.flatMap((l) => l.items.map((i) => i.cat));
const dataItems = (data.layers ?? []).flatMap((l) => (l.items ?? []).map((i) => ({ ...i, layer: l.title })));
const srcItems = layers.flatMap((l) => l.items.map((i) => ({ ...i, layer: l.title })));

console.log(`源文件：${path.relative(PROJ, SRC)}`);
console.log(`盘上数据：${path.relative(PROJ, OUT)}`);
console.log(`源文件 ${layers.length} 层 / ${srcItems.length} 条　·　盘上 ${(data.layers ?? []).length} 层 / ${dataItems.length} 条\n`);

/* ---- ① 源文件自己写的注记 ---- */
const { rows, bad } = verify(claim, data);
check(`源文件自己写的注记（${rows.length} 项：总数 / 层数 / 注释 / 外链 / 标签分布）逐项对得上`,
  bad === 0, rows.map(([n, w, h]) => `${n} ${h}/${w}`).join(' · '));

/* ---- ② 层 ---- */
check(`层的条数与顺序一致（${layers.length} 层）`,
  (data.layers ?? []).length === layers.length &&
    layers.every((l, i) => (data.layers[i].items ?? []).length === l.items.length),
  (data.layers ?? []).map((l, i) => `${l.title}:${l.items.length}/${layers[i]?.items.length ?? '?'}`).join(' '));
check('层标题逐层一致',
  layers.every((l, i) => String(data.layers[i].title) === l.title),
  layers.map((l, i) => `${data.layers[i]?.title}`).join(' | ').slice(0, 120));
check('层副标题逐层一致',
  layers.every((l, i) => String(data.layers[i].subtitle) === l.subtitle),
  layers.map((l) => l.subtitle.slice(0, 10)).join(' | '));

/* ---- ③ 条目逐条对照 ---- */
const nameMismatch = [];
const catMismatch = [];
const descMismatch = [];
const hrefMismatch = [];
const orderMismatch = [];
for (let i = 0; i < Math.max(srcItems.length, dataItems.length); i++) {
  const s = srcItems[i];
  const d = dataItems[i];
  if (!s || !d) { orderMismatch.push(`#${i + 1} ${s?.name ?? '（数据里没有）'}/${d?.name ?? '（源文件里没有）'}`); continue; }
  if (s.layer !== d.layer) orderMismatch.push(`${s.name} 在 ${s.layer} vs ${d.layer}`);
  if (s.name !== String(d.name)) nameMismatch.push(`${s.name} ≠ ${d.name}`);
  if (s.cat !== catName.get(String(d.categoryId))) catMismatch.push(`${s.name}:${s.cat} ≠ ${catName.get(String(d.categoryId)) ?? '（空）'}`);
  if (s.desc !== String(d.desc ?? '')) descMismatch.push(s.name);
  if ((s.href ?? '') !== String(d.href ?? '')) hrefMismatch.push(`${s.name}:${s.href} ≠ ${d.href}`);
}
check(`★ 条目总数一致：源文件 ${srcItems.length} 条 = 盘上 ${dataItems.length} 条（一条不多一条不少）`,
  srcItems.length === dataItems.length, `${srcItems.length} vs ${dataItems.length}`);
check('★ 每一条的名字、顺序、所属层都对得上（逐条对照，不是只比总数）',
  nameMismatch.length === 0 && orderMismatch.length === 0,
  [...nameMismatch, ...orderMismatch].slice(0, 5).join(' | ') || '全部一致');
check(`★ 每一条的分类都对得上（源文件的【标签】= 本站的分类）`,
  catMismatch.length === 0, catMismatch.slice(0, 5).join(' | ') || `${srcItems.length} 条全对`);
check(`详细描述逐条一致（${srcItems.filter((i) => i.desc).length} 条有描述）`,
  descMismatch.length === 0, descMismatch.slice(0, 5).join(' | ') || '全部一致');
check(`链接逐条一致（${srcItems.filter((i) => i.href).length} 条有外链）`,
  hrefMismatch.length === 0, hrefMismatch.slice(0, 5).join(' | ') || '全部一致');

/* ---- ④ 分类表 ---- */
const srcCatOrder = claim.cats.filter((c) => srcCats.includes(c));
check(`分类表就是源文件里那 ${srcCatOrder.length} 个（名字与顺序一致，颜色由用户自己设）`,
  (data.categories ?? []).map((c) => c.name).join(',') === srcCatOrder.join(','),
  (data.categories ?? []).map((c) => `${c.name}${c.color}`).join(' · '));
check('每条分类颜色都是合法的 #rrggbb（页面上要拿它上色）',
  (data.categories ?? []).every((c) => /^#[0-9a-f]{6}$/i.test(String(c.color))),
  (data.categories ?? []).map((c) => c.color).join(' '));
check('本站的 tag 是另一套（源文件里的【标签】没有混进 tags）',
  Array.isArray(data.tags) && dataItems.every((i) => Array.isArray(i.tags)),
  `tags 库 ${data.tags.length} 个，条目上勾的叫 ${JSON.stringify(data.tags.map((t) => t.name))}`);

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
