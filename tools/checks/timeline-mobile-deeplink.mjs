/*
 * 回归：本轮改了 Timeline.astro（加了 pinned 常驻模式），确认之前那两件事没被弄坏：
 *   ① 手机端"点一下先看信息、再点一下才跳"
 *   ② 深链接落点（#标题 / #块）停在吸顶页头下面
 * 只读站点产物，不写任何数据。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const ROOT = path.resolve(process.argv[2]);
const PORT = 4388;
const DEBUG_PORT = 9355;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
    const f = path.join(ROOT, t);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream' });
      return fs.createReadStream(f).pipe(res);
    }
  }
  res.writeHead(404);
  res.end('404');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = path.join(process.env.TEMP ?? '.', `dsh-reg-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' ')); }); }
  static async attach(u) { const ws = new WebSocket(u); await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('ws')), { once: true }); }); return new CDP(ws); }
  send(m, p = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method: m, params: p })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  async ev(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? '')); return r.result.value; }
  async goto(p, wait = 1500) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 120; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
  }
  async tap(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(350);
  }
}

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) { await sleep(300); try { const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json(); target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl); } catch {} }
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });

  /* ---------- ① 手机端两下 ---------- */
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.goto('/huaya/', 2200);

  // 打开面板并把带链接的那个点滚进视野
  await cdp.ev(`document.querySelector('[data-tl-toggle]')?.click()`);
  await sleep(800);
  const ready = await cdp.ev(`(() => {
    const item = document.querySelector('[data-tl-item][data-href]');
    const body = document.querySelector('[data-tl-body]');
    if (!item || !body) return { ok: false };
    for (let i = 0; i < 6; i++) {
      const b = body.getBoundingClientRect(); const r = item.getBoundingClientRect();
      const cy = r.top + r.height / 2;
      if (cy > b.top + 30 && cy < b.bottom - 30) break;
      body.dispatchEvent(new WheelEvent('wheel', { deltaY: cy - (b.top + b.height / 2), bubbles: true, cancelable: true }));
    }
    const crane = item.querySelector('.tl__crane');
    const r = crane.getBoundingClientRect();
    window.__taps = [];
    document.addEventListener('click', (e) => {
      if (!window.__rec) return;
      window.__rec.push({ prevented: e.defaultPrevented, onCard: !!(e.target.closest && e.target.closest('.tl__tipOpen')) });
      e.preventDefault();
    }, false);
    window.__rec = [];
    return { ok: true, href: item.dataset.href, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  check('手机端：找得到带链接的时间点（塔吊）', ready.ok, JSON.stringify(ready));

  await cdp.tap(ready.x, ready.y);
  const tap1 = await cdp.ev(`(() => ({ taps: window.__rec, open: !!document.querySelector('[data-tl-item].is-open'), tip: (() => { const t = document.querySelector('[data-tl-item].is-open .tl__tip'); if (!t) return null; const cs = getComputedStyle(t); const r = t.getBoundingClientRect(); return { visibility: cs.visibility, opacity: cs.opacity, inView: r.top > 0 && r.bottom < innerHeight + 1 }; })() }))()`);
  check('手机端：第一下拦住跳转 + 亮出提示卡', tap1.taps.length === 1 && tap1.taps[0].prevented === true && tap1.open === true && tap1.tip?.visibility === 'visible', JSON.stringify(tap1));

  const cardRect = await cdp.ev(`(() => { const a = document.querySelector('.tl__tipOpen'); if (!a) return null; const r = a.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await cdp.ev(`window.__rec = []; true`);
  await cdp.tap(cardRect.x, cardRect.y);
  const tap2 = await cdp.ev(`window.__rec`);
  check('手机端：对着卡片里的字再点一下 → 放行（这一下才是真跳）', tap2.length === 1 && tap2[0].prevented === false && tap2[0].onCard === true, JSON.stringify(tap2));

  await cdp.ev(`window.__rec = null; true`);
  await cdp.tap(cardRect.x, cardRect.y);
  await sleep(1500);
  const landed = await cdp.ev(`(() => { const el = document.getElementById('桑芙'); const r = el ? el.getBoundingClientRect() : null; return { path: location.pathname, hash: decodeURIComponent(location.hash), top: r ? Math.round(r.top) : null, anim: el ? getComputedStyle(el).animationName : null }; })()`);
  check('手机端：真跳到了冰室页的 #桑芙，且落在页头下面', landed.hash === '#桑芙' && landed.top > 40 && landed.top < 200, JSON.stringify(landed));
  check('手机端两下这条路 JS 没报错', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));

  /* ---------- ② 深链接落点 ---------- */
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const block = String.raw`blk-huaya-hishitsu-pmu2l5iyf1`;
  await cdp.goto(`/huaya/bingshi/#${block}`, 1500);
  const deep = await cdp.ev(`(() => { const el = document.getElementById(${JSON.stringify(block)}); if (!el) return { ok: false }; const r = el.getBoundingClientRect(); return { ok: true, top: Math.round(r.top), anim: getComputedStyle(el).animationName }; })()`);
  check('深链接：落到块上、停在吸顶页头下面（40~200px）', deep.ok && deep.top > 40 && deep.top < 200 && String(deep.anim).includes('pblockHit'), JSON.stringify(deep));
  check('深链接这趟 JS 没报错', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));
} catch (err) {
  fail++;
  console.log('FAIL  脚本异常: ' + (err?.stack ?? err));
} finally {
  try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  server.close();
  await sleep(250);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
