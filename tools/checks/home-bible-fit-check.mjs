/*
 * 首页「每日圣经」卡片：正文 / 评语在**任何窗口尺寸、任何一条圣经**下都不许出现半截字（2026-11-21）
 *
 * 站长原话：
 *   「评语下面还有很多空白空间 完全不需要收 保证正文占一半评语占一半即可 一样尽量占满」
 *   「下面评语应该到充满了荒诞的地…就结束了 不应该有红线指出的半截字
 *    还是要继续修复一下并确保其他圣经也不会出现这个问题」
 *
 * 半截字是怎么来的（记在这儿，免得以后再踩）：
 *   评语的盒子是 flex 分到的高度；卡片一旦装不下，盒子会伸到卡片内边界**外面**去，
 *   那半行就被 `.daily__card` 的 `overflow: hidden` 切掉。所以"能放几行"必须用
 *   「盒子高」和「卡片内边界到盒子上沿」两个里小的那个来算（见 `fitComment`），
 *   同时 `.daily__cols` 的行要钉成 `minmax(0, 1fr)`，不然两栏一起往下溢。
 *
 * 这里量的是**几何**，不是自己的样式值：
 *   ① 评语盒子的下沿必须 ≤ 卡片内容盒的下沿（露出来的字都在卡片里）；
 *   ② 盒子高度必须 ≥ clamp 的行数 × 行高（说明被 clamp 的整行都放得下，没在盒子里切）；
 *   ③ 正文同理；
 *   ④ 卡片本身不能溢出它那一栏；
 *   ⑤ 两栏的题头（头像 / 名字 / 时间）逐项一样大、同一水平线（站长同一天的另一条要求）。
 *
 * 用法：node tools/checks/home-bible-fit-check.mjs
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
const PORT = 4395;
const DEBUG_PORT = 9365;
const CHROME = chromePath();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg', '.xml': 'application/xml' };

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

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

const profile = path.join(process.env.TEMP ?? '.', `dsh-bfit-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu',
  '--enable-unsafe-swiftshader', '--hide-scrollbars', '--disable-breakpad',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });

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
        this.errors.push(`exception: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`);
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.errors.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
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
  async open(url) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${url}` });
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      if ((await this.ev('document.readyState')) === 'complete') break;
    }
    await this.ev(`(() => {
      const s = document.createElement('style');
      s.textContent = 'html{scroll-behavior:auto !important}';
      document.head.appendChild(s);
      return true;
    })()`);
    await sleep(1400);
  }
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

/** 量这一张圣经卡的几何：评语/正文有没有被切、卡片有没有溢出 */
const GEOM = `(() => {
  const card = document.querySelector('.daily__col--bible .daily__card');
  const essenceCard = document.querySelector('.daily__col--essence .daily__card');
  const frame = document.querySelector('.daily');
  if (!card) return null;
  const px = (v) => parseFloat(v) || 0;
  const innerBottom = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.bottom - px(cs.paddingBottom) - px(cs.borderBottomWidth);
  };
  const lineOf = (el) => {
    const cs = getComputedStyle(el);
    const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== 'none'
      ? Number(cs.webkitLineClamp)
      : Number(cs.getPropertyValue('-webkit-line-clamp')) || 0;
    return { lh: px(cs.lineHeight), clamp, h: el.getBoundingClientRect().height, bottom: el.getBoundingClientRect().bottom, hidden: el.hidden };
  };
  const text = card.querySelector('.daily__text');
  const note = card.querySelector('.daily__comment');
  const t = text ? lineOf(text) : null;
  const n = note && !note.hidden ? lineOf(note) : null;
  return {
    id: (card.getAttribute('href') || '').split('#')[1] || '',
    cardInnerBottom: innerBottom(card),
    cardBottom: card.getBoundingClientRect().bottom,
    cardOverflow: card.scrollHeight - card.clientHeight,
    text: t,
    note: n,
    noteHidden: !!note && note.hidden,
    frameInnerBottom: innerBottom(frame),
    /* 两栏题头是否逐项一样大、同一水平线 */
    heads: (() => {
      const one = (card) => {
        const who = card.querySelector('.daily__who');
        const av = card.querySelector('.daily__avatar');
        const nm = card.querySelector('.daily__name');
        const tm = card.querySelector('.daily__time');
        const box = (el) => (el ? el.getBoundingClientRect() : null);
        const fs = (el) => (el ? getComputedStyle(el).fontSize : null);
        const wr = box(who), ar = box(av);
        return {
          whoTop: wr ? Math.round(wr.top * 10) / 10 : null,
          whoH: wr ? Math.round(wr.height * 10) / 10 : null,
          avatarW: ar ? Math.round(ar.width * 10) / 10 : null,
          avatarH: ar ? Math.round(ar.height * 10) / 10 : null,
          nameFont: fs(nm), timeFont: fs(tm),
        };
      };
      return { essence: one(essenceCard), bible: one(card) };
    })(),
  };
})()`;

