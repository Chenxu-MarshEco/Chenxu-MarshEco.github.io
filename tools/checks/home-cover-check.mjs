/*
 * 首页封面 +「大翻页」+ 三张小卡重排的验收（真浏览器）。
 *
 * 用户原话：
 *   「首页排版和我的要求完全不一样 你再看一遍这个图 重排一下这些卡片
 *     日历在甬城晴雨下方 且比较扁 和甬城晴雨一样宽 冰室冰山和每日精华的
 *     高和日历一样 冰室冰山的左侧对齐花娅陌域的左侧 每日精华的右侧对齐
 *     花娅陌域的右侧 然后为了欣赏城市背景 加一个大翻页功能 首次进入网页
 *     首页时，画面上只有城市背景和花涧堂logo 没有下方这些可以点击的卡片
 *     在屏幕下方加小字：点击进入花涧堂 点一下以后屏幕才会大滚动让这五个
 *     板块进入屏幕中 这时屏幕上方会出现一个小箭头 点一下又可以回到那个
 *     首页欣赏页面」
 *
 * 所以这里五段：
 *   A 封面：一进页面只有背景 + 徽记，五张卡片全在折线以下，底部有小字
 *   B 翻页：点小字 → 大滚动 → 五个板块都在屏幕里；小字消失、箭头出现
 *   C 回来：点箭头 → 回到最上面，小字又出现、箭头消失
 *   D 排版：日历同宽同左 = 甬城晴雨；冰室冰山左侧 = 花娅陌域左侧；
 *          每日精华右侧 = 花娅陌域右侧；三张一样高；日历够扁；
 *          顺带量三张小卡上文字在深色底上的对比度
 *   E 手机端：同样是一屏封面
 *
 * 用法：node tools/checks/home-cover-check.mjs [dist目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
const PORT = 4402;
const DEBUG_PORT = 9372;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
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

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error(`找不到 ${path.join(root, 'index.html')}，先构建`);
  process.exit(2);
}

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

const profile = path.join(process.env.TEMP ?? '.', `dsh-homecover-${Date.now()}`);
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
  async goto(p, wait = 2600) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 150; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
  }
  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await sleep(60);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(40);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
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
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

/* 量一次五张卡 + 封面 / 小字 / 箭头 */
const snap = () => cdp.ev(`(() => {
  const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect();
    return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height),
      right: Math.round(b.right), bottom: Math.round(b.bottom) }; };
  const cards = { board1: r('.boards .board:nth-child(1)'), board2: r('.boards .board:nth-child(2)'),
    cal: r('.cal'), ice: r('.ice'), daily: r('.daily') };
  const vh = window.innerHeight;
  const visible = [];
  const dbg = [];
  for (const k of Object.keys(cards)) {
    const bb = cards[k];
    /* ⚠ 这里必须用 bb.y（上面的 r() 把顶边叫 y，不叫 top）——
       踩过一次：写成 bb.top 恒为 undefined，比较恒为 false，于是"一张卡片都不在屏幕上"
       那段断言是**假通过**的（B 段反过来直接失败，才把它揪出来）。 */
    const ok = !!bb && bb.bottom > 0 && bb.y < vh && bb.w > 1 && bb.h > 1;
    if (ok) visible.push(k);
    dbg.push(k + ':' + (ok ? 'Y' : 'N') + '[' + (bb ? bb.y + ',' + bb.bottom + ',' + bb.w + ',' + bb.h : 'null') + ']');
  }
  const style = (s, k) => { const el = document.querySelector(s); return el ? getComputedStyle(el)[k] : null; };
  return {
    vh: vh, vw: window.innerWidth, scrollY: Math.round(window.scrollY),
    scrollH: document.documentElement.scrollHeight,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    brand: r('.brand'), logo: r('.brand__logo'), title: r('.brand__title'),
    cover: r('.cover'), boards: r('.boards'), extras: r('.extras'),
    cards: cards,
    visibleCards: visible,
    dbg: dbg,
    hint: r('.cover__hint'), hintOpacity: style('.cover__hint', 'opacity'), hintFontSize: style('.cover__hint', 'fontSize'),
    hintText: (document.querySelector('.cover__hint') || {}).textContent,
    arrow: r('.cards__arrow'), arrowOpacity: style('.cards__arrow', 'opacity'),
    bodyClass: document.body.className,
    boardsGap: style('.boards', 'columnGap'), extrasGap: style('.extras__grid', 'columnGap'),
  };
})()`);

