/*
 * 子页面卡的摆放（2026-09-24 那次重构）。
 *
 * 用户原话：
 *   「页面内的子页面板块只能放在固定的位置！例如在花娅域主页面中 隰辰煦的bilibili链接
 *    和隰星涧的bilibili链接之间没有办法插入文字 两个链接作为子版块卡片永远只能黏在一起
 *    应当完全重构子页面板块在页面中的插入逻辑 可以单独插入子页面卡片
 *    也可以建立一个子版块框 然后向内放入许多子页面卡片 从而能够滚动」
 *
 * 重构后的模型（用户四项都选了推荐项）：
 *   card      单张子页面卡：把这一层的**某一项**摆在任意位置（ref = 子节点 id）
 *   cardbox   子版块框：有边框、自己会滚的容器，按 refs 的顺序装若干张卡（max = 框高）
 *   children  老块保留，但含义收窄成「**还没被单张卡 / 卡片框挑走的**那些」
 *   兜底      这一页没写 children 块、又有子页面没被摆出来 → 自动补在页面最后
 *
 * 这个脚本**不碰工作区的数据**：整份仓库拷到 .tmp/cards-copy，用副本自己的
 * 编辑器服务端（/api/boards + /api/build，和作者点「保存」走的是同一条路）
 * 把测试用的排版写进副本，重建后既查盘上的数据、也开真浏览器量 DOM。
 *
 * 用法：node tools/checks/card-placement-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';

const SRC = process.cwd();
const DST = path.join(SRC, '.tmp', 'cards-copy');
const STATIC_PORT = 4466;
const DEBUG_PORT = 9436;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
};
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};

/* ================= 0. 造副本 ================= */
if (fs.existsSync(DST)) {
  const nm = path.join(DST, 'node_modules');
  if (fs.existsSync(nm)) { try { execSync(`cmd /c rmdir "${nm}"`, { stdio: 'ignore' }); } catch { /* ignore */ } }
  fs.rmSync(DST, { recursive: true, force: true });
}
const skip = new Set(['node_modules', 'dist', '.git', '.tmp']);
fs.mkdirSync(DST, { recursive: true });
for (const e of fs.readdirSync(SRC, { withFileTypes: true })) {
  if (skip.has(e.name)) continue;
  fs.cpSync(path.join(SRC, e.name), path.join(DST, e.name), { recursive: true });
}
execSync(`cmd /c mklink /J "${path.join(DST, 'node_modules')}" "${path.join(SRC, 'node_modules')}"`, { stdio: 'ignore' });
console.log(`副本就绪：${DST}`);

const boardsFile = path.join(DST, 'src', 'data', 'home-boards.json');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const findNode = (list, href) => {
  for (const n of list ?? []) {
    if (n && n.href === href) return n;
    const hit = findNode(n && n.children, href);
    if (hit) return hit;
  }
  return null;
};

/* ================= 1. 起副本自己的编辑器 ================= */
const editor = spawn(process.execPath, [path.join(DST, 'tools', 'editor', 'server.mjs')], {
  cwd: DST, stdio: ['ignore', 'pipe', 'pipe'],
});
let elog = '';
editor.stdout.on('data', (b) => { elog += b.toString('utf8'); });
editor.stderr.on('data', (b) => { elog += b.toString('utf8'); });
let base = '';
for (let i = 0; i < 300 && !base; i++) {
  await sleep(150);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(elog);
  if (m) base = `http://127.0.0.1:${m[1]}`;
}
if (!base) {
  console.log('FAIL  编辑器没起来：' + elog.slice(-800));
  process.exit(1);
}
console.log(`副本编辑器：${base}`);

async function api(method, p, body) {
  const r = await fetch(base + p, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, json, text };
}

const XRD = '/huaya/character/xichenxu';   // 花娅域主：2 个子页面（用户举的那个例子）
const YEARS = '/huaya/years';              // 花娅编年史：10 个子页面（用来量框内滚动）
const HUAYA = '/huaya';                    // 花娅陌域：原来正文为空，用来量"自动补"那一块

