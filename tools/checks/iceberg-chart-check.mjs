/*
 * 冰山图（/iceberg/）的验收：页面上画出来的东西，是不是数据说了算。
 *
 * 这一页是这一轮新加的（2026-09-22）：层级 / 条目 / 分类 / 标签都从
 * src/data/iceberg.json 来。这个脚本在真 dist 上跑真 Chromium，量这些：
 *
 *   ① 层级：层数、每层的标题 / 副标题、上下顺序
 *   ② 条目：总数、每层的条目名字、顺序
 *   ③ 颜色：每条的颜色 = 它归的那个分类的颜色（至少两种不同颜色）
 *   ④ 完备标识：**只看详细描述** —— 有描述的才有一颗，没有的一颗都没有；
 *      那颗标识是真「粉色 + 栅格」的圆角矩形，而且比条目本身宽出一截（拉长版）
 *   ⑤ 顶上的分类小眼睛：数据里标了 hidden 的那一类**默认就是收着的**；
 *      点一下 → 那一类的条目全部藏起来、aria-pressed 跟着变；再点一下放回来
 *   ⑥ 悬停卡片：移到有描述的条目上 → 卡片出现，顶部是 tag、下面是描述；
 *      移到既没 tag 也没描述的条目上 → 不出卡片（不是弹个空框）
 *   ⑦ 链接：填了链接的条目点一下真的会跳过去
 *   ⑧ 图：这一层有背景图 / 头图就画出来，没有就画占位；手机上头图挪到最上面
 *   ⑨ 手机（390）不横向溢出；两端都没有 JS 报错
 *
 * 期望值全部**从数据里现算**（分类颜色、哪几条有描述、哪些条目归哪一类），
 * 不写死条数和名字 —— 用户往图里加条目 / 改颜色，这个脚本不会跟着挂。
 *
 * 用法：node tools/checks/iceberg-chart-check.mjs [dist目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
const PORT = 4406;
const DEBUG_PORT = 9376;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const PAGE = '/iceberg/';
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
/** 数据里没这个条件时用它：不算失败，但也不假装量过了 */
const skip = (n) => {
  pass++;
  console.log(`SKIP  ${n}`);
};

/* ---------- 期望值：从数据里现算（和 src/utils/iceberg.ts 同一套规矩） ---------- */
const DATA_FILE = 'src/data/iceberg.json';
if (!fs.existsSync(DATA_FILE)) {
  console.error(`找不到 ${DATA_FILE}（这个脚本要在站点根目录跑）`);
  process.exit(2);
}
const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const DEFAULT_COLOR = '#b9a6c9';
const str = (v) => String(v ?? '').trim();
const HEX = /^#[0-9a-f]{6}$/i;
const categories = (raw.categories ?? [])
  .map((c) => ({ id: str(c.id), name: str(c.name), color: HEX.test(str(c.color)) ? str(c.color).toLowerCase() : DEFAULT_COLOR, hidden: c.hidden === true }))
  .filter((c) => c.id && c.name);
const tags = (raw.tags ?? []).map((t) => ({ id: str(t.id), name: str(t.name) })).filter((t) => t.id && t.name);
const tagName = (id) => tags.find((t) => t.id === str(id))?.name ?? '';
const catById = (id) => categories.find((c) => c.id === str(id)) ?? null;
const layers = (raw.layers ?? []).map((l) => ({
  id: str(l.id),
  title: str(l.title),
  subtitle: str(l.subtitle),
  background: str(l.background),
  head: str(l.head),
  items: (l.items ?? [])
    .map((it) => ({
      id: str(it.id),
      name: str(it.name),
      cat: catById(it.categoryId),
      color: catById(it.categoryId)?.color ?? DEFAULT_COLOR,
      tags: (it.tags ?? []).map((t) => tagName(t)).filter(Boolean),
      desc: str(it.desc),
      href: str(it.href),
      done: str(it.desc) !== '',
    }))
    .filter((it) => it.name),
}));

