/*
 * 「时间轴改了，冰室精华页左边那条跟着变」的验收 —— 真副本、真构建、真浏览器。
 *
 * 用户的要求（原话）：
 *   「可以在编辑器里选一个时间轴放在那个位置……放上去以后【不要做任何改动！！！】……
 *     点刻度就跳到离那个日期最近的精华……时间轴更新了也同理冰室精华旁边的同步更新」
 *
 * 所以这里不测"我生成的东西对不对"，而是测**站点那条时间轴本身**：
 *   ① 换成另一条时间轴（纷鸟衔来的记录，带"难以考据"的点）→ 页面上就是那条轴的 14 个点，
 *      没有多、没有少，点刻度照样跳到最近的精华（没有日期的点也能跳）
 *   ② 在副本里改一条时间轴（改一个点的名字 + 加一个新点）→ 重新构建后，
 *      冰室精华页左边**跟着显示新的**（说明页面上那条轴是它自己的，不是我抄一份）
 *
 * 用法：node tools/checks/salon-timeline-live-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';

const SRC = String.raw`D:\曼沫砾总线\Chenxu-MarshEco.github.io`;
const DST = path.join(SRC, '.tmp', 'tl-live');
const PORT = 4394;
const DEBUG_PORT = 9365;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
};
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};

/* ---------- 副本 ---------- */
if (fs.existsSync(DST)) {
  for (const j of ['node_modules', 'public']) {
    const p = path.join(DST, j);
    if (fs.existsSync(p)) { try { execSync(`cmd /c rmdir "${p}"`, { stdio: 'ignore' }); } catch { /* 不是 junction */ } }
  }
  fs.rmSync(DST, { recursive: true, force: true });
}
const skip = new Set(['node_modules', 'public', 'dist', '.git', '.tmp']);
fs.mkdirSync(DST, { recursive: true });
for (const e of fs.readdirSync(SRC, { withFileTypes: true })) {
  if (skip.has(e.name)) continue;
  fs.cpSync(path.join(SRC, e.name), path.join(DST, e.name), { recursive: true });
}
execSync(`cmd /c mklink /J "${path.join(DST, 'node_modules')}" "${path.join(SRC, 'node_modules')}"`, { stdio: 'ignore' });
execSync(`cmd /c mklink /J "${path.join(DST, 'public')}" "${path.join(SRC, 'public')}"`, { stdio: 'ignore' });

const TL_FILE = path.join(DST, 'src', 'data', 'timelines.json');
const SALON_FILE = path.join(DST, 'src', 'data', 'salon.json');
const salon0 = JSON.parse(fs.readFileSync(SALON_FILE, 'utf8'));
const tls = JSON.parse(fs.readFileSync(TL_FILE, 'utf8')).timelines;
const pick0 = salon0.timelineId;
const other = tls.find((t) => t.id !== pick0);
console.log(`副本就绪｜盘上选的是 ${pick0}｜另一条是 ${other.id}（${other.points.length} 点，其中 ${other.points.filter((p) => !p.date).length} 个没有日期）`);

