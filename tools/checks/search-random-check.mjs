/*
 * 站内搜索 + 随机跳转（用户 2026-09-22 要的那两件事）。
 *
 * 原话：「全局搜索：全局搜索框放在随机跳转框的左边 …… 输入文字搜索以后会在下面展开一列卡片
 * 显示所有相关的结果 点击可以直接跳转到对应页面 如果输入文字后回车或是点击放大镜
 * 那么根据文字的匹配程度 直接进入对应页面或是进入一个新的搜索中转页面 ……
 * 虽然一般点击搜索结果以后会跳转到其所在的页面的默认开始处，但冰室精华页面内的每一条
 * 精华都可以单独被跳转，搜索到独立的一条精华以后点击跳转，会直接跳转到精华页里
 * 这条精华所在的位置。」「随机跳转：图标是从兔子洞里探出来的一只兔子，悬停弹出卡片
 * 显示随机跳转，点击跳转到本站任意一个页面。另外把回到顶部的悬停文字也改成这种卡片。」
 *
 * 量的东西分两段：
 *   一、产物里能静态查的（索引本身）：每一条 href 都能落到一个真文件；
 *       带 # 的锚点在目标页 HTML 里真的有那个 id；索引覆盖了构建出来的每一个页面。
 *   二、浏览器里量（真的鼠标移动 / 真的按键 / 真的点击）：
 *       控件顺序与尺寸、两张悬停卡片、输入即出的下拉、弱匹配回车 → 中转页、
 *       强匹配回车 → 直达、精华那一条点击后落到 /salon/#<id> 且那条在视口里、
 *       随机跳转连点 5 次是不是真的在乱跳。
 *
 * 用法：node tools/checks/search-random-check.mjs [dist目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
const PORT = 4433;
const DEBUG_PORT = 9403;
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
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};

/* ==========================================================================
 *  一、产物里能静态查的
 * ======================================================================== */
const idxFile = path.join(root, 'search.json');
if (!fs.existsSync(idxFile)) {
  console.error(`没有 ${idxFile}：先构建一次（索引在 astro:build:done 里生成）`);
  process.exit(2);
}
const index = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
const items = index.items ?? [];
console.log(`索引：${items.length} 条 ${JSON.stringify(index.kinds)}`);

check('索引条数 > 1000，且与文件里记的 count 一致', items.length > 1000 && index.count === items.length,
  `count=${index.count}`);
const KINDS = ['page', 'anchor', 'essence', 'post', 'note', 'nav', 'ice', 'point'];
check('八类都在索引里（页面/锚点/精华/文章/手记/导航/冰山/时间轴）',
  KINDS.every((k) => (index.kinds?.[k] ?? 0) > 0) &&
    Object.keys(index.kinds ?? {}).every((k) => KINDS.includes(k) || k === 'map'),
  JSON.stringify(index.kinds));
/*
  map（地图图钉）现在恒为 0，不是漏了：首页地图上带链接的图钉就两个
  （虹星家、隰辰煦家），它们的「地址 + 标题」和那两个板块页完全一样，
  最后一步去重时就并进 page 那条了。地图是给板块页做入口的，消息不丢。
*/
console.log(`地图图钉：${index.kinds?.map ?? 0} 条（那两个图钉与对应板块页重复，去重后并入 page —— 符合预期）`);
check('★ 冰室精华 784 条每条都在（这是"每条精华单独可跳"的前提）',
  (index.kinds?.essence ?? 0) === 784, `essence=${index.kinds?.essence}`);
check('索引里所有条目都有 t/ h /k，且没有重复的「地址+标题」',
  items.every((it) => it.t && it.h && it.k) &&
    new Set(items.map((it) => `${it.h}\n${it.t}`)).size === items.length);

