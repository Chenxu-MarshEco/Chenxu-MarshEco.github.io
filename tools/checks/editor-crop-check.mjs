/*
 * 编辑器「截取图片」的界面级验收（2026-11-19 加）。
 *
 * 站长原话：「为网页编辑器所有上传图片的部分加一个功能 上传完图片以后可以点一个
 * 按钮进行截取 就像市面上大部分软件一样 点开后的页面有一个虚线框标记 可以自由
 * 缩放移动图片 最后只让对应的卡片或位置只显示虚线框以内的部分」
 *
 * 这支只量三件事，但都是**真浏览器 + 真落盘**：
 *   ① 每个图位都有「截取」按钮，没图时是灰的、有图才亮
 *   ② 点开之后是虚线框、八个把手、图在里面；拖框 / 拉把手 / 取消 / 再开一次都对
 *   ③ 点「确定」之后：地址换成 xxx-裁剪.webp、文件真落盘、像素尺寸和框对得上
 *
 * 全程副本（.tmp/crop-e2e）：public 是真拷贝（上传要真写文件），
 * node_modules 走 junction。工作区的 public/img/uploads 一个字节都不动。
 *
 * 用法：node tools/checks/editor-crop-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import sharp from 'sharp';
import { chromePath } from './lib/chrome.mjs';

const SRC = String.raw`D:\曼沫砾总线\Chenxu-MarshEco.github.io`;
const DST = path.join(SRC, '.tmp', 'crop-e2e');
const DEBUG_PORT = 9366;
const CHROME = chromePath();
const SAMPLE = '/img/salon/e0611-1.webp';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

/* ---------- 副本 ---------- */
if (fs.existsSync(DST)) {
  const nm = path.join(DST, 'node_modules');
  if (fs.existsSync(nm)) {
    try { execSync(`cmd /c rmdir "${nm}"`, { stdio: 'ignore', windowsHide: true }); } catch { /* 不是 junction */ }
  }
  fs.rmSync(DST, { recursive: true, force: true });
}
const skip = new Set(['node_modules', 'dist', '.git', '.tmp']);
fs.mkdirSync(DST, { recursive: true });
for (const e of fs.readdirSync(SRC, { withFileTypes: true })) {
  if (skip.has(e.name)) continue;
  fs.cpSync(path.join(SRC, e.name), path.join(DST, e.name), { recursive: true });
}
execSync(`cmd /c mklink /J "${path.join(DST, 'node_modules')}" "${path.join(SRC, 'node_modules')}"`, { stdio: 'ignore', windowsHide: true });
console.log('副本就绪:', DST);

