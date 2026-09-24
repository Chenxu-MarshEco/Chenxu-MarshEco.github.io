/*
 * 播放器在**后台标签页**里到底出不出声（用户 2026-09-24 反馈）。
 *
 * 用户原话：
 *   「网页在后台的时候如果停留在播放歌曲的界面 静音会失效 依然能播出歌曲」
 *
 * 量出来的根子（不是"静音开关坏了"，是"后台自己把音量抬起来了"）：
 *   · 进页面时 fade=0，音量本来是 0，靠淡入慢慢升到用户音量；
 *   · 淡入由 requestAnimationFrame 推进，而 **rAF 在后台标签页里不跑**；
 *   · `rampTo()` 有个 setTimeout 兜底，它在后台照样到点，一到点就把 fade 推到 1
 *     并 `applyVol()`。实测：后台加载第 1.9 秒音量 0 → 0.7、audible false → true，
 *     这一页从没被用户看过、也没有任何手势 —— 歌就自己响起来了。
 *
 * 这个检查同时守住"别把功能改坏"的那一半：**正在听歌的人切到别的标签页，
 * 歌必须继续放**（那是这个播放器存在的意义），后台自动换下一首也不能哑掉。
 *
 * 浏览器带 `--autoplay-policy=no-user-gesture-required` 启动：这是"回访者、
 * 浏览器允许直接出声"的那种情况 —— 也正是上面那条会真的响起来的情况
 * （默认策略下 play() 会被拒，根本放不出来，量不到）。
 * `audible` 是**按元素状态算的**（没暂停 + 没 element 静音 + 音量 > 0），
 * 也就是站点自己唯一能控制的那部分；headless 里真不真响不影响这个判据。
 *
 * 用法：node tools/checks/music-background-mute-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const root = path.resolve('dist');
const PORT = 4455;
const DEBUG_PORT = 9425;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
};
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
    const f = path.join(root, t);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream' });
      return fs.createReadStream(f).pipe(res);
    }
  }
  res.writeHead(404);
  res.end('404');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = path.join(process.env.TEMP ?? '.', `dsh-mutebg-${Date.now()}`);
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--disable-breakpad', '--window-size=1440,900', '--autoplay-policy=no-user-gesture-required',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank',
], { stdio: 'ignore' });

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
      if (m.method === 'Runtime.exceptionThrown') {
        this.errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
      }
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
  async tryEv(e) { try { return await this.ev(e); } catch { return undefined; } }
}

let cdp = null;
for (let i = 0; i < 80 && !cdp; i++) {
  await sleep(250);
  try {
    const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const page = l.find((t) => t.type === 'page');
    if (page) cdp = await CDP.attach(page.webSocketDebuggerUrl);
  } catch { /* 还没起来 */ }
}
if (!cdp) { console.error('Chromium 没起来'); process.exit(2); }
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

const PROBE = `(() => {
  const a = document.getElementById('music-audio');
  const btn = document.getElementById('music-vol-btn');
  let flag = null;
  try { flag = JSON.parse(localStorage.getItem('huajiantang.music.volume') || 'null'); } catch (e) {}
  if (!a) return null;
  return {
    vis: document.visibilityState,
    elMuted: a.muted,
    volume: Math.round(a.volume * 100) / 100,
    paused: a.paused,
    flag: flag ? flag.muted : null,
    title: btn ? (btn.title || '').split(' · ')[0] : '',
    /* 站点唯一能控制的那部分：能不能听见 */
    audible: !a.paused && !a.muted && a.volume > 0.001,
  };
})()`;

const state = () => cdp.tryEv(PROBE);
/**
 * 盯一段时间，返回这段时间里"听见过声"的帧和最大音量。
 * 每 250ms 采一次 —— 后台那个 bug 是靠定时器起来的，采样够密才抓得到。
 */