const totalItems = layers.reduce((n, l) => n + l.items.length, 0);
const doneItems = layers.reduce((n, l) => n + l.items.filter((i) => i.done).length, 0);
const looseItems = layers.reduce((n, l) => n + l.items.filter((i) => !i.cat).length, 0);
const usedCats = categories.filter((c) => layers.some((l) => l.items.some((i) => i.cat?.id === c.id)));
const legend = looseItems ? [...usedCats, { id: '', name: '未分类', color: DEFAULT_COLOR, hidden: false }] : usedCats;
const hiddenCats = usedCats.filter((c) => c.hidden);
const hexToRgb = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};
const firstLinked = layers.flatMap((l) => l.items).find((i) => i.href) ?? null;

if (!layers.length || !totalItems) {
  console.error('数据里一条层级/条目都还没有，这个检查没东西可量');
  process.exit(2);
}
console.log(`数据：${categories.length} 分类（用上 ${usedCats.length}，默认隐藏 ${hiddenCats.length}）· ${layers.length} 层 · ${totalItems} 条（${doneItems} 完备）`);

if (!fs.existsSync(path.join(root, 'iceberg', 'index.html'))) {
  console.error(`找不到 ${path.join(root, 'iceberg', 'index.html')}，先构建`);
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

const profile = path.join(process.env.TEMP ?? '.', `dsh-iceberg-${Date.now()}`);
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
  async goto(p, wait = 2400) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 150; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
  }
  /** 真指针：移到某个坐标上（hover 那几条靠它） */
  async move(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0, pointerType: 'mouse' });
    await sleep(280);
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

/* ---------- 页面上量一遍 ---------- */
const PROBE = `(() => {
  const R = (el) => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
  const layerEls = [...document.querySelectorAll('.ibk__layer')];
  const layers = layerEls.map((L) => {
    const title = L.querySelector('.ibk__title');
    const sub = L.querySelector('.ibk__sub');
    const bg = L.querySelector('.ibk__bgimg');
    const bgNone = L.querySelector('.ibk__bg--none');
    const head = L.querySelector('.ibk__headImg img');
    const headBox = L.querySelector('.ibk__headImg');
    return {
      rect: R(L),
      title: title ? title.textContent.trim() : '',
      subtitle: sub ? sub.textContent.trim() : '',
      bgSrc: bg ? bg.getAttribute('src') : '',
      bgNone: !!bgNone,
      headSrc: head ? head.getAttribute('src') : '',
      headRect: headBox ? R(headBox) : null,
      titleRect: title ? R(title) : null,
      headTop: headBox ? headBox.getBoundingClientRect().top : null,
      titleTop: title ? title.getBoundingClientRect().top : null,
      empty: !!L.querySelector('.ibk__empty'),
      items: [...L.querySelectorAll('.ibk__cell')].map((cell) => {
        const it = cell.querySelector('.ibk__item');
        const badge = cell.querySelector('.ibk__badge');
        const cs = getComputedStyle(it);
        return {
          cat: cell.dataset.cat || '',
          done: cell.dataset.done === '1',
          name: (it.querySelector('.ibk__txt') || {}).textContent.trim(),
          colorVar: it.style.getPropertyValue('--cat').trim(),
          color: cs.color,
          hidden: it.hidden,
          visible: !!(it.offsetWidth || it.offsetHeight),
          badge: badge ? {
            w: Math.round(badge.getBoundingClientRect().width),
            itemW: Math.round(it.getBoundingClientRect().width),
            bg: getComputedStyle(badge).backgroundColor,
            img: getComputedStyle(badge).backgroundImage,
          } : null,
          tags: (it.dataset.tags || '').split('\\u001f').filter(Boolean),
          desc: it.dataset.desc || '',
          href: it.tagName === 'A' ? it.getAttribute('href') : '',
        };
      }),
    };
  });
  const cats = [...document.querySelectorAll('.ibk__cat')].map((b) => ({
    id: b.dataset.cat || '',
    name: (b.querySelector('.ibk__catName') || {}).textContent.trim(),
    on: b.dataset.on === '1',
    pressed: b.getAttribute('aria-pressed'),
    bg: getComputedStyle(b).backgroundColor,
    catVar: b.style.getPropertyValue('--cat').trim(),
    rect: R(b),
  }));
  return {
    vw: innerWidth,
    layers, cats,
    tip: !!document.querySelector('[data-ibk-tip]'),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    hasChart: !!document.querySelector('[data-ibk]'),
  };
})()`;

