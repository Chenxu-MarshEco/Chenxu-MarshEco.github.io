/*
 * ============================================================================
 * 黎语堂首页版式：两个「大厅」+ 小版块每行四个（2026-10-09）
 * ----------------------------------------------------------------------------
 * 用户原话：
 *   「在黎语堂首页增加两个大板块 板块大小类似于花涧堂的甬城晴雨和花娅陌域
 *    剩下的可以自由添加的小版块全部都排列在它们下面 且每行排列四个
 *    左侧大板块：聊天室 …… 右侧大板块：久昭卿茶绘 ……」
 *
 * 量的是版式本身（不是"看着像"）：
 *   · 两块大厅在宽屏上并排、各自够大（≥460×170），而且**明显比小版块大**（宽 ≥ 2 倍）；
 *   · 小版块的网格是 **4 列**（读的是 grid-template-columns 的轨道数，不是"现在有几个版块"——
 *     版块少的时候前者照样是 4，后者会骗人）；
 *   · 把版块克隆到 4 个，确认真的能一行排开四个（不动数据，只在浏览器里改 DOM）；
 *   · 四个宽度（1440 / 900 / 700 / 390）下都不许有横向溢出；窄屏大厅改竖排、网格收到 2/1 列；
 *   · 聊天室 / 久昭卿茶绘 / 茶绘日历三页都打得开。
 * 顺手把四个宽度各存一张截图到 .tmp/shots/（人眼看版式用）。
 *
 * 用法：node tools/checks/liyutang-halls-check.mjs [dist目录]
 * 说明：默认不重新构建（先跑 `node node_modules/astro/bin/astro.mjs build`）。
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
/*
  ⚠ 调试端口写死就够了（一个浏览器进程用完就杀），但**静态服务用系统随便给的端口** ——
  2026-10-08 那晚连撞两次 EADDRINUSE（一次是别的实验占着、一次是自己上一次没收干净），
  写死端口的检查在"可能同时开着编辑器 / dev server / 别的检查"的机器上必然踩。
*/
const DEBUG_PORT = 9401;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
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
  '.mp3': 'audio/mpeg',
};
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

const profile = path.join(process.env.TEMP ?? '.', `dsh-halls-${Date.now()}`);
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
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(String(m.params.exceptionDetails?.text).slice(0, 140));
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

/** 一次量完：大厅尺寸 / 网格轨道数 / 一行几个 / 横向溢出 */
const MEASURE = `(() => {
  const halls = [...document.querySelectorAll('.lyt-hall')].map((el) => {
    const r = el.getBoundingClientRect();
    return { href: el.getAttribute('href'), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) };
  });
  const boards = [...document.querySelectorAll('.lyt-boardLink')].map((el) => {
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), top: Math.round(r.top) };
  });
  const rows = {};
  for (const b of boards) rows[b.top] = (rows[b.top] || 0) + 1;
  const firstRow = Object.keys(rows).length ? rows[Object.keys(rows).map(Number).sort((a, b) => a - b)[0]] : 0;
  const gridEl = document.querySelector('.lyt-boards');
  const tracks = gridEl ? getComputedStyle(gridEl).gridTemplateColumns.split(' ').filter(Boolean).length : 0;
  return {
    halls,
    hallSameRow: halls.length === 2 ? halls[0].top === halls[1].top : null,
    tracks,
    boardCount: boards.length,
    boardPerRow: firstRow,
    boardW: boards[0] ? boards[0].w : 0,
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

  for (const [w, h, label, wantTracks] of [
    [1440, 1000, '宽屏', 4],
    [900, 900, '中屏', 3],
    [700, 900, '窄屏', 2],
    [390, 844, '手机', 1],
  ]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/liyutang/` });
    for (let i = 0; i < 120; i++) {
      await sleep(100);
      try {
        if ((await cdp.ev('document.readyState')) === 'complete') break;
      } catch {
        /* 还在导航 */
      }
    }
    await sleep(900);
    const m = await cdp.ev(MEASURE);
    console.log(
      `\n—— ${label} ${w}px —— 大厅 ${m.halls.map((x) => `${x.w}×${x.h}`).join(' / ')}　` +
        `网格 ${m.tracks} 列（现有 ${m.boardCount} 个版块，一行 ${m.boardPerRow} 个）　溢出 ${m.overflowX}px`
    );
    try {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.mkdirSync(path.join(SRC, '.tmp', 'shots'), { recursive: true });
      fs.writeFileSync(path.join(SRC, '.tmp', 'shots', `halls-${w}.png`), Buffer.from(shot.data, 'base64'));
    } catch {
      /* 截不到不影响验收 */
    }

    check(`${label}：大厅 ${w <= 720 ? '竖排' : '并排'}`, m.hallSameRow === (w > 720), String(m.hallSameRow));
    check(`${label}：小版块网格 ${wantTracks} 列`, m.tracks === wantTracks, `${m.tracks} 列`);
    check(`${label}：没有横向溢出`, m.overflowX <= 1, `${m.overflowX}px`);
    if (w === 1440) {
      check('宽屏：两块大厅都够大（≥460×170）', m.halls.every((x) => x.w >= 460 && x.h >= 170), JSON.stringify(m.halls.map((x) => `${x.w}×${x.h}`)));
      check('宽屏：大厅明显比小版块大（宽 ≥ 2 倍）', m.halls[0] && m.boardW && m.halls[0].w >= m.boardW * 2 - 10, `大厅 ${m.halls[0]?.w} vs 小版块 ${m.boardW}`);
      /* 版块少时看不出"一行四个"：克隆到 4 个再量（只动 DOM，不动数据） */
      const cloned = await cdp.ev(`(() => {
        const ul = document.querySelector('.lyt-boards');
        const li = ul.querySelector('li');
        while (ul.children.length < 4 && li) ul.append(li.cloneNode(true));
        const items = [...ul.querySelectorAll('.lyt-boardLink')].map((el) => {
          const r = el.getBoundingClientRect();
          return { w: Math.round(r.width), top: Math.round(r.top) };
        });
        const rows = {};
        for (const it of items) rows[it.top] = (rows[it.top] || 0) + 1;
        return { n: items.length, perRow: rows[Object.keys(rows).map(Number).sort((a, b) => a - b)[0]], w: items[0].w };
      })()`);
      check('★ 补足到 4 个版块之后确实一行排开四个（克隆验证，没动数据）',
        cloned.perRow === 4, `${cloned.n} 个 → 一行 ${cloned.perRow} 个，每个 ${cloned.w}px`);
    }
  }

  for (const [url, want] of [
    ['/liyutang/chatroom/', '聊天室'],
    ['/liyutang/teahouse/', '久昭卿茶绘'],
    ['/liyutang/teahouse/calendar/', '画过的日子'],
  ]) {
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${url}` });
    for (let i = 0; i < 120; i++) {
      await sleep(100);
      try {
        if ((await cdp.ev('document.readyState')) === 'complete') break;
      } catch {
        /* 等 */
      }
    }
    const title = String((await cdp.ev(`(document.querySelector('h1') || {}).textContent || ''`))).trim();
    check(`${url} 打得开（标题含「${want}」）`, title.includes(want), title.slice(0, 20));
  }

  check('这一趟没有未捕获的 JS 异常', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));
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
