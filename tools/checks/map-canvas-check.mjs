/* 地图工作台往返验收（2026-11-02）：只走 DOM（app.js 是 ES module，函数不在 window 上）。
   开面板 → 底图加载 → 连点两笔 → 完成 → 保存 → 文件里是整数方块坐标且在范围内 → 重开还在。
   跑法：node tools/checks/map-canvas-check.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromePath } from './lib/chrome.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DST = path.join(SRC, '.tmp', 'map-canvas-copy');
const PORT = 4613;
const DBG = 9403;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`); };
const info = (s) => console.log(`      · ${s}`);

if (fs.existsSync(DST)) {
  const j = path.join(DST, 'node_modules');
  if (fs.existsSync(j)) { try { execSync(`cmd /c rmdir "${j}"`, { stdio: 'ignore', windowsHide: true }); } catch { /* ignore */ } }
  fs.rmSync(DST, { recursive: true, force: true });
}
fs.mkdirSync(DST, { recursive: true });
for (const it of ['src', 'tools', 'astro.config.mjs', 'package.json', 'tsconfig.json']) fs.cpSync(path.join(SRC, it), path.join(DST, it), { recursive: true });
fs.mkdirSync(path.join(DST, 'public/img/opt'), { recursive: true });
fs.copyFileSync(path.join(SRC, 'public/img/opt/manifest.json'), path.join(DST, 'public/img/opt/manifest.json'));
fs.cpSync(path.join(SRC, 'public/img/maps'), path.join(DST, 'public/img/maps'), { recursive: true });
execSync(`cmd /c mklink /J "${path.join(DST, 'node_modules')}" "${path.join(SRC, 'node_modules')}"`, { stdio: 'ignore', windowsHide: true });

const dataFile = path.join(DST, 'src/data/maps.json');
const before = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const m0 = before.maps.find((m) => m.id === 'huaya-superflat');
const n0 = (m0.roads ?? []).length;
info(`图 ${m0.id}：原点(${m0.originX},${m0.originZ}) ${m0.blocksPerPixel} 块/px，已有 ${n0} 条`);

const editor = spawn(process.execPath, [path.join(DST, 'tools/editor/server.mjs'), '--port', String(PORT)], { cwd: DST, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let log = '';
editor.stdout.on('data', (b) => { log += b; });
editor.stderr.on('data', (b) => { log += b; });
const profile = path.join(process.env.TEMP ?? '.', `dsh-mc-${Date.now()}`);
const chrome = spawn(chromePath(), ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DBG}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });

