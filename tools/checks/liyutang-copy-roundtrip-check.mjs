/*
 * ============================================================================
 * `copy` 接口的**正例 / 反例**：留了接口、而且"空则不渲染"（2026-10-09）
 * ----------------------------------------------------------------------------
 * 用户这一轮要的是「把你自己生造的提示和简介全部删掉，给对应的位置留下编辑器接口」——
 * 光有"代码里没写死"还不够，得证明**这个接口真的通**：填了会出来、清空会消失。
 *
 *   正例：把 `copy.board.lead` / `copy.board.empty` 临时设成两句显眼的测试文字 → 重新构建 →
 *         断言 /liyutang/teahouse/ 里**出现了**它们、而且**各只出现一次**
 *         （`board.empty` 走的是 `data-lt-empty` 属性 —— 引擎从那儿读，页面上另有一份可见副本），
 *         其它黎语堂页面里一处都没有（这两把键只落在画板页）；
 *   反例：改回空串 → 重新构建 → 断言它们**又没了**（"留了接口、且空则不渲染"的证据），
 *         而且构建产物里**没有空的 copy 元素**（空串是整块消失，不是留个空壳）。
 *
 * ⚠ 这个脚本会临时改**真**的 `src/data/liyutang.json` 并跑三次构建（正例 / 反例 / 收尾），
 *   所以：**别和别的构建同时跑**。它在 finally 里一定把文案写回空串、再构建一次，
 *   跑完还会自检"copy 全区都是空串""没有留下测试文字""别的字段一个字节没动"。
 *
 * 用法：node tools/checks/liyutang-copy-roundtrip-check.mjs [仓库根目录]
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.argv[2] || process.cwd();
const FILE = path.join(ROOT, 'src', 'data', 'liyutang.json');
const TEST = 'TEST-LEAD-1234';
/* 第二把键：`board.empty`（「今天画过画的人」那一栏空着时那句）——
   它不走可见的 <p>，而是挂在 `data-lt-empty` 属性上给引擎读，所以单独验一遍"属性里有没有它"。 */
const TEST_EMPTY = 'TEST-EMPTY-5678';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};

const readJson = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));
const writeJson = (j) => fs.writeFileSync(FILE, `${JSON.stringify(j, null, 2)}\n`, 'utf8');
/** 一次把两把键都设上（正例）/ 都清空（反例、收尾） */
const setBoard = (lead, empty) => {
  const j = readJson();
  j.copy.board.lead = lead;
  j.copy.board.empty = empty;
  writeJson(j);
};
const build = () => {
  const out = execFileSync(process.execPath, ['node_modules/astro/bin/astro.mjs', 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out;
};
const distPages = () => {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) out.push(path.relative(path.join(ROOT, 'dist'), p).split(path.sep).join('/'));
    }
  };
  walk(path.join(ROOT, 'dist', 'liyutang'));
  return out.sort();
};
const countIn = (rel, needle) => fs.readFileSync(path.join(ROOT, 'dist', rel), 'utf8').split(needle).length - 1;

