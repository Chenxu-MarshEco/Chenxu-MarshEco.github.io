/*
 * 无障碍小体检：新加/改动的页面上，每个可点元素是不是都有"能被读屏念出来的名字"。
 * 只看几条最要命的（链接/按钮没有可访问名 = 读屏只会念"链接"），不追求全量审计。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const ROOT = path.resolve(process.argv[2]);
const PORT = 4383;
const DEBUG_PORT = 9360;
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

const profile = path.join(process.env.TEMP ?? '.', `dsh-a11y-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } }); }
  static async attach(u) { const ws = new WebSocket(u); await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('ws')), { once: true }); }); return new CDP(ws); }
  send(m, p = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method: m, params: p })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  async ev(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? '')); return r.result.value; }
}

const CHECK = `(() => {
  const nameOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const t = (el.textContent || '').trim();
    if (t) return t.slice(0, 24);
    const img = el.querySelector('img[alt]');
    if (img && img.getAttribute('alt').trim()) return img.getAttribute('alt').trim();
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    return '';
  };
  const bad = [];
  for (const el of document.querySelectorAll('a[href], button')) {
    if (el.closest('[hidden]')) continue;
    if (el.getAttribute('aria-hidden') === 'true') continue;
    if (!nameOf(el)) bad.push({ tag: el.tagName, cls: String(el.className).slice(0, 40), href: el.getAttribute('href') || '' });
  }
  return { total: document.querySelectorAll('a[href], button').length, bad: bad.slice(0, 6) };
})()`;

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) { await sleep(300); try { const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json(); target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl); } catch {} }
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  let total = 0;
  for (const p of ['/', '/salon/', '/about-me/', '/iceberg/', '/huaya/']) {
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 80; i++) { await sleep(120); if ((await cdp.ev('document.readyState')) === 'complete') break; }
    await sleep(p === '/salon/' ? 1500 : 800);
    const r = await cdp.ev(CHECK);
    total += r.bad.length;
    console.log(`${p}  可点元素 ${r.total} 个，没有可访问名的 ${r.bad.length} 个`);
    for (const b of r.bad) console.log(`     <${b.tag.toLowerCase()} class="${b.cls}" href="${b.href}">`);
  }
  console.log(total ? `\n✗ 共 ${total} 处没有可访问名` : '\n✓ 全部可点元素都有可访问名');
  process.exitCode = total ? 1 : 0;
} catch (err) {
  console.log('FAIL  脚本异常: ' + (err?.stack ?? err));
  process.exitCode = 1;
} finally {
  try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  server.close();
  await sleep(250);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
