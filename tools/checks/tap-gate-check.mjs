/*
 * 手机端「第一下只开浮卡、第二下才跳」的验收 —— 真产物、真服务端、真触屏事件。
 *
 * 站长 2026-11-21 的原话：
 *   「手机端想要点开精华和圣经详情时 点击一下虽然会弹出浮卡 但是同时也相当于单击了精华条目
 *    导致浏览器直接开始加载跳转到精华页面了 手机端所有有浮卡的应规定点击一下先不跳转出浮卡
 *    再点一下才跳转」
 *
 * 有浮卡的那几种（规则都在 src/scripts/tap-gate.ts）：
 *   ① 首页「每日精华」那张卡 → 第一下出浮卡，第二下才去 /salon/#那一条；
 *   ② 首页「每日圣经」那张卡 → 同上，第二下去 /bellie/#那一条；
 *   ③ 正文里的成员名 → 点一下名片浮出来，而且**不会自己缩回去**；
 *   ④ 正文里的悬停图（`[[文字|图片|链接]]`）→ 第一下只把图亮出来，第二下才跟着链接走。
 *
 * 判断"手机"用的是 `(hover: none)`（和 Timeline / 页面脚本同一个判据），
 * 所以这里开的是真触屏模拟（mobile + TouchEmulationEnabled），不是把窗口调窄。
 *
 * 用法：node tools/checks/tap-gate-check.mjs [dist目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromePath } from './lib/chrome.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
const PORT = 4720;
const DEBUG_PORT = 9520;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.gif': 'image/gif',
};
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`); };

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
  res.writeHead(404);
  res.end('404');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = path.join(process.env.TEMP ?? '.', `dsh-tapgate-${Date.now()}`);
const chrome = spawn(
  chromePath(),
  ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
   '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' },
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
      ws.addEventListener('error', () => rej(new Error('ws connect failed')), { once: true });
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
  async goto(p, wait = 2600) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 160; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
  }
  /** 真触屏点一下（Chrome 会照真机那样先 pointerover、再 click） */
  async tap(x, y, wait = 700) {
    await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await sleep(50);
    await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
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
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

const centerOf = (sel) => cdp.ev(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);

try {
  /* ---------------- ① 首页：每日精华 ---------------- */
  await cdp.goto('/', 3200);
  check('手机模拟里 (hover: none) 成立（"触屏"这件事才成立）', (await cdp.ev(`matchMedia('(hover: none)').matches`)) === true);
  const card = await centerOf('a.daily__card');
  check('首页那张每日精华卡找得到', !!card, JSON.stringify(card));
  if (card) {
    const before = await cdp.ev('location.pathname + location.hash');
    await cdp.tap(card.x, card.y);
    const first = await cdp.ev(`(() => {
      const r = document.querySelector('[data-daily]');
      const p = document.querySelector('.daily__pop--essence');
      const cs = p ? getComputedStyle(p) : null;
      return { url: location.pathname + location.hash, pop: r ? r.dataset.pop : '', opacity: cs ? Number(cs.opacity).toFixed(2) : '', vis: cs ? cs.visibility : '' };
    })()`);
    check('★ 精华卡第一下：只弹出浮卡、**没有**跳走（地址一动不动）',
      first.url === before && first.pop === 'essence' && Number(first.opacity) > 0.5 && first.vis === 'visible',
      JSON.stringify({ before, first }));
    await cdp.tap(card.x, card.y, 1500);
    const second = await cdp.ev('location.pathname + location.hash');
    check('★ 精华卡第二下：才跟着链接去 /salon/#那一条',
      second.startsWith('/salon/') && second.includes('#'), second);
  }

  /* ---------------- ② 首页：每日圣经 ---------------- */
  await cdp.goto('/', 3000);
  const bible = await centerOf('.daily__col--bible a.daily__card');
  check('首页那张每日圣经卡找得到', !!bible, JSON.stringify(bible));
  if (bible) {
    const before = await cdp.ev('location.pathname + location.hash');
    await cdp.tap(bible.x, bible.y);
    const first = await cdp.ev(`(() => {
      const r = document.querySelector('[data-daily]');
      const p = document.querySelector('.daily__pop--bible');
      const cs = p ? getComputedStyle(p) : null;
      return { url: location.pathname + location.hash, pop: r.dataset.pop, opacity: cs ? Number(cs.opacity).toFixed(2) : '' };
    })()`);
    check('★ 圣经卡第一下：只弹出浮卡、地址一动不动',
      first.url === before && first.pop === 'bible' && Number(first.opacity) > 0.5, JSON.stringify(first));
    await cdp.tap(bible.x, bible.y, 1500);
    const second = await cdp.ev('location.pathname + location.hash');
    check('★ 圣经卡第二下：才跳进 /bellie/#那一条', second.startsWith('/bellie/') && second.includes('#'), second);
  }

  /* ---------------- ③ 成员名：名片点一下就看得到、而且不自己缩回去 ---------------- */
  await cdp.goto('/salon/', 3200);
  const mem = await cdp.ev(`(() => {
    const el = document.querySelector('.mem');
    if (!el) return null;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    el.click();
    return true;
  })()`);
  await sleep(900);
  const memOpen = await cdp.ev(`(() => {
    const layer = document.querySelector('.memlayer');
    const card = layer ? layer.querySelector('.mem__card') : null;
    return { inLayer: !!card, name: card ? ((card.querySelector('.mem__label') || {}).textContent || '') : '' };
  })()`);
  check('★ 成员名点一下：名片浮出来，而且一秒钟后还开着（不靠 :hover 粘住）',
    mem === true && memOpen.inLayer === true && memOpen.name.length > 0, JSON.stringify(memOpen));

  /* ---------------- ④ 悬停图：第一下只亮图 ---------------- */
  await cdp.goto('/huaya/character/xichenxu/', 2600);
  const ph = await cdp.ev(`(() => {
    const a = document.querySelector('a.phover__label');
    if (!a) return null;
    const before = location.pathname + location.hash;
    a.click();
    return { before, href: a.getAttribute('href') };
  })()`);
  await sleep(600);
  const phFirst = await cdp.ev(`(() => {
    const el = document.querySelector('.phover.is-tapopen');
    const pop = el ? el.querySelector('.phover__pop') : null;
    const cs = pop ? getComputedStyle(pop) : null;
    return { url: location.pathname + location.hash, open: !!el, opacity: cs ? Number(cs.opacity).toFixed(2) : '', vis: cs ? cs.visibility : '' };
  })()`);
  check('★ 悬停图第一下：只把图亮出来、没有跳走',
    !!ph && phFirst.url === ph.before && phFirst.open === true && Number(phFirst.opacity) > 0.5 && phFirst.vis === 'visible',
    JSON.stringify(phFirst));
  const phSecond = await cdp.ev(`(() => {
    const a = document.querySelector('a.phover__label');
    if (!a) return null;
    const href = a.getAttribute('href');
    a.click();
    return href;
  })()`);
  await sleep(1500);
  const phUrl = await cdp.ev('location.pathname + location.hash');
  check('★ 悬停图第二下：才跟着链接走', !!phSecond && phUrl === phSecond, `${ph?.before} → ${phUrl}`);

  /* ---------------- ⑤ 电脑上不许被这道闸影响（鼠标一下就跳） ---------------- */
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'hover', value: 'hover' }, { name: 'pointer', value: 'fine' }] });
  await cdp.goto('/', 3000);
  const desktopHover = await cdp.ev(`matchMedia('(hover: none)').matches`);
  check('桌面（有悬停能力）上 (hover: none) 是假 —— 那道闸不会拦鼠标', desktopHover === false, String(desktopHover));

  check('整场没有脚本报错', cdp.errors.filter(Boolean).length === 0, cdp.errors.filter(Boolean).slice(0, 2).join(' | '));
} catch (err) {
  fail += 1;
  console.log(`FAIL  ★ 脚本自己炸了：${err?.message || err}`);
} finally {
  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  try { chrome.kill(); } catch { /* 已退 */ }
  server.close();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}
process.exit(fail ? 1 : 0);
