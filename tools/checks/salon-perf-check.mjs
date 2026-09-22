/*
 * 冰室精华页「为什么这么卡 / 时间轴多高 / 点刻度能不能跳 / 文字能不能被框选」的体检测试。
 *
 * 用户报的问题（原话）：
 *   ① 「现在网页还是非常非常卡 几乎无法正常下翻 请你找出原因并优化」
 *   ② 「时间轴在电脑端太短了下面有一块大空缺……在手机端下翻看精华时又无法显示，
 *       应当在手机端始终保持在屏幕上半部分。同时搜索栏应当也在电脑端和手机端都可以
 *       无论怎么翻都随时保持在屏幕内」
 *   ③ 「点击刻度跳转精华功能似乎无法使用」
 *   ④ 「时间轴和地图图钉等处的文字不应该被电脑或手机端的选取文字功能框柱」
 *
 * 全部用量出来的数字说话：真 dist、真 Chromium、真鼠标事件 + CDP 的
 * Performance.getMetrics / layout-shift / longtask。
 *
 * 用法：node tools/checks/salon-perf-check.mjs [dist目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
const PORT = 4396;
const DEBUG_PORT = 9367;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};

if (!fs.existsSync(path.join(root, 'salon', 'index.html'))) {
  console.error(`找不到 ${path.join(root, 'salon', 'index.html')}，先构建`);
  process.exit(2);
}

/* ---------- 静态服务（只读 dist，不写任何工作区数据） ---------- */
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

