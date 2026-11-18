/*
 * 首页那两张新卡（2026-11-17）的验收 —— 真构建产物、真浏览器、真服务端。
 *
 * 站长原话（照抄）：
 *   「在涣源溪水钟下方加一个同尺寸的卡片 先不要做东西 留着占位」
 *   「在冰室冰山和每日精华下方也加两个同尺寸的卡片 左边是涣愿终池的入口
 *    和冰室冰山一样可以传封面图 右边是花娅远位面 直接照搬花娅陌域里那个我已经
 *    做好的花娅远位面即可 但是要压缩一下长宽让这两个卡片和上面冰山精华的小卡片
 *    一样大且对齐」
 *   「花娅远位面的首页卡和花娅陌域里的花娅远位面卡同步 如果以后多了什么栏目
 *    映射到首页同步更新」
 *
 * 所以这里盯这些事：
 *   ① 三张新卡都在、位置对（日历下方 / 冰山精华下方并排）；
 *   ② **尺寸对齐**：预留卡和日历同宽同高；涣愿终池 / 花娅远位面跟上面那两张小卡
 *      一样宽一样高、左右边缘对齐；
 *   ③ 预留卡默认是**空的**（一个字都没有，站规）；
 *   ④ 涣愿终池卡：是链接、指向那一页、能传封面图（没传时是占位不是黑洞）；
 *   ⑤ 花娅远位面卡：标题 / 地址 / 子栏目**全部来自版块树**（改树就跟着变，
 *      不是抄一份数据在首页）；
 *   ⑥ 换屏幕宽度、换月份（日历 5 行 / 6 行）之后对齐关系照样成立。
 *
 * 用法：node tools/checks/home-cards-check.mjs [dist目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromePath } from './lib/chrome.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
const PORT = 4511;
const DEBUG_PORT = 9511;
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

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error(`找不到 ${path.join(root, 'index.html')}，先构建`);
  process.exit(2);
}

/* 版块树：花娅远位面那张卡必须和它一致（不是抄一份数据在首页） */
const boards = JSON.parse(fs.readFileSync(path.resolve('src/data/home-boards.json'), 'utf8'));
const findNode = (nodes, id) => {
  for (const n of nodes ?? []) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
};
const farland = findNode(boards.boards, 'huaya-r3');
const widgets = JSON.parse(fs.readFileSync(path.resolve('src/data/home-widgets.json'), 'utf8'));

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

