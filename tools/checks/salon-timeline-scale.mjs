/*
 * 检查：冰室精华页那条"常驻"时间轴里，底部的比例尺还能不能用。
 * （这条轴现在是**编辑器里选的那条已有的时间轴原样放上去**的，比例尺是它自己的设置 ——
 *  花娅年代记没写 tickDays，走默认档 1 格 ≈ 19 天。要确认的是：尺子还在、滑块还能拖、
 *  拖了整条轴会重画、而且没被挤出面板。）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const ROOT = path.resolve(process.argv[2]);
const PORT = 4381;
const DEBUG_PORT = 9362;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
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
    if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream' }); return fs.createReadStream(f).pipe(res); }
  }
  res.writeHead(404); res.end('404');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const profile = path.join(process.env.TEMP ?? '.', `dsh-scale-${Date.now()}`);
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
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/salon/` });
  for (let i = 0; i < 100; i++) { await sleep(120); if ((await cdp.ev('document.readyState')) === 'complete') break; }
  await sleep(2800);

  const before = await cdp.ev(`(() => {
    const panel = document.querySelector('.tl__panel').getBoundingClientRect();
    const rail = document.querySelector('[data-tl-rail]');
    const knob = document.querySelector('[data-tl-knob]');
    const val = document.querySelector('[data-tl-scaleval]');
    const r = rail ? rail.getBoundingClientRect() : null;
    const k = knob ? knob.getBoundingClientRect() : null;
    return {
      panelRect: { l: Math.round(panel.left), t: Math.round(panel.top), r: Math.round(panel.right), b: Math.round(panel.bottom) },
      rail: r ? { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null,
      knob: k ? { x: Math.round(k.left + k.width / 2), y: Math.round(k.top + k.height / 2), w: Math.round(k.width) } : null,
      value: val ? val.textContent.trim() : null,
      railInsidePanel: r ? r.left >= panel.left - 1 && r.right <= panel.right + 1 && r.bottom <= panel.bottom + 1 : null,
      knobVisible: k ? k.width > 0 && k.top > 0 : null,
      arc: (document.querySelector('[data-tl-arc]') || {}).getAttribute ? document.querySelector('[data-tl-arc]').getAttribute('d').slice(0, 30) : null,
    };
  })()`);
  const daysOf = (s) => {
    const m = String(s || '').match(/≈\s*([\d.]+)\s*天/);
    return m ? Number(m[1]) : NaN;
  };
  check('常驻轴里比例尺还在、且没被挤出面板', !!before.rail && before.railInsidePanel === true && before.knobVisible === true, JSON.stringify(before));
  check('比例尺用**所选那条时间轴自己的**设置（花娅年代记没写 tickDays → 默认档 1 格 ≈ 19 天）',
    Number.isFinite(daysOf(before.value)) && daysOf(before.value) === 19 && String(before.scaleSrc ?? before.value).length > 0,
    JSON.stringify({ value: before.value, 期望: 19 }));

  // 把滑块拖到右边（一刻度更多天 → 轴缩起来）
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: before.knob.x, y: before.knob.y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: before.knob.x, y: before.knob.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: before.knob.x + ((before.rail.l + before.rail.w - 6 - before.knob.x) * i) / 10, y: before.knob.y, button: 'left', buttons: 1 });
    await sleep(40);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: before.rail.l + before.rail.w - 6, y: before.knob.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(900);
  const after = await cdp.ev(`(() => ({
    value: (document.querySelector('[data-tl-scaleval]') || {}).textContent || '',
    knobX: Math.round(document.querySelector('[data-tl-knob]').getBoundingClientRect().left),
    arc: document.querySelector('[data-tl-arc]').getAttribute('d').slice(0, 30),
  }))()`);
  check('拖比例尺滑块：刻度值跟着变（2 天 → 几百天）', daysOf(after.value) > 100 && daysOf(after.value) !== daysOf(before.value), JSON.stringify({ before: before.value, after: after.value }));
  check('弧线跟着重画（不是冻住的）', after.arc !== before.arc, JSON.stringify({ before: before.arc, after: after.arc }));
  check('这趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));
} catch (err) {
  fail++;
  console.log('FAIL  脚本异常: ' + (err?.stack ?? err));
} finally {
  try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  server.close(); await sleep(250);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