/** 把 /a/b/#c 这样的地址落成产物里的真文件 */
function resolveFile(p) {
  const clean = p.replace(/^\//, '');
  for (const t of [clean, `${clean}.html`, path.posix.join(clean, 'index.html')]) {
    const f = path.join(root, t);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  return null;
}
const htmlCache = new Map();
const htmlOf = (f) => {
  if (!htmlCache.has(f)) htmlCache.set(f, fs.readFileSync(f, 'utf8'));
  return htmlCache.get(f);
};

/* ① 每条 href 都要落得到文件（站外那些标了 ext 的不算：它们本来就不在产物里） */
const dead = [];
let extCount = 0;
for (const it of items) {
  if (it.ext) {
    extCount++;
    continue;
  }
  const p = it.h.split('#')[0];
  if (!resolveFile(p)) dead.push(it.h);
}
check('★ 索引里每一条站内地址都能在产物里找到对应的页面（' + (items.length - extCount) + ' 条全查）',
  dead.length === 0,
  (dead.length ? `落不到的 ${dead.length} 条，例如 ${dead.slice(0, 3).join(' ')}：` : '全部命中；') +
    `另有 ${extCount} 条站外链接（导航库里收藏的，跳转时新开标签页）`);

/* ② 带锚点的：目标页里真的要有那个 id（精华那 784 条也走这条） */
const badAnchor = [];
for (const it of items) {
  const [p, hash] = it.h.split('#');
  if (!hash) continue;
  const f = resolveFile(p);
  if (!f) continue; // 上一条已经记过
  if (!htmlOf(f).includes(`id="${hash}"`)) badAnchor.push(it.h);
}
const anchorTotal = items.filter((it) => it.h.includes('#')).length;
check('★ 带 # 的每一条，目标页里都存在那个 id（锚点 + 精华共 ' + anchorTotal + ' 条）',
  badAnchor.length === 0 && anchorTotal >= 800,
  badAnchor.length ? `缺 ${badAnchor.length} 个，例如 ${badAnchor.slice(0, 3).join(' ')}` : `${anchorTotal} 条全部命中`);

/* ③ 索引要覆盖构建出来的每一个页面（随机跳转的抽签池就是靠这个"全"） */
const builtPages = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    /*
      dist/secret/ 是 public/ 里手写的一个独立页面（首页那座雕像点进去的 Spine 演示），
      它不经过 BaseLayout、也没有站点的头尾和控件，按设计既不该进索引、也不该被随机跳到。
    */
    if (e.isDirectory() && path.relative(root, p).split(path.sep)[0] === 'secret') continue;
    if (e.isDirectory()) walk(p);
    else if (e.name === 'index.html') {
      // 根目录那一页的 rel 是空串，得拼成 '/'，不能拼成 '//'（这条自己踩过一次）
      const rel = path.relative(root, dir).split(path.sep).join('/');
      builtPages.push(rel ? `/${rel}/` : '/');
    }
  }
})(root);
const norm = (h) => h.replace(/\/$/, '');
const pooled = new Set(items.filter((it) => it.k === 'page' || it.k === 'post' || it.k === 'note').map((it) => norm(it.h)));
const missing = builtPages.filter((h) => h !== '/404/' && !pooled.has(norm(h)));
check('★ 构建出来的每个页面都在索引里（' + builtPages.length + ' 个 index.html，404 和 public/secret 除外）',
  missing.length === 0, missing.length ? `漏了 ${missing.slice(0, 4).join(' ')}` : `抽签池 ${pooled.size} 个整页`);
check('★ 首页本身也在抽签池里（随机跳转能跳回首页）', pooled.has(''),
  items.some((it) => it.h === '/' && it.k === 'page') ? '索引里有 / 这条' : '索引里没有 /');

/* ④ 每个页面都要挂上这两个控件 */
const htmlFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && path.relative(root, p).split(path.sep)[0] === 'secret') continue;
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) htmlFiles.push(p);
  }
})(root);
const need = ['id="site-search-input"', 'id="random-jump"', 'id="site-search-pop"', 'id="site-search-hint"'];
const naked = htmlFiles.filter((f) => {
  const h = htmlOf(f);
  return !need.every((n) => h.includes(n));
});
check('★ 每一个页面（' + htmlFiles.length + ' 个）都有搜索框和随机跳转', naked.length === 0,
  naked.length ? `缺的：${naked.slice(0, 3).map((f) => path.relative(root, f)).join(' ')}` : '全都有');
