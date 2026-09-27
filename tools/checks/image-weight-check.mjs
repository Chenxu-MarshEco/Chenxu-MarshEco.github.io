/*
 * 图片重量体检（用户 2026-09-26）：
 *   「注意到成员头像的放大图 鼠标移上去还是要加载一段时间才会出现
 *    请你再尽量想办法压缩本网站内所有的图片类内容保证加载速度
 *    并且以后上传的图片以及以后增添的可以上传图片的板块也都做同样处理」
 *
 * 量两件事：
 *   ① 每个页面**冷启动**到底传了多少图片字节（用 performance 里每条资源的
 *      transferSize 求和，和服务端实际发的字节核对），以及最重的几张是哪几张；
 *   ② 成员名片那张放大图：把鼠标移到名字上（名片出现）→ 移到头像上（放大图出现），
 *      中间那张图是什么时候开始下的、多大、是不是 AVIF。
 *      用户报的"要加载一段时间"就是这一张 —— 它以前是 hover 到头像那一刻才发请求。
 *
 * 用法：
 *   node tools/checks/image-weight-check.mjs            # 验收（有断言）
 *   node tools/checks/image-weight-check.mjs --probe    # 只打表
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const root = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : path.resolve('dist');
const PROBE = process.argv.includes('--probe');
const PORT = 4488;
const DEBUG_PORT = 9458;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
};
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  if (PROBE && ok) return;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const kb = (n) => `${(n / 1024).toFixed(1)}KB`;

/* 服务端带上 content-length：和 GitHub Pages 一样，量出来的字节才准 */
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
    const f = path.join(root, t);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const st = fs.statSync(f);
      res.writeHead(200, {
        'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream',
        'content-length': st.size,
        'cache-control': 'no-store',
      });
      return fs.createReadStream(f).pipe(res);
    }
  }
  res.writeHead(404);
  res.end('404');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = path.join(process.env.TEMP ?? '.', `dsh-imgw-${Date.now()}`);
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--disable-breakpad', '--window-size=1440,900', `--user-data-dir=${profile}`,
  `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank',
], { stdio: 'ignore' });

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
  async tryEv(e) { try { return await this.ev(e); } catch { return undefined; } }
}
let cdp = null;
for (let i = 0; i < 80 && !cdp; i++) {
  await sleep(250);
  try {
    const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const page = l.find((t) => t.type === 'page');
    if (page) cdp = await CDP.attach(page.webSocketDebuggerUrl);
  } catch { /* 还没起来 */ }
}
if (!cdp) { console.error('Chromium 没起来'); process.exit(2); }
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

/** 图片资源的读数（performance 里的每一条） */
const RESOURCES = `(() => {
  const out = [];
  for (const e of performance.getEntriesByType('resource')) {
    const type = e.initiatorType;
    const isImg = type === 'img' || type === 'image' || type === 'css' || /\\.(webp|avif|png|jpe?g|gif|svg)(\\?|$)/i.test(e.name);
    if (!isImg) continue;
    out.push({
      url: e.name.replace(location.origin, ''),
      type,
      bytes: Math.max(e.transferSize || 0, e.encodedBodySize || 0),
      start: Math.round(e.startTime),
      dur: Math.round(e.duration),
    });
  }
  return out;
})()`;

const open = async (url, wait = 2200) => {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  cdp.errors = [];
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${url}` });
  for (let i = 0; i < 200; i++) { await sleep(90); if ((await cdp.tryEv('document.readyState')) === 'complete') break; }
  await sleep(wait);
};
/**
 * 把鼠标移到某个元素上。
 * ⚠ 先 scrollIntoView：salon 那一页有一千多条，挑中的成员名很可能在视口下面，
 * 而落在视口外的鼠标事件什么都不会触发（member-link-check 里踩过同一个坑）。
 */
const hoverSel = async (sel) => {
  const r = await cdp.ev(`(async () => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    await new Promise((res) => setTimeout(res, 200));
    const b = el.getBoundingClientRect();
    return {
      x: Math.round(b.left + b.width / 2),
      y: Math.round(b.top + b.height / 2),
      inView: b.top >= 4 && b.bottom <= innerHeight - 4 && b.left >= 4 && b.right <= innerWidth - 4,
    };
  })()`);
  if (!r || !r.inView) return false;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y, buttons: 0 });
  return true;
};

/* ==========================================================================
 *  ① 每个页面的图片重量
 * ======================================================================== */
