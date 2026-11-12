/*
 * 相册块的渲染 + 灯箱验收（2026-11-11）
 * ---------------------------------------------------------------------------
 * 在副本里给某页塞一个相册块（3 张图，其中 2 张有描述）→ 真构建 → 真浏览器量：
 *   ① 照片墙画出 3 张、每张都带 data-zoom（灯箱才认）；
 *   ② 有描述的那两张，描述在照片墙下面看得见；
 *   ③ 点一张有描述的图 → 全站灯箱打开，而且**灯箱里也能看到那句描述**
 *      （ImageZoom 读 figcaption 当图注，这条就是验证这条链路真的通）；
 *   ④ 点背景/关闭按钮能关掉。
 * 跑法：node tools/checks/album-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromePath } from './lib/chrome.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DST = path.join(SRC, '.tmp', 'album-copy');
const PORT = 4621;
const DBG = 9411;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`); };

/* 副本 */
if (fs.existsSync(DST)) {
  const j = path.join(DST, 'node_modules');
  if (fs.existsSync(j)) { try { execSync(`cmd /c rmdir "${j}"`, { stdio: 'ignore', windowsHide: true }); } catch { /* ignore */ } }
  fs.rmSync(DST, { recursive: true, force: true });
}
fs.mkdirSync(DST, { recursive: true });
for (const it of ['src', 'tools', 'astro.config.mjs', 'package.json', 'tsconfig.json']) fs.cpSync(path.join(SRC, it), path.join(DST, it), { recursive: true });
fs.mkdirSync(path.join(DST, 'public/img/opt'), { recursive: true });
fs.copyFileSync(path.join(SRC, 'public/img/opt/manifest.json'), path.join(DST, 'public/img/opt/manifest.json'));
/* 构建要 node_modules：和别的验收一样用 junction（别整目录拷，几十万个文件） */
execSync(`cmd /c mklink /J "${path.join(DST, 'node_modules')}" "${path.join(SRC, 'node_modules')}"`, { stdio: 'ignore', windowsHide: true });

/* 找一张真图来当照片 */
const up = fs.readdirSync(path.join(SRC, 'public/img/uploads')).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
const A = `/img/uploads/${up[0]}`;
const B = `/img/uploads/${up[1] ?? up[0]}`;
/* 照片本身也得拷进副本，否则产物里的图 404（第一版就漏了这一步） */
fs.mkdirSync(path.join(DST, 'public/img/uploads'), { recursive: true });
for (const f of new Set([up[0], up[1] ?? up[0]])) {
  fs.copyFileSync(path.join(SRC, 'public/img/uploads', f), path.join(DST, 'public/img/uploads', f));
}

/* 塞一个相册块到某个有 page 的节点最前面 */
const boardsFile = path.join(DST, 'src/data/home-boards.json');
const tree = JSON.parse(fs.readFileSync(boardsFile, 'utf8'));
const all = [];
const walk = (l) => { for (const n of l ?? []) { all.push(n); walk(n.children); walk(n.boards); } };
walk(tree.boards);
const host = all.find((n) => Array.isArray(n.page) && n.page.length > 0 && !n.external);
if (!host) { console.log('FAIL 副本里没有能装相册的页面'); process.exit(1); }
host.page = [{
  id: 'chk-album', type: 'album', text: '验收用相册',
  photos: [
    { id: 'chk-p1', src: A, note: '第一张的描述：虹星家的塔吊' },
    { id: 'chk-p2', src: B },
    { id: 'chk-p3', src: A, note: '第三张的描述：夜里的溪流' },
  ],
}, ...host.page];
fs.writeFileSync(boardsFile, `${JSON.stringify(tree, null, 2)}\n`, 'utf8');
console.log(`      · 装到页面「${host.title || host.id}」，照片 ${A}`);