const watch = async (seconds) => {
  const seen = [];
  let maxVol = 0;
  let frames = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000) {
    const s = await state();
    if (s) {
      frames++;
      if (s.volume > maxVol) maxVol = s.volume;
      if (s.audible) seen.push(s);
    }
    await sleep(250);
  }
  return { frames, maxVol, audibleFrames: seen.length, first: seen[0] ?? null, last: await state() };
};

const goto = async (p, wait = 0) => {
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
  for (let i = 0; i < 200; i++) { await sleep(100); if ((await cdp.tryEv('document.readyState')) === 'complete') break; }
  if (wait) await sleep(wait);
};

let other = null;
/** 开一个新标签页并把它切到前台 → 原来那一页真的进了后台 */
const background = async () => {
  if (!other) {
    const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' });
    const t = await r.json();
    other = await CDP.attach(t.webSocketDebuggerUrl);
  }
  await other.send('Page.bringToFront');
  await sleep(450);
  return cdp.tryEv('document.visibilityState');
};
const foreground = async () => {
  await cdp.send('Page.bringToFront');
  await sleep(450);
  return cdp.tryEv('document.visibilityState');
};
const setFlag = (muted) =>
  cdp.ev(`localStorage.setItem('huajiantang.music.volume', JSON.stringify({ v: 0.7, muted: ${muted} }))`);
