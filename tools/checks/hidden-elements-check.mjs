/*
 * 「设了 hidden 却又看得见」的体检。
 *
 * 起因（2026-09-22，用户报的）：
 *   首页「每日精华」上方那颗「回到每日精华」按钮，明明设了 `hidden`，屏幕上还在。
 *   根因是 CSS 层叠：作者样式里 `.daily__act { display: inline-flex }` **压过**浏览器
 *   自带的 `[hidden] { display: none }`（作者样式永远赢 UA 样式），所以只设属性 = 没藏。
 *   这类 bug 光看"属性设上了没"是看不出来的，只能**看排版** —— 所以这个脚本就干这一件事：
 *   打开页面，把每一个带 hidden 属性的元素找出来，看它到底还有没有盒子。
 *
 * 跑两遍：
 *   ① 开着 JS（页面自己会切换不少 hidden）
 *   ② 关掉 JS（只看 CSS 兜底对不对：没有 JS 时不该有任何"该藏没藏"的元素）
 *
 * 用法：node tools/checks/hidden-elements-check.mjs [dist目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
const PORT = 4410;
const DEBUG_PORT = 9380;
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

const PAGES = ['/', '/salon/', '/iceberg/', '/about-me/', '/huaya/'];

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

const profile = path.join(process.env.TEMP ?? '.', `dsh-hidden-${Date.now()}`);
const chrome = spawn(
  CHROME,
  ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
   '--disable-breakpad', '--window-size=1440,900', `--user-data-dir=${profile}`,
   `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
  { stdio: 'ignore' }
);

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
  async goto(p, wait = 1500) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 150; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
  }
}

let cdp = null;
for (let i = 0; i < 80 && !cdp; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    if (page) cdp = await CDP.attach(page.webSocketDebuggerUrl);
  } catch { /* 还没起来 */ }
}
if (!cdp) { console.error('Chromium 没起来'); process.exit(2); }
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

/*
  找出"带 hidden 属性、排版上却还占着位置"的元素。
  只看真实的盒子（getClientRects）—— 这正好是当年那条断言漏掉的那一半。
  再加一道**点得到吗**：有些元素虽然自己有盒子，但被祖先裁掉/visibility:hidden 了，
  那种不算"看得见"。只有既占位、又在那个坐标上命中它自己，才算真的露在屏幕上。
*/
const AUDIT = `(() => {
  const out = [];
  const laid = [];
  for (const el of document.querySelectorAll('[hidden]')) {
    if (el.tagName === 'TEMPLATE') continue;
    if (el.getClientRects().length === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const inView = cx > 0 && cy > 0 && cx < innerWidth && cy < innerHeight && r.width > 0 && r.height > 0;
    const hitEl = inView ? document.elementFromPoint(cx, cy) : null;
    const hit = !!(hitEl && (hitEl === el || el.contains(hitEl)));
    const row = {
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 46),
      id: el.id || '',
      display: cs.display,
      w: Math.round(r.width),
      h: Math.round(r.height),
      inView,
      hit,
      parentCls: String((el.parentElement && el.parentElement.className) || '').slice(0, 40),
    };
    laid.push(row);
    if (hit) out.push(row);
  }
  return {
    total: document.querySelectorAll('[hidden]').length,
    laidCount: laid.length, laid: laid.slice(0, 8),
    bad: out.slice(0, 8), badCount: out.length,
  };
})()`;

/* ---------------- ① 开着 JS ---------------- */
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
console.log('================ ① 开着 JS ================');
for (const p of PAGES) {
  await cdp.goto(p, p === '/salon/' ? 2200 : 1500);
  const a = await cdp.ev(AUDIT);
  console.log(`${p}  带 hidden 的元素 ${a.total} 个：还占着位置的 ${a.laidCount} 个、其中**真露在屏幕上**的 ${a.badCount} 个`);
  for (const b of a.laid) console.log(`     <${b.tag} class="${b.cls}" id="${b.id}"> display=${b.display} ${b.w}×${b.h} 在视口=${b.inView} 点得到=${b.hit}（父 ${b.parentCls}）`);
  check(`${p}：没有"设了 hidden 却还露在屏幕上"的元素`, a.badCount === 0,
    a.badCount ? JSON.stringify(a.bad.slice(0, 3))
      : `${a.total} 个 hidden 元素都真的藏住了${a.laidCount ? `（${a.laidCount} 个仍有盒子但被祖先裁掉/盖住，不算露出来）` : ''}`);
}

/* ---------------- ② 关掉 JS（只看 CSS 兜底） ---------------- */
await cdp.send('Emulation.setScriptExecutionDisabled', { value: true });
console.log('\n================ ② 关掉 JS ================');
for (const p of ['/', '/iceberg/']) {
  await cdp.goto(p, 1200);
  const a = await cdp.ev(AUDIT);
  console.log(`${p}  带 hidden 的元素 ${a.total} 个：还占着位置的 ${a.laidCount} 个、其中真露在屏幕上的 ${a.badCount} 个`);
  for (const b of a.laid) console.log(`     <${b.tag} class="${b.cls}" id="${b.id}"> display=${b.display} ${b.w}×${b.h} 在视口=${b.inView} 点得到=${b.hit}（父 ${b.parentCls}）`);
  check(`${p}（无 JS）：没有"设了 hidden 却还露在屏幕上"的元素`, a.badCount === 0,
    a.badCount ? JSON.stringify(a.bad.slice(0, 3)) : `${a.total} 个 hidden 元素都真的藏住了`);
}
await cdp.send('Emulation.setScriptExecutionDisabled', { value: false });

/* ---------------- ③ 对照组：有歌单的那一页，音量键必须**照常看得见** ----------------
   上面那条 `.vol[hidden] { display: none }` 不能把音量键一起藏死 ——
   有歌单的页面播放器脚本会把 hidden 摘掉，这颗按钮得在。 */
await cdp.goto('/', 1800);
const volHome = await cdp.ev(`(() => {
  const v = document.getElementById('music-vol');
  if (!v) return { found: false };
  const r = v.getBoundingClientRect();
  const cx = Math.round(r.left + r.width / 2);
  const cy = Math.round(r.top + r.height / 2);
  const hitEl = document.elementFromPoint(cx, cy);
  return {
    found: true, hidden: v.hidden, display: getComputedStyle(v).display,
    w: Math.round(r.width), h: Math.round(r.height),
    hit: !!(hitEl && (hitEl === v || v.contains(hitEl))),
  };
})()`);
console.log('\n================ ③ 对照：首页（有歌单）的音量键 ================');
console.log(JSON.stringify(volHome));
check('③ 首页有歌单 → 音量键把 hidden 摘掉、正常显示（上面那条 CSS 没有把它一起藏死）',
  volHome.found === true && volHome.hidden === false && volHome.display !== 'none' &&
    volHome.w > 20 && volHome.hit === true,
  JSON.stringify(volHome));

check('这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

try { await cdp.send('Browser.close'); } catch { /* ignore */ }
chrome.kill();
server.close();
console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
