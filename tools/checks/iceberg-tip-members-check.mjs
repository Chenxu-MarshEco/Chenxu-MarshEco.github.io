/*
 * ============================================================================
 * 冰山图那张悬停卡：描述里的**成员名**要能浮名片、能点进介绍页，
 * 而且**鼠标移进卡片之前卡片不消失**（2026-10-13 用户报的）
 * ----------------------------------------------------------------------------
 * 用户原话：
 *   「冰山图条目鼠标移上去后弹出的完备介绍卡片里如果出现成员名字 并不会有索引
 *    请你补上 并且保证鼠标移出卡片之前卡片不会消失以便查看到成员名字」
 *
 * 背景（为什么以前没有）：/iceberg/ 是 memlink **整页跳过**的
 * （见 astro.config 那段注释：条目文字里塞名片会把文字拆开、条目本身是链接时会套链接；
 *  而且条目自己已经有一张悬停卡）。现在换了个做法：**不动条目文字**，
 * 把描述另算一份链好名字的 HTML 放进 `data-desc-html`，让那张提示卡（独立浮层）去渲染。
 * 同时把提示卡的 `pointer-events` 打开 + 收起给 200ms 宽限 —— 鼠标才移得进去。
 *
 * 这个脚本用真浏览器量四件事：
 *   ① 条目文字**没有**被名片拆开（那一页照旧"整页跳过"，纯文本不变）；
 *   ② 悬停那张卡出现在条目上方，而且它的描述里**真有** `.mem` 标记；
 *   ③ 鼠标从条目挪到卡片上 → 卡片**不消失**（等过宽限期仍在）；
 *   ④ 挪到卡片里的成员名上 → 成员名片浮出来；挪走 → 两者都收起来。
 *
 * 用法：node tools/checks/iceberg-tip-members-check.mjs
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromePath } from './lib/chrome.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.join(SRC, 'dist');
const CHROME = chromePath();
const PORT = 4363;
const DEBUG_PORT = 9429;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

/* ---------------------------------------------------- 成员名（挑目标用） */
const salon = JSON.parse(fs.readFileSync(path.join(SRC, 'src', 'data', 'salon.json'), 'utf8'));
const memberNames = [...new Set((salon.members ?? []).map((m) => String(m?.name ?? '').trim()).filter((n) => n.length >= 2))]
  .sort((a, b) => b.length - a.length);

/* ------------------------------------------------------------------ 起服务 */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
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

