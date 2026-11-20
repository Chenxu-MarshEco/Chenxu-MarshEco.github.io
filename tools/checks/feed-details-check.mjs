/*
 * `/feed/`（推流动态全部历史）那一页的明细（2026-11-21）
 *
 * 站长原话：
 *   「点入推流动态详情页（/feed）后 里面的内容也要和首页一样详细显示改了哪些部分
 *     可以点击链接跳转 现在里面什么跳转都没有」
 *   「另外检查到推流动态中有关眠鱼志的链接都会跳到404页面 检查一下是否路径链错了」
 *
 * 所以这一条盯三件事：
 *   ① 每条动态下面都铺着明细（面板名 + 条目），不是只剩「改了哪几块」那一行；
 *   ② 明细里的条目真的能点（有 href），而且**不是全都不可点**；
 *   ③ 凡是站内链接，落点真存在（照着 dist 里的文件查，不靠"看起来像"）——
 *      眠鱼志那条 404 就是这么来的：`2026.10.9` 拼成了 `/logs/2026-10-9/`，
 *      真地址是补零的 `/logs/2026-10-09/`。
 *
 * 用法：node tools/checks/feed-details-check.mjs
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
const PORT = 4390;
const DEBUG_PORT = 9369;
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

const profile = path.join(process.env.TEMP ?? '.', `dsh-feed-${Date.now()}`);
const chrome = spawn(chromePath(), ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
      if (m.method === 'Runtime.exceptionThrown') this.errors.push('exception: ' + (m.params.exceptionDetails?.exception?.description ?? ''));
    }); }
  static async attach(u) { const ws = new WebSocket(u); await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('ws')), { once: true }); }); return new CDP(ws); }
  send(m, p = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method: m, params: p })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  async ev(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; }
}

let cdp = null;
for (let i = 0; i < 60 && !cdp; i++) {
  await sleep(300);
  try { const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json(); const t = l.find((x) => x.type === 'page'); if (t) cdp = await CDP.attach(t.webSocketDebuggerUrl); } catch { /* 等 */ }
}
check('无头浏览器起来了', !!cdp);
if (!cdp) process.exit(1);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/feed/` });
for (let i = 0; i < 100; i++) { await sleep(100); if ((await cdp.ev('document.readyState')) === 'complete') break; }
await sleep(1200);

const page = await cdp.ev(`(() => {
  const items = [...document.querySelectorAll('#feed-list .feed__item')];
  /* 明细在 DOM 里都有一份（翻页只是把 li 藏起来，不是删掉） */
  const withDetail = items.filter((li) => !!li.querySelector('.feed__detail--inline'));
  /* 当前这一页上真的铺出来了（有高度、不是 display:none） */
  const visible = items.filter((li) => !li.hidden);
  const visibleWithDetail = visible.filter((li) => {
    const d = li.querySelector('.feed__detail--inline');
    if (!d) return false;
    const r = d.getBoundingClientRect();
    return r.height > 0 && getComputedStyle(d).display !== 'none';
  });
  const links = [...document.querySelectorAll('#feed-list .feed__detailLink')];
  const clickable = links.filter((a) => a.tagName === 'A' && a.getAttribute('href'));
  const hrefs = clickable.map((a) => a.getAttribute('href'));
  const panels = [...document.querySelectorAll('#feed-list .feed__detailPanel')].map((p) => p.textContent.trim());
  const pager = document.querySelector('.pager');
  return {
    items: items.length,
    withDetail: withDetail.length,
    visible: visible.length,
    visibleWithDetail: visibleWithDetail.length,
    links: links.length,
    clickable: clickable.length,
    hrefs: [...new Set(hrefs)],
    panels: [...new Set(panels)].slice(0, 12),
    hasPager: !!pager,
  };
})()`);
info(`动态 ${page.items} 条（本页 ${page.visible} 条）｜带明细 ${page.withDetail} 条 / 本页铺出来 ${page.visibleWithDetail} 条｜明细条目 ${page.links} 个（能点 ${page.clickable} 个）｜面板 ${JSON.stringify(page.panels)}`);

check('★ 每一条动态下面都带着明细（翻到哪页都铺出来，不用悬停）',
  page.items > 0 && page.withDetail === page.items && page.visibleWithDetail === page.visible,
  `${page.withDetail} / ${page.items}；本页 ${page.visibleWithDetail} / ${page.visible}`);
check('★★ 明细里真的能点（不是一堆死字）',
  page.clickable > 0 && page.clickable >= Math.floor(page.links * 0.15), `${page.clickable} / ${page.links}`);
check('★ 明细按面板分了组（页面 / 子版块 / 冰山图 / 眠鱼志…这些名字）',
  page.panels.length >= 3, JSON.stringify(page.panels));

/* ③ 站内链接逐个查落点 */
const internal = page.hrefs.filter((h) => h && h.startsWith('/'));
const missing = [];
for (const h of internal) {
  const clean = h.split('#')[0].split('?')[0];
  if (!clean) continue;                       /* 纯锚点 */
  const cands = [
    path.join(ROOT, clean, 'index.html'),
    path.join(ROOT, `${clean}.html`),
    path.join(ROOT, clean),
  ];
  const hit = cands.some((f) => fs.existsSync(f) && fs.statSync(f).isFile());
  if (!hit) missing.push(h);
}
info(`站内链接 ${internal.length} 个（去重），查了一遍落点`);
check('★★ 明细里的站内链接**一个都不 404**（照着 dist 里的文件查）',
  missing.length === 0, missing.slice(0, 8).join(' | '));

/* 眠鱼志那条单独再确认一次：点号日期要补零 */
const logLinks = internal.filter((h) => h.startsWith('/logs/'));
const badFormat = logLinks.filter((h) => !/^\/logs\/\d{4}-\d{2}-\d{2}\/$/.test(h));
info(`眠鱼志链接 ${logLinks.length} 个，例如 ${logLinks.slice(0, 3).join(' ')}`);
check('★★ 眠鱼志的链接是补零的 `/logs/YYYY-MM-DD/`（不是 `2026-10-9` 这种）',
  badFormat.length === 0, badFormat.slice(0, 5).join(' | '));

/* 翻页条在（这一页条数多，没它就翻不动） */
const pagerInfo = await cdp.ev(`(() => {
  const p = document.querySelector('.pager');
  if (!p) return null;
  const cs = getComputedStyle(p);
  const status = p.querySelector('.pager__status');
  const step = p.querySelector('.pager__step');
  return {
    nums: p.querySelectorAll('.pager__num').length,
    statusColor: status ? getComputedStyle(status).color : null,
    stepColor: step ? getComputedStyle(step).color : null,
    color: cs.color,
  };
})()`);
info(`翻页条：${JSON.stringify(pagerInfo)}`);
check('★ 翻页条在，页码按条数分出来了', !!pagerInfo && pagerInfo.nums > 1, JSON.stringify(pagerInfo));

check('★ 这一趟没有未捕获的 JS 异常', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { windowsHide: true, stdio: 'ignore' }); } catch { /* 已退 */ }
server.close();
await sleep(200);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 算了 */ }
console.log(`\nPASS ${pass}   FAIL ${fail}`);
if (fail > 0) process.exit(1);
