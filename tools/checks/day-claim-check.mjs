/*
 * 涣源溪水钟 × 文章/手记 的联动验收（2026-10-06）
 *
 * 用户原话：
 *   「1.在涣源溪水钟卡片的左下角加一个UI 类似主页左上角的花娅域主 由我发给你的图片作为头像
 *     右边写上名字：铃忆的冰室日记 点击以后可以跳转到铃忆的冰室日记 也就是/huaya/01nikki
 *    2.将文章和手记与涣源溪水钟日记进行联动 在日期旁增加一个勾选项 使其能否通过涣源溪水钟
 *     日历直接跳转 例如2026.10.04这篇宁波那天在勾选后 首页的涣源溪水钟处点击2026.10.4
 *     对应的日期泡泡就可以直接跳转到这篇文章 如果有多篇文章同时认领这一天 则跳转到一个
 *     类似索引的页面处 可以查看这一天对应的所有文章」
 *
 * 这份脚本按三段验，每一段都用"真的东西"：
 *   ① **真实构建**：首页那颗胶囊在不在、位置对不对、头像有没有真的加载出来、点得通；
 *      认领了的那一天在日历上是不是真的可点、点下去是不是真的落到那篇文章上、
 *      没认领的那天点不动。
 *   ② **多篇认领同一天**：往一份**临时副本**里塞第二篇同一天的文章、重新构建，
 *      验它跳到 /day/<日期>/ 那一页、那一页把两篇都列出来了。
 *      （不往真仓库里塞测试内容 —— 副本用 junction 借 node_modules / public，构建完就删。）
 *   ③ **编辑器那条路**：勾选框真的在；保存一次之后 frontmatter 里真的留下 calendar: true
 *      （这一条是防"字段白名单忘了加，编辑器一保存就把勾抹掉"那类老毛病）。
 *
 * 认领了哪天**从内容文件里现读**（扫 frontmatter 的 calendar: true），不写死日期。
 *
 * 用法：node tools/checks/day-claim-check.mjs [--shots]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync, execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..');
const DIST = path.join(SRC, 'dist');
const TMP = path.join(SRC, '.tmp');
const COPY = path.join(TMP, 'day-copy');
const SHOTS = path.join(TMP, 'day-shots');
const WANT_SHOTS = process.argv.includes('--shots');
const PORT = 4397;
const EDITOR_PORT = 4398;
const DEBUG_PORT = 9367;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg', '.xml': 'application/xml' };

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

/* ================================================================
 * 真仓库里"谁认领了哪天"：扫内容文件的 frontmatter 现读
 * ================================================================ */
function claimedInRepo() {
  const out = new Map(); // date -> [{ collection, id, title }]
  for (const [dir, collection] of [['posts', 'posts'], ['notes', 'notes']]) {
    const full = path.join(SRC, 'src', 'content', dir);
    if (!fs.existsSync(full)) continue;
    for (const file of fs.readdirSync(full)) {
      if (!file.endsWith('.md')) continue;
      const raw = fs.readFileSync(path.join(full, file), 'utf8');
      if (!/^calendar:\s*true\s*$/m.test(raw)) continue;
      const id = file.replace(/\.md$/, '');
      const title = (/^title:\s*(.+)$/m.exec(raw) ?? [, id])[1].trim();
      const date = (/^date:\s*(.+)$/m.exec(raw) ?? [, ''])[1].trim().slice(0, 10);
      const list = out.get(date) ?? [];
      list.push({ collection, id, title, url: `/${collection}/${id}/` });
      out.set(date, list);
    }
  }
  return out;
}

const claimed = claimedInRepo();
const widgets = JSON.parse(fs.readFileSync(path.join(SRC, 'src', 'data', 'home-widgets.json'), 'utf8'));
const events = (widgets.calendar ?? {}).events ?? {};
info(`内容里认领了这些天：${[...claimed.entries()].map(([d, l]) => `${d}(${l.length} 篇)`).join(' ') || '（一篇都没有）'}`);

/* ================================================================
 * 静态服务（dist，可切目录）+ 无头浏览器
 * ================================================================ */
