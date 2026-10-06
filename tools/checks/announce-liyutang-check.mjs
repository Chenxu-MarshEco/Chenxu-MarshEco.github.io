/*
 * ============================================================================
 * 「曼沫砾总线」+「黎语堂」两个新板块的验收（2026-10-06）
 * ----------------------------------------------------------------------------
 * 用户这一轮的要求：
 *   「在甬城晴雨下方 涣源溪水钟上方插入新板块：曼沫砾总线 这个板块是本站的公告栏
 *    可以在编辑器内填写公告 填写后最新的几条可以显示在这个板块内 而点开板块则可以
 *    看到所有的历史公告 公告分为两种：事项公告和更新提醒公告。事项公告应当和文章手记
 *    一样 可以编写具体的内容 在鼠标点击标题后直接进入这一页公告文章内容
 *    而更新公告则是只有标题和跳转链接」
 *   「在花娅陌域下方 冰室冰山和每日精华上方插入新板块：黎语堂 点进去以后是一个全新的
 *    黎语堂的首页 地址是 /liyutang 先暂时套用文章和笔记的背景 其他什么都不要放
 *    只留左上角的花涧堂logo以便回到花涧堂 别的都不要有」
 *   「……应当在花娅陌质流里加一个新按钮跳转到黎语堂相关的编辑管理上 但是在花涧堂编辑器
 *    的页面内可以管理黎语堂这个板块卡片的标题 副标题 背景图片」
 *
 * 量的是五段（每一段都落在真产物 / 真界面上，不靠"我觉得"）：
 *   ① 静数据：announcements.json 的规矩（两种公告字段互斥、日期合法、id 唯一）
 *   ② 站点产物（真跑一次构建，然后真浏览器打开）：首页四张卡的位置（DOM 顺序 +
 *      左右列对齐 + 上下先后）、公告条数和去向、/zongxian/ 全部历史、事项公告正文页、
 *      更新提醒**没有**自己的页（404）、/liyutang 是空壳（只有背景 + 徽记）
 *   ③ 编辑器「公告」面板：真点按钮 → 真填表 → 真保存 → 真构建，
 *      然后核对落盘的 JSON 和重新构建出来的那一页
 *   ④ 编辑器「黎语堂」面板：三样东西（标题 / 副标题 / 背景图）能改能存
 *   ⑤ 黎语堂自己的管理页 /liyutang-admin：能开、能加版块、能存（和编辑器分开的那套）
 *
 * 用法：node tools/checks/announce-liyutang-check.mjs
 *   —— 前三段会**真的构建两次**（真 dist 一次、副本里一~两次），跑一趟约两分钟。
 *      副本的 public 是**真副本**（不是 junction），所以整个脚本不会动真仓库的数据。
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const SRC = String.raw`D:\曼沫砾总线\Chenxu-MarshEco.github.io`;
const DST = path.join(SRC, '.tmp', 'announce-proj');
const PORT = 4389;
const DEBUG_PORT = 9371;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

/* ============================================================================
   ① 静数据：公告这份数据的规矩
   ============================================================================ */
const annFile = path.join(SRC, 'src', 'data', 'announcements.json');
const annRawText = fs.readFileSync(annFile, 'utf8');
const ann = JSON.parse(annRawText);
const annItems = Array.isArray(ann.items) ? ann.items : [];
const notices = annItems.filter((i) => i.kind !== 'update');
const updates = annItems.filter((i) => i.kind === 'update');

console.log('=== ① 公告数据（src/data/announcements.json）===');
info(`${annItems.length} 条：事项 ${notices.length} / 更新 ${updates.length}`);
check('数据里有 items 数组', Array.isArray(ann.items));
check('每一条都有 id / title / date', annItems.every((i) => i.id && i.title && /^\d{4}-\d{2}-\d{2}$/.test(i.date)));
check('id 不重复', new Set(annItems.map((i) => i.id)).size === annItems.length);
check(
  '事项公告有正文、没有跳转地址',
  notices.length > 0 && notices.every((i) => typeof i.body === 'string')
);
check('更新提醒有跳转地址、没有正文', updates.every((i) => !('body' in i) && typeof i.href === 'string'));
check('首页显示条数是 1~20 的整数', Number.isInteger(ann.latest) && ann.latest >= 1 && ann.latest <= 20, `latest=${ann.latest}`);

/* ============================================================================
   ② 站点产物：真构建一次，再真浏览器打开
   ============================================================================ */
if (!process.env.SKIP_BUILD) {
  console.log('\n=== 构建站点（真仓库）===');
  const t0 = Date.now();
  execSync('node tools/images/optimize.mjs', { cwd: SRC, stdio: 'ignore' });
  execSync('node node_modules/astro/bin/astro.mjs build', { cwd: SRC, stdio: 'ignore' });
  execSync('node tools/images/prune-dist.mjs', { cwd: SRC, stdio: 'ignore' });
  info(`构建完成，${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

const DIST = path.join(SRC, 'dist');
check('dist 里有 /zongxian/ 那一页', fs.existsSync(path.join(DIST, 'zongxian', 'index.html')));
check('dist 里有 /liyutang/ 那一页', fs.existsSync(path.join(DIST, 'liyutang', 'index.html')));
check(
  '每一条事项公告都有自己的页面',
  notices.every((i) => fs.existsSync(path.join(DIST, 'zongxian', i.id, 'index.html')))
);
check(
  '更新提醒**没有**自己的页面（点它直接跳走）',
  updates.every((i) => !fs.existsSync(path.join(DIST, 'zongxian', i.id)))
);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
};
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
    const f = path.join(DIST, t);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream' });
      return fs.createReadStream(f).pipe(res);
    }
  }
  res.writeHead(404);
  res.end('404');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = path.join(process.env.TEMP ?? '.', `dsh-ann-${Date.now()}`);
let chrome = spawn(CHROME, [
  '--headless=new',
  '--no-sandbox',
  '--mute-audio',
  '--disable-gpu',
  '--enable-unsafe-swiftshader',
  '--disable-breakpad',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${DEBUG_PORT}`,
  'about:blank',
], { stdio: 'ignore' });

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
      if (m.method === 'Runtime.exceptionThrown') {
        this.errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
      }
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
  async open(u, wait = 700) {
    this.errors = [];
    await this.send('Page.navigate', { url: u });
    for (let i = 0; i < 120; i++) {
      await sleep(120);
      if ((await this.ev('document.readyState')) === 'complete') break;
    }
    await sleep(wait);
  }
}