const noRuntime = htmlFiles.filter((f) => !htmlOf(f).includes('window.__SEARCH_CFG__') || !htmlOf(f).includes('HuayaSearch'));
check('每个页面都内联了搜索运行时（配置 + 内核）', noRuntime.length === 0,
  noRuntime.length ? `${noRuntime.length} 个页面没有` : '');
const tipPages = htmlFiles.filter((f) => {
  const h = htmlOf(f);
  return !(h.includes('>随机跳转</span>') && h.includes('>回到顶部</span>'));
});
check('两张悬停卡片（随机跳转 / 回到顶部）在每个页面里都在', tipPages.length === 0,
  tipPages.length ? `${tipPages.length} 个页面缺` : '');

/* ⑤ 中转页本身 */
const transitFile = path.join(root, 'search', 'index.html');
const transitHtml = fs.existsSync(transitFile) ? fs.readFileSync(transitFile, 'utf8') : '';
check('/search/ 中转页构建出来了，带搜索表单、标了 noindex', !!transitHtml &&
  transitHtml.includes('id="srch-page-form"') && transitHtml.includes('name="robots"') &&
  transitHtml.includes('content="noindex, nofollow"'));
check('中转页里内联了内核与它自己的脚本', transitHtml.includes('HuayaSearch') && transitHtml.includes('srch-page-body'));

/* ⑥ 挑三个查询词给浏览器那段用：强匹配 / 弱匹配 / 唯一精华 */
const titleCount = new Map();
for (const it of items) titleCount.set(it.t, (titleCount.get(it.t) ?? 0) + 1);

/**
 * 强匹配：标题在全表里唯一的页面。
 * 打字进去它必然排第一（标题一模一样 = 120 分），第二名最多 100（标题以它开头），
 * 差 ≥ 20 —— 一定够"直接进入对应页面"。
 */
const strong = items.find((it) =>
  it.k === 'page' && it.t.length >= 2 && it.t.length <= 8 && titleCount.get(it.t) === 1 &&
  /^[\u4e00-\u9fa5A-Za-z0-9]+$/.test(it.t));

/**
 * 弱匹配：某个 2 字纯汉字片段只出现在正文里（一个标题都没有），命中 3~40 条。
 * 标题里一个都没有 ⇒ 谁都不可能拿到 100 分以上 ⇒ 一定走中转页。
 */
const allTitle = [...titleCount.keys()].join('\n');
const CJK2 = /^[\u4e00-\u9fa5]{2}$/;
let weak = null;
let weakHits = 0;
outer: for (const it of items) {
  if (it.k !== 'essence' || it.ext) continue;
  const s = String(it.s ?? '');
  for (let i = 0; i + 2 <= s.length; i++) {
    const w = s.slice(i, i + 2);
    if (!CJK2.test(w) || allTitle.includes(w)) continue;
    const hits = items.filter((o) => String(o.s ?? '').includes(w)).length;
    if (hits >= 3 && hits <= 40) {
      weak = w;
      weakHits = hits;
      break outer;
    }
  }
}

/*
  唯一精华：先粗挑一批候选，**再放到页面里用真的那个打分函数筛**。
  为什么不能在这儿自己判：core.js 里除了「标题/正文包含」还有一条"字符按顺序散落也算命中"
  （inOrder，用来兜中文掐头去尾的输法），照 Node 这份粗算，「0001」看着只命中 1 条，
  实际跑起来 409 条 —— 自己重写一遍打分就等于把要验的东西又抄了一遍，那是假证据。
*/
const essenceCands = [];
for (const it of items) {
  if (it.k !== 'essence' || it.ext || essenceCands.length >= 14) continue;
  const s = String(it.s ?? '');
  for (let i = 0; i + 6 <= s.length; i++) {
    const w = s.slice(i, i + 6);
    if (!/^[\u4e00-\u9fa5]{6}$/.test(w)) continue;
    /*
      ⚠ 这里**不能**要求「标题里没有它」：精华条目的标题就是它自己那段正文，
      从正文里取的 6 个字天然在自己的标题里 —— 加了那条限制一个候选都挑不出来
      （第一版就是这么写的，日志里写着 0 个）。
      标题命中反而更好（分数 82），唯一性交给浏览器里那个真的打分函数确认。
    */
    if (items.filter((o) => String(o.s ?? '').includes(w)).length === 1) {
      essenceCands.push(w);
      break;
    }
  }
}