let serveRoot = DIST;
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
    const f = path.join(serveRoot, t);
    if (f.startsWith(serveRoot) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream' });
      return fs.createReadStream(f).pipe(res);
    }
  }
  res.writeHead(404);
  res.end('404');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = path.join(process.env.TEMP ?? '.', `dsh-day-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu',
  '--enable-unsafe-swiftshader', '--hide-scrollbars', '--disable-breakpad',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

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
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(`exception: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
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
  async open(url, settle = 1600) {
    this.errors = [];
    await this.send('Page.navigate', { url: url.startsWith('http') ? url : `http://127.0.0.1:${PORT}${url}` });
    for (let i = 0; i < 120; i++) {
      await sleep(100);
      if ((await this.ev('document.readyState')) === 'complete') break;
    }
    /* 站里是平滑滚动；量位置/点东西之前先关掉，免得点在滚动动画的半路上 */
    await this.ev(`(() => { const s=document.createElement('style'); s.textContent='html{scroll-behavior:auto !important}'; document.head.appendChild(s); return true; })()`);
    await sleep(settle);
  }
  async shot(name, full = false) {
    if (!WANT_SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
    fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(r.data, 'base64'));
    info(`拍好 ${name}`);
  }
}

/**
 * 用**真鼠标**点一下某个元素（不是 DOM 的 el.click()）。
 * 为什么：合成点击在某些情况下不会触发导航，量出来就是"路径没变"（第一版就栽在这儿，
 * 三条"点了真的跳走"全红）。CDP 发 mousePressed/mouseReleased 和用户手点是一回事。
 * 传的是"找到那个元素"的表达式；点之前给它挂个临时 id，稳妥。
 */
async function realClick(findExpr) {
  const r = await cdp.ev(`(() => {
    const el = ${findExpr};
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    el.id = '__click_target';
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), href: el.getAttribute('href') || '', tag: el.tagName };
  })()`);
  if (!r) return null;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y, buttons: 0 });
  await sleep(120);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(70);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1, buttons: 0 });
  await sleep(1200);
  const after = await cdp.ev(`({ path: location.pathname, h1: (document.querySelector('h1') || {}).textContent?.trim() || '',
                                  listed: [...document.querySelectorAll('.post-item__title')].map((n) => n.textContent.trim()),
                                  back: !!document.querySelector('.day-back a') })`);
  return { ...r, ...after };
}

let cdp = null;
for (let i = 0; i < 60 && !cdp; i++) {
  await sleep(300);
  try {
    const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const t = l.find((x) => x.type === 'page');
    if (t) cdp = await CDP.attach(t.webSocketDebuggerUrl);
  } catch { /* 等它起来 */ }
}
check('无头浏览器起来了', !!cdp);
if (!cdp) process.exit(1);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

/* ================================================================
 * ① 真实构建：胶囊 + 认领的那一天
 * ================================================================ */
console.log('\n================ ① 首页：左下角那颗胶囊 ================');
await cdp.open('/');
const pill = await cdp.ev(`(() => {
  const card = document.querySelector('.cal');
  const a = document.querySelector('.cal__diary');
  if (!card || !a) return { ok: false };
  const cr = card.getBoundingClientRect();
  const r = a.getBoundingClientRect();
  const img = a.querySelector('img');
  const box = document.querySelector('.cal__today')?.getBoundingClientRect() ?? null;
  return {
    ok: true,
    href: a.getAttribute('href'),
    text: (a.querySelector('.cal__diaryText')?.textContent || '').trim(),
    title: a.getAttribute('title') || '',
    face: !!img, faceLoaded: !!img && img.naturalWidth > 0, faceW: img ? Math.round(img.naturalWidth) : 0,
    leftOfCard: Math.round(r.left - cr.left), bottomGap: Math.round(cr.bottom - r.bottom),
    cardW: Math.round(cr.width), cardH: Math.round(cr.height),
    inLeftHalf: r.left + r.width / 2 < cr.left + cr.width / 2,
    overlapsToday: box ? !(r.right <= box.left || r.left >= box.right) : null,
    todayText: (document.querySelector('.cal__today')?.textContent || '').trim().slice(0, 20),
  };
})()`);
info(`胶囊：${JSON.stringify(pill)}`);
check('★ 涣源溪水钟卡片左下角真有一颗胶囊', pill.ok === true);
check('★ 它挂在**左下角**（在卡片左半边、贴着底边）',
  pill.inLeftHalf === true && pill.bottomGap >= 0 && pill.bottomGap <= 24,
  `左边距 ${pill.leftOfCard}px、离底 ${pill.bottomGap}px`);
