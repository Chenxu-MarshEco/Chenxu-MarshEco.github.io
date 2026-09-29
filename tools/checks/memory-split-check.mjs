/*
 * ============================================================================
 * 「更新日志分身」的验收：助手日志（眠鱼志）/ 近期更新 / 冰室古闻考
 * ----------------------------------------------------------------------------
 * 用户原话（2026-09-28）：
 *   「更新日志里你写的内容不会同步进编辑器里 所以现在我没法操作 我现在需要做一个东西
 *    就是分开你这边的网页底层架构更新日志和我自己手写的内容的更新日志 所以你在更新日志下
 *    建立两个新的子版块 左边的板块叫眠鱼志 点击后进入一个页面 把你每次进行完任务以后
 *    自动输出的更新日志都输出到这个页面里 记得把老的日志也全部迁移过去 右边的板块分为
 *    上下两部分 上面有一个类似每日精华的卡片框 叫近期更新 里面会自动置顶最近有通过编辑器
 *    改动内容的三个页面的页面名 点击可以跳转到该页面 下面的板块叫冰室古闻考 点进去的页面
 *    我自己写东西」
 *
 * 五段：
 *   ① 数据分家：日志搬进 src/data/mianyu.json，home-boards.json 那一页清空、内容一字不少
 *   ② 两个新子版块：眠鱼志 / 花涧堂更新（左卡右卡并排），冰室古闻考 在花涧堂更新下面
 *   ③ 眠鱼志页面：11 天全在、一天一个锚点（能深链接到某一天）
 *   ④ 近期更新：3 张卡、名字 + 时间、地址点得开（真产物里量）
 *   ⑤ 编辑器那条链路（在副本里真跑）：
 *        · 打开编辑器 → 原样保存一次 → 三个新节点一个都没丢（这就是用户报的那个坑）
 *        · 带 touched 保存 → recent-edits.json 记下**改的那一页**、重建后卡片跟着变
 *        · append-log 只写 mianyu.json，home-boards.json 一个字节都不动
 *
 * 用法：node tools/checks/memory-split-check.mjs
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..');
const DST = path.join(SRC, '.tmp', 'memory-copy');
const DIST = path.join(SRC, 'dist');
const PORT = 4477;
const DEBUG_PORT = 9447;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');

const BOARDS = path.join(SRC, 'src/data/home-boards.json');
const MIANYU = path.join(SRC, 'src/data/mianyu.json');
const RECENT = path.join(SRC, 'src/data/recent-edits.json');

for (const [label, p] of [['home-boards.json', BOARDS], ['mianyu.json', MIANYU], ['recent-edits.json', RECENT]]) {
  if (!fs.existsSync(p)) {
    console.error(`找不到 ${label}（${p}）`);
    process.exit(2);
  }
}
if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('还没有 dist，先构建一次');
  process.exit(2);
}

const boards = readJson(BOARDS);
const logs = readJson(MIANYU);
const recent = readJson(RECENT);

const find = (nodes, id) => {
  for (const n of nodes || []) {
    if (!n) continue;
    if (n.id === id) return n;
    const hit = find(n.children, id);
    if (hit) return hit;
  }
  return null;
};
/*
  ⚠ 下面这些节点**按名字找**，不按 id 写死：用户 2026-09-28 自己把结构调过一次
  （把「近期更新」挪到了「更新日志」自己页面上、删掉了中间那层容器、
  把「冰室古闻考」的地址改成了 /huaya/memory/bingshi，还在里面写上了第一段）。
  验收要盯的是"这几样东西在不在、是不是各就各位"，不是"必须摆成我当初那个样子"。
*/
/** 按标题在整棵树里找节点（用户随时会调结构，所以验收一律按名字找、不写死 id） */
const byTitleIn = (nodes, title) => {
  for (const n of nodes ?? []) {
    if (!n) continue;
    if (String(n.title || '').trim() === title) return n;
    const hit = byTitleIn(n.children, title);
    if (hit) return hit;
  }
  return null;
};