const profile = path.join(process.env.TEMP ?? '.', `dsh-iceberg-tip-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

let ws = null;
try {
  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* 等 */ }
  }
  if (!target) throw new Error('无头 Chrome 没起来');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
  });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
    if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails?.text).slice(0, 120));
  });
  const send = (method, params = {}) => {
    const n = ++id;
    ws.send(JSON.stringify({ id: n, method, params }));
    return new Promise((resolve, reject) => pending.set(n, { resolve, reject }));
  };
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} :: ${String(expr).slice(0, 80)}`);
    return r.result.value;
  };
  /** 把指针移到某个坐标（真鼠标事件，页面才走 pointerover/enter） */
  const moveTo = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0, clickCount: 0 });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/iceberg/` });
  for (let i = 0; i < 150; i += 1) {
    await sleep(120);
    try {
      if ((await ev('document.readyState')) === 'complete') break;
    } catch { /* 还在导航 */ }
  }
  await sleep(900);

  /*
    在**页面里**挑目标并读属性（不要在 Node 端拿正则啃 HTML：`data-desc-html` 的值里
    带着 `&quot;` 和没转义的 `<span>`，正则很容易被截断 —— 2026-10-13 第一版就这么误判过）。
  */
  const hit = await ev(`(() => {
    const names = ${JSON.stringify(memberNames)};
    for (const el of document.querySelectorAll('.ibk__item')) {
      const desc = el.dataset.desc || '';
      if (!desc) continue;
      const memName = names.find((n) => desc.includes(n));
      if (!memName) continue;
      return {
        name: el.dataset.name || '',
        desc,
        memName,
        linkedHasMem: /class="mem/.test(el.dataset.descHtml || ''),
        linkedLen: (el.dataset.descHtml || '').length,
        descIsPlainText: !/<[a-z]/i.test(desc),
        hasMemInside: !!el.querySelector('.mem'),
      };
    }
    return null;
  })()`);
  check('页面里能挑到一个"描述里带成员名"的条目（挑不到就没法量）', Boolean(hit), hit ? `${hit.name}` : '一条都没有');
  if (!hit) throw new Error('没有可量的条目');
  info(`拿「${hit.name}」来量：描述 = ${hit.desc.slice(0, 42)}${hit.desc.length > 42 ? '…' : ''}`);
  check('★ 这一条带着链好名字的那份 HTML（data-desc-html 里有 .mem 名片标记）',
    hit.linkedHasMem === true, `长度 ${hit.linkedLen}`);
  check('★ 而**纯文本描述本身没被塞名片**（那一页照旧整页跳过，复制/读屏都不受影响）',
    hit.descIsPlainText === true && hit.hasMemInside === false,
    JSON.stringify({ 纯文本: hit.descIsPlainText, 条目里有名片: hit.hasMemInside }));

  /* 滚到那一条，拿到它的屏幕坐标 */
  const targetPos = await ev(`(() => {
    const el = [...document.querySelectorAll('.ibk__item')].find((x) => (x.dataset.name || '') === ${JSON.stringify(hit.name)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
             text: (el.textContent || '').trim().slice(0, 40) };
  })()`);
  check('页面里定位到了这一条（拿到悬停坐标）', Boolean(targetPos), JSON.stringify(targetPos));

  /* ① 悬停条目 → 卡片出来，描述里真有 .mem */
  await moveTo(targetPos.x, targetPos.y);
  await sleep(400);
  const tip1 = await ev(`(() => {
    const tip = document.querySelector('[data-ibk-tip]');
    const desc = tip?.querySelector('[data-tip-desc]');
    const r = tip?.getBoundingClientRect();
    const m = desc?.querySelector('.mem');
    return {
      shown: !!tip && !tip.hidden,
      descHtmlHasMem: !!m,
      memText: (m?.querySelector('.mem__text')?.textContent || '').trim(),
      hasCard: !!m?.querySelector('.mem__card'),
      tip: r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) } : null,
      mem: m ? (() => { const b = m.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })() : null,
    };
  })()`);
  info(`卡片：显示=${tip1.shown}，描述里有名片=${tip1.descHtmlHasMem}（${tip1.memText}），位置 ${JSON.stringify(tip1.tip)}`);
  check('★ 悬停条目：那张提示卡出来了', tip1.shown === true);
  check('★ 卡片描述里的成员名带着名片标记（.mem + .mem__card）',
    tip1.descHtmlHasMem && tip1.hasCard, JSON.stringify({ mem: tip1.memText, card: tip1.hasCard }));
  check('卡片没盖住条目自己（摆在它上方）', !!tip1.tip && tip1.tip.y < targetPos.y, `卡片 y=${tip1.tip?.y}，条目 y=${targetPos.y}`);

  /* ② 鼠标移进卡片 → 等过宽限期，卡片不能消失（用户报的那条） */
  await moveTo(tip1.tip.x, tip1.tip.y);
  await sleep(500);
  const stillOpen = await ev(`(() => { const t = document.querySelector('[data-ibk-tip]'); return !!t && !t.hidden; })()`);
  check('★ 鼠标移进卡片、等过收起宽限（500ms > 200ms）→ 卡片**仍在**', stillOpen === true);

  /* ③ 悬停卡片里的成员名 → 成员名片浮出来 */
  await moveTo(tip1.mem.x, tip1.mem.y);
  await sleep(600);
  const memCard = await ev(`(() => {
    const layer = document.querySelector('.memlayer');
    const card = layer?.querySelector('.mem__card');
    const r = card?.getBoundingClientRect();
    return {
      shown: !!card && getComputedStyle(card).display !== 'none' && !!r && r.width > 0,
      label: (card?.querySelector('.mem__label')?.textContent || '').trim(),
      tipStillOpen: (() => { const t = document.querySelector('[data-ibk-tip]'); return !!t && !t.hidden; })(),
    };
  })()`);
  info(`成员名片：显示=${memCard.shown}（${memCard.label}）；这时冰山卡还开着=${memCard.tipStillOpen}`);
  check('★ 悬停卡片里的成员名 → 成员名片浮出来', memCard.shown === true, JSON.stringify(memCard));
  check('★ 这时冰山那张卡也还开着（名片浮在它上面，两张不打架）', memCard.tipStillOpen === true);

  /* ④ 挪走 → 两张都收起来（宽限不能把它卡住） */
  await moveTo(20, 940);
  await sleep(700);
  const closed = await ev(`(() => {
    const tip = document.querySelector('[data-ibk-tip]');
    const card = document.querySelector('.memlayer .mem__card');
    return { tipHidden: !!tip && tip.hidden, memShown: !!card && getComputedStyle(card).display !== 'none' };
  })()`);
  check('★ 指针挪到别处 → 两张卡都收起来（宽限没有把它永久留住）',
    closed.tipHidden === true && closed.memShown === false, JSON.stringify(closed));

  check('全程没有 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | ') || '干净');
} catch (err) {
  fail += 1;
  console.log(`FAIL  ★ 脚本自己炸了：${err?.message || err}`);
} finally {
  try { ws?.close(); } catch { /* 忽略 */ }
  try { chrome.kill(); } catch { /* 忽略 */ }
  server.close();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome 还占着就算了 */ }
}

console.log('\n================ 结果 ================');
console.log(`PASS ${pass}   FAIL ${fail}`);
if (fail > 0) process.exit(1);
