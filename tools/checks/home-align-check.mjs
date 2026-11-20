/*
 * 首页"严格对齐"的验收（2026-11-19 加）。
 *
 * 站长的原话（前后两次）：
 *   「注意到甬城晴雨和曼沫砾总线之间的缝隙 和曼沫砾总线和涣源溪水钟之间的缝隙
 *    高度不一样 重新检查一遍首页所有卡片保证严格对齐」
 *   「注意到甬城晴雨和花娅陌域板块好像长度不一样 请你严格核对和修正并且保证
 *    下面的所有版块也跟着一起修正 严格对齐」
 *
 * 所以这支量的是"盒子"，不是"看着像"：真构建产物 + 真浏览器，在十种屏宽下量
 * 每一块的位置和尺寸，只要差超过 0.5px 就红。
 *
 *   ① 两块大板（甬城晴雨 / 花娅陌域）宽、高、顶边、底边**完全一样**
 *   ② 大板的左右边 == 上下那两列的左边 / 右边（列边界就是它们定的）
 *   ③ 左列的卡（公告 / 水钟 / 终池）左右边跟大板一致
 *   ④ 右列的卡（精华大殿 / 黎语堂 整格，冰山+远位面 半格一对）右边跟大板一致
 *   ⑤ 行与行之间的缝一样宽（±1px）
 *   ⑥ 两列最后一张卡的底边齐平
 *   ⑦ 任何宽度下都不横向溢出
 *
 * 用法：node tools/checks/home-align-check.mjs [dist目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromePath } from './lib/chrome.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
const PORT = 4561;
const DEBUG_PORT = 9561;
const CHROME = chromePath();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
};
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error(`找不到 ${path.join(root, 'index.html')}，先构建`);
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
  res.writeHead(404); res.end('404');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = path.join(process.env.TEMP ?? '.', `dsh-align-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--enable-unsafe-swiftshader',
  '--disable-breakpad', '--window-size=1600,1200', `--user-data-dir=${profile}`,
  `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });

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
}

let cdp = null;
for (let i = 0; i < 80 && !cdp; i++) {
  await sleep(250);
  try {
    const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const page = l.find((t) => t.type === 'page');
    if (page) cdp = await CDP.attach(page.webSocketDebuggerUrl);
  } catch { /* 还没起来 */ }
}
if (!cdp) { console.error('Chromium 没起来'); process.exit(2); }
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

const EXPR = `(() => {
  const q = (v) => Math.round(v * 10) / 10;
  const box = (n) => { if (!n) return null; const r = n.getBoundingClientRect();
    return { x: q(r.left), y: q(r.top + scrollY), w: q(r.width), h: q(r.height), r: q(r.right), b: q(r.bottom + scrollY) }; };
  const one = (s) => box(document.querySelector(s));
  return {
    vw: innerWidth,
    clientW: document.documentElement.clientWidth,
    boards: [...document.querySelectorAll('.boards .board')].map((n) => ({ id: n.id, ...box(n) })),
    arrow: box(document.querySelector('.cards__arrow')),
    announce: one('#home-announce'),
    liyutang: one('#home-liyutang'),
    cal: one('#home-cal'),
    ice: one('.ice'),
    daily: one('.daily'),
    cistern: one('#home-cistern'),
    placeholder: one('#home-placeholder'),
    farland: one('#home-farland'),
    bottomY: Math.max(...[...document.querySelectorAll('#home-cards > *')].map((n) => n.getBoundingClientRect().bottom + scrollY)),
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    singleCol: getComputedStyle(document.querySelector('.boards')).gridTemplateColumns.split(' ').length === 1,
  };
})()`;

const near = (a, b, tol = 0.5) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;

const DESKTOP = [1920, 1600, 1440, 1366, 1280, 1024, 980, 900, 820, 768];
const MOBILE = [760, 600, 430, 390, 360];