/* ---------------- 桌面端 ---------------- */
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp.goto(PAGE, 2400);
const d = await cdp.ev(PROBE);
console.log('\n================ 桌面 1440 /iceberg/ ================');
console.log(JSON.stringify({
  layers: d.layers.map((l) => ({ title: l.title, items: l.items.length, bg: !!l.bgSrc, head: !!l.headSrc })),
  cats: d.cats.map((c) => `${c.name}${c.on ? '' : '(隐藏)'}`),
  overflow: d.overflow,
}));

check('冰山图那块在页面上（[data-ibk] 有）', d.hasChart === true, '');
check(`层级数 = 数据里的 ${layers.length} 层，顺序也对得上`,
  d.layers.length === layers.length && d.layers.every((L, i) => L.title === layers[i].title),
  d.layers.map((L) => L.title || '（空标题）').join(' / '));
check('每层的副标题也和数据一致',
  d.layers.every((L, i) => L.subtitle === layers[i].subtitle),
  d.layers.map((L) => L.subtitle.slice(0, 12)).join(' | '));
check(`条目总数 = ${totalItems} 条（每层的条数也对）`,
  d.layers.every((L, i) => L.items.length === layers[i].items.length) &&
    d.layers.reduce((n, L) => n + L.items.length, 0) === totalItems,
  d.layers.map((L, i) => `${L.items.length}/${layers[i].items.length}`).join(' '));
check('条目名字和顺序都对（第 n 层第 m 条 = 数据里那一条）',
  d.layers.every((L, i) => L.items.every((it, j) => it.name === layers[i].items[j].name)),
  d.layers.flatMap((L) => L.items.map((x) => x.name)).slice(0, 6).join(' · '));
check('层是**一上一下叠着**的（后面的层顶边更大，没有并排）',
  d.layers.length >= 2 && d.layers.every((L, i) => i === 0 || L.rect.t > d.layers[i - 1].rect.t + 10),
  d.layers.map((L) => L.rect.t).join(' / '));

/* ---- 颜色 = 分类颜色 ---- */
const colorMismatch = d.layers.flatMap((L, i) =>
  L.items.filter((it, j) => it.colorVar.toLowerCase() !== layers[i].items[j].color).map((it, j) => it.name)
);
const distinct = new Set(d.layers.flatMap((L) => L.items.map((it) => it.colorVar.toLowerCase())));
check('每条的颜色 = 它归的那个分类的颜色（改分类颜色，条目跟着变）',
  colorMismatch.length === 0, colorMismatch.length ? `对不上的：${colorMismatch.join('、')}` : `${distinct.size} 种颜色：${[...distinct].join(' ')}`);
check('至少两种分类颜色同时出现（不同分类看起来真的不一样）', distinct.size >= 2, `${distinct.size} 种`);
check('条目文字用的是分类色（不是整站那套琥珀色）',
  d.layers.flatMap((L) => L.items).every((it) => it.color === hexToRgb(it.colorVar) || it.done),
  d.layers.flatMap((L) => L.items).slice(0, 3).map((it) => `${it.name}=${it.color}`).join(' · '));

/* ---- 完备标识：只看详细描述 ---- */
const doneOnPage = d.layers.flatMap((L) => L.items).filter((it) => it.done);
const badDone = doneOnPage.filter((it) => !it.badge);
const falseDone = d.layers.flatMap((L) => L.items).filter((it) => !it.done && it.badge);
check(`★ 打完备标识的正好是填了详细描述的那 ${doneItems} 条（一条不多一条不少）`,
  doneOnPage.length === doneItems && badDone.length === 0 && falseDone.length === 0,
  `页面上 ${doneOnPage.length} 条、数据里 ${doneItems} 条；缺标识 ${badDone.length}、白给的 ${falseDone.length}`);
