/*
 * 检查：冰室精华页左边那条常驻时间轴，滚页面时会不会跟着走
 * （点日期能跳已经验过；这条是反方向：页面滚到哪，轴上的"当前"就移到哪）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const ROOT = path.resolve(process.argv[2]);
const PORT = 4389;
const DEBUG_PORT = 9354;
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

const profile = path.join(process.env.TEMP ?? '.', `dsh-sync-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' ')); }); }
  static async attach(u) { const ws = new WebSocket(u); await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('ws')), { once: true }); }); return new CDP(ws); }
  send(m, p = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method: m, params: p })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  async ev(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? '')); return r.result.value; }
}

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) { await sleep(300); try { const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json(); target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl); } catch {} }
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/salon/` });
  for (let i = 0; i < 120; i++) { await sleep(150); if ((await cdp.ev('document.readyState')) === 'complete') break; }
  await sleep(3000);

  const snap = () => cdp.ev(`(() => {
    const now = document.querySelector('[data-tl-nowdate]');
    const item = document.querySelector('.tl [data-tl-item][data-live]') || document.querySelector('.tl [data-tl-item]');
    const arc = document.querySelector('[data-tl-arc]');
    // 面板里"哪个日期离弧顶最近" —— 拿所有可见日期点的 y 和轴顶高度比一下
    const apexY = document.querySelector('[data-tl-body]') ? document.querySelector('[data-tl-body]').getBoundingClientRect().height / 2 : 0;
    const pts = [...document.querySelectorAll('.tl [data-tl-item]')].map((el) => ({ t: el.style.top, d: el.dataset.date || el.dataset.label })).filter((p) => p.t);
    const near = pts.map((p) => ({ ...p, y: parseFloat(p.t) })).sort((a, b) => Math.abs(a.y - apexY) - Math.abs(b.y - apexY))[0];
    const visible = [...document.querySelectorAll('#salon-list .salon__item')].filter((el) => { const r = el.getBoundingClientRect(); return r.top < innerHeight * 0.6 && r.bottom > innerHeight * 0.4; });
    return {
      scrollY: Math.round(scrollY),
      nowDate: now ? now.textContent.trim() : null,
      arcD: arc ? arc.getAttribute('d').slice(0, 40) : null,
      nearestDate: near ? near.d : null,
      nearestY: near ? Math.round(near.y) : null,
      apexY: Math.round(apexY),
      listMidDate: visible.length ? (visible[0].querySelector('.salon__time') || {}).textContent : null,
    };
  })()`);

  const a = await snap();
  console.log('起始：', JSON.stringify(a));

  // 滚到列表中间（大约 2025 年那一段）
  await cdp.ev(`(() => { const items = [...document.querySelectorAll('#salon-list .salon__item')]; const el = items[Math.floor(items.length * 0.62)]; el.scrollIntoView({ block: 'center', behavior: 'instant' }); return el.id; })()`);
  await sleep(1500);
  const b = await snap();
  console.log('滚到中间：', JSON.stringify(b));

  await cdp.ev(`(() => { const items = [...document.querySelectorAll('#salon-list .salon__item')]; const el = items[Math.floor(items.length * 0.95)]; el.scrollIntoView({ block: 'center', behavior: 'instant' }); return el.id; })()`);
  await sleep(1500);
  const c = await snap();
  console.log('滚到接近末尾：', JSON.stringify(c));

  const moved = a.nowDate !== b.nowDate || b.nowDate !== c.nowDate || a.nearestDate !== c.nearestDate;
  const ymd = (s) => (String(s || '').match(/\d{4}-\d{2}-\d{2}/) || [''])[0];
  check('滚页面时，左边那条轴上的"当前"跟着走（刻度在动）', moved, JSON.stringify({ start: a.nowDate, mid: b.nowDate, end: c.nowDate }));
  check(
    '滚到哪一段，轴上那个"当前日期"就是列表里的日期（两边对得上）',
    !!ymd(c.nowDate) && ymd(c.nowDate) === ymd(c.listMidDate),
    JSON.stringify({ axis: c.nowDate, list: c.listMidDate })
  );
  check(
    '轴真的跟着重画了（弧线 path 变了，不是冻住的）',
    a.arcD !== b.arcD && b.arcD !== c.arcD,
    JSON.stringify({ a: a.arcD, b: b.arcD, c: c.arcD })
  );
  check('这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));
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
