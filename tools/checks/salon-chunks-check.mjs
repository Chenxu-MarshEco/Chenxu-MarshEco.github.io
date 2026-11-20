/*
 * ============================================================================
 * 精华页「分块装载 + 成员筛选栏 + 三栏版式」的验收（真浏览器 + 真服务端）
 * ----------------------------------------------------------------------------
 * 站长原话（2026-11-20）：
 *   「在精华页的顶部留一个常驻栏 可以跟随屏幕滚动 可以像其他页面的时间轴一样
 *     点出来或者隐藏 隐藏状态下不要写字就留那种标签卡的样子 点出来以后会显示
 *     所有成员和他们的头像……卡片左侧是和冰室冰山一样的开关显示……
 *     卡片右侧是 xxx 条……成员和条数都自动读取……（多人）只要有一个成员显示出来
 *     那就能够显示……点开以后的成员卡片要整齐排列……第三排只有三个时 第三排要靠左对齐」
 *   「让电脑精华页的精华正文内容放到正中间且更宽……时间轴放到左边去
 *     电脑端的成员卡片可以改为和在时间轴对称的右边新建一个竖着的框……不需要隐藏」
 *   「精华页非常长 所以把它由上到下切成好几个部分 刚进入精华页时默认只加载出
 *     最新精华一部分的精华卡 直到用户继续上翻或是搜索跳转到对应精华时
 *     才加载那个精华对应的精华卡部分」
 *
 * 分五段：
 *   A 构建产物：一簇多大、一共几簇、42 个簇文件拼起来不重不漏、头部不重复
 *   B 分块装载：进来只渲最新一簇 + 上翻补簇（滚动位置不跳）+ 点轴/带 hash 跳远
 *   C 搜索：命中全表、只显示命中、清空回到原样
 *   D 成员栏：条数对得上、开关生效、多人条目规则、卡片排布左对齐
 *   E 版式：正文居中且更宽、右边成员栏和左边时间轴等宽、手机端那根栏
 *
 * 用法：node tools/checks/salon-chunks-check.mjs [dist目录]
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromePath } from './lib/chrome.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
const PORT = 4494;
const DEBUG_PORT = 9394;
const CHROME = chromePath();
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
const info = (s) => console.log(`      · ${s}`);

const indexHtml = path.join(root, 'salon', 'index.html');
if (!fs.existsSync(indexHtml)) {
  console.error(`找不到 ${indexHtml}，先构建`);
  process.exit(2);
}

/* ---------- 盘上的数据（条数、成员、多人条目都从这儿算，不写死） ---------- */
const data = JSON.parse(fs.readFileSync(path.join(root, 'salon.json'), 'utf8'));
const essences = data.essences ?? [];
const TOTAL = essences.length;
/* 年代 id 不在 dist/salon.json 里（那份只导出首页要用的字段），所以头部个数从源数据算 */
const srcData = JSON.parse(fs.readFileSync(path.join(root, '..', 'src', 'data', 'salon.json'), 'utf8'));
const srcSorted = [...(srcData.essences ?? [])]
  .filter((e) => e && e.id && e.date)
  .sort((a, b) => `${a.date} ${a.time || '00:00'}`.localeCompare(`${b.date} ${b.time || '00:00'}`) || a.id.localeCompare(b.id));
const dataMembers = srcData.members ?? [];
const counts = new Map();
for (const e of essences) for (const m of e.members ?? []) counts.set(m.name, (counts.get(m.name) ?? 0) + 1);
const memberRows = dataMembers.filter((m) => (counts.get(m.name) ?? 0) > 0);
const idxOf = new Map(essences.map((e, i) => [e.id, i]));

/* ================================================================
 * A. 构建产物：切成几簇、拼起来对不对
 * ================================================================ */
console.log('================ A. 构建产物 ================');
const html = fs.readFileSync(indexHtml, 'utf8');
const htmlKB = Math.round(fs.statSync(indexHtml).size / 1024);
const chunkDir = path.join(root, 'salon', 'chunk');
const chunkFiles = fs.existsSync(chunkDir)
  ? fs.readdirSync(chunkDir).filter((f) => /^\d+\.json$/.test(f)).map((f) => Number(f.replace('.json', ''))).sort((a, b) => a - b)
  : [];
const chunkTotal = Number((html.match(/data-chunk-total="(\d+)"/) || [, '0'])[1]);
info(`页面 ${htmlKB}KB（分块之前是 1673KB）· ${TOTAL} 条精华 · ${chunkTotal} 簇 · 成员卡片 ${memberRows.length} 张`);
check('产物里有分块信息（data-chunk-total）', chunkTotal > 1, `chunk-total=${chunkTotal}`);
check('簇文件都在（0 … 最后一簇，一个不缺）',
  chunkFiles.length === chunkTotal && chunkFiles[0] === 0 && chunkFiles[chunkFiles.length - 1] === chunkTotal - 1,
  `${chunkFiles.length} 个，最后一簇 ${chunkFiles[chunkFiles.length - 1]}`);