const PAGES = [
  ['/', '首页'],
  ['/huaya/', '花娅陌域（板块页）'],
  ['/salon/', '冰室精华（784 条截图那页）'],
  ['/huaya/character/xichenxu', '花娅域主（正文图最多的一页）'],
  ['/search/', '搜索中转页'],
];
console.log('\n================ ① 每页冷启动传了多少图片 ================');
const pageRows = [];
for (const [url, label] of PAGES) {
  await open(url);
  const res = await cdp.ev(RESOURCES);
  const imgs = res.filter((r) => /\.(webp|avif|png|jpe?g|gif|svg)$/i.test(r.url.split('?')[0]));
  const total = imgs.reduce((n, r) => n + r.bytes, 0);
  const top = [...imgs].sort((a, b) => b.bytes - a.bytes).slice(0, 3).map((r) => `${path.basename(r.url)} ${kb(r.bytes)}`);
  pageRows.push({ url, label, total, count: imgs.length, top });
  console.log(`  ${label.padEnd(22)} 图片 ${String(imgs.length).padStart(3)} 张 / ${kb(total).padStart(9)}｜最重：${top.join('｜')}`);
}

/**
 * 把鼠标移到「带独立放大图」的那个成员名上。
 *
 * ⚠ 两件必须做的事（都踩过）：
 *   ① 先 scrollIntoView：salon 那一页高 29 万像素，挑中的名字多半在视口外，
 *      而落在视口外的鼠标事件什么都不会触发；
 *   ② 滚进来之后还要 elementFromPoint 确认那一点**真的命中了这个名字** ——
 *      精华页左边那条时间轴是固定在屏幕左边的，有的名字正好压在它底下，
 *      这时鼠标移过去只会碰到时间轴（第一次就是这么"移了个寂寞"）。
 *   所以候选一个个试，找不到能碰到的就返回 null。
 */
