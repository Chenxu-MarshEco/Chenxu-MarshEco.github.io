/*
 * 手机端右上角那一排控件（用户 2026-09-25 反馈）。
 *
 * 用户原话：
 *   「右上角的搜索 随机跳转 回到顶部 音量 目录UI在手机端排开后会完全挡住左上的
 *    回到首页和花娅域主按钮 请你在手机端只保留一个搜索框和一个同风格的展开按钮
 *    点击展开按钮以后会向下拉出被折叠的随机跳转 回到顶部 音量 目录按钮」
 *
 * 量三件事：
 *   ① 右上角那一簇和页头左边那一簇（站名「回到首页」+「花娅域主」）有没有压在一起 ——
 *      既量几何（corner.left 和 headerLeft.right 谁在左），也在两个按钮正中做
 *      elementFromPoint 命中测试（用户真正在意的是"点得到吗"）；
 *   ② 手机宽度下那一排是不是只剩「搜索框 + 展开按钮」，折叠面板收着；
 *   ③ 点展开按钮 → 四个按钮被拉出来、每个都看得见点得到；再点一下收回去；
 *      在面板里点「目录」能打开抽屉；点别处 / Esc 能收起面板。
 *   桌面宽度另有一条：那一排还是老样子（五颗一排、没有展开按钮）。
 *
 * 用法：
 *   node tools/checks/mobile-corner-check.mjs            # 验收（有断言）
 *   node tools/checks/mobile-corner-check.mjs --probe    # 只打表，不断言
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const root = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : path.resolve('dist');
const PROBE = process.argv.includes('--probe');
const PORT = 4477;
const DEBUG_PORT = 9447;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml',
};
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  if (PROBE && ok) return; // 探针模式只报失败项，表格另打
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};

/* 手机宽度的取样点：320（最窄的老机型）到 768（平板竖屏），桌面另取 900 / 1280 */
const MOBILE_WIDTHS = [320, 360, 390, 414, 480, 540, 600, 680, 736];
const DESKTOP_WIDTHS = [768, 900, 1280];

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

const profile = path.join(process.env.TEMP ?? '.', `dsh-mcorner-${Date.now()}`);
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank',
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