console.log(`强匹配词「${strong?.t}」→ ${strong?.h}`);
console.log(`弱匹配词「${weak}」（正文命中 ${weakHits} 条，标题里一个都没有）`);
console.log(`唯一精华的候选词：${essenceCands.slice(0, 6).join(' / ')}…（真假到头来由页面里的打分函数说了算）`);
check('强匹配 / 弱匹配的测试词都挑出来了', !!strong && !!weak && weakHits >= 3);
check('唯一精华的候选词挑出来了（≥3 个，浏览器里再逐个确认）', essenceCands.length >= 3,
  `${essenceCands.length} 个`);

/* ==========================================================================
 *  二、浏览器里量
 * ======================================================================== */
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

const profile = path.join(process.env.TEMP ?? '.', `dsh-search-${Date.now()}`);
const chrome = spawn(
  CHROME,
  ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
   '--window-size=1440,900', `--user-data-dir=${profile}`,
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
  /** 跳转过程中执行上下文会被销毁，这里吞掉那种瞬时错误 */
  async tryEv(e) {
    try {
      return await this.ev(e);
    } catch {
      return undefined;
    }
  }
  async goto(p, wait = 900) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 160; i++) {
      await sleep(120);
      if ((await this.tryEv('document.readyState')) === 'complete') break;
    }
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

