/*
 * 深色页面上的字够不够清楚（2026-11-21）
 *
 * 站长原话：
 *   「推流动态的详情页面 最下方的翻页功能的字体都是琥珀色的 和粉紫色背景底配合完全看不清
 *     检查一下有这种看不清现象的都改一下字的颜色」
 *
 * 病因（记在这儿）：`tokens.css` 那套令牌是给**浅色底**用的（深棕字 #46280f、深琥珀强调
 * #8f4a10），版块页却是深紫底 #1e0730 —— 直接读令牌的地方（翻页条、置顶标）就成了
 * 深色压深色，实测对比度 1.4:1。修法见 `global.css` 里 `body.is-board .pager` 那一段。
 *
 * 这里按 WCAG 逐条算：把每个有字的元素的前景和**合成后的背景**都取出来，
 * 小字要 ≥ 4.5:1、大字（≥24px，或 ≥18.66px 且加粗）要 ≥ 3:1。
 *
 * 三个"看着像红其实不是"的排除项：
 *   · `color: transparent` + `background-clip: text`（那种字的颜色来自渐变，量不到）；
 *   · 只有读屏才念的（`.sr-only`、`.skip-link`，视觉上根本不在那块地方）；
 *   · 盒子在视口外 / 尺寸为 0 的。
 *
 * 用法：node tools/checks/board-contrast-check.mjs
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
const PORT = 4391;
const DEBUG_PORT = 9361;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg' };

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

const profile = path.join(process.env.TEMP ?? '.', `dsh-contrast-${Date.now()}`);
const chrome = spawn(chromePath(), ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });

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
      if (m.method === 'Runtime.exceptionThrown') this.errors.push('exception: ' + (m.params.exceptionDetails?.exception?.description ?? ''));
    });
  }
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

const SCAN = `(() => {
  const parse = (c) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (top, bot) => ({
    r: top.r * top.a + bot.r * (1 - top.a),
    g: top.g * top.a + bot.g * (1 - top.a),
    b: top.b * top.a + bot.b * (1 - top.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => { const l1 = Math.max(lum(a), lum(b)), l2 = Math.min(lum(a), lum(b)); return (l1 + 0.05) / (l2 + 0.05); };
  /* 背景：从 html/body 的深色兜底开始，把祖先的 backgroundColor 一层层叠上去 */
  const bgOf = (el) => {
    let bg = { r: 30, g: 7, b: 48, a: 1 };
    const chain = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.push(n);
    for (const n of chain.reverse()) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) bg = over(c, bg);
    }
    return bg;
  };
  const skip = (el, cs, fg) => {
    if (el.closest('.sr-only, .skip-link, [aria-hidden="true"]')) return true;
    /* 前景完全透明的：渐变填字（background-clip:text），字色量不到，不算 */
    if (!fg || fg.a === 0) return true;
    if (/transparent/.test(cs.color)) return true;
    if (cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text') return true;
    return false;
  };
  const out = [];
  for (const el of document.querySelectorAll('a, p, span, b, strong, em, button, label, input, li, h1, h2, h3, h4, time, small, code, div, td, th')) {
    if (!el.childNodes.length) continue;
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
    if (!text) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight * 40) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible' || Number(cs.opacity) === 0 || cs.display === 'none') continue;
    const fg = parse(cs.color);
    if (skip(el, cs, fg)) continue;
    const bg = bgOf(el);
    const fgOver = fg.a < 1 ? over(fg, bg) : fg;
    const px = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const large = px >= 24 || (px >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const cr = ratio(fgOver, bg);
    if (cr < need) {
      out.push({
        sel: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).join('.') : ''),
        text: text.slice(0, 22),
        color: cs.color,
        bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')',
        px, cr: Math.round(cr * 100) / 100, need,
      });
    }
  }
  /* 同一个选择器只留最差的一条，免得一页刷屏 */
  const bySel = new Map();
  for (const it of out) {
    const cur = bySel.get(it.sel);
    if (!cur || it.cr < cur.cr) bySel.set(it.sel, it);
  }
  return [...bySel.values()].sort((a, b) => a.cr - b.cr).slice(0, 20);
})()`;

/* 深色底的页面（浅色的手记 / 文章页用的是浅色底，那套令牌是对的，不在这一条的范围里） */
const PAGES = ['/feed/', '/zongxian/', '/huaya/', '/huaya/years/newhuaya/', '/iceberg/', '/salon/', '/bellie/', '/liyutang/', '/'];

let total = 0;
const worst = [];
for (const url of PAGES) {
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${url}` });
  for (let i = 0; i < 100; i++) { await sleep(100); if ((await cdp.ev('document.readyState')) === 'complete') break; }
  await sleep(900);
  const rows = await cdp.ev(SCAN);
  total += 1;
  if (rows.length) {
    worst.push({ url, rows });
    info(`${url}：${rows.length} 处不清楚`);
    for (const r of rows.slice(0, 4)) info(`   ${r.cr} < ${r.need}  ${r.px}px ${r.sel}「${r.text}」`);
  } else {
    info(`${url}：全部达标`);
  }
}

console.log('\n================ 结果 ================');
check('★ 扫到了页面', total === PAGES.length, `${total} / ${PAGES.length}`);
check('★★ 深色页面上没有"看不清的字"（小字 ≥ 4.5:1、大字 ≥ 3:1）',
  worst.length === 0,
  worst.length ? JSON.stringify(worst.map((w) => ({ url: w.url, worst: w.rows[0] }))) : `${total} 个页面全部达标`);
check('★ 这一趟没有未捕获的 JS 异常', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { windowsHide: true, stdio: 'ignore' }); } catch { /* 已退 */ }
server.close();
await sleep(200);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 算了 */ }

console.log(`\nPASS ${pass}   FAIL ${fail}`);
if (fail > 0) process.exit(1);
