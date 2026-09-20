/*
 * 补齐日历这一条的证据：
 *   ① 点特殊日子真的会跳到那天的事件页（之前只量了 href 属性，这里真点一下）
 *   ② 上/下月翻月对不对（翻到别的月就不该再有"今天"的光环）
 * 用副本 + 造一份带事件的数据，工作区不动。
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';

const SRC = String.raw`D:\曼沫砾总线\Chenxu-MarshEco.github.io`;
const DST = path.join(SRC, '.tmp', 'cal-proj');
const PORT = 4387;
const DEBUG_PORT = 9356;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};

/* ---------- 1. 造副本 + 带事件的数据 ---------- */
if (fs.existsSync(DST)) {
  for (const j of ['node_modules', 'public']) {
    const p = path.join(DST, j);
    if (fs.existsSync(p)) {
      try { execSync(`cmd /c rmdir "${p}"`, { stdio: 'ignore' }); } catch {}
    }
  }
  fs.rmSync(DST, { recursive: true, force: true });
}
const skip = new Set(['node_modules', 'public', 'dist', '.git', '.tmp']);
fs.mkdirSync(DST, { recursive: true });
for (const e of fs.readdirSync(SRC, { withFileTypes: true })) {
  if (skip.has(e.name)) continue;
  fs.cpSync(path.join(SRC, e.name), path.join(DST, e.name), { recursive: true });
}
execSync(`cmd /c mklink /J "${path.join(DST, 'node_modules')}" "${path.join(SRC, 'node_modules')}"`, { stdio: 'ignore' });
execSync(`cmd /c mklink /J "${path.join(DST, 'public')}" "${path.join(SRC, 'public')}"`, { stdio: 'ignore' });

const now = new Date();
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = ymd(now);
const w = JSON.parse(fs.readFileSync(path.join(DST, 'src', 'data', 'home-widgets.json'), 'utf8'));
w.calendar.events = { [today]: { title: '验收用的纪念日', href: '/salon/' } };
fs.writeFileSync(path.join(DST, 'src', 'data', 'home-widgets.json'), JSON.stringify(w, null, 2) + '\n', 'utf8');
execSync(`node "${path.join(SRC, 'node_modules', 'astro', 'bin', 'astro.mjs')}" build --root "${DST}"`, { stdio: 'ignore' });
console.log('副本 + 数据就绪，今天 =', today);

/* ---------- 2. 起静态服务 + 真浏览器 ---------- */
const ROOT = path.join(DST, 'dist');
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

const profile = path.join(process.env.TEMP ?? '.', `dsh-cal-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' ')); }); }
  static async attach(u) { const ws = new WebSocket(u); await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('ws')), { once: true }); }); return new CDP(ws); }
  send(m, p = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method: m, params: p })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  async ev(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? '')); return r.result.value; }
  async goto(p, wait = 1800) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 120; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
  }
}

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) { await sleep(300); try { const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json(); target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl); } catch {} }
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.goto('/');

  const hasEvent = await cdp.ev(`(() => { const a = document.querySelector('a.cal__day--event'); if (!a) return null; a.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = a.getBoundingClientRect(); return { href: a.getAttribute('href'), title: a.getAttribute('title'), x: r.left + r.width / 2, y: r.top + r.height / 2, inView: r.top > 0 && r.bottom < innerHeight }; })()`);
  check('日历：今天那个特殊日子是可点的链接（并已滚进视口）', !!hasEvent && hasEvent.href === '/salon/' && hasEvent.inView === true, JSON.stringify(hasEvent));

  // 真点一下（用 CDP 发真鼠标事件：合成的 element.click() 在 Chromium 里不会触发跨文档跳转）
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hasEvent.x, y: hasEvent.y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hasEvent.x, y: hasEvent.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hasEvent.x, y: hasEvent.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(2500);
  check('日历：点它真的跳到了那天的事件页', (await cdp.ev('location.pathname')) === '/salon/', await cdp.ev('location.pathname'));

  // 翻月
  await cdp.goto('/');
  const nav = await cdp.ev(`(async () => {
    const lab = () => (document.querySelector('.cal__month') || {}).textContent;
    const days = () => document.querySelectorAll('.cal__day').length;
    const todayCount = () => document.querySelectorAll('.cal__day--today').length;
    const evCount = () => document.querySelectorAll('.cal__day--event').length;
    const cur = lab();
    document.querySelector('[data-cal-prev]').click();
    await new Promise((r) => setTimeout(r, 300));
    const prev = { label: lab(), days: days(), today: todayCount(), events: evCount() };
    document.querySelector('[data-cal-next]').click();
    document.querySelector('[data-cal-next]').click();
    await new Promise((r) => setTimeout(r, 300));
    const next = { label: lab(), days: days(), today: todayCount(), events: evCount() };
    document.querySelector('[data-cal-prev]').click();
    await new Promise((r) => setTimeout(r, 300));
    const back = { label: lab(), days: days(), today: todayCount(), events: evCount() };
    return { cur, prev, next, back };
  })()`);
  const m = now.getMonth();
  const mName = (i) => `${now.getFullYear() + Math.floor(i / 12)} 年 ${(((i % 12) + 12) % 12) + 1} 月`;
  const dim = (i) => new Date(now.getFullYear(), (i % 12 + 12) % 12 + 1, 0).getDate();
  check('日历：点 ‹ 翻到上个月（月份标题 + 当月天数都对）', nav.prev.label === mName(m - 1) && nav.prev.days === dim(m - 1), JSON.stringify(nav.prev));
  check('日历：翻到别的月就不该再有"今天"的光环', nav.prev.today === 0 && nav.next.today === 0, JSON.stringify({ prevToday: nav.prev.today, nextToday: nav.next.today }));
  check('日历：点 › 翻到下个月、再点 ‹ 回到本月，今天的光环回来了', nav.next.label === mName(m + 1) && nav.next.days === dim(m + 1) && nav.back.label === mName(m) && nav.back.today === 1, JSON.stringify({ next: nav.next, back: nav.back }));
  check('日历：特殊日子只在当月那一格上（翻月不串）', nav.back.events === 1 && nav.next.events === 0 && nav.prev.events === 0, JSON.stringify({ cur: nav.cur.events, prev: nav.prev.events, next: nav.next.events, back: nav.back.events }));
  check('这趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));
} catch (err) {
  fail++;
  console.log('FAIL  脚本异常: ' + (err?.stack ?? err));
} finally {
  try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  server.close();
  await sleep(250);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  // 收拾副本：先摘 junction 再删
  for (const j of ['node_modules', 'public']) {
    const p = path.join(DST, j);
    if (fs.existsSync(p)) {
      try { execSync(`cmd /c rmdir "${p}"`, { stdio: 'ignore' }); } catch {}
    }
  }
  try { fs.rmSync(DST, { recursive: true, force: true }); } catch {}
  console.log('副本已清理:', !fs.existsSync(DST));
}
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