const profile = path.join(process.env.TEMP ?? '.', `dsh-homecards-${Date.now()}`);
const chrome = spawn(
  CHROME,
  ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
   '--disable-breakpad', '--window-size=1440,1000', `--user-data-dir=${profile}`,
   `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' }
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
  async goto(p, wait = 2200) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 150; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
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

/** 量一次首页那一屏：所有卡的盒子 + 顺序 */
const snap = async () => {
  await cdp.ev(`(() => { const el = document.querySelector('.extras');
    if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' }); return true; })()`);
  await sleep(500);
  return cdp.ev(`(() => {
    const box = (s) => { const n = document.querySelector(s); if (!n) return null;
      const r = n.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top + window.scrollY), w: Math.round(r.width),
        h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom + window.scrollY) }; };
    return {
      cal: box('#home-cal'),
      ice: box('.ice'),
      daily: box('.daily'),
      placeholder: box('#home-placeholder'),
      cistern: box('#home-cistern'),
      farland: box('#home-farland'),
      pairUnder: box('.extras__pair--under'),
      kids: [...document.querySelectorAll('.extras__grid > *')].map((n) => n.id || n.className),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`);
};

const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

/* ------------------------------------------------------------------ ① 位置 */
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await cdp.goto('/');
const g = await snap();
info(`1440：日历 ${JSON.stringify(g.cal)}`);
info(`1440：预留卡 ${JSON.stringify(g.placeholder)}`);
info(`1440：涣愿终池 ${JSON.stringify(g.cistern)} / 花娅远位面 ${JSON.stringify(g.farland)}`);

check('★ 三张新卡都在页面上（预留卡 / 涣愿终池 / 花娅远位面）',
  !!g.placeholder && !!g.cistern && !!g.farland, JSON.stringify({ 预留: !!g.placeholder, 终池: !!g.cistern, 远位面: !!g.farland }));
check('★ 预留卡在「涣源溪水钟」**正下方**（同一列、顶边在日历底边之下）',
  !!g.placeholder && near(g.placeholder.x, g.cal.x) && g.placeholder.y >= g.cal.bottom - 1,
  JSON.stringify({ 预留: g.placeholder, 日历底: g.cal?.bottom }));
check('★ 涣愿终池 / 花娅远位面在「冰室冰山 / 每日精华」**正下方**',
  !!g.cistern && !!g.farland && g.cistern.y >= g.ice.bottom - 1 && g.farland.y >= g.daily.bottom - 1,
  JSON.stringify({ 终池顶: g.cistern?.y, 冰山底: g.ice?.bottom, 远位面顶: g.farland?.y, 精华底: g.daily?.bottom }));
check('涣愿终池在左、花娅远位面在右（和上面冰山 / 精华同一个左右关系）',
  g.cistern.x < g.farland.x && near(g.cistern.x, g.ice.x) && near(g.farland.right, g.daily.right),
  JSON.stringify({ 终池x: g.cistern?.x, 冰山x: g.ice?.x, 远位面右: g.farland?.right, 精华右: g.daily?.right }));

/* ------------------------------------------------------------------ ② 尺寸对齐 */
check('★ 预留卡和日历**同宽同高**（±2px）',
  near(g.placeholder.w, g.cal.w) && near(g.placeholder.h, g.cal.h),
  `${g.placeholder.w}×${g.placeholder.h} vs ${g.cal.w}×${g.cal.h}`);
check('★ 涣愿终池 / 花娅远位面跟上面那两张小卡**一样宽一样高**（±2px）',
  near(g.cistern.w, g.ice.w) && near(g.cistern.h, g.ice.h) &&
    near(g.farland.w, g.daily.w) && near(g.farland.h, g.daily.h),
  `终池 ${g.cistern.w}×${g.cistern.h} vs 冰山 ${g.ice.w}×${g.ice.h}；远位面 ${g.farland.w}×${g.farland.h} vs 精华 ${g.daily.w}×${g.daily.h}`);
check('★ 两张新卡和上面那一行**底边对齐**（同一行高）',
  near(g.cistern.bottom, g.farland.bottom) && near(g.cistern.h, g.farland.h),
  `${g.cistern.bottom} / ${g.farland.bottom}`);
check('加了这三张卡之后首页没有横向溢出', g.overflowX <= 1, `${g.overflowX}px`);

/* ------------------------------------------------------------------ ③ 预留卡默认是空的 */
const ph = await cdp.ev(`(() => {
  const n = document.querySelector('#home-placeholder');
  if (!n) return null;
  return {
    text: (n.innerText || '').trim(),
    tag: n.tagName,
    dashed: getComputedStyle(n).borderTopStyle,
    hasImg: !!n.querySelector('img'),
  };
})()`);
check('★ 预留卡默认**一个字都没有**（站规：不许自己写文案）',
  !!ph && ph.text === '', JSON.stringify(ph?.text));
check('预留卡空着时是虚线框（看得出"这里留了位置"）', ph?.dashed === 'dashed', ph?.dashed);
check('预留卡空着时不是链接（点了不该装作能点）', ph?.tag !== 'A', ph?.tag);

/* ------------------------------------------------------------------ ④ 涣愿终池卡 */
const cist = await cdp.ev(`(() => {
  const n = document.querySelector('#home-cistern');
  if (!n) return null;
  return {
    tag: n.tagName,
    href: n.getAttribute('href'),
    title: (n.querySelector('.cistcard__title') || {}).textContent || '',
    hasImg: !!n.querySelector('img'),
    hasPh: !!n.querySelector('.cistcard__ph'),
    cursor: getComputedStyle(n).cursor,
  };
})()`);
check('★ 涣愿终池那张卡是链接，指向 /memoriterminalcistern',
  cist?.tag === 'A' && cist.href === '/memoriterminalcistern', JSON.stringify(cist));
check('涣愿终池卡上有标题（数据里那个，不是写死的）',
  cist?.title === (widgets.cistern?.title || '涣愿终池'), JSON.stringify(cist?.title));
check('★ 还没传封面图时画的是占位（不是一块黑洞）',
  cist?.hasImg === false && cist?.hasPh === true, JSON.stringify({ img: cist?.hasImg, ph: cist?.hasPh }));
check('涣愿终池卡是能点的手型光标', cist?.cursor === 'pointer', cist?.cursor);

/* ------------------------------------------------------------------ ⑤ 花娅远位面卡跟着版块树走 */
const far = await cdp.ev(`(() => {
  const n = document.querySelector('#home-farland');
  if (!n) return null;
  return {
    title: (n.querySelector('.far__name') || {}).textContent || '',
    href: (n.querySelector('.far__name') || {}).getAttribute('href'),
    kids: [...n.querySelectorAll('.far__card')].map((a) => ({
      text: (a.querySelector('.far__label') || {}).textContent || '',
      href: a.getAttribute('href'),
      cover: !!a.style.getPropertyValue('--cover'),
    })),
    scrollable: (() => { const s = n.querySelector('.far__scroll'); return s ? s.scrollHeight > s.clientHeight : false; })(),
  };
})()`);
const wantKids = (farland?.children ?? []).filter((c) => c.standalone !== true);
check('★ 花娅远位面卡的标题 = 版块树里那一项（不是抄一份数据）',
  far?.title === farland?.title, `${far?.title} vs ${farland?.title}`);
check('★ 它的地址也来自版块树', far?.href === (farland?.href || '/huaya/farland'), `${far?.href} vs ${farland?.href}`);
check(`★ 子栏目和 /huaya 上那一块**完全一致**（${wantKids.length} 个，顺序也一样）`,
  JSON.stringify(far?.kids.map((k) => k.text)) === JSON.stringify(wantKids.map((k) => k.title)),
  JSON.stringify({ 首页: far?.kids.map((k) => k.text), 版块树: wantKids.map((k) => k.title) }));
check('子栏目里带封面的那几张，首页也带着封面（不是只剩名字）',
  far?.kids.some((k) => k.cover) === wantKids.some((k) => String(k.image ?? '').trim()),
  JSON.stringify(far?.kids.map((k) => k.cover)));
check('清单区自己滚（卡片再多也不会把首页那一行顶高）', far?.scrollable === true, String(far?.scrollable));

/* 和 /huaya 上那一块对一遍：名字集合必须一样 */
await cdp.goto('/huaya', 1600);
const huayaKids = await cdp.ev(`(() => {
  const block = [...document.querySelectorAll('.block')].find((b) => (b.querySelector('.block__name') || {}).textContent === '花娅远位面');
  if (!block) return null;
  return [...block.querySelectorAll('.card__label')].map((n) => n.textContent.trim());
})()`);
check('★ 首页那张卡的子栏目和 /huaya 上「花娅远位面」那一块**一模一样**',
  !!huayaKids && JSON.stringify(huayaKids) === JSON.stringify(far?.kids.map((k) => k.text)),
  JSON.stringify({ huaya: huayaKids, 首页: far?.kids.map((k) => k.text) }));

/* ------------------------------------------------------------------ ⑥ 换屏幕 / 换月份 */
console.log('\n================ 换屏幕宽度 ================');
for (const w of [1920, 1280, 1024, 900]) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.goto('/');
  const s = await snap();
  const ok =
    near(s.placeholder.w, s.cal.w) && near(s.placeholder.h, s.cal.h) &&
    near(s.cistern.w, s.ice.w) && near(s.cistern.h, s.ice.h) &&
    near(s.farland.w, s.daily.w) && near(s.farland.h, s.daily.h) &&
    near(s.cistern.bottom, s.farland.bottom);
  check(`${w}：三张新卡和上面那几张照样同宽同高、底边齐平`, ok,
    `预留 ${s.placeholder.w}×${s.placeholder.h} / 日历 ${s.cal.w}×${s.cal.h}；` +
      `终池 ${s.cistern.w}×${s.cistern.h} / 冰山 ${s.ice.w}×${s.ice.h}；` +
      `远位面 ${s.farland.w}×${s.farland.h} / 精华 ${s.daily.w}×${s.daily.h}`);
  check(`${w}：不横向溢出`, s.overflowX <= 1, `${s.overflowX}px`);
}

console.log('\n================ 换月份（日历 5 行 / 6 行）================');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await cdp.goto('/');
const monthHeights = [];
for (let i = 0; i < 4; i++) {
  const s = await snap();
  const rows = await cdp.ev(`(() => {
    const g = document.querySelector('.cal__grid');
    return g ? getComputedStyle(g).gridTemplateRows.split(' ').length : 0; })()`);
  monthHeights.push({ rows, calH: s.cal.h, phH: s.placeholder.h, same: near(s.cal.h, s.placeholder.h) });
  await cdp.ev(`(() => { const b = document.querySelector('[data-cal-next]'); if (b) b.click(); return true; })()`);
  await sleep(500);
}
info(`四个月：${JSON.stringify(monthHeights)}`);
check('★ 翻月之后预留卡照样和日历一样高（每个月都对得上）',
  monthHeights.every((m) => m.same), JSON.stringify(monthHeights));
/*
  日历的格子是**固定 6 行**（`--cal-cell` 定死、行数不随月份变），
  所以"换个月高度就变"这件事本身不会发生 —— 这里验的是**它真的没变**：
  四个月量下来高度必须一模一样，预留卡也就一直跟得住。
  （万一以后有人把行数改成按月份给，这条会红，提醒他去看预留卡还跟不跟得上。）
*/
check('日历四个月高度一致（格子固定 6 行，预留卡因此一直跟得住）',
  new Set(monthHeights.map((m) => m.calH)).size === 1 && monthHeights.every((m) => m.rows === 6),
  JSON.stringify(monthHeights.map((m) => `${m.rows}行/${m.calH}px`)));

/* ------------------------------------------------------------------ ⑦ 手机端 */
console.log('\n================ 手机端（单列）================');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp.goto('/');
const m = await snap();
check('手机端：三张新卡都在、竖着堆（单列，不并排）',
  !!m.placeholder && !!m.cistern && !!m.farland && m.cistern.y > m.ice.bottom - 1 && m.farland.y > m.cistern.bottom - 1,
  JSON.stringify({ 冰山底: m.ice?.bottom, 终池顶: m.cistern?.y, 远位面顶: m.farland?.y }));
check('手机端：不横向溢出', m.overflowX <= 1, `${m.overflowX}px`);

/* ------------------------------------------------------------------ 收尾 */
const errs = cdp.errors.filter(Boolean);
check('整场没有脚本报错', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log(`\nPASS ${pass} / FAIL ${fail}`);
try { chrome.kill(); } catch { /* 已退 */ }
server.close();
process.exit(fail ? 1 : 0);