const built = spawn(process.execPath, [path.join(DST, 'node_modules/astro/bin/astro.mjs'), 'build'], { cwd: DST, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let blog = '';
built.stdout.on('data', (b) => { blog += b; });
built.stderr.on('data', (b) => { blog += b; });
const builtOk = await new Promise((r) => built.on('close', (c) => r(c === 0)));
check('副本构建通过', builtOk, blog.split(/\r?\n/).filter((l) => /error/i.test(l)).slice(-2).join(' | '));
if (!builtOk) { console.log(blog.slice(-400)); process.exit(1); }

/* 在产物里找那一页 */
const HREF = (() => {
  const stack = [path.join(DST, 'dist')];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '.prerender') stack.push(p); continue; }
      if (e.name === 'index.html' && fs.readFileSync(p, 'utf8').includes('data-album-photo="chk-p1"')) {
        return `/${path.relative(path.join(DST, 'dist'), p).replace(/\\/g, '/').replace(/index\.html$/, '')}`;
      }
    }
  }
  return null;
})();
check('产物里有我们这个相册页', Boolean(HREF), String(HREF));
if (!HREF) { console.log(`\nPASS ${pass}   FAIL ${fail}`); process.exit(1); }

/* 静态：产物里的结构对不对。
   ⚠ 只数**我们塞进去的那个相册**（chk- 开头的 id）——
   站长在这一页上已经有几十张别的相册照片了，全局数 palbum__img 会数成 70 多个。 */