console.log('\n================ A. 首次进入：只有背景 + 徽记 ================');
await cdp.goto('/');
const a = await snap();
console.log(JSON.stringify({ scrollY: a.scrollY, vh: a.vh, cover: a.cover, cards: a.cards, visible: a.visibleCards, hint: a.hint }, null, 0));
check('一进页面停在最上面', a.scrollY === 0, `scrollY=${a.scrollY}`);
check('徽记（花涧堂 logo）在第一屏里', a.logo && a.logo.y >= 0 && a.logo.bottom < a.vh, JSON.stringify(a.logo));
check('第一屏里**一张卡片都没有**（五张全在折线以下，且留有余量）', a.visibleCards.length === 0 &&
  Math.min(...Object.values(a.cards).filter(Boolean).map((x) => x.y)) >= a.vh + 8,
  `可见卡片 ${JSON.stringify(a.visibleCards)}；最近的卡片顶边 ${Math.min(...Object.values(a.cards).filter(Boolean).map((x) => x.y))}px / 视口 ${a.vh}px`);
check('封面至少铺满一整屏（底边在折线以下，多伸出来的是一片背景）',
  a.cover.bottom >= a.vh && a.cover.bottom <= a.vh + 120 && a.cover.h >= a.vh * 0.7,
  `封面 ${a.cover.y}~${a.cover.bottom}px（高 ${a.cover.h}）/ 视口 ${a.vh}px`);
check('屏幕下方有那行小字「点击进入花涧堂」', /点击进入花涧堂/.test(a.hintText || '') && a.hint && a.hint.y > a.vh * 0.6,
  `文字「${(a.hintText || '').trim()}」，位置 y=${a.hint?.y}（视口 ${a.vh}）`);
check('小字是"小字"（字号 ≤ 15px）', parseFloat(a.hintFontSize) <= 15, `font-size=${a.hintFontSize}`);
check('这时候上面那个小箭头是藏着的', a.arrowOpacity === '0', `opacity=${a.arrowOpacity}`);
check('页面没有横向溢出', a.overflowX <= 1, `溢出 ${a.overflowX}px`);