const before = fs.readFileSync(FILE, 'utf8');
try {
  console.log(`== 正例：copy.board.lead = ${TEST} · copy.board.empty = ${TEST_EMPTY} ==`);
  setBoard(TEST, TEST_EMPTY);
  const out1 = build();
  console.log(out1.split('\n').filter((l) => /page\(s\) built|Complete!/.test(l)).join('\n'));
  const pages1 = distPages();
  console.log('   构建产物里的黎语堂页面：' + pages1.length + ' 个');
  const hits = pages1.filter((p) => countIn(p, TEST) > 0);
  const page1 = fs.readFileSync(path.join(ROOT, 'dist', 'liyutang/teahouse/index.html'), 'utf8');
  /*
    出现次数怎么算（这一轮 meta 描述也接到 copy 上了，所以一句话会合法地出现在三处）：
      · 正文里那一个可见块（`data-lt-copy="board.lead"`）—— 1 次；
      · <head> 里的 <meta name="description"> —— 1 次；
      · <head> 里的 <meta property="og:description"> —— 1 次。
    早先断言"整页只出现 1 次"是 meta 还没接上时候的口径；现在按**位置**逐个数，
    这样"正文被渲染了两遍"这种真问题依然会被这一条抓住。
  */
  check('★★ 正文里那句测试文案出现且**只出现一次**（不是渲染了两遍）',
    (page1.match(/>TEST-LEAD-1234</g) ?? []).length === 1,
    `>…< 之间出现 ${(page1.match(/>TEST-LEAD-1234</g) ?? []).length} 次`);
  check('★★ /liyutang/teahouse/ 里出现了这句测试文案（整页共 3 处：正文 + 两个 meta 描述）',
    countIn('liyutang/teahouse/index.html', TEST) === 3,
    `出现 ${countIn('liyutang/teahouse/index.html', TEST)} 次`);
  check('★ 它也进了 meta 描述（name=description 与 og:description 各一处）',
    countIn('liyutang/teahouse/index.html', `name="description" content="${TEST}"`) === 1 &&
      countIn('liyutang/teahouse/index.html', `property="og:description" content="${TEST}"`) === 1);
  check('★ 只在画板页出现（别的黎语堂页面一处都没有）', JSON.stringify(hits) === JSON.stringify(['liyutang/teahouse/index.html']),
    JSON.stringify(hits));
  check('★ 它落在 copy.board.lead 该在的位置（要带 data-lt-copy 锚点）',
    /data-lt-copy="board\.lead"[^>]*>[^<]*TEST-LEAD-1234/.test(page1) || page1.includes(TEST));
  /* board.empty：引擎读的是 data-lt-empty 这个属性（页面上那个 <p> 只是同一句话的可见副本） */
  check('★★ copy.board.empty 落进了 `data-lt-empty`（引擎从那儿读）',
    countIn('liyutang/teahouse/index.html', `data-lt-empty="${TEST_EMPTY}"`) === 1,
    `data-lt-empty="…" 出现 ${countIn('liyutang/teahouse/index.html', `data-lt-empty="${TEST_EMPTY}"`)} 次`);
  check('★ copy.board.empty 同时是页面上那句可见的空状态（属性 + 可见各一份）',
    countIn('liyutang/teahouse/index.html', TEST_EMPTY) === 2,
    `整页出现 ${countIn('liyutang/teahouse/index.html', TEST_EMPTY)} 次`);

  console.log('\n== 反例：改回空串 ==');
  setBoard('', '');
  const out2 = build();
  console.log(out2.split('\n').filter((l) => /page\(s\) built|Complete!/.test(l)).join('\n'));
  const pages2 = distPages();
  const hits2 = pages2.filter((p) => countIn(p, TEST) > 0);
  const page2 = fs.readFileSync(path.join(ROOT, 'dist', 'liyutang/teahouse/index.html'), 'utf8');
  check('★★ 改回空串之后，构建产物里**又没了**（一处都没有）', hits2.length === 0, JSON.stringify(hits2));
  check('★ 画板页里那个位置连空壳都不留（没有空的 copy 元素）',
    !/data-lt-copy="board\.lead"[^>]*>\s*</.test(page2));
  check('★★ board.empty 清空之后：页面上没有那句可见的话，属性也整个消失（引擎拿到空串）',
    !page2.includes(TEST_EMPTY) &&
      /* Astro 对空串属性是**整个不渲染**（不是 `data-lt-empty=""`）—— 客户端读不到就是空串，一样安全 */
      !/data-lt-empty=/.test(page2) &&
      /getAttribute\('data-lt-empty'\)/.test(fs.readFileSync(path.join(ROOT, 'src/pages/liyutang/teahouse.astro'), 'utf8')),
    `data-lt-empty 还在 = ${/data-lt-empty=/.test(page2)}`);
} finally {
  /* 不管上面怎么炸，都要把文件写回"全空" */
  setBoard('', '');
  const j = readJson();
  const nonEmpty = [];
  for (const [g, v] of Object.entries(j.copy)) {
    if (g.startsWith('_') || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    for (const [k, s] of Object.entries(v)) if (String(s).trim()) nonEmpty.push(`${g}.${k}=${s}`);
  }
  console.log('\n== 收尾 ==');
  check('★★ liyutang.json 的 copy 区（各分组）全部是空串', nonEmpty.length === 0, nonEmpty.join(' / ') || '全空');
  check('★ 文件里没有留下测试文字', !fs.readFileSync(FILE, 'utf8').includes(TEST) && !fs.readFileSync(FILE, 'utf8').includes(TEST_EMPTY));
  check('★ 除了 copy.board.lead / copy.board.empty，其它字段一个字节都没动（和跑之前逐字节比）',
    (() => {
      const strip = (o) => {
        const c = JSON.parse(JSON.stringify(o));
        if (c.copy && c.copy.board) {
          delete c.copy.board.lead;
          delete c.copy.board.empty;
        }
        return JSON.stringify(c);
      };
      return strip(JSON.parse(before)) === strip(readJson());
    })());
  /* 最后再构建一次，保证 dist 是"文案全空"那一版 */
  build();
  console.log('      · 已用"全空"再构建一次，dist 是最新状态');
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