let ws = null;
try {
  let base = '';
  for (let i = 0; i < 300 && !base; i += 1) { await sleep(150); const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(log); if (m) base = `http://127.0.0.1:${m[1]}`; }
  check('副本编辑器起得来', Boolean(base), base || log.slice(-120));
  let tg = null;
  for (let i = 0; i < 60 && !tg; i += 1) { await sleep(250); try { const l = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json(); tg = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl); } catch { /* 等 */ } }
  if (!tg) throw new Error('Chrome 没起来');
  ws = new WebSocket(tg.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('ws')), { once: true }); });
  let id = 0;
  const pend = new Map();
  const errs = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(String(m.params.exceptionDetails?.text).slice(0, 100));
  });
  const send = (method, params = {}) => { const n = ++id; ws.send(JSON.stringify({ id: n, method, params })); return new Promise((resolve, reject) => pend.set(n, { resolve, reject })); };
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`);
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: base });
  for (let i = 0; i < 160; i += 1) { await sleep(120); try { if ((await ev('document.readyState')) === 'complete') break; } catch { /* 导航 */ } }
  await sleep(1500);

  /* 工作台菜单是**点开才铺**的（buildHubMenu 在打开菜单时跑），所以先点顶栏那颗按钮 */
  await ev(`document.getElementById('btn-hub').click()`);
  await sleep(500);
  check('工作台菜单里有「地图」', (await ev(`!!document.querySelector('.hubmenu__btn[data-ws="maps"]')`)) === true);
  await ev(`document.querySelector('.hubmenu__btn[data-ws="maps"]').click()`);
  await sleep(1500);
  const open = await ev(`(() => {
    const img = document.getElementById('mp-img');
    const sel = document.getElementById('mp-map');
    const c = document.getElementById('mp-canvas').getBoundingClientRect();
    return { shown: !document.getElementById('mapsModal').hidden, n: sel ? sel.options.length : 0, cur: sel ? sel.value : '',
      img: !!img && img.complete && img.naturalWidth > 0, rows: document.querySelectorAll('#mp-roads .mp-row').length,
      c: { x: Math.round(c.left), y: Math.round(c.top), w: Math.round(c.width), h: Math.round(c.height) } };
  })()`);
  check('★ 面板开、下拉两项、底图加载、列表有样例', open.shown && open.n >= 2 && open.cur === 'huaya-superflat' && open.img && open.rows === n0, JSON.stringify(open));

  await ev(`document.getElementById('mp-road').click()`);
  await sleep(300);
  const p1 = { x: open.c.x + Math.round(open.c.w * 0.42), y: open.c.y + Math.round(open.c.h * 0.5) };
  const p2 = { x: open.c.x + Math.round(open.c.w * 0.52), y: open.c.y + Math.round(open.c.h * 0.58) };
  for (const p of [p1, p2]) {
    for (const [type, btn, btns] of [['mouseMoved', 'none', 0], ['mousePressed', 'left', 1], ['mouseReleased', 'left', 0]]) {
      await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: btn, buttons: btns, clickCount: type === 'mouseMoved' ? 0 : 1 });
      await sleep(120);
    }
  }
  await sleep(400);
  const pn = await ev(`(() => { const el = [...document.querySelectorAll('#mp-tools .btn')].find((b) => /完成/.test(b.textContent)); const m = /完成（(\\d+) 点）/.exec(el ? el.textContent : ''); return m ? Number(m[1]) : 0; })()`);
  check('★ 画布连点两下 → 2 个点', pn === 2, String(pn));
  await ev(`[...document.querySelectorAll('#mp-tools .btn')].find((b) => /完成/.test(b.textContent)).click()`);
  await sleep(400);
  check('★ 完成 → 列表多一条', (await ev(`document.querySelectorAll('#mp-roads .mp-row').length`)) === n0 + 1);
  await ev(`document.getElementById('mp-save').click()`);
  await sleep(1800);
  const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8')).maps.find((m) => m.id === 'huaya-superflat');
  const road = (saved.roads ?? []).find((r) => !(m0.roads ?? []).some((x) => x.id === r.id));
  check('★ 保存后文件里多了一条路线', Boolean(road), road ? JSON.stringify(road.points) : '没有');
  if (road) {
    const bpp = m0.blocksPerPixel;
    check('★ 整数方块坐标 + 在地图范围内', road.points.length >= 2 && road.points.every(([wx, wz]) => Number.isInteger(wx) && Number.isInteger(wz)
      && wx >= m0.originX && wx < m0.originX + m0.width * bpp && wz >= m0.originZ && wz < m0.originZ + m0.height * bpp), JSON.stringify(road.points));
    const shot = await ev(`(() => { const i = document.getElementById('mp-inner').getBoundingClientRect(); const img = document.getElementById('mp-img'); return { z: i.width / (img.naturalWidth || 1), left: i.left, top: i.top }; })()`);
    const sx = shot.left + ((road.points[0][0] - m0.originX) / bpp) * shot.z;
    const sy = shot.top + ((road.points[0][1] - m0.originZ) / bpp) * shot.z;
    const tol = 3 * Math.max(1, shot.z);
    check('★ 方块坐标算回屏幕 ≈ 点下去的位置（锚定成立）', Math.abs(sx - p1.x) <= tol && Math.abs(sy - p1.y) <= tol,
      `算 ${sx.toFixed(0)},${sy.toFixed(0)} / 点 ${p1.x},${p1.y}（容差 ${tol.toFixed(1)}）`);
  }
  await ev(`document.getElementById('mp-close').click()`);
  await sleep(400);
  await ev(`document.getElementById('btn-hub').click()`);
  await sleep(400);
  await ev(`document.querySelector('.hubmenu__btn[data-ws="maps"]').click()`);
  await sleep(1500);
  const again = await ev(`(() => ({ shown: !document.getElementById('mapsModal').hidden, rows: document.querySelectorAll('#mp-roads .mp-row').length }))()`);
  check('★ 关掉重开：刚画的那条还在', again.shown === true && again.rows === n0 + 1, JSON.stringify(again));
  check('无 JS 异常', errs.length === 0, errs.slice(0, 2).join(' | ') || '干净');
} catch (err) {
  fail += 1;
  console.log(`FAIL  ★ 脚本自己炸了：${err?.message || err}`);
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  try { chrome.kill(); } catch { /* ignore */ }
  try { editor.kill(); } catch { /* ignore */ }
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}
console.log(`\n================ 结果 ================\nPASS ${pass}   FAIL ${fail}`);
if (fail > 0) process.exit(1);