const waitFor = async (expr, ms = 6000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await cdp.tryEv(expr);
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await sleep(140);
  }
};
/** 等地址真的换了（同一页里的 # 跳转不会换 pathname，所以比的是 href） */
const waitHrefChange = async (prev, ms = 8000) => {
  const t0 = Date.now();
  for (;;) {
    const h = await cdp.tryEv('location.href');
    if (h && h !== prev) return h;
    if (Date.now() - t0 > ms) return null;
    await sleep(140);
  }
};
const rectOf = (sel) => cdp.ev(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
           cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) };
})()`);
const hover = async (x, y) => {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
  await sleep(360);
};
const realClick = async (x, y) => {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
  await sleep(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(50);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
};
/** 真的一个键一个键敲进去（不是直接改 value） */
const typeText = async (text) => {
  for (const ch of text) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    await sleep(45);
  }
};
const pressKey = async (key, code, vk) => {
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
};
const focusSearch = () => cdp.ev(`(() => { const i = document.getElementById('site-search-input'); i.focus(); return document.activeElement === i; })()`);
/*
  等页面自己滚完再量。精华页落地时会自己滚到 hash 那一条
  （salon.astro 的 landOnEntry：进页面 600ms 一次、document.fonts.ready 之后再一次），
  不等它停就量，量到的可能是滚到一半的位置。
*/
const settleScroll = async () => {
  await cdp.ev(`(async () => {
    let last = -1, still = 0;
    for (let i = 0; i < 40 && still < 4; i++) {
      await new Promise((r) => setTimeout(r, 150));
      const y = Math.round(window.scrollY);
      if (y === last) still++; else { still = 0; last = y; }
    }
    return Math.round(window.scrollY);
  })()`);
};

/* ---------------- ① 顶栏这一排：顺序、尺寸、不溢出 ---------------- */
await cdp.goto('/', 1400);
await waitFor('!!window.HuayaSearch');

/*
  先定下「唯一精华」那个查询词：候选从索引里粗挑，但**唯一性由页面里真的那个
  打分函数判**（见上面 essenceCands 的说明）。这一步也顺带证明了索引能在浏览器里加载出来。
*/
const essence = (await cdp.ev(`(async () => {
  const S = window.HuayaSearch;
  await S.load();
  for (const w of ${JSON.stringify(essenceCands)}) {
    const r = S.search(w, 0);
    if (r.length === 1 && r[0].it.h.indexOf('/salon/#') === 0) {
      return { word: w, href: r[0].it.h, id: r[0].it.h.split('#')[1], title: r[0].it.t };
    }
  }
  return null;
})()`)) ?? { word: '', href: '', id: '__没挑到__', title: '' };
console.log('唯一精华词：', JSON.stringify(essence));
check('★ 挑出一个"全站只命中一条精华"的查询词（页面里的打分函数确认过）',
  !!essence.id && essence.id !== '__没挑到__', `${essence.word} → ${essence.href}`);

const geom = await cdp.ev(`(() => {
  const pick = (id) => document.getElementById(id);
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  return {
    search: box(document.getElementById('site-search-box')),
    random: box(pick('random-jump')),
    totop: box(pick('totop')),
    drawer: box(pick('drawer-toggle')),
    vol: pick('music-vol') ? box(pick('music-vol')) : null,
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
  };
})()`);
console.log('顶栏几何：', JSON.stringify(geom));
check('★ 搜索框在随机跳转左边，随机跳转在回到顶部左边',
  geom.search.x < geom.random.x && geom.random.x < geom.totop.x,
  `搜索 ${geom.search.x} < 随机 ${geom.random.x} < 回顶 ${geom.totop.x}`);
check('这几个控件一样高、在同一条线上（搜索框和按钮同一套皮）',
  geom.search.h === geom.random.h && geom.random.h === geom.totop.h &&
    Math.abs(geom.search.y - geom.totop.y) <= 1,
  `高 ${geom.search.h}/${geom.random.h}/${geom.totop.h}，y ${geom.search.y}/${geom.random.y}/${geom.totop.y}`);
check('搜索框是"框"不是小方块（宽度明显大于高度）', geom.search.w > geom.search.h * 2, `${geom.search.w}×${geom.search.h}`);
check('这一排没有把页面撑出横向滚动条', geom.scrollW <= geom.innerW, `scrollWidth=${geom.scrollW} / innerWidth=${geom.innerW}`);

/* ---------------- ② 两张悬停卡片 ---------------- */
const tipStyle = (btnId) => cdp.ev(`(() => {
  const el = document.getElementById(${JSON.stringify(btnId)}).parentElement.querySelector('.tip');
  const s = getComputedStyle(el);
  return { text: el.textContent.trim(), opacity: +s.opacity, visibility: s.visibility,
           bg: s.backgroundColor, radius: s.borderRadius, shadow: s.boxShadow, color: s.color };
})()`);

const beforeHover = await tipStyle('random-jump');
check('不碰它的时候卡片是藏着的', beforeHover.opacity === 0 || beforeHover.visibility === 'hidden',
  `opacity=${beforeHover.opacity} visibility=${beforeHover.visibility}`);
const rRect = await rectOf('#random-jump');
await hover(rRect.cx, rRect.cy);
const randomTip = await tipStyle('random-jump');
console.log('随机跳转的卡片：', JSON.stringify(randomTip));
check('★ 鼠标移到随机跳转上：弹出卡片，写的是「随机跳转」', randomTip.text === '随机跳转' &&
  randomTip.opacity === 1 && randomTip.visibility === 'visible', JSON.stringify(randomTip.text));
check('★ 卡片是站点那套卡片皮（底色+圆角+阴影，不是浏览器自带的 title 提示）',
  randomTip.bg !== 'rgba(0, 0, 0, 0)' && parseFloat(randomTip.radius) >= 4 && randomTip.shadow !== 'none',
  `bg=${randomTip.bg} r=${randomTip.radius}`);
await hover(700, 500);
const away = await tipStyle('random-jump');
check('鼠标移开之后卡片收回去', away.opacity === 0 || away.visibility === 'hidden', `opacity=${away.opacity}`);

const tRect = await rectOf('#totop');
await hover(tRect.cx, tRect.cy);
const totopTip = await tipStyle('totop');
console.log('回到顶部的卡片：', JSON.stringify(totopTip));
check('★ 鼠标移到回到顶部上：同样弹出卡片，写的是「回到顶部」', totopTip.text === '回到顶部' &&
  totopTip.opacity === 1 && totopTip.visibility === 'visible', JSON.stringify(totopTip.text));
check('回到顶部这颗按钮上再没有浏览器的 title 提示（只有卡片）',
  (await cdp.ev(`document.getElementById('totop').hasAttribute('title')`)) === false);
await hover(700, 500);

/* ---------------- ③ 输入即出下拉：弱匹配 → 回车进中转页 ---------------- */
await focusSearch();
await typeText(weak);
const popOut = await waitFor(`(() => {
  const p = document.getElementById('site-search-pop');
  const rows = p.querySelectorAll('.srch__row');
  if (!p.hidden && rows.length >= 2) return { hidden: p.hidden, n: rows.length,
    first: rows[0].getAttribute('href'), hrefs: [...rows].map((r) => r.getAttribute('href')),
    firstTitle: rows[0].querySelector('.srch__rowTitle').textContent,
    hint: document.getElementById('site-search-hint').textContent };
  return null;
})()`, 5000);
console.log('弱匹配下拉：', JSON.stringify(popOut));
check('★ 一敲字就在下面展开一列结果卡片（' + (popOut?.n ?? 0) + ' 张）', !!popOut && popOut.n >= 2);
check('卡片上写清了这条跳过去是什么（标题 + 种类标签）',
  !!(await cdp.ev(`document.querySelector('#site-search-pop .srch__row .srch__kind')?.textContent`)));
check('页脚那行说明了回车会去哪儿（这轮是"看全部"）',
  !!popOut && popOut.hint.includes('回车：看全部'), popOut?.hint);
await pressKey('Enter', 'Enter', 13);
const afterEnter = await waitHrefChange(`http://127.0.0.1:${PORT}/`);
check('★ 弱匹配回车 → 进 /search/ 中转页，并且把查询词带过去了',
  !!afterEnter && afterEnter.includes('/search/?q=') && decodeURIComponent(afterEnter).includes(weak),
  afterEnter ?? '没跳走');
