/*
 * ============================================================================
 * 聊天室「粘贴板里有图 → 当成选图发出去」的验收（2026-10-09）
 * ----------------------------------------------------------------------------
 * 用户原话：
 *   「聊天室支持粘贴图片发送：粘贴板里有图 → 当成选图（paste 事件取 clipboardData.items
 *    里的图片文件，走现有的压缩上传路径）」
 *
 * 为什么单独一个 check、而不是塞进画板那个：这一条跟前端文件 liyutang-client.ts 有边界
 * （那个文件当时正被别人改，不许动），实现落在 src/pages/liyutang/chatroom.astro 自己的
 * 小脚本里。所以这里量三件事：
 *   ① 静态：页面里确实有一段只做 paste 的监听，读的是 clipboardData.items 里的图片文件，
 *      压图和发送用的是**和「传图」按钮同一对公开原语**（compressImage + sendChat），
 *      而且**没有**动 liyutang-client.ts（那文件的边界得留着）；
 *   ② 真跑（真浏览器 + 假云函数）：往页面里派发一个**真的** paste 事件（DataTransfer 里塞一张
 *      真的 PNG）→ 假后端收到 LT_CHAT_SEND 且 image 是 `data:image/webp;base64,…`
 *      → 消息流里出现那张图（元素与像素都看得见）；
 *   ③ 大图会被压到 1000px 以内（证明走的就是原来那条压缩路，不是另起一套）；
 *      以及"粘贴纯文字"不许被这条逻辑搅坏（不吞事件、不误发消息）。
 *
 * 用法：node tools/checks/liyutang-chat-paste-check.mjs [dist目录]
 * ============================================================================
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const SRC = String.raw`D:\曼沫砾总线\Chenxu-MarshEco.github.io`;
const ROOT = path.resolve(
  process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(SRC, 'dist')
);
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const DEBUG_PORT = 9419;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);
const read = (rel) => {
  const f = path.join(SRC, rel);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};

/* ============================================================ ① 静态 */

