/*
 * 「涣愿终池」的验收 —— 真构建产物、真浏览器、真服务端。
 *
 * 用户 2026-11-17 的原话（照抄）：
 *   「点击涣源溪水钟卡片右下角的【今天依然是等待篠雨的一天】按钮 会弹出提示卡前往
 *     涣愿终池 会跳转到一个独立的页面 …… 这个页面每天都会更新 到了明天 11.18 就显示历年的 11.18」
 *   「把核心板块从上往下划开变成四个部分 分别就是精华 冰山 时刻 冰室日记四个板块部分
 *    如果今天没有 就写一个历史上的今天还没有XX占位」
 *   「时刻里的时间轴上的点用原有塔吊图标（且原轴是黄色的就用黄的 原轴是粉的就用粉的）
 *    点了不要跳转到原时间轴 而是看这个刻度在原时间轴里有没有写对应的跳转链接
 *    没有就不用管有就一样跳转到那个链接」
 *   「时刻应该读取本网站所有已存在的时间轴并去重后显示 例如虹星的1.20原版开服这个时刻
 *    在花娅年代记和纷鸟衔来的记录里都存在 确认完全查重（名字 时间一致）后在7月8日那一天
 *    就只显示一个即可 而例如纷鸟衔来的记录里Raw家建成这种非主时间轴的小轴里的事件
 *    就需要加上时间轴前缀」
 *
 * 所以这里盯这些事：
 *   ① 首页那颗按钮：是链接、指上去弹提示卡、点它真的进那一页；
 *   ② 页面骨架：四个板块自上而下、标题就是那四个词，FA 布景在；
 *   ③ **换一天内容就换**（把浏览器的 Date 定死在不同日子，同一份 HTML 显示不同内容
 *      —— 这就是"每天更新、昨天那页不被存下来"的证明）；
 *   ④ 每个板块的呈现：精华原格式 / 冰山整段铺开 / 时刻用原塔吊且点了去刻度自己的链接 /
 *      冰室日记是跳转卡；没内容的板块只留那句占位；
 *   ⑤ 查重的四条规则（run 真数据的 7 月 8 日 + `cistern-dedupe.ts` 的单元用例）；
 *   ⑥ 站规：核心区里**没有一句自己编的说明文案**。
 *
 * 用法：node tools/checks/cistern-check.mjs [dist目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chromePath } from './lib/chrome.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
const PORT = 4491;
const DEBUG_PORT = 9491;
const CHROME = chromePath();
const PAGE = '/memoriterminalcistern';
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
const indexFile = path.join(root, 'cistern.json');
if (!fs.existsSync(indexFile)) {
  console.error('找不到 dist/cistern.json —— 页面脚本靠它');
  process.exit(2);
}
const idx = JSON.parse(fs.readFileSync(indexFile, 'utf8'));

/* 时间轴原始数据：用来证明"查重前确实有重复"（不然这一条检查等于什么都没验） */
const timelineFile = path.resolve('src/data/timelines.json');
const tlRaw = fs.existsSync(timelineFile) ? JSON.parse(fs.readFileSync(timelineFile, 'utf8')) : { timelines: [] };

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

const profile = path.join(process.env.TEMP ?? '.', `dsh-cistern-${Date.now()}`);
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
  async goto(p, wait = 2400) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 150; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
  }
  async move(x, y) { await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await sleep(320); }
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
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