await sleep(900);
const transit = await cdp.ev(`(() => {
  const links = [...document.querySelectorAll('.srchPage__link')];
  return { sum: document.getElementById('srch-page-sum').textContent,
           groups: [...document.querySelectorAll('.srchPage__groupTitle')].map((h) => h.textContent.replace(/\\s+/g, ' ')),
           first: links[0] ? links[0].getAttribute('href') : null, n: links.length,
           hrefs: links.map((a) => a.getAttribute('href')),
           input: document.getElementById('srch-page-input').value };
})()`);
console.log('中转页：', JSON.stringify({ ...transit, hrefs: transit.hrefs.length + ' 条' }));
check('★ 中转页把同一批结果铺开了，第一条和下拉里的第一条是同一条（同一套排序的下游）',
  transit.first === popOut?.first, `中转页首条 ${transit.first} / 下拉首条 ${popOut?.first}`);
check('★ 下拉里出现过的每一条，中转页里都找得到（下拉只是取前 8 条）',
  (popOut?.hrefs ?? []).every((h) => transit.hrefs.includes(h)),
  `下拉 ${popOut?.hrefs?.length} 条 → 中转页 ${transit.n} 条`);
check('中转页显示了总条数和分组标题', /共 \d+ 条结果/.test(transit.sum) && transit.groups.length >= 1,
  `${transit.sum} :: ${transit.groups.join(' / ')}`);
check('中转页的输入框里就是刚才那个查询词', transit.input === weak, transit.input);

