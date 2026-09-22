/*
 * 三项验收（2026-09-22）：
 *   ① 放大看图：只有「页面→＋图片」放进来的图 + 冰室精华页里的图能点开看大图；
 *      右上角有个小 ×、点图片外面的底色、按 Esc 都能关掉。
 *   ② 地图图钉的名字卡不再被别的图钉挡住（鼠标指上去的那颗抬到最上层）。
 *   ③ （编辑器那一半在 editor-ui-check.mjs 里量）
 *
 * 用法：node tools/checks/image-zoom-check.mjs [dist目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
const PORT = 4411;
const DEBUG_PORT = 9381;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg',
};
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const skip = (n) => {
  pass++;
  console.log(`SKIP  ${n}`);
};

/* ---------------- 静态：哪些图被标成"能点" ---------------- */
const readPage = (rel) => {
  const f = path.join(root, rel);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};
const salon = readPage('salon/index.html');
const salonPics = (salon.match(/class="salon__pic"/g) ?? []).length;
const salonPicZoom = (salon.match(/class="salon__pic"[\s\S]{0,400}?data-zoom="1"/g) ?? []).length;
const salonAvaZoom = (salon.match(/class="salon__avatar"[^>]*data-zoom/g) ?? []).length;
const salonZoomAll = (salon.match(/data-zoom="1"/g) ?? []).length;

console.log(`精华页：截图 ${salonPics} 张（带 data-zoom ${salonPicZoom}）｜整页 data-zoom ${salonZoomAll}｜头像带 data-zoom ${salonAvaZoom}`);

/* 找一页有正文图的 */
const pages = [];
const walk = (dir, rel = '') => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const next = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(path.join(dir, e.name), next);
    else if (e.name === 'index.html') pages.push(`${rel.slice(1)}/index.html`);
  }
};
walk(root);
const boardPage = pages
  .map((rel) => {
    const t = readPage(rel);
    return { rel, fig: (t.match(/class="pfigure/g) ?? []).length, zoom: (t.match(/data-zoom="1"/g) ?? []).length, map: (t.match(/class="pmap__pin/g) ?? []).length };
  })
  .filter((p) => p.fig > 0)
  .sort((a, b) => b.fig - a.fig)[0];
