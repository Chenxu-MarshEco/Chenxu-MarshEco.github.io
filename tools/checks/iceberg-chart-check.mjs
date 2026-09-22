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
/*
  计算样式里的颜色有两种写法，都得认：
    rgb(255, 95, 176)        普通写法
    color(srgb 1 0.66 0.83)  color-mix() 的结果 —— Chromium 就是这么序列化的
  （第一版只认 rgb()，于是 color-mix 算出来的标识底色一个都没解析到，
   色相和对比度两条断言读到的是栅格那层的白线和透明黑，直接误报。）
*/
const parseColor = (t) => {
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(String(t));
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: rgb[4] === undefined ? 1 : +rgb[4] };
  const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(String(t));
  if (srgb) return { r: +srgb[1] * 255, g: +srgb[2] * 255, b: +srgb[3] * 255, a: srgb[4] === undefined ? 1 : +srgb[4] };
  return null;
};
/** 一个 background-image 里**最后一层 linear-gradient** 的色标（跳过栅格那层的白线与透明） */
const gradientStops = (img) => {
  const s = String(img ?? '');
  const i = s.lastIndexOf('linear-gradient(');
  if (i < 0) return [];
  return [...s.slice(i).matchAll(/rgba?\([^)]*\)|color\(srgb[^)]*\)/g)]
    .map((m) => parseColor(m[0]))
    .filter((c) => c && c.a > 0.05);
};
const hueOfRgb = ({ r, g, b }) => {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  if (!d) return 0;
  let h;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return (h * 60 + 360) % 360;
};
const hueDeltaRgb = (a, b) => {
  const d = Math.abs(hueOfRgb(a) - hueOfRgb(b)) % 360;
  return d > 180 ? 360 - d : d;
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
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; this.all = []; this.navs = []; this.reqs = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const e = m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text;
        this.errors.push(e);
        /* goto() 会把 errors 清空，所以另存一份全程的 —— 最后那条"没有 JS 报错"要看全程 */
        this.all.push(e);
      }
      /* 点了链接之后浏览器到底有没有真的开始跳 —— 外链可能连不上，
         但「请求跳转 / 发出主文档请求」这两个动作一定会来，拿它们当证据最稳 */
      if (m.method === 'Page.frameRequestedNavigation') {
        this.navs.push(String(m.params?.url ?? ''));
      }
      if (m.method === 'Network.requestWillBeSent' && m.params?.type === 'Document') {
        this.reqs.push(String(m.params?.request?.url ?? ''));
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
await cdp.send('Network.enable');

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
        const bs = badge ? getComputedStyle(badge) : null;
        return {
          cat: cell.dataset.cat || '',
          done: cell.dataset.done === '1',
          name: (it.querySelector('.ibk__txt') || {}).textContent.trim(),
          colorVar: it.style.getPropertyValue('--cat').trim(),
          inkVar: it.style.getPropertyValue('--ink').trim(),
          color: cs.color,
          hidden: it.hidden,
          visible: !!(it.offsetWidth || it.offsetHeight),
          badge: badge ? {
            w: Math.round(badge.getBoundingClientRect().width),
            h: Math.round(badge.getBoundingClientRect().height),
            itemW: Math.round(it.getBoundingClientRect().width),
            /* 底色是渐变，backgroundColor 是透明的 —— 要读 backgroundImage 里那几个色 */
            bg: bs.backgroundColor,
            img: bs.backgroundImage,
            opacity: Number(bs.opacity),
            radius: parseFloat(bs.borderTopLeftRadius),
            /* 图钉下面那个小箭头：这里必须**没有**（::after 不存在 / 边框为 0） */
            arrowContent: getComputedStyle(badge, '::after').content,
            arrowBorder: parseFloat(getComputedStyle(badge, '::after').borderTopWidth) || 0,
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
    color: getComputedStyle(b).color,
    catVar: b.style.getPropertyValue('--cat').trim(),
    inkVar: b.style.getPropertyValue('--ink').trim(),
    rect: R(b),
  }));
  /* 整页的皮：是不是和 /salon/ 一套、背景那层扫描线在不在、动不动、VHS 那层什么样 */
  const root = getComputedStyle(document.documentElement);
  const card = document.querySelector('.ibk__layer');
  const title = document.querySelector('.ibk__title');
  const main = document.querySelector('.site-main');
  const scan = getComputedStyle(document.body, '::before');
  const v = document.querySelector('[data-ibk-vhs]');
  const vcs = v ? getComputedStyle(v) : null;
  const tearSel = '.ibk__vhsTear';
  return {
    vw: innerWidth,
    layers, cats,
    tip: !!document.querySelector('[data-ibk-tip]'),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    hasChart: !!document.querySelector('[data-ibk]'),
    theme: {
      bodyClass: document.body.className,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      cardImg: card ? getComputedStyle(card).backgroundImage : '',
      cardBorder: card ? getComputedStyle(card).borderTopColor : '',
      cardBorderLeft: card ? getComputedStyle(card).borderLeftColor : '',
      cardBorderLeftW: card ? parseFloat(getComputedStyle(card).borderLeftWidth) : 0,
      cardRadius: card ? parseFloat(getComputedStyle(card).borderTopLeftRadius) : 0,
      cardShadow: card ? getComputedStyle(card).boxShadow : '',
      titleColor: title ? getComputedStyle(title).color : '',
      titleShadow: title ? getComputedStyle(title).textShadow : '',
      /* 页面大标题（.page-header__title）：深紫底上站里默认那套深琥珀是看不清的 */
      h1Color: (() => {
        const h = document.querySelector('.page-header__title');
        return h ? getComputedStyle(h).color : '';
      })(),
      h1Shadow: (() => {
        const h = document.querySelector('.page-header__title');
        return h ? getComputedStyle(h).textShadow : '';
      })(),
      h1Text: (() => {
        const h = document.querySelector('.page-header__title');
        return h ? h.textContent.trim() : '';
      })(),
      mainZ: main ? getComputedStyle(main).zIndex : '',
      scan: {
        content: scan.content,
        img: scan.backgroundImage.slice(0, 80),
        size: scan.backgroundSize,
        render: scan.imageRendering,
        anim: scan.animationName,
        dur: scan.animationDuration,
        iter: scan.animationIterationCount,
        z: scan.zIndex,
        pos: scan.position,
      },
    },
    vhs: v
      ? {
          layers: v.children.length,
          opacity: Number(vcs.opacity),
          pos: vcs.position,
          z: vcs.zIndex,
          pe: vcs.pointerEvents,
          hidden: v.getAttribute('aria-hidden'),
          deep: getComputedStyle(document.documentElement).getPropertyValue('--ibk-deep').trim(),
          burst: getComputedStyle(document.documentElement).getPropertyValue('--ibk-burst').trim(),
          snow: (() => {
            const el = v.querySelector('.ibk__vhsSnow');
            if (!el) return null;
            const s = getComputedStyle(el);
            /* ⚠ 这里整段是塞进外层模板字面量里的：单个反斜杠会被吃掉，
               斜杠和加号都得写成双反斜杠才活得到浏览器里 */
            return { isData: /^url\\("?data:image\\/svg\\+xml/.test(s.backgroundImage), size: s.backgroundSize, blend: s.mixBlendMode, opacity: Number(s.opacity), img: s.backgroundImage };
          })(),
          rgb: (() => {
            const el = v.querySelector('.ibk__vhsRgb');
            if (!el) return null;
            const s = getComputedStyle(el);
            return { stripes: (s.backgroundImage.match(/repeating-linear-gradient/g) ?? []).length, blend: s.mixBlendMode, img: s.backgroundImage.slice(0, 120) };
          })(),
          tears: [...v.querySelectorAll(tearSel)].map((t) => {
            const s = getComputedStyle(t);
            return { h: Math.round(t.getBoundingClientRect().height), top: s.top, backdrop: s.backdropFilter, anim: s.animationName, blend: s.mixBlendMode };
          }),
          bar: (() => {
            const el = v.querySelector('.ibk__vhsBar');
            if (!el) return null;
            const s = getComputedStyle(el);
            return { anim: s.animationName, dur: s.animationDuration, h: Math.round(el.getBoundingClientRect().height) };
          })(),
        }
      : null,
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

/*
  每一类的条目数：分类是「导入」进来的（源文件里的【标签】就是它），
  最容易串的就是这一层 —— 按分类数一遍，和盘上数据逐个对。
*/
const catCount = (list) => {
  const m = new Map();
  for (const it of list) m.set(it.cat, (m.get(it.cat) ?? 0) + 1);
  return m;
};
const pageByCat = catCount(d.layers.flatMap((L) => L.items));
const dataByCat = catCount(layers.flatMap((L) => L.items.map((it) => ({ cat: it.cat?.id ?? '' }))));
check(`★ 每一类的条目数都对得上（${usedCats.length} 个分类，共 ${totalItems} 条没有一条串类）`,
  pageByCat.size === dataByCat.size && [...dataByCat].every(([id, n]) => pageByCat.get(id) === n),
  [...dataByCat].map(([id, n]) => `${categories.find((c) => c.id === id)?.name ?? '未分类'} ${pageByCat.get(id) ?? 0}/${n}`).join(' · '));
/*
  条目文字颜色：
    整页改成浅色之后，直接写分类色是看不清的（亮粉压浅底只有 2.6:1），
    所以文字用的是构建期算好的 --ink：分类色压深到 ≥4.5:1 的那个色。
    这里两条都要：
      ① 画出来的颜色就是那个 --ink（不是分类原色、也不是整站的琥珀色）；
      ② 色相还停在那一类附近（一眼还能认出是哪一类，容差 25°）。
*/
const allItems = d.layers.flatMap((L) => L.items);
const inkMismatch = allItems.filter((it) => it.color !== hexToRgb(it.inkVar));
check('★ 条目文字用的是构建期算的那个 --ink：深底上就是分类色本身，有标识的按标识底微调（一律 ≥4.5:1）',
  inkMismatch.length === 0 && allItems.every((it) => /^#[0-9a-f]{6}$/i.test(it.inkVar)),
  inkMismatch.length ? `对不上的：${inkMismatch.slice(0, 4).map((x) => `${x.name} ${x.color}≠${hexToRgb(x.inkVar)}`).join('、')}`
    : `${allItems.length} 条都是 --ink，例：${allItems.slice(0, 3).map((x) => `${x.name}=${x.color}`).join(' · ')}`);
const worstHue = allItems
  .map((it) => ({ name: it.name, d: hueDeltaRgb(parseColor(it.color), parseColor(hexToRgb(it.colorVar))) }))
  .sort((a, b) => b.d - a.d)[0];
check('★ 调过的色相还在那一类附近（最大偏差 ≤ 12°，一眼还认得出是哪一类）',
  worstHue.d <= 12, `最大偏差 ${worstHue.d.toFixed(1)}°（${worstHue.name}）`);

/* ---- 完备标识：只看详细描述 ---- */
const doneOnPage = d.layers.flatMap((L) => L.items).filter((it) => it.done);
const badDone = doneOnPage.filter((it) => !it.badge);
const falseDone = allItems.filter((it) => !it.done && it.badge);
check(`★ 打完备标识的正好是填了详细描述的那 ${doneItems} 条（一条不多一条不少）`,
  doneOnPage.length === doneItems && badDone.length === 0 && falseDone.length === 0,
  `页面上 ${doneOnPage.length} 条、数据里 ${doneItems} 条；缺标识 ${badDone.length}、白给的 ${falseDone.length}`);

/*
  完备标识的样子（用户 2026-09-22 的要求）：
  「参考地图中区域图钉的样貌 去掉向下小箭头 拉长为圆角矩形 微微半透明
    颜色改为和当前分类一样的颜色会随着分类变化」
  所以这里量的是：栅格 + 渐变（图钉那颗头的做法）· 没有小箭头 · 圆角 · 拉长 ·
  opacity < 1（微微半透明）· 每一类的标识底色都跟着那一类的颜色走。
*/
const badge = doneOnPage.find((it) => it.badge)?.badge ?? null;
check('★ 完备标识是「栅格 + 渐变」那一套（和地图上区域图钉的头同一个做法：横向细栅格 + 竖向渐变）',
  !!badge &&
    /* 图钉那颗头是用 mask: repeating-linear-gradient(180deg, #000 0 2px, transparent 2px 3.2px) 做的；
       这里换成背景层里的 1px 白线。180deg 是默认方向，Chromium 序列化时会把它省掉，所以两种都认。 */
    /repeating-linear-gradient\(\s*(180deg\s*,\s*)?rgba?\(/.test(badge.img) &&
    /linear-gradient\(/.test(badge.img) &&
    gradientStops(badge.img).length >= 2,
  badge ? badge.img.slice(0, 150) : '没有取到标识');
check('★ 标识下面**没有**图钉那个指向地图的小箭头（::after 不存在 / 边框为 0）',
  !!badge && (badge.arrowContent === 'none' || badge.arrowContent === 'normal') && badge.arrowBorder === 0,
  badge ? `::after content=${badge.arrowContent} borderTop=${badge.arrowBorder}` : '');
check('★ 标识是圆角矩形、而且是「拉长」的（左右各多 11px；宽高比 ≥ 2.5）',
  !!badge && badge.radius >= 6 && badge.w - badge.itemW >= 18 && badge.w / badge.h >= 2.5,
  badge ? `标识 ${badge.w}×${badge.h}px（条目 ${badge.itemW}px）、圆角 ${badge.radius}px、宽高比 ${(badge.w / badge.h).toFixed(2)}` : '');
check('★ 标识微微半透明（opacity 在 0.6~0.95 之间）',
  !!badge && badge.opacity >= 0.6 && badge.opacity <= 0.95, badge ? `opacity=${badge.opacity}` : '');

/* 每一类的标识底色都要跟着**那一类**的颜色走 */
const badgeByCat = new Map();
for (const it of doneOnPage) if (it.badge) badgeByCat.set(it.cat, { color: it.colorVar, img: it.badge.img, name: it.name });
const badgeRows = [...badgeByCat].map(([cat, b]) => {
  /* 标识底色 = 分类色混白的三个色标，色相应该都贴着这一类的分类色 */
  const stops = gradientStops(b.img);
  const catRgb = parseColor(hexToRgb(b.color));
  const deltas = stops.map((c) => hueDeltaRgb(c, catRgb));
  return { cat, color: b.color, name: b.name, maxDelta: deltas.length ? Math.max(...deltas) : 999, n: stops.length };
});
check(`★ 标识的颜色跟着分类走：${badgeRows.length} 个分类的标识底色色相都贴着各自的分类色（≤ 20°）`,
  badgeRows.length >= 2 && badgeRows.every((r) => r.maxDelta <= 20),
  badgeRows.map((r) => `${r.cat}:${r.color} Δ${r.maxDelta.toFixed(0)}°`).join(' · '));
check('★ 不同分类的标识颜色**确实不一样**（不是所有条目都用同一个色）',
  new Set(badgeRows.map((r) => r.color)).size === badgeRows.length && badgeRows.length >= 2,
  badgeRows.map((r) => `${r.cat}→${r.color}`).join(' · '));

/* ------------------------------------------------------------------
   整页的皮：和站里别的页一套令牌 + 一层自下往上走的栅格
   （用户 2026-09-22：「整体风格改成和其他页面一样 背景加上运动的栅格线
     但是是从下往上运动」）
   ------------------------------------------------------------------ */
const rgbOf = parseColor;
const over = (top, bottom) => ({
  r: top.r * top.a + bottom.r * (1 - top.a),
  g: top.g * top.a + bottom.g * (1 - top.a),
  b: top.b * top.a + bottom.b * (1 - top.a),
  a: 1,
});
const lum = ({ r, g, b }) => {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
};
const contrastRgb = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

const T = d.theme;

/*
  「整体页面风格类似冰室精华那个页面」——
  这条不靠我自己说"像"，而是**去 /salon/ 把那一套数值量回来，逐项比**：
  底色、玻璃块的渐变、粉边、圆角、大标题的白 + 粉外发光。
*/
await cdp.goto('/salon/', 2200);
const salonRef = await cdp.ev(`(() => {
  const item = document.querySelector('.salon__item');
  const title = document.querySelector('.salon__title');
  const ics = item && getComputedStyle(item);
  const tcs = title && getComputedStyle(title);
  return {
    bodyClass: document.body.className,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    itemImg: ics ? ics.backgroundImage : '',
    itemBorder: ics ? ics.borderTopColor : '',
    itemBorderLeft: ics ? ics.borderLeftColor : '',
    itemBorderLeftW: ics ? parseFloat(ics.borderLeftWidth) : 0,
    itemRadius: ics ? parseFloat(ics.borderTopLeftRadius) : 0,
    titleColor: tcs ? tcs.color : '',
    titleShadow: tcs ? tcs.textShadow : '',
  };
})()`);
await cdp.goto(PAGE, 2400);
console.log('\n================ 和 /salon/ 逐项比 ================');
console.log(JSON.stringify({ salon: { bg: salonRef.bodyBg, cls: salonRef.bodyClass }, iceberg: { bg: T.bodyBg, cls: T.bodyClass } }));
check('★ 底色 = 冰室精华那一页的底色（#1e0730）',
  T.bodyBg === salonRef.bodyBg, `冰山 ${T.bodyBg} / 精华 ${salonRef.bodyBg}`);
check('★ 页头页脚那一套也一样（body 上都带 is-board）',
  /\bis-board\b/.test(T.bodyClass) && /\bis-board\b/.test(salonRef.bodyClass),
  `冰山 "${T.bodyClass}" / 精华 "${salonRef.bodyClass}"`);
check('★ 层级卡片 = 精华页那种「深紫渐变玻璃块 + 1px 粉边 + 14px 圆角」',
  T.cardImg === salonRef.itemImg && T.cardBorder === salonRef.itemBorder &&
    T.cardBorderLeft === salonRef.itemBorderLeft && T.cardBorderLeftW === salonRef.itemBorderLeftW &&
    T.cardRadius === salonRef.itemRadius,
  `渐变 ${T.cardImg === salonRef.itemImg ? '一致' : `${T.cardImg} vs ${salonRef.itemImg}`}｜边 ${T.cardBorder}/${T.cardBorderLeft} ${T.cardBorderLeftW}px｜圆角 ${T.cardRadius}px`);
check('★ 大标题也是那一套：纯白 + 粉色外发光',
  T.titleColor === salonRef.titleColor && /rgba?\(255,\s*79,\s*163/.test(T.titleShadow || ''),
  `色 ${T.titleColor}（精华 ${salonRef.titleColor}）｜发光 ${String(T.titleShadow).slice(0, 42)}`);

/*
  页面大标题（「冰室冰山」四个字）——
  用户原话：「冰室冰山页面的大标题冰室冰山四个字看不清 改成适合一点的颜色」。
  原因：深紫底上站里默认那套 `.page-header__title` 用的是 --c-text（深琥珀 #46280f），
  实测对比度只有 1.5:1。现在换成纯白 + 粉光，和 /salon/ 的 h1 同一个色。
*/
const h1Contrast = contrastRgb(rgbOf(T.h1Color), rgbOf(T.bodyBg));
/* ⚠ hex 要先过 hexToRgb（parseColor 只认 rgb()/color(srgb …)） */
const oldContrast = contrastRgb(rgbOf(hexToRgb('#46280f')), rgbOf(T.bodyBg));
check('★ 大标题读得清：纯白 + 粉光（和 /salon/ 大标题同一个色），对比度 ≥ 7:1',
  T.h1Color === 'rgb(255, 255, 255)' && T.h1Color === salonRef.titleColor &&
    /rgba?\(255,\s*79,\s*163/.test(T.h1Shadow || '') && h1Contrast >= 7,
  `「${T.h1Text}」${T.h1Color}，压在 ${T.bodyBg} 上 ${h1Contrast.toFixed(1)}:1` +
    `（改之前那套深琥珀 #46280f 只有 ${oldContrast.toFixed(2)}:1，所以看不清）`);

/*
  正文对比度：文字压在「卡片」和「标识底（合成之后）」上都得读得清。
  ⚠ 卡片色不写死：从**量到的**那条渐变（.ibk__layer 的 background-image，和 /salon/ 逐项比过相等）
  取最亮的一档，压在量到的 body 底色上算 —— CSS 改了颜色而 utils 那边没跟着改，这条会立刻红。
*/
const cardStops = gradientStops(T.cardImg);
const cardRgb = cardStops.length ? over(cardStops[0], rgbOf(T.bodyBg)) : rgbOf(T.bodyBg);
const contrastRows = [];
for (const it of allItems) {
  const ink = rgbOf(it.color);
  let bgEff = cardRgb;
  if (it.badge) {
    /* 标识底 = 分类色（带 alpha 的那一档）再按元素 opacity 压到卡片上 */
    const stops = gradientStops(it.badge.img);
    const deepest = stops[stops.length - 1] ?? null;
    if (deepest) bgEff = over({ ...deepest, a: deepest.a * it.badge.opacity }, cardRgb);
  }
  contrastRows.push({ name: it.name, done: it.done, ratio: contrastRgb(ink, bgEff) });
}
const worst = [...contrastRows].sort((a, b) => a.ratio - b.ratio)[0];
check(`★ 每条文字都读得清：对比度全部 ≥ 4.5:1（最差的一条 ${worst.ratio.toFixed(2)}:1）`,
  contrastRows.every((r) => r.ratio >= 4.5),
  `最差：${worst.name}（${worst.done ? '有标识' : '无标识'}）${worst.ratio.toFixed(2)}:1｜卡片底 ${JSON.stringify(cardRgb)}`);
const chipRows = d.cats.map((c) => ({
  name: c.name,
  ratio: c.on ? contrastRgb(rgbOf(c.color), rgbOf(c.bg)) : null,
  ink: c.inkVar,
}));
check('★ 顶上那排分类色块上的字也读得清（开着的那几颗 ≥ 4.5:1）',
  chipRows.filter((r) => r.ratio !== null).every((r) => r.ratio >= 4.5),
  chipRows.map((r) => (r.ratio === null ? `${r.name}(收着)` : `${r.name} ${r.ratio.toFixed(2)}:1`)).join(' · '));

/* ---- 背景那层扫描线（首页那张贴图，方向反过来） ---- */
const g = T.scan;
check('★ 背景那层线就是首页那张贴图（8×32 的内联 PNG），周期 16px、pixelated',
  /is-iceberg/.test(T.bodyClass) && g.content !== 'none' && g.pos === 'fixed' &&
    /data:image\/png;base64/.test(g.img) && /^8px 16px$/.test(g.size) && g.render === 'pixelated',
  `content=${g.content} position=${g.pos} size=${g.size} render=${g.render}｜${g.img.slice(0, 48)}…`);
check('★ 这层线在动、而且是从下往上：animation-name = ice-scan-up、无限循环、1.1s',
  g.anim === 'ice-scan-up' && g.iter === 'infinite' && Math.abs(parseFloat(g.dur) - 1.1) < 0.05,
  `animation=${g.anim} ${g.dur} ${g.iter}`);
check('★ 扫描线走在正文下面（z-index 0 / 正文 1），点不到、也不挡鼠标',
  g.z === '0' && T.mainZ === '1', `扫描线 z=${g.z}／.site-main z=${T.mainZ}`);

const move = await cdp.ev(`(async () => {
  const py = () => parseFloat(getComputedStyle(document.body, '::before').backgroundPositionY);
  const out = [];
  const t0 = performance.now();
  for (let i = 0; i < 9; i++) {
    out.push({ t: performance.now() - t0, y: py() });
    await new Promise((r) => setTimeout(r, 300));
  }
  const deltas = [];
  for (let i = 1; i < out.length; i++) {
    const dy = out[i].y - out[i - 1].y;
    deltas.push({ dt: out[i].t - out[i - 1].t, dy, wrap: dy > 8 });
  }
  return { ys: out.map((o) => Math.round(o.y * 10) / 10), deltas };
})()`);
const live = move.deltas.filter((x) => !x.wrap);
const moved = live.reduce((s, x) => s + x.dy, 0);
const spanMs = live.reduce((s, x) => s + x.dt, 0);
const speed = spanMs ? (-moved / spanMs) * 1000 : 0;
check('★ 这层线是**自下往上**走的：连续采样 8 次，background-position-y 每次都更小',
  live.length >= 6 && live.every((x) => x.dy < 0),
  `y: ${move.ys.join(' → ')}${move.deltas.some((x) => x.wrap) ? '（中间有一次循环回绕，已跳过）' : ''}`);
check('★ 速度对得上：16px / 1.1s = 14.5px/s（一周期正好一个贴图高，循环处不跳）',
  speed > 12 && speed < 17, `实测 ${speed.toFixed(2)}px/s（${live.length} 段平均）`);

/* ---- 电视信号失真那一层（VHS）：雪花屏 / 彩色格 / 扭曲 ---- */
const v = d.vhs;
check('★ 那一层在、而且盖得住屏幕但点不到（fixed、z-index 30、pointer-events:none、aria-hidden）',
  !!v && v.pos === 'fixed' && v.z === '30' && v.pe === 'none' && v.hidden === 'true' && v.layers >= 5,
  v ? `position=${v.pos} z=${v.z} pe=${v.pe} 子层=${v.layers}` : '没有这一层');
/* 雪花：不只看"有没有写 url()"，把贴图真画进 canvas 量像素 —— 一片纯色就不叫雪花 */
const noise = await cdp.ev(`(async () => {
  const el = document.querySelector('.ibk__vhsSnow');
  if (!el) return { ok: false };
  const url = /url\\("?([^")]+)"?\\)/.exec(getComputedStyle(el).backgroundImage);
  if (!url) return { ok: false, why: '没有 background-image' };
  const img = new Image();
  img.src = url[1];
  await img.decode().catch(() => {});
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth || 0;
  cv.height = img.naturalHeight || 0;
  if (!cv.width) return { ok: false, why: '贴图没解码出来', src: url[1].slice(0, 40) };
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let sum = 0; let sum2 = 0; let n = 0; let min = 255; let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
    sum += v; sum2 += v * v; n += 1;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / n;
  return { ok: true, w: cv.width, h: cv.height, mean: Math.round(mean * 10) / 10,
    min: Math.round(min), max: Math.round(max), std: Math.round(Math.sqrt(sum2 / n - mean * mean) * 10) / 10 };
})()`);
check('★ 雪花屏是**真噪点**（把那张贴图画进 canvas 量：256 级的明暗分布，不是一块纯色）',
  noise.ok === true && noise.w > 0 && noise.std > 8 && noise.max - noise.min > 40,
  JSON.stringify(noise));
check('★ 彩色格那一层：RGB 细条纹 + 细横格，屏幕混合',
  !!v?.rgb && v.rgb.stripes >= 2 && v.rgb.blend === 'screen', v?.rgb ? `${v.rgb.stripes} 层条纹，blend=${v.rgb.blend}` : '');
check('★ 扭曲那一条：三条横向撕裂带，各自带 backdrop-filter（真的会把底下的字糊掉）+ 左右抖的动画',
  !!v && v.tears.length === 3 && v.tears.every((t) => /blur/.test(t.backdrop || '') && /ibk-tear/.test(t.anim)) &&
    new Set(v.tears.map((t) => t.top)).size === 3,
  v ? v.tears.map((t) => `${t.top} ${t.h}px ${t.backdrop}`).join(' | ') : '');
check('★ 还有一条往上滚的亮带（老电视那条 hum bar）',
  !!v?.bar && /ibk-bar/.test(v.bar.anim) && v.bar.h > 60, v?.bar ? `${v.bar.anim} ${v.bar.dur} 高 ${v.bar.h}px` : '');

/* ---- 顶上的分类小眼睛 ---- */
check(`顶上的分类数 = ${legend.length}（只出「真有条目」的那些）`,
  d.cats.length === legend.length && d.cats.every((c, i) => c.id === legend[i].id),
  d.cats.map((c) => `${c.name}${c.on ? '' : '(收着)'}`).join(' · '));

/*
  分类那排**吸顶**：用户原话「让花娅奇闻 冰室怪谈等分类卡片在屏幕往下滚动时
  始终保持在屏幕上方 方便点击开关显示」。
  所以这里三件事一起量：吸住了没有、那个位置上点得到点不到、点了真的能开关。
*/
const sticky = await cdp.ev(`(async () => {
  const bar = document.querySelector('.ibk__cats');
  const header = document.querySelector('.site-header');
  const cs = getComputedStyle(bar);
  const max = () => document.documentElement.scrollHeight - window.innerHeight;
  window.scrollTo({ top: 0, behavior: 'instant' });
  await new Promise((r) => setTimeout(r, 250));
  const atTop = Math.round(bar.getBoundingClientRect().top);
  window.scrollTo({ top: Math.round(max() * 0.6), behavior: 'instant' });
  await new Promise((r) => setTimeout(r, 300));
  const r = bar.getBoundingClientRect();
  const hb = header.getBoundingClientRect();
  const chip = bar.querySelector('.ibk__cat');
  const cr = chip.getBoundingClientRect();
  const x = Math.round(cr.left + cr.width / 2);
  const y = Math.round(cr.top + cr.height / 2);
  const hit = document.elementFromPoint(x, y);
  const id = chip.dataset.cat;
  const items = () => [...document.querySelectorAll('.ibk__cell[data-cat="' + id + '"] .ibk__item')];
  const before = chip.dataset.on;
  chip.click();
  await new Promise((r) => setTimeout(r, 200));
  const afterOn = chip.dataset.on;
  const pressed = chip.getAttribute('aria-pressed');
  const hiddenNow = items().length > 0 && items().every((el) => el.hidden);
  chip.click();
  await new Promise((r) => setTimeout(r, 200));
  return {
    pos: cs.position, top: cs.top, z: cs.zIndex, bg: cs.backgroundColor, backdrop: cs.backdropFilter,
    atTop, pinnedTop: Math.round(r.top), headerBottom: Math.round(hb.bottom),
    hitIsChip: !!(hit && hit.closest && hit.closest('.ibk__cat')),
    hitCls: hit ? String(hit.className).slice(0, 40) : '',
    name: (chip.querySelector('.ibk__catName') || {}).textContent, before, afterOn, pressed, hiddenNow,
    back: chip.dataset.on, n: items().length,
  };
})()`);
console.log('\n================ 分类那排吸顶 ================');
console.log(JSON.stringify(sticky));
check('★ 分类那排是吸顶的（position: sticky，让开的高度按站点页头量出来）',
  sticky.pos === 'sticky' && parseFloat(sticky.top) > 30 && /blur/.test(sticky.backdrop || ''),
  `position=${sticky.pos} top=${sticky.top} 毛玻璃=${sticky.backdrop} 底=${sticky.bg}`);
const stickyGap = sticky.pinnedTop - sticky.headerBottom;
check('★ 往下滚之后它**一直贴在页头下面**（离页头下沿就是脚本量出来的那点缝，2~10px），没被条目顶走',
  /* 滚下去之后它比静止位置**更靠上**（吸住了），而且紧贴页头下沿 */
  sticky.pinnedTop < sticky.atTop && stickyGap >= 2 && stickyGap <= 10,
  `静止时 top=${sticky.atTop}px；滚到 60% 时 top=${sticky.pinnedTop}px，页头下沿 ${sticky.headerBottom}px（缝 ${stickyGap}px）`);
check('★ 吸顶状态下**点得到**（那个坐标上的元素就是分类小眼睛本身，没被卡片或那层 VHS 挡住）',
  sticky.hitIsChip === true, `elementFromPoint → ${sticky.hitCls || '（空）'}`);
check('★ 吸顶状态下点一下真的能开关（这一类的条目整批藏起来，再点一下回来）',
  sticky.n > 0 && sticky.afterOn !== sticky.before && sticky.pressed === (sticky.afterOn === '1' ? 'true' : 'false') &&
    sticky.hiddenNow === (sticky.afterOn === '0') && sticky.back === sticky.before,
  `点「${sticky.name}」（${sticky.n} 条）：${sticky.before} → ${sticky.afterOn}（aria-pressed=${sticky.pressed}，条目藏起来=${sticky.hiddenNow}）→ 回到 ${sticky.back}`);
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
if (withHead.length) {
  check('有头图的层右边真画出了头图',
    withHead.every(([, L]) => !!L.headSrc),
    withHead.map(([l, L]) => `${l.title || '（空标题）'}→${L.headSrc ? '有' : '没有'}`).join(' '));
} else {
  skip(`数据里还没有任何一层传了头图（${layers.length} 层都没传）—— 跳过「头图」这一条；传了之后它会自动开始量`);
}

/* ---- 悬停卡片 ---- */
await cdp.ev('window.scrollTo({ top: 0, behavior: "instant" })');
const target = await cdp.ev(`(() => {
  const el = [...document.querySelectorAll('.ibk__item')].find((x) => (x.dataset.desc || '').length > 0 && !x.hidden);
  if (!el) return null;
  /* ⚠ 必须 instant：全站 html{scroll-behavior:smooth}，平滑滚动时当场读到的 rect
     还是滚动前的位置，鼠标就点空了（分类那排吸顶之后页面更长，更容易踩到） */
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
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
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
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

/* ---- 链接：点一下真的开始跳过去 ---- */
if (firstLinked) {
  await cdp.goto(PAGE, 1800);
  const linkAt = await cdp.ev(`(() => {
    const a = [...document.querySelectorAll('a.ibk__item')].find((x) => !x.hidden);
    if (!a) return null;
    /* ⚠ 必须 instant：全站 html { scroll-behavior: smooth }，平滑滚动时
       当场读到的 rect 还是滚动前的位置，300ms 后元素早跑掉了，鼠标就点空 */
    a.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = a.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), href: a.href, attr: a.getAttribute('href'), nested: !!a.querySelector('a') };
  })()`);
  await sleep(300);
  cdp.navs = [];
  cdp.reqs = [];
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: linkAt.x, y: linkAt.y, buttons: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: linkAt.x, y: linkAt.y, button: 'left', clickCount: 1, buttons: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: linkAt.x, y: linkAt.y, button: 'left', clickCount: 1, buttons: 0 });
  await sleep(2500);
  const after = await cdp.ev('location.pathname');
  /*
    证据用「浏览器真的开始跳了」这件事本身（Page.frameRequestedNavigation /
    主文档请求）。外链不一定连得上（验收机不一定通外网），所以不能只看 location 变没变。
  */
  const tried = [...cdp.navs, ...cdp.reqs];
  const navHit = tried.find((u) => u === linkAt.href || u.startsWith(linkAt.href));
  const internal = linkAt.attr.startsWith('/');
  check(`★ 填了链接的条目点一下就跳过去：${linkAt.attr} → 浏览器真的开始跳了`,
    !!navHit && (internal ? after.replace(/\/$/, '') === linkAt.attr.replace(/\/$/, '') : true),
    `点的是 href=${linkAt.attr}｜浏览器请求跳转/主文档请求：${tried.slice(0, 2).join(' ') || '（没有）'}${internal ? `｜落点 ${after}` : '（外链，只看有没有开始跳）'}`);
  check('条目本身是链接时，里面没有再套一层链接（套了 HTML 结构会被解析器拆坏）',
    linkAt.nested === false, `nested=${linkAt.nested}`);
  await cdp.goto(PAGE, 1600);
} else {
  console.log('（数据里没有带链接的条目，跳过「点了会跳」这一条）');
}

/* ---------------- 特效：深度（按页面比例）+ 偶发爆发 ----------------
   放最后：这一段会往 DOM 里复制整份层级（验"冰山变长了也按比例"），
   做完再进手机那一趟（那边是整页 reload，复制的东西自然没了）。 */
const depth = await cdp.ev(`(async () => {
  /* 滚一下、等它落定再读（scroll 事件是异步派发的，滚完立刻读会读到上一格） */
  const read = async () => {
    await new Promise((r) => setTimeout(r, 140));
    return Number(getComputedStyle(document.documentElement).getPropertyValue('--ibk-deep')) || 0;
  };
  const max = () => document.documentElement.scrollHeight - window.innerHeight;
  const out = [];
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    window.scrollTo({ top: Math.round(max() * f), behavior: 'instant' });
    out.push({ f, deep: Math.round((await read()) * 1000) / 1000 });
  }
  return { max: max(), out };
})()`);
console.log('\n================ 特效强度跟着滚动深度走 ================');
console.log(JSON.stringify(depth));
check(`★ 深度按**页面比例**算：滚到 0/25/50/75/100% 时 --ibk-deep 就是 0 / 0.25 / 0.5 / 0.75 / 1`,
  depth.out.every((x) => Math.abs(x.deep - x.f) <= 0.06),
  depth.out.map((x) => `${(x.f * 100).toFixed(0)}%→${x.deep}`).join(' · '));

const prop = await cdp.ev(`(async () => {
  const read = async () => {
    await new Promise((r) => setTimeout(r, 200));
    return Number(getComputedStyle(document.documentElement).getPropertyValue('--ibk-deep')) || 0;
  };
  const max = () => document.documentElement.scrollHeight - window.innerHeight;
  const wrap = document.querySelector('.ibk__layers');
  const before = { max: max(), layers: wrap.children.length };
  for (const l of [...wrap.children]) wrap.appendChild(l.cloneNode(true));
  await new Promise((r) => setTimeout(r, 400));
  const after = { max: max(), layers: wrap.children.length };
  window.scrollTo({ top: Math.round(after.max * 0.5), behavior: 'instant' });
  const deepHalf = Math.round((await read()) * 1000) / 1000;
  window.scrollTo({ top: after.max, behavior: 'instant' });
  const deepEnd = Math.round((await read()) * 1000) / 1000;
  return { before, after, deepHalf, deepEnd };
})()`);
console.log(JSON.stringify(prop));
check('★ 冰山以后变长了也照样"越深越明显"：把 6 层复制一份（页面高翻倍）后，滚到新的 50% 处 --ibk-deep 还是 ≈0.5（按像素算的话只会是 0.25）',
  prop.after.layers === prop.before.layers * 2 && prop.after.max > prop.before.max * 1.8 &&
    Math.abs(prop.deepHalf - 0.5) <= 0.06 && Math.abs(prop.deepEnd - 1) <= 0.06,
  `层 ${prop.before.layers}→${prop.after.layers}、可滚 ${prop.before.max}→${prop.after.max}px；50%→${prop.deepHalf}、100%→${prop.deepEnd}`);

const bursts = await cdp.ev(`(async () => {
  const vhs = document.querySelector('[data-ibk-vhs]');
  const read = () => ({
    o: Number(getComputedStyle(vhs).opacity),
    b: Number(getComputedStyle(document.documentElement).getPropertyValue('--ibk-burst')) || 0,
  });
  const sample = async (ms) => {
    const out = []; const t0 = performance.now();
    while (performance.now() - t0 < ms) { out.push(read()); await new Promise((r) => setTimeout(r, 100)); }
    return out;
  };
  const max = () => document.documentElement.scrollHeight - window.innerHeight;
  window.scrollTo({ top: 0, behavior: 'instant' });
  await new Promise((r) => setTimeout(r, 800));
  const top = await sample(4000);
  window.scrollTo({ top: max(), behavior: 'instant' });
  await new Promise((r) => setTimeout(r, 800));
  const bottom = await sample(9000);
  const stat = (a) => ({ n: a.length, max: Math.round(Math.max(...a.map((x) => x.o)) * 1000) / 1000, bursts: a.filter((x) => x.b > 0.05).length });
  return { top: stat(top), bottom: stat(bottom) };
})()`);
console.log(JSON.stringify(bursts));
check('★ 页面最顶端几乎看不到这层（opacity 一直是 0 —— 一进页面不该有雪花）',
  bursts.top.max === 0, `顶端 4 秒采样 ${bursts.top.n} 次，最大 opacity ${bursts.top.max}`);
check('★ 滚到最深处会**偶尔**来一下：9 秒里至少捕到一次爆发，而且那一瞬间很明显',
  bursts.bottom.bursts >= 1 && bursts.bottom.max > 0.3,
  `深处 9 秒采样 ${bursts.bottom.n} 次，爆发 ${bursts.bottom.bursts} 次，最大 opacity ${bursts.bottom.max}`);
check('★ 「越深越明显」：深处的强度明显大于顶端',
  bursts.bottom.max > bursts.top.max, `顶端 ${bursts.top.max} / 深处 ${bursts.bottom.max}`);

/* ---------------- 手机端 ---------------- */
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp.goto(PAGE, 2400);
const m = await cdp.ev(PROBE);console.log('\n================ 手机 390 ================');
console.log(JSON.stringify({ overflow: m.overflow, layers: m.layers.map((L) => ({ w: L.rect.w, head: L.headRect?.w ?? null, items: L.items.length })) }));
check('手机端不横向溢出', m.overflow <= 1, `scrollWidth - clientWidth = ${m.overflow}`);
check('手机端层级还是完整宽度（一栏叠下来，没被挤窄）',
  m.layers.every((L) => L.rect.w >= 300), m.layers.map((L) => `${L.rect.w}px`).join(' / '));
check('手机端条目都没超宽（每条都在层里）',
  m.layers.every((L) => L.items.every((it) => !it.badge || it.badge.itemW <= L.rect.w)),
  '');
const headFirst = m.layers.filter((L) => L.headRect && L.titleTop !== null);
if (headFirst.length) {
  check('手机端头图挪到标题上面、而且是整条横幅（宽度 = 整层宽）',
    headFirst.every((L) => L.headTop < L.titleTop) &&
      headFirst.every((L) => Math.abs(L.headRect.w - L.rect.w) <= 2 && L.headRect.h >= 100),
    headFirst.map((L) => `${L.headRect.w}×${L.headRect.h} @${Math.round(L.headTop)} / 标题 @${Math.round(L.titleTop)}`).join(' · '));
} else {
  skip('数据里还没有任何一层传了头图 —— 跳过「手机端头图挪到上面」这一条');
}
check('手机端分类那一排还在（能手动开关）', m.cats.length === d.cats.length, `${m.cats.length} 个`);

/* 手机端那排也要吸得住：窄屏页头会换行变高，--ibk-top 是脚本量的，必须跟着变 */
const stickyM = await cdp.ev(`(async () => {
  const bar = document.querySelector('.ibk__cats');
  const header = document.querySelector('.site-header');
  const max = () => document.documentElement.scrollHeight - window.innerHeight;
  window.scrollTo({ top: Math.round(max() * 0.5), behavior: 'instant' });
  await new Promise((r) => setTimeout(r, 320));
  const r = bar.getBoundingClientRect();
  const hb = header.getBoundingClientRect();
  const chip = bar.querySelector('.ibk__cat');
  const cr = chip.getBoundingClientRect();
  const hit = document.elementFromPoint(Math.round(cr.left + cr.width / 2), Math.round(cr.top + cr.height / 2));
  return {
    gap: Math.round(r.top - hb.bottom), headerH: Math.round(hb.height), top: getComputedStyle(bar).top,
    pinned: Math.round(r.top), vh: innerHeight, vw: innerWidth, barW: Math.round(r.width),
    hitIsChip: !!(hit && hit.closest && hit.closest('.ibk__cat')), barHidden: Number(getComputedStyle(bar).opacity) === 0,
  };
})()`);
check('★ 手机端那排分类也吸得住、也点得到（页头换行变高了，让开的高度跟着量出来）',
  stickyM.gap >= 0 && stickyM.gap <= 12 && stickyM.pinned >= 0 && stickyM.pinned < stickyM.vh * 0.4 &&
    stickyM.barW <= stickyM.vw && stickyM.hitIsChip === true,
  `页头高 ${stickyM.headerH}px、CSS top=${stickyM.top}、滚到 50% 时栏顶 ${stickyM.pinned}px（缝 ${stickyM.gap}px，视口 ${stickyM.vw}×${stickyM.vh}）`);

/* ---- 系统设了「减少动态效果」：这层栅格要自己停下来 ---- */
await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await cdp.goto(PAGE, 1500);
const rm = await cdp.ev(`(() => {
  const g = getComputedStyle(document.body, '::before');
  return { anim: g.animationName, dur: g.animationDuration, iter: g.animationIterationCount, content: g.content };
})()`);
check('★ 系统设了「减少动态效果」时这层扫描线自动停下（时长压到 0.01ms、只跑一次）',
  rm.content !== 'none' && parseFloat(rm.dur) < 0.01 && rm.iter === '1',
  JSON.stringify(rm));
await cdp.send('Emulation.setEmulatedMedia', { features: [] });

check('两端都没有 JS 报错', cdp.all.length === 0, cdp.all.slice(0, 2).join(' | '));

try { await cdp.send('Browser.close'); } catch { /* ignore */ }
chrome.kill();
server.close();
console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