const badge = doneOnPage.find((it) => it.badge)?.badge ?? null;
check('★ 完备标识是「粉色 + 栅格」：底色是 #ff5fb0，背景里两条 repeating 渐变（0deg / 90deg = 栅格）',
  !!badge && badge.bg === hexToRgb('#ff5fb0') &&
    /repeating-linear-gradient/.test(badge.img) &&
    (badge.img.match(/repeating-linear-gradient/g) ?? []).length >= 2 &&
    /0deg/.test(badge.img) && /90deg/.test(badge.img),
  badge ? `${badge.bg} | ${badge.img.slice(0, 90)}…` : '没有取到标识');
check('★ 标识比条目本身宽出一截（「拉长版」：左右各多 11px）',
  !!badge && badge.w - badge.itemW >= 18,
  badge ? `标识 ${badge.w}px / 条目 ${badge.itemW}px` : '');

/* ---- 顶上的分类小眼睛 ---- */
check(`顶上的分类数 = ${legend.length}（只出「真有条目」的那些）`,
  d.cats.length === legend.length && d.cats.every((c, i) => c.id === legend[i].id),
  d.cats.map((c) => `${c.name}${c.on ? '' : '(收着)'}`).join(' · '));
/*
  分类色块：这一条的 --cat 必须是数据里的颜色。
  「收着」的那一类底色是透明的（只留一圈同色描边，见 .ibk__cat.is-off），
  所以底色对得上只对**开着**的那些要求 —— 收着的那颗看 --cat。
*/
check('分类色块用的是数据里的颜色（收着的那颗底色透明，但 --cat 还是那个色）',
  d.cats.every((c, i) => c.catVar.toLowerCase() === legend[i].color) &&
    d.cats.every((c, i) => !c.on || c.bg === hexToRgb(legend[i].color)),
  d.cats.map((c) => `${c.name}:${c.on ? c.bg : c.catVar + '(收着)'}`).join(' '));
/*
  「默认收着」那一条：数据里**有**标 hidden 的分类就验它，
  没有就 SKIP —— 用户可能把某一类点回「显示」了，那不是坏掉，
  只是这一条没东西可量（开关本身下面照样验）。
*/
const eyeCat = hiddenCats[0] ?? usedCats[0] ?? null;
if (hiddenCats.length) {
  check(`★ 数据里标了 hidden 的分类（${hiddenCats.map((c) => c.name).join('、')}）默认就是收着的：aria-pressed=false、它的条目一开始就不显示`,
    d.cats.filter((c) => !c.on).map((c) => c.id).sort().join(',') === hiddenCats.map((c) => c.id).sort().join(',') &&
      d.cats.filter((c) => !c.on).every((c) => c.pressed === 'false') &&
      hiddenCats.every((c) => {
        const list = d.layers.flatMap((x) => x.items).filter((it) => it.cat === c.id);
        return list.length > 0 && list.every((it) => it.hidden && !it.visible);
      }),
    `收着的：${d.cats.filter((c) => !c.on).map((c) => c.name).join('、')}`);
} else {
  skip('数据里没有默认隐藏的分类 —— 跳过「默认收着」这一条（开关本身下一对仍然验）');
}

/* 点一下小眼睛 → 这一类的条目整批翻面；再点一下回到原样（从哪个状态起都成立） */
const eyeTest = await cdp.ev(`(() => {
  const chip = document.querySelector('.ibk__cat[data-cat="${eyeCat?.id ?? ''}"]');
  if (!chip) return { ok: false, why: '找不到那颗小眼睛' };
  const items = () => [...document.querySelectorAll('.ibk__cell[data-cat="${eyeCat?.id ?? ''}"] .ibk__item')];
  const snap = (els) => els.map((el) => ({ hidden: el.hidden, visible: !!(el.offsetWidth || el.offsetHeight) }));
  const before = { on: chip.dataset.on === '1', pressed: chip.getAttribute('aria-pressed'), items: snap(items()) };
  chip.click();
  const after = { on: chip.dataset.on === '1', pressed: chip.getAttribute('aria-pressed'), items: snap(items()) };
  chip.click();
  const back = { on: chip.dataset.on === '1', pressed: chip.getAttribute('aria-pressed'), items: snap(items()) };
  return { ok: true, name: (chip.querySelector('.ibk__catName') || {}).textContent, count: before.items.length, before, after, back };
})()`);
check(`★ 点一下「${eyeTest.name}」的小眼睛：这一类的条目**整批翻面**（显示↔不显示，aria-pressed 跟着翻）`,
  eyeTest.ok === true && eyeTest.count > 0 &&
    eyeTest.after.on !== eyeTest.before.on &&
    eyeTest.after.pressed === (eyeTest.after.on ? 'true' : 'false') &&
    eyeTest.after.items.every((x) => x.hidden === !eyeTest.after.on && x.visible === eyeTest.after.on),
  JSON.stringify({ before: eyeTest.before?.on, after: eyeTest.after?.on, n: eyeTest.count }));
