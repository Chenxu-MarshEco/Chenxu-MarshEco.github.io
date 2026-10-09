/*
 * ============================================================================
 * 背景柔和化：静态规矩 + 闪烁强度测量
 * ----------------------------------------------------------------------------
 * 用户原话：「让背景的失真效果柔和一些 有群友反馈瞎眼」。
 *
 * 这条分两段：
 *   ① **静态**（不启动浏览器，几毫秒）：钉住那几个"别再调回去"的参数值。
 *      2026-10-10 实测：扫描线 1.5s→6s、雪花 0.9s/0.16→3.6s/0.07、雪花爆发峰值 0.46→0.2、
 *      撕裂 0.44/0.33/0.58s→2.2/2.8/2.5s、撕裂峰值 1.0→0.35、亮带 7.3s→12s(0.55)、
 *      栅格 6.4s→11s、亮度闪 1.0→0.35。
 *   ② **测量**（要一个无头浏览器）：同页连拍 5 张（间隔 160ms），在页面里逐像素比相邻帧、
 *      取平均差（0~255，越大越晃）。改之前 3.39、改之后 1.59 —— 门槛定 2.4，
 *      谁再把哪一层调急，这条就会红。
 *
 * 用法：
 *   node tools/checks/crt-softness-check.mjs           # 两段都跑
 *   node tools/checks/crt-softness-check.mjs --static  # 只跑静态（不启动浏览器）
 * ============================================================================
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const SRC = String.raw`D:\曼沫砾总线\Chenxu-MarshEco.github.io`;
const ROOT = path.join(SRC, 'dist');
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const DEBUG_PORT = 9408;
const PAGE = process.argv.find((a) => a.startsWith('/')) || '/liyutang/';
const staticOnly = process.argv.includes('--static');
const FRAME_DIFF_MAX = 2.4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};

/* ============================================================ ① 静态 */

console.log('=== ① 静态：那几层"别调回去"的参数 ===');
const css = fs.readFileSync(path.join(SRC, 'src', 'styles', 'crt.css'), 'utf8');
const has = (re, why) => check(why, re.test(css));
has(/--scan-speed:\s*6s/, '扫描线放慢到 6s（原来是 1.5s，整屏像在闪）');
has(/opacity:\s*0\.07;[\s\S]{0,80}crt-snow-jitter 3\.6s steps\(4/, '雪花：压到 0.07、放慢到 3.6s 抖 4 下');
has(/crt-tear-shake 2\.2s/, '撕裂带 a 放慢到 2.2s');
has(/animation-duration:\s*2\.8s, 19s/, '撕裂带 b 放慢到 2.8s');
has(/animation-duration:\s*2\.5s, 29s/, '撕裂带 c 放慢到 2.5s');
has(/translate3d\(-5px, 0, 0\)/, '撕裂位移收到 ±5px（原来 ±9px）');
has(/animation: crt-bar 12s linear infinite/, '滚动亮带放慢到 12s');
has(/crt-grid-run 11s/, '透视栅格放慢到 11s');
check('雪花爆发峰值 ≤ 0.2（原来 0.46）', /89% \{\s*opacity:\s*0\.2;/.test(css));
check('撕裂出现时峰值 ≤ 0.35（原来 1.0）', /94% \{\s*opacity:\s*0\.35;/.test(css));
check('亮度闪峰值 ≤ 0.35（原来整屏白闪 1.0）', /90\.6% \{\s*[\s\S]{0,140}opacity:\s*0\.35;/.test(css));

if (staticOnly) {
  console.log(`\n==== ${pass} passed, ${fail} failed（--static：没启动浏览器）====`);
  process.exit(fail ? 1 : 0);
}

/* ============================================================ ② 测量 */

console.log('\n=== ② 测量：帧间平均差（0~255，越大越晃）===');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8' };
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
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const profile = path.join(process.env.TEMP ?? '.', `dsh-crtsoft-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
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
      ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
}

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {
      /* 等 */
    }
  }
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${PAGE}` });
  await sleep(2500);

  const shots = [];
  for (let i = 0; i < 5; i += 1) {
    const s = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    shots.push(s.data);
    await sleep(160);
  }
  const diff = await cdp.ev(`(async () => {
    const shots = ${JSON.stringify(shots)};
    const load = (b64) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = 'data:image/png;base64,' + b64; });
    const imgs = [];
    for (const b of shots) imgs.push(await load(b));
    const w = Math.round(imgs[0].width / 4), h = Math.round(imgs[0].height / 4);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    const datas = [];
    for (const im of imgs) { cx.clearRect(0, 0, w, h); cx.drawImage(im, 0, 0, w, h); datas.push(cx.getImageData(0, 0, w, h).data); }
    const out = [];
    for (let k = 1; k < datas.length; k += 1) {
      const a = datas[k - 1], b = datas[k];
      let sum = 0;
      for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]) + Math.abs(a[i+1] - b[i+1]) + Math.abs(a[i+2] - b[i+2]);
      out.push(Math.round((sum / (a.length / 4) / 3) * 100) / 100);
    }
    return out;
  })()`);
  const avg = diff.reduce((a, b) => a + b, 0) / diff.length;
  console.log(`     页面 ${PAGE}：帧间平均差 ${avg.toFixed(2)}（逐对 ${diff.join(', ')}）`);
  check(`★ 闪烁强度在门槛内（< ${FRAME_DIFF_MAX}；柔和化之前是 3.39、之后 1.59）`, avg < FRAME_DIFF_MAX, avg.toFixed(2));
} catch (err) {
  fail++;
  console.log('FAIL ' + (err?.stack ?? err));
} finally {
  try {
    execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' });
  } catch {
    /* 已退 */
  }
  server.close();
  await sleep(200);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