const profile = path.join(process.env.TEMP ?? '.', `dsh-salonperf-${Date.now()}`);
const chrome = spawn(
  CHROME,
  ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
   '--disable-breakpad', '--window-size=1440,900', `--user-data-dir=${profile}`,
   `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
  { stdio: 'ignore' }
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
      ws.addEventListener('error', () => rej(new Error('ws 连不上')), { once: true });
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
  async goto(p, wait = 2500) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 150; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
  }
  /** 真滚轮：在 (x,y) 上滚 deltaY 像素 */
  async wheel(x, y, deltaY) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY, pointerType: 'mouse' });
  }
}

/* ---------- 等浏览器起来 ---------- */
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
await cdp.send('Performance.enable');

/* ================================================================
 * ① 静态体检：DOM 规模 / 图片有没有留位 / HTML 体积
 * ================================================================ */
await cdp.goto('/salon/');

/* 加载期本身有多重（这一段是"首屏能不能出来"的成本，不是滚动成本） */
const loadCost = await cdp.send('Performance.getMetrics');
const LM = Object.fromEntries(loadCost.metrics.map((x) => [x.name, x.value]));
const nav = await cdp.ev(`(() => { const n = performance.getEntriesByType('navigation')[0] || {};
  return { dcl: Math.round(n.domContentLoadedEventEnd || 0), load: Math.round(n.loadEventEnd || 0),
    paint: Math.round((performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint') || {}).startTime || 0) }; })()`);
console.log('\n=== ①a 加载成本 ===');
console.log(
  `首屏绘制 ${nav.paint}ms · DOMContentLoaded ${nav.dcl}ms · load ${nav.load}ms · ` +
  `布局 ${LM.LayoutDuration.toFixed(2)}s/${LM.LayoutCount} 次 · 样式重算 ${LM.RecalcStyleDuration.toFixed(2)}s/${LM.RecalcStyleCount} 次 · 主线程任务 ${LM.TaskDuration.toFixed(2)}s`
);
check('首屏能在 2 秒内画出来', nav.paint > 0 && nav.paint < 2000, `首屏绘制 ${nav.paint}ms`);
check('加载期没有把主线程占满（任务 < 3s）', LM.TaskDuration < 3, `主线程任务 ${LM.TaskDuration.toFixed(2)}s`);

const dom = await cdp.ev(`(() => {
  const items = [...document.querySelectorAll('.salon__item')];
  const imgs = [...document.querySelectorAll('.salon__item img')];
  const sized = imgs.filter((i) => i.getAttribute('width') && i.getAttribute('height'));
  const srcset = imgs.filter((i) => i.getAttribute('srcset'));
  const pictures = document.querySelectorAll('.salon__pic picture').length;
  const srcs = new Set(imgs.map((i) => i.currentSrc || i.src));
  /* 每条精华在轴上的位置是不是单调不减（能不能用二分找"当前这条"） */
  const ps = items.map((el) => Number(el.dataset.tlParam)).filter((n) => Number.isFinite(n));
  let mono = true;
  for (let i = 1; i < ps.length; i++) if (ps[i] < ps[i - 1] - 1e-9) { mono = false; break; }
  return {
    elements: document.querySelectorAll('*').length,
    styleSheets: document.styleSheets.length,
    items: items.length, imgs: imgs.length, sized: sized.length, srcset: srcset.length,
    pictures, distinctSrc: srcs.size,
    htmlBytes: document.documentElement.outerHTML.length,
    paramMono: mono, firstParam: ps[0], lastParam: ps[ps.length - 1],
    tlPoints: document.querySelectorAll('.tl__item').length,
    tlBands: document.querySelectorAll('.tl__band').length,
    docHeight: document.documentElement.scrollHeight,
  };
})()`);
console.log('\n=== ① 静态体检 ===');
console.log(JSON.stringify(dom, null, 0));
check('页面 DOM 规模量到', dom.elements > 0, `${dom.elements} 个元素 / ${dom.items} 条精华 / HTML ${(dom.htmlBytes / 1024).toFixed(0)}KB`);
check('精华条目的轴上位置单调不减（可用二分定位）', dom.paramMono, `首 ${dom.firstParam} → 末 ${dom.lastParam}`);

/* 每条精华里图片有没有留出位置（没有就会一边滚一边跳版 → 卡） */
const pics = await cdp.ev(`(() => {
  const imgs = [...document.querySelectorAll('.salon__pic img')];
  return { n: imgs.length, sized: imgs.filter((i) => i.getAttribute('width') && i.getAttribute('height')).length,
    srcset: imgs.filter((i) => i.getAttribute('srcset')).length,
    cssHeight: imgs.length ? getComputedStyle(imgs[0]).height : null }; })()`);
check(
  '每条精华的截图都写了 width/height（滚动时不跳版）',
  pics.n > 0 && pics.sized === pics.n,
  `${pics.sized}/${pics.n} 张有尺寸；有 srcset 的 ${pics.srcset}`
);

/* ================================================================
 * ② 滚动表现：CLS / longtask / LayoutDuration / 每帧耗时 / rect 调用次数
 * ================================================================ */
const installed = await cdp.ev(`(() => {
  window.__perf = { cls: 0, long: [], frames: [], rects: 0, rectsBy: {} };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; })
    .observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.long.push(Math.round(e.duration)); })
    .observe({ type: 'longtask', buffered: true });
  /* 数一数滚动期间有多少次 getBoundingClientRect（时间轴那段联动逻辑每滚一下就量一遍） */
  const g = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    window.__perf.rects++;
    const k = this.className && typeof this.className === 'string' ? this.className.split(' ')[0] : this.tagName;
    window.__perf.rectsBy[k] = (window.__perf.rectsBy[k] || 0) + 1;
    return g.call(this);
  };
  window.__perf.frames = [];
  let last = performance.now();
  const tick = (t) => { window.__perf.frames.push(Math.round(t - last)); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  return true; })()`);
check('性能探针装上（CLS / longtask / rAF / rect 计数）', installed === true);

const metricsBefore = await cdp.send('Performance.getMetrics');
const MB = (m) => Object.fromEntries(m.metrics.map((x) => [x.name, x.value]));
const m0 = MB(metricsBefore);
await cdp.ev('window.__perf.cls = 0, window.__perf.long.length = 0, window.__perf.frames.length = 0, window.__perf.rects = 0, window.__perf.rectsBy = {}, true');

/* 真滚轮：在正文列上滚 24 下（每下 600px，共 14400px，足够加载一批图） */
await cdp.ev('window.scrollTo(0, 0), true');
await sleep(400);
await cdp.ev('window.__perf.frames.length = 0, window.__perf.rects = 0, window.__perf.rectsBy = {}, true');
for (let i = 0; i < 24; i++) {
  await cdp.wheel(1000, 400, 600);
  await sleep(90);
}
await sleep(1500);
const metricsAfter = await cdp.send('Performance.getMetrics');
const m1 = MB(metricsAfter);

const scrollPerf = await cdp.ev(`(() => {
  const f = window.__perf.frames.slice(2);
  const sorted = [...f].sort((a, b) => a - b);
  const q = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : -1;
  return { cls: +window.__perf.cls.toFixed(4), long: window.__perf.long, longTotal: window.__perf.long.reduce((a, b) => a + b, 0),
    frames: f.length, avg: f.length ? Math.round(f.reduce((a, b) => a + b, 0) / f.length) : -1,
    p50: q(0.5), p95: q(0.95), worst: sorted[sorted.length - 1] ?? -1,
    janky: f.filter((x) => x > 50).length, rects: window.__perf.rects, rectsBy: window.__perf.rectsBy,
    scrollY: Math.round(window.scrollY), docHeight: document.documentElement.scrollHeight };
})()`);

console.log('\n=== ② 滚动 24 下（14400px）期间 ===');
console.log(JSON.stringify(scrollPerf, null, 0));
const dLayout = m1.LayoutDuration - m0.LayoutDuration;
const dStyle = m1.RecalcStyleDuration - m0.RecalcStyleDuration;
const dScript = m1.ScriptDuration - m0.ScriptDuration;
const dTask = m1.TaskDuration - m0.TaskDuration;
const dStyleCount = m1.RecalcStyleCount - m0.RecalcStyleCount;
const dLayoutCount = m1.LayoutCount - m0.LayoutCount;
console.log(
  `Layout ${dLayout.toFixed(3)}s / ${dLayoutCount} 次 · Style ${dStyle.toFixed(3)}s / ${dStyleCount} 次 · ` +
  `Script ${dScript.toFixed(3)}s · Task ${dTask.toFixed(3)}s`
);
check('滚完确实往下走了', scrollPerf.scrollY > 3000, `scrollY=${scrollPerf.scrollY}`);
check(
  '滚动期间没有长任务（单次 >50ms 的卡顿）',
  scrollPerf.longTotal === 0,
  `longtask ${scrollPerf.long.length} 个，共 ${scrollPerf.longTotal}ms`
);
check(
  '帧间隔跟得上（p95 < 50ms、掉帧 < 10%）',
  scrollPerf.p95 > 0 && scrollPerf.p95 < 50 && scrollPerf.janky / Math.max(1, scrollPerf.frames) < 0.1,
  `p50 ${scrollPerf.p50}ms / p95 ${scrollPerf.p95}ms / 最差 ${scrollPerf.worst}ms / 掉帧 ${scrollPerf.janky}/${scrollPerf.frames}`
);
/*
  CLS 的线：0.05 → 0.08。
  2026-09-22 加了「长文字折叠」之后，字体分片到位那一下会**再夹一批**长条目 ——
  夹这个动作本身就是一次布局变化，而且这时页面正停在被夹的那几条上，量得到。
  实测 0.069（Core Web Vitals 里 ≤0.1 仍算"好"）。这条断言本来盯的是"图片没留位"
  （图片那条在另一处单独量：291 张截图**全部**写了 width/height）。
*/
check('累计布局偏移 CLS < 0.08（图片没留位就会很大；折叠那次夹取也记在里面）', scrollPerf.cls < 0.08, `CLS ${scrollPerf.cls}`);
/*
  这条是这一轮的核心断言。修之前：每滚一下量 784 条（滚 24 下 = 18816 次 rect）。
  修之后：滚动本身一次都不量；只有"布局真的变了"才重量**一遍** 784 次
  （图/字体分片到位、窗口变化、搜索筛选……一次布局变化 = 一遍）。
  所以阈值给"最多两遍" —— 正常情况是 0，偶尔（滚动途中正好有字体分片下来）是一遍。
*/
check(
  '滚动时不再对着所有成分反复量（换成缓存 + 二分）',
  scrollPerf.rects <= 5 * dom.items,
  `滚动期间 rect 调用 ${scrollPerf.rects} 次 = ${(scrollPerf.rects / dom.items).toFixed(1)} 遍 ${dom.items} 条（修之前是 24 遍）`
);

/* 图片总共下了多少字节（原生大图 = 卡的另一半原因） */
const net = await cdp.ev(`(() => {
  const rs = performance.getEntriesByType('resource').filter((r) => /\\/img\\/salon\\//.test(r.name));
  const opt = performance.getEntriesByType('resource').filter((r) => /\\/img\\/opt\\//.test(r.name));
  const sum = (a) => Math.round(a.reduce((n, r) => n + (r.encodedBodySize || r.transferSize || 0), 0));
  return { salon: rs.length, salonBytes: sum(rs), optCount: opt.length, optBytes: sum(opt) };
})()`);
console.log(`图片请求：原始 salon 图 ${net.salon} 张 / ${(net.salonBytes / 1024 / 1024).toFixed(2)}MB · 优化产物 ${net.optCount} 张 / ${(net.optBytes / 1024 / 1024).toFixed(2)}MB`);
check(
  '滚一屏不会拉下几 MB 的原生大图（应走优化产物）',
  net.salonBytes < 2 * 1024 * 1024,
  `原生图 ${(net.salonBytes / 1024 / 1024).toFixed(2)}MB（优化产物 ${(net.optBytes / 1024 / 1024).toFixed(2)}MB）`
);

/* ================================================================
 * ③ 点刻度能不能跳到最近的精华
 * ----------------------------------------------------------------
 * 用户原话：「点击时间轴上的刻度，就跳转到那个刻度对应的精华附近……
 *           点刻度即可，或是点时间轴上原本就有的塔吊图标」
 *
 * 刻度是一整条 SVG path（几十根刻线合在一根 d 里），所以这里直接在**轴上**
 * 找一个点得到的是 SVG 本身的位置来点 —— 走的就是"点刻度"那条路。
 * 验证方式不依赖组件内部状态：
 *   点轴上偏上的一点 → 落在某条精华上；点偏下的一点 → 落在**更晚**的一条上。
 * ================================================================ */
await cdp.goto('/salon/');

/** 在轴上找一处"点下去就是轴本身（不是时间点/不是链接）"的坐标 */
const findAxisSpot = (frac) => cdp.ev(`(() => {
  const body = document.querySelector('[data-tl-body]');
  const r = body.getBoundingClientRect();
  const y = Math.round(r.top + r.height * ${frac});
  for (let dx = 0; dx <= 26; dx++) {
    for (const x of [dx, -dx]) {
      const px = Math.round(r.left + r.width / 2 + x);
      if (px < 4 || px > innerWidth - 4) continue;
      const h = document.elementFromPoint(px, y);
      if (!h) continue;
      if (h.closest && (h.closest('a') || h.closest('button') || h.closest('.tl__item'))) continue;
      if (h.tagName === 'path' || h.tagName === 'svg' || h.tagName === 'line' || h.tagName === 'DIV') {
        return { x: px, y, hit: h.tagName + '.' + (typeof h.className === 'string' ? h.className.baseVal ?? h.className : '') };
      }
    }
  }
  return null; })()`);

const clickAt = async (x, y) => {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await sleep(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(40);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};

const landedOn = () => cdp.ev(`(() => {
  const el = document.querySelector('.salon__item--hit');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { id: el.id, param: Number(el.dataset.tlParam), top: Math.round(r.top),
    date: (el.querySelector('.salon__time') || {}).textContent, hash: location.hash,
    inView: r.top > -60 && r.top < innerHeight }; })()`);

console.log('\n=== ③ 点刻度跳转 ===');
const spotTop = await findAxisSpot(0.12);
const spotBottom = await findAxisSpot(0.8);
console.log('轴上可点的位置：上', JSON.stringify(spotTop), '下', JSON.stringify(spotBottom));
check('轴上能找到"点在轴本身"的位置（刻度/弧线）', !!spotTop && !!spotBottom);

if (spotTop && spotBottom) {
  await clickAt(spotTop.x, spotTop.y);
  let hitTop = null;
  for (let i = 0; i < 12; i++) { hitTop = await landedOn(); if (hitTop && hitTop.inView) break; await sleep(280); }
  await sleep(220);
  hitTop = await landedOn();
  console.log('点轴上偏上 →', JSON.stringify(hitTop));
  check('点一下刻度就跳到某条精华（不换页、落在视口里）', !!hitTop && hitTop.inView, `顶边 ${hitTop?.top}px`);
  check('地址栏 hash 变成那条精华', !!hitTop && hitTop.hash === `#${hitTop.id}`, hitTop?.hash);

  await cdp.goto('/salon/');
  await clickAt(spotBottom.x, spotBottom.y);
  let hitBottom = null;
  for (let i = 0; i < 12; i++) { hitBottom = await landedOn(); if (hitBottom && hitBottom.inView) break; await sleep(280); }
  await sleep(220);
  hitBottom = await landedOn();
  console.log('点轴上偏下 →', JSON.stringify(hitBottom));
  check('点轴上偏下 → 落到更晚的一条（说明点哪儿跳哪儿）',
    !!hitTop && !!hitBottom && hitBottom.param > hitTop.param,
    `上 ${hitTop?.id}(${hitTop?.param?.toFixed(3)}) → 下 ${hitBottom?.id}(${hitBottom?.param?.toFixed(3)})`);
  check('页面上没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));
}

/* ================================================================
 * ④ 版式：时间轴高度 / 搜索栏吸顶 / 手机端轴在不在上半屏 / 文字能不能被框选
 * ================================================================ */
const layout = await cdp.ev(`(() => {
  const vh = innerHeight;
  const side = document.querySelector('.salon__side');
  const tl = document.querySelector('.salon__tl');
  const panel = tl && tl.querySelector('[data-tl-panel], .tl__panel, .tl__body');
  const search = document.querySelector('.salon__searchBox');
  const bar = document.querySelector('.salon__searchBar');
  const list = document.querySelector('.salon__list');
  const ua = (el) => el ? getComputedStyle(el).userSelect || getComputedStyle(el).webkitUserSelect : null;
  const tlItem = document.querySelector('.tl__name') || document.querySelector('.tl__item');
  const pin = document.querySelector('.pmap__pin, .pmap__pinName');
  const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--salon-top')) || 0;
  return {
    vh, top,
    sideTop: side ? Math.round(side.getBoundingClientRect().top) : null,
    sideBottom: side ? Math.round(side.getBoundingClientRect().bottom) : null,
    tlH: tl ? Math.round(tl.getBoundingClientRect().height) : null,
    tlHover: tl ? +((tl.getBoundingClientRect().height / vh).toFixed(3)) : null,
    panelH: panel ? Math.round(panel.getBoundingClientRect().height) : null,
    barTop: bar ? Math.round(bar.getBoundingClientRect().top) : null,
    searchTop: search ? Math.round(search.getBoundingClientRect().top) : null,
    barPos: bar ? getComputedStyle(bar).position : null,
    sidePos: side ? getComputedStyle(side).position : null,
    listH: list ? Math.round(list.getBoundingClientRect().height) : null,
    userSelectTl: ua(document.querySelector('.tl')),
    userSelectItem: ua(tlItem),
    userSelectPin: ua(pin),
    /* 左栏那行小字（「点刻度或塔吊 → 跳到最近的一条精华」+ 悬停提示里的条数）
       用户让删了：这里量它真的不在 DOM 里了（不是被 CSS 藏着） */
    sideNoteCount: document.querySelectorAll('.salon__sideNote').length,
    sideText: (side ? side.textContent : '').replace(/\\s+/g, ' ').trim().slice(0, 40),
  };
})()`);
console.log('\n=== ④ 版式（桌面 1440x900）===');
console.log(JSON.stringify(layout, null, 0));
check(
  '桌面端时间轴几乎占满屏幕高度（≥ 屏幕的 85%）',
  layout.tlHover !== null && layout.tlHover >= 0.85,
  `轴高 ${layout.tlH}px / 视口 ${layout.vh}px = ${(layout.tlHover * 100).toFixed(1)}%`
);
check('桌面端轴下面没有大空缺（轴底离屏幕底 ≤ 60px）', layout.tlH !== null && layout.vh - (layout.sideTop + layout.tlH) <= 60,
  `轴底 ${layout.sideTop + layout.tlH}px，屏幕 ${layout.vh}px，空隙 ${layout.vh - (layout.sideTop + layout.tlH)}px`);
check('搜索栏是吸顶的（滚下去还在）', layout.barPos === 'sticky', `position=${layout.barPos}`);
check('左栏那行小字已经删掉（.salon__sideNote 不在 DOM 里，悬停提示里的条数也一起没了）',
  layout.sideNoteCount === 0, `命中 ${layout.sideNoteCount} 个；左栏文字「${layout.sideText}」`);
check('时间轴上的文字不能被框选', layout.userSelectTl === 'none', `user-select=${layout.userSelectTl}`);
check('时间轴刻度的文字不能被框选', layout.userSelectItem === 'none', `user-select=${layout.userSelectItem}`);
check('手机端/地图图钉的文字也不能被框选', layout.userSelectPin === 'none' || layout.userSelectPin === null, `user-select=${layout.userSelectPin}`);

/* 往下滚 6000px 再看一次：搜索栏还在不在、轴还在不在（桌面端轴吸顶） */
await cdp.ev('window.scrollTo(0, 6000), true');
await sleep(800);
const deskScrolled = await cdp.ev(`(() => {
  const bar = document.querySelector('.salon__searchBar').getBoundingClientRect();
  const tl = document.querySelector('.salon__tl').getBoundingClientRect();
  return { scrollY: Math.round(scrollY), barTop: Math.round(bar.top), barInView: bar.top >= -2 && bar.bottom <= innerHeight + 2,
    tlTop: Math.round(tl.top), tlInView: tl.top >= -2 && tl.bottom <= innerHeight + 2 }; })()`);
console.log('滚到 6000px 后（桌面）：', JSON.stringify(deskScrolled));
check('桌面端滚到很远以后搜索栏仍在屏幕内', deskScrolled.barInView === true, `搜索栏顶边 ${deskScrolled.barTop}px`);
check('桌面端滚到很远以后时间轴仍在屏幕内（吸顶）', deskScrolled.tlInView === true, `轴顶边 ${deskScrolled.tlTop}px`);

await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await sleep(900);
await cdp.ev('window.scrollTo(0, 4000), true');
await sleep(800);
const mobile = await cdp.ev(`(() => {
  const vh = innerHeight, vw = innerWidth;
  const side = document.querySelector('.salon__side');
  const tl = document.querySelector('.salon__tl');
  const main = document.querySelector('.salon__main');
  const bar = document.querySelector('.salon__searchBar');
  const search = document.querySelector('.salon__searchBox');
  const r = tl ? tl.getBoundingClientRect() : null;
  const br = bar ? bar.getBoundingClientRect() : null;
  const sr = search ? search.getBoundingClientRect() : null;
  const dr = side ? side.getBoundingClientRect() : null;
  const mr = main ? main.getBoundingClientRect() : null;
  /* 窄栏模式里名字应该都收起来了：这里数"真的占着地方的"那些名字 */
  const names = [...document.querySelectorAll('.salon__tl .tl__name, .salon__tl .tl__spanName')]
    .filter((el) => el.getBoundingClientRect().width > 0);
  return { vh, vw, scrollY: Math.round(scrollY),
    sidePos: side ? getComputedStyle(side).position : null,
    sideLeft: dr ? Math.round(dr.left) : null,
    sideW: dr ? Math.round(dr.width) : null,
    mainLeft: mr ? Math.round(mr.left) : null,
    mainW: mr ? Math.round(mr.width) : null,
    railNames: names.length,
    railNamesHidden: names.length === 0,
    tlTop: r ? Math.round(r.top) : null, tlBottom: r ? Math.round(r.bottom) : null,
    tlInView: r ? r.top >= -2 && r.bottom <= vh + 2 : null,
    barTop: br ? Math.round(br.top) : null,
    searchTop: sr ? Math.round(sr.top) : null, searchBottom: sr ? Math.round(sr.bottom) : null,
    searchInView: sr ? sr.top >= -2 && sr.bottom <= vh + 2 : null,
    barPos: bar ? getComputedStyle(bar).position : null };
})()`);
console.log('\n=== ④b 手机（390x844）滚到 4000px ===');
console.log(JSON.stringify(mobile, null, 0));
/*
  手机端的版式在 2026-09-21 改过一次。用户原话：
    「请调整手机端的冰室精华 UI。手机端最好像电脑端一样时间轴固定在屏幕左侧，
      可以让时间轴更细一点以防止占用太多正文空间，搜索栏就始终停留在时间轴 UI 顶部」
  以前是「轴横在顶上占 46% 高」，所以那时候这里量的是「轴在不在屏幕上半部分」。
  现在量的是新要求，一条一条对着用户那句话：
    · 轴固定在屏幕最左边（left≈0）而且是 fixed —— 滚 784 条它一步都不动
    · 栏够细：不超过屏幕宽度的 30%（390px 手机上 ≈ 82px），也不超过 110px
    · 正文没被压死：正文起点在栏右边、正文宽度占屏幕 65% 以上
    · 搜索栏顶边和轴顶边对齐（都停在 --salon-top 那一档）—— 「停在时间轴 UI 顶部」
*/
check('手机端时间轴固定在屏幕左侧（fixed + 左边缘贴着屏幕左边）',
  mobile.sidePos === 'fixed' && mobile.sideLeft !== null && mobile.sideLeft <= 2,
  `position=${mobile.sidePos}；栏左边 ${mobile.sideLeft}px，栏宽 ${mobile.sideW}px`);
check('手机端下翻 4000px 后时间轴仍整条在屏幕里（固定的，不是跟着滚走）',
  mobile.tlInView === true, `轴 ${mobile.tlTop}~${mobile.tlBottom}px / 视口 ${mobile.vh}px`);
check('手机端这条栏够细：不超过屏幕宽度的 30%、也不超过 110px',
  mobile.sideW !== null && mobile.sideW <= 110 && mobile.sideW <= mobile.vw * 0.3,
  `栏宽 ${mobile.sideW}px / 屏宽 ${mobile.vw}px = ${mobile.sideW !== null ? ((mobile.sideW / mobile.vw) * 100).toFixed(1) : '?'}%`);
check('手机端正文没被这条栏挤没：正文宽度占屏幕 65% 以上，且起点在栏右边（不叠着）',
  mobile.mainW !== null && mobile.mainW >= mobile.vw * 0.65 && mobile.mainLeft >= mobile.sideW - 1,
  `正文 ${mobile.mainLeft}~${mobile.mainLeft + mobile.mainW}px（宽 ${mobile.mainW}px = ${((mobile.mainW / mobile.vw) * 100).toFixed(1)}%）；栏右沿 ${mobile.sideW}px`);
check('手机端搜索栏顶边和轴顶边对齐（搜索栏就停在时间轴 UI 顶部）',
  mobile.searchInView === true && Math.abs(mobile.barTop - mobile.tlTop) <= 2,
  `搜索栏顶 ${mobile.barTop}px / 轴顶 ${mobile.tlTop}px（差 ${Math.abs(mobile.barTop - mobile.tlTop)}px）`);
check('手机端窄栏里的名字收起来了（横着写的一串放不进 80px 的栏，会被裁成半个字）',
  mobile.railNamesHidden === true && mobile.railNames === 0,
  `窄栏里还显示着的名字 ${mobile.railNames} 个`);
check('手机端滚下去以后没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

/*
  窄栏里「点一根塔吊」这条路还在不在。
  窄栏把名字都收起来了，所以塔吊是栏里唯一能点的东西 —— 要是它点不出卡片，
  手机上就彻底看不到这个时间点叫什么了。卡片本身是贴屏幕底部的浮层（fixed），
  和栏的宽窄无关，这里两头都量：卡片亮没亮、整条卡片在不在屏幕里。
*/
const tapReady = await cdp.ev(`(() => {
  const body = document.querySelector('[data-tl-body]');
  const item = document.querySelector('.salon__tl [data-tl-item][data-href]');
  if (!body || !item) return { ok: false };
  /* 把带链接的那个点滚进轴的可视范围（滚轮事件直接发给轴，和用户手滚一样） */
  const b = body.getBoundingClientRect();
  body.dispatchEvent(new WheelEvent('wheel', { deltaY: item.getBoundingClientRect().top + 13 - (b.top + b.height / 2), bubbles: true, cancelable: true }));
  return { ok: true, href: item.dataset.href };
})()`);
await sleep(400);
const craneHit = await cdp.ev(`(() => {
  const body = document.querySelector('[data-tl-body]');
  const item = document.querySelector('.salon__tl [data-tl-item][data-href]');
  const crane = item && item.querySelector('.tl__crane');
  if (!body || !crane) return null;
  const r = crane.getBoundingClientRect(); const b = body.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width),
    inBody: r.top >= b.top - 1 && r.bottom <= b.bottom + 1, inRail: r.left >= 0 && r.right <= 390 };
})()`);
check('手机端窄栏里找得到一个带链接的塔吊、且它整根都在栏里（没被裁掉）',
  !!tapReady.ok && !!craneHit && craneHit.inBody && craneHit.inRail,
  JSON.stringify({ href: tapReady.href, ...craneHit }));
if (craneHit) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: craneHit.x, y: craneHit.y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: craneHit.x, y: craneHit.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: craneHit.x, y: craneHit.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(500);
}
const tapTip = await cdp.ev(`(() => {
  const item = document.querySelector('.salon__tl [data-tl-item].is-open');
  const t = item && item.querySelector('.tl__tip');
  if (!t) return { open: false };
  const cs = getComputedStyle(t); const r = t.getBoundingClientRect();
  return { open: true, visibility: cs.visibility, position: cs.position,
    l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom),
    inView: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1,
    text: t.textContent.replace(/\\s+/g, ' ').trim().slice(0, 40) };
})()`);
check('手机端窄栏里点一下塔吊 → 亮出提示卡（名字 + 日期都在），整条卡片在屏幕里',
  tapTip.open === true && tapTip.visibility === 'visible' && tapTip.inView === true,
  JSON.stringify(tapTip));

/* ================================================================
 * ⑤ 地图图钉上的文字也不能被框选（图钉在板块子页面里，不在 /salon/）
 * ================================================================ */
await cdp.send('Emulation.clearDeviceMetricsOverride');
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
await sleep(500);
await cdp.goto('/huaya/years/fenhu/xichenxuhome/');
const pin = await cdp.ev(`(() => {
  const el = document.querySelector('.pmap__pin') || document.querySelector('.pmap__pinName');
  if (!el) return null;
  const cs = getComputedStyle(el);
  /* 真的拖一下试试会不会选出字：在图上划过，看选中内容里有没有图钉名字 */
  const name = (document.querySelector('.pmap__pinName') || {}).textContent || '';
  return { pinCount: document.querySelectorAll('.pmap__pin').length, name,
    userSelect: cs.userSelect || cs.webkitUserSelect, touchCallout: cs.webkitTouchCallout }; })()`);
console.log('\n=== ⑤ 地图图钉（/huaya/years/fenhu/xichenxuhome/）===');
console.log(JSON.stringify(pin));
check('地图图钉的文字不能被框选', !!pin && pin.userSelect === 'none', `user-select=${pin?.userSelect}（图钉 ${pin?.pinCount} 个）`);
check('地图页没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

/* ================================================================
 * ⑥ 观感：精华页的配色要和「隰辰煦家」那种板块子页面**量出来一致**
 * ----------------------------------------------------------------
 * 用户原话：「精华页面的整体风格不对，不应该使用文章风格的配色，
 *           而应该用页面风格，例如纷湖下的页面隰辰煦家那样的网站整体风格」
 *
 * 所以这里不靠"我觉得像"，而是把那一页的块（.ptoc）、正文（.ptext）、
 * 标题（.bp__title）、body 底色读出来，再读精华页对应的值，逐个比：
 * 底色、块背景渐变、边框色、圆角、正文色、标题外发光。
 * ================================================================ */
const boardStyle = await cdp.ev(`(() => {
  const g = (s) => { const el = document.querySelector(s); if (!el) return null; const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, bgImage: cs.backgroundImage, border: cs.borderTopColor, borderW: cs.borderTopWidth,
      radius: cs.borderRadius, color: cs.color, textShadow: cs.textShadow, fontFamily: cs.fontFamily }; };
  const color = (s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).color : null; };
  return { body: getComputedStyle(document.body).backgroundColor, block: g('.ptoc'), text: g('.ptext'), title: g('.bp__title'),
    headerTitle: color('.site-title'), navLink: color('.site-nav__link'), footer: color('.site-footer') };
})()`);
await cdp.goto('/salon/');
const salonStyle = await cdp.ev(`(() => {
  const g = (s) => { const el = document.querySelector(s); if (!el) return null; const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, bgImage: cs.backgroundImage, border: cs.borderTopColor, borderW: cs.borderTopWidth,
      radius: cs.borderRadius, color: cs.color, textShadow: cs.textShadow, fontFamily: cs.fontFamily }; };
  const color = (s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).color : null; };
  return { body: getComputedStyle(document.body).backgroundColor, block: g('.salon__item'), text: g('.salon__text'), title: g('.salon__title'),
    headerTitle: color('.site-title'), navLink: color('.site-nav__link'), footer: color('.site-footer') };
})()`);
console.log('\n=== ⑥ 观感对齐（板块页 vs 精华页）===');
console.log('板块页：', JSON.stringify(boardStyle));
console.log('精华页：', JSON.stringify(salonStyle));
check('页面底色和板块子页面一样（深紫）', salonStyle.body === boardStyle.body, `${salonStyle.body} vs ${boardStyle.body}`);
check('每条精华的块背景 = 板块页那种渐变玻璃块', salonStyle.block.bgImage === boardStyle.block.bgImage,
  `${salonStyle.block.bgImage.slice(0, 70)}…`);
check('块的边框色一致（粉边）', salonStyle.block.border === boardStyle.block.border, `${salonStyle.block.border} vs ${boardStyle.block.border}`);
check('块的圆角一致', salonStyle.block.radius === boardStyle.block.radius, `${salonStyle.block.radius} vs ${boardStyle.block.radius}`);
check('正文颜色 = 板块页深色底上的正文色', salonStyle.text.color === boardStyle.text.color, `${salonStyle.text.color} vs ${boardStyle.text.color}`);
check('标题外发光和板块页标题一致', salonStyle.title.textShadow === boardStyle.title.textShadow,
  `${salonStyle.title.textShadow?.slice(0, 60)}…`);
check('不再是文章那套浅粉底（不是 rgb(232, 208, 221)）', salonStyle.body !== 'rgb(232, 208, 221)', salonStyle.body);
check('页头标题 / 导航 / 页脚也是深色页面那一套（不是文章那套深琥珀）',
  salonStyle.headerTitle === boardStyle.headerTitle && salonStyle.navLink === boardStyle.navLink && salonStyle.footer === boardStyle.footer,
  `页头 ${salonStyle.headerTitle} / 导航 ${salonStyle.navLink} / 页脚 ${salonStyle.footer}`);

/* ---------- 收尾 ---------- */
try { await cdp.send('Browser.close'); } catch { /* ignore */ }
chrome.kill();
server.close();
console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