try {
  for (const w of [...DESKTOP, ...MOBILE]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: 1000, deviceScaleFactor: 1, mobile: w <= 760 });
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
    for (let i = 0; i < 150; i++) { await sleep(120); if ((await cdp.ev('document.readyState')) === 'complete') break; }
    await sleep(700);
    const g = await cdp.ev(EXPR);
    const [L, R] = g.boards;

    check(`${w}：两块大板都在（甬城晴雨 / 花娅陌域）`, !!L && !!R, JSON.stringify(g.boards?.map((b) => b.id)));
    if (!L || !R) continue;

    check(`${w}：两边大板**一样长**（高 ${L.h} vs ${R.h}）`, near(L.h, R.h), JSON.stringify({ 左高: L.h, 右高: R.h }));
    check(`${w}：两边大板一样宽（${L.w} vs ${R.w}）`, near(L.w, R.w), JSON.stringify({ 左宽: L.w, 右宽: R.w }));
    check(`${w}：不横向溢出`, g.overflowX === 0, `${g.overflowX}px`);

    /*
      「回到欣赏页」那个小箭头（站长 2026-11-19 的原话：
      「箭头并不在两个大卡片的正中间对称处 看起来还是会歪有点奇怪 要严格按照整个屏幕对称」）。
      它必须在**可视区的正中间**，也就是两块大板并集的正中间 —— 差超过 0.5px 就红。
    */
    const midView = g.clientW / 2;
    const midBoards = (L.x + R.r) / 2;
    const midArrow = g.arrow ? g.arrow.x + g.arrow.w / 2 : NaN;
    check(`${w}：★ 回到顶部那个箭头打在**屏幕正中**（${midArrow} vs ${midView}）`,
      Math.abs(midArrow - midView) <= 0.5, JSON.stringify({ 箭头中心: midArrow, 可视区中心: midView }));
    if (!g.singleCol) {
      check(`${w}：★ 箭头正好落在两块大板的正中间（${midArrow} vs ${midBoards}）`,
        Math.abs(midArrow - midBoards) <= 0.5, JSON.stringify({ 箭头中心: midArrow, 两板中点: midBoards }));
      check(`${w}：★ 整排卡片自己也是屏幕居中（左 ${L.x} / 右余 ${Math.round((g.clientW - R.r) * 10) / 10}）`,
        near(L.x, g.clientW - R.r, 0.5), JSON.stringify({ 左边距: L.x, 右边距: Math.round((g.clientW - R.r) * 10) / 10 }));
    }

    if (g.singleCol) {
      /* 单列：两张大板上下排（顶底当然不齐），每张卡都该是整列宽、左边全一样 */
      const all = [g.announce, g.liyutang, g.cal, g.ice, g.daily, g.cistern, g.placeholder, g.farland].filter(Boolean);
      check(`${w}：单列时每张卡左边对齐、一样宽`,
        all.every((c) => near(c.x, L.x, 1) && near(c.w, L.w, 1)),
        JSON.stringify(all.map((c) => [c.x, c.w])));
      check(`${w}：单列时两张大板上下排、不并排`, g.boards[1].y > g.boards[0].b - 1, `${g.boards[0].b} → ${g.boards[1].y}`);
      continue;
    }

    check(`${w}：两边大板顶边 / 底边齐（${L.y} / ${L.b}）`, near(L.y, R.y) && near(L.b, R.b), JSON.stringify({ 左: [L.y, L.b], 右: [R.y, R.b] }));

    /* 列边界由大板定 */
    check(`${w}：左列卡（公告 / 水钟 / 终池）左右边跟大板一致`,
      [g.announce, g.cal, g.cistern].every((c) => c && near(c.x, L.x) && near(c.r, L.r)),
      JSON.stringify({ 板: [L.x, L.r], 公告: g.announce && [g.announce.x, g.announce.r], 水钟: g.cal && [g.cal.x, g.cal.r], 终池: g.cistern && [g.cistern.x, g.cistern.r] }));

    /*
      右列 2026-11-20 起是两张整格 + 两张半格：
        整格（精华大殿 / 黎语堂）右边贴大板右边；
        半格那一对（冰室冰山 / 花娅远位面，在第三行）占满整格宽、左边贴大板左边。
      （原来第三行是「预留卡 + 花娅远位面」，站长把冰室冰山挪到预留卡那一格了。）
    */
    check(`${w}：右列整格卡右边跟大板一致`,
      [g.liyutang, g.daily].every((c) => c && near(c.r, R.r)),
      JSON.stringify({ 板右: R.r, 黎语堂: g.liyutang && g.liyutang.r, 精华: g.daily && g.daily.r }));
    check(`${w}：右列那一对（冰山 / 远位面）左边贴大板左边`,
      g.ice && near(g.ice.x, R.x),
      JSON.stringify({ 板左: R.x, 冰山: g.ice && g.ice.x }));
    check(`${w}：右列那一对两张一样宽、合起来正好铺满一列`,
      g.ice && g.farland && near(g.ice.w, g.farland.w, 1) && near(g.farland.r, R.r),
      JSON.stringify({ 冰山: g.ice && g.ice.w, 远位面: g.farland && g.farland.w, 右: g.farland && g.farland.r, 板右: R.r }));

    const g1 = g.announce ? Math.round((g.announce.y - L.b) * 10) / 10 : null;
    const g2 = g.cal && g.announce ? Math.round((g.cal.y - g.announce.b) * 10) / 10 : null;
    const g3 = g.cistern && g.cal ? Math.round((g.cistern.y - g.cal.b) * 10) / 10 : null;
    check(`${w}：行缝一样宽（${g1} / ${g2} / ${g3}）`,
      g1 !== null && g2 !== null && g3 !== null && Math.abs(g1 - g2) <= 1 && Math.abs(g2 - g3) <= 1,
      JSON.stringify({ 板到第一行: g1, 第一行到第二行: g2, 第二行到第三行: g3 }));

    const leftBottom = g.cistern?.b;
    const rightBottom = g.farland?.b;
    check(`${w}：两列的**最后一行底边齐平**（${leftBottom} / ${rightBottom}）`,
      near(leftBottom, rightBottom, 1), JSON.stringify({ 左: leftBottom, 右: rightBottom }));
  }
} catch (err) {
  fail++;
  console.log('FAIL  半路炸了：' + (err?.message || err));
} finally {
  console.log(`\n================ 结果 ================`);
  console.log(`PASS ${pass} / FAIL ${fail}`);
  try { chrome.kill(); } catch { /* 忽略 */ }
  try { server.close(); } catch { /* 忽略 */ }
  process.exit(fail ? 1 : 0);
}