/** 按手机/桌面尺寸打开一页 */
const open = async (url, width, height = 844) => {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: width <= 736,
  });
  cdp.errors = [];
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${url}` });
  for (let i = 0; i < 200; i++) { await sleep(90); if ((await cdp.tryEv('document.readyState')) === 'complete') break; }
  await sleep(700);
};

/** 一页上那一簇的全部读数 */
const READ = `(() => {
  const q = (s) => document.querySelector(s);
  const box = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
      right: Math.round(r.right), bottom: Math.round(r.bottom),
      display: cs.display, visibility: cs.visibility,
      shown: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0,
    };
  };
  /* 命中测试：这个元素正中那一点，最上层是不是它（或它的子孙） */
  const hittable = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    return !!(hit && (hit === el || el.contains(hit)));
  };
  const headerLeft = q('.site-header__left');
  const brand = q('.site-brand');
  const pill = q('.about-pill');
  const corner = q('.corner');
  const fold = q('#corner-fold');
  const cbox = box(corner);
  const hbox = box(headerLeft);
  return {
    vw: window.innerWidth,
    corner: cbox, headerLeft: hbox,
    search: box(q('#site-search-box')),
    more: box(q('#corner-more')),
    fold: box(fold),
    foldItems: ['#random-jump', '#totop', '#music-vol', '#drawer-toggle'].map((s) => box(q(s))),
    foldedShown: fold ? [...fold.children].filter((el) => box(el) && box(el).shown).length : -1,
    /* 几何上有没有压住 */
    overlap: !!(cbox && hbox) && cbox.x < hbox.right - 1 && cbox.y < hbox.bottom - 1,
    /* 用户真正在意的：那两个按钮点得到吗 */
    brandHit: hittable(brand),
    pillHit: hittable(pill),
    brandBox: box(brand),
    pillBox: box(pill),
    moreExpanded: q('#corner-more') ? q('#corner-more').getAttribute('aria-expanded') : null,
    drawerOpen: !!document.documentElement.classList.contains('drawer-open'),
    drawerPanelShown: (() => { const d = q('#drawer-panel'); return !!(d && !d.hidden); })(),
    volPopShown: (() => {
      const p = q('.vol__pop .vol__panel');
      if (!p) return false;
      const cs = getComputedStyle(p);
      return cs.visibility !== 'hidden' && Number(cs.opacity) > 0.5;
    })(),
  };
})()`;

const read = () => cdp.ev(READ);
const tap = async (sel) => {
  const r = await cdp.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
  if (!r) return false;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y, buttons: 0 });
  await sleep(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(50);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1, buttons: 0 });
  await sleep(420);
  return true;
};
const tapXY = async (x, y) => {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(40);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
  await sleep(420);
};

/* ==========================================================================
 *  ① 手机宽度：不压住左上那两颗 + 只剩搜索框和展开按钮
 * ======================================================================== */
console.log('\n================ ① 手机宽度（首页 / 有歌单，五颗都在）================');
const mobileRows = [];
for (const w of MOBILE_WIDTHS) {
  await open('/', w);
  const s = await read();
  mobileRows.push({ w, ...s });
  console.log(
    `  ${String(w).padStart(4)}px  corner x=${s.corner?.x}..${s.corner?.right}｜header 左簇 ..${s.headerLeft?.right}` +
      `｜压住=${s.overlap}｜站名点得到=${s.brandHit}｜花娅域主点得到=${s.pillHit}` +
      `｜搜索=${s.search?.shown}｜展开键=${s.more?.shown}｜面板=${s.fold?.shown}（亮着 ${s.foldedShown} 项）`
  );
}
const worst = mobileRows.filter((r) => r.overlap || !r.brandHit || !r.pillHit);
check('★ 手机各宽度下，右上角那一簇都不再压住左上的「回到首页」和「花娅域主」',
  worst.length === 0,
  worst.length ? worst.map((r) => `${r.w}px(压=${r.overlap} 站名=${r.brandHit} 域主=${r.pillHit})`).join(' ') : `${mobileRows.length} 个宽度全过`);
check('★ 手机各宽度下顶上只剩「搜索框 + 展开按钮」（随机跳转 / 回到顶部 / 音量 / 目录 都收在面板里）',
  mobileRows.every((r) => r.search?.shown && r.more?.shown && !r.fold?.shown && r.foldedShown === 0),
  JSON.stringify(mobileRows.map((r) => ({ w: r.w, 搜索: r.search?.shown, 展开: r.more?.shown, 面板: r.fold?.shown }))));
check('手机宽度下搜索框和展开按钮都在视口里（没被挤出屏幕）',
  mobileRows.every((r) => r.search && r.more && r.search.x >= 0 && r.more.right <= r.vw + 1),
  JSON.stringify(mobileRows.map((r) => ({ w: r.w, vw: r.vw, 搜索x: r.search?.x, 展开右: r.more?.right }))));
check('展开按钮的样式和旁边那几颗一样（同样的 42×42 圆角方块）',
  mobileRows.every((r) => r.more && r.more.w === r.more.h && r.more.h === 42),
  JSON.stringify(mobileRows.map((r) => `${r.w}:${r.more ? `${r.more.w}×${r.more.h}` : '没有展开按钮'}`)));

/* 探针模式到这里就够了：下面全是要点了才好量的事 */
if (PROBE) {
  console.log('\n（探针模式：只打表不断言）');
  try { await cdp.send('Browser.close'); } catch { /* ignore */ }
  chrome.kill();
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* ignore */ }
  process.exit(0);
}

/* ==========================================================================
 *  ② 展开 / 收起
 * ======================================================================== */
console.log('\n================ ② 点展开按钮（390px 手机）================');
await open('/', 390);
const collapsed = await read();
await tap('#corner-more');
const expanded = await read();
console.log('  收起时：', JSON.stringify({ 面板: collapsed.fold?.shown, 亮着: collapsed.foldedShown, aria: collapsed.moreExpanded }));
console.log('  展开后：', JSON.stringify({ 面板: expanded.fold?.shown, 亮着: expanded.foldedShown, aria: expanded.moreExpanded, 面板框: expanded.fold && [expanded.fold.x, expanded.fold.y, expanded.fold.w, expanded.fold.h] }));
check('★ 点一下展开按钮 → 四个按钮真的被拉出来（随机跳转 / 回到顶部 / 音量 / 目录）',
  expanded.fold?.shown === true && expanded.foldedShown === 4 && expanded.moreExpanded === 'true',
  `亮着 ${expanded.foldedShown} 项`);
const HIT_ALL = `(() => {
  const hit = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return 'missing';
    const r = el.getBoundingClientRect();
    if (r.width < 2) return 'zero';
    const t = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    return !!(t && (t === el || el.contains(t)));
  };
  return { random: hit('#random-jump'), totop: hit('#totop'), vol: hit('#music-vol-btn'), drawer: hit('#drawer-toggle') };
})()`;
const hitAll = await cdp.ev(HIT_ALL);
check('★ 拉出来之后每个按钮都看得见、点得到（正中那一点命中的就是它自己）',
  Object.values(hitAll).every((v) => v === true), JSON.stringify(hitAll));
const inView = await cdp.ev(`(() => {
  const out = [];
  for (const sel of ['#random-jump', '#totop', '#music-vol-btn', '#drawer-toggle']) {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    out.push({ sel, ok: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 });
  }
  return out;
})()`);
check('★ 拉出来的按钮都在屏幕里（没有被挤到视口外）', inView.every((v) => v.ok), JSON.stringify(inView));
check('★ 面板是「向下」拉出来的：整体在顶上那一排的下方',
  expanded.fold && collapsed.corner && expanded.fold.y >= collapsed.corner.bottom - 1,
  `面板 top=${expanded.fold?.y}｜顶排 bottom=${collapsed.corner?.bottom}`);
check('展开状态下左上那两颗依然点得到（面板没横着伸过去）',
  expanded.brandHit && expanded.pillHit && !expanded.overlap,
  JSON.stringify({ 站名: expanded.brandHit, 域主: expanded.pillHit, 压住: expanded.overlap }));

await tap('#corner-more');
const reclosed = await read();
check('★ 再点一下 → 收回去（四个按钮又藏起来）',
  reclosed.fold?.shown === false && reclosed.foldedShown === 0 && reclosed.moreExpanded === 'false',
  JSON.stringify({ 面板: reclosed.fold?.shown, aria: reclosed.moreExpanded }));

/* 在面板里点「目录」→ 抽屉打开，面板收起来 */
await tap('#corner-more');
await tap('#drawer-toggle');
const drawerState = await read();
check('★ 在拉出来的面板里点「目录」→ 抽屉真的打开了',
  drawerState.drawerOpen && drawerState.drawerPanelShown, JSON.stringify({ open: drawerState.drawerOpen, panel: drawerState.drawerPanelShown }));
check('抽屉打开时那簇控件让开（不会浮在抽屉面板上）',
  drawerState.corner?.visibility === 'hidden' || !drawerState.search?.shown || drawerState.fold?.shown === false,
  JSON.stringify({ corner: drawerState.corner?.visibility, 搜索: drawerState.search?.shown, 面板: drawerState.fold?.shown }));
await cdp.ev(`document.getElementById('drawer-close').click()`);
await sleep(400);
/* 点别处也要能收起面板 */
await tap('#corner-more');
const opened2 = await read();
await tapXY(20, 600);
const outside = await read();
check('★ 点面板以外的地方 → 面板收起来',
  opened2.fold?.shown === true && outside.fold?.shown === false,
  JSON.stringify({ 展开时: opened2.fold?.shown, 点别处后: outside.fold?.shown }));

/* 音量：手机上没有 hover，点一下音量键要能看到音量条 */
await tap('#corner-more');
await tap('#music-vol-btn');
const volState = await read();
check('★ 手机端点「音量」→ 音量条弹出来（触屏没有 hover，得靠点击）',
  volState.volPopShown === true, JSON.stringify({ 音量条: volState.volPopShown }));
const volInView = await cdp.ev(`(() => { const p = document.querySelector('.vol__pop .vol__panel'); const r = p.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), inView: r.left >= 0 && r.right <= innerWidth + 1 }; })()`);
check('音量条也在屏幕里（没伸到左边屏幕外）', volInView.inView, JSON.stringify(volInView));

/* ==========================================================================
 *  ③ 桌面宽度：还是老样子
 * ======================================================================== */
console.log('\n================ ③ 桌面宽度 ================');
for (const w of DESKTOP_WIDTHS) {
  await open('/', w, 900);
  const s = await read();
  console.log(`  ${w}px  搜索=${s.search?.shown}｜展开键=${s.more?.shown}｜折叠容器=${s.fold?.display}（亮着 ${s.foldedShown} 项）｜压住=${s.overlap}`);
  check(`★ ${w}px（桌面）：五颗还是排成一排，展开按钮不出现`,
    s.search?.shown && s.more?.shown === false && s.foldedShown === 4 && !s.overlap,
    JSON.stringify({ 搜索: s.search?.shown, 展开: s.more?.shown, 亮着: s.foldedShown }));
}

/* 没有歌单的页面（音量键 hidden）不该多出一颗 */
await open('/about-me/', 390);
const noMusic = await read();
check('手机端在「没有歌单」的页面上：展开按钮照样在，面板里没有音量键也不会塌',
  noMusic.more?.shown === true && noMusic.fold?.shown === false,
  JSON.stringify({ 展开: noMusic.more?.shown, 面板: noMusic.fold?.shown }));

/* ==========================================================================
 *  ④ 各页面类型都过一遍（那一簇是全站挂的，别的页面不能又压上）
 * ======================================================================== */
console.log('\n================ ④ 390px 下各页面 ================');
const PAGES = [
  ['/', '首页（深色 + 有歌单）'],
  ['/salon/', '冰室精华（深色 + 自己那条吸顶搜索栏）'],
  ['/search/', '搜索中转页（浅色 + 自己的表单）'],
  ['/about-me/', '花娅域主（浅色）'],
  ['/huaya/years/', '花娅编年史（深色子页）'],
];
for (const [url, label] of PAGES) {
  await open(url, 390);
  const s = await read();
  console.log(`  ${label}：压住=${s.overlap}｜站名=${s.brandHit}｜域主=${s.pillHit}｜搜索=${s.search?.shown}｜展开=${s.more?.shown}｜面板=${s.fold?.shown}`);
  check(`★ 390px ${label}：不压住左上两颗，顶上只有搜索框 + 展开按钮`,
    !s.overlap && s.brandHit && s.pillHit && s.search?.shown && s.more?.shown && !s.fold?.shown,
    JSON.stringify({ 压住: s.overlap, 站名: s.brandHit, 域主: s.pillHit, 搜索: s.search?.shown, 展开: s.more?.shown, 面板: s.fold?.shown }));
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