try {
  const got = await api('GET', '/api/boards');
  const tree = got.json;
  if (!tree?.boards) {
    console.log('FAIL  拿不到 boards：' + got.text.slice(0, 300));
    process.exit(1);
  }
  const xrd = findNode(tree.boards, XRD);
  const years = findNode(tree.boards, YEARS);
  const huaya = findNode(tree.boards, HUAYA);
  const xrdKids = (xrd?.children ?? []).map((k) => k.id);
  const yearKids = (years?.children ?? []).map((k) => k.id);
  console.log(`子页面：花娅域主 ${xrdKids.length} 个｜花娅编年史 ${yearKids.length} 个｜花娅陌域 ${(huaya?.children ?? []).length} 个`);
  check('三个用于测试的页面都在（花娅域主 / 花娅编年史 / 花娅陌域）',
    xrdKids.length === 2 && yearKids.length >= 8 && (huaya?.children ?? []).length >= 3,
    `${xrdKids.length} / ${yearKids.length} / ${(huaya?.children ?? []).length}`);

  /* 花娅域主：单张卡插在文字之间 —— 正是用户说"插不进文字"的那两处 */
  const bid = (n) => `pg-cardtest-${n}`;
  xrd.page = [
    { id: bid('t0'), type: 'text', text: '## 隰辰煦\n（这一页是重构的测试排版：两张卡之间必须有文字）' },
    { id: bid('c0'), type: 'card', ref: xrdKids[0], shape: 'square', size: 'm' },
    { id: bid('t1'), type: 'text', text: '中间这段文字必须能插在两张卡之间。' },
    { id: bid('c1'), type: 'card', ref: xrdKids[1], shape: 'square', size: 'm' },
    { id: bid('t2'), type: 'text', text: '尾巴这段在第二张卡后面。' },
    /* 坏引用：树里没有这个 id —— 站点上不该画出卡片、也不该冒出提示文字 */
    { id: bid('c2'), type: 'card', ref: '这个id不存在', shape: 'wide', size: 'l' },
    /* ref 还是空的（编辑器里"先放一张卡、还没挑"）：数据要留着，页面上不画 */
    { id: bid('c3'), type: 'card', ref: '', shape: 'wide', size: 'l' },
  ];
  /* 花娅编年史：一个框装下全部子页面，框高 260px（够小，一定能滚起来） */
  years.page = [
    { id: bid('y0'), type: 'text', text: '## 子页面（都放在框里）' },
    {
      id: bid('y1'),
      type: 'cardbox',
      /* 故意带一个重复的 id 和一个不存在的 id：去重、保序、认不出的留着 */
      refs: [...yearKids, yearKids[0], 'nope-not-here'],
      shape: 'square',
      size: 'm',
      max: 260,
    },
    /* 空框 + 离谱的框高：数据要留着，max 要被清洗掉（站点回落到默认高度） */
    { id: bid('y2'), type: 'cardbox', refs: [], shape: 'wide', size: 'l', max: 99999 },
  ];
  /* 花娅陌域：原来正文为空（走自动铺开），现在只写一段文字 —— 子页面该自动补在最后 */
  huaya.page = [{ id: bid('h0'), type: 'text', text: '这一页原来没有正文，现在有了 —— 子页面应该自动补在最后。' }];

  const written = await api('POST', '/api/boards', { boards: tree.boards });
  check('POST /api/boards 写盘成功', written.json?.ok === true, `status=${written.status} ${written.text.slice(0, 120)}`);

  const after = readJson(boardsFile);
  const xrd2 = findNode(after.boards, XRD);
  const years2 = findNode(after.boards, YEARS);
  const cards2 = xrd2.page.filter((b) => b.type === 'card');
  const boxes2 = years2.page.filter((b) => b.type === 'cardbox');
  check('★ 盘上：单张卡的 ref 原样存下来了（顺序也没乱）',
    cards2.length === 4 && cards2[0].ref === xrdKids[0] && cards2[1].ref === xrdKids[1],
    JSON.stringify(cards2.map((b) => b.ref)));
  check('★ 盘上：还没挑子页面的空卡**没被丢掉**（编辑器里先放卡再挑是正常流程）',
    cards2[3] && cards2[3].ref === '', JSON.stringify(cards2[3] ?? null));
  check('★ 盘上：框里的 refs 去了重、保了序、坏 id 留着',
    boxes2[0].refs.length === yearKids.length + 1 &&
      boxes2[0].refs.slice(0, yearKids.length).join() === yearKids.join() &&
      boxes2[0].refs.includes('nope-not-here'),
    `${boxes2[0].refs.length} 条`);
  check('★ 盘上：框高存下来了；离谱的（99999）被清洗掉、站点回落到默认高度',
    boxes2[0].max === 260 && boxes2[1] && boxes2[1].max === undefined,
    JSON.stringify({ 正常: boxes2[0].max, 离谱: boxes2[1]?.max ?? null }));
  check('盘上：空框也留着（先加框、再往里挑卡）', boxes2[1] && boxes2[1].refs.length === 0);

  /* ================= 2. 重建 ================= */
  const build = await api('POST', '/api/build');
  check('★ 重新构建成功（保存后作者点的那一下）', build.json?.ok === true,
    `ok=${build.json?.ok} ${build.json?.ms}ms ${String(build.json?.output ?? '').split('\n').slice(-1)[0] ?? ''}`);

  /* ================= 3. 产物里能静态查的 ================= */
  const dist = path.join(DST, 'dist');
  const pageOf = (rel) => fs.readFileSync(path.join(dist, rel), 'utf8');
  const xrdHtml = pageOf('huaya/character/xichenxu/index.html');
  const yearsHtml = pageOf('huaya/years/index.html');
  const huayaHtml = pageOf('huaya/index.html');

  /* 块的先后顺序（页面渲染顺序 = 数据顺序） */
  const orderOf = (h) => [...h.matchAll(/data-block-type="([^"]+)"/g)].map((m) => m[1]);
  const xrdOrder = orderOf(xrdHtml);
  console.log('花娅域主的块顺序：', xrdOrder.join(' → '));
  check('★ 产物里块的顺序就是数据里的顺序（文字 / 卡 / 文字 / 卡 / 文字 / 卡…）',
    xrdOrder.slice(0, 8).join() === ['text', 'card', 'text', 'card', 'text', 'card', 'card', 'leftover'].slice(0, xrdOrder.length).join() ||
      xrdOrder.slice(0, 7).join() === ['text', 'card', 'text', 'card', 'text', 'card', 'card'].join(),
    xrdOrder.join(' → '));
  const xrdCards = (xrdHtml.match(/class="card[ "]/g) ?? []).length;
  check('★ 花娅域主这一页只画出 **2 张**卡（坏引用和空引用都不画）', xrdCards === 2, `${xrdCards} 张`);
  check('★ 坏引用在产物里留了记号（块上的 data-missing），但页面上没有给读者看的提示文字',
    xrdHtml.includes('data-missing="这个id不存在"'), '块上的 data-missing 记号');
  check('花娅域主没有"自动补"那一块（两张卡都摆出来了）', !xrdHtml.includes('pg-leftover'));

  /* 两张卡之间那段文字的位置：在产物里夹在两张卡中间 */
  const midAt = xrdHtml.indexOf('中间这段文字必须能插在两张卡之间');
  const cardHrefs = [...xrdHtml.matchAll(/<a class="card[^"]*"[^>]*href="([^"]*)"/g)].map((m) => m[1]);
  const firstCardAt = xrdHtml.indexOf(cardHrefs[0] ?? '@@');
  const secondCardAt = xrdHtml.indexOf(cardHrefs[1] ?? '@@');
  check('★ 产物里那段文字确实夹在两张卡之间（不是被挤到两张卡后面）',
    firstCardAt > 0 && secondCardAt > firstCardAt && midAt > firstCardAt && midAt < secondCardAt,
    `卡1@${firstCardAt} 文字@${midAt} 卡2@${secondCardAt}`);

  /* 框 */
  check('★ 产物里花娅编年史有个「框」，框高内联成 260px',
    yearsHtml.includes('class="pcardbox"') && yearsHtml.includes('--pcardbox-max:260px'),
    'pcardbox + --pcardbox-max:260px');
  const inBox = yearsHtml.slice(yearsHtml.indexOf('class="pcardbox"'));
  const boxCards = (inBox.slice(0, inBox.indexOf('</div></div>')).match(/class="card[ "]/g) ?? []).length;
  check('★ 框里装着全部 10 张卡（重复的 id 只算一张）', boxCards === yearKids.length,
    `框里 ${boxCards} 张 / 子页面 ${yearKids.length} 个`);
  check('花娅编年史没有第二个框（空框那一个站点上不画）',
    (yearsHtml.match(/class="pcardbox"/g) ?? []).length === 1,
    `${(yearsHtml.match(/class="pcardbox"/g) ?? []).length} 个框`);

  /* 自动补的那一块 */
  check('★ 花娅陌域：正文里只写了一段文字，4 个子页面自动补在页面最后',
    huayaHtml.includes('pg-leftover') && huayaHtml.includes('这一层的子页面'),
    '有 pg-leftover');
  const huayaCards = (huayaHtml.match(/class="card[ "]/g) ?? []).length;
  check('自动补的那一块里就是这一层的全部子页面',
    huayaCards === (huaya.children ?? []).length, `${huayaCards} 张`);

  /* 锚点：位置选择器里能认出是哪张卡（用子页面的名字，不是 id） */
  const anchors = readJson(path.join(dist, 'anchors.json'));
  const xrdPage = anchors.pages.find((p) => p.href === XRD);
  const cardAnchors = (xrdPage?.anchors ?? []).filter((a) => a.kind === 'card');
  const kidTitle = (xrd.children.find((k) => k.id === xrdKids[0])?.title ?? '').trim();
  console.log('卡片锚点：', JSON.stringify(cardAnchors.map((a) => a.text)));
  check('★ 锚点里有「子页面卡：<子页面名字>」（位置选择器里认得出来是哪一张）',
    cardAnchors.length >= 2 && cardAnchors.some((a) => a.text.includes(kidTitle)),
    JSON.stringify(cardAnchors.map((a) => a.text)));

  /* ================= 4. 真浏览器里量 ================= */
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
      const f = path.join(dist, t);
      if (fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream' });
        return fs.createReadStream(f).pipe(res);
      }
    }
    res.writeHead(404);
    res.end('404');
  });
  await new Promise((r) => server.listen(STATIC_PORT, '127.0.0.1', r));

  const profile = path.join(process.env.TEMP ?? '.', `dsh-cards-${Date.now()}`);
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--disable-breakpad', '--window-size=1440,900', `--user-data-dir=${profile}`,
    `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank',
  ], { stdio: 'ignore' });

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
    send(m, p2 = {}) {
      const id = ++this.id;
      this.ws.send(JSON.stringify({ id, method: m, params: p2 }));
      return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    }
    async ev(e) {
      const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
      return r.result.value;
    }
    async goto(p, wait = 900) {
      this.errors = [];
      await this.send('Page.navigate', { url: `http://127.0.0.1:${STATIC_PORT}${p}` });
      for (let i = 0; i < 200; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
      await sleep(wait);
    }
    /** 编辑器自己的页面在另一个端口上，得走绝对地址 */
    async gotoAbs(url, wait = 1500) {
      this.errors = [];
      await this.send('Page.navigate', { url });
      for (let i = 0; i < 200; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
      await sleep(wait);
    }
  }

  let cdp = null;
  for (let i = 0; i < 80 && !cdp; i++) {
    await sleep(250);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const page = l.find((t) => t.type === 'page');
      if (page) cdp = await CDP.attach(page.webSocketDebuggerUrl);
    } catch { /* 还没起来 */ }
  }
  if (!cdp) { console.error('Chromium 没起来'); process.exit(2); }
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  /* 花娅域主：两张卡之间真的夹着那段文字（几何量，不是数 DOM） */
  await cdp.goto(path.posix.join(XRD, '/'), 1200);
  const geom = await cdp.ev(`(() => {
    const cards = [...document.querySelectorAll('.page a.card')];
    const txt = [...document.querySelectorAll('.page .ptext')].find((p) => p.textContent.includes('中间这段文字'));
    if (!txt || cards.length < 2) return null;
    const r = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top + window.scrollY), bottom: Math.round(b.bottom + window.scrollY) }; };
    return { cards: cards.length, c0: r(cards[0]), txt: r(txt), c1: r(cards[1]) };
  })()`);
  console.log('花娅域主的几何：', JSON.stringify(geom));
  check('★ 真页面上：第一张卡 → 中间那段文字 → 第二张卡（上下顺序量出来的）',
    !!geom && geom.txt.top >= geom.c0.bottom - 2 && geom.txt.bottom <= geom.c1.top + 2,
    geom ? `卡1 底 ${geom.c0.bottom}｜文字 ${geom.txt.top}~${geom.txt.bottom}｜卡2 顶 ${geom.c1.top}` : 'no data');
  check('真页面上只渲染了 2 张卡', !!geom && geom.cards === 2, `${geom?.cards} 张`);
  /* 坏引用 / 空引用不能在读者看得见的文字里留下痕迹 */
  const visible = await cdp.ev(`(() => {
    const t = document.querySelector('.page')?.innerText ?? '';
    return { bad: t.includes('不存在'), len: t.length };
  })()`);
  check('★ 坏引用和空引用在读者看得见的文字里一个字都没漏出来',
    !!visible && visible.bad === false, JSON.stringify(visible));

  /* 花娅编年史：框真的能滚 */
  await cdp.goto(path.posix.join(YEARS, '/'), 1200);
  const box = await cdp.ev(`(() => {
    const b = document.querySelector('.pcardbox');
    if (!b) return null;
    const cs = getComputedStyle(b);
    const before = b.scrollTop;
    b.scrollTop = 99999;
    const after = b.scrollTop;
    b.scrollTop = before;
    return { h: Math.round(b.clientHeight), sh: Math.round(b.scrollHeight), maxH: cs.maxHeight,
             border: cs.borderTopWidth, overflowY: cs.overflowY, scrolled: after };
  })()`);
  console.log('框：', JSON.stringify(box));
  check('★ 框有边框、overflow-y 是 auto（是个能滚的框）',
    !!box && box.border !== '0px' && box.overflowY === 'auto', JSON.stringify(box && { border: box.border, overflowY: box.overflowY }));
  check('★ 内容比框高：scrollHeight > clientHeight（10 张卡装不进 260px）',
    !!box && box.sh > box.h, box ? `${box.sh} > ${box.h}` : 'no box');
  check('★ 滚得动：把 scrollTop 推到底，它真的动了（不是被裁掉）',
    !!box && box.scrolled > 0, box ? `scrollTop → ${box.scrolled}` : 'no box');
  check('框高就是数据里填的那 260px', !!box && box.maxH === '260px', box?.maxH);

  /* 花娅陌域：自动补的那一块在页面最后 */
  await cdp.goto(path.posix.join(HUAYA, '/'), 1200);
  const loose = await cdp.ev(`(() => {
    const blk = document.querySelector('[data-block-type="leftover"]');
    if (!blk) return null;
    const cards = blk.querySelectorAll('a.card');
    const last = document.querySelector('.page').lastElementChild;
    return { cards: cards.length, isLast: last === blk, w: Math.round(cards[0]?.getBoundingClientRect().width ?? 0) };
  })()`);
  console.log('自动补的那一块：', JSON.stringify(loose));
  check('★ 自动补的块真的在页面最后，而且卡片画出来了',
    !!loose && loose.isLast && loose.cards === (huaya.children ?? []).length && loose.w > 40,
    JSON.stringify(loose));

  check('这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

  /* ================= 5. 编辑器界面：两个新按钮 + 两个新面板 ================= */
  console.log('\n================ 5. 编辑器界面 ================');
  await cdp.gotoAbs(base + '/', 2200);
  const ui1 = await cdp.ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    if (!window.__openWs) return { ok: false, why: '__openWs 不在（编辑器没起来）' };
    await window.__openWs('pages');
    await sleep(1800);
    /* 左边那棵树里点「花娅陌域」：它有 4 个子页面、正文里只放了一段文字 */
    const items = [...document.querySelectorAll('.pw-tree__item')];
    const item = items.find((b) => ((b.querySelector('.pw-tree__url') || {}).textContent || '').trim().split(' ')[0] === '/huaya');
    if (!item) return { ok: false, why: '树里找不到 /huaya', seen: items.map((b) => (b.querySelector('.pw-tree__url') || {}).textContent) };
    item.click();
    await sleep(1800);
    const bar = document.querySelector('.pblock-add');
    const buttons = [...(bar ? bar.querySelectorAll('button') : [])].map((b) => b.textContent.trim());
    const col = document.querySelector('.pstudio__col--edit');
    const loose = document.querySelector('.pblock-add__loose');
    return {
      ok: true,
      buttons,
      loose: loose ? loose.textContent.trim() : null,
      colText: (col ? col.innerText : '').slice(0, 400),
    };
  })()`);
  console.log('编辑器：', JSON.stringify(ui1, null, 1).slice(0, 700));
  check('★ 编辑器那排「添加」里多了「＋ 单张卡」和「＋ 卡片框」',
    !!ui1?.ok && ui1.buttons.includes('＋ 单张卡') && ui1.buttons.includes('＋ 卡片框'),
    JSON.stringify(ui1?.buttons));
  check('★ 没摆出来的子页面会明说：「还有 N 个子页面没有摆到页面上 …… 保存后会自动补在页面最后」',
    !!ui1?.loose && ui1.loose.includes('还有 4 个子页面没有摆到页面上') && ui1.loose.includes('自动补在页面最后'),
    ui1?.loose ?? '(没有这行提示)');

  /* 点「＋ 单张卡」→ 面板里能挑这一页的子页面 */
  const ui2 = await cdp.ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const bar = document.querySelector('.pblock-add');
    const btn = [...(bar ? bar.querySelectorAll('button') : [])].find((b) => b.textContent.includes('单张卡'));
    if (!btn) return { ok: false, why: '找不到 ＋ 单张卡' };
    btn.click();
    await sleep(1000);
    /* 新加的块会成为"当前块"，它的面板这时候是展开的 */
    const bodies = [...document.querySelectorAll('.pblock-edit__body')];
    const body = bodies[bodies.length - 1];
    if (!body) return { ok: false, why: '没有展开的面板' };
    const sel = body.querySelector('select');
    return {
      ok: true,
      options: sel ? [...sel.options].map((o) => o.textContent.trim()) : null,
      text: body.innerText.replace(/\\s+/g, ' ').slice(0, 240),
    };
  })()`);
  console.log('单张卡面板：', JSON.stringify(ui2));
  check('★ 点「＋ 单张卡」→ 面板里的下拉就是这一页的子页面（按名字列出来，不是 id）',
    !!ui2?.ok && Array.isArray(ui2.options) &&
      ui2.options.some((o) => o.includes('涣源溪记忆库')) && ui2.options.some((o) => o.includes('花娅编年史')),
    JSON.stringify(ui2?.options));
  check('单张卡面板说明了「卡片内容跟着子版块走」',
    !!ui2?.text && ui2.text.includes('跟着那个子版块走'), ui2?.text?.slice(0, 120));

  /* 点「＋ 卡片框」→ 面板里能勾选子页面 + 填框高 */
  const ui3 = await cdp.ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const bar = document.querySelector('.pblock-add');
    const btn = [...(bar ? bar.querySelectorAll('button') : [])].find((b) => b.textContent.includes('卡片框'));
    if (!btn) return { ok: false, why: '找不到 ＋ 卡片框' };
    btn.click();
    await sleep(1000);
    const bodies = [...document.querySelectorAll('.pblock-edit__body')];
    const body = bodies[bodies.length - 1];
    if (!body) return { ok: false, why: '没有展开的面板' };
    const checks = [...body.querySelectorAll('input[type="checkbox"]')];
    const max = body.querySelector('input[type="number"]');
    return {
      ok: true,
      checks: checks.length,
      checked: checks.filter((c) => c.checked).length,
      maxPlaceholder: max ? max.placeholder : null,
      text: body.innerText.replace(/\\s+/g, ' ').slice(0, 240),
    };
  })()`);
  console.log('卡片框面板：', JSON.stringify(ui3));
  check('★ 点「＋ 卡片框」→ 面板里能勾选这一页的子页面（4 个都在）',
    !!ui3?.ok && ui3.checks === 4 && ui3.checked === 0, JSON.stringify({ checks: ui3?.checks, checked: ui3?.checked }));
  check('★ 卡片框面板里有「框高」输入框（留空 = 默认高度）',
    !!ui3?.maxPlaceholder && ui3.maxPlaceholder.includes('默认'), ui3?.maxPlaceholder);
  check('卡片框面板写清了框里的顺序怎么调',
    !!ui3?.text && ui3.text.includes('框里的顺序'), ui3?.text?.slice(0, 140));
  check('编辑器这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

  try { await cdp.send('Browser.close'); } catch { /* ignore */ }
  chrome.kill();
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* ignore */ }
} finally {
  try { editor.kill(); } catch { /* ignore */ }
}

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
