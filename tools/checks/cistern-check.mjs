/*
 * 「涣愿终池」的验收 —— 真构建产物、真浏览器、真服务端。
 *
 * 用户 2026-11-17 的原话（照抄）：
 *   「点击涣源溪水钟卡片右下角的【今天依然是等待篠雨的一天】按钮 会弹出提示卡前往
 *     涣愿终池 会跳转到一个独立的页面 …… 核心区域里分为四个板块：历年这一天的
 *     1.精华 2.时间轴事件与时刻 3.可考据的冰山词条 4.铃忆的冰室日记的跳转卡片 ……
 *     这个页面每天都会更新 到了明天 11.18 就显示历年的 11.18」
 *   「只有铃忆的冰室日记和时间轴是跳转按钮 其他的都是平铺在核心区里 就像精华页面那样
 *    精华就按原格式 冰山则是如果有完备描述则详细铺开完备描述」
 *   「所有时间轴都读取 但是标明轴出处」
 *
 * 所以这里盯这些事：
 *   ① 首页那颗按钮：是链接、指上去弹提示卡、点它真的进那一页；
 *   ② 页面骨架：FA 布景在、两条平铺区在、跳转按钮按轴给出；
 *   ③ **换一天内容就换**（把浏览器的 Date 定死在不同日子，同一份 HTML 显示不同内容
 *      —— 这就是"每天更新、昨天那页不被存下来"的证明）；
 *   ④ 精华按原格式（头像 + 名字 + 时间 + 引文块）、冰山整段铺开、跳转按钮标明轴；
 *   ⑤ 站规：核心区里**没有一句自己编的说明文案**。
 *
 * 用法：node tools/checks/cistern-check.mjs [dist目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromePath } from './lib/chrome.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
const PORT = 4491;
const DEBUG_PORT = 9491;
const CHROME = chromePath();
const PAGE = '/huaya/memoriterminalcistern';
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

/* ------------------------------------------------------------------ ② 页面骨架 */
await cdp.goto(PAGE);
const shell = await cdp.ev(`(() => {
  const root = document.querySelector('[data-cist]');
  const scene = document.querySelector('.cist__scene');
  const bubbles = document.querySelectorAll('.cist__bubble');
  return {
    body: document.body.className,
    ready: root ? root.dataset.cistReady === '1' : false,
    flats: [...document.querySelectorAll('[data-cist-flat]')].map((n) => n.dataset.cistFlat),
    jumps: !!document.querySelector('[data-cist-jumps]'),
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
check('★ 只剩两块平铺区（精华 / 冰山）+ 一排跳转按钮，原来那四个"面板"没了',
  shell.flats.length === 2 && shell.flats.includes('essences') && shell.flats.includes('iceberg') &&
    shell.jumps === true && shell.hasPanels === 0, JSON.stringify({ flats: shell.flats, panels: shell.hasPanels }));
check('★ FA 布景齐了：天空 / 太阳 / 丁达尔光 / 水面 / 碎钻 / 泡泡 / 暗角',
  shell.sceneLayers.length === 7, JSON.stringify(shell.sceneLayers));
check('泡泡有 16 个而且真的在动（CSS 动画挂上了）',
  shell.bubbles === 16 && shell.bubbleAnim === 'cist-rise', `${shell.bubbles} 个 / ${shell.bubbleAnim}`);

/* ------------------------------------------------------------------ ③ 每天换内容 */
/** 把页面按"某一天"重开一遍，读页面上的实际结果 */
const onDay = async (mmdd) => {
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  await freezeDay(`2026-${mmdd}`);
  await cdp.goto(PAGE, 2600);
  return cdp.ev(`(() => {
    const items = (k) => [...document.querySelectorAll('[data-cist-flat="' + k + '"] .cist__item')];
    const first = items('essences')[0];
    const firstBq = first ? first.querySelector('.cist__bq') : null;
    return {
      day: (document.querySelector('[data-cist-day]') || {}).textContent || '',
      essences: items('essences').length,
      iceberg: items('iceberg').length,
      jumps: [...document.querySelectorAll('.cist__jump')].map((a) => ({
        text: a.textContent.replace(/\\s+/g, ' ').trim(), href: a.getAttribute('href'),
      })),
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

/** 从 /cistern.json 里挑几类"有东西"的日子 */
const pick = (pred) => Object.entries(idx.days).find(([, d]) => pred(d)) || null;
const dayEss = pick((d) => d.essences.length >= 2);
const dayIce = pick((d) => d.iceberg.length >= 1);
const dayPts = pick((d) => d.points.length >= 1);
const dayNote = pick((d) => d.notes.length >= 1);

check('数据里能找到"有精华 / 有冰山词条 / 有事件 / 有日记"的日子',
  !!dayEss && !!dayIce && !!dayPts && !!dayNote,
  JSON.stringify({ 精华: dayEss?.[0], 冰山: dayIce?.[0], 事件: dayPts?.[0], 日记: dayNote?.[0] }));

if (dayEss && dayIce && dayPts && dayNote) {
  const [kEss, dEss] = dayEss;
  const [kIce, dIce] = dayIce;
  const [kPts, dPts] = dayPts;
  const [kNote, dNote] = dayNote;

  const a = await onDay(kEss);
  check(`★ 定在 ${kEss}：精华平铺出来的条数和 /cistern.json 一致`, a.essences === dEss.essences.length,
    `${a.essences} / ${dEss.essences.length}`);
  check(`★ 精华是"原格式"：头像 + 名字 + 时间 + 引文块都在`,
    !!a.firstEssence && a.firstEssence.hasAvatar === true && a.firstEssence.name.length > 0 &&
      /\d{4} 年/.test(a.firstEssence.time) && a.firstEssence.text.length > 0,
    JSON.stringify(a.firstEssence));
  check(`页头写的就是这一天（${kEss}）`, a.day.includes(`${Number(kEss.slice(0, 2))} 月`), a.day);

  const b = await onDay(kIce);
  check(`★ 换到 ${kIce}：同一份 HTML，内容整个换了（冰山词条那天）`, b.iceberg === dIce.iceberg.length,
    `${b.iceberg} / ${dIce.iceberg.length}`);
  const fullDesc = await cdp.ev(`(() => {
    const it = document.querySelector('[data-cist-flat="iceberg"] .cist__bq--full');
    return it ? it.textContent.trim().length : 0;
  })()`);
  check('★ 冰山那条把完备描述整段铺开了（不是几句摘要）', fullDesc >= 30, `${fullDesc} 字`);
  check(`★ 两天的内容确实不一样（不是把昨天那页存下来了）`,
    a.essences !== b.essences || a.iceberg !== b.iceberg,
    JSON.stringify({ [kEss]: a.essences, [kIce]: b.iceberg }));

  const c = await onDay(kPts);
  const axes = [...new Set(dPts.points.map((p) => p.timeline))];
  check(`★ 换到 ${kPts}：时间轴那条变成了跳转按钮，而且**标明轴出处**`,
    c.jumps.some((j) => axes.some((axis) => j.text.includes(axis))), JSON.stringify({ axes, jumps: c.jumps.map((j) => j.text) }));
  const jumpOk = c.jumps.find((j) => axes.some((axis) => j.text.includes(axis)));
  check('时间轴按钮跳到"放那条轴的那一页"',
    !!jumpOk && !!(idx.timelineHref || {})[dPts.points[0].timelineId] &&
      jumpOk.href === idx.timelineHref[dPts.points[0].timelineId],
    JSON.stringify({ href: jumpOk?.href, 期望: idx.timelineHref?.[dPts.points[0].timelineId] }));
  check('时间轴那天**不**把事件平铺出来（它只是按钮）',
    (await cdp.ev(`document.querySelectorAll('.cist__point, [data-cist-flat="points"]').length`)) === 0,
    '页面上没有任何事件列表');

  const d = await onDay(kNote);
  check(`★ 换到 ${kNote}：冰室日记是跳转按钮（不显示全文）、指向那天的日记页`,
    d.jumps.some((j) => j.text.includes('铃忆的冰室日记') && j.href === `/notes/${dNote.notes[0].id}/`),
    JSON.stringify(d.jumps));
}

/* 只有一份页面文件：没有 /11-17/ 这种按天存的目录 */
const dirs = fs.readdirSync(path.join(root, 'huaya')).filter((d) => /^\d{2}-\d{2}$|^\d{4}-\d{2}-\d{2}$/.test(d));
check('站点上没有按天存的副本（昨天的页面直接被今天的盖掉）', dirs.length === 0, JSON.stringify(dirs));

/* ------------------------------------------------------------------ ④ 站规：不许有 AI 写出来的文案 */
const bare = await onDay('11-17'); // 一个什么都还没有的日子（今年这天池子是空的）
check('空日子里两条平铺区就是空的、跳转按钮也不硬凑', bare.essences === 0 && bare.iceberg === 0 && bare.jumps.length === 0,
  JSON.stringify({ essences: bare.essences, iceberg: bare.iceberg, jumps: bare.jumps.length }));
const prose = await cdp.ev(`(() => {
  const inner = document.querySelector('.cist__inner');
  return {
    text: inner ? inner.innerText.replace(/\\s+/g, ' ').trim() : '',
    hasKicker: !!document.querySelector('.cist__kicker'),
    hasFoot: !!document.querySelector('.cist__foot'),
    hasEmpty: !!document.querySelector('.cist__empty'),
    hasCount: !!document.querySelector('[data-cist-count]'),
  };
})()`);
check('★ 空日子里也没有冒出一句"这一天还没有……"',
  prose.hasKicker === false && prose.hasFoot === false && prose.hasEmpty === false && prose.hasCount === false,
  JSON.stringify(prose));
check('★ 核心区里的字里没有一个句号（说明句都删干净了，只剩标题 / 日期 / 数字）',
  !/[。！？；]/.test(prose.text), prose.text.slice(0, 120));

/* ------------------------------------------------------------------ 收尾 */
const errs = cdp.errors.filter(Boolean);
check('整场没有脚本报错', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log(`\nPASS ${pass} / FAIL ${fail}`);
try { chrome.kill(); } catch { /* 已退 */ }
server.close();
process.exit(fail ? 1 : 0);
