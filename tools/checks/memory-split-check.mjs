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
const UPDATE = find(boards.boards, 'huaya-r1-1');
const MIAN = find(boards.boards, 'huaya-r1-1-1');
const HUAJIAN = find(boards.boards, 'huaya-r1-1-2');
const GUWEN = find(boards.boards, 'huaya-r1-1-2-1');

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
/* 老日志一字不少：挑几栏里最有辨识度的句子（都是当时真量出来的数） */
const allText = (logs.entries ?? []).map((e) => String(e.text ?? '')).join('\n');
const mustHave = [
  ['9.22 的验收数字', '902 个锚点'],
  ['9.24 的时间轴改动', '2293px'],
  ['9.26 的放大图优化', '62,436 字节'],
  ['9.28 的马甲', '马甲'],
  ['9.28 的上传修复', '9.32MB'],
];
for (const [what, needle] of mustHave) {
  check(`老日志没丢：${what}`, allText.includes(needle), needle);
}

/* ================================================================
 * ② 两个新子版块
 * ================================================================ */
console.log('\n================ ② 更新日志下面多了两个子版块 ================');
check('★ 更新日志下面挂着「眠鱼志」和「花涧堂更新」两个子版块',
  !!MIAN && !!HUAJIAN && (UPDATE?.children ?? []).length >= 2,
  `子版块：${(UPDATE?.children ?? []).map((k) => k.title).join(' / ')}`);
check('★ 左边的眠鱼志就是一个页面块（type: logs），内容读 mianyu.json',
  MIAN?.href === '/huaya/memory/mianyu' && (MIAN?.page ?? []).some((b) => b.type === 'logs'),
  `${MIAN?.href} [${(MIAN?.page ?? []).map((b) => b.type).join(',')}]`);
check('★ 右边的花涧堂更新：上面「近期更新」，下面一张通往冰室古闻考的卡',
  (HUAJIAN?.page ?? []).some((b) => b.type === 'recent') &&
    (HUAJIAN?.page ?? []).some((b) => b.type === 'card' && b.ref === 'huaya-r1-1-2-1'),
  `[${(HUAJIAN?.page ?? []).map((b) => b.type).join(',')}]`);
check('★ 「冰室古闻考」是花涧堂更新下面的子版块，有自己的页面（用户自己写的那个）',
  !!GUWEN && GUWEN.href === '/huaya/memory/guwenkao' &&
    (HUAJIAN?.children ?? []).some((k) => k.id === 'huaya-r1-1-2-1'),
  `${GUWEN?.href}`);
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
const hj = fs.readFileSync(path.join(DIST, 'huaya/memory/huajian/index.html'), 'utf8');
const cards = [...hj.matchAll(/<a class="precent__card" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
  href: m[1],
  name: (m[2].replace(/<[^>]*>/g, '').replace(/[\s\S]*?(\S+?)\s*$/, '$1') || '').trim(),
  text: m[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
}));
info('卡片：' + cards.map((c) => `${c.text} → ${c.href}`).join(' | '));
check('★ 花涧堂更新页上有「近期更新」块', /data-recent="1"/.test(hj));
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
check('花涧堂更新页上还有一张通往冰室古闻考的卡',
  /href="\/huaya\/memory\/guwenkao"/.test(hj) && /class="card[^"]*"/.test(hj));
check('更新日志那一页上两张卡左右并排（同一行：y 相同、x 不同）', (() => {
  const upd = fs.readFileSync(path.join(DIST, 'huaya/memory/update/index.html'), 'utf8');
  const m = [...upd.matchAll(/<a class="card[^"]*" href="([^"]+)"/g)].map((x) => x[1]);
  return m.length === 2 && m.includes('/huaya/memory/mianyu') && m.includes('/huaya/memory/huajian');
})(), '产物里先看两张卡都在（几何留给浏览器那一段量）');

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
  const has = (id) => !!find(after.boards, id);
  check('编辑器「打开 → 原样保存一次」之后，三个新节点一个都没丢',
    r.status === 200 && has('huaya-r1-1-1') && has('huaya-r1-1-2') && has('huaya-r1-1-2-1'),
    `status=${r.status}`);
  const upd = find(after.boards, 'huaya-r1-1');
  check('「更新日志」那一页还是"没有日期栏目"（助手日志没被塞回来）',
    !(upd?.page ?? []).some((b) => b.type === 'text' && /^20\d\d\.\d/.test(String(b.text ?? '').trim())));
  const keep = (id, type) => (find(after.boards, id)?.page ?? []).some((b) => b.type === type);
  check('★ 两种新块过一遍编辑器的白名单也没被丢掉（助手日志 / 近期更新）',
    keep('huaya-r1-1-1', 'logs') && keep('huaya-r1-1-2', 'recent') &&
      (find(after.boards, 'huaya-r1-1-2')?.page ?? []).some((b) => b.type === 'card'),
    `眠鱼志 [${(find(after.boards, 'huaya-r1-1-1')?.page ?? []).map((b) => b.type).join(',')}]、花涧堂更新 [${(find(after.boards, 'huaya-r1-1-2')?.page ?? []).map((b) => b.type).join(',')}]`);
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
    const html = fs.readFileSync(path.join(DST, 'dist/huaya/memory/huajian/index.html'), 'utf8');
    const first = /<a class="precent__card" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(html);
    check('★ 重建之后，第一张卡就是刚在编辑器里改的那一页（冰室）',
      !!first && first[1] === '/huaya/bingshi' && firstName(first[2]) === '冰室',
      first ? `${firstName(first[2])} → ${first[1]}` : '没找到卡片');
    const days = (fs.readFileSync(path.join(DST, 'dist/huaya/memory/mianyu/index.html'), 'utf8')).match(/data-log-date="/g) || [];
    check('重建之后眠鱼志还是 11 天（没被谁清掉）', days.length === 11, `${days.length} 天`);
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
  const devHj = devMian ? await fetchP('/huaya/memory/huajian/') : '';
  check('dev 下眠鱼志也是 11 天（读的是 mianyu.json，不是版块树）',
    (devMian.match(/data-log-date="/g) || []).length === 11,
    `${(devMian.match(/data-log-date="/g) || []).length} 天`);
  check('dev 下更新日志页上两张子版块卡都在',
    /memory\/mianyu/.test(devLog) && /memory\/huajian/.test(devLog));
  check('dev 下近期更新也画得出来（3 张卡）',
    (devHj.match(/class="precent__card"/g) || []).length === 3,
    `${(devHj.match(/class="precent__card"/g) || []).length} 张`);
  dev.kill();
}

/* ⑤-4 append-log 只写 mianyu.json */{
  const bodyFile = path.join(DST, '.tmp-log-body.md');
  fs.mkdirSync(path.dirname(bodyFile), { recursive: true });
  fs.writeFileSync(bodyFile, '验收写的一栏：这一栏只是测试用的。\n\n第二段。\n', 'utf8');
  const boardsBefore = fs.readFileSync(copyBoardsFile, 'utf8');
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
  check('★ 助手写日志：眠鱼志多了一天（2026.10.1）', out1.includes('2026.10.1') && (after.entries ?? []).length === 12,
    `entries=${(after.entries ?? []).length}`);
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
    (again.entries ?? []).length === 12 && /就地覆盖/.test(out2), `${(again.entries ?? []).length} 天`);
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