const UPDATE = find(boards.boards, 'huaya-r1-1');
/** 这一支里第一个带某种块的节点（含自己） */
const findBlockIn = (node, type) => {
  if (!node) return null;
  if ((node.page ?? []).some((b) => b.type === type)) return node;
  for (const k of node.children ?? []) {
    const hit = findBlockIn(k, type);
    if (hit) return hit;
  }
  return null;
};
/** 按标题找节点（整棵树） */
const findByTitle = (title) => byTitleIn(boards.boards, title);
const MIAN = findByTitle('眠鱼志');
const GUWEN = findByTitle('冰室古闻考');

/* ================================================================
 * ① 数据分家
 * ================================================================ */
console.log('================ ① 助手日志搬出去了（数据分家）================');
const dates = (logs.entries ?? []).map((e) => e.date);
info(`mianyu.json：${dates.length} 天 —— ${dates.join(' ')}`);
check('★ 日志有自己的数据文件（src/data/mianyu.json），一天一栏', dates.length >= 11,
  `${dates.length} 天`);
check('★ 「更新日志」那一页里已经没有任何日期栏目了（全搬走）',
  !(UPDATE?.page ?? []).some((b) => b.type === 'text' && /^20\d\d\.\d{1,2}\.\d{1,2}/.test(String(b.text ?? '').trim())),
  `那一页现在 ${(UPDATE?.page ?? []).map((b) => b.type).join(',')}`);
/*
  老日志一字不少 —— 但现在它们都是**精简版**（用户 2026-09-28 要求：
  「精简到你修改了什么就可以 不要把那些具体的代码步骤写出来」），
  所以按"那天讲了什么"查关键词，顺便盯住"每一栏都够短、不再写代码步骤"。
*/
const allText = (logs.entries ?? []).map((e) => String(e.text ?? '')).join('\n');
const mine = (logs.entries ?? []).filter((e) => /^2026\.9\.(21|22|23|24|26|28|29)$/.test(e.date));
const mustHave = [
  ['9.21 讲了成员名片', '2026.9.21', '自动链接'],
  ['9.22 讲了冰山图', '2026.9.22', '冰山图'],
  ['9.23 讲了搜索', '2026.9.23', '搜索'],
  ['9.24 讲了后台静音', '2026.9.24', '后台'],
  ['9.26 讲了手机端', '2026.9.26', '手机端'],
  ['9.28 讲了马甲', '2026.9.28', '马甲'],
  ['9.29 讲了页面模版', '2026.9.29', '模版'],
];
for (const [what, date, needle] of mustHave) {
  const hit = (logs.entries ?? []).find((e) => e.date === date);
  check(`老日志没丢：${what}`, !!hit && String(hit.text ?? '').includes(needle), `${date} 里有「${needle}」`);
}
info('助手那几栏的字数：' + mine.map((e) => `${e.date}=${String(e.text ?? '').length}`).join(' '));
check('★ 助手写的日志保持精简（每一栏都 ≤ 600 字 —— 用户嫌"太长了"）',
  mine.length >= 6 && mine.every((e) => String(e.text ?? '').length <= 600),
  mine.map((e) => String(e.text ?? '').length).join('/'));
check('★ 而且不再写具体的代码步骤（不出现验收脚本名 / 文件路径 / 那些量出来的数）',
  !/tools\/checks\/|\.mjs|src\/data\/|\d{3,}[,，]?\d*\s*(字节|px|KB|MB)/.test(mine.map((e) => String(e.text ?? '')).join('\n')),
  '六栏里没有代码步骤');
/* 用户自己写的那五栏（9.14–9.20）保持原样、本来就短 */
const theirs = (logs.entries ?? []).filter((e) => /^2026\.9\.(14|15|16|17|20)$/.test(e.date));
check('用户自己写的那五栏还在、而且都很短（原样保留）',
  theirs.length === 5 && theirs.every((e) => String(e.text ?? '').length <= 200),
  theirs.map((e) => `${e.date}=${String(e.text ?? '').length}`).join(' '));

/* ================================================================
 * ② 两个新子版块
 * ================================================================ */