/** 把浏览器的"今天"定死在某一天（页面脚本就是用 new Date() 算的） */
const freezeDay = async (iso) => {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const FIXED = new Date('${iso}T12:00:00+08:00').getTime();
      const Real = Date;
      function Fake(...a) { return a.length ? new Real(...a) : new Real(FIXED); }
      Fake.prototype = Real.prototype;
      Fake.now = () => FIXED;
      Fake.parse = Real.parse;
      Fake.UTC = Real.UTC;
      window.Date = Fake;
    })();`,
  });
};

/* ------------------------------------------------------------------ ① 首页那颗按钮 */
await cdp.goto('/');
/* 首页封面那套会把卡片区推到折线以下，先滚到它身上再量坐标 */
await cdp.ev(`(() => { const a = document.querySelector('[data-cal-today]');
  if (a) a.scrollIntoView({ block: 'center', behavior: 'instant' }); return 1; })()`);
await sleep(500);
const btn = await cdp.ev(`(() => {
  const a = document.querySelector('[data-cal-today]');
  if (!a) return { found: false };
  const pop = a.querySelector('.cal__todayPop');
  return {
    found: true, tag: a.tagName, href: a.getAttribute('href'),
    text: (a.querySelector('[data-cal-today-text]') || {}).textContent || '',
    popVisible: pop ? getComputedStyle(pop).visibility === 'visible' && Number(getComputedStyle(pop).opacity) > 0.9 : false,
    box: (() => { const b = a.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })(),
  };
})()`);
check('首页右下角那颗按钮还在、写着「今天依然是等待篠雨的一天」',
  btn.found && /今天依然是等待篠雨的一天|今天是/.test(btn.text), JSON.stringify({ text: btn.text }));
check('★ 它现在是个链接，指向涣愿终池', btn.tag === 'A' && btn.href === PAGE, `${btn.tag} → ${btn.href}`);
check('没指上去时提示卡是藏着的', btn.popVisible === false);

await cdp.move(btn.box.x, btn.box.y);
const hovered = await cdp.ev(`(() => {
  const a = document.querySelector('[data-cal-today]');
  const pop = a && a.querySelector('.cal__todayPop');
  if (!pop) return { visible: false };
  const cs = getComputedStyle(pop);
  return { visible: cs.visibility === 'visible' && Number(cs.opacity) > 0.9, text: pop.textContent.replace(/\\s+/g, ' ').trim() };
})()`);
check('★ 鼠标移上去弹出提示卡「前往涣愿终池」', hovered.visible === true && /前往涣愿终池/.test(hovered.text || ''),
  JSON.stringify(hovered.text));
/* ⚠ 站规：不许自作主张加描述文案。提示卡里只准有那一个标题。 */
check('提示卡里只有「前往涣愿终池」（没有 AI 补的说明句）', hovered.text === '前往涣愿终池', JSON.stringify(hovered.text));

/* ------------------------------------------------------------------ ② 页面骨架：四个板块 */
await cdp.goto(PAGE);
const SECTIONS = [
  ['essences', '精华'],
  ['iceberg', '冰山'],
  ['points', '时刻'],
  ['notes', '冰室日记'],
];
const shell = await cdp.ev(`(() => {
  const root = document.querySelector('[data-cist]');
  const scene = document.querySelector('.cist__scene');
  const bubbles = document.querySelectorAll('.cist__bubble');
  return {
    body: document.body.className,
    ready: root ? root.dataset.cistReady === '1' : false,
    sections: [...document.querySelectorAll('[data-cist-flat]')].map((n) => ({
      key: n.dataset.cistFlat,
      head: (n.querySelector('.cist__h') || {}).textContent || '',
    })),
    oldJumps: document.querySelectorAll('[data-cist-jumps], .cist__jumps').length,
    scene: !!scene,
    sceneLayers: ['.cist__sky', '.cist__sun', '.cist__rays', '.cist__sea', '.cist__glint', '.cist__bubbles', '.cist__vignette']
      .filter((s) => !!document.querySelector(s)),
    bubbles: bubbles.length,
    bubbleAnim: bubbles[0] ? getComputedStyle(bubbles[0]).animationName : '',
    hasPanels: document.querySelectorAll('.cist__panel').length,
  };
})()`);
check('★ 页面在，body 挂上了 is-cistern（整页换 FA 皮）',
  /is-cistern/.test(shell.body) && shell.scene === true && shell.ready === true, shell.body);
check('★ 核心区从上往下就是四个板块：精华 / 冰山 / 时刻 / 冰室日记（顺序也一样）',
  JSON.stringify(shell.sections) === JSON.stringify(SECTIONS.map(([key, head]) => ({ key, head }))),
  JSON.stringify(shell.sections));
check('顶上那一排跳转按钮没了（时刻改成自己铺开）、也没有原来那四个"面板"',
  shell.oldJumps === 0 && shell.hasPanels === 0, JSON.stringify({ oldJumps: shell.oldJumps, panels: shell.hasPanels }));
check('★ FA 布景齐了：天空 / 太阳 / 丁达尔光 / 水面 / 碎钻 / 泡泡 / 暗角',
  shell.sceneLayers.length === 7, JSON.stringify(shell.sceneLayers));
check('泡泡有 16 个而且真的在动（CSS 动画挂上了）',
  shell.bubbles === 16 && shell.bubbleAnim === 'cist-rise', `${shell.bubbles} 个 / ${shell.bubbleAnim}`);

/* 地址：直接挂在站点根上（用户 2026-11-17：「直接把改页的链接改为 /memoriterminalcistern
   让它返回会直接返回主页」），所以「返回」必须回首页、面包屑上不能还顶着「花娅陌域」 */
const navBits = await cdp.ev(`(() => {
  const back = document.querySelector('.bp__back');
  return {
    backText: back ? back.textContent.replace(/\\s+/g, ' ').trim() : '',
    backHref: back ? back.getAttribute('href') : '',
    crumbs: [...document.querySelectorAll('.crumbs a, .crumbs__here')].map((n) => n.textContent.trim()),
  };
})()`);
check('★ 页面地址就是 /memoriterminalcistern（不再挂在 /huaya 下面）',
  fs.existsSync(path.join(root, 'memoriterminalcistern', 'index.html')) &&
    !fs.existsSync(path.join(root, 'huaya', 'memoriterminalcistern')),
  JSON.stringify({ 新地址: fs.existsSync(path.join(root, 'memoriterminalcistern', 'index.html')),
    旧地址: fs.existsSync(path.join(root, 'huaya', 'memoriterminalcistern')) }));
check('★ hero 上那个「返回」直接回首页', /返回首页/.test(navBits.backText) && navBits.backHref === '/',
  JSON.stringify(navBits));
check('面包屑那一行也不见了（它不再挂着任何上级，只剩自己就不显示）',
  navBits.crumbs.length === 0, JSON.stringify(navBits.crumbs));

/* 右上角那颗「三条杠」也要跟着整页换色（原来那套是深色页的粉白） */
const drawer = await cdp.ev(`(() => {
  const bars = [...document.querySelectorAll('#drawer-toggle .drawer__bars i')];
  return { n: bars.length, colors: bars.map((b) => getComputedStyle(b).backgroundColor) };
})()`);
check('★ 右上角「三条杠」是这一页的墨蓝（不是粉白）',
  drawer.n === 3 && drawer.colors.every((c) => c === 'rgb(11, 74, 99)'), JSON.stringify(drawer));

/* ------------------------------------------------------------------ 一个日子在页面上的样子 */
/** 把页面按"某一天"重开一遍，把四个板块读到的东西全抓回来 */
const onDay = async (mmdd) => {
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  await freezeDay(`2026-${mmdd}`);
  await cdp.goto(PAGE, 2600);
  return cdp.ev(`(() => {
    const inSec = (k) => document.querySelector('[data-cist-flat="' + k + '"]');
    const items = (k) => [...inSec(k).querySelectorAll('.cist__item')];
    const first = items('essences')[0];
    const firstBq = first ? first.querySelector('.cist__bq') : null;
    const color = (n) => (n ? getComputedStyle(n).color : '');
    return {
      day: (document.querySelector('[data-cist-day]') || {}).textContent || '',
      essences: items('essences').length,
      iceberg: items('iceberg').length,
      ticks: [...inSec('points').querySelectorAll('.cist__tick')].map((row) => ({
        name: (row.querySelector('.cist__tickName') || {}).textContent || '',
        when: (row.querySelector('.cist__tickWhen') || {}).textContent || '',
        kind: row.dataset.kind || '',
        tag: row.tagName,
        href: row.getAttribute('href'),
        color: color(row.querySelector('.cist__crane')),
        crane: !!row.querySelector('.cist__crane svg path'),
        cursor: getComputedStyle(row).cursor,
      })),
      jumps: [...inSec('notes').querySelectorAll('.cist__jump')].map((a) => ({
        text: a.textContent.replace(/\\s+/g, ' ').trim(), href: a.getAttribute('href'),
      })),
      empties: [...document.querySelectorAll('.cist__empty')].map((p) => p.textContent.trim()),
      firstEssence: first
        ? {
            hasAvatar: !!first.querySelector('.cist__avatar'),
            name: (first.querySelector('.cist__name') || {}).textContent || '',
            time: (first.querySelector('.cist__time') || {}).textContent || '',
            text: (firstBq || {}).textContent || '',
          }
        : null,
    };
  })()`);
};

/** 展示了什么名字（带不带轴前缀就写在这上面） */
const shown = (p) => (p.showAxis && p.timeline ? `${p.timeline}·${p.label}` : p.label);

/** 从 /cistern.json 里挑几类"有东西"的日子 */
const pick = (pred) => Object.entries(idx.days).find(([, d]) => pred(d)) || null;
const dayEss = pick((d) => d.essences.length >= 2);
const dayIce = pick((d) => d.iceberg.length >= 1);
const dayNote = pick((d) => d.notes.length >= 1);
/* 时刻要挑"有链接的"和"时刻/事件两种颜色都出现"的日子，各验一件事 */
const dayPtsLinked = pick((d) => d.points.some((p) => p.href) && d.points.some((p) => !p.href));
const dayPtsBothKinds = pick((d) => d.points.some((p) => p.kind === 'moment') && d.points.some((p) => p.kind === 'event'));

check('数据里能找到"有精华 / 有冰山 / 有时刻 / 有日记"的日子',
  !!dayEss && !!dayIce && !!dayPtsLinked && !!dayNote,
  JSON.stringify({ 精华: dayEss?.[0], 冰山: dayIce?.[0], 时刻: dayPtsLinked?.[0], 日记: dayNote?.[0] }));

/* ------------------------------------------------------------------ ③ 空日子：四个板块各留一句占位 */
/*
  ⚠ 空日子**不能写死**某一天：数据会长（2026-11-17 那天后来就有了冰室日记），
  写死的话这条会在数据长出来之后凭空变红 —— 页面没坏，是这条断言过期了。
  所以从 /cistern.json 里现挑一个四块全空的日子。
*/
const emptyKey = (() => {
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= 28; d++) {
      const k = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const day = idx.days[k];
      if (!day || (!day.essences.length && !day.iceberg.length && !day.points.length && !day.notes.length)) return k;
    }
  }
  return '';
})();
check('数据里找得到一个四块全空的日子（下面那几条要用它）', !!emptyKey, emptyKey);
const bare = await onDay(emptyKey);
check(`★ ${emptyKey} 这天四块都是空的（数据里确实一条都没有）`,
  bare.essences === 0 && bare.iceberg === 0 && bare.ticks.length === 0 && bare.jumps.length === 0,
  JSON.stringify({ 精华: bare.essences, 冰山: bare.iceberg, 时刻: bare.ticks.length, 日记: bare.jumps.length }));
check('★ 空着的四个板块各自写着占位「历史上的今天还没有精华 / 冰山 / 时刻 / 冰室日记」',
  JSON.stringify(bare.empties) === JSON.stringify(SECTIONS.map(([, name]) => `历史上的今天还没有${name}`)),
  JSON.stringify(bare.empties));

/* ------------------------------------------------------------------ ④ 有东西的日子：每块怎么长 */
if (dayEss && dayIce && dayPtsLinked && dayNote) {
  const [kEss, dEss] = dayEss;
  const [kIce, dIce] = dayIce;
  const [kNote, dNote] = dayNote;

  const a = await onDay(kEss);
  check(`★ 定在 ${kEss}：精华平铺出来的条数和 /cistern.json 一致`, a.essences === dEss.essences.length,
    `${a.essences} / ${dEss.essences.length}`);
  check(`★ 精华是"原格式"：头像 + 名字 + 时间 + 引文块都在`,
    !!a.firstEssence && a.firstEssence.hasAvatar === true && a.firstEssence.name.length > 0 &&
      /\d{4} 年/.test(a.firstEssence.time) && a.firstEssence.text.length > 0,
    JSON.stringify(a.firstEssence));
  check(`页头写的就是这一天（${kEss}）`, a.day.includes(`${Number(kEss.slice(0, 2))} 月`), a.day);
  /* 有内容的那几块不许挂占位，没内容的才挂 —— 数量按数据算，不写死 */
  const filled = ['essences', 'iceberg', 'points', 'notes']
    .filter((k) => (dEss[k] || []).length > 0).length;
  check(`有东西的板块不会冒占位、空着的板块才占位（${kEss} 那天有 ${filled} 块有东西）`,
    !a.empties.includes('历史上的今天还没有精华') && a.empties.length === 4 - filled, JSON.stringify(a.empties));

  const b = await onDay(kIce);
  check(`★ 换到 ${kIce}：同一份 HTML，内容整个换了（冰山词条那天）`, b.iceberg === dIce.iceberg.length,
    `${b.iceberg} / ${dIce.iceberg.length}`);
  const fullDesc = await cdp.ev(`(() => {
    const it = document.querySelector('[data-cist-flat="iceberg"] .cist__bq--full');
    return it ? it.textContent.trim().length : 0;
  })()`);
  check('★ 冰山那条把完备描述整段铺开了（不是几句摘要）', fullDesc >= 30, `${fullDesc} 字`);

  const d = await onDay(kNote);
  check(`★ 换到 ${kNote}：冰室日记是跳转按钮（不显示全文）、指向那天的日记页`,
    d.jumps.some((j) => j.text.includes('铃忆的冰室日记') && j.href === `/notes/${dNote.notes[0].id}/`),
    JSON.stringify(d.jumps));
}

/* ------------------------------------------------------------------ ⑤ 时刻：原塔吊、自己的链接、查重 */
if (dayPtsLinked) {
  const [kPts, dPts] = dayPtsLinked;
  const s = await onDay(kPts);
  const want = dPts.points.map(shown);
  check(`★ ${kPts}：时刻按 /cistern.json 一条一条铺开（名字连轴前缀都对得上）`,
    JSON.stringify(s.ticks.map((t) => t.name)) === JSON.stringify(want),
    JSON.stringify({ 页面: s.ticks.map((t) => t.name), 期望: want }));
  check('★ 用的是原来那颗塔吊图标',
    s.ticks.every((t) => t.crane === true), JSON.stringify(s.ticks.map((t) => t.crane)));

  const linked = s.ticks.filter((t) => t.tag === 'A');
  const plain = s.ticks.filter((t) => t.tag !== 'A');
  const wantLinked = dPts.points.filter((p) => p.href);
  check('★ 轴上写了跳转链接的，点了就去那个链接（不是去原时间轴）',
    linked.length === wantLinked.length &&
      linked.every((t, i) => t.href === wantLinked[i].href) &&
      linked.every((t) => !/^\/huaya(?:\/years\/fenhu)?$/.test(t.href || '')) &&
      linked.every((t) => t.cursor === 'pointer'),
    JSON.stringify({ 页面: linked.map((t) => t.href), 期望: wantLinked.map((p) => p.href) }));
  check('★ 轴上没写链接的刻度就是死的（不是链接、点不动）',
    plain.length === dPts.points.filter((p) => !p.href).length &&
      plain.every((t) => !t.href && t.cursor !== 'pointer'),
    JSON.stringify(plain.map((t) => t.cursor)));
}

if (dayPtsBothKinds) {
  const [kKinds, dKinds] = dayPtsBothKinds;
  const s = await onDay(kKinds);
  const moment = dKinds.points.find((p) => p.kind === 'moment');
  const event = dKinds.points.find((p) => p.kind === 'event');
  const gotM = s.ticks.find((t) => t.name === shown(moment));
  const gotE = s.ticks.find((t) => t.name === shown(event));
  check(`★ ${kKinds}：时刻的塔吊是黄的（和原轴上的「时刻」同色）`,
    !!gotM && gotM.kind === 'moment' && gotM.color === 'rgb(255, 200, 87)',
    JSON.stringify({ color: gotM?.color, 期望: 'rgb(255, 200, 87)' }));
  check('★ 事件的塔吊是粉的（和原轴上的「事件」同色）',
    !!gotE && gotE.kind === 'event' && gotE.color === 'rgb(255, 183, 197)',
    JSON.stringify({ color: gotE?.color, 期望: 'rgb(255, 183, 197)' }));
}

/* 用户点名的那两天：7 月 8 日只留一个；7 月 16 日带上分轴前缀 */
const rawHas = (label, date) =>
  tlRaw.timelines.filter((t) => t.points.some((p) => p.label === label && p.date === date)).map((t) => t.title);
const d0708 = idx.days['07-08'] || { points: [] };
const d0716 = idx.days['07-16'] || { points: [] };
check('★ 原始时间轴里「虹星的1.20原版服开服」确实在两条轴上（所以"查重"不是空谈）',
  rawHas('虹星的1.20原版服开服', '2023-07-08').length === 2, JSON.stringify(rawHas('虹星的1.20原版服开服', '2023-07-08')));
check('★ 7 月 8 日那天只显示一条，名字就是「虹星的1.20原版服开服」（主轴里有的不带前缀）',
  d0708.points.length === 1 && !d0708.points[0].showAxis && d0708.points[0].label === '虹星的1.20原版服开服',
  JSON.stringify(d0708.points.map(shown)));
check('★ 7 月 16 日那天「Raw家建成」带上分轴前缀「纷鸟衔来的记录·Raw家建成」',
  d0716.points.length === 1 && d0716.points[0].showAxis === true &&
    shown(d0716.points[0]) === '纷鸟衔来的记录·Raw家建成',
  JSON.stringify(d0716.points.map(shown)));
const s0708 = await onDay('07-08');
check('★ 页面上 7 月 8 日也真的只有一条刻度',
  s0708.ticks.length === 1 && s0708.ticks[0].name === '虹星的1.20原版服开服',
  JSON.stringify(s0708.ticks.map((t) => t.name)));

/* 主轴是哪条：数据里挂在最浅那一页上的那条（花娅年代记） */
const mainTitle = (tlRaw.timelines.find((t) => t.id === idx.mainAxis) || {}).title || '';
check('★ 主轴认的是「花娅年代记」（查重时它有的不带前缀）',
  mainTitle === '花娅年代记', JSON.stringify({ mainAxis: idx.mainAxis, mainTitle }));

/* 查重算法本身：用户举的那几种情形（直接跑同一个函数，不许在脚本里抄一份逻辑） */
const dedupeFile = path.resolve('src/utils/cistern-dedupe.ts');
if (fs.existsSync(dedupeFile)) {
  const { dedupePoints } = await import(pathToFileURL(dedupeFile).href);
  const MAIN = 'tl-main';
  const FEN = 'tl-fen';
  const HD = 'tl-hd';
  const row = (o) => ({
    id: 'p', timeline: '花娅年代记', timelineId: MAIN, date: '2024-06-18',
    label: '交个名字', kind: 'moment', href: '', ...o,
  });

  const c1 = dedupePoints([row({ label: '虹星的1.20原版服开服', date: '2023-07-08', timeline: '花娅年代记', timelineId: MAIN }),
    row({ label: '虹星的1.20原版服开服', date: '2023-07-08', timeline: '纷鸟衔来的记录', timelineId: FEN })], MAIN);
  check('查重：主轴 + 分轴同名同日 → 只留一条，不带前缀',
    c1.length === 1 && c1[0].showAxis === false && c1[0].timeline === '花娅年代记', JSON.stringify(c1.map(shown)));

  const c2 = dedupePoints([row({ label: '618大灭绝', timeline: '花娅年代记', timelineId: MAIN }),
    row({ label: '618大灭绝', timeline: '脆骨症服', timelineId: 'tl-cg' })], MAIN);
  check('查重：就算以后多一条分轴也有 618大灭绝，还是只显示一个「618大灭绝」',
    c2.length === 1 && c2[0].showAxis === false && c2[0].label === '618大灭绝', JSON.stringify(c2.map(shown)));

  const c3 = dedupePoints([row({ label: 'Raw家建成', date: '2023-07-16', timeline: '纷鸟衔来的记录', timelineId: FEN })], MAIN);
  check('查重：只有分轴里有 → 显示「纷鸟衔来的记录·Raw家建成」',
    c3.length === 1 && c3[0].showAxis === true && shown(c3[0]) === '纷鸟衔来的记录·Raw家建成', JSON.stringify(c3.map(shown)));

  const c4 = dedupePoints([
    row({ label: 'Raw家建成', date: '2023-07-16', timeline: '纷鸟衔来的记录', timelineId: FEN }),
    row({ label: 'Raw家建成', date: '2023-07-16', timeline: '通讯期许的回声', timelineId: HD }),
  ], MAIN);
  check('查重：两条分轴都有、主轴里没有 → 各显示一条（两条都带自己的前缀）',
    c4.length === 2 && c4.every((p) => p.showAxis) &&
      JSON.stringify(c4.map(shown)) === JSON.stringify(['纷鸟衔来的记录·Raw家建成', '通讯期许的回声·Raw家建成']),
    JSON.stringify(c4.map(shown)));

  const c5 = dedupePoints([row({ label: 'Raw家建成', date: '2023-07-16', timelineId: FEN }),
    row({ label: 'Raw家建成', date: '2024-07-16', timelineId: FEN })], MAIN);
  check('查重：名字一样但日子不同 → 是两条（只认"名字 + 时间"都一样的）',
    c5.length === 2, JSON.stringify(c5.map((p) => p.date)));

  const c6 = dedupePoints([row({ label: '桑芙加入冰室', href: '' }),
    row({ label: '桑芙加入冰室', timeline: '纷鸟衔来的记录', timelineId: FEN, href: '/huaya/bingshi#桑芙' })], MAIN);
  check('查重：主轴那条没填链接、分轴那条填了 → 合并后照样点得动',
    c6.length === 1 && c6[0].href === '/huaya/bingshi#桑芙', JSON.stringify(c6));

  const c7 = dedupePoints([row({ label: '同一个轴里的重复' }), row({ label: '同一个轴里的重复' })], MAIN);
  check('查重：同一条轴上重复写了两个一样的点 → 也只留一条',
    c7.length === 1, JSON.stringify(c7.length));
} else {
  check('查重算法文件在（src/utils/cistern-dedupe.ts）', false);
}

/* ------------------------------------------------------------------ ⑥ 每天换内容 */
if (dayEss && dayIce) {
  const [kEss, dEss] = dayEss;
  const [kIce, dIce] = dayIce;
  const a = await onDay(kEss);
  const b = await onDay(kIce);
  check(`★ 两天的内容确实不一样（不是把昨天那页存下来了）`,
    a.essences !== b.essences || a.iceberg !== b.iceberg,
    JSON.stringify({ [kEss]: a.essences, [kIce]: b.iceberg }));
  if (a.essences && dEss.essences.length) {
    check(`精华条数和数据对得上（${kEss}）`, a.essences === dEss.essences.length, `${a.essences} / ${dEss.essences.length}`);
  }
  if (b.iceberg && dIce.iceberg.length) {
    check(`冰山条数和数据对得上（${kIce}）`, b.iceberg === dIce.iceberg.length, `${b.iceberg} / ${dIce.iceberg.length}`);
  }
}

/* 只有一份页面文件：没有 /11-17/ 这种按天存的目录 */
const dirs = fs.readdirSync(path.join(root, 'huaya')).filter((d) => /^\d{2}-\d{2}$|^\d{4}-\d{2}-\d{2}$/.test(d));
check('站点上没有按天存的副本（昨天的页面直接被今天的盖掉）', dirs.length === 0, JSON.stringify(dirs));

/* ------------------------------------------------------------------ ⑦ 站规：不许有 AI 写出来的文案 */
await onDay(emptyKey);
const prose = await cdp.ev(`(() => {
  const inner = document.querySelector('.cist__inner');
  return {
    text: inner ? inner.innerText.replace(/\\s+/g, ' ').trim() : '',
    hasKicker: !!document.querySelector('.cist__kicker'),
    hasFoot: !!document.querySelector('.cist__foot'),
    hasCount: !!document.querySelector('[data-cist-count]'),
  };
})()`);
check('★ 除了那四句占位，没有别的自己编的小字（kicker / 页尾 / 统计句都没有）',
  prose.hasKicker === false && prose.hasFoot === false && prose.hasCount === false, JSON.stringify(prose));
check('★ 核心区里的字里没有一个句号（说明句都删干净了，只剩标题 / 日期 / 占位）',
  !/[。！？；]/.test(prose.text), prose.text.slice(0, 160));
check('★ 占位句就是站长那句原话（一个字不多）',
  (prose.text.match(/历史上的今天还没有/g) || []).length === 4, prose.text.slice(0, 160));

/* ------------------------------------------------------------------ ⑧ 真的点一下那个刻度 */
/* 先收脚本报错（下面那一下会跳去别的页面，那页自己的日志不算这一页的） */
const errs = cdp.errors.filter(Boolean);
check('整场没有脚本报错', errs.length === 0, errs.slice(0, 2).join(' | '));

if (dayPtsLinked) {
  const [kPts, dPts] = dayPtsLinked;
  const wantHref = (dPts.points.find((p) => p.href) || {}).href || '';
  await onDay(kPts);
  const box = await cdp.ev(`(() => {
    const a = document.querySelector('.cist__tick[href]');
    if (!a) return null;
    a.scrollIntoView({ block: 'center', behavior: 'instant' });
    const b = a.getBoundingClientRect();
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
  })()`);
  if (box) {
    await sleep(300);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await sleep(1400);
  }
  const loc = await cdp.ev('decodeURIComponent(location.pathname + location.hash)');
  check('★ 真的点一下那个刻度：去的是它自己的链接，不会跑去原时间轴那一页',
    !!box && loc === wantHref && loc !== '/huaya' && loc !== '/huaya/years/fenhu',
    `${loc} / 期望 ${wantHref}`);
}

/* ------------------------------------------------------------------ 收尾 */
console.log(`\nPASS ${pass} / FAIL ${fail}`);
try { chrome.kill(); } catch { /* 已退 */ }
server.close();
process.exit(fail ? 1 : 0);
