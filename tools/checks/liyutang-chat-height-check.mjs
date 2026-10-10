/*
 * ============================================================================
 * 黎语堂「聊天室（今天那一页）」的高度验收（2026-10-09 起，2026-10-10 重写）
 * ----------------------------------------------------------------------------
 * 用户原话（两轮）：
 *   ① 「右边比左边矮一大截，底下空一块，特别丑」（2026-10-09）
 *   ② 「聊天室的电脑端你理解错意思了 应当是聊天框和时间轴等高 且高度不会因为聊天条数而变高
 *      聊天条数多了应当在聊天框内滚动滚轮阅览」（2026-10-10）
 *
 * 上一版（①）只做到"两栏一样高"，靠的是 grid 的 align-items: stretch —— 那是**跟着最高的
 * 那一个走**：消息一多，聊天框把整行撑高、页面被越拉越长，左边那条轴底下空一大块。
 * 这一版改成**给死一个高度**（forum.css 的 --lyt-tl-panel-h，时间轴面板和聊天框读同一个变量）。
 *
 * 所以这个脚本量三件事，都是"真浏览器 + 真构建产物"：
 *   ① **等高**：聊天框（.lyt-chat__log）和左边那条时间轴面板（.lyt-chat__tl）一样高（差 ≤ 2px）；
 *   ② **不长个**：3 条消息和 43 条消息，聊天框高度、整页高度**一模一样**（差 ≤ 2px）；
 *   ③ **在框里滚**：43 条时聊天框内部真的有得滚（scrollHeight > clientHeight），
 *      滚到底能看见最后一条（不是被裁掉），而**页面本身**没有因为这个多出一大段。
 *
 * 顺带守三条旧账，免得改高度时把别的页面碰坏：
 *   · 存档日页（/liyutang/chatroom/<日>/）那一栏**不能**变成内层滚动框（它是整篇往下读的，
 *     深链接和 Ctrl+F 都指着这一点）；
 *   · 搜索页那条轴没有搜索框，应当比今天这一页的轴**高出搜索框那一行**（这次把
 *     .is-nofind 搬到外层 .lyt-chat--nofind，这条就是它的回归）；
 *   · 窄屏（390×780）不横向溢出、聊天框高度按视口给（min(58vh,26rem)）。
 *
 * 用法：node tools/checks/liyutang-chat-height-check.mjs [dist目录]
 *   需要先构建（node node_modules/astro/bin/astro.mjs build）。
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
const DEBUG_PORT = 9408;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
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

if (!fs.existsSync(path.join(ROOT, 'liyutang', 'chatroom', 'index.html'))) {
  console.log(`先构建：dist 里没有 liyutang/chatroom/index.html（现在看的是 ${ROOT}）`);
  process.exit(1);
}

/* ============================================================ ① 静态：一眼能看出来的那几条
   这几条不是"替代浏览器"，而是钉住**设计意图**：以后谁把 max-height 又写回来、
   或者把"擦掉"的那几条规则删了，这里先红，比肉眼看页面快。 */