/** 真鼠标点一下：先确认那个元素在**这一点上是最上面的**（没被别的层盖住），再发按下/抬起 */
async function realClick(cdp, expr, label) {
  const box = await cdp.ev(`(() => {
    const el = ${expr};
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(x, y);
    return { x, y, hit: el === top || el.contains(top) || (top && top.contains(el)), tag: String(el.tagName), text: (el.textContent || '').trim().slice(0, 24) };
  })()`);
  if (!box) throw new Error(`找不到要点的东西：${label}`);
  if (!box.hit) throw new Error(`${label} 被别的元素盖住了（elementFromPoint 不是它）`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, button: 'none', clickCount: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  return box;
}

/** 按钮按文字找（在某个容器里） */
const btnByText = (scope, text) =>
  `[...document.querySelectorAll(${JSON.stringify(scope)})].find((b) => (b.textContent || '').trim() === ${JSON.stringify(text)})`;

let cdp = null;
try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {
      /* 还没起来 */
    }
  }
  cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  /* ---------------- 首页：四张卡的位置 ---------------- */
  console.log('\n=== ② 首页：两张新卡插对了地方 ===');
  const HOME = `http://127.0.0.1:${PORT}/`;
  await cdp.open(HOME, 1200);

  const geo = await cdp.ev(`(() => {
    const q = (s) => document.querySelector(s);
    const box = (s) => { const el = q(s); if (!el) return null; const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
    const order = [...document.querySelectorAll('.boards > .board')].map((b) => b.id);
    const kids = [...document.querySelectorAll('.extras__grid > *')].map((el) => el.id || el.className);
    return {
      yongcheng: box('#yongcheng'),
      huaya: box('#huaya'),
      announce: box('#home-announce'),
      liyutang: box('#home-liyutang'),
      cal: box('#home-cal'),
      ice: box('.ice'),
      daily: box('.dailyWrap'),
      boardIds: order,
      extraKids: kids,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rows: document.querySelectorAll('#home-announce .ann__row').length,
      rowHrefs: [...document.querySelectorAll('#home-announce .ann__row .ann__link')].map((a) => a.getAttribute('href') || '(不可点)'),
      more: (q('#home-announce .ann__more') || {}).getAttribute ? q('#home-announce .ann__more').getAttribute('href') : null,
      annTitleText: (q('#ann-title') || {}).textContent,
      lytHref: (q('#home-liyutang') || {}).getAttribute ? q('#home-liyutang').getAttribute('href') : null,
      lytTitle: (q('#home-liyutang .lyt__title') || {}).textContent,
      lytSub: (q('#home-liyutang .lyt__sub') || {}).textContent,
    };
  })()`);

  info(`两个大板块顺序：${geo.boardIds.join(' / ')}`);
  info(`新一屏的格子顺序：${geo.extraKids.join(' / ')}`);
  check('大板块那一行还是「甬城晴雨 / 花娅陌域」两块，顺序没变', geo.boardIds.join(',') === 'yongcheng,huaya');
  check(
    '新一屏第一行是「曼沫砾总线 + 黎语堂」，第二行才是日历和冰山/每日精华',
    geo.extraKids[0] === 'home-announce' &&
      geo.extraKids[1] === 'home-liyutang' &&
      geo.extraKids[2] === 'home-cal'
  );
  check(
    '曼沫砾总线在甬城晴雨**下面**、日历**上面**',
    geo.announce.top >= geo.yongcheng.bottom && geo.announce.bottom <= geo.cal.top,
    `甬城晴雨底 ${geo.yongcheng.bottom} ≤ 公告卡 ${geo.announce.top}..${geo.announce.bottom} ≤ 日历顶 ${geo.cal.top}`
  );
  check(
    '黎语堂在花娅陌域**下面**、冰室冰山/每日精华**上面**',
    geo.liyutang.top >= geo.huaya.bottom && geo.liyutang.bottom <= Math.min(geo.ice.top, geo.daily.top),
    `花娅陌域底 ${geo.huaya.bottom} ≤ 黎语堂 ${geo.liyutang.top}..${geo.liyutang.bottom} ≤ 冰山顶 ${geo.ice.top}`
  );
  check(
    '公告卡和甬城晴雨**同一列**（左边缘对齐）',
    Math.abs(geo.announce.left - geo.yongcheng.left) <= 2,
    `${geo.announce.left} vs ${geo.yongcheng.left}`
  );
  check(
    '黎语堂和花娅陌域**同一列**（左边缘对齐）',
    Math.abs(geo.liyutang.left - geo.huaya.left) <= 2,
    `${geo.liyutang.left} vs ${geo.huaya.left}`
  );
  check(
    '两张新卡一样高（同一行，底边齐平）',
    Math.abs(geo.announce.bottom - geo.liyutang.bottom) <= 2,
    `${geo.announce.bottom} vs ${geo.liyutang.bottom}`
  );
  check('加了这两块之后首页没有横向溢出', geo.overflow <= 1, `${geo.overflow}px`);
  check(
    '日历 / 冰山 / 每日精华三张还是挤在同一条横线上（没被新一行顶歪）',
    Math.abs(geo.cal.top - geo.ice.top) <= 2 && Math.abs(geo.cal.top - geo.daily.top) <= 2,
    `${geo.cal.top} / ${geo.ice.top} / ${geo.daily.top}`
  );

  /* ---------------- 首页：公告卡的条数和去向 ---------------- */
  const expectShown = Math.min(ann.latest, annItems.length);
  check('公告卡显示条数 = min(latest, 总条数)', geo.rows === expectShown, `${geo.rows} vs ${expectShown}`);
  check('公告卡标题 = 数据里的 title', geo.annTitleText === ann.title, `${geo.annTitleText}`);
  check('公告卡右上角「全部公告」指向 /zongxian/', geo.more === '/zongxian/', `${geo.more}`);
  check('黎语堂卡指向 /liyutang/', geo.lytHref === '/liyutang/', `${geo.lytHref}`);

  /* 每一条的去向：事项公告 -> /zongxian/<id>/；更新提醒 -> 它填的 href */
  const sorted = annItems
    .map((it, i) => ({ it, i }))
    .sort((a, b) => (a.it.date === b.it.date ? a.i - b.i : a.it.date < b.it.date ? 1 : -1))
    .map((x) => x.it)
    .slice(0, expectShown);
  const expectedHrefs = sorted.map((i) => (i.kind === 'update' ? i.href || '(不可点)' : `/zongxian/${i.id}/`));
  const gotHrefs = geo.rowHrefs.map((s) => s.split('|')[0]);
  check(
    '首页每一条公告的去向都对（事项进自己那页 / 更新直接跳）',
    gotHrefs.join(',') === expectedHrefs.join(','),
    `页面 ${gotHrefs.join(' , ')} ｜ 数据 ${expectedHrefs.join(' , ')}`
  );
  /* ---------------- /zongxian/ 全部历史 ---------------- */
  console.log('\n=== ② /zongxian/ 全部历史 ===');
  await cdp.open(`http://127.0.0.1:${PORT}/zongxian/`, 500);
  const board = await cdp.ev(`(() => {
    const rows = [...document.querySelectorAll('.alb__row')];
    return {
      rows: rows.length,
      months: [...document.querySelectorAll('.alb__month')].map((m) => m.textContent.trim()),
      noticeLinks: rows.filter((r) => r.dataset.announceKind === 'notice').map((r) => r.querySelector('a')?.getAttribute('href')),
      updateLinks: rows.filter((r) => r.dataset.announceKind === 'update').map((r) => r.querySelector('a')?.getAttribute('href')),
      lead: (document.querySelector('.alb__lead') || {}).textContent || '',
    };
  })()`);
  check('公告栏页把所有公告都列出来了', board.rows === annItems.length, `${board.rows} vs ${annItems.length}`);
  check(
    '按月分组（一个月一个小标题）',
    board.months.length === new Set(annItems.map((i) => i.date.slice(0, 7))).size,
    board.months.join(' / ')
  );
  check(
    '事项公告在公告栏页指向它自己那一页',
    board.noticeLinks.length === notices.length && board.noticeLinks.every((h) => /^\/zongxian\/[^/]+\/$/.test(h)),
    board.noticeLinks.join(' , ')
  );
  check(
    '更新提醒在公告栏页直接指向外部地址',
    board.updateLinks.length === updates.length &&
      board.updateLinks.every((h, i) => h === (updates[i].href || null)),
    board.updateLinks.join(' , ')
  );
  check('顶上那段话报了条数', board.lead.includes(String(annItems.length)), board.lead.trim().slice(0, 60));

  /* ---------------- 事项公告正文页 ---------------- */
  console.log('\n=== ② 事项公告正文页（和文章 / 手记一套皮）===');
  for (const item of notices) {
    await cdp.open(`http://127.0.0.1:${PORT}/zongxian/${item.id}/`, 400);
    const page = await cdp.ev(`(() => ({
      h1: (document.querySelector('h1') || {}).textContent || '',
      body: !!document.querySelector('.prose'),
      blocks: document.querySelectorAll('.prose > *').length,
      crt: !!document.querySelector('.crt'),
      crtScreen: !!document.querySelector('.crt-screen'),
      back: (document.querySelector('.notice__trailLink') || {}).getAttribute ? document.querySelector('.notice__trailLink').getAttribute('href') : null,
      all: (document.querySelector('.notice__back a') || {}).getAttribute ? document.querySelector('.notice__back a').getAttribute('href') : null,
    }))()`);
    check(`「${item.title}」这一页打得开、标题对`, page.h1 === item.title, page.h1);
    check(`「${item.title}」正文按 Markdown 渲染出来了`, page.body && page.blocks > 0, `${page.blocks} 个块`);
    check(`「${item.title}」用的是文章 / 手记那套 CRT 皮`, page.crt && page.crtScreen);
    check(`「${item.title}」能回公告栏`, page.back === '/zongxian/' && page.all === '/zongxian/');
  }
  for (const item of updates) {
    const r = await fetch(`http://127.0.0.1:${PORT}/zongxian/${item.id}/`);
    check(`更新提醒「${item.title}」没有自己的页面（404）`, r.status === 404, `HTTP ${r.status}`);
  }

  /* ---------------- /liyutang：空壳 ---------------- */
  console.log('\n=== ② /liyutang：只有背景和左上角徽记 ===');
  await cdp.open(`http://127.0.0.1:${PORT}/liyutang/`, 500);
  const lyt = await cdp.ev(`(() => {
    const main = document.querySelector('main');
    const brand = document.querySelector('.forum__brand');
    const inner = main ? [...main.querySelectorAll('*')].map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, w: Math.round(r.width), h: Math.round(r.height), cls: String(el.className) };
    }) : [];
    const visible = inner.filter((x) => x.w > 2 || x.h > 2);
    return {
      hasHeader: !!document.querySelector('.site-header'),
      hasFooter: !!document.querySelector('.site-footer'),
      hasDrawer: !!document.querySelector('.corner') || !!document.querySelector('.drawer'),
      crt: !!document.querySelector('.crt'),
      brandHref: brand ? brand.getAttribute('href') : null,
      brandTop: brand ? Math.round(brand.getBoundingClientRect().top) : -1,
      brandLeft: brand ? Math.round(brand.getBoundingClientRect().left) : -1,
      mainKids: main ? main.children.length : -1,
      mainText: main ? (main.textContent || '').trim() : '',
      visibleCount: visible.length,
      visible,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`);
  check('/liyutang 有文章 / 手记那套背景（CRT 层在）', lyt.crt);
  check('/liyutang 没有站点页头 / 页脚 / 目录栏', !lyt.hasHeader && !lyt.hasFooter && !lyt.hasDrawer);
  check('左上角只有那颗花涧堂徽记，点它回首页', lyt.brandHref === '/', `${lyt.brandHref}`);
  check('徽记贴在左上角', lyt.brandTop >= 0 && lyt.brandTop < 60 && lyt.brandLeft >= 0 && lyt.brandLeft < 60, `top ${lyt.brandTop} / left ${lyt.brandLeft}`);
  check('页面上一个**看得见**的元素都没有（读屏用的标题不算）', lyt.visibleCount === 0, JSON.stringify(lyt.visible));
  check('/liyutang 没有横向溢出', lyt.overflow <= 1, `${lyt.overflow}px`);
  check('没有 console 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

  /* ---------------- 搜索索引 ---------------- */
  const searchIdx = JSON.parse(fs.readFileSync(path.join(DIST, 'search.json'), 'utf8'));
  const hasUrl = (u) => searchIdx.items.some((it) => it.h.replace(/\/$/, '') === u.replace(/\/$/, ''));
  check('搜索索引里有公告栏那一页', hasUrl('/zongxian/'));
  check('搜索索引里有每一条事项公告', notices.every((i) => hasUrl(`/zongxian/${i.id}/`)));
  check(
    '搜索索引里**暂时**没有空的 /liyutang（论坛内容长出来之后再收）',
    !hasUrl('/liyutang/')
  );
} catch (err) {
  fail++;
  console.log('FAIL  站点那一段异常: ' + (err?.stack ?? err));
} finally {
  try {
    execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' });
  } catch {
    /* 已经退了 */
  }
  server.close();
  await sleep(200);
}

