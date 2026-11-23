/*
 * 图鉴块验收（2026-11-23）
 * ---------------------------------------------------------------------------
 * 在副本里给某页塞一个 300 条的图鉴块（含「只有名字」的占位条目、带链接的条目）→
 * 真构建 → 真浏览器 + 真编辑器，量这些东西：
 *   ① 首屏 36 个方块；宽屏 9 列 4 排、方块是正方形；
 *   ② 状态与页码：共 300 个 · 第 1 / 9 页，页码 1…9；
 *   ③ 切「每页 108」→ 108 个 / 3 页；切 216 → 216 个 / 2 页；切回 36 → 9 页；
 *      切大档之后页面**真的变高**（图鉴页自动拉长适配）；
 *   ④ 最后一页少一些：第 9 页 12 个；
 *   ⑤ 只有名字的条目：站上没有 <img>、画的是占位方块、名字写着；
 *   ⑥ 点方块是**跳转**（href 能点、点击后真的到那一页），而且不挂 data-zoom（不打开展图）；
 *   ⑦ 窄屏（390）6 列 6 排；
 *   ⑧ 编辑器存一次盘：codex 块与 300 条都还在（白名单没把它吃掉），占位条目与链接也在。
 * 跑法：node tools/checks/codex-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromePath } from './lib/chrome.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DST = path.join(SRC, '.tmp', 'codex-copy');
const PORT = 4651;
const DBG = 9441;
const EDITOR_PORT = 4788;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};

/* ================= 0. 副本 ================= */
if (fs.existsSync(DST)) {
  const nm = path.join(DST, 'node_modules');
  if (fs.existsSync(nm)) {
    try {
      execSync(`cmd /c rmdir "${nm}"`, { stdio: 'ignore', windowsHide: true });
    } catch {
      /* ignore */
    }
  }
  fs.rmSync(DST, { recursive: true, force: true });
}
fs.mkdirSync(DST, { recursive: true });
for (const it of ['src', 'tools', 'astro.config.mjs', 'package.json', 'tsconfig.json']) {
  fs.cpSync(path.join(SRC, it), path.join(DST, it), { recursive: true });
}
fs.mkdirSync(path.join(DST, 'public/img/opt'), { recursive: true });
fs.copyFileSync(path.join(SRC, 'public/img/opt/manifest.json'), path.join(DST, 'public/img/opt/manifest.json'));
execSync(`cmd /c mklink /J "${path.join(DST, 'node_modules')}" "${path.join(SRC, 'node_modules')}"`, {
  stdio: 'ignore',
  windowsHide: true,
});

/* 两张真图当方块封面 */
const up = fs.readdirSync(path.join(SRC, 'public/img/uploads')).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
const A = `/img/uploads/${up[0]}`;
const B = `/img/uploads/${up[1] ?? up[0]}`;
fs.mkdirSync(path.join(DST, 'public/img/uploads'), { recursive: true });
for (const f of new Set([up[0], up[1] ?? up[0]])) {
  fs.copyFileSync(path.join(SRC, 'public/img/uploads', f), path.join(DST, 'public/img/uploads', f));
}

/* ================= 1. 塞一个 300 条的图鉴块 ================= */
const boardsFile = path.join(DST, 'src/data/home-boards.json');
const tree = JSON.parse(fs.readFileSync(boardsFile, 'utf8'));
const all = [];
const walk = (l) => {
  for (const n of l ?? []) {
    all.push(n);
    walk(n.children);
    walk(n.boards);
  }
};
walk(tree.boards);
const host = all.find((n) => Array.isArray(n.page) && n.page.length > 0 && !n.external);
if (!host) {
  console.log('FAIL 副本里没有能装图鉴的页面');
  process.exit(1);
}
const items = [];
/**
 * 点方块要跳去的那一页。用站内一个**一定存在、而且不是本页**的页面：
 * `/feed/`（推流动态）。本页是版块树里某一页（/huaya/…），不会撞。
 */