check('★ 右边写的是「铃忆的冰室日记」', pill.text === '铃忆的冰室日记', pill.text);
check('★ 点它去 /huaya/01nikki', pill.href === '/huaya/01nikki', String(pill.href));
check('★★ 头像真的加载出来了（不是空圈）', pill.face === true && pill.faceLoaded === true, `${pill.faceW}px`);
check('★ 它没有和右下角「今天」那个小框叠在一起', pill.overlapsToday === false,
  `今天那框：${pill.todayText}`);

// 真的点一下 → 落到那一页
const clicked = await realClick(`document.querySelector('.cal__diary')`);
/* 版块数据里那一页的地址是 `/huaya/01nikki`（不带尾斜杠），
   GitHub Pages 会 301 到 `/huaya/01nikki/`；本机的静态服务器直接把目录里的
   index.html 端出来、不改地址。所以两种都算对。 */
check('★★ 点一下真的到了「铃忆的冰室日记」那一页',
  (clicked?.path === '/huaya/01nikki' || clicked?.path === '/huaya/01nikki/') && clicked?.h1 === '铃忆的冰室日记',
  JSON.stringify(clicked).slice(0, 140));

console.log('\n================ ①-2 日历上认领的那一天 ================');
await cdp.open('/');
if (WANT_SHOTS) {
  /* 截图要滚到日历那一屏（不然拍到的是封面） */
  await cdp.ev(`document.querySelector('.extras').scrollIntoView({ block: 'center' })`);
  await sleep(500);
  await cdp.shot('home-calendar');
}
const calInfo = await cdp.ev(`(() => {
  const cfg = JSON.parse(document.getElementById('cal-data').textContent || '{}');
  const days = cfg.days ?? {};
  const year = new Date().getFullYear();
  const month = new Date().getMonth();              // 0-11
  const mm = String(month + 1).padStart(2, '0');
  const key = (d) => year + '-' + mm + '-' + String(d).padStart(2, '0');
  const cells = [...document.querySelectorAll('.cal__day')].map((el) => {
    const num = (el.querySelector('.cal__num')?.textContent || '').trim();
    return {
      date: key(num),
      tag: el.tagName,
      href: el.getAttribute('href'),
      cls: el.className,
      dataCount: el.getAttribute('data-count'),
      tip: (el.querySelector('.cal__tip')?.textContent || '').trim(),
      cursor: getComputedStyle(el).cursor,
    };
  });
  const at = (d) => cells.find((c) => c.date === d) ?? null;
  return { days, cells, at: {}, tipAll: cells.map((c) => c.date + '=' + c.tip).slice(0, 31),
           vw: innerWidth, today: key(new Date().getDate()) };
})()`);
const cellOf = (date) => calInfo.cells.find((c) => c.date === date) ?? null;
info(`这个月（${calInfo.today.slice(0, 7)}）共 ${calInfo.cells.length} 个格子`);