console.log('\n================ B. 点一下 → 大滚动 → 五个板块进屏幕 ================');
const hintBox = await cdp.ev(`(() => { const b = document.querySelector('.cover__hint').getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
await cdp.click(hintBox.x, hintBox.y);
let b = null;
for (let i = 0; i < 24; i++) { b = await snap(); if (b.visibleCards.length >= 5) break; await sleep(250); }
await sleep(400);
b = await snap();
console.log(JSON.stringify({ scrollY: b.scrollY, vh: b.vh, visible: b.visibleCards, dbg: b.dbg, hintOpacity: b.hintOpacity, arrowOpacity: b.arrowOpacity, bodyClass: b.bodyClass }, null, 0));
check('点一下小字就发生了一次**大滚动**（滚过半个屏幕以上）', b.scrollY > a.vh * 0.5, `scrollY ${a.scrollY} → ${b.scrollY}（视口 ${a.vh}）`);
check('五个板块（两大 + 三小）都进屏幕了', b.visibleCards.length === 5, `可见 ${JSON.stringify(b.visibleCards)}（视口 ${b.vh}）`);
check('滚过去以后屏幕上方出现小箭头', b.arrowOpacity === '1', `arrow opacity=${b.arrowOpacity}，body=${b.bodyClass}`);
check('小字这时淡掉了', b.hintOpacity === '0', `hint opacity=${b.hintOpacity}`);
check('翻页后没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

console.log('\n================ C. 点箭头 → 回到欣赏页 ================');
const arrowBox = await cdp.ev(`(() => { const b = document.querySelector('.cards__arrow').getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), w: Math.round(b.width), h: Math.round(b.height) }; })()`);
check('箭头在屏幕上方、点得到', arrowBox.y > 0 && arrowBox.y < 200 && arrowBox.w >= 24 && arrowBox.h >= 24, JSON.stringify(arrowBox));
await cdp.click(arrowBox.x, arrowBox.y);
let c = null;
for (let i = 0; i < 24; i++) { c = await snap(); if (c.scrollY < 8) break; await sleep(250); }
await sleep(400);
c = await snap();
console.log(JSON.stringify({ scrollY: c.scrollY, visible: c.visibleCards, hintOpacity: c.hintOpacity, arrowOpacity: c.arrowOpacity }, null, 0));
check('点箭头回到欣赏页（滚回最上面）', c.scrollY < 8, `scrollY=${c.scrollY}`);
check('回到欣赏页后小字又出现、箭头又藏起来', c.hintOpacity === '1' && c.arrowOpacity === '0',
  `hint=${c.hintOpacity} arrow=${c.arrowOpacity}`);
check('回到欣赏页后卡片又都不在屏幕上', c.visibleCards.length === 0, JSON.stringify(c.visibleCards));
check('这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

console.log('\n================ D. 三张小卡的重排（都按 rect 量）================');
/* 滚到卡片区（用文档坐标算：offsetTop 是相对 .home 的，不能直接用） */
await cdp.ev(`(() => { const el = document.getElementById('home-boards');
  window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - 80)); return true; })()`);
await sleep(700);
const d = await snap();
const near = (x, y, tol = 2) => Math.abs(x - y) <= tol;
const b1 = d.cards.board1;
const b2 = d.cards.board2;
const cal = d.cards.cal;
const ice = d.cards.ice;
const daily = d.cards.daily;
console.log(JSON.stringify({ board1: b1, board2: b2, cal, ice, daily, boardsGap: d.boardsGap, extrasGap: d.extrasGap }, null, 0));
check('日历在「甬城晴雨」下方（它的顶边在板块底边之下）', cal.y >= b1.bottom, `日历顶 ${cal.y} / 甬城晴雨底 ${b1.bottom}（视口坐标，滚了 ${d.scrollY}）`);
check('日历经度和「甬城晴雨」一样宽（±2px）', near(cal.w, b1.w), `${cal.w} vs ${b1.w}`);
check('日历左边和「甬城晴雨」左边对齐（±2px）', near(cal.x, b1.x), `${cal.x} vs ${b1.x}`);
check('日历"比较扁"（高 < 宽的 70%）', cal.h < cal.w * 0.7, `日历 ${cal.w}×${cal.h}（高/宽 = ${(cal.h / cal.w).toFixed(2)}）`);
check('冰室冰山左侧对齐「花娅陌域」左侧（±2px）', near(ice.x, b2.x), `${ice.x} vs ${b2.x}`);
check('每日精华右侧对齐「花娅陌域」右侧（±2px）', near(daily.right, b2.right), `${daily.right} vs ${b2.right}`);
check('冰室冰山和每日精华在「花娅陌域」那一列里并排（都在它的左右边之内、互不重叠）',
  ice.x >= b2.x - 2 && daily.right <= b2.right + 2 && ice.right <= daily.x,
  `ice ${ice.x}~${ice.right} / daily ${daily.x}~${daily.right} / 花娅陌域 ${b2.x}~${b2.right}`);
check('三张卡一样高（±2px）——日历 / 冰室冰山 / 每日精华',
  near(cal.h, ice.h) && near(ice.h, daily.h), `${cal.h} / ${ice.h} / ${daily.h}`);
check('三张卡在同一行上（顶边相差 ≤2px）', near(cal.y, ice.y) && near(ice.y, daily.y), `${cal.y} / ${ice.y} / ${daily.y}`);
check('三张小卡在两大板块下方（整行都在板块底边之下）', Math.min(cal.y, ice.y, daily.y) >= b1.bottom, `小卡顶 ${Math.min(cal.y, ice.y, daily.y)} / 板块底 ${b1.bottom}`);
check('两张小卡之间用的是正常间距（不是 13% 那种大缝）', daily.x - ice.right > 4 && daily.x - ice.right < 60, `间距 ${daily.x - ice.right}px`);
check('卡片宽度没被挤扁（每日精华 ≥ 180px）', daily.w >= 180, `每日精华宽 ${daily.w}px`);
check('整页不横向溢出（卡片区也不越界）', d.overflowX <= 1 && Math.max(b2.right, daily.right) <= d.vw, `溢出 ${d.overflowX}px，最右 ${Math.max(b2.right, daily.right)} / 视口 ${d.vw}`);

/* 三张小卡上文字的对比度（深色卡上用浅色主题令牌 = 读不清，这一轮顺手修了） */
const contrast = await cdp.ev(`(() => {
  const lum = (c) => { const m = String(c).match(/[\\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  const ratio = (fg, bg) => { const a = lum(fg), b = lum(bg); const hi = Math.max(a, b), lo = Math.min(a, b); return +((hi + 0.05) / (lo + 0.05)).toFixed(2); };
  const cardBg = 'rgb(38, 6, 54)';
  const out = {};
  for (const s of ['.daily__text', '.daily__time', '.daily__more', '.cal__wd', '.ice__title', '.cal__today']) {
    const el = document.querySelector(s);
    out[s] = el ? ratio(getComputedStyle(el).color, cardBg) : null;
  }
  return out; })()`);
console.log('\n深色卡上文字对比度：', JSON.stringify(contrast));
const bad = Object.entries(contrast).filter(([, v]) => v !== null && v < 4.5);
check('三张小卡上的文字在深色底上都读得清（对比度 ≥ 4.5）', bad.length === 0,
  bad.length ? `不达标：${bad.map(([k, v]) => `${k}=${v}`).join('、')}` : '全部达标');

/* 手机端 */
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp.goto('/');
const m = await snap();
console.log('\n================ E. 手机端（390×844）================');
console.log(JSON.stringify({ cover: m.cover, visible: m.visibleCards, hint: m.hint, logo: m.logo, vh: m.vh }, null, 0));
check('手机端一进页面也是一屏封面（徽记在、卡片不在）', m.visibleCards.length === 0 && m.logo.y >= 0 && m.logo.bottom < m.vh,
  `可见卡片 ${JSON.stringify(m.visibleCards)}；徽记 ${JSON.stringify(m.logo)}`);
check('手机端小字也在屏幕下方', m.hint && m.hint.y > m.vh * 0.55, `y=${m.hint?.y} / ${m.vh}`);
check('手机端不横向溢出', m.overflowX <= 1, `溢出 ${m.overflowX}px`);
check('手机端没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

/* ================================================================
 * E2. 手机端也能"点一下进、点箭头回"（触屏上要真点得动）
 * ================================================================ */
console.log('\n================ E2. 手机端：点小字进 / 点箭头回 ================');
const mHint = await cdp.ev(`(() => { const b = document.querySelector('.cover__hint').getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), w: Math.round(b.width), h: Math.round(b.height) }; })()`);
check('手机端那行小字点得到（够大）', mHint.w >= 90 && mHint.h >= 24, JSON.stringify(mHint));
await cdp.click(mHint.x, mHint.y);
let m2 = null;
for (let i = 0; i < 24; i++) { m2 = await snap(); if (m2.scrollY > m.vh * 0.3) break; await sleep(250); }
await sleep(500);
m2 = await snap();
console.log(JSON.stringify({ scrollY: m2.scrollY, vh: m2.vh, boards: m2.cards.board1, arrowOpacity: m2.arrowOpacity }, null, 0));
check('手机端点一下 → 往下滚到卡片区（大板块顶边进屏幕上半部分）',
  m2.scrollY > m.vh * 0.3 && m2.cards.board1.y > -60 && m2.cards.board1.y < m2.vh * 0.6,
  `scrollY ${m.scrollY} → ${m2.scrollY}（视口 ${m2.vh}）；大板块顶边 ${m2.cards.board1.y}px`);
check('手机端滚过去以后上方小箭头出现', m2.arrowOpacity === '1', `opacity=${m2.arrowOpacity}`);
const mArrow = await cdp.ev(`(() => { const b = document.querySelector('.cards__arrow').getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), w: Math.round(b.width), h: Math.round(b.height) }; })()`);
check('手机端小箭头点得到', mArrow.y > 0 && mArrow.y < 240 && mArrow.w >= 28, JSON.stringify(mArrow));
await cdp.click(mArrow.x, mArrow.y);
let m3 = null;
for (let i = 0; i < 24; i++) { m3 = await snap(); if (m3.scrollY < 8) break; await sleep(250); }
await sleep(400);
m3 = await snap();
console.log(JSON.stringify({ scrollY: m3.scrollY, visible: m3.visibleCards, hintOpacity: m3.hintOpacity, arrowOpacity: m3.arrowOpacity }, null, 0));
check('手机端点箭头回到欣赏页（滚回最上面、卡片又都不在屏幕上）', m3.scrollY < 8 && m3.visibleCards.length === 0,
  `scrollY=${m3.scrollY} 可见 ${JSON.stringify(m3.visibleCards)}`);
check('手机端回到欣赏页后小字又出现', m3.hintOpacity === '1', `hint=${m3.hintOpacity}`);
check('手机端这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

/* ================================================================
 * F. 别的屏幕比例：封面照样挡住卡片、四句对齐关系照样成立
 * ----------------------------------------------------------------
 * 用户要的是"在所有屏幕比例里几乎都占满"的那一类要求（他这次说的是排版），
 * 所以这里换一堆常见分辨率逐个量，而不是只看 1440×900。
 * ================================================================ */
const SIZES = [
  { w: 1920, h: 1080, label: '1920×1080' },
  { w: 1600, h: 900, label: '1600×900' },
  { w: 1280, h: 800, label: '1280×800' },
  { w: 1024, h: 768, label: '1024×768' },
  { w: 1280, h: 620, label: '1280×620（矮屏）' },
  { w: 900, h: 900, label: '900×900（窄桌面）' },
];
console.log('\n================ F. 别 的 屏 幕 比 例 ================');
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
for (const s of SIZES) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: false });
  await cdp.goto('/');
  await cdp.ev('window.scrollTo(0, 0), true');
  await sleep(500);
  const first = await snap();
  const nearest = Math.min(...Object.values(first.cards).filter(Boolean).map((x) => x.y));
  const hides = first.visibleCards.length === 0 && nearest >= first.vh + 8;
  /* 滚到卡片区再量对齐（用文档坐标算） */
  await cdp.ev(`(() => { const el = document.getElementById('home-boards');
    window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - 80)); return true; })()`);
  await sleep(700);
  const g = await snap();
  const [b1, b2, cal2, ice2, daily2] = [g.cards.board1, g.cards.board2, g.cards.cal, g.cards.ice, g.cards.daily];
  const alignOk =
    near(cal2.w, b1.w) && near(cal2.x, b1.x) && near(ice2.x, b2.x) && near(daily2.right, b2.right) &&
    near(cal2.h, ice2.h) && near(ice2.h, daily2.h) && near(cal2.y, ice2.y) && near(ice2.y, daily2.y);
  const flatOk = cal2.h < cal2.w * 0.7;
  console.log(
    `${s.label}: 折线以下=${hides}（最近卡片顶边 ${nearest} / 视口 ${first.vh}）｜` +
    `对齐=${alignOk}（日历 ${cal2.x}~${cal2.right} w${cal2.w} h${cal2.h}；冰山 x${ice2.x}；每日精华 右${daily2.right}；花娅陌域 ${b2.x}~${b2.right}）｜` +
    `溢出 ${g.overflowX}px`
  );
  check(`${s.label}：一进页面还是只有背景 + 徽记（卡片全在折线以下）`, hides, `最近卡片顶边 ${nearest} / 视口 ${first.vh}`);
  check(`${s.label}：四句对齐要求照样成立（同宽同左 / 左对齐 / 右对齐 / 三张一样高）`, alignOk,
    `cal ${cal2.x} w${cal2.w} h${cal2.h} / ice x${ice2.x} h${ice2.h} / daily right${daily2.right} h${daily2.h} / 花娅陌域 ${b2.x}~${b2.right} w${b2.w}`);
  check(`${s.label}：日历是扁的（高 < 宽的 70%）且两张小卡没被压成一条`, flatOk && daily2.w >= 150, `日历 ${cal2.w}×${cal2.h}，每日精华宽 ${daily2.w}`);
  check(`${s.label}：不横向溢出`, g.overflowX <= 1, `溢出 ${g.overflowX}px`);
  check(`${s.label}：没有 JS 报错`, cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));
}

/* ================================================================
 * G. 卡片"里面"没被挤坏：日历格子不压到右下角小框、三张卡的内容都在卡片里
 * ================================================================ */
console.log('\n================ G. 卡片内部（没被挤坏 / 没被裁掉）================');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp.goto('/');
await cdp.ev(`(() => { const el = document.getElementById('home-boards');
  window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - 80)); return true; })()`);
await sleep(700);
const inside = await cdp.ev(`(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, w: b.width, h: b.height }; };
  const card = (s) => document.querySelector(s);
  const cal = card('.cal');
  const days = [...cal.querySelectorAll('.cal__day')];
  const today = cal.querySelector('.cal__today');
  const grid = cal.querySelector('.cal__grid');
  const calR = r(cal), todayR = r(today), gridR = grid ? r(grid) : null;
  const daysOut = days.filter((d) => { const b = r(d); return b.t < calR.t - 1 || b.b > calR.b + 1 || b.l < calR.l - 1 || b.r > calR.r + 1; }).length;
  const dailyCard = card('.daily__card');
  const dailyTitle = card('.daily__title');
  const dailyR = r(dailyCard), dTitleR = r(dailyTitle);
  const ice = card('.ice');
  const iceArt = card('.ice__art');
  const iceTitle = card('.ice__title');
  const iceR = r(ice), artR = r(iceArt), iceTitleR = r(iceTitle);
  const dailyFaces = r(card('.daily__face'));
  return {
    calDays: days.length,
    calGridBottom: gridR ? Math.round(gridR.b) : null,
    calTodayTop: Math.round(todayR.t),
    gridOverlapsToday: gridR ? gridR.b > todayR.t + 1 : null,
    daysOutside: daysOut,
    todayInside: todayR.b <= calR.b + 1 && todayR.r <= calR.r + 1 && todayR.t >= calR.t - 1,
    dailyOverflow: Math.round(dailyCard.scrollHeight - dailyCard.clientHeight),
    /* 标题在**外卡片**的页头那一行里（内卡片是下面装正文的那张），所以跟外卡片比 */
    dailyTitleInside: dTitleR.t >= r(card('.daily')).t - 1 && dTitleR.b <= r(card('.daily')).b + 1 &&
      dTitleR.l >= r(card('.daily')).l - 1 && dTitleR.r <= r(card('.daily')).r + 1,
    dailyFacesInside: dailyFaces.t >= dailyR.t - 1 && dailyFaces.b <= dailyR.b + 1,
    dbg: {
      dailyOuter: { t: Math.round(r(card('.daily')).t), b: Math.round(r(card('.daily')).b), scroll: card('.daily').scrollHeight, client: card('.daily').clientHeight },
      head: { t: Math.round(r(card('.daily__head')).t), b: Math.round(r(card('.daily__head')).b) },
      innerCard: { t: Math.round(dailyR.t), b: Math.round(dailyR.b) },
      title: { t: Math.round(dTitleR.t), b: Math.round(dTitleR.b), r: Math.round(dTitleR.r) },
      faces: { t: Math.round(dailyFaces.t), b: Math.round(dailyFaces.b), r: Math.round(dailyFaces.r) },
    },
    iceArtH: Math.round(artR.h),
    iceTitleInside: iceTitleR.t >= iceR.t - 1 && iceTitleR.b <= iceR.b + 1 && iceTitleR.r <= iceR.r + 1,
    /* 图在上面、标题在下面，不能叠在一起 */
    iceBodyBelowArt: Math.round(iceTitleR.t) >= Math.round(artR.b) - 1,
    cardH: Math.round(calR.h),
  };
})()`);
console.log(JSON.stringify(inside));
check('日历：整个月的格子都在卡片里（没被裁掉）', inside.daysOutside === 0 && inside.calDays >= 28,
  `格子 ${inside.calDays} 个，跑出卡片的 ${inside.daysOutside} 个`);
check('日历：格子没有压在右下角那个小框上（网格底边在小框顶边之上）', inside.gridOverlapsToday === false,
  `网格底 ${inside.calGridBottom} / 小框顶 ${inside.calTodayTop}`);
check('日历：右下角小框本身在卡片里', inside.todayInside === true);
check('每日精华：内容没有溢出那张内卡片（超出的会被裁掉）', inside.dailyOverflow <= 2, `scrollHeight-clientHeight = ${inside.dailyOverflow}px`);
check('每日精华：标题和成员头像都在卡里', inside.dailyTitleInside === true && inside.dailyFacesInside === true);
check('冰室冰山：图在上面、标题在下面（没叠在一起），标题也在卡里', inside.iceBodyBelowArt === true && inside.iceTitleInside === true,
  `图高 ${inside.iceArtH}px`);

try { await cdp.send('Browser.close'); } catch { /* ignore */ }
chrome.kill();
server.close();
console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