const SIZES = [
  [1920, 1200], [1600, 1000], [1440, 1090], [1440, 900],
  [1366, 768], [1280, 860], [1200, 800], [1100, 800], [1000, 760],
];

let totalStates = 0;
const cutStates = [];
const overflowStates = [];
const headBad = [];

for (const [w, h] of SIZES) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await cdp.open('/');
  const ids = await cdp.ev(`(async () => {
    const r = await fetch('/bellie.json');
    const j = await r.json();
    return (j.entries || []).map((e) => e.id);
  })()`);
  const seen = new Set();
  /* 每一条都看一遍：点「随机圣经」直到抽到目标那一条 */
  for (const want of ids) {
    for (let t = 0; t < 14; t++) {
      const cur = await cdp.ev(`(() => (document.querySelector('[data-bible-card]')?.getAttribute('href') || '').split('#')[1] || '')()`);
      if (cur === want) break;
      await cdp.ev(`(() => { document.querySelector('[data-bible-random]')?.click(); return true; })()`);
      await sleep(180);
    }
    const g = await cdp.ev(GEOM);
    if (!g) continue;
    totalStates++;
    seen.add(g.id);
    /* ① 评语：盒子下沿在卡片里；② 盒子够高，clamp 的整行都放得下 */
    if (g.note) {
      const cutOutside = g.note.bottom - g.cardInnerBottom > 0.5;
      const cutInside = g.note.h + 0.6 < g.note.clamp * g.note.lh;
      if (cutOutside || cutInside) {
        cutStates.push({ size: `${w}x${h}`, id: g.id, kind: cutOutside ? '评语伸出卡片' : '评语盒内切行',
          bottom: Math.round(g.note.bottom), cardInnerBottom: Math.round(g.cardInnerBottom),
          boxH: Math.round(g.note.h), need: Math.round(g.note.clamp * g.note.lh), clamp: g.note.clamp });
      }
    }
    /* 正文同样不许伸出卡片 */
    if (g.text && g.text.bottom - g.cardInnerBottom > 0.5) {
      cutStates.push({ size: `${w}x${h}`, id: g.id, kind: '正文伸出卡片',
        bottom: Math.round(g.text.bottom), cardInnerBottom: Math.round(g.cardInnerBottom) });
    }
    /* ④ 卡片不许溢出自己那一栏（溢出的部分会被帧裁掉） */
    if (g.cardBottom - g.frameInnerBottom > 0.5 || g.cardOverflow > 1) {
      overflowStates.push({ size: `${w}x${h}`, id: g.id, over: Math.round(g.cardBottom - g.frameInnerBottom), scroll: g.cardOverflow });
    }
    /* ⑤ 题头逐项一致 */
    const e = g.heads.essence;
    const b = g.heads.bible;
    if (!e || !b || Math.abs(e.whoTop - b.whoTop) > 0.6 || e.avatarW !== b.avatarW || e.avatarH !== b.avatarH
      || e.nameFont !== b.nameFont || e.timeFont !== b.timeFont) {
      headBad.push({ size: `${w}x${h}`, essence: e, bible: b });
    }
  }
  info(`${w}x${h}：${ids.length} 条都量过（${[...seen].join(',')}）`);
}

console.log('\n================ 结果 ================');
check('★ 每一种窗口尺寸都至少量到一条', totalStates > 0, `${totalStates} 个状态`);
check('★★ 没有任何一处出现半截字（评语/正文都不许伸出卡片内边界、盒子也必须够高）',
  cutStates.length === 0, cutStates.length ? JSON.stringify(cutStates.slice(0, 6)) : `${totalStates} 个状态全部干净`);
check('★★ 卡片本身没有溢出它那一栏（溢出的部分会被帧的 overflow 切掉）',
  overflowStates.length === 0, overflowStates.length ? JSON.stringify(overflowStates.slice(0, 6)) : '');
check('★★ 两栏题头逐项一样大、同一水平线（头像 / 名字 / 时间）',
  headBad.length === 0, headBad.length ? JSON.stringify(headBad.slice(0, 3)) : '全部一致');

/* 窄屏：单列，卡片按内容自然高度，量一遍别把评语压没 */
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
await cdp.open('/');
const mob = await cdp.ev(GEOM);
info(`窄屏：卡片 ${Math.round(mob.cardBottom - mob.cardInnerBottom)}px 内边距｜评语 ${mob.noteHidden ? '收起' : `clamp=${mob.note.clamp}`}`);
check('★ 窄屏卡片正常（不是被压成一条线），评语要么整条显示要么整条收起',
  mob.cardOverflow <= 1 && (!mob.note || mob.note.h + 0.6 >= mob.note.clamp * mob.note.lh),
  JSON.stringify({ clamp: mob.note?.clamp, h: mob.note && Math.round(mob.note.h), overflow: mob.cardOverflow }));

check('★ 全程没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { windowsHide: true, stdio: 'ignore' }); } catch { /* 已经退了 */ }
server.close();
await sleep(200);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 删不掉就算了 */ }

console.log(`\nPASS ${pass}   FAIL ${fail}`);
if (fail > 0) process.exit(1);
