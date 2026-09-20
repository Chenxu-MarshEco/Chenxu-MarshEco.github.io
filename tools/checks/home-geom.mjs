/*
 * 首页几何基线 / 对比。
 *
 * 用户明确要求："新增板块不要挤压或挪动原来已有的首页元素的位置"。
 * 所以在动手之前先把首页每个已有元素的位置量下来存成基线，
 * 改完再量一次逐项对比 —— 位置必须**一个像素都不变**。
 *
 * 用法：
 *   node home-geom.mjs <dist目录> --save .tmp/home-baseline.json
 *   node home-geom.mjs <dist目录> --compare .tmp/home-baseline.json
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const ROOT = path.resolve(process.argv[2] ?? '.');
const MODE = process.argv[3] ?? '--save';
const FILE = path.resolve(process.argv[4] ?? '.tmp/home-baseline.json');
const PORT = 4392;
const DEBUG_PORT = 9351;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

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

const profile = path.join(process.env.TEMP ?? '.', `dsh-geom-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } }); }
  static async attach(u) { const ws = new WebSocket(u); await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('ws')), { once: true }); }); return new CDP(ws); }
  send(m, p = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method: m, params: p })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  async ev(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? '')); return r.result.value; }
}

const MEASURE = `(() => {
  const sels = ['.site-brand', '.site-title', '.about-pill', '.brand', '.brand__logo', '.brand__title',
    '.boards', '.boards .board:nth-child(1)', '.boards .board:nth-child(2)',
    '.corner', '.vapor__sun', '.vapor__horizon', '.vapor__skyline', '.home', '.extras', '.cal', '.ice', '.daily'];
  const out = {};
  for (const s of sels) {
    const el = document.querySelector(s);
    if (!el) { out[s] = null; continue; }
    const r = el.getBoundingClientRect();
    out[s] = { x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  }
  return {
    at: new Date().toISOString().slice(0, 16),
    viewport: { w: innerWidth, h: innerHeight },
    scroll: { height: document.documentElement.scrollHeight, client: document.documentElement.clientHeight, canScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1 },
    rects: out,
  };
})()`;

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) { await sleep(300); try { const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json(); target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl); } catch {} }
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  for (let i = 0; i < 80; i++) { await sleep(150); if ((await cdp.ev('document.readyState')) === 'complete') break; }
  await sleep(2200);

  const now = await cdp.ev(MEASURE);
  if (MODE === '--save') {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(now, null, 2) + '\n', 'utf8');
    console.log('基线已存:', FILE);
    console.log(JSON.stringify(now, null, 1));
  } else {
    const base = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    console.log('对比（基线 ' + base.at + ' -> 现在 ' + now.at + '）\n');
    let moved = 0;
    const keys = new Set([...Object.keys(base.rects), ...Object.keys(now.rects)]);
    for (const k of keys) {
      const a = base.rects[k];
      const b = now.rects[k];
      if (!a && !b) continue;
      if (!a || !b) { console.log(`  ${k}: ${a ? '基线有、现在没有' : '新增（基线没有）'}  ${JSON.stringify(a ?? b)}`); continue; }
      const same = a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
      if (!same) { moved++; console.log(`  ✗ 动了 ${k}\n      基线 ${JSON.stringify(a)}\n      现在 ${JSON.stringify(b)}`); }
      else console.log(`  ✓ 没动 ${k}  ${JSON.stringify(b)}`);
    }
    console.log(`\n位置变了 ${moved} 项`);
    console.log(`页面高度: ${base.scroll.height} -> ${now.scroll.height}（可滚: ${base.scroll.canScroll} -> ${now.scroll.canScroll}）`);
  }
} finally {
  try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  server.close();
  await sleep(250);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
