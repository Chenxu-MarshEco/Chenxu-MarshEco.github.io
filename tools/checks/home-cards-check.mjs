/*
 * 首页那几张卡的验收 —— 真构建产物、真浏览器、真服务端。
 *
 * 站长原话（照抄）：
 *   「在涣源溪水钟下方加一个同尺寸的卡片 先不要做东西 留着占位」
 *   「在冰室冰山和每日精华下方也加两个同尺寸的卡片 左边是涣愿终池的入口
 *    和冰室冰山一样可以传封面图 右边是花娅远位面 直接照搬花娅陌域里那个我已经
 *    做好的花娅远位面即可 但是要压缩一下长宽让这两个卡片和上面冰山精华的小卡片
 *    一样大且对齐」
 *   「花娅远位面的首页卡和花娅陌域里的花娅远位面卡同步 如果以后多了什么栏目
 *    映射到首页同步更新」
 *   「把涣愿终池挪到它左边那个大卡片上 后面要给这张卡片做特效 稍后再说
 *    原位置的小卡就留占位符」
 *   「把花娅远位面里的页面块竖排并且可以用滚轮下滚 不要像现在这样挤在一起」
 *   「注意到甬城晴雨和曼沫砾总线之间的缝隙 和曼沫砾总线和涣源溪水钟之间的缝隙
 *    高度不一样 重新检查一遍首页所有卡片保证严格对齐」
 *
 * 所以这里盯这些事：
 *   ① 三张卡都在、位置对（涣愿终池占日历下方那张大卡；预留卡 + 花娅远位面
 *      在冰山 / 精华下方并排）；
 *   ② **尺寸对齐**：涣愿终池和日历同宽同高；预留卡 / 花娅远位面跟上面那两张小卡
 *      一样宽一样高、左右边缘对齐；
 *   ③ 预留卡默认是**空的**（一个字都没有，站规）；
 *   ④ 涣愿终池卡：是链接、指向那一页、能传封面图（没传时是占位不是黑洞）；
 *   ⑤ 花娅远位面卡：标题 / 地址 / 子栏目**全部来自版块树**（改树就跟着变，
 *      不是抄一份数据在首页）；子栏目**竖排一列**、能滚；
 *   ⑥ 换屏幕宽度、换月份（日历 5 行 / 6 行）之后对齐关系照样成立；
 *   ⑦ 首页所有行与行之间的缝**一样宽**（大板块→第一行、第一行→第二行、
 *      第二行→第三行）。
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
      /* 留一位小数：缝是 25.6px 这种值，取整之后会看着像 25 / 26 两个数 */
      const q = (v) => Math.round(v * 10) / 10;
      return { x: q(r.left), y: q(r.top + window.scrollY), w: q(r.width),
        h: q(r.height), right: q(r.right), bottom: q(r.bottom + window.scrollY) }; };
    const board = box('.boards .board');
    const ann = box('#home-announce');
    const lyt = box('#home-liyutang');
    const cal = box('#home-cal');
    const ice = box('.ice');
    const daily = box('.daily');
    const cistern = box('#home-cistern');
    const placeholder = box('#home-placeholder'); /* 2026-11-20 起这一格是冰室冰山，不再有预留卡 */
    const farland = box('#home-farland');
    /* 行与行之间的缝（底边 → 顶边），用来验"所有缝一样宽" */
    const gap = (a, b) => (a && b) ? Math.round((b.y - a.bottom) * 10) / 10 : null;
    return {
      board, ann, lyt, cal, ice, daily, cistern, placeholder, farland,
      pairUnder: box('.extras__pair--under'),
      gaps: {
        boardToRow1: gap(board, ann),
        row1ToRow2: gap(ann, cal),
        row2ToRow3: gap(cal, cistern),
      },
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
info(`1440：涣愿终池 ${JSON.stringify(g.cistern)}`);
info(`1440：预留卡 ${JSON.stringify(g.placeholder)} / 花娅远位面 ${JSON.stringify(g.farland)}`);

check('★ 三张卡都在页面上（涣愿终池 / 冰室冰山 / 花娅远位面）',
  !!g.ice && !!g.cistern && !!g.farland, JSON.stringify({ 终池: !!g.cistern, 冰山: !!g.ice, 远位面: !!g.farland }));
check('★ 涣愿终池在「涣源溪水钟」**正下方**（同一列、同一格，顶边在日历底边之下）',
  !!g.cistern && near(g.cistern.x, g.cal.x) && g.cistern.y >= g.cal.bottom - 1,
  JSON.stringify({ 终池: g.cistern, 日历底: g.cal?.bottom }));
/*
  第三行右边那一对：站长 2026-11-20 把冰室冰山从第二行挪到了原来预留卡那一格，
  所以现在这一对是「冰室冰山 / 花娅远位面」，在**日历 / 黎语堂**那一行正下方。
*/
check('★ 冰室冰山 / 花娅远位面在「日历 / 黎语堂」**正下方**',
  !!g.ice && !!g.farland && g.ice.y >= g.cal.bottom - 1 && g.farland.y >= g.lyt.bottom - 1,
  JSON.stringify({ 冰山顶: g.ice?.y, 日历底: g.cal?.bottom, 远位面顶: g.farland?.y, 黎语堂底: g.lyt?.bottom }));
check('冰室冰山在左、花娅远位面在右，左右边各自贴齐那一列',
  g.ice.x < g.farland.x && near(g.ice.x, g.lyt.x) && near(g.farland.right, g.lyt.right),
  JSON.stringify({ 冰山x: g.ice?.x, 黎语堂左: g.lyt?.x, 远位面右: g.farland?.right, 黎语堂右: g.lyt?.right }));

/* ------------------------------------------------------------------ ② 尺寸对齐 */
check('★ 涣愿终池和日历**同宽同高**（±2px）',
  near(g.cistern.w, g.cal.w) && near(g.cistern.h, g.cal.h),
  `${g.cistern.w}×${g.cistern.h} vs ${g.cal.w}×${g.cal.h}`);
check('★ 冰室冰山 / 花娅远位面**一样宽一样高**（同一对里的两张，±2px）',
  near(g.ice.w, g.farland.w) && near(g.ice.h, g.farland.h),
  `冰山 ${g.ice.w}×${g.ice.h}；远位面 ${g.farland.w}×${g.farland.h}`);
check('★ 第三行三张卡**底边对齐**（同一行高）',
  near(g.cistern.bottom, g.ice.bottom) && near(g.ice.bottom, g.farland.bottom) &&
    near(g.cistern.h, g.farland.h),
  `${g.cistern.bottom} / ${g.ice.bottom} / ${g.farland.bottom}`);
check('加了这三张卡之后首页没有横向溢出', g.overflowX <= 1, `${g.overflowX}px`);

/* ------------------------------------------------------------------ ②b 所有缝一样宽 */
const gapVals = Object.values(g.gaps);
info(`1440：缝 ${JSON.stringify(g.gaps)}`);
check('★ 首页行与行之间的缝**一样宽**（大板块→第一行 / 第一行→第二行 / 第二行→第三行，±2px）',
  gapVals.every((v) => typeof v === 'number') && Math.max(...gapVals) - Math.min(...gapVals) <= 2,
  JSON.stringify(g.gaps));

/*
  ③ 原来这里断的是「预留卡默认是空的」——
  2026-11-20 站长把冰室冰山挪进了那一格，页面上已经没有预留卡了，
  所以这一段跟着删掉（空状态那条规矩本身还在 site-copy / 别处的验收里）。
*/

/* ------------------------------------------------------------------ ④ 涣愿终池卡 */
const cist = await cdp.ev(`(() => {
  const n = document.querySelector('#home-cistern');
  if (!n) return null;
  const water = n.querySelector('.cistcard__water');
  const img = n.querySelector('img');
  return {
    tag: n.tagName,
    href: n.getAttribute('href'),
    title: (n.querySelector('.cistcard__title') || {}).textContent || '',
    hasImg: !!img,
    hasCanvas: !!n.querySelector('canvas'),
    /* 那口缸的 canvas（.aq 那一套）撤掉了；气泡是自己的 canvas，不算 */
    hasTank: !!n.querySelector('.aq canvas, canvas[data-aq-cv]'),
    hasBubbles: !!n.querySelector('canvas.cistcard__bubbles'),
    titleTop: (() => {
      const t = n.querySelector('.cistcard__title');
      if (!t) return null;
      const r = t.getBoundingClientRect();
      const c = n.getBoundingClientRect();
      return { up: Math.round(r.top - c.top), left: Math.round(r.left - c.left) };
    })(),
    titleFill: (() => {
      const t = n.querySelector('.cistcard__title');
      return t ? getComputedStyle(t).webkitBackgroundClip || getComputedStyle(t).backgroundClip : '';
    })(),
    waterCount: n.querySelectorAll('.cistcard__water').length,
    waterPe: water ? getComputedStyle(water).pointerEvents : '',
    waterHidden: water ? water.getAttribute('aria-hidden') : null,
    waterBlend: water ? getComputedStyle(water).mixBlendMode : '',
    sheen: !!n.querySelector('.cistcard__sheen'),
    filterDef: !!document.querySelector('#ci-water'),
    imgFilter: img ? getComputedStyle(img).filter : '',
    cursor: getComputedStyle(n).cursor,
  };
})()`);
check('★ 涣愿终池那张卡是链接，指向 /memoriterminalcistern',
  cist?.tag === 'A' && cist.href === '/memoriterminalcistern', JSON.stringify(cist));
check('涣愿终池卡上有标题（数据里那个，不是写死的）',
  cist?.title === (widgets.cistern?.title || '涣愿终池'), JSON.stringify(cist?.title));
check('★ 水族缸已经撤掉了（那口缸的 canvas 不在卡里）', cist?.hasTank === false, String(cist?.hasTank));
check('★ 气泡那一层在（画在 canvas 上，从水族缸那段搬过来的画法）',
  cist?.hasImg ? cist.hasBubbles === true : true, String(cist?.hasBubbles));
check('★ 标题在**左上角**（和曼沫砾总线 / 涣源溪水钟同一个摆法）',
  cist?.titleTop ? cist.titleTop.up >= 4 && cist.titleTop.up <= 40 && cist.titleTop.left >= 4 && cist.titleTop.left <= 40 : false,
  JSON.stringify(cist?.titleTop));
check('★ 标题是渐变填进笔画里的（拟物塑料那几个字，不是一块纯色）',
  /text/.test(String(cist?.titleFill || '')) && !/border-box/.test(String(cist?.titleFill || '')),
  String(cist?.titleFill));
check('★ 传了封面图才盖水光；没传就空着，不在空框上凭空做水',
  cist?.hasImg ? cist.waterCount === 2 : cist?.waterCount === 0,
  JSON.stringify({ img: cist?.hasImg, water: cist?.waterCount }));
check('★ 水光层盖在图上，但不吃点击（整张卡还得能点进去）',
  cist?.hasImg ? cist.waterPe === 'none' : true, String(cist?.waterPe));
check('水光层对读屏是隐藏的（纯装饰）',
  cist?.hasImg ? cist.waterHidden === 'true' : true, String(cist?.waterHidden));
check('水光是 screen 叠上去的（只加光，不压暗底下的图）',
  cist?.hasImg ? cist.waterBlend === 'screen' : true, String(cist?.waterBlend));
check('扫光那一层在', cist?.hasImg ? cist.sheen === true : true, String(cist?.sheen));
check('水体扭曲的滤镜定义在文档里（#ci-water）', cist?.filterDef === true, String(cist?.filterDef));
check('★ 传了封面图时，图上挂着水体扭曲滤镜',
  cist?.hasImg ? /ci-water/.test(cist.imgFilter || '') : true,
  JSON.stringify({ img: cist?.hasImg, filter: cist?.imgFilter }));
check('涣愿终池卡是能点的手型光标', cist?.cursor === 'pointer', cist?.cursor);

/* ------------------------------------------------------------------ ⑤ 花娅远位面卡跟着版块树走 */
const far = await cdp.ev(`(() => {
  const n = document.querySelector('#home-farland');
  if (!n) return null;
  const list = n.querySelector('.far__list');
  const scroll = n.querySelector('.far__scroll');
  const cards = [...n.querySelectorAll('.far__card')];
  const boxes = cards.map((a) => { const r = a.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
  return {
    title: (n.querySelector('.far__name') || {}).textContent || '',
    href: (n.querySelector('.far__name') || {}).getAttribute('href'),
    kids: cards.map((a) => ({
      text: (a.querySelector('.far__label') || {}).textContent || '',
      href: a.getAttribute('href'),
      cover: !!a.style.getPropertyValue('--cover'),
    })),
    /* 竖排：一列、每张卡占满整行宽、上下依次排开 */
    cols: list ? getComputedStyle(list).gridTemplateColumns.split(' ').length : 0,
    boxes,
    stacked: boxes.length > 1 && boxes.every((b, i) => i === 0 || b.y > boxes[i - 1].y),
    fullWidth: boxes.length > 0 && boxes.every((b) => Math.abs(b.w - boxes[0].w) <= 1),
    scrollable: scroll ? scroll.scrollHeight > scroll.clientHeight : false,
    overflowY: scroll ? getComputedStyle(scroll).overflowY : null,
    overscroll: scroll ? getComputedStyle(scroll).overscrollBehaviorY : null,
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
check('★ 子栏目**竖排一列**（不是挤成两列）', far?.cols === 1, `${far?.cols} 列`);
check('★ 竖排之后每张卡上下依次排开、都占满整行宽',
  far?.stacked === true && far?.fullWidth === true, JSON.stringify(far?.boxes));
check('★ 清单区能用滚轮往下滚（内容比卡片高）', far?.scrollable === true, String(far?.scrollable));
check('清单区是 overflow-y:auto，滚到头不会把首页带着一起滚',
  far?.overflowY === 'auto' && far?.overscroll === 'contain', JSON.stringify({ y: far?.overflowY, o: far?.overscroll }));

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
    near(s.cistern.w, s.cal.w) && near(s.cistern.h, s.cal.h) &&
    near(s.ice.w, s.farland.w) && near(s.ice.h, s.farland.h) &&
    near(s.cistern.bottom, s.ice.bottom) && near(s.ice.bottom, s.farland.bottom);
  check(`${w}：三张卡照样同宽同高、底边齐平`, ok,
    `终池 ${s.cistern.w}×${s.cistern.h} / 日历 ${s.cal.w}×${s.cal.h}；` +
      `冰山 ${s.ice.w}×${s.ice.h} / 远位面 ${s.farland.w}×${s.farland.h}`);
  const gv = Object.values(s.gaps);
  check(`${w}：行与行之间的缝照样一样宽（±2px）`,
    gv.every((v) => typeof v === 'number') && Math.max(...gv) - Math.min(...gv) <= 2, JSON.stringify(s.gaps));
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
  monthHeights.push({ rows, calH: s.cal.h, cisH: s.cistern.h, same: near(s.cal.h, s.cistern.h) });
  await cdp.ev(`(() => { const b = document.querySelector('[data-cal-next]'); if (b) b.click(); return true; })()`);
  await sleep(500);
}
info(`四个月：${JSON.stringify(monthHeights)}`);
check('★ 翻月之后涣愿终池照样和日历一样高（每个月都对得上）',
  monthHeights.every((m) => m.same), JSON.stringify(monthHeights));
/*
  日历的格子是**固定 6 行**（`--cal-cell` 定死、行数不随月份变），
  所以"换个月高度就变"这件事本身不会发生 —— 这里验的是**它真的没变**：
  四个月量下来高度必须一模一样，第三行也就一直跟得住。
  （万一以后有人把行数改成按月份给，这条会红，提醒他去看第三行还跟不跟得上。）
*/
check('日历四个月高度一致（格子固定 6 行，第三行因此一直跟得住）',
  new Set(monthHeights.map((m) => m.calH)).size === 1 && monthHeights.every((m) => m.rows === 6),
  JSON.stringify(monthHeights.map((m) => `${m.rows}行/${m.calH}px`)));

/* ------------------------------------------------------------------ ⑦ 手机端 */
console.log('\n================ 手机端（单列）================');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp.goto('/');
const m = await snap();
check('手机端：三张卡都在、竖着堆（单列，不并排）',
  !!m.ice && !!m.cistern && !!m.farland && m.cistern.y > m.cal.bottom - 1 && m.ice.y > m.cistern.bottom - 1 && m.farland.y > m.ice.bottom - 1,
  JSON.stringify({ 日历底: m.cal?.bottom, 终池顶: m.cistern?.y, 冰山顶: m.ice?.y, 远位面顶: m.farland?.y }));
check('手机端：不横向溢出', m.overflowX <= 1, `${m.overflowX}px`);
/*
  手机上是单列，桌面那套"和上面一样高"的脚本不写高度 —— 于是这几张卡的高度
  全靠自己撑。2026-11-18 实测：涣愿终池只剩 49px（一块图 + 一行标题）、
  花娅远位面只剩 62px（清单区被压扁，滚轮等于没有）。所以各给了一个下限，
  这条盯住它们别再塌回去。（原来还有一条「预留卡 ≥100」—— 那一格 2026-11-20
  换成了冰室冰山，下限按冰山卡自己的高度给。）
*/
check('手机端：三张卡都撑得起来（涣愿终池 ≥150 / 冰室冰山 ≥130 / 花娅远位面 ≥200）',
  m.cistern.h >= 150 && m.ice.h >= 130 && m.farland.h >= 200,
  JSON.stringify({ 终池: m.cistern.h, 冰山: m.ice.h, 远位面: m.farland.h }));
const mFar = await cdp.ev(`(() => {
  const s = document.querySelector('#home-farland .far__scroll');
  return s ? { sh: s.scrollHeight, ch: s.clientHeight } : null;
})()`);
check('手机端：花娅远位面的清单区照样能滚（内容比可视区高）',
  !!mFar && mFar.sh > mFar.ch, JSON.stringify(mFar));

/* ------------------------------------------------------------------ 收尾 */
const errs = cdp.errors.filter(Boolean);
check('整场没有脚本报错', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log(`\nPASS ${pass} / FAIL ${fail}`);
try { chrome.kill(); } catch { /* 已退 */ }
server.close();
process.exit(fail ? 1 : 0);