check('★ 再点一下：整批回到原样（开关来回都能用）',
  eyeTest.ok === true &&
    eyeTest.back.on === eyeTest.before.on && eyeTest.back.pressed === eyeTest.before.pressed &&
    JSON.stringify(eyeTest.back.items) === JSON.stringify(eyeTest.before.items),
  JSON.stringify({ back: eyeTest.back?.on, before: eyeTest.before?.on }));

/* ---- 图：背景图 / 头图 / 占位 ---- */
const withBg = layers.map((l, i) => [l, d.layers[i]]).filter(([l]) => l.background);
const noBg = layers.map((l, i) => [l, d.layers[i]]).filter(([l]) => !l.background);
const withHead = layers.map((l, i) => [l, d.layers[i]]).filter(([l]) => l.head);
check('有背景图的层真画出了 <img>（地址对得上），没背景图的层画的是占位',
  withBg.every(([l, L]) => L.bgSrc && L.bgSrc.includes(path.basename(l.background).split('.')[0])) &&
    noBg.every(([, L]) => L.bgNone),
  `${withBg.length} 层有图 / ${noBg.length} 层占位`);
check('有头图的层右边真画出了头图',
  withHead.length > 0 && withHead.every(([, L]) => !!L.headSrc),
  withHead.map(([l, L]) => `${l.title || '（空标题）'}→${L.headSrc ? '有' : '没有'}`).join(' '));

/* ---- 悬停卡片 ---- */
await cdp.ev('window.scrollTo(0, 0)');
const target = await cdp.ev(`(() => {
  const el = [...document.querySelectorAll('.ibk__item')].find((x) => (x.dataset.desc || '').length > 0 && !x.hidden);
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), name: el.dataset.name, tags: (el.dataset.tags || '').split('\\u001f').filter(Boolean), desc: el.dataset.desc };
})()`);
await sleep(400);
await cdp.move(target.x, target.y);
const tip = await cdp.ev(`(() => {
  const t = document.querySelector('[data-ibk-tip]');
  const r = t.getBoundingClientRect();
  return { hidden: t.hidden, text: t.textContent.trim(), tags: [...t.querySelectorAll('.ibk__tipTag')].map((x) => x.textContent),
    rect: { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }, vw: innerWidth, vh: innerHeight };
})()`);
console.log('\n================ 悬停卡片 ================');
console.log(JSON.stringify({ name: target.name, tipHidden: tip.hidden, tags: tip.tags, text: tip.text.slice(0, 60) }));
check('★ 鼠标移到「有描述」的条目上 → 详情卡片出现',
  target !== null && tip.hidden === false, `条目「${target?.name}」`);
check('★ 卡片里有那一条的详细描述（一字不差）',
  tip.text.includes(target.desc), `卡片 ${tip.text.length} 字 / 数据里 ${target.desc.length} 字`);
check('卡片顶部是 tag（勾了几个显示几个）',
  target.tags.length === 0 || (tip.tags.length === target.tags.length && tip.tags.every((t, i) => t === target.tags[i])),
  `数据 ${JSON.stringify(target.tags)} vs 卡片 ${JSON.stringify(tip.tags)}`);
check('卡片完整落在视口里（没有跑到屏幕外面去）',
  tip.rect.l >= 0 && tip.rect.t >= 0 && tip.rect.r <= tip.vw + 1 && tip.rect.b <= tip.vh + 1,
  JSON.stringify(tip.rect));

