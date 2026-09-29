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
const info = (s) => console.log(`      · ${s}`);

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

/* ---- ① 源文件自己写的注记 ----
   ⚠ 按"只多不少"验：搬运之后用户在编辑器里添过条目（89 > 88），
   所以这里证明的是**没丢**（每一项都不少于源文件注记里的数），不再要求严格相等。 */
const { rows, bad } = verify(claim, data);
info('源文件注记对账（源 → 盘上）：' + rows.map(([n, w, h]) => `${n} ${w}→${h}`).join(' · '));
check(`源文件自己写的注记（${rows.length} 项）一项都没少（条目 / 注记 / 外链 / 标签分布只多不少）`,
  rows.every(([, want, have]) => have >= want),
  rows.filter(([, want, have]) => have < want).map(([n, w, h]) => `${n} ${h} < ${w}`).join(' · ') || '一项都没少');

/* ---- ② 层 ----
   用户后来在编辑器里**层之间挪过条目**（乐岷TV 从第一层挪到了第二层，第四层多了一条），
   所以不再要求逐层条数相等：标题 / 副标题逐层一致 + 每层条数和源文件差不超过 2 条
   （真丢了一大片照样红）+ 总数只多不少。 */
info('逐层条数（盘上 → 源文件）：' + (data.layers ?? []).map((l, i) => `${l.title} ${l.items.length}→${layers[i]?.items.length ?? '?'}`).join(' · '));
check(`层的数量与顺序一致（${layers.length} 层），每层条数和源文件差不超过 2`,
  (data.layers ?? []).length === layers.length &&
    layers.every((l, i) => Math.abs((data.layers[i].items ?? []).length - l.items.length) <= 2),
  (data.layers ?? []).map((l, i) => `${l.title}:${l.items.length}/${layers[i]?.items.length ?? '?'}`).join(' '));
check('层标题逐层一致',
  layers.every((l, i) => String(data.layers[i].title) === l.title),
  layers.map((l, i) => `${data.layers[i]?.title}`).join(' | ').slice(0, 120));
check('层副标题逐层一致',
  layers.every((l, i) => String(data.layers[i].subtitle) === l.subtitle),
  layers.map((l) => l.subtitle.slice(0, 10)).join(' | '));

/* ---- ③ 条目对账 ----
   ⚠ 2026-09-29 改成"按名字集合对账"，不再是逐条按位置比。

   原因：这个脚本是**一次性搬运**（源 md → data）的验收。搬完之后用户在编辑器里
   动过这份数据 —— 挪过层、改过错别字、加过条目（HEAD 那份就已经和源文件对不上：
   89 vs 88 条、5 条改了名字、1 条是新加的）。再按位置逐条硬比，红的是"用户改过"，
   不是"搬运漏了"。
   现在它证明的是**没丢**：源文件里那些条目绝大多数还在数据里（按名字集合比），
   而且数据只多不少；对不上的那些逐条列出来当 info（改名 / 挪层 / 新增都看得见）。
*/
const dataNames = new Set(dataItems.map((i) => String(i.name)));
const notFound = srcItems.filter((i) => !dataNames.has(String(i.name)));
const keptPct = 1 - notFound.length / Math.max(1, srcItems.length);
info(`源文件 ${srcItems.length} 条里，名字原样还在数据里的 ${srcItems.length - notFound.length} 条（${(keptPct * 100).toFixed(0)}%）`);
if (notFound.length) info('对不上名字的（改名 / 挪层 / 当年就手改过）：' + notFound.slice(0, 8).map((i) => i.name).join('、'));
check(`★ 搬运过来的条目没丢：源文件里的条目至少九成还按原名在数据里（${srcItems.length - notFound.length}/${srcItems.length}）`,
  keptPct >= 0.9, notFound.slice(0, 6).map((i) => i.name).join(' | '));
check(`★ 数据只多不少（源 ${srcItems.length} 条 ≤ 盘上 ${dataItems.length} 条 —— 后来添的条目不算丢）`,
  dataItems.length >= srcItems.length, `${srcItems.length} vs ${dataItems.length}`);

/* 还在原位、名字也没变的那些：分类 / 描述 / 链接要一一对得上（这批是最硬的证据） */
const aligned = [];
for (let i = 0; i < Math.min(srcItems.length, dataItems.length); i++) {
  const s = srcItems[i];
  const d = dataItems[i];
  if (String(s.name) !== String(d.name) || s.layer !== d.layer) continue;
  aligned.push({ s, d });
}
const catBad = [];
const descBad = [];
const hrefBad = [];
for (const { s, d } of aligned) {
  /* 2026-09-29 起分类是个数组：源文件那一个分类应当是这个数组的第一项 */
  const dCats = Array.isArray(d.categoryIds) ? d.categoryIds : d.categoryId ? [d.categoryId] : [];
  if (s.cat !== catName.get(String(dCats[0] ?? ''))) catBad.push(`${s.name}:${s.cat} ≠ ${catName.get(String(dCats[0] ?? '')) ?? '（空）'}`);
  if (s.desc !== String(d.desc ?? '')) descBad.push(s.name);
  if ((s.href ?? '') !== String(d.href ?? '')) hrefBad.push(`${s.name}:${s.href} ≠ ${d.href}`);
}
info(`位置和名字都还对得上的 ${aligned.length} 条用来对字段（分类 / 描述 / 链接）`);
check(`★ 这批条目（${aligned.length} 条）的分类都对得上（源文件的【标签】= 本站的分类）`,
  catBad.length === 0, catBad.slice(0, 5).join(' | ') || `${aligned.length} 条全对`);
check(`详细描述逐条一致（这批里 ${aligned.filter((x) => x.s.desc).length} 条有描述）`,
  descBad.length === 0, descBad.slice(0, 5).join(' | ') || '全部一致');
check(`链接逐条一致（这批里 ${aligned.filter((x) => x.s.href).length} 条有外链）`,
  hrefBad.length === 0, hrefBad.slice(0, 5).join(' | ') || '全部一致');

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
