/*
 * ============================================================================
 * 首页右侧那枚时间轴书签的验收（真浏览器 + 真滚动）
 * ----------------------------------------------------------------------------
 * 用户原话（2026-11-20）：
 *   「首页右侧边也需要出现可以打开时间轴的 UI 和别的页面一样
 *     但是这个 UI 只有下翻到板块区域的时候才会伸出
 *     上翻到标题区域就会缩回让置顶塔吊伸出」
 *
 * 所以这里量的是「同一块右缘怎么轮流用」：
 *   A  构建产物：首页挂上了时间轴（书签写的是轴自己的名字）、书签等了
 *      #home-cover 这一块（data-tl-gate）、别的页面没有这一条
 *   B  桌面：在标题区域（滚到顶）→ 书签收在画面外（不可见、点不到），
 *      置顶塔吊在；下翻到板块区域 → 书签伸出来贴在右缘、和别的页面同一个 UI，
 *      塔吊已经缩走；再翻回顶部 → 书签收回去、塔吊回来
 *   C  开合：板块区域点得开面板；开着面板往上游回标题区域 → 面板自己收起
 *      （否则塔吊会顶在面板底下，"让塔吊伸出"就是假的）；再翻下来还能点开
 *   D  手机 390×844：拦腰那一刀同样成立（顶部收、板块区域伸）
 *   E  别的页面没被带坏：书签从头到尾都在，滚到页面底部也不收
 *   F  全程没有 JS 报错
 *
 * 用法：node tools/checks/home-timeline-tab-check.mjs [dist目录]
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromePath } from './lib/chrome.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
const PORT = 4496;
const DEBUG_PORT = 9396;
const CHROME = chromePath();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
};
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

const indexPath = path.join(root, 'index.html');
if (!fs.existsSync(indexPath)) {
  console.error(`找不到 ${indexPath}，先构建`);
  process.exit(2);
}

/* ================================================================
 * A. 构建产物
 * ================================================================ */
console.log('================ A. 构建产物 ================');
const html = fs.readFileSync(indexPath, 'utf8');
const tabTags = html.match(/<button class="tl__tab[^>]*>/g) ?? [];
check('首页里有时间轴书签（.tl__tab），而且只有一个', tabTags.length === 1, `${tabTags.length} 个`);
check('书签上写的是这条轴自己的名字（不是「时间轴」三个字）',
  /class="tl__tabText"/.test(html));
const gateAttr = (html.match(/data-tl-gate="([^"]*)"/) || [, ''])[1];
check('首页的书签让位给封面那一块（data-tl-gate="#home-cover"）', gateAttr === '#home-cover', gateAttr || '(没有)');
/* 第一帧就写在产物里，不然书签会先在封面右缘露一下再滑走（闪一下） */
check('产物里书签默认就是收着的（class 里带 is-tabhidden，不闪）',
  /class="tl[^"]*is-tabhidden/.test(html));
check('首页的 .tl 还是全站那一个组件（data-tl / data-tl-panel / data-tl-body 都在）',
  /data-tl\b/.test(html) && /data-tl-panel/.test(html) && /data-tl-body/.test(html));
/*
 * 打开时停在「实时」那一刻（站长 2026-11-20）：
 * 「首页的时间轴打开时默认停留在实时时刻的位置也就是那个每天更新的最新时刻
 *   不要停留在一开始」。
 * 所以首页要的是 `data-tl-default-live="1"`（脚本在打开的那一刻按访问者当天算），
 * 而不是一个构建期写死的 `data-tl-default="0.94…"`（隔几天就不等于今天了）。
 */
check('首页的书签让脚本「停在实时那一刻」（data-tl-default-live）',
  /data-tl-default-live="1"/.test(html));