let linkChecks = 0;
const styleDiffs = [];
for (const [date, list] of claimed) {
  if (!date.startsWith(calInfo.today.slice(0, 7))) continue;   // 只看当前显示的这个月
  const expectPage = list.length > 1 || Boolean(events[date]?.href);
  const want = expectPage ? `/day/${date}/` : list[0].url;
  const cell = cellOf(date);
  check(`★ ${date} 在日历上可点，且点它去 ${want}`, cell?.tag === 'A' && cell.href === want,
    `实际 ${cell?.tag} ${cell?.href ?? '（不是链接）'}；这一天认领 ${list.length} 篇`);
  /*
    用户 2026-10-06 的硬要求：认领之后**日历上那一天的样子一点都不许变** ——
    不加圆点（没有 data-count）、不加任何 class、悬停那句话也只写日期。
  */
  if (cell) {
    if (cell.cls.replace(/\bcal__day\b/, '').trim() !== '' || cell.dataCount) styleDiffs.push(`${date} class="${cell.cls}" count=${cell.dataCount}`);
    check(`★★ ${date} 的样子和普通日一模一样（没有圆点、没有额外样式）`,
      !cell.dataCount && !/cal__day--(post|claim|article)/.test(cell.cls), `class="${cell.cls}" data-count=${cell.dataCount}`);
    check(`★★ ${date} 悬停那句话只写日期（不显示文章标题）`, cell.tip === date, `${cell.tip}`);
  }
  linkChecks++;
}
check('★ 认领的那几天**没有**任何被改过样子的格子（一条也不许有）',
  styleDiffs.length === 0, styleDiffs.join(' | ') || '干净');
void linkChecks;

/* 没认领、也不是特殊日子的那天：必须点不动（不是链接） */
const plainDay = await cdp.ev(`(() => {
  const cfg = JSON.parse(document.getElementById('cal-data').textContent || '{}');
  const days = cfg.days ?? {};
  const year = new Date().getFullYear();
  const month = new Date().getMonth();
  const mm = String(month + 1).padStart(2, '0');
  const cells = [...document.querySelectorAll('.cal__day')];
  for (const el of cells) {
    const num = (el.querySelector('.cal__num')?.textContent || '').trim();
    const key = year + '-' + mm + '-' + String(num).padStart(2, '0');
    if (days[key]) continue;
    return { key, tag: el.tagName, href: el.getAttribute('href') };
  }
  return null;
})()`);
check('★ 没认领的那一天还是个普通格子（不是链接，点不动）',
  !!plainDay && plainDay.tag !== 'A' && !plainDay.href, JSON.stringify(plainDay));

/* 鼠标移上去要变手指（认领那天唯一的提示）；普通日不变 */
if (firstClaimForCursor()) {
  const c = cellOf(firstClaimForCursor());
  const p = plainDay ? cellOf(plainDay.key) : null;
  check('★★ 认领那天鼠标移上去是「手指」，普通日照旧不是（这是唯一的提示）',
    c?.cursor === 'pointer' && p && p.cursor !== 'pointer',
    `认领日 ${c?.cursor} / 普通日 ${p?.cursor}`);
}
function firstClaimForCursor() {
  const hit = [...claimed.keys()].find((d) => d.startsWith(calInfo.today.slice(0, 7)));
  return hit ?? '';
}