console.log('=== ① 静态：这一段确实只做 paste、而且没有越界改 client.ts ===');
const page = read(path.join('src', 'pages', 'liyutang', 'chatroom.astro'));
const client = read(path.join('src', 'utils', 'liyutang-client.ts'));
check('页面里有一段 paste 监听', /addEventListener\('paste'/.test(page));
check('★ 读的是 clipboardData.items 里的图片文件（kind === \'file\' + /^image\\//）',
  /clipboardData\?\.items/.test(page) && /kind === 'file'/.test(page) && /\^image\\\//.test(page));
check('★ 压图/发送用的是「传图」那一对公开原语：compressImage(…max: 1000, maxBytes: 300_000) + sendChat',
  /compressImage\(file, \{ max: 1000, maxBytes: 300_000 \}\)/.test(page) && /sendChat\(apiUrl, \{ image: dataUrl \}\)/.test(page));
check('★ 没图就完全不插手（普通文字粘贴照旧）', /if \(!file\) return;/.test(page));
check('★ 没有动 liyutang-client.ts 去加 paste（那是别人的文件）',
  client.length > 0 && !/addEventListener\('paste'/.test(client));
check('页面把"为什么没塞给那个 file input"写清楚了（那个 input 是现造、不在 DOM 里）',
  /picker\.click\(\)/.test(client) && /拿不到它/.test(page));

/* ============================================================ ② 真浏览器 */

console.log('\n=== ② 真浏览器：真 paste 事件 + 真压缩 + 假云函数 ===');
const liveApi = (() => {
  try {
    return JSON.parse(read('src/data/liyutang.json')).forum?.twikoo.envId ?? '';
  } catch {
    return '';
  }
})();

const seen = { sends: [], lists: 0 };
const messages = [];
const fakeBackend = (body) => {
  const event = String(body?.event || '');
  if (event === 'LT_ME') {
    return { code: 0, user: { nick: '测试者', alias: '测试者', mail: '', status: 'approved', avatar: '', label: '', prefs: {} }, posts: 0 };
  }
  if (event === 'LT_CHAT_LIST') {
    seen.lists += 1;
    return { code: 0, day: '2026-10-09', today: '2026-10-09', serverNow: Date.now(), messages: [...messages] };
  }
  if (event === 'LT_CHAT_SEND') {
    seen.sends.push(body);
    const m = {
      id: 'm' + messages.length,
      day: '2026-10-09',
      nick: '测试者',
      avatar: '',
      text: String(body.text || ''),
      image: String(body.image || ''),
      createdAt: Date.now(),
      mine: true,
    };
    messages.push(m);
    return { code: 0, message: m };
  }
  return { code: 0 };
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__lt') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        /* 空 */
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(fakeBackend(body)));
    });
    return;
  }
  const p = decodeURIComponent(url.pathname);
  for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
    const f = path.join(ROOT, t);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ext = path.extname(f).toLowerCase();
      let buf = fs.readFileSync(f);
      if (ext === '.html' && liveApi) {
        buf = Buffer.from(buf.toString('utf8').split(liveApi).join(`http://127.0.0.1:${server.address().port}/__lt`), 'utf8');
      }
      res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
      return res.end(buf);
    }
  }
  res.writeHead(404);
  res.end('404');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const profile = path.join(process.env.TEMP ?? '.', `dsh-lytchat-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

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
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(String(m.params.exceptionDetails?.text).slice(0, 140));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 140));
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception?.description ?? '').slice(0, 200));
    return r.result.value;
  }
  async wait(expr, ms = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try {
        if (await this.ev(expr)) return true;
      } catch {
        /* 页面还在换 */
      }
      await sleep(200);
    }
    return false;
  }
  async go(url) {
    await this.send('Page.navigate', { url });
    for (let i = 0; i < 150; i++) {
      await sleep(100);
      try {
        if ((await this.ev('document.readyState')) === 'complete') return;
      } catch {
        /* 还在导航 */
      }
    }
  }
}

/** 在页面里造一张真图、塞进 DataTransfer、派发一个真的 paste 事件 */
const pasteImage = (w, h, type = 'image/png') => `(async () => {
  const c = document.createElement('canvas');
  c.width = ${w}; c.height = ${h};
  const g = c.getContext('2d');
  g.fillStyle = '#ff4d6d'; g.fillRect(0, 0, ${w}, ${h});
  g.fillStyle = '#3a86ff'; g.fillRect(${Math.round(w * 0.1)}, ${Math.round(h * 0.1)}, ${Math.round(w * 0.3)}, ${Math.round(h * 0.3)});
  const blob = await new Promise((r) => c.toBlob(r, '${type}'));
  const file = new File([blob], 'clip.png', { type: '${type}' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const notCancelled = document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  return { bytes: blob.size, notCancelled };
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
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  const base = `http://127.0.0.1:${PORT}`;

  await cdp.go(`${base}/liyutang/`);
  await cdp.ev(`localStorage.setItem('lt_token','fake-token')`);
  await cdp.go(`${base}/liyutang/chatroom/`);
  const ready = await cdp.wait(`(() => { const b = document.querySelector('[data-lt-chat-send]'); return !!b && !b.disabled; })()`, 20000);
  check('★ 过审账号进来：输入区解锁（不然下面那些都无从谈起）', ready === true);

  /* ---- 1. 粘一张 200×120 的 PNG ---- */
  const first = await cdp.ev(pasteImage(200, 120));
  info(`造了一张 ${first.bytes} 字节的 PNG 塞进粘贴板`);
  await cdp.wait(`(() => !!document.querySelector('.lyt-msg__pic'))()`, 10000);
  const sent1 = seen.sends[0];
  check('★ 粘图片 → 假云函数收到 LT_CHAT_SEND，image 是压过的 WebP data URL（走的是同一条上传路）',
    !!sent1 && /^data:image\/webp;base64,/.test(String(sent1.image)) && String(sent1.text || '') === '',
    JSON.stringify({ hasImage: !!sent1?.image, kb: sent1 ? Math.round(String(sent1.image).length / 1024) : 0 }));
  const painted1 = await cdp.ev(`(() => {
      const i = document.querySelector('.lyt-msg__pic');
      return i ? { w: i.naturalWidth, h: i.naturalHeight, same: i.src === ${JSON.stringify(String(sent1?.image ?? ''))} } : null;
    })()`);
  check('★ 那张图真的出现在消息流里（元素 + 解码出来的像素尺寸都对）',
    !!painted1 && painted1.w === 200 && painted1.h === 120 && painted1.same === true, JSON.stringify(painted1));
  check('状态行说了人话（发出去了 + 多少 KB）',
    /发出去了/.test(String(await cdp.ev(`(document.querySelector('[data-lt-chat-status]') || {}).textContent || ''`))),
    await cdp.ev(`(document.querySelector('[data-lt-chat-status]') || {}).textContent || ''`));

  /* ---- 2. 粘一张 2400×1400 的大图：必须被压到 1000px 以内 ---- */
  const nBefore = seen.sends.length;
  const big = await cdp.ev(pasteImage(2400, 1400));
  info(`大图原始 ${Math.round(big.bytes / 1024)} KB`);
  await cdp.wait(`(() => document.querySelectorAll('.lyt-msg__pic').length >= 2)()`, 15000);
  const sent2 = seen.sends[seen.sends.length - 1];
  const painted2 = await cdp.ev(`(() => {
      const all = document.querySelectorAll('.lyt-msg__pic');
      const i = all[all.length - 1];
      return i ? { w: i.naturalWidth, h: i.naturalHeight } : null;
    })()`);
  check('★ 大图走的是「压到 1000px」那条路（长边 ≤ 1000）',
    seen.sends.length === nBefore + 1 && !!painted2 && painted2.w <= 1000 && painted2.w >= 900 && painted2.h <= 1000,
    JSON.stringify({ sent: seen.sends.length - nBefore, decoded: painted2, kb: Math.round(String(sent2?.image ?? '').length / 1024) }));

  /* ---- 3. 普通文字粘贴不许被搅坏 ---- */
  const nText = seen.sends.length;
  const plain = await cdp.ev(`(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', '纯文字一段');
      const ta = document.querySelector('[data-lt-chat-text]');
      const notCancelled = ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return { notCancelled };
    })()`);
  await sleep(800);
  check('★ 粘贴纯文字：事件不被吞（还能正常粘进输入框）、也不会多出一条消息',
    plain.notCancelled === true && seen.sends.length === nText, JSON.stringify({ ...plain, sends: seen.sends.length - nText }));

  /* ---- 4. 粘贴板里没有图（只有一段文字）时什么也不做 ---- */
  const nEmpty = seen.sends.length;
  await cdp.ev(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'x'); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); return true; })()`);
  await sleep(600);
  check('粘贴板里没有图 → 一条消息都不发', seen.sends.length === nEmpty, `${seen.sends.length - nEmpty} 条`);

  try {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(path.join(SRC, '.tmp', 'shots'), { recursive: true });
    fs.writeFileSync(path.join(SRC, '.tmp', 'shots', 'chatroom-paste.png'), Buffer.from(shot.data, 'base64'));
  } catch {
    /* 截不到不影响验收 */
  }

  check('这一趟没有未捕获的 JS 异常', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));
  info(`假云函数一共收到 ${seen.sends.length} 条消息、LT_CHAT_LIST 被问了 ${seen.lists} 次`);
} catch (err) {
  fail++;
  console.log('FAIL  浏览器那一段异常: ' + (err?.stack ?? err));
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
