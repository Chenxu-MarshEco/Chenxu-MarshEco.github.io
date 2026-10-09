/*
 * 临时：量"聊天区 vs 时间轴"的高度差（用户说右边比左边矮一大截、特别丑）。
 * 断言：桌面端两栏高度差 ≤ 8px；截图留一张；顺便量窄屏（那时轴在上面，日志限高 60vh）。
 * 用法：node .tmp/chat-height-check.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const SRC = String.raw`D:\曼沫砾总线\Chenxu-MarshEco.github.io`;
const ROOT = path.join(SRC, 'dist');
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const DEBUG_PORT = 9407;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8' };
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
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const profile = path.join(process.env.TEMP ?? '.', `dsh-chath-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
}

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};

const measure = `(() => {
  const q = (s) => document.querySelector(s);
  const h = (el) => (el ? Math.round(el.getBoundingClientRect().height) : -1);
  const w = (el) => (el ? Math.round(el.getBoundingClientRect().width) : -1);
  return {
    /* 量的是**两栏本身**（grid 子项）：rail 面板只是左边那栏里的一块，拿它比会差一截 */
    side: h(q('.lyt-chat__side')),
    rail: h(q('.lyt-chat__tl')),
    main: h(q('.lyt-chat__main')),
    log: h(q('.lyt-chat__log')),
    compose: h(q('.lyt-chat__compose')),
    logW: w(q('.lyt-chat__log')),
    overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
  };
})()`;

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {
      /* 等 */
    }
  }
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  for (const [label, width, height] of [['桌面 1280×900', 1280, 900], ['窄屏 390×780', 390, 780]]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/liyutang/chatroom/` });
    for (let i = 0; i < 120; i++) {
      await sleep(100);
      try {
        if ((await cdp.ev('document.readyState')) === 'complete') break;
      } catch {
        /* 等 */
      }
    }
    await sleep(1800);
    const m = await cdp.ev(measure);
    console.log(`${label}：轴 ${m.rail}px · 主栏 ${m.main}px · 聊天记录 ${m.log}px(${m.logW}px 宽) · 输入区 ${m.compose}px`);
    if (width >= 700) {
      check('★ 桌面端：两栏等高（左边栏 = 右边栏，差 ≤ 4px）', Math.abs(m.main - m.side) <= 4, `差 ${Math.abs(m.main - m.side)}px（左栏 ${m.side} / 右栏 ${m.main}）`);
      check('★ 时间轴那块面板也在左栏里（${m.rail}px ≤ ${m.side}px）', m.rail <= m.side + 1, '');
      check('★ 桌面端：聊天记录把剩下的高度都填了（日志 + 输入区 ≈ 主栏高）',
        Math.abs(m.log + m.compose + 12 - m.main) <= 24, `${m.log} + ${m.compose} + 间距 = ${m.log + m.compose}（主栏 ${m.main}）`);
      check('桌面端没有横向溢出', m.overflowX <= 1, `${m.overflowX}px`);
    } else {
      check('窄屏：轴在正文之上、日志自己限了高（≤60vh）', m.log <= Math.round(0.62 * 780), `${m.log}px`);
      check('窄屏没有横向溢出', m.overflowX <= 1, `${m.overflowX}px`);
    }
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(path.join(SRC, '.tmp', 'shots'), { recursive: true });
    fs.writeFileSync(path.join(SRC, '.tmp', 'shots', width >= 700 ? 'chat-height-desktop.png' : 'chat-height-mobile.png'), Buffer.from(shot.data, 'base64'));
  }
} catch (err) {
  fail++;
  console.log('FAIL ' + (err?.stack ?? err));
} finally {
  try {
    execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' });
  } catch {
    /* 已退 */
  }
  server.close();
  await sleep(200);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