/* 真的点一下认领的那一天 → 落到那篇文章 */
const firstClaim = [...claimed.entries()].find(([d]) => d.startsWith(calInfo.today.slice(0, 7)));
if (firstClaim) {
  const [date, list] = firstClaim;
  const expectPage = list.length > 1 || Boolean(events[date]?.href);
  const day = Number(date.slice(8));
  const landed = await realClick(`[...document.querySelectorAll('.cal__day')].find((e) => (e.querySelector('.cal__num')?.textContent || '').trim() === '${day}')`);
  check(`★★ 点这一天真的跳走了：${expectPage ? '进「这一天」索引页' : '直接进那篇文章'}`,
    landed?.path === (expectPage ? `/day/${date}/` : list[0].url),
    JSON.stringify(landed).slice(0, 160));
  if (!expectPage) {
    check('★ 落到的就是那篇文章（标题对得上）', landed?.h1 === list[0].title, `${landed?.h1} / 期望 ${list[0].title}`);
  }
  /* 顺手验一下悬停那句话：认领了也只写日期（用户 2026-10-06 明确要求的） */
  await cdp.open('/');
  const tip = await cdp.ev(`(() => {
    const el = [...document.querySelectorAll('.cal__day')].find((e) => (e.querySelector('.cal__num')?.textContent || '').trim() === '${day}');
    return (el?.querySelector('.cal__tip')?.textContent || '').trim();
  })()`);
  check('★ 认领那天的悬停提示就是这一天，没有文章标题', tip === date, `${tip} / 期望 ${date}`);
}
await cdp.open('/');
check('★ 首页这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

/* ================================================================
 * ② 多篇认领同一天 → /day/<日期>/ 索引页（在临时副本里造第二篇，不动真仓库）
 * ================================================================ */
console.log('\n================ ② 多篇认领同一天 ================');
let copyBuilt = false;
try {
  fs.rmSync(COPY, { recursive: true, force: true });
  fs.mkdirSync(COPY, { recursive: true });
  for (const item of ['src', 'tools', 'package.json', 'astro.config.mjs', 'tsconfig.json', 'site.config.ts', '.gitignore', '.gitattributes']) {
    const from = path.join(SRC, item);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(COPY, item), { recursive: true });
  }
  for (const j of ['node_modules', 'public']) {
    try { execFileSync('cmd', ['/c', 'mklink', '/J', path.join(COPY, j), path.join(SRC, j)], { stdio: 'ignore' }); } catch { /* 已经有了 */ }
  }

  /* 造第二篇：和用户举的那个例子同一天（2026-10-04），也认领这一天 */
  const fixtureDate = [...claimed.keys()].find((d) => d.startsWith(calInfo.today.slice(0, 7))) ?? '2026-10-04';
  const fixture = `---\ntitle: 验收：同一天的第二篇\ndate: ${fixtureDate}\ndraft: false\ncalendar: true\n---\n\n这是验收脚本临时塞的第二篇（只在 .tmp 的副本里，真仓库没有这个文件）。\n`;
  fs.writeFileSync(path.join(COPY, 'src', 'content', 'notes', 'zz-verify-same-day.md'), fixture, 'utf8');

  const r = spawnSync(process.execPath, [path.join(COPY, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'build'],
    { cwd: COPY, encoding: 'utf8', timeout: 300000 });
  copyBuilt = fs.existsSync(path.join(COPY, 'dist', 'index.html'));
  check('★ 副本（多塞了一篇同一天的文章）构建成功', r.status === 0 && copyBuilt,
    `exit=${r.status} ${String(r.stderr || '').split('\n').filter(Boolean).slice(-1)[0] ?? ''}`);
} catch (err) {
  check('★ 副本构建', false, String(err.message ?? err).slice(0, 120));
}

if (copyBuilt) {
  serveRoot = path.join(COPY, 'dist');
  await cdp.open('/');
  const multi = await cdp.ev(`(() => {
    const cfg = JSON.parse(document.getElementById('cal-data').textContent || '{}');
    const days = cfg.days ?? {};
    const date = ${JSON.stringify([...claimed.keys()].find((d) => d.startsWith(calInfo.today.slice(0, 7))) ?? '2026-10-04')};
    const day = Number(date.slice(8));
    const el = [...document.querySelectorAll('.cal__day')].find((e) => (e.querySelector('.cal__num')?.textContent || '').trim() === String(day));
    return { date, info: days[date] ?? null, tag: el?.tagName ?? null, href: el?.getAttribute('href') ?? null };
  })()`);
  check('★★ 同一天有两篇之后，日历上那一天改指向 /day/<日期>/ 索引页',
    multi.info?.count === 2 && multi.href === `/day/${multi.date}/`,
    JSON.stringify(multi));
  const landed = await realClick(`[...document.querySelectorAll('.cal__day')].find((e) => (e.querySelector('.cal__num')?.textContent || '').trim() === '${Number(multi.date.slice(8))}')`);
  info(`索引页：${JSON.stringify(landed).slice(0, 200)}`);
  check('★★ 点下去真的进了「这一天」索引页', landed?.path === `/day/${multi.date}/`, String(landed?.path));
  check('★★ 索引页把这一天的文章**都**列出来了（两篇都在）',
    (landed?.listed?.length ?? 0) >= 2 && landed.listed.includes('验收：同一天的第二篇'),
    JSON.stringify(landed?.listed));
  check('★ 索引页标题写着是哪一天', /\d{4}-\d{2}-\d{2}/.test(landed?.h1 ?? ''), String(landed?.h1));
  check('★ 索引页有回首页的路', landed?.back === true);
  if (WANT_SHOTS) await cdp.shot('day-index', true);
  check('★ 索引页没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

  /* ================================================================
   * ③ 编辑器：勾选框 + 保存之后字段还在（白名单那类老毛病）
   * ================================================================ */
  console.log('\n================ ③ 编辑器里的那个勾 ================');
  const html = fs.readFileSync(path.join(COPY, 'tools', 'editor', 'ui', 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(COPY, 'tools', 'editor', 'ui', 'app.js'), 'utf8');
  check('★ 编辑器界面上日期旁边有「认领这一天」这个勾选框',
    /id="f-calendar"/.test(html) && /认领这一天/.test(html));
  check('★ 前端把它读进来、也写得出去',
    /calendar: \$\('f-calendar'\)/.test(appJs) && /els\.calendar\.checked = Boolean\(f\.calendar\)/.test(appJs)
    && /if \(els\.calendar\.checked\) fm\.calendar = true/.test(appJs));

  const editor = spawn(process.execPath, [path.join(COPY, 'tools', 'editor', 'server.mjs')], {
    cwd: COPY, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: String(EDITOR_PORT) },
  });
  let elog = '';
  editor.stdout.on('data', (b) => { elog += b.toString('utf8'); });
  editor.stderr.on('data', (b) => { elog += b.toString('utf8'); });
  let base = '';
  for (let i = 0; i < 100 && !base; i++) {
    await sleep(150);
    const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(elog);
    if (m) base = `http://127.0.0.1:${m[1]}`;
  }
  check('副本里的编辑器起来了', !!base, base || elog.slice(-120));
  if (base) {
    const file = 'zz-verify-same-day.md';
    const item = await (await fetch(`${base}/api/item?type=notes&file=${file}`)).json();
    check('★ 打开那篇时勾选状态是「已勾上」', item?.frontmatter?.calendar === true, JSON.stringify(item?.frontmatter));
    /* 用界面上的那套回存一遍（frontmatter 走的是白名单 normalize） */
    const saved = await fetch(`${base}/api/save`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'notes', file, rev: item?.rev ?? '', frontmatter: { ...item.frontmatter, calendar: true }, body: item?.body ?? '' }),
    }).then((r) => r.json());
    const raw = fs.readFileSync(path.join(COPY, 'src', 'content', 'notes', file), 'utf8');
    check('★★ 保存一次之后，文件里的 calendar: true 还在（没被白名单抹掉）',
      saved?.ok === true && /^calendar:\s*true\s*$/m.test(raw),
      `保存返回 ${JSON.stringify(saved).slice(0, 80)}`);
    /* 反向：不勾的时候不该多写一行 */
    await fetch(`${base}/api/save`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'notes', file, rev: '', frontmatter: { ...item.frontmatter, calendar: false }, body: item?.body ?? '' }),
    }).then((r) => r.json()).catch(() => null);
    const raw2 = fs.readFileSync(path.join(COPY, 'src', 'content', 'notes', file), 'utf8');
    check('★ 取消勾选之后，frontmatter 里不再留 calendar 这一行', !/^calendar:/m.test(raw2));
  }
  try { editor.kill(); } catch { /* 已经退了 */ }
}

/* ================================================================ */
try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch { /* 已经退了 */ }
server.close();
await sleep(200);
try {
  for (const j of ['node_modules', 'public']) {
    const p = path.join(COPY, j);
    if (fs.existsSync(p)) execFileSync('cmd', ['/c', 'rmdir', p], { stdio: 'ignore' });
  }
  fs.rmSync(COPY, { recursive: true, force: true });
  console.log(`副本已清理: ${!fs.existsSync(COPY)}`);
} catch (err) {
  console.log('副本没删干净（不影响结论）：', String(err.message ?? err).slice(0, 120));
}
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 删不掉就算了 */ }

console.log('\n================ 结果 ================');
console.log(`PASS ${pass}   FAIL ${fail}`);
if (fail > 0) process.exit(1);