/* ---------------- ④ 强匹配 → 回车直接进那一页 ---------------- */
await cdp.goto('/', 1200);
await waitFor('!!window.HuayaSearch');
await focusSearch();
await typeText(strong.t);
const strongPop = await waitFor(`(() => {
  const p = document.getElementById('site-search-pop');
  const rows = p.querySelectorAll('.srch__row');
  if (!p.hidden && rows.length >= 1) return { n: rows.length, first: rows[0].getAttribute('href'),
    hint: document.getElementById('site-search-hint').textContent };
  return null;
})()`, 5000);
console.log('强匹配下拉：', JSON.stringify(strongPop));
check('★ 强匹配时页脚说的是"直接打开「…」"', !!strongPop && strongPop.hint.includes('回车：直接打开'),
  strongPop?.hint);
check('下拉第一条就是那一页', strongPop?.first === strong.h, `${strongPop?.first} vs ${strong.h}`);
await pressKey('Enter', 'Enter', 13);
const hardLand = await waitHrefChange(`http://127.0.0.1:${PORT}/`);
check('★ 强匹配回车 → 直接进入对应页面（没有经过中转页）',
  !!hardLand && !hardLand.includes('/search/') &&
    decodeURIComponent(new URL(hardLand).pathname).replace(/\/$/, '') === strong.h.replace(/\/$/, ''),
  hardLand ?? '没跳走');

/* ---------------- ⑤ 精华那一条：下拉里点它 → 落到 /salon/#<id> ---------------- */
await cdp.goto('/', 1200);
await waitFor('!!window.HuayaSearch');
await focusSearch();
await typeText(essence.word);
const onePop = await waitFor(`(() => {
  const p = document.getElementById('site-search-pop');
  const rows = p.querySelectorAll('.srch__row');
  if (p.hidden || !rows.length) return null;
  const r = rows[0];
  r.id = 'essence-row';
  return { n: rows.length, href: r.getAttribute('href'),
    kind: r.querySelector('.srch__kind').textContent,
    hint: document.getElementById('site-search-hint').textContent };
})()`, 5000);
console.log('精华唯一命中：', JSON.stringify(onePop));
check('★ 搜索到独立的一条精华：全站就这一条命中，结果指向 /salon/#<id>（不是 /salon/ 页面顶部）',
  !!onePop && onePop.n === 1 && onePop.href === `/salon/#${essence.id}` && onePop.kind === '精华',
  `${onePop?.n} 条 :: ${onePop?.href} :: ${onePop?.kind}`);
const rowRect = await rectOf('#essence-row');
await realClick(rowRect.cx, rowRect.cy);
const landed = await waitHrefChange(`http://127.0.0.1:${PORT}/`);
check('★ 点击这条结果 → 地址带着那一条精华的锚点',
  !!landed && landed.endsWith(`/salon/#${essence.id}`), landed ?? '没跳走');
await settleScroll();
const onEssence = await cdp.ev(`(() => {
  const el = document.getElementById(${JSON.stringify(essence.id)});
  if (!el) return { found: false };
  const r = el.getBoundingClientRect();
  return { found: true, cls: el.className, top: Math.round(r.top), h: Math.round(r.height),
           inView: r.top >= -8 && r.top < window.innerHeight * 0.8 };
})()`);
console.log('落点：', JSON.stringify(onEssence));
check('★ 真的滚到了那一条精华的位置（那一条在视口里，不是页面顶部）',
  onEssence.found && onEssence.inView && onEssence.cls.includes('salon__item'),
  `top=${onEssence.top}（页面顶部那条的 top 会是 0 上下；精华页给锚点留了 5.5rem 的边距）`);

/* ---------------- ⑥ 直接开中转页：按种类分组 + 精华组能点 ---------------- */
await cdp.goto(`/search/?q=${encodeURIComponent(essence.word)}`, 1100);
const transitEssence = await waitFor(`(() => {
  const link = document.querySelector('.srchPage__group[data-kind="essence"] .srchPage__link');
  if (!link) return null;
  link.id = 'essence-link';
  return { href: link.getAttribute('href'), title: link.querySelector('.srchPage__title').textContent,
           sum: document.getElementById('srch-page-sum').textContent };
})()`, 6000);
console.log('中转页的精华组：', JSON.stringify(transitEssence));
check('中转页把精华单列一组，每条都是 /salon/#<id>',
  !!transitEssence && transitEssence.href === `/salon/#${essence.id}` && transitEssence.href.includes('#'),
  transitEssence?.href);