console.log('=== ① 静态：高度这套是怎么写的 ===');
const css = read(path.join('src', 'styles', 'forum.css'));
check('★ 高度只有一个来源：--lyt-tl-panel-h 写在 .lyt-chat 上',
  /--lyt-tl-panel-h:\s*calc\(100dvh/.test(css), '');
check('★ 时间轴面板读的就是那个变量（不再自己算一遍）',
  /\.lyt-chat__tl\s*\{[^}]*--tl-panel-h:\s*var\(--lyt-tl-panel-h/.test(css));
check('★ 今天那一页的聊天框高度 = 同一个变量（等高就是这么来的）',
  /\.lyt-chat--live \.lyt-chat__log\s*\{[^}]*height:\s*var\(--lyt-tl-panel-h\)/s.test(css));
check('★ 聊天框不许再被消息撑高（flex-grow 关掉 + min-height: 0）',
  /\.lyt-chat--live \.lyt-chat__log\s*\{[^}]*flex:\s*0 0 auto[^}]*min-height:\s*0/s.test(css));
check('★ 那个定死的高度只在"今天"这一页生效（存档页/搜索页不套）',
  /lyt-chat--live/.test(read(path.join('src', 'pages', 'liyutang', 'chatroom.astro'))) &&
  !/lyt-chat--live/.test(read(path.join('src', 'pages', 'liyutang', 'chatroom', '[day].astro'))));
check('搜索页的"没有搜索框"搬到了外层（.lyt-chat--nofind）',
  /lyt-chat--nofind/.test(read(path.join('src', 'pages', 'liyutang', 'chatroom', 'search.astro'))) &&
  /\.lyt-chat--nofind\s*\{/.test(css));

/* ============================================================ ② 真浏览器 */

/** 假云函数：只认聊天室那几个事件，消息条数由 msgCount 控制（脚本运行时改它来"变多"） */
let msgCount = 3;
const day = '2026-10-10';
const msgAt = (i) => ({
  id: 'm' + i,
  day,
  nick: i === 1 ? '测试者' : '虹星',
  avatar: '',
  text: `第 ${i} 条消息：这一条是拿来量高度的，写得长一点让它占到一整行。`,
  image: '',
  createdAt: Date.now() - (msgCount - i) * 1000,
  mine: i === 1,
});
const fakeBackend = (body) => {
  const event = String(body?.event || '');
  if (event === 'LT_ME') {
    return { code: 0, user: { nick: '测试者', mail: '', status: 'approved', avatar: '', label: '' }, posts: 0 };
  }
  if (event === 'LT_CHAT_LIST') {
    const all = Array.from({ length: msgCount }, (_, i) => msgAt(i + 1));
    const after = Number(body?.after) || 0;
    const list = after ? all.filter((m) => m.createdAt > after) : all;
    return { code: 0, day, today: day, serverNow: Date.now(), messages: list, more: false, next: null };
  }
  if (event === 'LT_CHAT_SEND') {
    return { code: 0, message: { ...msgAt(1), id: 'sent', text: String(body.text || ''), mine: true } };
  }
  if (event === 'LT_CHAT_DELETE') return { code: 0, id: body.id };
  return { code: 0 };
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.gif': 'image/gif',
};
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
        /* 空请求体 */
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
      /* 把线上那个云函数地址换成假后端：页面照原样跑，只有后端是假的 */
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
const liveApi = (() => {
  try {
    return JSON.parse(read(path.join('src', 'data', 'liyutang.json'))).forum?.twikoo?.envId ?? '';
  } catch {
    return '';
  }
})();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const profile = path.join(process.env.TEMP ?? '.', `dsh-lytchath-${Date.now()}`);
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--no-sandbox',
    '--mute-audio',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
    '--disable-breakpad',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

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
        this.errors.push(String(m.params.exceptionDetails?.text).slice(0, 160));
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
  async wait(expr, ms = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try {
        if (await this.ev(expr)) return true;
      } catch {
        /* 页面还在换 */
      }
      await sleep(150);
    }
    return false;
  }
  async goto(url, waitMsgs = true) {
    await this.send('Page.navigate', { url });
    for (let i = 0; i < 150; i++) {
      await sleep(100);
      try {
        if ((await this.ev('document.readyState')) === 'complete') break;
      } catch {
        /* 还在导航 */
      }
    }
    /* 等消息画出来（过审的人进来才有 .lyt-msg）；访客那一趟没消息，别在这儿白等 12 秒 */
    if (waitMsgs) await this.wait(`document.querySelectorAll('.lyt-msg').length > 0`, 12000);
    await sleep(400);
  }
}