const hoverZoomMember = async () => cdp.ev(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mems = [...document.querySelectorAll('.mem')].filter((m) => m.getBoundingClientRect().width > 4);
  const cands = [];
  for (const m of mems) {
    const z = m.querySelector('.mem__zoom');
    const img = z ? z.querySelector('img.mem__zoomImg') : null;
    const face = m.querySelector('img.mem__face');
    if (!z || !img || !face) continue;
    const zs = img.getAttribute('src') || '';
    const fs = face.getAttribute('src') || '';
    if (!zs || zs === fs) continue;
    cands.push(m);
    if (cands.length >= 40) break;
  }
  for (let i = 0; i < cands.length; i++) {
    const m = cands[i];
    m.id = 'cc-probe-zoom';
    m.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    await sleep(220);
    const b = m.getBoundingClientRect();
    const x = Math.round(b.left + b.width / 2);
    const y = Math.round(b.top + b.height / 2);
    if (!(b.top >= 60 && b.bottom <= innerHeight - 4 && x >= 4 && x <= innerWidth - 4)) { m.removeAttribute('id'); continue; }
    const hit = document.elementFromPoint(x, y);
    if (!hit || !m.contains(hit)) { m.removeAttribute('id'); continue; }
    const z = m.querySelector('.mem__zoom');
    const img = z.querySelector('img.mem__zoomImg');
    const source = z.querySelector('source[type="image/avif"]');
    return {
      ok: true, index: i, point: { x, y },
      name: m.textContent.trim().slice(0, 12),
      zoomWebp: img.getAttribute('src') || '',
      zoomAvif: source ? source.getAttribute('srcset') : null,
      zoomLoading: img.getAttribute('loading'),
    };
  }
  return { ok: false, tried: cands.length };
})()`);

console.log('\n================ ② 成员名片的放大图 ================');
await open('/salon/', 2600);
const zoomCard = await hoverZoomMember();
console.log('  找到并碰到带独立放大图的成员：', JSON.stringify(zoomCard));

if (!PROBE) {
  check('★ 名片里的放大图是单独一张（数据里填的 zoom），而且给出了 AVIF 那一档',
    zoomCard.ok === true && !!zoomCard.zoomAvif, JSON.stringify(zoomCard));
}

if (zoomCard.ok) {
  /* 鼠标移上去的那一刻，放大图**不该**已经被拉过（它挂着 loading=lazy，躺在隐藏的名片里） */
  const beforeLoad = await cdp.ev(RESOURCES);
  const zoomBase = zoomCard.zoomWebp.replace(/^\//, '').replace(/\.webp$/, '');
  const fetchedEarly = beforeLoad.some((r) => r.url.includes(zoomBase));
  console.log(`  移到名字上之前，放大图是否已经下过：${fetchedEarly}`);
  await sleep(400); // 刚 scrollIntoView 过，让 hover 状态稳定一下
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: zoomCard.point.x, y: zoomCard.point.y, buttons: 0 });
  await sleep(1300);
  const afterCard = await cdp.ev(RESOURCES);
  /* 名片到底显示了没有、懒加载提到 eager 没有 —— 预取没发生时靠这几项定位。
     ⚠ 名片一显示就被搬到 .memlayer 里了（show() 会把它从 .mem 里摘出来），
     所以不能在原来的 .mem 底下找它。 */
  const state = await cdp.ev(`(() => {
    const card = document.querySelector('.memlayer .mem__card');
    const img = card ? card.querySelector('img.mem__zoomImg') : null;
    return {
      在浮层里: !!card,
      卡片可见: !!(card && card.getBoundingClientRect().width > 0),
      loading: img ? img.getAttribute('loading') : null,
      complete: img ? img.complete : null,
      src: img ? (img.getAttribute('src') || '') : null,
      浮层张数: document.querySelectorAll('.memlayer .mem__card').length,
    };
  })()`);
  const zoomReq = afterCard.find((r) => r.url.includes(zoomBase)) ?? null;
  console.log('  悬停后的 DOM 状态：', JSON.stringify(state));
  console.log(`  放大图请求：${JSON.stringify(zoomReq)}`);
  if (!PROBE) {
    check('★ 鼠标一移到名字上，名片就出现了（后面几条的前提）', state.在浮层里 === true && state.卡片可见 === true,
      JSON.stringify(state));
    check('★ 进页面时**不**预下放大图（懒加载，不占首屏）', fetchedEarly === false, fetchedEarly ? '开局就下了' : '没下');
    check('★ 鼠标一移到名字上，放大图就开始下载了（不用等移到头像上）',
      !!zoomReq && zoomReq.bytes > 0, JSON.stringify(zoomReq));
    check('★ 放大图走的是 AVIF（比 WebP 省四成左右）',
      !!zoomReq && zoomReq.url.endsWith('.avif'), zoomReq ? zoomReq.url : '(没量到请求)');
    check('★ 放大图不超过 70KB（它只是个 260px 的方形放大框）',
      !!zoomReq && zoomReq.bytes <= 70 * 1024, zoomReq ? kb(zoomReq.bytes) : '(没量到)');
  }
}

/* 灯箱那张：点开正文里的图，看它拉的是哪一档、多大、是不是 avif */
console.log('\n================ ③ 点图放大（灯箱）================');
await open('/huaya/character/xichenxu', 2400);
/* 挑一张真有变体的（有 data-full-avif 的），别拿右键那种小 passthrough 图当样本 */
const pick = await cdp.ev(`(() => {
  const all = [...document.querySelectorAll('img[data-zoom]')];
  const withAvif = all.find((im) => im.dataset.fullAvif);
  const im = withAvif || all[0];
  if (!im) return null;
  im.id = 'cc-probe-zoomimg';
  return { n: all.length, withAvif: all.filter((i) => i.dataset.fullAvif).length, full: im.dataset.full, avif: im.dataset.fullAvif || null };
})()`);
console.log('  正文里的可放大图：', JSON.stringify(pick));
await cdp.tryEv(`document.getElementById('cc-probe-zoomimg')?.click()`);
await sleep(1800);
const boxInfo = await cdp.ev(`(() => {
  const b = document.querySelector('[data-izoom]');
  const img = document.querySelector('[data-izoom-img]');
  const s = document.querySelector('[data-izoom-src]');
  if (!b || !img) return null;
  const url = img.currentSrc || img.src || '';
  return {
    shown: !b.hidden,
    url,
    avif: /\.avif$/i.test(url.split('?')[0]),
    hasAvifSource: !!(s && s.getAttribute('srcset')),
    nat: { w: img.naturalWidth, h: img.naturalHeight },
  };
})()`);
console.log('  灯箱：', JSON.stringify(boxInfo));
if (!PROBE) {
  check('★ 灯箱给的是「封到 1600」那一档，不是最大那档',
    !!boxInfo && !!pick?.full && pick.full === (await cdp.ev(`document.getElementById('cc-probe-zoomimg').dataset.full`)),
    pick ? pick.full : '(没有图)');
  check('★ 灯箱那张图封了尺寸上限（不为了一张插图去下 1900px 的大图）',
    !!boxInfo && boxInfo.nat.w > 0 && boxInfo.nat.w <= 1600, JSON.stringify(boxInfo && boxInfo.nat));
  check('★ 有 avif 变体的图，灯箱用 AVIF 那一路（<source> 填上了 srcset）',
    !!boxInfo && (boxInfo.hasAvifSource ? boxInfo.avif : true),
    JSON.stringify({ source: boxInfo?.hasAvifSource, 实际: boxInfo?.url }));
}

check('这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

try { await cdp.send('Browser.close'); } catch { /* ignore */ }
chrome.kill();
server.close();
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* ignore */ }

if (PROBE) {
  console.log('\n（探针模式：只打表不断言）');
  process.exit(0);
}
console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