/* ============================================================================
   ③④⑤ 编辑器：真副本 + 真界面
   ============================================================================ */
function rmCopy() {
  if (!fs.existsSync(DST)) return;
  const j = path.join(DST, 'node_modules');
  if (fs.existsSync(j)) {
    try {
      execSync(`cmd /c rmdir "${j}"`, { stdio: 'ignore' });
    } catch {
      /* 不是 junction */
    }
  }
  fs.rmSync(DST, { recursive: true, force: true });
}

let editor = null;
try {
  console.log('\n=== ③④⑤ 编辑器（副本，不写真仓库）===');
  rmCopy();
  const skip = new Set(['node_modules', 'dist', '.git', '.tmp']);
  fs.mkdirSync(DST, { recursive: true });
  for (const e of fs.readdirSync(SRC, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    fs.cpSync(path.join(SRC, e.name), path.join(DST, e.name), { recursive: true });
  }
  /* 只 junction node_modules；public 是**真副本**，所以构建出来的东西不会写回真仓库 */
  execSync(`cmd /c mklink /J "${path.join(DST, 'node_modules')}" "${path.join(SRC, 'node_modules')}"`, { stdio: 'ignore' });
  info('副本就绪：' + DST);

  editor = spawn(process.execPath, [path.join(DST, 'tools', 'editor', 'server.mjs')], {
    cwd: DST,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let elog = '';
  editor.stdout.on('data', (b) => {
    elog += b.toString('utf8');
  });
  editor.stderr.on('data', (b) => {
    elog += b.toString('utf8');
  });
  let base = '';
  for (let i = 0; i < 400 && !base; i++) {
    await sleep(150);
    const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(elog);
    if (m) base = `http://127.0.0.1:${m[1]}`;
  }
  if (!base) throw new Error('编辑器没起来：' + elog.slice(-400));
  info('副本编辑器在 ' + base);

  const profile2 = path.join(process.env.TEMP ?? '.', `dsh-annp-${Date.now()}`);
  chrome = spawn(CHROME, [
    '--headless=new',
    '--no-sandbox',
    '--mute-audio',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
    '--disable-breakpad',
    `--user-data-dir=${profile2}`,
    `--remote-debugging-port=${DEBUG_PORT + 1}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let t2 = null;
  for (let i = 0; i < 60 && !t2; i++) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT + 1}/json/list`)).json();
      t2 = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {
      /* 等 */
    }
  }
  cdp = await CDP.attach(t2.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

  /*
    填一个 wrow（按标签文字找控件）—— 和真人一样只发 input 事件。

    ⚠ scope 必须指到**那张表单**（#ann-editor .wann__form），不能指整个面板：
    面板顶上「这一块」那块里也有一个「标题」（那是公告栏自己的名字），
    范围放宽了会填到它上面去 —— 表单里的标题还是空的，点「加上这一条」会被挡回来
    （第一版就是这么红的：清单里一条没多、盘上却多了一次"改了名字"的保存）。
  */
  const setField = async (label, tag, value, scope) => {
    const r = await cdp.ev(`(() => {
      for (const row of document.querySelectorAll(${JSON.stringify(scope)} + ' .wrow')) {
        const l = row.querySelector('.wrow__label');
        if (l && l.textContent.trim() === ${JSON.stringify(label)}) {
          const el = row.querySelector(${JSON.stringify(tag)});
          if (!el) return 'no-control';
          el.focus();
          el.value = ${JSON.stringify(value)};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return 'ok';
        }
      }
      return 'no-row';
    })()`);
    if (r !== 'ok') throw new Error(`填「${label}」失败：${r}（范围 ${scope}）`);
  };
  const ANN_FORM = '#ann-editor .wann__form';

  /* ---------------- ③ 公告面板 ---------------- */
  console.log('\n=== ③ 编辑器「公告」面板 ===');
  await cdp.open(`${base}/`, 1500);
  const api0 = await (await fetch(`${base}/api/announcements`)).json();
  check('接口 /api/announcements 读得到数据', Array.isArray(api0.items) && api0.items.length === annItems.length, `${api0.items?.length} 条`);

  await cdp.ev(`window.__openWs('announce')`, 0);
  await sleep(900);
  const panel0 = await cdp.ev(`(() => {
    const modal = document.getElementById('announce-modal');
    return {
      open: modal && !modal.hidden,
      rows: document.querySelectorAll('#ann-editor .wann__row').length,
      kinds: [...document.querySelectorAll('#ann-editor .wann__kind')].map((k) => k.textContent.trim()),
      books: [...document.querySelectorAll('#ann-editor .wbox__title')].map((t) => t.textContent.trim()),
      hasForm: !!document.querySelector('#ann-editor .wann__form'),
      saveBtn: !![...document.querySelectorAll('#ann-editor button')].find((b) => b.textContent.trim() === '保存并重新构建'),
    };
  })()`);
  check('「公告」面板打得开', panel0.open === true);
  check('面板里列出了全部公告', panel0.rows === annItems.length, `${panel0.rows} vs ${annItems.length}`);
  check('两种公告的标签都在（事项公告 / 更新提醒）', panel0.kinds.includes('事项公告') && panel0.kinds.includes('更新提醒'), panel0.kinds.join(' / '));
  check('面板有「保存并重新构建」', panel0.saveBtn === true);

  /* 新增一条**事项公告**（真点按钮 → 真填表 → 真保存） */
  await realClick(cdp, btnByText('#ann-editor button', '＋ 事项公告'), '＋ 事项公告');
  await sleep(400);
  const form = await cdp.ev(`(() => {
    const f = document.querySelector('#ann-editor .wann__form');
    return {
      has: !!f,
      rows: f ? [...f.querySelectorAll('.wrow__label')].map((l) => l.textContent.trim()) : [],
      dateField: !!(f && f.querySelector('.datefield')),
      kindOptions: f ? [...f.querySelectorAll('select option')].map((o) => o.value) : [],
    };
  })()`);
  check('点「＋ 事项公告」开出表单', form.has === true);
  check(
    '表单里有 类型 / 标题 / 日期 / 正文 四项',
    ['类型', '标题', '日期', '正文'].every((k) => form.rows.includes(k)),
    form.rows.join(' / ')
  );
  check('日期用的是那个日期控件（dateField）', form.dateField === true);
  check('类型下拉里两种公告都在', form.kindOptions.join(',') === 'notice,update', form.kindOptions.join(','));

  const NEW_TITLE = '验收：总线开张告示';
  const NEW_BODY = '## 这一条是验收写的\n\n- 第一条\n- 第二条\n\n**加粗**也在。';
  await setField('标题', 'input.input', NEW_TITLE, ANN_FORM);
  await setField('正文', 'textarea', NEW_BODY, ANN_FORM);
  await realClick(cdp, btnByText('#ann-editor button', '加上这一条'), '加上这一条');
  await sleep(400);
  const afterAdd = await cdp.ev(`document.querySelectorAll('#ann-editor .wann__row').length`);
  check('「加上这一条」之后清单里多了一行', afterAdd === annItems.length + 1, `${afterAdd}`);
  check(
    '填表没有误改到面板顶上那个「标题」（公告栏自己的名字）',
    (await cdp.ev(`(document.querySelector('#ann-editor input.input') || {}).value || ''`)) === ann.title,
    await cdp.ev(`(document.querySelector('#ann-editor input.input') || {}).value || ''`)
  );

  await realClick(cdp, btnByText('#ann-editor button', '保存并重新构建'), '保存并重新构建');
  let saved = '';
  for (let i = 0; i < 400; i++) {
    await sleep(400);
    saved = await cdp.ev(`(document.querySelector('#ann-editor .wpanel__status') || {}).textContent || ''`);
    if (/已保存并重新构建|已保存，但重新构建没成功|出错了/.test(saved)) break;
  }
  check('保存成功并且重新构建了', /已保存并重新构建/.test(saved), saved.trim());

  const copyAnn = JSON.parse(fs.readFileSync(path.join(DST, 'src', 'data', 'announcements.json'), 'utf8'));
  const added = copyAnn.items.find((i) => i.title === NEW_TITLE);
  check('副本里的 announcements.json 多了一条', copyAnn.items.length === annItems.length + 1, `${copyAnn.items.length}`);
  check('公告栏自己的名字没被顺手改掉', copyAnn.title === ann.title, copyAnn.title);
  check('新那一条自动拿到了 id', !!added && /^an-\d{8}-/.test(added.id), added?.id ?? '(没有这一条)');
  check('新那一条的正文原样存下来了', !!added && added.body === NEW_BODY);
  check('新那一条是事项公告（有正文、没有 href）', !!added && added.kind === 'notice' && !('href' in added));
  check('新那一条的日期是今天', !!added && /^\d{4}-\d{2}-\d{2}$/.test(added.date), added?.date);
  check(
    '写回文件时按日期倒序排好了',
    copyAnn.items.every((it, i) => i === 0 || copyAnn.items[i - 1].date >= it.date)
  );
  check('updated 盖成了今天', /^\d{4}-\d{2}-\d{2}$/.test(copyAnn.updated), copyAnn.updated);

  /* 真的重新构建出来了：新公告那一页 + 首页上多了这一条 */
  const newPage = added ? path.join(DST, 'dist', 'zongxian', added.id, 'index.html') : '';
  let builtPage = false;
  if (newPage) {
    for (let i = 0; i < 90 && !builtPage; i++) {
      await sleep(1000);
      builtPage = fs.existsSync(newPage);
    }
  }
  check('重新构建出来的 dist 里有这条新公告的页面', builtPage, `dist/zongxian/${added?.id ?? '?'}/index.html`);
  if (builtPage) {
    const html = fs.readFileSync(newPage, 'utf8');
    check('新公告页的标题是刚写的那个', html.includes(NEW_TITLE));
    check('新公告页把 Markdown 的小标题渲染成了 h2', /<h2[^>]*>这一条是验收写的<\/h2>/.test(html));
    check('新公告页把 Markdown 的列表渲染成了 ul/li', /<ul>[\s\S]*?<li>第一条<\/li>/.test(html));
    const homeHtml = fs.readFileSync(path.join(DST, 'dist', 'index.html'), 'utf8');
    check('首页那一块也跟着出现了这一条', homeHtml.includes(NEW_TITLE));
  }

  /* 再新增一条**更新提醒**：只有标题和链接，站点上不该生成页面 */
  console.log('\n=== ③ 更新提醒：只有标题和去处 ===');
  await realClick(cdp, btnByText('#ann-editor button', '＋ 更新提醒'), '＋ 更新提醒');
  await sleep(400);
  const upForm = await cdp.ev(`(() => {
    const f = document.querySelector('#ann-editor .wann__form');
    return { rows: f ? [...f.querySelectorAll('.wrow__label')].map((l) => l.textContent.trim()) : [] };
  })()`);
  check('更新提醒的表单里没有「正文」，换成「跳转地址」', upForm.rows.includes('跳转地址') && !upForm.rows.includes('正文'), upForm.rows.join(' / '));
  const UP_TITLE = '验收：九月精华已更新';
  await setField('标题', 'input.input', UP_TITLE, ANN_FORM);
  await setField('跳转地址', 'input.input', '/salon/', ANN_FORM);
  await realClick(cdp, btnByText('#ann-editor button', '加上这一条'), '加上这一条（更新提醒）');
  await sleep(300);
  await realClick(cdp, btnByText('#ann-editor button', '保存并重新构建'), '保存并重新构建（第二次）');
  saved = '';
  for (let i = 0; i < 400; i++) {
    await sleep(400);
    saved = await cdp.ev(`(document.querySelector('#ann-editor .wpanel__status') || {}).textContent || ''`);
    if (/已保存并重新构建|已保存，但重新构建没成功|出错了/.test(saved)) break;
  }
  check('第二次保存也成功', /已保存并重新构建/.test(saved), saved.trim());
  const copyAnn2 = JSON.parse(fs.readFileSync(path.join(DST, 'src', 'data', 'announcements.json'), 'utf8'));
  const addedUp = copyAnn2.items.find((i) => i.title === UP_TITLE);
  check('更新提醒存下来了（有 href、没有正文）', !!addedUp && addedUp.kind === 'update' && addedUp.href === '/salon/' && !('body' in addedUp));
  check('更新提醒**没有**自己的页面', !!addedUp && !fs.existsSync(path.join(DST, 'dist', 'zongxian', addedUp.id)));

  /* ---------------- ④ 黎语堂面板（首页那张卡） ---------------- */
  console.log('\n=== ④ 编辑器「黎语堂」面板（只管卡片这一张皮）===');
  await cdp.ev(`window.__openWs('liyutang')`, 0);
  await sleep(900);
  const lytPanel = await cdp.ev(`(() => {
    const modal = document.getElementById('liyutang-modal');
    return {
      open: modal && !modal.hidden,
      labels: [...document.querySelectorAll('#lyt-editor .wrow__label')].map((l) => l.textContent.trim()),
      imgSlot: !!document.querySelector('#lyt-editor .wimg'),
      forumBtn: !![...document.querySelectorAll('#lyt-editor button')].find((b) => b.textContent.includes('黎语堂管理')),
    };
  })()`);
  check('「黎语堂」面板打得开', lytPanel.open === true);
  check(
    '三样东西都在：标题 / 副标题 / 背景图',
    lytPanel.labels.includes('标题') && lytPanel.labels.includes('副标题') && lytPanel.imgSlot,
    lytPanel.labels.join(' / ')
  );
  check('面板里有一条去路（打开黎语堂管理）', lytPanel.forumBtn === true);

  const NEW_SUB = '验收写的副标题';
  await setField('副标题', 'input.input', NEW_SUB, '#lyt-editor');
  await realClick(cdp, btnByText('#lyt-editor button', '保存并重新构建'), '保存并重新构建（黎语堂卡片）');
  saved = '';
  for (let i = 0; i < 400; i++) {
    await sleep(400);
    saved = await cdp.ev(`(document.querySelector('#lyt-editor .wpanel__status') || {}).textContent || ''`);
    if (/已保存并重新构建|已保存，但重新构建没成功|出错了/.test(saved)) break;
  }
  check('黎语堂卡片保存成功', /已保存并重新构建/.test(saved), saved.trim());
  const copyWidgets = JSON.parse(fs.readFileSync(path.join(DST, 'src', 'data', 'home-widgets.json'), 'utf8'));
  check('home-widgets.json 的 liyutang 块存对了', copyWidgets.liyutang?.subtitle === NEW_SUB, JSON.stringify(copyWidgets.liyutang));
  check('存卡片时没有把别的块弄丢（about / calendar / iceberg / daily 都还在）',
    ['about', 'calendar', 'iceberg', 'daily'].every((k) => !!copyWidgets[k]));
  const copyHome = fs.readFileSync(path.join(DST, 'dist', 'index.html'), 'utf8');
  check('重新构建之后首页那张卡上的副标题变了', copyHome.includes(NEW_SUB));

  /* ---------------- ⑤ 黎语堂自己的管理页 ---------------- */
  console.log('\n=== ⑤ 黎语堂管理页（/liyutang-admin，和编辑器分开）===');
  await cdp.open(`${base}/liyutang-admin`, 900);
  const admin = await cdp.ev(`(() => ({
    title: document.title,
    boards: !!document.getElementById('lt-boards-box'),
    forum: !!document.getElementById('lt-forum-box'),
    providers: [...document.querySelectorAll('#lt-forum-box select option')].map((o) => o.value),
    giscusFields: [...document.querySelectorAll('#lt-forum-box .lt-field label')].map((l) => l.textContent.trim()),
    addBoard: !![...document.querySelectorAll('#lt-boards-box button')].find((b) => b.textContent.includes('新增版块')),
    status: (document.getElementById('lt-status') || {}).textContent || '',
    links: [...document.querySelectorAll('.lytadmin__acts button')].map((b) => b.textContent.trim()),
  }))()`);
  check('管理页打得开', admin.title.includes('黎语堂') && admin.boards && admin.forum, admin.title);
  check(
    '评论系统三种选择都在，而且默认是 Waline（要邮箱注册，不用 GitHub 账号）',
    admin.providers.join(',') === 'waline,giscus,none',
    admin.providers.join(',')
  );
  check(
    '默认这一套（Waline）要填的就是一个服务地址',
    admin.giscusFields.includes('服务地址'),
    admin.giscusFields.join(' / ')
  );
  check('有「＋ 新增版块」', admin.addBoard === true);
  check('读取成功', /读取完成/.test(admin.status), admin.status.trim());
  check(
    '有两个出口（打开站点那一页 / 回编辑器）',
    admin.links.some((t) => t.includes('/liyutang/')) && admin.links.some((t) => t.includes('回到花涧堂编辑器')),
    admin.links.join(' / ')
  );

  /*
    ---- 评论系统：Waline 的自检 ----
    真去请求一个服务。这里起一个**假 Waline**（/ui/register 返回 200 且正文带 waline 字样），
    这样"自检说通了"这件事是可验的；再指向一个没人听的端口，看它会不会如实说"连不上"。
  */
  console.log('\n=== ⑤ 评论系统自检（假 Waline + 一个死端口）===');
  const stub = http.createServer((req, res) => {
    if (req.url && req.url.startsWith('/ui/register')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>Waline</title><body>register</body>');
      return;
    }
    res.writeHead(404);
    res.end('no');
  });
  const STUB_PORT = 4398;
  await new Promise((r) => stub.listen(STUB_PORT, '127.0.0.1', r));
  /* 这个假服务不用收尾：脚本最后是 process.exit，unref 一下免得它拖着事件循环 */
  stub.unref();

  const setWalineURL = async (url) => {
    const r = await cdp.ev(`(() => {
      for (const row of document.querySelectorAll('#lt-forum-box .lt-field')) {
        const l = row.querySelector('label');
        if (l && l.textContent.trim() === '服务地址') {
          const el = row.querySelector('input');
          el.focus(); el.value = ${JSON.stringify(url)}; el.dispatchEvent(new Event('input', { bubbles: true }));
          return 'ok';
        }
      }
      return 'no-row';
    })()`);
    if (r !== 'ok') throw new Error('填服务地址失败：' + r);
  };

  await setWalineURL(`http://127.0.0.1:${STUB_PORT}`);
  await realClick(cdp, btnByText('#lt-forum-box button', '自检连通'), '自检连通（假 Waline）');
  let chk = '';
  for (let i = 0; i < 60; i++) {
    await sleep(400);
    chk = await cdp.ev(`(() => {
      const p = [...document.querySelectorAll('#lt-forum-box .lt-sub')].map((x) => x.textContent).join(' | ');
      return p;
    })()`);
    if (/服务通了|连不上|不是 200|自检本身出错/.test(chk)) break;
  }
  check('自检：指向一个真在跑的 Waline 时，它说「通」（并报出状态码和耗时）', /服务通了/.test(chk) && /HTTP 200/.test(chk), chk.slice(-160));
  check('自检：还认得出"看起来就是 Waline"', /看起来就是 Waline/.test(chk), chk.slice(-160));

  await setWalineURL('http://127.0.0.1:4399');
  await realClick(cdp, btnByText('#lt-forum-box button', '自检连通'), '自检连通（死端口）');
  for (let i = 0; i < 60; i++) {
    await sleep(400);
    chk = await cdp.ev(`[...document.querySelectorAll('#lt-forum-box .lt-sub')].map((x) => x.textContent).join(' | ')`);
    if (/服务通了|连不上|不是 200|自检本身出错/.test(chk)) break;
  }
  check('自检：指向一个没人听的端口时，它如实说「连不上」（不假装成功）', /连不上/.test(chk), chk.slice(-160));

  /* 切到 Giscus 看看那四个值还在不在，再切回来（默认那条路才是 Waline） */
  await cdp.ev(`(() => {
    const sel = document.querySelector('#lt-forum-box select');
    sel.value = 'giscus'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(300);
  const giscusFields = await cdp.ev(`[...document.querySelectorAll('#lt-forum-box .lt-field label')].map((l) => l.textContent.trim())`);
  check(
    '切成 Giscus 之后，那四个值（仓库 / 仓库 ID / 分类 / 分类 ID）照样有地方填',
    ['仓库', '仓库 ID', 'Discussion 分类', '分类 ID'].every((k) => giscusFields.includes(k)),
    giscusFields.join(' / ')
  );
  /* 切回 Waline，并把地址留成那个假服务：下面保存时顺带验一下这个字段真的写盘了 */
  await cdp.ev(`(() => {
    const sel = document.querySelector('#lt-forum-box select');
    sel.value = 'waline'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(300);
  await setWalineURL(`http://127.0.0.1:${STUB_PORT}`);

  await realClick(cdp, btnByText('#lt-boards-box button', '＋ 新增版块'), '＋ 新增版块');
  await sleep(300);
  await cdp.ev(`(() => {
    const el = document.querySelector('#lt-boards-box .lt-board__title');
    el.focus(); el.value = '验收版块'; el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await realClick(cdp, `document.getElementById('lt-save')`, '保存并重新构建（黎语堂管理页）');
  let astat = '';
  for (let i = 0; i < 400; i++) {
    await sleep(400);
    astat = await cdp.ev(`(document.getElementById('lt-status') || {}).textContent || ''`);
    if (/已保存并重新构建|已保存，但重新构建没成功|出错了/.test(astat)) break;
  }
  check('管理页保存成功', /已保存并重新构建/.test(astat), astat.trim());
  const copyLyt = JSON.parse(fs.readFileSync(path.join(DST, 'src', 'data', 'liyutang.json'), 'utf8'));
  check('liyutang.json 里多了一个版块', copyLyt.boards.length === 1 && copyLyt.boards[0].title === '验收版块', JSON.stringify(copyLyt.boards));
  check('版块自动拿到了 id', /^bd-[0-9a-f]+$/.test(copyLyt.boards[0].id || ''), copyLyt.boards[0].id);
  check(
    'Waline 那个服务地址真的写盘了',
    copyLyt.forum?.waline?.serverURL === `http://127.0.0.1:${STUB_PORT}`,
    JSON.stringify(copyLyt.forum?.waline)
  );
  check('provider 存成了 waline（认不出来的才会退回默认）', copyLyt.forum?.provider === 'waline', copyLyt.forum?.provider);
  check('_readme 说明书没被冲掉', Array.isArray(copyLyt._readme) && copyLyt._readme.length > 5);
  check(
    '管理页**没有**碰花涧堂那边任何东西（announcements / home-widgets 时间和上面写的一致）',
    JSON.parse(fs.readFileSync(path.join(DST, 'src', 'data', 'home-widgets.json'), 'utf8')).liyutang.subtitle === NEW_SUB
  );

  /* ---------------- 真仓库一个字节都没动 ---------------- */
  console.log('\n=== 收尾：真仓库没被动过 ===');
  check('真仓库的 announcements.json 还是原样', fs.readFileSync(annFile, 'utf8') === annRawText);
  check(
    '真仓库的 liyutang.json 还是原样（boards 是空的）',
    JSON.parse(fs.readFileSync(path.join(SRC, 'src', 'data', 'liyutang.json'), 'utf8')).boards.length === 0
  );
} catch (err) {
  fail++;
  console.log('FAIL  编辑器那一段异常: ' + (err?.stack ?? err));
} finally {
  if (chrome) {
    try {
      execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      /* 已经退了 */
    }
  }
  if (editor) {
    try {
      execSync(`taskkill /pid ${editor.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      /* 已经退了 */
    }
  }
  rmCopy();
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