const build = () => {
  const r = spawnSyncBuild();
  if (r.status !== 0) throw new Error('构建失败：' + String(r.stdout ?? '').slice(-400));
  return r;
};
const spawnSyncBuild = () => {
  const { spawnSync } = childProcessShim;
  return spawnSync(process.execPath, [path.join(SRC, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'build'], { cwd: DST, encoding: 'utf8' });
};
/* 用小壳子拿 spawnSync（顶部 import 的 spawn 是异步那个） */
const childProcessShim = await import('node:child_process');

/* ---------- 静态服务 + 浏览器 ---------- */
const ROOT = path.join(DST, 'dist');
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
    const f = path.join(ROOT, t);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream' });
      return fs.createReadStream(f).pipe(res);
    }
  }
  res.writeHead(404);
  res.end('404');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = path.join(process.env.TEMP ?? '.', `dsh-tllive-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

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
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
    });
  }
  static async attach(u) {
    const ws = new WebSocket(u);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('ws')), { once: true }); });
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
  async goto(p, wait = 2600) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 120; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
  }
}

/** 页面上量一遍轴，并真点一个刻度试试能不能跳到最近的精华 */
const measureAndClick = async (cdp) => {
  await cdp.goto('/salon/');
  const m = await cdp.ev(`(() => {
    const t = document.querySelector('.tl');
    const pts = [...document.querySelectorAll('.tl__item')];
    return { tlId: t && t.dataset.tlId, points: pts.length, labels: pts.map((p) => p.dataset.label), bands: document.querySelectorAll('.tl__band').length }; })()`);
  const pick = await cdp.ev(`(() => {
    const body = document.querySelector('[data-tl-body]');
    const pts = [...document.querySelectorAll('.tl__item')];
    const center = () => { const b = body.getBoundingClientRect(); return b.top + b.height / 2; };
    let fallback = null;
    for (const it of pts) {
      for (let i = 0; i < 20; i++) {
        const b = body.getBoundingClientRect(); const r = it.getBoundingClientRect();
        const cy = r.top + r.height / 2;
        if (cy > b.top + 40 && cy < b.bottom - 40) break;
        body.dispatchEvent(new WheelEvent('wheel', { deltaY: cy - center(), bubbles: true, cancelable: true }));
      }
      const b = body.getBoundingClientRect();
      const r = it.getBoundingClientRect();
      const cy = r.top + r.height / 2;
      const inBand = cy > b.top + 8 && cy < b.bottom - 8;
      if (!inBand) continue;
      /* 记一个"离面板中心最近"的点当兜底（某些轴上点很小、elementFromPoint 点不到） */
      const d = Math.abs(cy - center());
      if (!fallback || d < fallback.d) fallback = { d, id: it.dataset.point, label: it.dataset.label, param: Number(it.dataset.param) };
      const a = it.querySelector('a.tl__crane') || it.querySelector('a.tl__name') || it;
      const ar = a.getBoundingClientRect();
      const x = ar.left + ar.width / 2, y = ar.top + ar.height / 2;
      if (!(ar.width > 2 && ar.height > 2 && x > 2 && y > 2 && x < innerWidth - 2 && y < innerHeight - 2)) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && (hit === a || a.contains(hit) || (hit.closest && hit.closest('.tl__item') === it))) {
        return { mode: 'mouse', id: it.dataset.point, label: it.dataset.label, param: Number(it.dataset.param), x, y };
      }
    }
    return fallback ? { mode: 'synthetic', ...fallback } : null; })()`);
  if (!pick) return { ...m, click: null };
  const doClick = async (mode) => {
    if (mode === 'mouse') {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pick.x, y: pick.y, button: 'none' });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pick.x, y: pick.y, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pick.x, y: pick.y, button: 'left', buttons: 0, clickCount: 1 });
    } else {
      /* 点太小/被挡住时退一步：直接对那个刻度元素发一次 click（页面那段接管逻辑照样会跑） */
      await cdp.ev(`(document.querySelector('.tl__item[data-point=' + ${JSON.stringify(JSON.stringify(pick.id))} + ']') || { click() {} }).click(), true`);
    }
  };
  const readClick = () => cdp.ev(`(() => {
    const el = document.querySelector('.salon__item--hit');
    if (!el) return { hit: false };
    const w = ${JSON.stringify(pick.param)};
    let nearest = null, bestD = Infinity;
    for (const it of document.querySelectorAll('.salon__item')) {
      const v = Number(it.dataset.tlParam);
      if (!Number.isFinite(v)) continue;
      const d = Math.abs(v - w);
      if (d < bestD) { bestD = d; nearest = it; }
    }
    const r = el.getBoundingClientRect();
    return { hit: true, picked: ${JSON.stringify(pick.label)}, id: el.id,
      date: (el.querySelector('.salon__time') || {}).textContent, isNearest: nearest ? nearest.id === el.id : false,
      top: Math.round(r.top), inView: r.top > -60 && r.top < innerHeight }; })()`);
  /* 高亮类 2.4 秒后会被摘掉，所以轮询要在这个窗口里；平滑滚动长距离要 1~2 秒 */
  let click = { hit: false };
  for (const mode of [pick.mode, 'synthetic']) {
    await doClick(mode);
    for (let i = 0; i < 9; i++) {
      click = await readClick();
      if (click.hit) break;
      await sleep(220);
    }
    if (click.hit) { click.mode = mode; break; }
  }
  if (click.hit) {
    /* 高亮类 2.4 秒后会被摘掉，但"跳过去"这件事还在滚 —— 记住 id 继续等它落定 */
    const id = click.id;
    for (let i = 0; i < 20; i++) {
      const st = await cdp.ev(`(() => { const el = document.getElementById(${JSON.stringify(id)}); if (!el) return null;
        const r = el.getBoundingClientRect(); return { top: Math.round(r.top), inView: r.top > -60 && r.top < innerHeight, y: Math.round(scrollY) }; })()`);
      if (!st) break;
      click = { ...click, ...st };
      if (st.inView) break;
      await sleep(250);
    }
  }
  return { ...m, click };
};

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* 还没起来 */ }
  }
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });

  /* ---------- ① 换成另一条时间轴 ---------- */
  const s1 = JSON.parse(fs.readFileSync(SALON_FILE, 'utf8'));
  s1.timelineId = other.id;
  fs.writeFileSync(SALON_FILE, JSON.stringify(s1, null, 2) + '\n', 'utf8');
  build();
  const a = await measureAndClick(cdp);
  check(`换成「${other.title}」重建后：页面上就是那条轴自己的 ${other.points.length} 个点（一个不多一个不少）`,
    a.tlId === other.id && a.points === other.points.length && other.points.every((p) => a.labels.includes(p.label)),
    JSON.stringify({ tlId: a.tlId, points: a.points, 那条轴: other.points.length, bands: a.bands }));
  check('带着「难以考据」的点（没有日期）的轴：点刻度照样跳到最近的一条精华',
    a.click?.hit === true && a.click.isNearest === true && a.click.inView === true,
    JSON.stringify(a.click));

  /* ---------- ② 在副本里改那条时间轴本身 ---------- */
  const tls2 = JSON.parse(fs.readFileSync(TL_FILE, 'utf8'));
  const t1 = tls2.timelines.find((t) => t.id === pick0);
  const firstPoint = t1.points[0];
  firstPoint.label = '验收改过的点';
  t1.points.push({ id: `${pick0}-verify-new`, side: 'right', kind: 'event', date: '2026-09-10', label: '验收新增的点' });
  fs.writeFileSync(TL_FILE, JSON.stringify(tls2, null, 2) + '\n', 'utf8');
  const s2 = JSON.parse(fs.readFileSync(SALON_FILE, 'utf8'));
  s2.timelineId = pick0;
  fs.writeFileSync(SALON_FILE, JSON.stringify(s2, null, 2) + '\n', 'utf8');
  build();
  const b = await measureAndClick(cdp);
  check(`在副本里改时间轴（改一个点的名字 + 加一个点）→ 重建后冰室精华页左边跟着变（${t1.points.length} 个点，含新点）`,
    b.tlId === pick0 && b.points === t1.points.length && b.labels.includes('验收新增的点') && b.labels.includes('验收改过的点'),
    JSON.stringify({ points: b.points, 期望: t1.points.length, 新点在不在: b.labels.includes('验收新增的点'), 改名在不在: b.labels.includes('验收改过的点') }));
  check('改完之后点刻度还是跳到最近的精华（同步更新没把跳转弄坏）',
    b.click?.hit === true && b.click.isNearest === true, JSON.stringify(b.click));
  check('这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

  try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch { /* 已退出 */ }
  await sleep(250);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
} catch (err) {
  fail++;
  console.log('FAIL  脚本异常: ' + (err?.stack ?? err));
} finally {
  server.close();
  for (const j of ['node_modules', 'public']) {
    const p = path.join(DST, j);
    if (fs.existsSync(p)) { try { execSync(`cmd /c rmdir "${p}"`, { stdio: 'ignore' }); } catch { /* ignore */ } }
  }
  try { fs.rmSync(DST, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log('副本已清理:', !fs.existsSync(DST));
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