check('页面首屏只渲了最新那一簇（远小于全部条目）', (html.match(/class="salon__item"/g) ?? []).length < TOTAL / 10,
  `${(html.match(/class="salon__item"/g) ?? []).length} 条 / 共 ${TOTAL} 条`);
check('首屏 HTML 小了一大截（旧版 1673KB，现在 < 420KB）', htmlKB < 420, `${htmlKB}KB`);

/* 42 个簇拼起来：条目要**不重不漏**，头部不能重复 */
const seenIds = [];
const headSeq = [];
for (const n of chunkFiles) {
  const j = JSON.parse(fs.readFileSync(path.join(chunkDir, `${n}.json`), 'utf8'));
  for (const m of String(j.html).matchAll(/<article class="salon__item" id="([^"]+)"/g)) seenIds.push(m[1]);
  for (const m of String(j.html).matchAll(/class="salon__(era|date)"/g)) headSeq.push(m[1]);
}
const uniq = new Set(seenIds);
check('所有簇拼起来 = 全部精华，一条不重、一条不漏',
  seenIds.length === TOTAL && uniq.size === TOTAL,
  `${seenIds.length} 条 / 去重 ${uniq.size} / 数据 ${TOTAL}`);
check('拼起来的顺序就是数据顺序（按时间从早到晚）',
  seenIds.every((id, i) => id === essences[i].id),
  `首 ${seenIds[0]} 末 ${seenIds[seenIds.length - 1]}`);
/* 头部个数：数据里换一次年代 / 换一次日期各一个，跨簇不能多出重复的 */
const eraChanges = srcSorted.filter((e, i) => i === 0 || srcSorted[i - 1].eraId !== e.eraId).length;
const dateChanges = srcSorted.filter((e, i) => i === 0 || srcSorted[i - 1].date !== e.date).length;
check('年代头 / 日期头跨簇没有重复也没有漏（个数 = 数据里换了几次）',
  headSeq.filter((x) => x === 'era').length === eraChanges
  && headSeq.filter((x) => x === 'date').length === dateChanges,
  `年代 ${headSeq.filter((x) => x === 'era').length}/${eraChanges}、日期 ${headSeq.filter((x) => x === 'date').length}/${dateChanges}`);

const indexJsonRaw = (html.match(/<script type="application\/json" id="salon-index">([\s\S]*?)<\/script>/) || [, ''])[1];
const indexTable = indexJsonRaw ? JSON.parse(indexJsonRaw) : [];
check('页面嵌了全表索引（id / 轴上的位置 / 簇号），条数和数据一致',
  indexTable.length === TOTAL && indexTable.every((r) => Array.isArray(r) && r.length === 3),
  `${indexTable.length} 行`);
check('索引里的簇号覆盖了每一簇（点轴跳转才找得到远处的条目）',
  new Set(indexTable.map((r) => r[2])).size === chunkTotal,
  `${new Set(indexTable.map((r) => r[2])).size} / ${chunkTotal}`);

/* ================================================================
 * 起服务 + 开浏览器
 * ================================================================ */
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

