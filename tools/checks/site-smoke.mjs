/*
 * 全站体检：把 dist 里每个页面都在真浏览器里过一遍，看有没有被我这几轮改动弄坏的地方。
 *
 * 这一轮改了**全站共用**的东西（SiteHeader 加了「关于我」小圆片、Timeline 加了常驻模式、
 * index/sitemap/salon 等），所以光验新页面不够 —— 得逐页确认：
 *   · 每页都能正常打开、标题非空
 *   · 页头在、左上角小圆片在（它现在是全站的）
 *   · 没有横向溢出
 *   · **0 个 console error / 未捕获异常**
 *
 * 用法：node tools/checks/site-smoke.mjs <dist目录>
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const ROOT = path.resolve(process.argv[2] ?? 'dist');
const PORT = 4385;
const DEBUG_PORT = 9358;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.xml': 'application/xml; charset=utf-8', '.mp3': 'audio/mpeg' };

let pass = 0;
let fail = 0;

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

/* 收集要体检的页面（.prerender 里那些不是页面） */
const pages = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '.prerender' || e.name === '_astro' || e.name === 'img' || e.name === 'audio') continue;
      walk(p);
    } else if (e.name.endsWith('.html')) {
      const rel = path.relative(ROOT, p).split(path.sep).join('/');
      pages.push('/' + rel.replace(/index\.html$/, ''));
    }
  }
};
walk(ROOT);
pages.sort();
console.log(`要体检 ${pages.length} 个页面\n`);

const profile = path.join(process.env.TEMP ?? '.', `dsh-smoke-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') this.errors.push('exception: ' + (m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text)); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' ')); }); }
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

  for (const p of pages) {
    /*
      例外：`/secret/...` 是那种"整页自己一套"的彩蛋页（`弦宝vs傻雕像`），
      故意不带站点页头 / 右上角控件 / 左上角「关于我」小圆片 ——
      所以这几页只查"能打开、标题非空、不横向溢出、无报错"。
    */
    const barePage = p.startsWith('/secret/');
    cdp.errors = [];
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 60; i++) { await sleep(120); if ((await cdp.ev('document.readyState')) === 'complete') break; }
    await sleep(p === '/salon/' ? 1200 : 500);
    const info = await cdp.ev(`(() => ({
      title: document.title,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      header: !!document.querySelector('.site-header'),
      pill: (() => { const a = document.querySelector('.about-pill'); return a ? a.getAttribute('href') : null; })(),
      h1: document.querySelectorAll('h1').length,
    }))()`);
    const bad = [];
    if (!info.title) bad.push('标题空');
    if (!barePage && !info.header) bad.push('没有页头');
    if (!barePage && info.pill !== '/about-me/') bad.push('小圆片缺失或地址不对(' + info.pill + ')');
    if (info.overflow > 1) bad.push('横向溢出 ' + info.overflow + 'px');
    if (cdp.errors.length) bad.push(cdp.errors.slice(0, 2).join(' | '));
    if (bad.length) {
      fail++;
      console.log(`FAIL  ${p}   ${bad.join('；')}`);
    } else {
      pass++;
      console.log(`PASS  ${p}${barePage ? '  （彩蛋页：整页自带一套，不查站点外框）' : ''}`);
    }
  }
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