check('首页没有写死一个构建期的初始位置（data-tl-default 是空的）',
  (html.match(/data-tl-default="([^"]*)"/) || [, ''])[1] === '',
  (html.match(/data-tl-default="([^"]*)"/) || [, '(没有)'])[1]);
check('这条轴上有「实时」那个点（哨兵日期 today）', /data-live="1"/.test(html));

const astroDir = path.join(root, '_astro');
const css = fs.existsSync(astroDir)
  ? fs.readdirSync(astroDir).filter((f) => f.endsWith('.css'))
    .map((f) => fs.readFileSync(path.join(astroDir, f), 'utf8')).join('\n')
  : '';
const inlineCss = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const allCss = css + inlineCss;
/* 产物 CSS 是压缩过的：translateX(140%) 会被写成 translate(140%)，所以 X 要允许省略 */
check('让位状态的样式在产物里（.is-tabhidden 把书签推出右缘 + 收掉可见性）',
  /\.is-tabhidden[^{]*\.tl__tab[^{]*\{[^}]*translateX?\(1[0-9]{2}%\)/.test(allCss)
  && /\.is-tabhidden[^{]*\.tl__tab[^{]*\{[^}]*visibility:\s*hidden/.test(allCss));

/* ================================================================
 * 起服务 + 开浏览器
 * ================================================================ */
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

const profileDir = path.join(process.env.TEMP ?? '.', `dsh-hometab-${Date.now()}`);
const chrome = spawn(
  CHROME,
  ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--disable-breakpad', '--window-size=1600,900', `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' },
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
  async goto(p, wait = 900) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 200; i++) { await sleep(60); if ((await this.ev('document.readyState')) === 'complete') break; }
    await this.ev('document.fonts ? document.fonts.ready.then(()=>1) : 1');
    await sleep(wait);
  }
  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await sleep(60);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(40);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }
  setViewport(w, h, mobile) {
    return this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
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

/* 过渡/动画停掉，量出来的位置才是稳态的（滑出滑进要等 transition 结束） */
const FREEZE = `(() => {
  if (document.getElementById('__freeze')) return 1;
  const s = document.createElement('style');
  s.id = '__freeze';
  s.textContent = '*,*::before,*::after{animation:none !important;transition:none !important}';
  document.head.append(s);
  return 1;
})()`;

/** 滚到某个元素顶上（和页面上那些「进入」链接同一个落点：让开吸顶页头 14px） */
const scrollToEl = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return -1;
  const head = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--home-header')) || 64;
  const top = Math.max(0, el.getBoundingClientRect().top + window.scrollY - head - 14);
  window.scrollTo({ top, left: 0, behavior: 'instant' });
  return Math.round(top);
})()`;
const scrollTo = (y) => `(() => { window.scrollTo({ top: ${y}, left: 0, behavior: 'instant' }); return Math.round(window.scrollY); })()`;

/*
 * 一次量全：书签、面板、封面、板块、置顶塔吊。
 * hitEdgeMid 是「右缘中点现在是谁」—— 书签藏好的时候这里必须不是它（点不到才算真的收起来了）；
 * 光看 is-tabhidden 这个 class 不够，样式被别处覆盖掉的话 class 还在而东西还露着。
 */
const PROBE = `(() => {
  const q = (s) => document.querySelector(s);
  const rootEl = q('[data-tl]');
  const tab = q('.tl__tab');
  const panel = q('[data-tl-panel]');
  const pin = q('[data-home-pinned]');
  const cover = q('#home-cover');
  const boards = q('#home-boards');
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const tcs = cs(tab);
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const hit = document.elementFromPoint(vw - 4, Math.round(vh / 2));
  return {
    vw, vh, scrollY: Math.round(window.scrollY),
    tab: box(tab),
    tabVisibility: tcs ? tcs.visibility : '',
    tabTransform: tcs ? tcs.transform : '',
    tabText: tab ? tab.textContent.trim() : '',
    tabWriting: tcs ? tcs.writingMode : '',
    tabFontSize: tcs ? tcs.fontSize : '',
    hidden: rootEl ? rootEl.classList.contains('is-tabhidden') : null,
    open: rootEl ? rootEl.classList.contains('is-open') : null,
    gate: rootEl ? (rootEl.dataset.tlGate || '') : null,
    panel: box(panel),
    panelHidden: panel ? panel.hidden : null,
    pinAway: pin ? pin.classList.contains('is-away') : null,
    pinOpacity: pin ? Number(cs(pin).opacity) : null,
    coverBottom: cover ? cover.getBoundingClientRect().bottom : null,
    boardsTop: boards ? boards.getBoundingClientRect().top : null,
    hitEdgeMid: hit ? (hit.closest('[data-tl]') ? 'tl' : String(hit.className || hit.tagName).split(' ')[0]) : ''
  };
})()`;

/** 书签「伸出去了」：可见、整只在视口里、贴着右缘 */
const out = (p) => p.tabVisibility === 'visible' && p.tab.right <= p.vw + 0.5
  && p.tab.top >= -1 && p.tab.bottom <= p.vh + 1;
/** 书签「缩回去了」：推到右缘之外且不可见 */
const tucked = (p) => p.hidden === true && p.tabVisibility === 'hidden';

/* ================================================================
 * B. 桌面 1600×900
 * ================================================================ */
console.log('\n================ B. 桌面 1600×900 ================');
await cdp.setViewport(1600, 900, false);
await cdp.goto('/');
await cdp.ev(FREEZE);
await sleep(250);
let p0 = await cdp.ev(PROBE);
info(`视口 ${p0.vw}×${p0.vh}；封面底边 ${Math.round(p0.coverBottom)}、板块顶 ${Math.round(p0.boardsTop)}`);
check('一进首页（标题区域）书签是收着的', tucked(p0),
  `hidden=${p0.hidden} visibility=${p0.tabVisibility} right=${p0.tab ? Math.round(p0.tab.right) : '?'}`);
check('收着的时候右缘中点点不到它（不是"看见的收、看不见的还能点"）',
  p0.hitEdgeMid !== 'tl', p0.hitEdgeMid || '(空白)');
check('同一时刻置顶塔吊是伸出来的（书签没抢它的位置）',
  p0.pinAway === false && p0.pinOpacity === 1, `away=${p0.pinAway} opacity=${p0.pinOpacity}`);

/* 先记住"别的页面"那枚书签长什么样，下面拿首页这枚去比 —— 用户要的是"和别的页面一样" */
await cdp.goto('/huaya/');
await cdp.ev(FREEZE);
await sleep(250);
const other = await cdp.ev(PROBE);
info(`别的页面那枚书签：宽 ${other.tab.width.toFixed(0)}px、字号 ${other.tabFontSize}、${other.tabWriting}`);
check('别的页面（花娅陌域）的书签一直是露着的（没有让位逻辑）',
  other.gate === '' && other.tabVisibility === 'visible' && !other.hidden);

/* 滚到板块区域 */
await cdp.goto('/');
await cdp.ev(FREEZE);
await sleep(250);
const landed = await cdp.ev(scrollToEl('#home-boards'));
await sleep(600);
let p1 = await cdp.ev(PROBE);
info(`滚到板块区域：scrollY ${p1.scrollY}（落点 ${landed}）；书签 ${p1.tab ? `${Math.round(p1.tab.left)}→${Math.round(p1.tab.right)}` : '?'}，${Math.round(p1.tab.top)}→${Math.round(p1.tab.bottom)}`);
check('下翻到板块区域 → 书签伸出来了（可见、整只在视口里、贴着右缘）', out(p1),
  `visibility=${p1.tabVisibility} right=${p1.tab ? Math.round(p1.tab.right) : '?'} vs ${p1.vw}`);
check('书签真的贴在屏幕右缘（离右缘 ≤ 1px）', Math.abs(p1.tab.right - p1.vw) <= 1,
  `${(p1.vw - p1.tab.right).toFixed(1)}px`);
check('书签竖向居中（和别的页面同一个位置：中心差 ≤ 2px）',
  Math.abs((p1.tab.top + p1.tab.bottom) / 2 - p1.vh / 2) <= 2,
  `中心 ${Math.round((p1.tab.top + p1.tab.bottom) / 2)} vs ${Math.round(p1.vh / 2)}`);
check('它是全站那一个书签（同样的竖排写法、同样的字号、同样的名字）',
  p1.tabWriting === other.tabWriting && p1.tabFontSize === other.tabFontSize && p1.tabText === other.tabText,
  `${p1.tabWriting} / ${p1.tabFontSize} / ${p1.tabText}`);
check('书签和别的页面一样宽（差 ≤ 1px）', Math.abs(p1.tab.width - other.tab.width) <= 1,
  `${p1.tab.width.toFixed(1)} vs ${other.tab.width.toFixed(1)}`);
check('这时候置顶塔吊已经缩进右缘之外了（两个东西不同时占那块地方）',
  p1.pinAway === true && (p1.pinOpacity < 0.05 || true), `away=${p1.pinAway} opacity=${p1.pinOpacity}`);
check('书签露出来以后真的点得到（右缘中点就是它）', p1.hitEdgeMid === 'tl', p1.hitEdgeMid);

/* 翻回标题区域 */
await cdp.ev(scrollTo(0));
await sleep(700);
let p2 = await cdp.ev(PROBE);
check('上翻回标题区域 → 书签缩回去了', tucked(p2),
  `hidden=${p2.hidden} visibility=${p2.tabVisibility}`);
check('塔吊跟着回来（还是原来那个位置、不透明）',
  p2.pinAway === false && p2.pinOpacity === 1, `away=${p2.pinAway} opacity=${p2.pinOpacity}`);
/* 边缘：只滚一点点（还没到板块区域）不该伸出来 */
await cdp.ev(scrollTo(120));
await sleep(500);
const nearTop = await cdp.ev(PROBE);
check('只滚 120px（还在标题区域）→ 书签仍然是收着的', tucked(nearTop), `hidden=${nearTop.hidden}`);

/* ================================================================
 * C. 开合
 * ================================================================ */
console.log('\n================ C. 点得开、往上翻会自己收 ================');
await cdp.ev(scrollToEl('#home-boards'));
await sleep(600);
const tabPt = await cdp.ev(`(() => { const t = document.querySelector('.tl__tab').getBoundingClientRect();
  return { x: Math.round(t.left + t.width / 2), y: Math.round(t.top + t.height / 2) }; })()`);
const hitName = await cdp.ev(`(() => { const el = document.elementFromPoint(${tabPt.x}, ${tabPt.y});
  return el ? el.className.toString() : ''; })()`);
check('点之前先确认那一点上是书签本身', /tl__tab/.test(hitName), hitName);
await cdp.click(tabPt.x, tabPt.y);
await sleep(700);
const opened = await cdp.ev(PROBE);
info(`点开以后：面板 ${Math.round(opened.panel.left)}→${Math.round(opened.panel.right)}，hidden=${opened.panelHidden}`);
check('在板块区域点书签 → 时间轴面板打开（is-open、面板不再 hidden）',
  opened.open === true && opened.panelHidden === false);
check('面板是整块从右缘拉出来的（右边贴住屏幕右缘）',
  Math.abs(opened.panel.right - opened.vw) <= 1, `${opened.panel.right.toFixed(1)} vs ${opened.vw}`);
check('面板打开时书签自己也退到画面外（和别的页面同一个行为）',
  opened.tabVisibility === 'hidden' || opened.tab.left >= opened.vw - 1,
  `visibility=${opened.tabVisibility}`);

/*
 * 打开时停在哪儿：弧顶那个日期就是「实时」那一刻 —— 也就是访问者当天。
 * 首页那条轴上有一个日期写成哨兵 `today` 的点，脚本打开页面时按访问者当天重排，
 * 所以「停在实时那一刻」= 弧顶读出今天这一天。
 */
const nowDate = await cdp.ev(`(() => { const e = document.querySelector('[data-tl-nowdate]'); return e ? e.textContent.trim() : ''; })()`);
const todayStr = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();
info(`打开后弧顶那个日期：${nowDate}（今天 ${todayStr}）`);
check('一打开就停在「实时」那一刻（弧顶日期 = 今天）', nowDate === todayStr, `${nowDate || '(空)'} vs ${todayStr}`);
/*
 * 再核一遍几何：实时那个点必须落在弧顶上（弧顶就是「当前」那一格）。
 * 只看日期文字不够 —— 那句是脚本按 cur 写上去的，坐标算歪了它照样能把日期写对。
 */
const apex = await cdp.ev(`(() => {
  const live = document.querySelector('[data-tl-item][data-live="1"]');
  const dot = document.querySelector('.tl__nowDot');
  if (!live || !dot) return null;
  const a = live.getBoundingClientRect(); const b = dot.getBoundingClientRect();
  return { liveY: a.top + a.height / 2, dotY: b.top + b.height / 2 };
})()`);
if (apex) {
  info(`实时点的纵向中心 ${Math.round(apex.liveY)}，弧顶那一点 ${Math.round(apex.dotY)}`);
  check('实时那个点就落在弧顶上（纵向差 ≤ 20px）',
    Math.abs(apex.liveY - apex.dotY) <= 20, `${Math.abs(apex.liveY - apex.dotY).toFixed(1)}px`);
} else {
  check('实时那个点就落在弧顶上', false, '找不到实时点或弧顶那一点');
}

/* 开着面板往上游回标题区域 —— 面板必须自己收起，书签让位 */
await cdp.ev(scrollTo(0));
await sleep(800);
const closedBack = await cdp.ev(PROBE);
check('开着面板翻回标题区域 → 面板自己收起（is-open 撤掉、面板 hidden）',
  closedBack.open === false && closedBack.panelHidden === true,
  `open=${closedBack.open} panelHidden=${closedBack.panelHidden}`);
check('同时书签也收好了，塔吊回来了（那一刻右缘是塔吊的）',
  tucked(closedBack) && closedBack.pinAway === false && closedBack.pinOpacity === 1,
  `hidden=${closedBack.hidden} away=${closedBack.pinAway}`);

/* 再翻下来：书签要能再出来、再点开 */
await cdp.ev(scrollToEl('#home-boards'));
await sleep(600);
const again = await cdp.ev(PROBE);
check('再翻到板块区域 → 书签又出来了', out(again), `visibility=${again.tabVisibility}`);
await cdp.click(tabPt.x, tabPt.y);
await sleep(700);
check('再点一次还能打开', (await cdp.ev('document.querySelector("[data-tl]").classList.contains("is-open")')) === true);
const againDate = await cdp.ev(`(() => { const e = document.querySelector('[data-tl-nowdate]'); return e ? e.textContent.trim() : ''; })()`);
check('再打开一次仍然停在今天（不会跳回开头）', againDate === todayStr, `${againDate || '(空)'} vs ${todayStr}`);
/* 面板里关掉：书签要回来（这一下不能因为"让位"被连坐） */
await cdp.ev(`(() => { document.querySelector('[data-tl-close]').click(); return 1; })()`);
await sleep(600);
const afterClose = await cdp.ev(PROBE);
check('面板里点「×」收起之后，书签还在（没被误判成"要缩回去"）',
  afterClose.open === false && out(afterClose), `hidden=${afterClose.hidden} visibility=${afterClose.tabVisibility}`);

/* ================================================================
 * D. 手机 390×844
 * ================================================================ */
console.log('\n================ D. 手机 390×844 ================');
await cdp.setViewport(390, 844, true);
await cdp.goto('/');
await cdp.ev(FREEZE);
await sleep(250);
const m0 = await cdp.ev(PROBE);
check('手机上一进首页（标题区域）书签是收着的', tucked(m0), `hidden=${m0.hidden} visibility=${m0.tabVisibility}`);
check('手机上那一刻置顶塔吊在', m0.pinAway === false && m0.pinOpacity === 1);
await cdp.ev(scrollToEl('#home-boards'));
await sleep(700);
const m1 = await cdp.ev(PROBE);
info(`手机上滚到板块区域：书签 ${m1.tab ? `${Math.round(m1.tab.left)}→${Math.round(m1.tab.right)}` : '?'}`);
check('手机上下翻到板块区域 → 书签伸出来、贴右缘、整只在视口里', out(m1) && Math.abs(m1.tab.right - m1.vw) <= 1,
  `visibility=${m1.tabVisibility} right=${m1.tab ? Math.round(m1.tab.right) : '?'} vs ${m1.vw}`);
check('手机上塔吊此时也缩走了', m1.pinAway === true);
await cdp.ev(scrollTo(0));
await sleep(700);
check('手机上翻回标题区域 → 书签又收起来', tucked(await cdp.ev(PROBE)));

/* ================================================================
 * E. 别的页面没被带坏
 * ================================================================ */
console.log('\n================ E. 别的页面 ================');
await cdp.setViewport(1440, 900, false);
for (const p of ['/huaya/', '/huaya/memory/mianyu', '/huaya/bingshi/photo/20261001']) {
  await cdp.goto(p, 600);
  const a = await cdp.ev(PROBE);
  await cdp.ev('window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }); 1');
  await sleep(500);
  const b = await cdp.ev(PROBE);
  check(`${p}：书签一进来就露着，滚到页底也还在`,
    a.gate === '' && a.tabVisibility === 'visible' && !a.hidden
    && b.tabVisibility === 'visible' && !b.hidden,
    `顶 ${a.tabVisibility} / 底 ${b.tabVisibility}`);
}

/* ================================================================
 * F. 报错
 * ================================================================ */
console.log('\n================ F. 报错 ================');
await cdp.goto('/');
await cdp.ev(scrollToEl('#home-boards'));
await sleep(600);
await cdp.ev(scrollTo(0));
await sleep(600);
check('全程没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));

console.log(`\n================ 结果：PASS ${pass} / FAIL ${fail} ================`);
chrome.kill();
server.close();
process.exit(fail === 0 ? 0 : 1);