const linkRect = await rectOf('#essence-link');
await realClick(linkRect.cx, linkRect.cy);
const landed2 = await waitHrefChange(`http://127.0.0.1:${PORT}/search/?q=${encodeURIComponent(essence.word)}`);
await settleScroll();
const onEssence2 = await cdp.ev(`(() => {
  const el = document.getElementById(${JSON.stringify(essence.id)});
  if (!el) return { found: false, href: location.href };
  const r = el.getBoundingClientRect();
  return { found: true, href: location.href, top: Math.round(r.top), inView: r.top >= -8 && r.top < window.innerHeight * 0.8 };
})()`);
check('★ 从中转页点精华那条 → 同样落到精华页里那一条的位置',
  onEssence2.found && onEssence2.inView && String(onEssence2.href).endsWith(`#${essence.id}`),
  JSON.stringify(onEssence2));

/* ---------------- ⑦ 直接开中转页（不带查询词）：变成一张全站目录 ---------------- */
await cdp.goto('/search/', 1100);
const dirPage = await waitFor(`(() => {
  const links = document.querySelectorAll('.srchPage__items--dir .srchPage__link');
  const sum = document.getElementById('srch-page-sum').textContent;
  if (!links.length) return null;
  return { n: links.length, sum, first: links[0].getAttribute('href'),
           input: document.getElementById('srch-page-input').value };
})()`, 6000);
console.log('中转页目录：', JSON.stringify(dirPage));
const pageCount = items.filter((it) => it.k === 'page').length;
check('★ 不带查询词打开 /search/：列出全站整页当目录（' + (dirPage?.n ?? 0) + ' 个）',
  !!dirPage && dirPage.n === pageCount, `目录 ${dirPage?.n} / 索引里的整页 ${pageCount}`);
check('目录页那句说明里报了索引总条数', !!dirPage && dirPage.sum.includes(`共 ${items.length} 条`), dirPage?.sum);

/* ---------------- ⑧ 随机跳转：真的在乱跳 ---------------- */
const hops = [];
for (let i = 0; i < 5; i++) {
  const before = await cdp.ev('location.href');
  const jRect = await rectOf('#random-jump');
  await realClick(jRect.cx, jRect.cy);
  const after = await waitHrefChange(before, 9000);
  if (!after) { hops.push({ fail: '点了没动' }); break; }
  for (let k = 0; k < 120; k++) {
    await sleep(120);
    if ((await cdp.tryEv('document.readyState')) === 'complete') break;
  }
  await sleep(500);
  const info = await cdp.ev(`({ path: location.pathname, title: document.title })`);
  hops.push(info);
}
console.log('随机跳转 5 次：', JSON.stringify(hops));
const paths = hops.map((h) => h.path);
check('★ 随机跳转连点 5 次：每次都在跳，而且真的跳去了不同页面',
  hops.length === 5 && hops.every((h) => h.path) && new Set(paths).size >= 3,
  `${new Set(paths).size} 个不同页面：${paths.join(' → ')}`);
check('★ 随机跳转不会跳到搜索页，也不会跳到 404',
  !paths.some((p) => p.startsWith('/search')) && !hops.some((h) => String(h.title).includes('走丢了')),
  JSON.stringify(hops.map((h) => h.title)));
check('每次跳到的都是真的存在的页面（没有落在 404 上）',
  hops.every((h) => !String(h.title).includes('走丢了')));

/* ---------------- ⑨ 这一趟有没有 JS 报错 ---------------- */
check('这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

try { await cdp.send('Browser.close'); } catch { /* ignore */ }
chrome.kill();
server.close();
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* ignore */ }

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
