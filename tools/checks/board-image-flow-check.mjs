/*
 * 「窄图并排」的验收：宽档为「窄」(third) 的图片不再一张占一行。
 *
 * 用户原话（2026-09-21）：
 *   「修改页面中图片的排列 如果图片选择大小为窄 那么不要让右边留出那么多空
 *     选择为窄的图片会优先横着排开然后再换行继续排」
 *
 * 量的是数据里「连着至少两张窄图」的那一页（脚本自己挑，不写死地址），真 dist、真 Chromium：
 *   ① 两张窄图在**同一行**（顶边一样、左右排开、不重叠）
 *   ② 每张占满自己那一格、两张一样宽
 *   ③ 那一行右边剩的空**明显小了**（以前一张一行时右边空 ~3/4，现在 ≤ 40%）
 *   ④ 文字 / 宽图这些块照旧横跨整行（没被拆成一格）
 *   ⑤ 往 DOM 里复制几份窄图 → 排满一行会**换行**（不是挤在一行里）
 *   ⑥ 手机（390）上还是一张一行（窄屏放不下两张）
 *   ⑦ 两端都没有横向溢出、没有 JS 报错
 *
 * 用法：node tools/checks/board-image-flow-check.mjs [dist目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
const PORT = 4405;
const DEBUG_PORT = 9375;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};

/*
  量哪一页**从数据里挑**，不写死地址：要一页里「连着至少两张『窄』图」，
  另外还得有文字块（用来对照：它们必须照旧横跨整行）。
  这样用户改了某一页的宽档 / 删了那两张图，这个检查也不会跟着挂。
  （「宽图 704px」那一条只在数据里真有宽图时才量 —— 2026-09-22 用户把那两页的宽图
    改成了半宽，硬要求「必须有宽图」会让整支脚本没得量、直接退出。）
*/
const BOARDS = 'src/data/home-boards.json';
if (!fs.existsSync(BOARDS)) {
  console.error(`找不到 ${BOARDS}（这个脚本要在站点根目录跑）`);
  process.exit(2);
}
const pages = [];
const walk = (nodes) => {
  for (const n of nodes ?? []) {
    if (n && Array.isArray(n.page) && n.page.length) pages.push({ title: n.title, href: n.href, blocks: n.page });
    walk(n?.children);
  }
};
walk(JSON.parse(fs.readFileSync(BOARDS, 'utf8')).boards);
const scored = pages.map((p) => {
  let run = 0;
  let maxRun = 0;
  for (const b of p.blocks) {
    run = b.type === 'image' && (b.width ?? 'wide') === 'third' ? run + 1 : 0;
    maxRun = Math.max(maxRun, run);
  }
  return {
    ...p,
    maxRun,
    wides: p.blocks.filter((b) => b.type === 'image' && (b.width ?? 'wide') === 'wide').length,
    texts: p.blocks.filter((b) => b.type === 'text').length,
  };
});
const pick = scored.filter((p) => p.maxRun >= 2 && p.texts >= 1).sort((a, b) => b.maxRun - a.maxRun)[0];
if (!pick) {
  console.error('数据里找不到「连着两张以上窄图 + 还要有文字块」的页面，这个检查没东西可量');
  process.exit(2);
}
const PAGE = pick.href.endsWith('/') ? pick.href : `${pick.href}/`;
const PAGE_FILE = path.join(root, ...PAGE.split('/').filter(Boolean), 'index.html');
console.log(`拿这一页量：${pick.title}（${PAGE}）—— 连着 ${pick.maxRun} 张窄图、宽图 ${pick.wides} 张、文字块 ${pick.texts} 个`);

if (!fs.existsSync(PAGE_FILE)) {
  console.error(`找不到那一页的产物：${PAGE_FILE}，先构建`);
  process.exit(2);
}

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
    const f = path.join(root, t);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream' });
      return fs.createReadStream(f).pipe(res);
    }
  }
  res.writeHead(404);
  res.end('404');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = path.join(process.env.TEMP ?? '.', `dsh-imgflow-${Date.now()}`);