const html = fs.readFileSync(path.join(DST, 'dist', HREF.replace(/^\//, ''), 'index.html'), 'utf8');
const cells = [...html.matchAll(/<li class="palbum__cell" data-album-photo="(chk-p\d)"[\s\S]*?<\/li>/g)];
check('产物里我们这个相册有 3 格', cells.length === 3, `${cells.length} 格`);
check('照片墙 3 张、都带 data-zoom',
  cells.every((c) => (c[0].match(/class="palbum__img"/g) || []).length === 1 && /data-zoom="1"/.test(c[0])));
check('有描述的两张渲染了 figcaption、没描述那张没有',
  cells.filter((c) => /palbum__note/.test(c[0])).length === 2);

/* 浏览器 */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.gif': 'image/gif' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
    const f = path.join(DST, 'dist', t);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream' }); return fs.createReadStream(f).pipe(res); }
  }
  res.writeHead(404); res.end('404');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const profile = path.join(process.env.TEMP ?? '.', `dsh-album-${Date.now()}`);
const chrome = spawn(chromePath(), ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DBG}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
let ws = null;
try {
  let tg = null;
  for (let i = 0; i < 60 && !tg; i += 1) { await sleep(250); try { const l = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json(); tg = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl); } catch { /* 等 */ } }
  ws = new WebSocket(tg.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('ws')), { once: true }); });
  let id = 0;
  const pend = new Map();
  const errs = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(String(m.params.exceptionDetails?.text).slice(0, 90));
  });
  const send = (method, params = {}) => { const n = ++id; ws.send(JSON.stringify({ id: n, method, params })); return new Promise((resolve, reject) => pend.set(n, { resolve, reject })); };
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`);
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}${HREF}` });
  for (let i = 0; i < 160; i += 1) { await sleep(120); try { if ((await ev('document.readyState')) === 'complete') break; } catch { /* 导航 */ } }
  await sleep(1200);

  /* 只看我们塞进去那个相册（chk- 开头的 id）：这一页上还有站长自己的几十张照片 */
  const wall = await ev(`(() => {
    const figs = [...document.querySelectorAll('[data-album-photo^="chk-"] .palbum__fig')];
    return { n: figs.length, notes: figs.map((f) => (f.querySelector('.palbum__note')?.textContent || '').trim()),
      zoomable: figs.every((f) => f.querySelector('img')?.hasAttribute('data-zoom')),
      imgsOk: figs.every((f) => { const i = f.querySelector('img'); return i && i.complete && i.naturalWidth > 0; }) };
  })()`);
  check('★ 照片墙 3 张、都可点（data-zoom）、图都真的加载了', wall.n === 3 && wall.zoomable === true && wall.imgsOk === true, JSON.stringify(wall).slice(0, 140));
  check('★ 描述在照片墙下面看得见（2 张有、1 张没有）', wall.notes.filter(Boolean).length === 2, JSON.stringify(wall.notes));

  /* 点第一张有描述的图 → 灯箱 */
  const box = await ev(`(() => { const im = document.querySelector('[data-album-photo^="chk-"] .palbum__fig img'); const r = im.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  for (const [type, btn, btns] of [['mouseMoved', 'none', 0], ['mousePressed', 'left', 1], ['mouseReleased', 'left', 0]]) {
    await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: btn, buttons: btns, clickCount: type === 'mouseMoved' ? 0 : 1 });
    await sleep(120);
  }
  await sleep(700);
  const zoom = await ev(`(() => {
    const l = document.querySelector('.izoom');
    if (!l) return { no: true };
    const shown = !l.hidden && getComputedStyle(l).display !== 'none';
    return { shown, text: (l.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
      hasImg: !!l.querySelector('img') };
  })()`);
  check('★ 点照片 → 全站灯箱打开', zoom.shown === true && zoom.hasImg === true, JSON.stringify(zoom).slice(0, 120));
  check('★ 灯箱里能读到那张图的描述（figcaption → 图注这条链路通了）',
    typeof zoom.text === 'string' && zoom.text.includes('虹星家的塔吊'), zoom.text);

  /* 关掉 */
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(500);
  const closed = await ev(`(() => { const l = document.querySelector('.izoom'); return !l || l.hidden; })()`);
  check('Esc 能关掉灯箱', closed === true);

  /*
   * 手机版式（2026-11-12 用户）：「手机还是一行一张图 图片多了翻起来太慢 把手机适配为一行三张」。
   * 量的是**第一行里有几个格子**（按 cell 的顶边分组），不是数 CSS 里的列数 ——
   * 只有真的排成三列、图也真的加载出来才算过。
   */
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(600);
  const m = await ev(`(() => {
    const sel = '[data-album-photo^="chk-"]';
    const cells = [...document.querySelectorAll(sel)].map((c) => {
      const r = c.getBoundingClientRect();
      return { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) };
    });
    const first = cells[0] || { top: 0 };
    const row1 = cells.filter((c) => Math.abs(c.top - first.top) <= 2);
    const imgs = [...document.querySelectorAll(sel + ' .palbum__img')];
    return {
      cols: row1.length,
      cellW: Math.round(row1[0]?.w || 0),
      gap: row1.length > 1 ? Math.round(row1[1].left - (row1[0].left + row1[0].w)) : -1,
      allLoaded: imgs.every((i) => i.complete && i.naturalWidth > 0),
      zoomable: imgs.every((i) => i.hasAttribute('data-zoom')),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      aspect: imgs[0] ? +(imgs[0].getBoundingClientRect().height / imgs[0].getBoundingClientRect().width).toFixed(2) : 0,
    };
  })()`);
  check('★ 手机（390 宽）相册是**一行三张**', m.cols === 3, `第一行 ${m.cols} 格`);
  check('手机上一格还有 90px 以上（缩略图看得清）', m.cellW >= 90, `${m.cellW}px 宽、间距 ${m.gap}px`);
  check('手机上照片仍然是方的（object-fit 裁成正方的缩略图）', m.aspect >= 0.9 && m.aspect <= 1.1, `高/宽 ${m.aspect}`);
  check('手机上一行三张之后图没被压坏（都还加载着、都还能点开）',
    m.allLoaded === true && m.zoomable === true);
  check('手机上没有横向溢出', m.overflow <= 0, `${m.overflow}px`);

  /* 手机上再点一张，确认小的缩略图照样点得开 */
  const mbox = await ev(`(() => { const im = document.querySelector('[data-album-photo^="chk-"] .palbum__fig img'); const r = im.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  for (const [type, btn, btns] of [['mouseMoved', 'none', 0], ['mousePressed', 'left', 1], ['mouseReleased', 'left', 0]]) {
    await send('Input.dispatchMouseEvent', { type, x: mbox.x, y: mbox.y, button: btn, buttons: btns, clickCount: type === 'mouseMoved' ? 0 : 1 });
    await sleep(120);
  }
  await sleep(700);
  const mzoom = await ev(`(() => { const l = document.querySelector('.izoom'); return !!l && !l.hidden && !!l.querySelector('img'); })()`);
  check('手机上点一张小缩略图 → 灯箱照样打开', mzoom === true);

  check('全程无 JS 异常', errs.length === 0, errs.slice(0, 2).join(' | ') || '干净');
} catch (err) {
  fail += 1;
  console.log(`FAIL  ★ 脚本自己炸了：${err?.message || err}`);
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  try { chrome.kill(); } catch { /* ignore */ }
  server.close();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(`\n================ 结果 ================\nPASS ${pass}   FAIL ${fail}`);
if (fail > 0) process.exit(1);