/* 移到「既没 tag 也没描述」的条目上 → 不该弹空卡片。
   先把收着的分类点开（不然那些条目是藏着的，找不到目标）—— 这也是看的人的动作。 */
await cdp.ev(`(() => { const c = document.querySelector('.ibk__cat[data-on="0"]'); if (c) c.click(); return true; })()`);
await sleep(300);
const blank = await cdp.ev(`(() => {
  const el = [...document.querySelectorAll('.ibk__item')].find((x) => !(x.dataset.desc || '').length && !(x.dataset.tags || '').length && !x.hidden);
  if (!el) return null;
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), name: el.dataset.name };
})()`);
if (!blank) {
  skip('数据里没有「既没描述也没 tag」的条目 —— 跳过「不弹空卡片」这一条');
} else {
  await sleep(300);
  await cdp.move(blank.x, blank.y);
  const tip2 = await cdp.ev(`(() => { const t = document.querySelector('[data-ibk-tip]'); return { hidden: t.hidden }; })()`);
  check('移到「没描述也没 tag」的条目上 → 不弹卡片（不是弹一个空框）',
    tip2.hidden === true, `条目「${blank.name}」，卡片 hidden=${tip2.hidden}`);
}

/* ---- 链接：点一下真的跳过去 ---- */
if (firstLinked) {
  await cdp.goto(PAGE, 1800);
  const linkAt = await cdp.ev(`(() => {
    const a = [...document.querySelectorAll('a.ibk__item')].find((x) => !x.hidden);
    if (!a) return null;
    a.scrollIntoView({ block: 'center' });
    const r = a.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), href: a.getAttribute('href') };
  })()`);
  await sleep(300);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: linkAt.x, y: linkAt.y, buttons: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: linkAt.x, y: linkAt.y, button: 'left', clickCount: 1, buttons: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: linkAt.x, y: linkAt.y, button: 'left', clickCount: 1, buttons: 0 });
  await sleep(1800);
  const after = await cdp.ev('location.pathname');
  check(`★ 填了链接的条目点一下就跳过去：${linkAt.href} → 真的到了 ${after}`,
    after !== PAGE && after.replace(/\/$/, '') === linkAt.href.replace(/\/$/, ''),
    `点的是 href=${linkAt.href}，落点 ${after}`);
  await cdp.goto(PAGE, 1600);
} else {
  console.log('（数据里没有带链接的条目，跳过「点了会跳」这一条）');
}

/* ---------------- 手机端 ---------------- */
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp.goto(PAGE, 2400);
const m = await cdp.ev(PROBE);
console.log('\n================ 手机 390 ================');
console.log(JSON.stringify({ overflow: m.overflow, layers: m.layers.map((L) => ({ w: L.rect.w, head: L.headRect?.w ?? null, items: L.items.length })) }));
check('手机端不横向溢出', m.overflow <= 1, `scrollWidth - clientWidth = ${m.overflow}`);
check('手机端层级还是完整宽度（一栏叠下来，没被挤窄）',
  m.layers.every((L) => L.rect.w >= 300), m.layers.map((L) => `${L.rect.w}px`).join(' / '));
check('手机端条目都没超宽（每条都在层里）',
  m.layers.every((L) => L.items.every((it) => !it.badge || it.badge.itemW <= L.rect.w)),
  '');
const headFirst = m.layers.filter((L) => L.headRect && L.titleTop !== null);
check('手机端头图挪到标题上面、而且是整条横幅（宽度 = 整层宽）',
  headFirst.length > 0 && headFirst.every((L) => L.headTop < L.titleTop) &&
    headFirst.every((L) => Math.abs(L.headRect.w - L.rect.w) <= 2 && L.headRect.h >= 100),
  headFirst.map((L) => `${L.headRect.w}×${L.headRect.h} @${Math.round(L.headTop)} / 标题 @${Math.round(L.titleTop)}`).join(' · '));
check('手机端分类那一排还在（能手动开关）', m.cats.length === d.cats.length, `${m.cats.length} 个`);
check('两端都没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

try { await cdp.send('Browser.close'); } catch { /* ignore */ }
chrome.kill();
server.close();
console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