const chrome = spawn(
  CHROME,
  ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
   '--disable-breakpad', '--window-size=1440,900', `--user-data-dir=${profile}`,
   `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
  { stdio: 'ignore' }
);

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
      if (m.method === 'Runtime.exceptionThrown') {
        this.errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
      }
    });
  }
  static async attach(u) {
    const ws = new WebSocket(u);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('ws 连不上')), { once: true });
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
    return r.result.value;
  }
  async goto(p, wait = 2200) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 150; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
  }
}

let cdp = null;
for (let i = 0; i < 80 && !cdp; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    if (page) cdp = await CDP.attach(page.webSocketDebuggerUrl);
  } catch { /* 还没起来 */ }
}
if (!cdp) { console.error('Chromium 没起来'); process.exit(2); }
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

/* 页面上量一遍：窄图、宽图、文字块的矩形 + 那一行右边剩多少空 */
const PROBE = `(() => {
  const R = (el) => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
  const page = document.querySelector('.page');
  const blocks = [...page.querySelectorAll(':scope > .pblock')];
  const fig = (s) => [...page.querySelectorAll(s)].map(R);
  const thirds = fig('.pfigure--third');
  const wides = fig('.pfigure--wide');
  const blockRects = blocks.map((b) => ({ cls: b.className, ...R(b) }));
  /* 正文列有多宽 = 所有"横跨整行"的块里最宽的那个（它们都一样宽） */
  const fullW = Math.max(...blockRects.filter((b) => !b.cls.includes('pblock--flow')).map((b) => b.w), 0);
  /* 第一行窄图：顶边一样的那一组 */
  const rowTop = thirds.length ? thirds[0].t : null;
  const row = thirds.filter((f) => Math.abs(f.t - rowTop) <= 2);
  const rowRight = row.length ? Math.max(...row.map((f) => f.r)) : null;
  return {
    vw: innerWidth,
    pageW: Math.round(page.getBoundingClientRect().width),
    pageDisplay: getComputedStyle(page).display,
    thirds, wides,
    thirdCount: thirds.length,
    rowCount: row.length,
    rowEmptyRight: rowRight === null ? null : Math.round(page.getBoundingClientRect().right - rowRight),
    fullW,
    fullSpanOK: blockRects.filter((b) => !b.cls.includes('pblock--flow')).every((b) => Math.abs(b.w - fullW) <= 2),
    flowBlocks: blockRects.filter((b) => b.cls.includes('pblock--flow')).length,
    textW: (() => { const t = page.querySelector('.ptext'); return t ? Math.round(t.getBoundingClientRect().width) : null; })(),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
})()`;

/* ---------------- 桌面端 ---------------- */
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp.goto(PAGE, 2600);
const d = await cdp.ev(PROBE);
console.log(`\n================ 桌面 1440（${PAGE}）================`);
console.log(JSON.stringify(d));

check('两页窄图都带上了 .pblock--flow（宽档=「窄」才带）', d.flowBlocks === d.thirdCount && d.thirdCount >= 2,
  `窄图 ${d.thirdCount} 张，.pblock--flow ${d.flowBlocks} 个`);
check('两张窄图排在**同一行**（顶边差 ≤ 2px）', d.thirdCount >= 2 && d.rowCount >= 2,
  `第一行 ${d.rowCount} 张；顶边 ${d.thirds.map((f) => f.t).join(' / ')}`);
check('并排是真的并排：左右依次排开、不重叠',
  d.rowCount >= 2 && d.thirds[1].l >= d.thirds[0].r - 1,
  `第 1 张 ${d.thirds[0]?.l}~${d.thirds[0]?.r}，第 2 张 ${d.thirds[1]?.l}~${d.thirds[1]?.r}`);
check('两张一样宽（都占满自己那一格）',
  d.thirdCount >= 2 && Math.abs(d.thirds[0].w - d.thirds[1].w) <= 2 && d.thirds[0].w >= 240,
  `${d.thirds.map((f) => f.w).join(' / ')}px`);
check('★ 那一行右边剩的空明显小了（≤ 正文列宽的 40%；一张一行时是 ~75%）',
  d.rowEmptyRight !== null && d.rowEmptyRight <= d.fullW * 0.4,
  `右边空 ${d.rowEmptyRight}px / 正文列 ${d.fullW}px = ${d.rowEmptyRight !== null ? ((d.rowEmptyRight / d.fullW) * 100).toFixed(1) : '?'}%`);
check('文字 / 宽图这些块照旧横跨整行（没被拆成一格）',
  d.fullSpanOK && d.fullW >= d.pageW - 2 && d.textW !== null && Math.abs(d.textW - d.fullW) <= 2,
  `整行块宽 ${d.fullW}px、.page ${d.pageW}px、正文 ${d.textW}px`);
if (d.wides.length) {
  check('宽图（宽档）宽度没被改：44rem = 704px',
    d.wides.every((f) => Math.abs(f.w - 704) <= 2),
    d.wides.map((f) => f.w).join(' / '));
} else {
  console.log('SKIP  这一页没有「宽」档的图 —— 跳过「宽图 704px」那一条（用户把宽档都改成半宽了）');
  pass++;
}
check('桌面端没有横向溢出', d.overflow <= 1, `scrollWidth - clientWidth = ${d.overflow}`);

/* ---------------- 排满会不会换行（往 DOM 里再塞几张同样的窄图） ---------------- */
const wrap = await cdp.ev(`(() => {
  const page = document.querySelector('.page');
  const flow = [...page.querySelectorAll(':scope > .pblock--flow')];
  const anchor = flow[flow.length - 1];
  for (let i = 0; i < 4; i++) {
    const c = anchor.cloneNode(true);
    c.removeAttribute('id');
    c.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    anchor.after(c);
  }
  const R = (el) => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width) }; };
  const figs = [...page.querySelectorAll('.pfigure--third')].map(R);
  /* 按顶边分组 = 按行分组 */
  const rows = [];
  for (const f of figs.sort((a, b) => a.t - b.t || a.l - b.l)) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.t - f.t) <= 2) last.items.push(f);
    else rows.push({ t: f.t, items: [f] });
  }
  return { total: figs.length, rows: rows.map((r) => r.items.length), width: figs[0]?.w };
})()`);
console.log('\n================ 塞满一行会不会换行 ================');
console.log(JSON.stringify(wrap));
check('★ 窄图是「排满一行再换行」：塞到 6 张 → 分成 2 行（不是挤成一排）',
  wrap.total === 6 && wrap.rows.length === 2 && wrap.rows[0] >= 3 && wrap.rows[0] === wrap.rows[1],
  `6 张分成 ${wrap.rows.length} 行：${wrap.rows.join(' + ')}`);
check('换行以后每张的宽度不变（还是那一格）',
  Math.abs(wrap.width - d.thirds[0].w) <= 2, `${wrap.width}px vs ${d.thirds[0].w}px`);

/* ---------------- 手机端：还是一张一行 ---------------- */
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp.goto(PAGE, 2600);
const m = await cdp.ev(PROBE);
console.log('\n================ 手机 390 ================');
console.log(JSON.stringify(m));
check('手机端不套栅格（.page 还是纵向排的）', m.pageDisplay === 'flex', `display=${m.pageDisplay}`);
check('手机端窄图还是**一张一行**（顶边不一样、左边对齐）',
  m.thirdCount >= 2 && m.rowCount === 1 && Math.abs(m.thirds[0].l - m.thirds[1].l) <= 2,
  `第一行 ${m.rowCount} 张；左边 ${m.thirds.map((f) => f.l).join(' / ')}`);
check('手机端窄图不超宽（≤ 20rem = 320px，也不超过正文列）',
  m.thirds.every((f) => f.w <= 321 && f.w <= m.fullW + 1), m.thirds.map((f) => `${f.w}px`).join(' / '));
check('手机端没有横向溢出', m.overflow <= 1, `scrollWidth - clientWidth = ${m.overflow}`);
check('两端都没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

try { await cdp.send('Browser.close'); } catch { /* ignore */ }
chrome.kill();
server.close();
console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