/*
  量高度的那一段。都是**四舍五入过的整数像素**，免得 0.4px 的差别把断言搅红。
  scrollHeight / clientHeight 也一起带上：前者是"内容有多长"，后者是"框有多高"，
  两个一比就知道有没有得滚。
*/
const MEASURE = `(() => {
  const q = (s) => document.querySelector(s);
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width) };
  };
  const log = q('.lyt-chat__log');
  const last = log && log.lastElementChild;
  return {
    log: box(log),
    rail: box(q('.lyt-chat__tl')),
    side: box(q('.lyt-chat__side')),
    find: box(q('.lyt-chat__find')),
    compose: box(q('.lyt-chat__compose')),
    lastInLog: last ? Math.round(last.getBoundingClientRect().bottom) : -1,
    logScroll: log ? Math.round(log.scrollHeight) : -1,
    logClient: log ? Math.round(log.clientHeight) : -1,
    logOverflow: log ? getComputedStyle(log).overflowY : '',
    docScroll: Math.round(document.scrollingElement.scrollHeight),
    win: { w: window.innerWidth, h: window.innerHeight },
    overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    msgs: document.querySelectorAll('.lyt-msg').length,
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
      /* 等 Chrome 起来 */
    }
  }
  if (!target) throw new Error('无头 Chrome 没起来（调试端口没响应）');
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  const base = `http://127.0.0.1:${PORT}`;

  /* ---- 桌面端：3 条 ---- */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  /* 先落在同一个源上，把"已登录"塞进 localStorage（访客那一趟不用等消息） */
  await cdp.goto(`${base}/liyutang/chatroom/`, false);
  await cdp.ev(`localStorage.setItem('lt_token','fake-token')`);
  await cdp.goto(`${base}/liyutang/chatroom/`);
  const few = await cdp.ev(MEASURE);
  info(`桌面 3 条：轴 ${few.rail?.h}px · 聊天框 ${few.log?.h}px（内容 ${few.logScroll}px）· 输入区 ${few.compose?.h}px · 整页 ${few.docScroll}px`);
  check('过审账号能看到今天的消息（假后端给的 3 条）', few.msgs === 3, `${few.msgs} 条`);
  check('★ 聊天框和时间轴**等高**（差 ≤ 2px）',
    Math.abs(few.log.h - few.rail.h) <= 2, `聊天框 ${few.log.h} / 时间轴 ${few.rail.h}`);
  /*
    顶上那段错位不是 bug：左栏顶上那个「搜历史消息…」占了一行（含它自己的下边距），
    时间轴面板从它下面开始，而右栏从栏顶开始。所以要验的是"错位正好等于那一行" ——
    哪天有人把搜索框挪走/加高，这条会红，那时候高度那个公式（--lyt-tl-form-h）也要跟着改。
    ⚠ 别写死 41.6px：那个常量是 2.6rem * 高度公式*里减掉的数，而搜索框实际占的高度
    是它自己的内容高（约 37px）+ 下边距 0.55rem（8.8px）≈ 46px，两者本来就不完全相等
    （公式留的是余量）。所以这里拿**页面上量到的**那一行来比。
  */
  const findRow = (few.find?.h ?? 0) + 9;
  check('聊天框比轴高了"顶上那个搜索框"那一行（就是那一行的实际高度 ± 3）',
    Math.abs(few.rail.top - few.log.top - findRow) <= 3,
    `轴 top ${few.rail.top} / 聊天框 top ${few.log.top} / 搜索框那一行 ${findRow}px`);
  check('聊天框是内层滚动容器（overflow-y: auto）', few.logOverflow === 'auto', few.logOverflow);
  check('3 条时内容比框矮（这时候还不该有滚动条）', few.logScroll <= few.logClient + 1, `${few.logScroll} ≤ ${few.logClient}`);
  check('桌面端没有横向溢出', few.overflowX <= 1, `${few.overflowX}px`);

  /* ---- 桌面端：43 条（同一页重载，后端多给 40 条） ---- */
  msgCount = 43;
  await cdp.send('Page.reload', { ignoreCache: true });
  await cdp.wait(`document.querySelectorAll('.lyt-msg').length >= 43`, 15000);
  await sleep(400);
  const many = await cdp.ev(MEASURE);
  info(`桌面 43 条：轴 ${many.rail?.h}px · 聊天框 ${many.log?.h}px（内容 ${many.logScroll}px）· 整页 ${many.docScroll}px`);
  check('43 条都画出来了', many.msgs === 43, `${many.msgs} 条`);
  check('★ 消息变多了，聊天框**一点没长高**（差 ≤ 2px）',
    Math.abs(many.log.h - few.log.h) <= 2, `3 条 ${few.log.h} / 43 条 ${many.log.h}`);
  check('★ 消息变多了，**整页也没被拉长**（差 ≤ 2px）',
    Math.abs(many.docScroll - few.docScroll) <= 2, `3 条 ${few.docScroll} / 43 条 ${many.docScroll}`);
  check('★ 还是和轴等高（差 ≤ 2px）', Math.abs(many.log.h - many.rail.h) <= 2, `${many.log.h} / ${many.rail.h}`);
  check('★ 43 条时框里真的有得滚（内容比框高）', many.logScroll > many.logClient + 20, `${many.logScroll} > ${many.logClient}`);

  /* ---- 在框里滚：滚到底能看见最后一条 ---- */
  const scrolled = await cdp.ev(`(() => {
    const l = document.querySelector('.lyt-chat__log');
    l.scrollTop = 1e6;
    const last = l.lastElementChild;
    const lr = l.getBoundingClientRect();
    const br = last.getBoundingClientRect();
    return {
      top: Math.round(l.scrollTop),
      max: Math.round(l.scrollHeight - l.clientHeight),
      lastBottom: Math.round(br.bottom),
      logBottom: Math.round(lr.bottom),
      text: (last.querySelector('.lyt-msg__text') || {}).textContent || '',
    };
  })()`);
  info(`滚到底：scrollTop ${scrolled.top} / ${scrolled.max}，最后一条底边 ${scrolled.lastBottom} ≤ 框底 ${scrolled.logBottom}`);
  check('★ 滚轮/滚动条能滚到框里的最下面（拿得到最大值）', scrolled.top >= scrolled.max - 2, `${scrolled.top} / ${scrolled.max}`);
  check('★ 滚到底之后最后一条**真的在框里**（没有被裁掉）',
    scrolled.lastBottom <= scrolled.logBottom + 2 && /第 43 条/.test(scrolled.text), scrolled.text.slice(0, 24));
  check('滚动聊天框没有把整页带着滚（页面 scrollY 还是 0）',
    (await cdp.ev('Math.round(window.scrollY)')) === 0, String(await cdp.ev('Math.round(window.scrollY)')));
  const composeVisible = await cdp.ev(`(() => {
    const c = document.querySelector('.lyt-chat__compose');
    const r = c.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vh: window.innerHeight };
  })()`);
  info(`输入区：top ${composeVisible.top} · 高 ${composeVisible.h} · 视口 ${composeVisible.vh}`);
  check('输入区就排在聊天框下面（没被压到框里、也没跑到别处）',
    Math.abs(composeVisible.top - (many.log.bottom + 11)) <= 6, `输入区 top ${composeVisible.top} / 聊天框底 ${many.log.bottom}`);
  check('这一趟没有未捕获的 JS 异常', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

  /* 存两张截图给人看（.tmp/shots/） */
  try {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(path.join(SRC, '.tmp', 'shots'), { recursive: true });
    fs.writeFileSync(path.join(SRC, '.tmp', 'shots', 'chat-height-desktop.png'), Buffer.from(shot.data, 'base64'));
  } catch {
    /* 截不到不影响验收 */
  }

  /* ---- 旧账①：存档日页不许变成内层滚动框 ---- */
  const archiveDays = (() => {
    try {
      return JSON.parse(read(path.join('src', 'data', 'chat', 'index.json'))).days?.map((d) => d.day ?? d) ?? [];
    } catch {
      return [];
    }
  })();
  if (archiveDays.length) {
    await cdp.goto(`${base}/liyutang/chatroom/${archiveDays[0]}/`);
    const arch = await cdp.ev(`(() => {
      const l = document.querySelector('.lyt-chat__log');
      return {
        maxH: getComputedStyle(l).maxHeight,
        scroll: Math.round(l.scrollHeight),
        client: Math.round(l.clientHeight),
        doc: Math.round(document.scrollingElement.scrollHeight),
        vh: window.innerHeight,
      };
    })()`);
    info(`存档日页 ${archiveDays[0]}：max-height ${arch.maxH} · 内容 ${arch.scroll} / 框 ${arch.client} · 整页 ${arch.doc}`);
    check('★ 存档日页的消息流**不是**内层滚动框（高度由内容说了算）',
      arch.maxH === 'none' && arch.scroll <= arch.client + 2, `max-height ${arch.maxH}，${arch.scroll} vs ${arch.client}`);
  } else {
    info('没有聊天存档，跳过"存档日页不是滚动框"那一条');
  }

  /* ---- 旧账②：搜索页的轴比今天这一页高一个搜索框 ---- */
  await cdp.send('Page.navigate', { url: `${base}/liyutang/chatroom/search/` });
  await sleep(2500);
  const search = await cdp.ev(`(() => {
    const r = document.querySelector('.lyt-chat__tl');
    return { h: r ? Math.round(r.getBoundingClientRect().height) : -1, find: !!document.querySelector('.lyt-chat__find') };
  })()`);
  info(`搜索页：轴 ${search.h}px（今天这一页 ${many.rail.h}px）`);
  check('搜索页里确实没有那个搜索框', search.find === false);
  check('★ 搜索页的轴比今天这一页**高出一个搜索框**（41.6px ± 2）',
    Math.abs(search.h - many.rail.h - 41.6) <= 2, `差 ${(search.h - many.rail.h).toFixed(1)}px`);

  /* ---- 窄屏 390 ---- */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: true });
  await cdp.goto(`${base}/liyutang/chatroom/`);
  const narrow = await cdp.ev(MEASURE);
  const want = Math.round(Math.min(0.58 * 780, 26 * 16));
  info(`窄屏 390×780：轴 ${narrow.rail?.h}px · 聊天框 ${narrow.log?.h}px（想要 ${want}px）· 整页 ${narrow.docScroll}px`);
  check('★ 窄屏聊天框高度还是按视口给的（min(58vh,26rem) ± 2px）', Math.abs(narrow.log.h - want) <= 2, `${narrow.log.h} vs ${want}`);
  check('窄屏和轴等高', Math.abs(narrow.log.h - narrow.rail.h) <= 2, `${narrow.log.h} / ${narrow.rail.h}`);
  check('窄屏没有横向溢出', narrow.overflowX <= 1, `${narrow.overflowX}px`);
  try {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(SRC, '.tmp', 'shots', 'chat-height-mobile.png'), Buffer.from(shot.data, 'base64'));
  } catch {
    /* 截不到不影响验收 */
  }
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