const mapPage = pages
  .map((rel) => ({ rel, map: (readPage(rel).match(/class="pmap__pin/g) ?? []).length }))
  .filter((p) => p.map > 0)
  .sort((a, b) => b.map - a.map)[0];

if (!salonPics || !boardPage || !mapPage) {
  console.error('数据不够量：精华页 / 正文图 / 地图 至少缺一样');
  process.exit(2);
}

check('① 精华页**每一张**截图都标了能点（data-zoom），一张不漏',
  salonPics > 0 && salonPicZoom === salonPics,
  `${salonPicZoom} / ${salonPics}`);
check('① 精华页的头像**没有**被标成能点（只标截图，不是"全站所有 img"）',
  salonAvaZoom === 0 && salonZoomAll === salonPicZoom,
  `整页 data-zoom ${salonZoomAll} = 截图 ${salonPicZoom}｜头像 ${salonAvaZoom}`);
check(`① 页面正文里的图都标了（拿 ${boardPage.rel} 量）`,
  boardPage.zoom === boardPage.fig && boardPage.fig > 0,
  `${boardPage.zoom} / ${boardPage.fig}（${boardPage.rel}）`);
check('① 正文里的图还带了原图地址、而且键盘能聚焦（tabindex/role/aria-label）',
  /data-zoom="1"[^>]*data-full="[^"]+"/.test(readPage(boardPage.rel)) &&
    /data-zoom="1"[^>]*tabindex="0"/.test(readPage(boardPage.rel)) &&
    /role="button"/.test(readPage(boardPage.rel)),
  (readPage(boardPage.rel).match(/<img[^>]*data-zoom="1"[^>]*>/) ?? [''])[0].slice(0, 200));
check('① 灯箱本体在页面上（默认 hidden，里面有图和右上角那个 ×）',
  /class="izoom"[^>]*hidden/.test(salon) && /data-izoom-img/.test(salon) && /data-izoom-close/.test(salon),
  '');

/* ---------------- 起服务 + 真浏览器 ---------------- */
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

const profile = path.join(process.env.TEMP ?? '.', `dsh-zoom-${Date.now()}`);
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
  async goto(p, wait = 1800) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 150; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
  }
  async move(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
  }
  async click(x, y) {
    await this.move(x, y);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
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
await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });

const STATE = `(() => {
  const box = document.querySelector('[data-izoom]');
  const img = box && box.querySelector('[data-izoom-img]');
  const btn = box && box.querySelector('[data-izoom-close]');
  const r = box && !box.hidden ? box.getBoundingClientRect() : null;
  const b = btn ? btn.getBoundingClientRect() : null;
  return {
    open: !!box && !box.hidden,
    src: img ? (img.getAttribute('src') || '') : '',
    natural: img ? { w: img.naturalWidth, h: img.naturalHeight } : null,
    shown: img && r ? { w: Math.round(img.getBoundingClientRect().width), h: Math.round(img.getBoundingClientRect().height) } : null,
    boxZ: box ? getComputedStyle(box).zIndex : '',
    htmlLocked: document.documentElement.classList.contains('is-zoomed'),
    btn: b ? { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), w: Math.round(b.width), right: Math.round(b.right), top: Math.round(b.top) } : null,
    vw: innerWidth, vh: innerHeight,
    focus: document.activeElement ? document.activeElement.className || document.activeElement.tagName : '',
  };
})()`;

const scrollToFirstZoom = `(async () => {
  /* 挑一张"原图比版面上那张大"的（这样才量得出"放大"）：
     版面用的是 /img/opt/… 那一档，点开给的是 <a href> 里的原图 */
  const load = (src) => new Promise((r) => {
    const im = new Image();
    im.onload = () => r({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => r(null);
    im.src = src;
  });
  const links = [...document.querySelectorAll('a.salon__pic')];
  let best = null;
  for (const a of links.slice(0, 40)) {
    const im = a.querySelector('img');
    if (!im) continue;
    a.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = im.getBoundingClientRect();
    if (r.width < 80) continue;
    const nat = await load(a.getAttribute('href'));
    if (!nat) continue;
    const info = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), shown: Math.round(r.width), src: im.getAttribute('src') || '', full: a.getAttribute('href') || '', natural: nat.w, a };
    if (!best || nat.w - info.shown > best.natural - best.shown) best = info;
    if (info.natural - info.shown >= 400) break;
  }
  /* ⚠ 上面这一圈会一路往下滚 —— 选中的那张得**重新滚回来重量一次**，
     不然拿的是滚动前的坐标，点下去会点到别人身上（踩过）。 */
  if (best) {
    best.a.scrollIntoView({ block: 'center', behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 120));
    const r2 = best.a.querySelector('img').getBoundingClientRect();
    best.x = Math.round(r2.left + r2.width / 2);
    best.y = Math.round(r2.top + r2.height / 2);
    delete best.a;
  }
  return best;
})()`;

/* ---------------- ① 精华页：点开 / 三种关法 ---------------- */
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp.goto('/salon/', 2600);
const line = await cdp.ev(scrollToFirstZoom);
const before = await cdp.ev(STATE);
check('① 点之前：灯箱是关着的、页面能滚', before.open === false && before.htmlLocked === false, JSON.stringify(before.open));
check('① 点到的是精华页的截图（在 <a href=原图> 里，灯箱给的就是同一张）',
  !!line && !!line.full && line.natural > 0,
  JSON.stringify(line));

await cdp.click(line.x, line.y);
await sleep(700);
const open1 = await cdp.ev(STATE);
console.log('打开之后：', JSON.stringify(open1));
check('①★ 点一下图 → 灯箱打开，而且给的是**原图**（就是那层 <a href> 指的地址，不是版面上压缩过的那档）',
  open1.open === true && open1.src === line.full,
  `灯箱 ${open1.src}｜链接 ${line.full}`);
check('①★ 右上角有个小 ×（在视口右上角那一块里，而且那个坐标上点得到的就是它）',
  !!open1.btn && open1.btn.x > open1.vw * 0.6 && open1.btn.y < open1.vh * 0.25 && open1.btn.w >= 24,
  JSON.stringify(open1.btn));
check('① 打开时底下的页面被冻住（html.is-zoomed），层级高过页头和目录（z ≥ 40）',
  open1.htmlLocked === true && Number(open1.boxZ) >= 40, `z=${open1.boxZ}`);

/* 点图本身不关 */
await cdp.click(Math.round(open1.vw / 2), Math.round(open1.vh / 2));
await sleep(400);
const afterImgClick = await cdp.ev(STATE);
check('① 点图片本身**不关**（方便凑近看），还是开着的', afterImgClick.open === true, JSON.stringify({ open: afterImgClick.open }));

/* 点图片外面的底色 → 关 */
await cdp.click(Math.round(open1.vw * 0.04), Math.round(open1.vh * 0.9));
await sleep(400);
const closedByBg = await cdp.ev(STATE);
check('①★ 点图片**外面的背景** → 关掉，页面恢复能滚', closedByBg.open === false && closedByBg.htmlLocked === false, JSON.stringify(closedByBg.open));

/* 再开 → 点 × */
await cdp.click(line.x, line.y);
await sleep(600);
const open2 = await cdp.ev(STATE);
await cdp.click(open2.btn.x, open2.btn.y);
await sleep(400);
const closedByX = await cdp.ev(STATE);
check('①★ 点右上角那个小 × → 关掉', open2.open === true && closedByX.open === false,
  `开=${open2.open} → 关=${closedByX.open}`);

/* 再开 → Esc */
await cdp.click(line.x, line.y);
await sleep(600);
const open3 = await cdp.ev(STATE);
await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await sleep(400);
const closedByEsc = await cdp.ev(STATE);
check('① 按 Esc 也能关（键盘用户）', open3.open === true && closedByEsc.open === false,
  `开=${open3.open} → 关=${closedByEsc.open}`);

/* 键盘打开：精华页那些图在 <a> 里，聚焦链接按回车（浏览器把回车变成 click） */
await cdp.ev(`(() => { const a = document.querySelector('a.salon__pic'); a.focus(); return document.activeElement === a; })()`);
await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await cdp.send('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await sleep(600);
const kbOpen = await cdp.ev(STATE);
check('① 键盘也能打开链接里的那张图（聚焦 <a> 按回车，浏览器把回车变成 click）',
  kbOpen.open === true, JSON.stringify({ open: kbOpen.open }));
await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await sleep(300);

/* 不该能点的：头像 */
const avaHit = await cdp.ev(`(() => {
  const av = document.querySelector('.salon__avatar');
  if (!av) return { found: false, opened: false };
  av.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = av.getBoundingClientRect();
  av.click();
  return { found: true, zoomAttr: av.hasAttribute('data-zoom'), opened: !document.querySelector('[data-izoom]').hidden };
})()`);
await sleep(300);
const avaAfter = await cdp.ev(STATE);
check('① 头像点不动（没标 data-zoom → 什么都不会发生）',
  avaHit.found === true && avaHit.zoomAttr === false && avaAfter.open === false,
  JSON.stringify({ ...avaHit, open: avaAfter.open }));

/* ---------------- ① 正文里的图（不在链接里） ---------------- */
await cdp.goto(`/${boardPage.rel.replace(/index\.html$/, '')}`, 2000);
const fig = await cdp.ev(`(() => {
  const im = document.querySelector('.pfigure img[data-zoom]');
  if (!im) return null;
  im.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = im.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), full: im.dataset.full || '', inLink: !!im.closest('a'), tab: im.getAttribute('tabindex'), role: im.getAttribute('role'), name: im.getAttribute('aria-label') };
})()`);
check('① 正文里的图：不在链接里、可聚焦、有名字、带着原图地址',
  !!fig && fig.inLink === false && fig.tab === '0' && fig.role === 'button' && !!fig.name && /\/img\/uploads\//.test(fig.full),
  JSON.stringify(fig));
await cdp.click(fig.x, fig.y);
await sleep(800);
const figOpen = await cdp.ev(STATE);
check('①★ 正文里的图点一下也放大（给的是 data-full 那张原图）',
  figOpen.open === true && figOpen.src === fig.full && figOpen.natural?.w > 0,
  `灯箱 ${figOpen.src}｜naturalW ${figOpen.natural?.w}`);
check('①★ 真的放大了：灯箱里那张比版面上那张大（版面用 760 那档、点开是 1920 原图）',
  !!figOpen.shown && figOpen.shown.w > fig.w && figOpen.natural.w > fig.w,
  `版面 ${fig.w}px 宽 → 灯箱显示 ${figOpen.shown?.w}px（原图 ${figOpen.natural?.w}px）`);
await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await sleep(350);
const focusBack = await cdp.ev(`(() => (document.activeElement && document.activeElement.matches && document.activeElement.matches('img[data-zoom]')) ? 'yes' : (document.activeElement.className || document.activeElement.tagName))()`);
check('① 关掉之后焦点回到那张图（键盘用户不会掉到页面顶上）', focusBack === 'yes', String(focusBack));

/* ---------------- ② 地图图钉的名字卡不再被挡住 ----------------
   做法：**造一个必然重叠的局面**（把后面那颗钉子的头挪到前面那颗的卡片上），
   然后只改一处 —— 被指着那颗钉子的 z-index —— 看卡片那个坐标上命中谁。
   这样就不是"碰运气找一对重叠的钉子"，而是因果对齐的对照实验。 */
await cdp.goto(`/${mapPage.rel.replace(/index\.html$/, '')}`, 2200);
/*
  ⚠ 名字卡平时是 `pointer-events: none`（鼠标端它只是"看着的"），
  于是 elementFromPoint 永远命中不到它 —— 想用"那个坐标上命中谁"来判遮挡，
  得先把它的 pointer-events 打开（手机端本来就是这样，见 @media (hover: none) 那条）。
  这一步只改 pointer-events，不动任何 z-index / 绘制顺序。
*/
await cdp.ev(`(() => {
  const s = document.createElement('style');
  s.id = 'zoom-check-pe';
  s.textContent = '.pmap__pinName{pointer-events:auto !important}';
  document.head.appendChild(s);
  return true;
})()`);
const mapSetup = await cdp.ev(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const map = document.querySelector('.pmap');
  if (!map) return null;
  map.scrollIntoView({ block: 'center', behavior: 'instant' });
  await sleep(400);
  const pins = [...document.querySelectorAll('.pmap__pin')];
  /* 挑两颗离得近、都在视口里的（前一颗有名字卡） */
  for (let i = 0; i < pins.length; i++) {
    const card = pins[i].querySelector('.pmap__pinName');
    const artI = pins[i].querySelector('.pmap__pinArt');
    if (!card || !artI) continue;
    const cr = card.getBoundingClientRect();
    const ar = artI.getBoundingClientRect();
    if (cr.width < 10 || ar.width < 10) continue;
    if (cr.top < 30 || cr.bottom > innerHeight - 30) continue;
    for (let j = i + 1; j < pins.length; j++) {
      const artJ = pins[j].querySelector('.pmap__pinArt');
      const boxJ = pins[j].querySelector('.pmap__pinBox');
      if (!artJ || !boxJ) continue;
      const jr = artJ.getBoundingClientRect();
      if (jr.width < 10) continue;
      /* 把 j 的头搬到 i 的卡片正中 */
      const dx = Math.round((cr.left + cr.width / 2) - (jr.left + jr.width / 2));
      const dy = Math.round((cr.top + cr.height / 2) - (jr.top + jr.height / 2));
      boxJ.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      await sleep(150);
      const moved = artJ.getBoundingClientRect();
      const nowOverlap = cr.left < moved.right && cr.right > moved.left && cr.top < moved.bottom && cr.bottom > moved.top;
      if (nowOverlap) {
        return {
          i, j, total: pins.length,
          hover: { x: Math.round(ar.left + ar.width / 2), y: Math.round(ar.top + ar.height / 2) },
          card: { x: Math.round(cr.left + cr.width / 2), y: Math.round(cr.top + cr.height / 2) },
        };
      }
      boxJ.style.transform = '';
    }
  }
  return { none: true, total: pins.length };
})()`);
console.log('地图：', JSON.stringify(mapSetup));
if (mapSetup?.none || !mapSetup) {
  skip('② 这一页凑不出"两颗挨得够近"的图钉 —— 跳过');
} else {
  const HIT = `(() => {
    const pins = [...document.querySelectorAll('.pmap__pin')];
    const card = pins[${mapSetup.i}].querySelector('.pmap__pinName');
    const el = document.elementFromPoint(${mapSetup.card.x}, ${mapSetup.card.y});
    const cs = getComputedStyle(card);
    return {
      cardVisible: cs.visibility === 'visible' && Number(cs.opacity) > 0.5,
      hitInHoverPin: !!el && pins[${mapSetup.i}].contains(el),
      hitInLaterPin: !!el && pins[${mapSetup.j}].contains(el),
      hitTag: el ? el.tagName + '.' + String(el.className || '').split(' ')[0] : '',
      hoveredZ: getComputedStyle(pins[${mapSetup.i}]).zIndex,
      laterZ: getComputedStyle(pins[${mapSetup.j}]).zIndex,
    };
  })()`;

  await cdp.move(mapSetup.hover.x, mapSetup.hover.y);
  await sleep(500);
  const fixed = await cdp.ev(HIT);
  console.log('  悬停（有这条 z-index 规则）：', JSON.stringify(fixed));
  check('②★ 鼠标移上去：那颗钉子抬到最上层（z-index 是个数，后面那颗还是 auto）',
    Number(fixed.hoveredZ) >= 30 && (fixed.laterZ === 'auto' || Number(fixed.laterZ) < Number(fixed.hoveredZ)),
    `悬停的钉 z=${fixed.hoveredZ}｜后面那颗 z=${fixed.laterZ}`);
  check('②★ 名字卡真的露出来了：可见，而且卡片正中那个坐标上命中的就是它',
    fixed.cardVisible === true && fixed.hitInHoverPin === true && fixed.hitInLaterPin === false,
    `visible=${fixed.cardVisible}｜命中 ${fixed.hitTag}｜在被挡住的钉子里=${fixed.hitInLaterPin}`);

  /* 对照：只把这条 z-index 去掉（行内 auto 压过样式表），同一处应该又被打回来的钉子挡住 */
  await cdp.ev(`(() => { document.querySelectorAll('.pmap__pin')[${mapSetup.i}].style.zIndex = 'auto'; return true; })()`);
  await sleep(200);
  await cdp.move(mapSetup.hover.x, mapSetup.hover.y);
  await sleep(400);
  const broken = await cdp.ev(HIT);
  console.log('  同一处、去掉 z-index 之后：', JSON.stringify(broken));
  check('②★ 对照：去掉这条规则，同一处又被后面那颗钉子挡住（说明挡住它的就是这个层级，不是巧合）',
    broken.hitInHoverPin === false,
    `命中 ${broken.hitTag}｜在被挡住的钉子里=${broken.hitInLaterPin}`);
  await cdp.ev(`(() => {
    const pins = [...document.querySelectorAll('.pmap__pin')];
    pins[${mapSetup.i}].style.zIndex = '';
    pins[${mapSetup.j}].querySelector('.pmap__pinBox').style.transform = '';
    return true;
  })()`);
}

check('① 这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

try { await cdp.send('Browser.close'); } catch { /* ignore */ }
chrome.kill();
server.close();
console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