/* ---------- 编辑器 ---------- */
const editor = spawn(process.execPath, [path.join(DST, 'tools', 'editor', 'server.mjs')], {
  cwd: DST, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
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
  console.log('FAIL  编辑器没起来：' + elog.slice(-600));
  process.exit(1);
}
info(`编辑器（副本）在 ${base}`);

/* ---------- 浏览器 ---------- */
const profile = path.join(process.env.TEMP ?? '.', `dsh-crop-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--enable-unsafe-swiftshader',
  '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' });

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
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
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
  async open(u, wait = 1200) {
    this.errors = [];
    await this.send('Page.navigate', { url: u });
    for (let i = 0; i < 120; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
  }
}

const until = async (expr, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await cdp.ev(expr).catch(() => false)) return true;
    await sleep(120);
  }
  return false;
};

let cdp = null;
try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* 还没起来 */ }
  }
  if (!target) throw new Error('浏览器没起来');
  cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.open(base + '/', 1600);

  /* ========== ① 封面上有按钮，没图时是灰的 ========== */
  const hasBtn = await cdp.ev(`!!document.getElementById('btn-cover-crop')`);
  check('★ 封面那一行多了「截取」按钮', hasBtn === true, String(hasBtn));

  await cdp.ev(`(() => {
    const i = document.getElementById('f-cover');
    i.value = '';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  const offWhenEmpty = await cdp.ev(`document.getElementById('btn-cover-crop').disabled`);
  check('★ 没有图的时候「截取」是灰的（点了也不该弹）', offWhenEmpty === true, String(offWhenEmpty));

  await cdp.ev(`(() => {
    const i = document.getElementById('f-cover');
    i.value = ${JSON.stringify(SAMPLE)};
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  const onWhenFilled = await cdp.ev(`document.getElementById('btn-cover-crop').disabled`);
  check('★ 填上图之后按钮就亮了', onWhenFilled === false, String(onWhenFilled));

  /* ========== ② 截取层 ========== */
  await cdp.ev(`document.getElementById('btn-cover-crop').click()`);
  const opened = await until(`!document.getElementById('crop-modal').hidden`);
  check('点了就打开截取层', opened === true);

  const ready = await until(`document.getElementById('crop-size').textContent.trim() !== ''`);
  check('图加载出来了、框也摆好了', ready === true);

  const look = await cdp.ev(`(() => {
    const box = document.getElementById('crop-box');
    const st = getComputedStyle(box);
    const r = box.getBoundingClientRect();
    const img = document.getElementById('crop-img');
    return {
      dashed: st.borderTopStyle,
      handles: box.querySelectorAll('.crop__h').length,
      w: Math.round(r.width),
      h: Math.round(r.height),
      nat: img.naturalWidth + 'x' + img.naturalHeight,
      shade: st.boxShadow.includes('9999px'),
      size: document.getElementById('crop-size').textContent.trim(),
    };
  })()`);
  check('★ 框是虚线的', look?.dashed === 'dashed', String(look?.dashed));
  check('★ 八个把手都在（四角 + 四边）', look?.handles === 8, String(look?.handles));
  check('框外面那圈被压暗了（一眼能看出只留框里那块）', look?.shade === true, String(look?.shade));
  check('图本身是按原图读进来的', /^800x/.test(look?.nat || ''), look?.nat);
  check('一开始的框差不多就是整张图', (look?.w || 0) > 60 && (look?.h || 0) > 60, JSON.stringify({ w: look?.w, h: look?.h }));

  /* ---- 拖框 ---- */
  const drag = await cdp.ev(`(() => {
    const box = document.getElementById('crop-box');
    const a = box.getBoundingClientRect();
    const mk = (t, x, y) => new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 7, pointerType: 'mouse', isPrimary: true });
    const cx = a.left + a.width / 2, cy = a.top + a.height / 2;
    box.dispatchEvent(mk('pointerdown', cx, cy));
    window.dispatchEvent(mk('pointermove', cx + 15, cy + 8));
    window.dispatchEvent(mk('pointerup', cx + 15, cy + 8));
    const b = box.getBoundingClientRect();
    return { dx: Math.round(b.left - a.left), dy: Math.round(b.top - a.top) };
  })()`);
  check('★ 框能拖（拖 15px 就往右 15px）', Math.abs((drag?.dx ?? 0) - 15) <= 2 && Math.abs((drag?.dy ?? 0) - 8) <= 2, JSON.stringify(drag));

  /* ---- 拉右下角把手 ---- */
  const beforeResize = await cdp.ev(`(() => { const r = document.getElementById('crop-box').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })()`);
  const afterResize = await cdp.ev(`(() => {
    const box = document.getElementById('crop-box');
    const h = box.querySelector('.crop__h--se');
    const hr = h.getBoundingClientRect();
    const mk = (t, x, y) => new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 8, pointerType: 'mouse', isPrimary: true });
    h.dispatchEvent(mk('pointerdown', hr.left + 6, hr.top + 6));
    window.dispatchEvent(mk('pointermove', hr.left + 6 - 40, hr.top + 6 - 26));
    window.dispatchEvent(mk('pointerup', hr.left + 6 - 40, hr.top + 6 - 26));
    const r = box.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  })()`);
  check('★ 拉右下角把手能把框缩小', (afterResize?.w || 0) < (beforeResize?.w || 0) && (afterResize?.h || 0) < (beforeResize?.h || 0),
    JSON.stringify({ beforeResize, afterResize }));

  /* ---- 换比例 ---- */
  const ratio = await cdp.ev(`(() => {
    const b = document.querySelector('.crop__ratio[data-ratio="1"]');
    b.click();
    const r = document.getElementById('crop-box').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  })()`);
  check('选 1:1 之后框是方的', Math.abs((ratio?.w || 0) - (ratio?.h || 0)) <= 2, JSON.stringify(ratio));

  /* ---- 取消（第一次） ---- */
  await cdp.ev(`document.querySelector('#crop-modal .modal__actions [data-crop-close]').click()`);
  const closed1 = await until(`document.getElementById('crop-modal').hidden`);
  const stillOld = await cdp.ev(`document.getElementById('f-cover').value`);
  check('取消之后层关掉、地址没动', closed1 === true && stillOld === SAMPLE, String(stillOld));

  /* ---- 再开一次还能关（一次性监听的回归） ---- */
  await cdp.ev(`document.getElementById('btn-cover-crop').click()`);
  await until(`!document.getElementById('crop-modal').hidden`);
  await until(`document.getElementById('crop-size').textContent.trim() !== ''`);
  await cdp.ev(`document.querySelector('#crop-modal .modal__mask').click()`);
  const closed2 = await until(`document.getElementById('crop-modal').hidden`);
  check('★ 第二次打开、点遮罩也关得掉（不是只灵一次）', closed2 === true);

  /* ========== ③ 确定之后真的落盘 ========== */
  await cdp.ev(`document.getElementById('btn-cover-crop').click()`);
  await until(`!document.getElementById('crop-modal').hidden`);
  await until(`document.getElementById('crop-size').textContent.trim() !== ''`);
  const boxSize = await cdp.ev(`document.getElementById('crop-size').textContent.trim()`);
  await cdp.ev(`document.querySelector('.crop__ratio[data-ratio="0"]').click()`);
  await cdp.ev(`document.getElementById('crop-ok').click()`);

  const gotNew = await until(`/-裁剪\\.webp$/.test(document.getElementById('f-cover').value)`, 20000);
  const newVal = await cdp.ev(`document.getElementById('f-cover').value`);
  check('★ 确定之后地址换成裁过的那张（xxx-裁剪.webp）', gotNew === true, String(newVal));

  const rel = String(newVal || '').replace(/^\//, '');
  const disk = path.join(DST, 'public', rel);
  const onDisk = fs.existsSync(disk);
  check('★ 裁出来的图真落盘了', onDisk, disk);

  if (onDisk) {
    const meta = await sharp(disk).metadata();
    const srcMeta = await sharp(path.join(DST, 'public', SAMPLE.replace(/^\//, ''))).metadata();
    info(`框里那块（按原图算）${boxSize}，落盘那张 ${meta.width}x${meta.height}，原图 ${srcMeta.width}x${srcMeta.height}`);
    check('★ 落盘那张比原图小（真的裁了，不是整张重存）',
      meta.width <= (srcMeta.width ?? 0) && meta.height <= (srcMeta.height ?? 0) &&
      (meta.width < (srcMeta.width ?? 0) || meta.height < (srcMeta.height ?? 0)),
      `${meta.width}x${meta.height} vs ${srcMeta.width}x${srcMeta.height}`);
    const [bw, bh] = String(boxSize || '').split('×').map((s) => Number(String(s).trim()));
    const tol = 2;
    check('裁出来的像素尺寸和框上写的一致',
      Math.abs((meta.width ?? 0) - bw) <= tol && Math.abs((meta.height ?? 0) - bh) <= tol,
      `框 ${bw}x${bh} / 图 ${meta.width}x${meta.height}`);
  }

  /* ========== ④ 别的图位也有（共享控件覆盖面） ========== */
  await cdp.ev(`window.__openWs('boards')`);
  await sleep(900);
  const boardCrop = await cdp.ev(`[...document.querySelectorAll('.boardedit__cover .boardedit__mini')]
    .filter((b) => b.textContent.trim() === '截取').length`);
  check('★ 版块树的封面 / 图标上也有「截取」', (boardCrop || 0) > 0, String(boardCrop));

  check('整场没有脚本报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));
} catch (err) {
  fail++;
  console.log('FAIL  半路炸了：' + (err?.message || err));
} finally {
  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  try { chrome.kill(); } catch { /* 忽略 */ }
  try { editor.kill(); } catch { /* 忽略 */ }
  process.exit(fail ? 1 : 0);
}
