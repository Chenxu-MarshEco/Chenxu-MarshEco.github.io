/*
 * 「本地预览和正式推流比例完全一样」的验收 —— 把**同一份源码**的两条路并排量一遍。
 *
 * 为什么要有这一条（站长 2026-11-21）：
 *   「本地预览网站里的所有页面相比正式网站都被压小了 …… 请保证本地预览和正式推流比例完全一样
 *    方便我判断 但是修的时候千万不要动已经推上去的网站比例」
 *
 * 站点有两条路会被人当成"网站"：
 *   ① 正式推流：GitHub Actions 上 `astro build` 出来的静态产物（dist/）；
 *   ② 本地预览：编辑器「看效果」起的 `astro dev`（127.0.0.1:4321）。
 * 这一条就把两边**同时**打开、同样的视口、同样的页面，量同一批元素的尺寸：
 * 只要全部相等（±1px），"比例不一样"就只可能来自浏览器自己的缩放（每个站点单独记的那个
 * Ctrl +/- 档位），不可能是站点的样式/布局。
 *
 * 用法：node tools/checks/preview-parity.mjs [dist目录]
 *   dist 缺了会先提示构建（不自己构建：构建要跑图片管线，几分钟）。
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { chromePath } from './lib/chrome.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
const DIST_PORT = 4730;
const DEV_PORT = 4731;
const DEBUG_PORT = 9530;
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
  console.error(`找不到 ${path.join(root, 'index.html')} —— 先构建：node node_modules/astro/bin/astro.mjs build`);
  process.exit(2);
}

/* ---------------- 两个服务：静态产物 + astro dev ---------------- */
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
await new Promise((r) => server.listen(DIST_PORT, '127.0.0.1', r));

/*
 * 本地预览那一边优先用**已经在跑的那个**（编辑器「看效果」起的 127.0.0.1:4321）——
 * Astro 7 不许同一个项目起第二个 dev（会报 "Another astro dev server is already running"），
 * 而拿站长正在用的那一个来比，正好就是他眼睛看到的那个。
 * 没有在跑的才自己起一个（4731），起完自己收掉。
 */
const probe = async (url) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
};

let devBase = '';
let dev = null;
if (await probe('http://127.0.0.1:4321/')) {
  devBase = 'http://127.0.0.1:4321';
  console.log('      · 本地预览用的是编辑器那个（127.0.0.1:4321）');
} else {
  dev = spawn(
    process.execPath,
    [path.join('node_modules', 'astro', 'bin', 'astro.mjs'), 'dev', '--host', '127.0.0.1', '--port', String(DEV_PORT)],
    { cwd: process.cwd(), stdio: 'ignore', windowsHide: true },
  );
  for (let i = 0; i < 120 && !devBase; i += 1) {
    await sleep(500);
    if (await probe(`http://127.0.0.1:${DEV_PORT}/`)) devBase = `http://127.0.0.1:${DEV_PORT}`;
  }
  if (devBase) console.log(`      · 本地预览是这一趟自己起的（127.0.0.1:${DEV_PORT}）`);
}
check('本地预览那条路连得上（编辑器 4321 或这一趟自己起的 dev）', !!devBase, devBase || '两条都没起来');

/* ---------------- 浏览器 ---------------- */
const profile = path.join(process.env.TEMP ?? '.', `dsh-parity-${Date.now()}`);
const chrome = spawn(
  chromePath(),
  ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
   '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' },
);

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

/** 量一页：容器宽、页头高、以及这一页自己的几个地标（尺寸 + 字号） */
const MEASURE = `(() => {
  const round = (n) => Math.round(n * 10) / 10;
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: round(r.width), h: round(r.height) };
  };
  const font = (el) => (el ? getComputedStyle(el).fontSize : '');
  const container = document.querySelector('.site-main > .container');
  return {
    vw: innerWidth,
    docW: document.documentElement.clientWidth,
    containerW: box(container)?.w ?? 0,
    headerH: box(document.querySelector('.site-header'))?.h ?? 0,
    h1: { ...(box(document.querySelector('h1')) || {}), font: font(document.querySelector('h1')) },
    ann: box(document.querySelector('.ann')),
    album: box(document.querySelector('.palbum__img')),
    feedItem: box(document.querySelector('.feed__item')),
    feedSide: box(document.querySelector('.feeds__side')),
    salonItem: box(document.querySelector('.salon__item')),
    salonSide: box(document.querySelector('.salon__side')),
  };
})()`;

const PAGES = [
  { url: '/', wait: 2600 },
  { url: '/huaya/bingshi/photo/20261001/', wait: 1800 },
  { url: '/feed/', wait: 2600 },
  { url: '/salon/', wait: 2600 },
];
const SIZES = [
  { w: 1440, h: 900 },
  { w: 1024, h: 800 },
  { w: 390, h: 844 },
];

const openAndMeasure = async (base, page, size) => {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: size.w, height: size.h, deviceScaleFactor: 1, mobile: size.w < 500,
  });
  await cdp.send('Page.navigate', { url: `${base}${page.url}` });
  for (let i = 0; i < 160; i++) { await sleep(120); try { if ((await cdp.ev('document.readyState')) === 'complete') break; } catch { /* nav */ } }
  await sleep(page.wait);
  return cdp.ev(MEASURE);
};

try {
  for (const size of SIZES) {
    for (const page of PAGES) {
      const dist = await openAndMeasure(`http://127.0.0.1:${DIST_PORT}`, page, size);
      const devm = await openAndMeasure(devBase, page, size);
      const keys = Object.keys(dist).filter((k) => {
        const v = dist[k];
        if (v === null || v === undefined) return false;
        if (typeof v === 'object') return Object.values(v).every((x) => typeof x === 'number' || x === '');
        return true;
      });
      const diffs = [];
      for (const k of keys) {
        const a = dist[k];
        const b = devm[k];
        if (typeof a === 'object') {
          for (const kk of Object.keys(a)) {
            if (typeof a[kk] === 'number' && Math.abs(a[kk] - (b?.[kk] ?? -1e9)) > 1) diffs.push(`${k}.${kk}: ${a[kk]} vs ${b?.[kk]}`);
            else if (typeof a[kk] === 'string' && a[kk] !== b?.[kk]) diffs.push(`${k}.${kk}: ${a[kk]} vs ${b?.[kk]}`);
          }
        } else if (typeof a === 'number') {
          if (Math.abs(a - (b ?? -1e9)) > 1) diffs.push(`${k}: ${a} vs ${b}`);
        } else if (a !== b) diffs.push(`${k}: ${a} vs ${b}`);
      }
      check(`★ ${size.w}px ｜ ${page.url} 本地预览与产物**逐像素同比例**（容器 / 页头 / 字号 / 地标）`,
        diffs.length === 0, diffs.slice(0, 4).join('；') || '完全一致');
    }
  }
} catch (err) {
  fail += 1;
  console.log(`FAIL  ★ 脚本自己炸了：${err?.message || err}`);
} finally {
  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  try { chrome.kill(); } catch { /* 已退 */ }
  try { dev?.kill(); } catch { /* 已退 */ }
  server.close();
  await sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}
process.exit(fail ? 1 : 0);