const clickBlank = async () => {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 320, buttons: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 700, y: 320, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(40);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 700, y: 320, button: 'left', clickCount: 1, buttons: 0 });
  await sleep(600);
};
const clickVolBtn = async () => {
  const r = await cdp.ev(`(() => { const b = document.getElementById('music-vol-btn'); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y, buttons: 0 });
  await sleep(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(40);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1, buttons: 0 });
  await sleep(600);
};

/* 先站到站点源上（about:blank 里读不了 localStorage） */
await goto('/', 900);
await setFlag(false);

/* ---------------- ① 前台加载：正常就该听得见 ---------------- */
console.log('\n================ ① 前台加载（正常听歌）================');
await cdp.send('Page.bringToFront');
await goto('/', 300);
const front = await watch(6);
console.log('  前台 6 秒：', JSON.stringify(front.first), '→', JSON.stringify(front.last));
check('★ 前台正常放歌：元素状态是"听得见"（没把功能改坏）', front.audibleFrames > 0,
  `听得见的帧 ${front.audibleFrames}/${front.frames}，最大音量 ${front.maxVol}`);
check('前台音量到了用户设定的 0.7', front.maxVol > 0.5, `maxVol=${front.maxVol}`);

/* ---------------- ② 后台加载：不该出声（★ 就是这一条）---------------- */
console.log('\n================ ② 后台加载（★ 用户报的那条）================');
await setFlag(false);
const vis1 = await background();
check('后台是真的后台（visibilityState = hidden）', vis1 === 'hidden', String(vis1));
await goto('/', 200);
const bg = await watch(12);
console.log('  后台 12 秒：', JSON.stringify(bg.first), '→', JSON.stringify(bg.last));
check('★ 页面在后台加载：12 秒里一次都没出声（音量守在 0，不是靠 element 静音兜着）',
  bg.audibleFrames === 0 && bg.last && bg.last.volume === 0,
  `听得见的帧 ${bg.audibleFrames}/${bg.frames}，最大音量 ${bg.maxVol}，当前 ${JSON.stringify(bg.last)}`);
check('后台加载时音频确实在放着（不是"没放所以没声"——那样只是把功能关了）',
  !!bg.last && bg.last.paused === false && bg.last.vis === 'hidden',
  bg.last ? `paused=${bg.last.paused} t=${bg.last.time ?? '-'}` : 'no state');

/* ---------------- ③ 切回前台：音量补回来，能听见 ---------------- */
console.log('\n================ ③ 切回前台 ================');
const vis2 = await foreground();
check('切回前台（visibilityState = visible）', vis2 === 'visible', String(vis2));
const afterFront = await watch(4);
console.log('  切回前台 4 秒：', JSON.stringify(afterFront.last));
check('★ 切回前台之后能听见了（用户不用再点一下）', afterFront.audibleFrames > 0,
  `听得见的帧 ${afterFront.audibleFrames}/${afterFront.frames}，音量 ${afterFront.last?.volume}`);

/* ---------------- ④ 正在听 → 切后台：必须继续听 ---------------- */
console.log('\n================ ④ 正在听歌 → 切到别的标签页 ================');
const vis3 = await background();
check('切后台（visibilityState = hidden）', vis3 === 'hidden', String(vis3));
const listenBg = await watch(6);
console.log('  后台 6 秒：', JSON.stringify(listenBg.last));
check('★ 正在听歌的人切走：后台照样出声（不能因为切标签页把歌掐了）',
  listenBg.audibleFrames === listenBg.frames && listenBg.audibleFrames > 0,
  `听得见的帧 ${listenBg.audibleFrames}/${listenBg.frames}`);

/* ---------------- ⑤ 后台自动换下一首：也不能哑 ---------------- */
console.log('\n================ ⑤ 后台里"这首放完"→ 自动下一首 ================');
await cdp.ev(`(() => { document.getElementById('music-audio').dispatchEvent(new Event('ended')); return true; })()`);
const nextBg = await watch(8);
console.log('  换歌后 8 秒：', JSON.stringify(nextBg.first), '→', JSON.stringify(nextBg.last));
check('★ 后台自动换下一首之后照样出声（新歌不能哑在音量 0）',
  nextBg.audibleFrames > 0 && nextBg.last && nextBg.last.volume > 0.5,
  `听得见的帧 ${nextBg.audibleFrames}/${nextBg.frames}，最大音量 ${nextBg.maxVol}`);

/* ---------------- ⑥ 静音状态 + 后台：静音是最高优先 ---------------- */
console.log('\n================ ⑥ 已静音 + 后台加载 ================');
await setFlag(true);
await background();
await goto('/', 200);
const mutedBg = await watch(10);
console.log('  后台 10 秒：', JSON.stringify(mutedBg.first), '→', JSON.stringify(mutedBg.last));
check('★ 已静音时后台加载：一次都没出声，音量守在 0',
  mutedBg.audibleFrames === 0 && mutedBg.last && mutedBg.last.volume === 0,
  `听得见的帧 ${mutedBg.audibleFrames}/${mutedBg.frames}，最大音量 ${mutedBg.maxVol}`);
check('已静音时页面上写着「已静音」', mutedBg.last && String(mutedBg.last.title).includes('已静音'),
  String(mutedBg.last?.title));

/* ---------------- ⑦ 静音 + 后台换歌：还是不许出声 ---------------- */
console.log('\n================ ⑦ 已静音 + 后台换歌 ================');
await cdp.ev(`(() => { document.getElementById('music-audio').dispatchEvent(new Event('ended')); return true; })()`);
const mutedNext = await watch(8);
console.log('  换歌后 8 秒：', JSON.stringify(mutedNext.last));
check('★ 静音状态下后台换歌：依旧一声不响',
  mutedNext.audibleFrames === 0 && mutedNext.last && mutedNext.last.volume === 0,
  `听得见的帧 ${mutedNext.audibleFrames}/${mutedNext.frames}`);

/* ---------------- ⑧ 回到前台点音量键：解除静音要真的出声 ---------------- */
console.log('\n================ ⑧ 回到前台 → 点音量键解除静音 ================');
await foreground();
await watch(1);
const beforeClick = await state();
await clickVolBtn();
const afterClick = await watch(3);
console.log('  点之前：', JSON.stringify(beforeClick));
console.log('  点之后：', JSON.stringify(afterClick.last));
check('★ 点一下音量键：静音解除，界面说的和元素实际做的一致',
  !!afterClick.last && afterClick.last.flag === false && afterClick.last.volume > 0.5 &&
    afterClick.audibleFrames > 0,
  `volume ${beforeClick?.volume} → ${afterClick.last?.volume}，标题「${afterClick.last?.title}」`);

check('这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

try { await cdp.send('Browser.close'); } catch { /* ignore */ }
chrome.kill();
server.close();
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* ignore */ }

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
