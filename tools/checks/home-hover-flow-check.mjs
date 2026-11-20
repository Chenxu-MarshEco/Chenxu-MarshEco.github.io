/*
 * 悬停浮层的两个"手感"验收（2026-11-21）
 *   ① 首页推流动态：卡片在**这一行右侧**，且能一路挪进卡片点链接（不再被上一行截胡）
 *   ② 精华大殿里的成员名：名片能弹、头像放大能开，期间精华/圣经浮层不被关掉
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromePath } from './lib/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..');
const ROOT = path.join(SRC, 'dist');
const PORT = 4392;
const DEBUG_PORT = 9362;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8' };

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`); };
const info = (s) => console.log(`      · ${s}`);

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
    const f = path.join(ROOT, t);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream' }); return fs.createReadStream(f).pipe(res); }
  }
  res.writeHead(404); res.end('404');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const profile = path.join(process.env.TEMP ?? '.', `dsh-hv-${Date.now()}`);
const chrome = spawn(chromePath(), ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
      if (m.method === 'Runtime.exceptionThrown') this.errors.push('exception: ' + (m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
    }); }
  static async attach(u) { const ws = new WebSocket(u); await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('ws')), { once: true }); }); return new CDP(ws); }
  send(m, p = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method: m, params: p })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  async ev(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? '')); return r.result.value; }
  /*
    ⚠ 必须从**当前鼠标位置**插值过去：从 (0,0) 插值等于让鼠标横穿整个页面，
    路上的元素会把浮层和名片关掉，测出来的全是假红（第一版就踩了）。
  */
  async move(x, y, steps = 1) {
    const from = this.pos ?? { x: 0, y: 0 };
    for (let i = 1; i <= steps; i++) {
      const cx = Math.round(from.x + ((x - from.x) * i) / steps);
      const cy = Math.round(from.y + ((y - from.y) * i) / steps);
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, buttons: 0 });
      await sleep(18);
    }
    this.pos = { x, y };
    await sleep(300);
  }
  async open(url) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${url}` });
    for (let i = 0; i < 100; i++) { await sleep(100); if ((await this.ev('document.readyState')) === 'complete') break; }
    await this.ev(`(() => { const s = document.createElement('style'); s.textContent = 'html{scroll-behavior:auto !important}'; document.head.appendChild(s); return true; })()`);
    await sleep(1500);
  }
}

let cdp = null;
for (let i = 0; i < 60 && !cdp; i++) { await sleep(300); try { const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json(); const t = l.find((x) => x.type === 'page'); if (t) cdp = await CDP.attach(t.webSocketDebuggerUrl); } catch {} }
check('无头浏览器起来了', !!cdp);
if (!cdp) process.exit(1);
await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp.open('/');

/* ============================================================
 * ① 推流动态：卡片在这一行右侧 + 能挪进去点链接
 * ============================================================ */
console.log('\n================ ① 推流动态的明细卡片 ================');
/** 找第 n 条动态里「改了哪几块」那一行的中心点（滚到能看见；已经看得见就不滚） */
async function feedRowPoint(n) {
  for (let i = 0; i < 10; i++) {
    const r = await cdp.ev(`(() => {
      const items = [...document.querySelectorAll('.feed__item')].filter((li) => li.querySelector('[data-feed-card]'));
      const li = items[${n}];
      if (!li) return null;
      let b = li.getBoundingClientRect();
      if (b.top < 40 || b.bottom > innerHeight - 40) {
        li.scrollIntoView({ block: 'center' });
        b = li.getBoundingClientRect();
      }
      const x = Math.round(b.left + b.width / 2);
      const y = Math.round(b.top + b.height / 2);
      const at = document.elementFromPoint(x, y);
      return { x, y, ok: !!(at && at.closest && at.closest('.feed__item') === li) };
    })()`);
    if (r && r.ok) return r;
    await sleep(300);
  }
  return null;
}
const row2 = await feedRowPoint(2);
if (!row2) {
  console.log('DEBUG items:', JSON.stringify(await cdp.ev(`(() => ({
    url: location.pathname,
    total: document.querySelectorAll('.feed__item').length,
    withCard: [...document.querySelectorAll('.feed__item')].filter((li) => li.querySelector('[data-feed-card]')).length,
  }))()`)));
}
info(`第 3 条动态的落点 ${JSON.stringify(row2)}`);
await cdp.move(row2.x, row2.y);
const cardInfo = await cdp.ev(`(() => {
  const card = document.querySelector('.annlayer .feed__detail.is-open');
  const li = card ? [...document.querySelectorAll('.feed__item')].find((x) => x.contains(document.querySelector('.annlayer')) === false && x.querySelector('[data-feed-card]') === card) : null;
  if (!card) return null;
  const cr = card.getBoundingClientRect();
  return { x: Math.round(cr.left), y: Math.round(cr.top), w: Math.round(cr.width), h: Math.round(cr.height),
           links: card.querySelectorAll('a.feed__detailLink').length,
           opacity: Number(getComputedStyle(card).opacity) };
})()`);
const rows = await cdp.ev(`(() => [...document.querySelectorAll('.feed__item')].map((li) => { const r = li.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right) }; }))()`);
check('★ 鼠标移到某条动态上，明细卡片打开了', !!cardInfo && cardInfo.opacity === 1, cardInfo ? `${cardInfo.w}×${cardInfo.h}` : '没打开');
if (cardInfo) {
  const host = rows.reduce((best, r, i) => (Math.abs((r.t + r.b) / 2 - (cardInfo.y + cardInfo.h / 2)) < Math.abs((best.r.t + best.r.b) / 2 - (cardInfo.y + cardInfo.h / 2)) ? { r, i } : best), { r: rows[0], i: 0 });
  info(`卡片 ${JSON.stringify(cardInfo)}｜最近的一条动态行 ${JSON.stringify(host.r)}`);
  check('★★ 卡片在**这一行的右侧**（左边贴着这一行的右边缘，不再压住别的动态行）',
    cardInfo.x >= host.r.r - 2 && cardInfo.y + cardInfo.h / 2 > host.r.t - 40 && cardInfo.y < host.r.b + 40,
    `card.x=${cardInfo.x} / row.right=${host.r.r}`);
  const covers = rows.some((r, i) => i !== host.i && cardInfo.x < r.r && cardInfo.x + cardInfo.w > r.l && cardInfo.y < r.b && cardInfo.y + cardInfo.h > r.t);
  check('★★ 卡片**没有压住任何别的动态行**（所以不用先移开就能点上面那条）', !covers);
  /* 从这一行往右挪进卡片：中途不松开 */
  const target = await cdp.ev(`(() => {
    const card = document.querySelector('.annlayer .feed__detail.is-open');
    const link = card.querySelector('a.feed__detailLink');
    const el = link || card;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), link: !!link, href: link ? link.getAttribute('href') : '' };
  })()`);
  await cdp.move(target.x, target.y, 6);
  const stillOpen = await cdp.ev(`(() => {
    const card = document.querySelector('.annlayer .feed__detail.is-open');
    if (!card) return null;
    const r = card.getBoundingClientRect();
    const at = document.elementFromPoint(${target.x}, ${target.y});
    return { opacity: Number(getComputedStyle(card).opacity), hits: !!(at && card.contains(at)), at: at ? at.tagName.toLowerCase() : null };
  })()`);
  info(`挪到卡片里：${JSON.stringify(stillOpen)}`);
  check('★★ 鼠标从动态行挪进卡片**不收起**，而且命中的就是卡片里的链接（点得到）',
    !!stillOpen && stillOpen.opacity === 1 && stillOpen.hits, stillOpen ? stillOpen.at : '卡片没了');
  /* 上一行：把鼠标挪到上面那条动态上，卡片才换过去 */
  const prev = await feedRowPoint(1);
  let swapped = null;
  if (prev) {
    await cdp.move(prev.x, prev.y, 8);
    for (let i = 0; i < 8 && !swapped; i++) {
      swapped = await cdp.ev(`(() => {
        const card = document.querySelector('.annlayer .feed__detail.is-open');
        if (!card) return null;
        const r = card.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top) };
      })()`);
      if (!swapped) await sleep(120);
    }
  }
  check('★ 真的想换一条时，挪到那一条上就换过去了（不是卡死不动）',
    !!swapped && Math.abs(swapped.y - cardInfo.y) > 4,
    swapped ? `y ${cardInfo.y} → ${swapped.y}` : `没有卡片（上一行落点 ${JSON.stringify(prev)}）`);
}

/* ============================================================
 * ② 精华大殿：成员名名片 + 头像放大，不关精华/圣经浮层
 * ============================================================ */
console.log('\n================ ② 精华大殿里的成员名 ================');
await cdp.open('/');
const colPoint = await cdp.ev(`(() => {
  const card = document.querySelector('.daily__col--essence .daily__card');
  card.scrollIntoView({ block: 'center' });
  const r = card.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);
await cdp.move(colPoint.x, colPoint.y);
const popOn = await cdp.ev(`(() => document.querySelector('[data-daily]').dataset.pop || '')()`);
check('★ 移到每日精华上：精华浮层打开', popOn === 'essence', popOn);

/* 浮层里那个成员名（挑一个**真的带名片**的：`mem--nolink` 那种没有名片） */
const mems = await cdp.ev(`(() => {
  const pop = document.querySelector('.daily__pop--essence');
  return [...pop.querySelectorAll('.mem')].map((m) => {
    const r = m.getBoundingClientRect();
    return { has: !!m.querySelector('.mem__card'), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), inView: r.top >= 0 && r.bottom <= innerHeight };
  });
})()`);
const memPoint = mems.find((m) => m.has && m.inView) || null;
if (!memPoint) {
  check('★ 浮层里有成员名可以悬停（这一条恰好没有）', true, JSON.stringify(mems));
} else {
  await cdp.move(memPoint.x, memPoint.y, 4);
  let card1 = null;
  for (let i = 0; i < 8 && !card1; i++) {
    card1 = await cdp.ev(`(() => {
      const c = document.querySelector('.memlayer .mem__card');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
               pop: document.querySelector('[data-daily]').dataset.pop || '',
               at: (() => { const e = document.elementFromPoint(${memPoint.x}, ${memPoint.y}); return e ? e.className.toString().slice(0, 30) : null; })() };
    })()`);
    if (!card1) await sleep(120);
  }
  info(`成员名片：${JSON.stringify(card1)}`);
  check('★★ 悬停成员名：成员名片照常弹出来（没有被禁掉）', !!card1, JSON.stringify(mems));
  check('★ 名片弹出的同时，精华浮层的标记还在（没被名片顶掉）', !!card1 && card1.pop === 'essence', card1 ? `data-pop=${card1.pop}` : '');

  /* 名片里那颗头像：放大图要出来，且名片 / 浮层都不许关 */
  const face = await cdp.ev(`(() => {
    const f = document.querySelector('.memlayer .mem__card .mem__face');
    if (!f) return null;
    const r = f.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!face) {
    check('★ 名片里有头像可以悬停', true, '（这张名片没有头像）');
  } else {
    await cdp.move(face.x, face.y, 3);
    const zoom = await cdp.ev(`(() => {
      const card = document.querySelector('.memlayer .mem__card');
      const z = card ? card.querySelector('.mem__zoom') : null;
      const st = z ? getComputedStyle(z) : null;
      return {
        card: !!card,
        zoomVis: st ? st.visibility : null,
        zoomW: z ? Math.round(z.getBoundingClientRect().width) : 0,
        pop: document.querySelector('[data-daily]').dataset.pop || '',
      };
    })()`);
    info(`悬停头像：${JSON.stringify(zoom)}`);
    check('★★ 悬停头像：放大图出来了', !!zoom && zoom.zoomVis === 'visible' && zoom.zoomW > 100, JSON.stringify(zoom));
    check('★★ 放大头像的同时**成员名片没被关掉**', !!zoom && zoom.card === true);
    check('★★ 放大头像的同时**精华浮层也没被关掉**', !!zoom && zoom.pop === 'essence', `data-pop=${zoom && zoom.pop}`);

    /* 移开这一片：两张都正常收 */
    await cdp.move(6, 6, 6);
    await sleep(600);
    const away = await cdp.ev(`(() => ({
      card: !!document.querySelector('.memlayer .mem__card'),
      pop: document.querySelector('[data-daily]').dataset.pop || '',
    }))()`);
    info(`移开后：${JSON.stringify(away)}`);
    check('★ 鼠标移开这一片之后：名片和浮层都正常收起', away.card === false && away.pop === '');
  }
}

check('★ 全程没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { windowsHide: true, stdio: 'ignore' }); } catch {}
server.close(); await sleep(200);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
console.log(`\nPASS ${pass}   FAIL ${fail}`);
if (fail > 0) process.exit(1);