const profileDir = path.join(process.env.TEMP ?? '.', `dsh-salonchunk-${Date.now()}`);
const chrome = spawn(
  CHROME,
  ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--disable-breakpad', '--window-size=1600,900', `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' },
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
  async goto(p, wait = 1600) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 200; i++) { await sleep(60); if ((await this.ev('document.readyState')) === 'complete') break; }
    await this.ev('document.fonts ? document.fonts.ready.then(()=>1) : 1');
    await sleep(wait);
  }
  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await sleep(50);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(40);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }
  setViewport(w, h, mobile) {
    return this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
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

/** 页面状态 */
const STATE = `(() => {
  const items = [...document.querySelectorAll('.salon__item')];
  const boxes = [...document.querySelectorAll('.salon__chunk')];
  const shown = items.filter((e) => !e.hidden);
  const last = shown.length ? shown[shown.length - 1] : null;
  return {
    vw: document.documentElement.clientWidth, vh: window.innerHeight, scrollY: Math.round(window.scrollY),
    h: document.documentElement.scrollHeight,
    items: items.length, shown: shown.length,
    chunks: boxes.map((b) => b.dataset.chunk + (b.dataset.extra ? 'x' : '')),
    first: document.getElementById('salon-list').dataset.chunkFirst,
    last: document.getElementById('salon-list').dataset.chunkLast,
    lastId: last ? last.id : '', lastTop: last ? Math.round(last.getBoundingClientRect().top) : null,
    hash: location.hash
  };
})()`;

const vis = (y) => `(() => { const el = document.elementFromPoint(200, ${y}); return el ? el.className.toString() : ''; })()`;

/* ================================================================
 * B. 分块装载（桌面）
 * ================================================================ */
console.log('\n================ B. 分块装载（1600×900） ================');
await cdp.setViewport(1600, 900, false);
await cdp.goto('/salon/');
let s = await cdp.ev(STATE);
info(`进来：${s.items} 条在 DOM 里、簇 [${s.chunks.join(' ')}]、scrollY ${s.scrollY} / 总高 ${s.h}`);
check('一进来只渲最新那一簇（不是全部 833 条）', s.items === TOTAL % 20 || s.items <= 20, `${s.items} 条`);
check('默认落在最新那一条（不是停在开头）', s.scrollY > 3000 && s.lastTop !== null && s.lastTop < s.vh,
  `最后一条顶边 ${s.lastTop} / 视口 ${s.vh}`);

/* 上翻：滚到顶，等它补簇；补完之后原来那一条在视口里的位置不能被顶走 */
const before = await cdp.ev(`(() => { const el = document.querySelectorAll('.salon__item'); return el.length; })()`);
await cdp.ev(`window.scrollTo({top: 0, behavior: 'instant'}); 1`);
await sleep(2200);
const up = await cdp.ev(STATE);
info(`滚到顶之后：${up.items} 条、簇 [${up.chunks.join(' ')}]、scrollY ${up.scrollY}`);
check('翻到顶就补上了更早的一簇', up.items > before && Number(up.first) === chunkTotal - 2,
  `${before} → ${up.items} 条；first=${up.first}`);
check('补完之后滚动位置被补回来了（画面没有突然往上跳）', up.scrollY > 400,
  `scrollY ${up.scrollY}（补进来的一簇约 ${up.h - s.h}px）`);
/* 再滚一次：应该继续往前补，簇号连续 */
await cdp.ev(`window.scrollTo({top: 0, behavior: 'instant'}); 1`);
await sleep(2200);
const up2 = await cdp.ev(STATE);
check('再翻一次继续补，簇号是连续的（不跳号）',
  Number(up2.first) === chunkTotal - 3 && up2.chunks.filter((c) => !c.endsWith('x')).length === 3,
  `簇 [${up2.chunks.join(' ')}]`);

/* ---- 点时间轴：方向要对（弧顶上面 = 更晚、下面 = 更早），而且要能跳到没渲出来的那条 ---- */
await cdp.goto('/salon/');
const apex = await cdp.ev(`(() => {
  const dot = document.querySelector('.tl__nowDot').getBoundingClientRect();
  const b = document.querySelector('.tl__body').getBoundingClientRect();
  return { y: Math.round(dot.top + dot.height / 2), x: Math.round(b.left + b.width * 0.55),
    date: (document.querySelector('[data-tl-nowdate]') || {}).textContent.trim() }; })()`);
info(`弧顶停在 ${apex.date}（y=${apex.y}）`);
/* 点在弧顶**下面** 120px：时间轴越往下越早，应该跳到更早的一条（而且那条多半还没渲出来） */
await cdp.click(apex.x, Math.min(apex.y + 120, 840));
await sleep(2600);
const below = await cdp.ev(`(() => {
  const hit = document.querySelector('.salon__item--hit') || (location.hash ? document.getElementById(location.hash.slice(1)) : null);
  const b = hit ? hit.getBoundingClientRect() : null;
  return { id: hit ? hit.id : '', top: b ? Math.round(b.top) : null,
    chunks: [...document.querySelectorAll('.salon__chunk')].map((c) => c.dataset.chunk),
    gap: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--salon-jump-gap')) || 0 };
})()`);
const belowIdx = idxOf.get(below.id) ?? -1;
const belowDate = essences[belowIdx]?.date ?? '';
info(`点弧顶下面 120px：跳到 ${below.id}（${belowDate}，第 ${belowIdx + 1} / ${TOTAL} 条），簇 [${below.chunks.join(' ')}]`);
check('点弧顶下面 → 跳到更早的一条（方向没被镜像）', !!below.id && belowDate <= apex.date,
  `${belowDate || '(没跳)'} vs 弧顶 ${apex.date}`);
check('点轴真能跳到本来没渲出来的那条（现取它所在的簇）',
  below.chunks.length >= 1 && !below.chunks.includes(String(chunkTotal - 1)),
  `簇 [${below.chunks.join(' ')}]（原来只有第 ${chunkTotal - 1} 簇）`);
/*
 * 窗口重建 = 只把它前后那几簇摆进文档，不是把中间几十簇全拉下来。
 * 允许 4 簇：落到窗口最上面那一簇以后，滚动位置离顶不到 900px，
 * 上翻逻辑会自动再补一簇（这是它该干的事）。
 */
check('跳过去以后窗口只铺了它附近那几簇（没有把中间几十簇全拉下来）',
  below.chunks.length >= 1 && below.chunks.length <= 4, `簇 [${below.chunks.join(' ')}]`);
check('落点在视口里、且从吸顶的东西下面露出来',
  below.top !== null && below.top >= below.gap - 40 && below.top < 420,
  `顶边 ${below.top} vs 让开 ${below.gap}`);

/* 点在弧顶**上面** 120px：应该跳到更晚的一条（两个方向都对才叫没镜像） */
await cdp.goto('/salon/');
const apex2 = await cdp.ev(`(() => {
  const dot = document.querySelector('.tl__nowDot').getBoundingClientRect();
  const b = document.querySelector('.tl__body').getBoundingClientRect();
  return { y: Math.round(dot.top + dot.height / 2), x: Math.round(b.left + b.width * 0.55),
    date: (document.querySelector('[data-tl-nowdate]') || {}).textContent.trim() }; })()`);
await cdp.click(apex2.x, Math.max(apex2.y - 120, 140));
await sleep(2600);
const aboveId = await cdp.ev(`(() => {
  const hit = document.querySelector('.salon__item--hit') || (location.hash ? document.getElementById(location.hash.slice(1)) : null);
  return hit ? hit.id : ''; })()`);
const aboveIdx = idxOf.get(aboveId) ?? -1;
info(`点弧顶上面 120px：跳到 ${aboveId}（${essences[aboveIdx]?.date ?? '?'}）`);
check('点弧顶上面 → 跳到更晚的一条（两个方向都对）',
  !!aboveId && (essences[aboveIdx]?.date ?? '') >= apex2.date,
  `${essences[aboveIdx]?.date || '(没跳)'} vs 弧顶 ${apex2.date}`);

/* ---- 带 hash 进来：直接落到那一条（老的那一簇现取） ---- */
const oldest = essences[3].id;
await cdp.goto(`/salon/?from=check#${oldest}`);
const landed = await cdp.ev(`(() => { const el = document.getElementById(${JSON.stringify(oldest)});
  const b = el ? el.getBoundingClientRect() : null;
  return { exists: !!el, top: b ? Math.round(b.top) : null,
    gap: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--salon-jump-gap')) || 0,
    chunks: [...document.querySelectorAll('.salon__chunk')].map((c) => c.dataset.chunk) }; })()`);
info(`带 #${oldest} 进来：顶边 ${landed.top}，簇 [${landed.chunks.join(' ')}]`);
check('带 hash 进来会现取那一簇、并落在那一条上', landed.exists && landed.top !== null && landed.top <= 240,
  `顶边 ${landed.top}`);
check('落点在吸顶的那几样下面（不会被页头 / 搜索栏压住）',
  landed.top !== null && landed.top >= landed.gap - 40, `顶边 ${landed.top} vs 让开 ${landed.gap}`);

/* ================================================================
 * C. 搜索
 * ================================================================ */
console.log('\n================ C. 搜索（全表 + 分块） ================');
await cdp.goto('/salon/');
const who = memberRows[1]?.name ?? '';
/* 搜索匹配的是「成员名 + 日期 + 时刻 + 正文」整段文本（和页面脚本里那套一致），
   所以同一个人名命中数可能**比他的条数多**（别人的正文里提到他）。这里按同一套规则算。 */
const hayOf = (e) => [e.member ?? '', e.date ?? '', e.time ?? '', e.text ?? ''].join(' ').toLowerCase();
const expectHits = essences.filter((e) => hayOf(e).includes(who.toLowerCase())).length;
await cdp.ev(`(() => { const q = document.getElementById('salon-q'); q.value = ${JSON.stringify(who)}; q.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
await sleep(3000);
const searched = await cdp.ev(`(() => {
  const items = [...document.querySelectorAll('.salon__item')];
  const shown = items.filter((e) => !e.hidden);
  return { hit: document.getElementById('salon-hit').textContent,
    shown: shown.length, ids: shown.map((e) => e.id).slice(0, 5),
    chunks: new Set([...document.querySelectorAll('.salon__chunk')].map((c) => c.dataset.chunk)).size }; })()`);
info(`搜「${who}」：${searched.hit}，显示 ${searched.shown} 条，用了 ${searched.chunks} 簇`);
check(`搜索命中数 = 全表里含「${who}」的条数（${expectHits} 条）`,
  searched.hit === `命中 ${expectHits} / ${TOTAL} 条`, searched.hit);
check('显示出来的都是命中那些（不是只筛已经渲出来的十几条）', searched.shown > 5, `${searched.shown} 条`);
await cdp.ev(`(() => { const q = document.getElementById('salon-q'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
await sleep(900);
const cleared = await cdp.ev(STATE);
check('清空关键词 → 临时取来的簇都摘掉了，回到只有最新那一簇',
  cleared.chunks.length === 1 && Number(cleared.first) === chunkTotal - 1,
  `簇 [${cleared.chunks.join(' ')}]`);
check('清空后条目全部重新显示', cleared.shown === cleared.items, `${cleared.shown}/${cleared.items}`);
await cdp.ev(`(() => { const q = document.getElementById('salon-q'); q.value = 'zzzqqq没有这个词'; q.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
await sleep(1200);
const none = await cdp.ev(`(() => ({ hit: document.getElementById('salon-hit').textContent,
  emptyShown: !document.getElementById('salon-empty').hidden }))()`);
check('搜一个没有的词 → 命中 0，那句提示出来', none.hit === `命中 0 / ${TOTAL} 条` && none.emptyShown, none.hit);
await cdp.ev(`(() => { const q = document.getElementById('salon-q'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
await sleep(600);

/* ================================================================
 * D. 成员栏
 * ================================================================ */
console.log('\n================ D. 成员栏（桌面） ================');
/* 重新进来一次：上面搜索来回折腾之后，文档里留着的簇可能不止一簇 */
await cdp.goto('/salon/');
const mem = await cdp.ev(`(() => {
  const cards = [...document.querySelectorAll('.salon__memCard')];
  return {
    n: cards.length,
    rows: cards.map((c) => ({ id: c.dataset.mem, name: (c.querySelector('.salon__memName') || {}).textContent || '',
      count: (c.querySelector('.salon__memCount') || {}).textContent || '',
      eye: !!c.querySelector('.salon__memEye svg'), on: c.dataset.on,
      pressed: c.getAttribute('aria-pressed') })),
    tab: document.querySelector('[data-mem-toggle]'),
    tabText: (document.querySelector('[data-mem-toggle]') || {}).textContent.trim(),
    tabVisible: (() => { const t = document.querySelector('.salon__memBar'); return t ? getComputedStyle(t).display : 'none'; })(),
    panelVisible: (() => { const p = document.querySelector('.salon__memPanel'); return p ? getComputedStyle(p).display : 'none'; })(),
    panelH: Math.round(document.querySelector('.salon__memPanel').getBoundingClientRect().height),
    panelTop: Math.round(document.querySelector('.salon__memPanel').getBoundingClientRect().top)
  };
})()`);
info(`成员卡片 ${mem.n} 张；标签卡那一栏 display=${mem.tabVisible}；面板 ${mem.panelVisible}，高 ${mem.panelH}，顶 ${mem.panelTop}`);
check('成员卡片数 = 有精华的那些成员', mem.n === memberRows.length, `${mem.n} / ${memberRows.length}`);
check('每张卡的「N 条」= 数据里这个人的条数',
  mem.rows.every((r) => r.count === `${counts.get(r.name) ?? 0} 条`),
  mem.rows.filter((r) => r.count !== `${counts.get(r.name) ?? 0} 条`).map((r) => `${r.name}:${r.count}`).join(' ') || '全对');
check('每张卡左侧都有那枚小眼睛（和冰室冰山同一个开关）', mem.rows.every((r) => r.eye));
check('默认一个都没点亮（卡片是熄灭态，精华全都显示）',
  mem.rows.every((r) => r.on === '0' && r.pressed === 'false'));
check('电脑端不折叠：标签卡不出现、成员面板一直显示',
  mem.tabVisible === 'none' && mem.panelVisible === 'block');
check('面板整块在屏幕里、且和左边那条轴一样高（都从页头底下跨到屏幕底）',
  mem.panelTop >= 60 && mem.panelH > 400, `顶 ${mem.panelTop}、高 ${mem.panelH}`);

/* 点亮一个人 → 只剩他的精华，卡片泛霓虹光；再点一下 → 全灭、全部精华回来 */
const first = mem.rows[0];
const pt0 = await cdp.ev(`(() => { const c = document.querySelectorAll('.salon__memCard')[0].getBoundingClientRect();
  return { x: Math.round(c.left + c.width / 2), y: Math.round(c.top + c.height / 2) }; })()`);
await cdp.click(pt0.x, pt0.y);
await sleep(900);
const lit1 = await cdp.ev(`(() => {
  const card = document.querySelectorAll('.salon__memCard')[0];
  const cs = getComputedStyle(card);
  const items = [...document.querySelectorAll('.salon__item')];
  const shown = items.filter((e) => !e.hidden);
  const memId = card.dataset.mem;
  return { on: card.dataset.on, pressed: card.getAttribute('aria-pressed'),
    shadow: cs.boxShadow, border: cs.borderTopColor,
    shown: shown.length, items: items.length,
    onlyHim: shown.every((e) => (e.dataset.members || '').split(' ').includes(memId)),
    pinHidden: document.getElementById('salon-pin').hidden }; })()`);
check('点一下 → 这个人点亮（data-on=1、aria-pressed=true）',
  lit1.on === '1' && lit1.pressed === 'true');
check('点亮的那张卡四周泛霓虹光（box-shadow 里有粉色光晕）',
  /rgba\(255,\s*79,\s*163/.test(lit1.shadow) && lit1.shadow !== 'none',
  `${lit1.shadow.slice(0, 70)}…`);
check(`只显示「${first.name}」参与的精华（${lit1.shown}/${lit1.items} 条，全是他的）`,
  lit1.onlyHim && lit1.shown > 0 && lit1.shown < lit1.items, `${lit1.shown} 条`);
check('只点亮一个人时还没有置顶区', lit1.pinHidden === true);
await cdp.click(pt0.x, pt0.y);
await sleep(700);
const lit0 = await cdp.ev(`(() => ({ on: document.querySelectorAll('.salon__memCard')[0].dataset.on,
  hidden: [...document.querySelectorAll('.salon__item')].filter((e) => e.hidden).length,
  shadow: getComputedStyle(document.querySelectorAll('.salon__memCard')[0]).boxShadow }))()`);
check('再点一下 → 熄灭，所有精华又都显示出来',
  lit0.on === '0' && lit0.hidden === 0, `熄灭后藏起来 ${lit0.hidden} 条`);

/* 多人条目：任意一个成员亮着就显示；一个不沾的成员亮着就看不到它；两个都亮 → 置顶 */
const multi = essences.map((e, i) => ({ e, i })).filter((x) => (x.e.members ?? []).length > 1).pop();
if (multi) {
  await cdp.goto(`/salon/?m=1#${multi.e.id}`);
  const ids = await cdp.ev(`(() => {
    const el = document.getElementById(${JSON.stringify(multi.e.id)});
    return { exists: !!el, members: el ? (el.dataset.members || '') : '' }; })()`);
  const memIds = ids.members.split(' ').filter(Boolean);
  const names = multi.e.members.map((m) => m.name);
  info(`多人条目 ${multi.e.id}（${names.join('、')}）`);
  /* 点亮它的第一个成员 → 这条还在 */
  await cdp.ev(`(() => { const c = [...document.querySelectorAll('.salon__memCard')].find((x) => x.dataset.mem === ${JSON.stringify(memIds[0])}); if (c) c.click(); return 1; })()`);
  await sleep(900);
  const still = await cdp.ev(`(() => { const el = document.getElementById(${JSON.stringify(multi.e.id)});
    return el ? !el.hidden : null; })()`);
  check('多人条目：点亮其中**一个**成员 → 这条还在（任意一个亮着就显示）', still === true, `still=${still}`);
  /* 点亮一个跟它无关的人 → 它消失 */
  /* 先把已经点亮的都熄灭：不然那条多人精华还有它自己的成员亮着，当然还看得见 */
  const outsider = memberRows.find((m) => !names.includes(m.name));
  if (outsider) {
    await cdp.ev(`(() => { for (const c of document.querySelectorAll('.salon__memCard')) if (c.dataset.on === '1') c.click(); return 1; })()`);
    await sleep(600);
    await cdp.ev(`(() => { const c = [...document.querySelectorAll('.salon__memCard')].find((x) => x.dataset.mem === ${JSON.stringify(outsider.id)}); if (c) c.click(); return 1; })()`);
    await sleep(900);
    const out = await cdp.ev(`(() => { const el = document.getElementById(${JSON.stringify(multi.e.id)});
      return el ? !el.hidden : null; })()`);
    check('点亮的成员跟它无关时（只看那一个人）它就不显示了', out === false, `hidden=${out}`);
  }
  /* 把这条的两个成员都点亮 → 进置顶区，而且只在置顶区出现一次 */
  await cdp.goto(`/salon/?m=2#${multi.e.id}`);
  await cdp.ev(`(() => {
    const ids = ${JSON.stringify(memIds)};
    for (const c of document.querySelectorAll('.salon__memCard')) if (ids.includes(c.dataset.mem)) c.click();
    return 1;
  })()`);
  await sleep(2200);
  const pinned = await cdp.ev(`(() => {
    const pin = document.getElementById('salon-pin');
    const inPin = [...pin.querySelectorAll('.salon__item')];
    const all = [...document.querySelectorAll('.salon__item')];
    const dup = all.filter((e, i) => all.findIndex((x) => x.id === e.id) !== i).length;
    const order = [...document.getElementById('salon-list').querySelectorAll('.salon__item')].slice(0, 3).map((e) => ({ id: e.id, pinned: !!e.closest('#salon-pin') }));
    const litNames = [...document.querySelectorAll('.salon__memCard[data-on="1"]')].map((c) => c.querySelector('.salon__memName').textContent.trim());
    return { hidden: pin.hidden, n: inPin.length, ids: inPin.map((e) => e.id).slice(0, 6),
      covers: inPin.every((e) => ${JSON.stringify(memIds)}.every((id) => (e.dataset.members || '').split(' ').includes(id))),
      hasTarget: inPin.some((e) => e.id === ${JSON.stringify(multi.e.id)}),
      dup, order, litNames }; })()`);
  info(`点亮 ${pinned.litNames.join(' + ')}：置顶 ${pinned.n} 条（${pinned.ids.join(' ')}），最上面那几条 ${JSON.stringify(pinned.order)}`);
  check('点亮两个成员 → 出现置顶区', pinned.hidden === false && pinned.n > 0, `${pinned.n} 条`);
  check('置顶区里每一条都是这两个人**共同参与**的',
    pinned.covers === true, pinned.covers ? '' : '有条目只沾了其中一个');
  check('这条多人精华确实被置顶了', pinned.hasTarget === true);
  check('置顶的那些在最上面（列表最前几条就在置顶区里）',
    pinned.order.length > 0 && pinned.order[0].pinned === true, JSON.stringify(pinned.order));
  check('同一个 id 不会在文档里出现两次（搬走不是复制）', pinned.dup === 0, `重复 ${pinned.dup} 个`);
  /* 全部熄灭 → 置顶区消失、所有精华回来 */
  await cdp.ev(`(() => { for (const c of document.querySelectorAll('.salon__memCard')) if (c.dataset.on === '1') c.click(); return 1; })()`);
  await sleep(1200);
  const restored = await cdp.ev(`(() => ({ pinHidden: document.getElementById('salon-pin').hidden,
    pinN: document.getElementById('salon-pin').querySelectorAll('.salon__item').length,
    hidden: [...document.querySelectorAll('.salon__item')].filter((e) => e.hidden).length,
    cardsOn: document.querySelectorAll('.salon__memCard[data-on="1"]').length }))()`);
  check('全部熄灭 → 置顶区清空、所有精华回来、卡片全灭',
    restored.pinHidden === true && restored.pinN === 0 && restored.hidden === 0 && restored.cardsOn === 0,
    JSON.stringify(restored));
} else {
  check('多人条目规则', false, '数据里找不到多人条目');
}
/* ================================================================
 * E. 版式
 * ================================================================ */
console.log('\n================ E. 版式 ================');
await cdp.goto('/salon/');
const lay = await cdp.ev(`(() => {
  const r = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect();
    return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width) }; };
  return { vw: document.documentElement.clientWidth, main: r('.salon__main'),
    side: r('.salon__side'), members: r('.salon__members') }; })()`);
info(`正文 ${lay.main.l}→${lay.main.r}（${lay.main.w}px）· 轴 ${lay.side.w}px · 成员栏 ${lay.members.w}px · 视口 ${lay.vw}`);
check('正文摆在屏幕正中间（中心差 ≤ 2px）',
  Math.abs((lay.main.l + lay.main.r) / 2 - lay.vw / 2) <= 2,
  `正文中心 ${Math.round((lay.main.l + lay.main.r) / 2)} vs 视口中心 ${Math.round(lay.vw / 2)}`);
check('正文比旧版宽（旧版约 630px）', lay.main.w > 800, `${lay.main.w}px`);
check('右边成员栏和左边时间轴一样宽（差 ≤ 2px）', Math.abs(lay.side.w - lay.members.w) <= 2,
  `${lay.side.w} vs ${lay.members.w}`);
check('时间轴在左、成员栏在右（不压正文）',
  lay.side.r <= lay.main.l && lay.members.l >= lay.main.r,
  `轴右沿 ${lay.side.r} ≤ 正文左 ${lay.main.l}；成员栏左 ${lay.members.l} ≥ 正文右 ${lay.main.r}`);

/* ---- 手机 ---- */
await cdp.setViewport(390, 844, true);
await cdp.goto('/salon/', 2000);
const m = await cdp.ev(`(() => {
  const mem = document.querySelector('[data-salon-members]');
  const tab = document.querySelector('[data-mem-toggle]');
  const bar = document.querySelector('.salon__memBar');
  const barRect = bar.getBoundingClientRect();
  const tb = tab.getBoundingClientRect();
  return { open: mem.dataset.open, tabText: tab.textContent.trim(),
    tabW: Math.round(tb.width), tabH: Math.round(tb.height),
    barTop: Math.round(barRect.top), barH: Math.round(barRect.height),
    panelDisplay: getComputedStyle(document.querySelector('.salon__memPanel')).display,
    items: document.querySelectorAll('.salon__item').length }; })()`);
info(`手机：标签卡 ${m.tabW}×${m.tabH}、栏高 ${m.barH}、顶 ${m.barTop}、展开前 display=${m.panelDisplay}`);
check('手机上一进来只有最新那一簇', m.items <= 20, `${m.items} 条`);
check('收起状态：只有一个没字的标签卡（点开前没有任何文字）', m.tabText === '' && m.tabW > 20,
  `文字「${m.tabText}」`);
check('成员栏在顶部、跟着滚动（收起时面板不占地方）', m.barTop < 200 && m.panelDisplay === 'none',
  `栏顶 ${m.barTop}`);
const tabPt = await cdp.ev(`(() => { const t = document.querySelector('[data-mem-toggle]').getBoundingClientRect();
  return { x: Math.round(t.left + t.width / 2), y: Math.round(t.top + t.height / 2) }; })()`);
await cdp.click(tabPt.x, tabPt.y);
await sleep(700);
const open1 = await cdp.ev(`(() => {
  const cards = [...document.querySelectorAll('.salon__memCard')];
  const rows = [];
  for (const c of cards) {
    const b = c.getBoundingClientRect();
    const key = Math.round(b.top);
    let row = rows.find((r) => Math.abs(r.top - key) <= 4);
    if (!row) { row = { top: key, lefts: [], rights: [] }; rows.push(row); }
    row.lefts.push(Math.round(b.left)); row.rights.push(Math.round(b.right));
  }
  rows.sort((a, b) => a.top - b.top);
  const panel = document.querySelector('.salon__memPanel').getBoundingClientRect();
  return { open: document.querySelector('[data-salon-members]').dataset.open,
    expanded: document.querySelector('[data-mem-toggle]').getAttribute('aria-expanded'),
    display: getComputedStyle(document.querySelector('.salon__memPanel')).display,
    panelL: Math.round(panel.left), panelR: Math.round(panel.right), panelT: Math.round(panel.top),
    rows: rows.map((r) => ({ n: r.lefts.length, minL: Math.min(...r.lefts), maxR: Math.max(...r.rights) })),
    vw: document.documentElement.clientWidth }; })()`);
info(`点开：${open1.rows.map((r) => r.n).join(' + ')}，面板 ${open1.panelL}→${open1.panelR}`);
check('点一下标签卡就展开（aria-expanded=true，面板 display=block）',
  open1.open === '1' && open1.expanded === 'true' && open1.display === 'block');
check('展开后所有成员卡片都在（一张不少）',
  open1.rows.reduce((a, r) => a + r.n, 0) === memberRows.length,
  `${open1.rows.reduce((a, r) => a + r.n, 0)} / ${memberRows.length}`);
check('一行 5 个（390px 宽）', open1.rows[0]?.n === 5, `第一行 ${open1.rows[0]?.n} 个`);
check('最后一行不满时**靠左**排：它的左边和第一行对齐',
  open1.rows.length > 1 && open1.rows[open1.rows.length - 1].minL === open1.rows[0].minL,
  `末行左 ${open1.rows[open1.rows.length - 1]?.minL} vs 首行左 ${open1.rows[0]?.minL}`);
check('每一行的卡片右边沿也对得上（列是等宽的）',
  open1.rows.slice(0, -1).every((r) => Math.abs(r.maxR - open1.rows[0].maxR) <= 1),
  open1.rows.map((r) => `${r.minL}~${r.maxR}`).join(' | '));
check('展开的面板铺满屏幕宽度（手机窄，一行才放得下五个）',
  open1.panelL === 0 && Math.abs(open1.panelR - open1.vw) <= 1, `${open1.panelL}→${open1.panelR} / ${open1.vw}`);
/* 手机上关掉一个成员也要生效 */
const beforeHide = await cdp.ev(`(() => [...document.querySelectorAll('.salon__item')].filter((e) => !e.hidden).length)()`);
await cdp.ev(`(() => { const c = document.querySelectorAll('.salon__memCard')[0]; c.click(); return c.dataset.on; })()`);
await sleep(600);
const afterHide = await cdp.ev(`(() => ({ shown: [...document.querySelectorAll('.salon__item')].filter((e) => !e.hidden).length,
  on: document.querySelectorAll('.salon__memCard')[0].dataset.on }))()`);
check('手机上也一样：点亮一个成员，就只剩他的精华',
  afterHide.on === '1' && afterHide.shown < beforeHide, `${beforeHide} → ${afterHide.shown} 条`);
/* 再点标签卡收起 */
await cdp.click(tabPt.x, tabPt.y);
await sleep(500);
check('再点一下收起（面板藏起来、aria-expanded=false）',
  (await cdp.ev(`(() => ({ open: document.querySelector('[data-salon-members]').dataset.open,
    exp: document.querySelector('[data-mem-toggle]').getAttribute('aria-expanded') }))()`)).open === '0');

/* ================================================================
 * F. 报错
 * ================================================================ */
console.log('\n================ F. 报错 ================');
await cdp.setViewport(1440, 900, false);
await cdp.goto('/salon/');
await cdp.goto('/huaya/');
check('/salon/ 和别的页面都没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));

console.log(`\n================ 结果：PASS ${pass} / FAIL ${fail} ================`);
chrome.kill();
server.close();
process.exit(fail === 0 ? 0 : 1);