const LINK = '/feed/';
for (let i = 0; i < 300; i += 1) {
  const one = { id: `chk-c${i}`, name: `条目 ${String(i + 1).padStart(3, '0')}` };
  if (i !== 3 && i !== 299) one.src = i % 2 ? A : B;
  if (i !== 4) one.href = LINK;
  if (i === 3) one.name = '只有名字的占位一';
  if (i === 299) one.name = '只有名字的占位二';
  items.push(one);
}
host.page = [
  { id: 'chk-codex', type: 'codex', text: '验收用图鉴', items },
  /* 刚加进来、还没条目的一块：保存之后也得留着（不然"加了块它自己没了"） */
  { id: 'chk-codex-empty', type: 'codex', items: [] },
  ...host.page,
];
fs.writeFileSync(boardsFile, `${JSON.stringify(tree, null, 2)}\n`, 'utf8');
console.log(`      · 装到页面「${host.title || host.id}」，300 条（2 条只有名字、1 条没链接）`);

/* ================= 2. 构建 ================= */
const built = spawn(process.execPath, [path.join(DST, 'node_modules/astro/bin/astro.mjs'), 'build'], {
  cwd: DST,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let blog = '';
built.stdout.on('data', (b) => {
  blog += b;
});
built.stderr.on('data', (b) => {
  blog += b;
});
const builtOk = await new Promise((r) => built.on('close', (c) => r(c === 0)));
check('副本构建通过', builtOk, blog.split(/\r?\n/).filter((l) => /error/i.test(l)).slice(-2).join(' | '));
if (!builtOk) {
  console.log(blog.slice(-600));
  process.exit(1);
}

/* ================= 3. 产物里找这一页 ================= */
const HREF = (() => {
  const stack = [path.join(DST, 'dist')];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== '.prerender') stack.push(p);
        continue;
      }
      if (e.name === 'index.html' && fs.readFileSync(p, 'utf8').includes('data-uid="chk-codex"')) {
        return `/${path.relative(path.join(DST, 'dist'), p).replace(/\\/g, '/').replace(/index\.html$/, '')}`;
      }
    }
  }
  return null;
})();
check('产物里有我们这个图鉴页', Boolean(HREF), String(HREF));
if (!HREF) {
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(1);
}

/* ---- 静态：首屏只放 36 个、名字条目没有图 ---- */
const html = fs.readFileSync(path.join(DST, 'dist', HREF.replace(/^\//, ''), 'index.html'), 'utf8');
/* ⚠ 只数 <li> 上的记号：脚本里也有 '[data-codex-item]' 这个字符串，直接数会多一个 */
const cells = [...html.matchAll(/<li[^>]*data-codex-item[^>]*>/g)].map((m) => m[0]);
const hiddenCount = cells.filter((t) => /\shidden(\s|>)/.test(t)).length;
check('产物里 300 个方块都在（翻页是浏览器里摘的，不是分页取数据）', cells.length === 300, `${cells.length} 个`);
check('首屏只放第一页 36 个，其余 264 个带 hidden（没脚本也只看第一页）', cells.length - hiddenCount === 36, `可见 ${cells.length - hiddenCount}`);
const nameOnly = (html.match(/<li[^>]*data-codex-item[^>]*>(?:(?!<\/li>)[\s\S])*?只有名字的占位一(?:(?!<\/li>)[\s\S])*?<\/li>/) || [])[0] || '';
check('只有名字的条目：没有 <img>、画的是占位方块、名字写着', Boolean(nameOnly) && !/<img/.test(nameOnly) && /codex__ph/.test(nameOnly) && /只有名字的占位一/.test(nameOnly));
const withImg = (html.match(/<li[^>]*data-codex-item[^>]*>(?:(?!<\/li>)[\s\S])*?条目 001(?:(?!<\/li>)[\s\S])*?<\/li>/) || [])[0] || '';
check('有条目的方块是链接（href="/feed/"），而且**没挂 data-zoom**（点了不打开展图）',
  new RegExp(`<a[^>]*class="codex__tile"[^>]*href="${LINK}"`).test(withImg) && !/data-zoom/.test(withImg));

/* ================= 4. 浏览器 ================= */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.gif': 'image/gif' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
    const f = path.join(DST, 'dist', t);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream' });
      return fs.createReadStream(f).pipe(res);
    }
  }
  res.writeHead(404);
  res.end('404');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = path.join(process.env.TEMP ?? '.', `dsh-codex-${Date.now()}`);
const chrome = spawn(chromePath(), ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DBG}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    });
  }
  static async attach(u) {
    const ws = new WebSocket(u);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
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
}