console.log('\n================ ② 更新日志下面多了子版块 ================');
check('★ 更新日志下面挂着「眠鱼志」和「冰室古闻考」两个子版块',
  !!MIAN && !!GUWEN && (UPDATE?.children ?? []).some((k) => k.title === '眠鱼志') &&
    (UPDATE?.children ?? []).some((k) => k.title === '冰室古闻考'),
  `子版块：${(UPDATE?.children ?? []).map((k) => k.title).join(' / ')}`);
check('★ 眠鱼志就是一个页面块（type: logs），内容读 mianyu.json',
  MIAN?.href === '/huaya/memory/mianyu' && (MIAN?.page ?? []).some((b) => b.type === 'logs'),
  `${MIAN?.href} [${(MIAN?.page ?? []).map((b) => b.type).join(',')}]`);
check('★ 更新日志这一支里有「近期更新」块（用户自己挪过位置，所以在这一支里找）',
  !!findBlockIn(UPDATE, 'recent'),
  findBlockIn(UPDATE, 'recent') ? `在「${findBlockIn(UPDATE, 'recent').title}」那一页上` : '没找到');
check('★ 「冰室古闻考」有自己的页面（用户自己写的那个，里面已经有内容了）',
  !!GUWEN && !!GUWEN.href && (GUWEN.page ?? []).length > 0,
  `${GUWEN?.href} [${(GUWEN?.page ?? []).map((b) => b.type).join(',')}]`);
check('两张子版块卡是 size:m（六列各占三列 = 左右并排）',
  (UPDATE?.page ?? []).some((b) => b.type === 'children' && b.size === 'm'),
  JSON.stringify((UPDATE?.page ?? []).find((b) => b.type === 'children') ?? null));

/* ================================================================
 * ③ 眠鱼志页面（真产物）
 * ================================================================ */
