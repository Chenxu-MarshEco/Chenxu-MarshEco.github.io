/*
 * 诊断（不带断言）：把「后台」这件事对播放器的影响按时间线录下来。
 * 有断言的验收在 music-background-mute-check.mjs；这个是"量给人看"的那一份 ——
 * 2026-09-24 那次「后台静音失效」就是靠它把范围缩到"淡入的兜底定时器在后台到点"上的。
 * 每 250ms 采一次，只打印状态**变化**的那几帧：{vis, elMuted, volume, paused, flag}
 * 关注点：flag.muted = true 的时候，volume 有没有被谁从 0 抬起来（那就是"静音失效"）。
 *
 * 用法：node tools/checks/music-background-dbg.mjs [--allow-autoplay]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const root = path.resolve('dist');
const PORT = 4444;
const DEBUG_PORT = 9414;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const ALLOW = process.argv.includes('--allow-autoplay');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
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

const args = ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--disable-breakpad', '--window-size=1440,900'];
if (ALLOW) args.push('--autoplay-policy=no-user-gesture-required');
const profile = path.join(process.env.TEMP ?? '.', `dsh-mute2-${Date.now()}`);
const chrome = spawn(CHROME, [...args, `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
  { stdio: 'ignore' });

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
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
  return { vis: document.visibilityState, elMuted: a.muted, volume: Math.round(a.volume * 100) / 100,
           paused: a.paused, t: Math.round((a.currentTime || 0) * 10) / 10,
           flag: flag ? flag.muted : null, title: btn ? (btn.title || '').split(' · ')[0] : '', audible: !a.paused && !a.muted && a.volume > 0.001 };
})()`;

/** 录一段时间线，只打印变化的帧 */
const watch = async (label, seconds) => {
  console.log(`  ── ${label} ──`);
  let prev = '';
  const t0 = Date.now();
  let worst = null;
  while (Date.now() - t0 < seconds * 1000) {
    const s = await cdp.tryEv(PROBE);
    if (s) {
      const key = JSON.stringify([s.vis, s.elMuted, s.volume, s.paused, s.flag, s.title, s.audible]);
      if (key !== prev) {
        prev = key;
        console.log(`     +${((Date.now() - t0) / 1000).toFixed(1)}s ${JSON.stringify(s)}`);
      }
      if (s.audible && (s.flag === true || s.vis === 'hidden')) worst = s;
    }
    await sleep(250);
  }
  return worst;
};

let other = null;
const background = async () => {
  if (!other) {
    const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' });
    const t = await r.json();
    other = await CDP.attach(t.webSocketDebuggerUrl);
  }
  await other.send('Page.bringToFront');
  await sleep(500);
  return cdp.tryEv('document.visibilityState');
};
const foreground = async () => { await cdp.send('Page.bringToFront'); await sleep(500); return cdp.tryEv('document.visibilityState'); };
const setFlag = (muted) => cdp.ev(`localStorage.setItem('huajiantang.music.volume', JSON.stringify({ v: 0.7, muted: ${muted} }))`);

console.log(`\n### 自动播放策略：${ALLOW ? '允许直接出声（回访者 MEI 那种）' : '浏览器默认（要用户手势）'}`);

/* 先站到站点源上：about:blank 里读不了 localStorage */
await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
for (let i = 0; i < 200; i++) { await sleep(100); if ((await cdp.tryEv('document.readyState')) === 'complete') break; }
await sleep(800);

/* ---------- A：已经设成"静音"，页面在后台加载 ---------- */
console.log('\n【A】flag.muted=true，页面**在后台**加载');
await setFlag(true);
await background();
await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
const badA = await watch('后台加载后 12 秒', 12);
console.log('  结果：' + (badA ? `★ 后台出声了 ${JSON.stringify(badA)}` : '一直没出声（符合预期）'));
console.log('  切回前台：', await foreground());
await watch('切回前台后 3 秒', 3);

/* ---------- B：flag.muted=false（正常用户），页面在后台加载 ---------- */
console.log('\n【B】flag.muted=false，页面**在后台**加载（这条是"后台自己出声"嫌疑）');
await setFlag(false);
await background();
await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/huaya/bingshi/` });
const badB = await watch('后台加载后 12 秒', 12);
console.log('  结果：' + (badB ? `后台自己出声了 → ${JSON.stringify(badB)}` : '没有出声'));
console.log('  切回前台：', await foreground());
await watch('切回前台后 4 秒', 4);

/* ---------- C：前台听着，点静音，切后台，让它换歌 ---------- */
console.log('\n【C】前台放着 → 点静音 → 切后台 → 后台里"这一首放完"换下一首');
await cdp.send('Page.bringToFront');
await sleep(300);
/* 先用一次手势把声音放出来 */
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 300, buttons: 0 });
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 700, y: 300, button: 'left', clickCount: 1, buttons: 1 });
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 700, y: 300, button: 'left', clickCount: 1, buttons: 0 });
await sleep(1500);
const beforeMute = await cdp.tryEv(PROBE);
console.log('  点页面之后：', JSON.stringify(beforeMute));
const btnRect = await cdp.ev(`(() => { const b = document.getElementById('music-vol-btn'); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
const clickBtn = async () => {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: btnRect.x, y: btnRect.y, buttons: 0 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btnRect.x, y: btnRect.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(40);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btnRect.x, y: btnRect.y, button: 'left', clickCount: 1, buttons: 0 });
  await sleep(500);
};
await clickBtn();
console.log('  点了音量键：', JSON.stringify(await cdp.tryEv(PROBE)));
console.log('  切后台：', await background());
/* 换歌：直接派发 ended —— 播放器就是靠 audio 的 ended 事件换下一首的。
   （不推 currentTime：headless 里 duration 有时是 NaN，推不动。） */
await cdp.ev(`(() => {
  const a = document.getElementById('music-audio');
  a.dispatchEvent(new Event('ended'));
  return { dur: a.duration, src: (a.getAttribute('src') || '').split('/').pop() };
})()`).then((v) => console.log('  派发 ended（换下一首）：', JSON.stringify(v)));
const badC = await watch('后台里换歌之后 12 秒', 12);
console.log('  结果：' + (badC ? `★ 静音状态下后台出声了 ${JSON.stringify(badC)}` : '一直没出声（符合预期）'));

/* ---------- D：静音状态下，用户在后台之前按一下音量键（意图不明的那一下） ---------- */
console.log('\n【D】flag.muted=true 时，页面在后台，回到前台点一下音量键');
await foreground();
await watch('回到前台 3 秒', 3);
await clickBtn();
console.log('  点了一下音量键：', JSON.stringify(await cdp.tryEv(PROBE)));
await watch('之后 4 秒', 4);

try { await cdp.send('Browser.close'); } catch { /* ignore */ }
chrome.kill();
server.close();
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* ignore */ }