let cdp = null;
try {
  let tg = null;
  for (let i = 0; i < 60 && !tg; i += 1) {
    await sleep(250);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json();
      tg = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {
      /* 等 */
    }
  }
  cdp = await CDP.attach(tg.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  /** 这一块图鉴现在的状态（只看我们塞的那一块：页面上可能还有别人的） */
  const snap = () =>
    cdp.ev(`(() => {
      const root = document.querySelector('[data-codex][data-uid="chk-codex"]');
      if (!root) return { none: true };
      const cells = [...root.querySelectorAll('[data-codex-item]')];
      const vis = cells.filter((el) => !el.hidden);
      const grid = root.querySelector('.codex__grid');
      const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
      const rows = new Set(vis.map((el) => Math.round(el.getBoundingClientRect().top))).size;
      const f = vis[0]?.querySelector('.codex__frame')?.getBoundingClientRect();
      const nameOnly = cells.find((el) => el.textContent.includes('只有名字的占位一'));
      return {
        total: cells.length,
        visible: vis.length,
        cols,
        rows,
        square: f ? Math.round(Math.abs(f.width - f.height) * 10) / 10 : null,
        status: root.querySelector('[data-codex-status]')?.textContent.replace(/\\s+/g, ' ').trim(),
        numbers: [...root.querySelectorAll('[data-codex-pages] [data-codex-page]')].map((b) => Number(b.dataset.codexPage)),
        sizeLabel: root.querySelector('[data-codex-sizebtn]')?.textContent.trim(),
        menuOpen: !root.querySelector('[data-codex-sizes]')?.hidden,
        nameOnly: nameOnly ? { img: !!nameOnly.querySelector('img'), ph: !!nameOnly.querySelector('.codex__ph'), name: nameOnly.querySelector('.codex__name')?.textContent } : null,
        height: Math.round(root.getBoundingClientRect().height),
      };
    })()`);

  const open = async (w = 1440, h = 900) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${HREF}` });
    for (let i = 0; i < 120; i += 1) {
      await sleep(150);
      if ((await cdp.ev('document.readyState')) === 'complete') break;
    }
    await sleep(1200);
  };

  await open();
  const s1 = await snap();
  check('宽屏打开就是 36 个方块（第一页）', s1.visible === 36 && s1.total === 300, JSON.stringify({ visible: s1.visible, total: s1.total }));
  check('宽屏一排 9 个、4 排', s1.cols === 9 && s1.rows === 4, JSON.stringify({ cols: s1.cols, rows: s1.rows }));
  check('方块是正方形', s1.square !== null && s1.square <= 1, `宽高差 ${s1.square}px`);
  check('状态写「共 300 个 · 第 1 / 9 页」', /共 300 个\s*·\s*第 1 \/ 9 页/.test(s1.status || ''), s1.status);
  check('页码条是 1…9（九页全列出来，不用翻窗口）', s1.numbers.length === 9 && s1.numbers[0] === 1 && s1.numbers[8] === 9, s1.numbers.join(','));
  check('只有名字的条目：没有 img、有占位、名字写着', s1.nameOnly?.img === false && s1.nameOnly?.ph === true && s1.nameOnly?.name === '只有名字的占位一', JSON.stringify(s1.nameOnly));
  check('每页按钮上写着当前档「每页 36」', s1.sizeLabel === '每页 36', s1.sizeLabel);

  /* ---- 切 108 / 216 / 回 36 ---- */
  await cdp.ev(`document.querySelector('[data-codex][data-uid="chk-codex"] [data-codex-sizebtn]').click()`);
  await sleep(200);
  const menu = await snap();
  check('点「每页 36」弹出 36 / 108 / 216 三档菜单', menu.menuOpen === true);
  await cdp.ev(`document.querySelector('[data-codex][data-uid="chk-codex"] [data-codex-size="108"]').click()`);
  await sleep(400);
  const s108 = await snap();
  check('切到每页 108：108 个方块、3 页', s108.visible === 108 && s108.numbers.length === 3, JSON.stringify({ visible: s108.visible, pages: s108.numbers.length }));
  check('切到 108 之后图鉴页真的变高了（自动拉长适配）', s108.height > s1.height * 2, `${s1.height} → ${s108.height}`);
  check('状态跟着变成「第 1 / 3 页」', /第 1 \/ 3 页/.test(s108.status || ''), s108.status);
  await cdp.ev(`document.querySelector('[data-codex][data-uid="chk-codex"] [data-codex-sizebtn]').click()`);
  await sleep(150);
  await cdp.ev(`document.querySelector('[data-codex][data-uid="chk-codex"] [data-codex-size="216"]').click()`);
  await sleep(400);
  const s216 = await snap();
  check('切到每页 216：216 个方块、2 页', s216.visible === 216 && s216.numbers.length === 2, JSON.stringify({ visible: s216.visible, pages: s216.numbers.length }));
  await cdp.ev(`document.querySelector('[data-codex][data-uid="chk-codex"] [data-codex-sizebtn]').click()`);
  await sleep(150);
  await cdp.ev(`document.querySelector('[data-codex][data-uid="chk-codex"] [data-codex-size="36"]').click()`);
  await sleep(400);
  const s36 = await snap();
  check('切回每页 36：36 个、9 页（选择记在 localStorage，切档能来回）', s36.visible === 36 && s36.numbers.length === 9, JSON.stringify({ visible: s36.visible, pages: s36.numbers.length }));

  /* ---- 最后一页少一些 ---- */
  await cdp.ev(`document.querySelector('[data-codex][data-uid="chk-codex"] [data-codex-page="9"]').click()`);
  await sleep(400);
  const s9 = await snap();
  check('第 9 页只有最后 12 个（300 = 8×36 + 12）', s9.visible === 12, `${s9.visible} 个`);
  check('最后一页的状态是「第 9 / 9 页」', /第 9 \/ 9 页/.test(s9.status || ''), s9.status);
  const lastOnly = await cdp.ev(`(() => { const root = document.querySelector('[data-codex][data-uid="chk-codex"]'); const el = [...root.querySelectorAll('[data-codex-item]')].find((x) => x.textContent.includes('只有名字的占位二')); return { visible: !!el && !el.hidden, img: !!el?.querySelector('img') }; })()`);
  check('最后一个占位条目在最后一页，也没有图', lastOnly.visible === true && lastOnly.img === false, JSON.stringify(lastOnly));

  /* ---- 点方块是跳转、不是打开展图 ---- */
  await cdp.ev(`document.querySelector('[data-codex][data-uid="chk-codex"] [data-codex-page="1"]').click()`);
  await sleep(300);
  const clickInfo = await cdp.ev(`(() => {
    const a = [...document.querySelectorAll('[data-codex][data-uid="chk-codex"] a.codex__tile')].find((el) => !el.closest('[data-codex-item]').hidden);
    const r = {
      href: a.getAttribute('href'),
      zoom: a.querySelector('img')?.hasAttribute('data-zoom') ?? null,
      /* 没写链接的那条（条目 005）不该是 <a>，点了什么也不会发生 */
      noLinkIsAnchor: !!document.querySelector('[data-codex][data-uid="chk-codex"] [data-codex-item]:nth-child(5) a'),
    };
    a.click();
    return r;
  })()`);
  await sleep(1500);
  const afterClick = await cdp.ev(`({ path: location.pathname })`);
  check('点方块真的跳到它指向的页面（不是弹图看大图）', clickInfo.href === LINK && afterClick.path === LINK, JSON.stringify({ href: clickInfo.href, path: afterClick.path }));
  check('方块没挂 data-zoom；没写链接的条目不是链接（点了不跳）', clickInfo.zoom === false && clickInfo.noLinkIsAnchor === false, JSON.stringify(clickInfo));

  /* ---- 窄屏：6 列 6 排 ---- */
  await cdp.ev('localStorage.clear()');
  await open(390, 844);
  const m1 = await snap();
  check('窄屏（390）一排 6 个、6 排（36 个）', m1.cols === 6 && m1.rows === 6 && m1.visible === 36, JSON.stringify({ cols: m1.cols, rows: m1.rows, visible: m1.visible }));
  check('窄屏状态还是「共 300 个 · 第 1 / 9 页」', /共 300 个\s*·\s*第 1 \/ 9 页/.test(m1.status || ''), m1.status);

  check('这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));
} catch (err) {
  fail++;
  console.log('FAIL  浏览器部分异常: ' + (err?.stack ?? err));
} finally {
  try {
    execSync(`taskkill /pid ${chrome.pid} /T /F`, { windowsHide: true, stdio: 'ignore' });
  } catch {
    /* ignore */
  }
  server.close();
  await sleep(200);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/* ================= 5. 编辑器存盘往返：codex 块不许被白名单吃掉 ================= */
let editor = null;
try {
  editor = spawn(process.execPath, [path.join(DST, 'tools/editor/server.mjs'), '--port', String(EDITOR_PORT)], {
    cwd: DST,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let elog = '';
  editor.stdout.on('data', (b) => {
    elog += b;
  });
  editor.stderr.on('data', (b) => {
    elog += b;
  });

  const base = `http://127.0.0.1:${EDITOR_PORT}`;
  let api = null;
  for (let i = 0; i < 80 && !api; i += 1) {
    await sleep(300);
    try {
      const r = await fetch(`${base}/api/boards`);
      if (r.ok) api = await r.json();
    } catch {
      /* 等它起来 */
    }
  }
  check('编辑器起得来（--port 固定）', Boolean(api), elog.split(/\r?\n/).slice(-2).join(' | '));
  if (api) {
    const got = JSON.stringify(api.boards ?? []);
    check('编辑器读到的树里有我们塞的图鉴块', got.includes('"type":"codex"') || got.includes('"type": "codex"'));
    const res = await fetch(`${base}/api/boards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ boards: api.boards, current: host.id }),
    });
    const out = await res.json().catch(() => ({}));
    check('保存（含重新构建）成功', res.ok && out.ok !== false, `${res.status} ${out.error || ''}`.trim());

    const saved = JSON.parse(fs.readFileSync(boardsFile, 'utf8'));
    const savedAll = [];
    const collect = (l) => {
      for (const n of l ?? []) {
        savedAll.push(n);
        collect(n.children);
        collect(n.boards);
      }
    };
    collect(saved.boards);
    const block = savedAll.flatMap((n) => (Array.isArray(n.page) ? n.page : [])).find((b) => b.type === 'codex' && b.id === 'chk-codex');
    check('存盘之后图鉴块还在（cleanBlocks 认它）', Boolean(block), block ? `${block.items?.length} 条` : '整块丢了');
    const emptyBlock = savedAll.flatMap((n) => (Array.isArray(n.page) ? n.page : [])).find((b) => b.type === 'codex' && b.id === 'chk-codex-empty');
    check('刚加进来、还没有条目的空图鉴块也留着（不会"加了它自己没了"）', Boolean(emptyBlock), emptyBlock ? '还在' : '被吃掉了');
    if (block) {
      const its = Array.isArray(block.items) ? block.items : [];
      check('存盘之后 300 条一条不少', its.length === 300, `${its.length} 条`);
      const ph = its.find((it) => it.name === '只有名字的占位一');
      check('「只有名字」的占位条目没被当成空条目丢掉（没有 src 也在）', Boolean(ph) && !ph.src, JSON.stringify(ph));
      const linked = its.find((it) => it.name === '条目 001');
      check('条目的链接也还在', linked?.href === LINK, JSON.stringify(linked));
      const noLink = its.find((it) => it.name === '条目 005');
      check('没写链接的条目照样在（只是不可点）', Boolean(noLink) && !noLink.href, JSON.stringify(noLink));
    }
  }
} catch (err) {
  fail++;
  console.log('FAIL  编辑器部分异常: ' + (err?.stack ?? err));
} finally {
  if (editor) {
    try {
      execSync(`taskkill /pid ${editor.pid} /T /F`, { windowsHide: true, stdio: 'ignore' });
    } catch {
      /* ignore */
    }
  }
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