console.log('\n================ ③ 眠鱼志页面 ================');
const mi = fs.readFileSync(path.join(DIST, 'huaya/memory/mianyu/index.html'), 'utf8');
const dayCount = (mi.match(/data-log-date="/g) || []).length;
info(`页面里 ${dayCount} 天；日期锚点 ${[...mi.matchAll(/<h2 class="plogs__date" id="([^"]+)"/g)].map((m) => m[1]).join(' ')}`);
check('★ 所有日志都在这一页上（11 天，一天一栏）', dayCount === dates.length, `${dayCount} vs ${dates.length}`);
check('★ 每天一个锚点（能深链接到某一天）',
  (mi.match(/<h2 class="plogs__date" id="/g) || []).length === dates.length);
check('正文照旧按 Markdown 渲染（粗体 / 段落是标签，不是原样的星号）',
  !/\*\*[^*]+\*\*/.test(strip(mi).replace(/[\s\S]*<div class="plogs__body"/, '').slice(0, 200)) &&
    /<div class="plogs__body"/.test(mi),
  '日志正文里不该剩裸的 ** 记号');

/* ================================================================
 * ④ 近期更新（真产物）
 * ================================================================ */
console.log('\n================ ④ 近期更新卡片 ================');
/* 「近期更新」现在挂在「更新日志」自己那一页上（用户挪的），所以按块找页面 */
const recentNode = findBlockIn(UPDATE, 'recent');
const recentRel = (() => {
  if (!recentNode) return null;
  const walk = (nodes, parentUrl) => {
    for (const n of nodes ?? []) {
      if (!n) continue;
      if (n === recentNode) return String(n.href || `${parentUrl}/${String(n.id).split('-').pop()}`);
      const hit = walk(n.children, String(n.href || `${parentUrl}/${String(n.id).split('-').pop()}`));
      if (hit) return hit;
    }
    return null;
  };
  return walk(boards.boards, '');
})();
info(`「近期更新」在 /${String(recentRel ?? '').replace(/^\//, '')} 上`);
const hj = recentRel ? fs.readFileSync(path.join(DIST, recentRel.replace(/^\//, ''), 'index.html'), 'utf8') : '';
const cards = [...hj.matchAll(/<a class="precent__card" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
  href: m[1],
  name: (m[2].replace(/<[^>]*>/g, '').replace(/[\s\S]*?(\S+?)\s*$/, '$1') || '').trim(),
  text: m[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
}));
info('卡片：' + cards.map((c) => `${c.text} → ${c.href}`).join(' | '));
check('★ 有「近期更新」块的那一页上真的画出了卡片', !!hj && /data-recent="1"/.test(hj));
check('★ 卡片刻数 = 数据里记的条数（默认 3 张，数据不够就有几张算几张）',
  cards.length === Math.min(3, (recent.edits ?? []).length), `${cards.length} 张`);
check('★ 每张卡都有页面名 + 改动时间（时间来自 recent-edits.json 的 at）',
  cards.length > 0 && cards.every((c) => c.text && /\d+\.\d+ \d+:\d+/.test(c.text)),
  cards.map((c) => c.text).join(' | '));
check('★ 每张卡的地址在产物里都真有那一页（点得开，不是 404）',
  cards.every((c) => fs.existsSync(path.join(DIST, c.href.replace(/^\//, ''), 'index.html'))),
  cards.map((c) => c.href).join(' '));
check('卡片上写的是页面名，不是「未知」',
  cards.every((c) => c.text.replace(/\d+\.\d+ \d+:\d+/, '').trim().length > 0));
check('更新日志那一页上，两张子版块卡都在（几何留给浏览器那一段量）', (() => {
  const upd = fs.readFileSync(path.join(DIST, 'huaya/memory/update/index.html'), 'utf8');
  const m = [...upd.matchAll(/<a class="card[^"]*" href="([^"]+)"/g)].map((x) => x[1]);
  return m.length === 2 && m.includes('/huaya/memory/mianyu') && m.includes(String(GUWEN?.href || ''));
})(), `两张卡：眠鱼志 + ${GUWEN?.href}`);

/* ================================================================
 * ⑤ 编辑器那条链路（副本里真跑）
 * ================================================================ */
console.log('\n================ ⑤ 编辑器保存不会把这些弄丢 ================');
if (fs.existsSync(DST)) {
  const j = path.join(DST, 'node_modules');
  if (fs.existsSync(j)) { try { execSync(`cmd /c rmdir "${j}"`, { stdio: 'ignore' }); } catch { /* 不是 junction */ } }
  fs.rmSync(DST, { recursive: true, force: true });
}
fs.mkdirSync(DST, { recursive: true });
for (const item of ['src', 'tools', 'astro.config.mjs', 'package.json', 'tsconfig.json']) {
  fs.cpSync(path.join(SRC, item), path.join(DST, item), { recursive: true });
}
fs.cpSync(path.join(SRC, 'public'), path.join(DST, 'public'), {
  recursive: true,
  filter: (from) => !path.relative(path.join(SRC, 'public'), from).replace(/\\/g, '/').startsWith('img/opt'),
});
fs.mkdirSync(path.join(DST, 'public/img/opt'), { recursive: true });
fs.copyFileSync(path.join(SRC, 'public/img/opt/manifest.json'), path.join(DST, 'public/img/opt/manifest.json'));
execSync(`cmd /c mklink /J "${path.join(DST, 'node_modules')}" "${path.join(SRC, 'node_modules')}"`, { stdio: 'ignore' });
console.log('副本就绪：', DST);

const editor = spawn(process.execPath, [path.join(DST, 'tools/editor/server.mjs')], {
  cwd: DST,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let elog = '';
editor.stdout.on('data', (b) => { elog += b.toString('utf8'); });
editor.stderr.on('data', (b) => { elog += b.toString('utf8'); });
let base = '';
for (let i = 0; i < 400 && !base; i++) {
  await sleep(150);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(elog);
  if (m) base = `http://127.0.0.1:${m[1]}`;
}
if (!base) {
  console.error('副本里的编辑器没起来：' + elog.slice(-400));
  process.exit(2);
}
info('副本里的编辑器在 ' + base);

const copyBoardsFile = path.join(DST, 'src/data/home-boards.json');
const copyRecentFile = path.join(DST, 'src/data/recent-edits.json');
const copyMianyuFile = path.join(DST, 'src/data/mianyu.json');
const post = async (p, body) => {
  const r = await fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};

/* ⑤-1 原样保存一次：这就是用户报的那个坑（旧版会把助手加的栏目弄丢） */
{
  const before = fs.readFileSync(copyBoardsFile, 'utf8');
  const tree = JSON.parse(before);
  const r = await post('/api/boards', { boards: tree.boards });
  const after = JSON.parse(fs.readFileSync(copyBoardsFile, 'utf8'));
  /* 按名字找：用户随时会调结构（他 2026-09-28 就自己挪过一次） */
  const mianAfter = byTitleIn(after.boards, '眠鱼志');
  const guwenAfter = byTitleIn(after.boards, '冰室古闻考');
  check('编辑器「打开 → 原样保存一次」之后，两个子版块一个都没丢',
    r.status === 200 && !!mianAfter && !!guwenAfter,
    `status=${r.status}；眠鱼志=${!!mianAfter}、冰室古闻考=${!!guwenAfter}`);
  const upd = find(after.boards, 'huaya-r1-1');
  check('「更新日志」那一页还是"没有日期栏目"（助手日志没被塞回来）',
    !(upd?.page ?? []).some((b) => b.type === 'text' && /^20\d\d\.\d/.test(String(b.text ?? '').trim())));
  const hasBlock = (node, type) => (node?.page ?? []).some((b) => b.type === type);
  const recentNodeAfter = (() => {
    const walk = (n) => {
      if (!n) return null;
      if ((n.page ?? []).some((b) => b.type === 'recent')) return n;
      for (const k of n.children ?? []) {
        const hit = walk(k);
        if (hit) return hit;
      }
      return null;
    };
    return walk(upd);
  })();
  check('★ 两种新块过一遍编辑器的白名单也没被丢掉（助手日志 / 近期更新）',
    hasBlock(mianAfter, 'logs') && !!recentNodeAfter,
    `眠鱼志 [${(mianAfter?.page ?? []).map((b) => b.type).join(',')}]、近期更新在「${recentNodeAfter?.title}」`);
  check('用户自己写的那一页（冰室古闻考）内容没被动',
    (guwenAfter?.page ?? []).length > 0 &&
      JSON.stringify(guwenAfter.page) === JSON.stringify(byTitleIn(boards.boards, '冰室古闻考')?.page ?? []),
    `${(guwenAfter?.page ?? []).length} 块`);
  check('日志数据文件（mianyu.json）在这个过程中一个字节都没动',
    fs.readFileSync(copyMianyuFile, 'utf8') === fs.readFileSync(MIANYU, 'utf8'));
}

/* ⑤-2 带 touched 保存一次：记的是"真改了的那一页" */
{
  const tree = JSON.parse(fs.readFileSync(copyBoardsFile, 'utf8'));
  const bing = find(tree.boards, 'huaya-hishitsu');
  bing.subtitle = `验收改了一下 ${Date.now()}`;
  const r = await post('/api/boards', { boards: tree.boards, touched: ['huaya-hishitsu'] });
  const rec = JSON.parse(fs.readFileSync(copyRecentFile, 'utf8'));
  check('带 touched 保存之后，「近期更新」记下了改的那一页（冰室 → /huaya/bingshi）',
    r.status === 200 && rec.edits?.[0]?.href === '/huaya/bingshi' && rec.edits?.[0]?.title === '冰室',
    JSON.stringify(rec.edits?.[0]));
  check('记的是"页面名 + 时间"，时间是刚写进去的（不是种子那几条）',
    /^20\d\d-\d\d-\d\dT/.test(String(rec.edits?.[0]?.at ?? '')) &&
      Date.now() - new Date(rec.edits[0].at).getTime() < 60_000,
    String(rec.edits?.[0]?.at));
  check('同一页只留最新一条（不是每次保存都堆一条）',
    (rec.edits ?? []).filter((e) => e.href === '/huaya/bingshi').length === 1);
}

/* ⑤-3 重建副本：卡片要跟着变成刚改的那一页 */
{
  const built = spawn(process.execPath, [path.join(SRC, 'node_modules/astro/bin/astro.mjs'), 'build'], {
    cwd: DST,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  built.stdout.on('data', (d) => { out += d; });
  built.stderr.on('data', (d) => { out += d; });
  const ok = await new Promise((res) => built.on('close', (code) => res(code === 0)));
  check('副本重新构建成功', ok, out.split(/\r?\n/).filter((l) => /error|Error/.test(l)).slice(-2).join(' | '));
  if (ok) {
    const recentRel = (recentNode && recentNode.href) || '/huaya/memory/update';
    const html = fs.readFileSync(path.join(DST, `dist${recentRel}/index.html`.replace(/\/+/g, '/')), 'utf8');
    const first = /<a class="precent__card" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(html);
    check('★ 重建之后，第一张卡就是刚在编辑器里改的那一页（冰室）',
      !!first && first[1] === '/huaya/bingshi' && firstName(first[2]) === '冰室',
      first ? `${firstName(first[2])} → ${first[1]}` : '没找到卡片');
    const days = (fs.readFileSync(path.join(DST, 'dist/huaya/memory/mianyu/index.html'), 'utf8')).match(/data-log-date="/g) || [];
    check('重建之后眠鱼志还是那么多天（没被谁清掉）', days.length === dates.length, `${days.length} 天`);
  }
}

/* ⑤-5 dev 那条路（用户启动器的「看效果」跑的是 astro dev） */
console.log('\n---- dev 模式：这三页也得是一样的 ----');
{
  const devPort = 4346;
  const dev = spawn(process.execPath, [path.join(SRC, 'node_modules/astro/bin/astro.mjs'), 'dev', '--port', String(devPort), '--host', '127.0.0.1'], {
    cwd: DST,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const fetchP = async (p) => {
    const r = await fetch(`http://127.0.0.1:${devPort}${p}`, { headers: { accept: 'text/html,application/xhtml+xml' } });
    return r.ok ? r.text() : '';
  };
  let devLog = '';
  let devMian = '';
  for (let i = 0; i < 90 && !devMian; i++) {
    await sleep(500);
    try {
      devLog = await fetchP('/huaya/memory/update/');
      devMian = await fetchP('/huaya/memory/mianyu/');
    } catch { /* 还没起来 */ }
  }
  const devHj = devMian ? await fetchP(`/${String(recentRel ?? '/huaya/memory/update').replace(/^\//, '')}/`) : '';
  check('dev 下眠鱼志也是那么多天（读的是 mianyu.json，不是版块树）',
    (devMian.match(/data-log-date="/g) || []).length === dates.length,
    `${(devMian.match(/data-log-date="/g) || []).length} 天`);
  check('dev 下更新日志页上两张子版块卡都在',
    /memory\/mianyu/.test(devLog) && devLog.includes(String(GUWEN?.href ?? '不存在的地址')));
  check('dev 下近期更新也画得出来（3 张卡）',
    (devHj.match(/class="precent__card"/g) || []).length === 3,
    `${(devHj.match(/class="precent__card"/g) || []).length} 张`);
  dev.kill();
}

/* ⑤-4 append-log 只写 mianyu.json */
{
  const bodyFile = path.join(DST, '.tmp-log-body.md');
  fs.mkdirSync(path.dirname(bodyFile), { recursive: true });
  fs.writeFileSync(bodyFile, '验收写的一栏：这一栏只是测试用的。\n\n第二段。\n', 'utf8');
  const boardsBefore = fs.readFileSync(copyBoardsFile, 'utf8');
  /* 天数按**现成**的算：日志每天都在长，写死 11/12 明天就红了 */
  const daysBefore = (JSON.parse(fs.readFileSync(copyMianyuFile, 'utf8')).entries ?? []).length;
  const run = (args) =>
    execSync(`"${process.execPath}" "${path.join(DST, 'tools/memory/append-log.mjs')}" ${args}`, {
      cwd: DST,
      encoding: 'utf8',
    });
  let out1 = '';
  try {
    out1 = run(`2026.10.1 "${bodyFile}"`);
  } catch (err) {
    out1 = String(err.stdout ?? err.message);
  }
  const after = JSON.parse(fs.readFileSync(copyMianyuFile, 'utf8'));
  check('★ 助手写日志：眠鱼志多了一天（2026.10.1）',
    out1.includes('2026.10.1') && (after.entries ?? []).length === daysBefore + 1,
    `${daysBefore} → ${(after.entries ?? []).length} 天`);
  check('★ 而且 home-boards.json 一个字节都没动（这就是"分家"的意义）',
    fs.readFileSync(copyBoardsFile, 'utf8') === boardsBefore);
  let out2 = '';
  try {
    out2 = run(`2026.10.1 "${bodyFile}"`);
  } catch (err) {
    out2 = String(err.stdout ?? err.message);
  }
  const again = JSON.parse(fs.readFileSync(copyMianyuFile, 'utf8'));
  check('同一天再写一次 = 就地覆盖（天数不变，不会堆出两栏 10.1）',
    (again.entries ?? []).length === daysBefore + 1 && /就地覆盖/.test(out2),
    `${(again.entries ?? []).length} 天（写完两次）`);
}

/* 几何：两张子版块卡在真浏览器里是不是左右并排（窄屏才该塌成一列） */
console.log('\n---- 真浏览器：两张子版块卡的几何 ----');
const profile = path.join(process.env.TEMP ?? '.', `dsh-memsplit-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu',
  '--enable-unsafe-swiftshader', '--disable-breakpad', '--window-size=1440,960',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
    });
  }
  static async attach(u) {
    const ws = new WebSocket(u);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
    });
    return new CDP(ws);
  }
  send(m, p = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method: m, params: p }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async ev(e) {
    const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
}

/* 只为这两条起浏览器：产物用 dist 里真跑一遍。
   ⚠ MIME 必须给对：css 发成 application/octet-stream 的话浏览器会因为
   "严格的 MIME 检查"整份样式表都不加载 —— 页面变成没样式的裸链接，
   量出来的卡片就是 48×24 那种小方块（这一次就是这么踩到的）。 */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
};
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
    const f = path.join(DIST, t);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream' });
      return fs.createReadStream(f).pipe(res);
    }
  }
  res.writeHead(404);
  res.end('404');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
let cdp = null;
for (let i = 0; i < 80 && !cdp; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    if (page) cdp = await CDP.attach(page.webSocketDebuggerUrl);
  } catch { /* 还没起来 */ }
}
if (cdp) {
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  const geometry = async (w) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w <= 736 });
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/huaya/memory/update/` });
    for (let i = 0; i < 120; i++) { await sleep(60); if ((await cdp.ev('document.readyState')) === 'complete') break; }
    await sleep(250);
    return cdp.ev(`(() => {
      const cards = [...document.querySelectorAll('.pcards > .card')].map((a) => {
        const r = a.getBoundingClientRect();
        return { text: (a.textContent || '').trim(), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
      });
      return cards;
    })()`);
  };
  const wide = await geometry(1440);
  info('1440px 宽：' + JSON.stringify(wide));
  check('桌面宽屏上两张卡左右并排（同一个 y、两个不同的 x、高度接近）',
    wide.length === 2 && Math.abs(wide[0].y - wide[1].y) <= 2 && wide[0].x !== wide[1].x &&
      Math.abs(wide[0].w - wide[1].w) <= 2 && wide[0].w > 200,
    JSON.stringify(wide));
  const narrow = await geometry(390);
  info('390px 宽：' + JSON.stringify(narrow));
  check('手机上塌成一列（y 不一样、各占整行）',
    narrow.length === 2 && narrow[1].y > narrow[0].y + narrow[0].h - 4,
    JSON.stringify(narrow));
  try { await cdp.send('Browser.close'); } catch { /* ignore */ }
}
chrome.kill();
server.close();
editor.kill();
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* ignore */ }

function firstName(html) {
  return html.replace(/<[^>]*>/g, '').replace(/\d+\.\d+ \d+:\d+/, '').trim();
}

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
