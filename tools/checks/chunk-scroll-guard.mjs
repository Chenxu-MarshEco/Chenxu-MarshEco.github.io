/*
 * 检查：分块装载的时候**绝对不许动用户停的地方**
 * ---------------------------------------------------------------------------
 * 站长 2026-11-21 的硬规定：
 *   「在精华和圣经为了避免加载过久分块以后有一个严重的问题 如果上滑浏览过快
 *     上滑速度超过加载速度 那么加载失败的时候会直接把用户弹到当前这个块的最底下
 *     而不是留在原地 …… 保证硬性规定 绝对不乱动用户目前停留的位置
 *     如果用户往上拖分块还没加载好 那就让网页暂时往上拖受阻出现一个中间有塔吊的
 *     加载旋转标志 …… 回弹以后回弹到用户刚才停留的位置」
 *
 * 这一段就照这几条量：
 *   ① 网速压慢、上滑比装载快 → 装载回来的**那一刻**，视口里那一条必须还在原来的位置
 *      （同一条 id、屏幕坐标差 ≤ 4px），不许跳到新插进来那一簇的最底下；
 *   ② 装载期间那颗转圈（中间是塔吊）要亮着，装完要灭；
 *   ③ 取不到（把该取的那一簇拦掉）的时候：位置一样不许动，转圈继续亮，放开以后接得上。
 *
 * 用法：node tools/checks/chunk-scroll-guard.mjs [dist目录]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { chromePath } from './lib/chrome.mjs';

const ROOT = path.resolve(process.argv[2] ?? 'dist');
const PORT = 4393;
const DEBUG_PORT = 9363;
const CHROME = chromePath();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.gif': 'image/gif',
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

const profile = path.join(process.env.TEMP ?? '.', `dsh-csg-${Date.now()}`);
const chrome = spawn(
  CHROME,
  ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' }
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
        this.errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
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
}

/**
 * 读数：
 *   stayId   视口中间那一条的 id（"用户停在哪"就是它）
 *   stayTop  它离视口顶多少 px
 *   loader   转圈亮没亮
 *   crane    转圈里那颗塔吊的路径在不在（图是从「回到顶部」那颗抄来的）
 */
const SNAP = `(() => {
  const items = [...document.querySelectorAll('.salon__list .salon__item')].filter((el) => !el.hidden);
  const mid = items
    .map((el) => { const r = el.getBoundingClientRect(); return { el, top: Math.round(r.top), d: Math.abs(r.top + r.height / 2 - innerHeight / 2) }; })
    .sort((a, b) => a.d - b.d)[0];
  const loader = document.querySelector('[data-salon-loader]');
  const boxes = [...document.querySelectorAll('.salon__chunk')];
  return {
    y: Math.round(scrollY),
    h: Math.round(document.documentElement.scrollHeight),
    stayId: mid ? mid.el.id : null,
    stayTop: mid ? mid.top : null,
    loader: !!loader && !loader.hidden,
    crane: !!(loader && loader.querySelector('svg path')),
    chunks: boxes.map((b) => b.dataset.chunk).join(','),
    n: items.length,
  };
})()`;

const wheel = async (cdp, dy, times) => {
  for (let i = 0; i < times; i += 1) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: 720, y: 450, deltaX: 0, deltaY: dy, modifiers: 0, pointerType: 'mouse',
    });
    await sleep(60);
  }
};

/**
 * 某一条现在离视口顶多少 px；找不到给 null。
 * ⚠ 判"人还在原地"要**认这一条自己的坐标**，不能拿"离视口中线最近的那一条"去比 ——
 * 内容变多以后最近的可能换成隔壁那条（差一天），那不算人被挪走了。
 */
const topOf = (cdp, id) =>
  cdp.ev(`(() => { const el = document.getElementById(${JSON.stringify(id)}); return el ? Math.round(el.getBoundingClientRect().top) : null; })()`);

try {
  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {}
  }
  if (!target) throw new Error('没等到 Chrome 的调试端口');
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  for (const page of ['/bellie/', '/salon/']) {
    const label = page.replace(/\//g, '');
    cdp.errors.length = 0;
    await cdp.send('Network.setBlockedURLs', { urls: [] });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${page}?guard=1` });
    for (let i = 0; i < 120; i++) {
      await sleep(150);
      if ((await cdp.ev('document.readyState')) === 'complete') break;
    }
    await sleep(2500);
    /* 压慢：一簇要好几秒才回来，用户的手可不会等 */
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 2400, downloadThroughput: 55 * 1024, uploadThroughput: 55 * 1024 });

    /* ---------- ① 上滑比装载快：装回来的那一刻位置不许动 ---------- */
    for (let i = 0; i < 40; i += 1) {
      const y0 = (await cdp.ev(SNAP)).y;
      await wheel(cdp, -520, 2);
      const y1 = (await cdp.ev(SNAP)).y;
      if (y1 <= 8 || y1 === y0) break;
    }
    const stuck = await cdp.ev(SNAP);
    check(`[${label}] 上滑顶到头时出现了转圈（中间是塔吊那颗图）`, stuck.loader && stuck.crane, JSON.stringify(stuck));
    const before = { id: stuck.stayId, top: stuck.stayTop, y: stuck.y };
    let landed = null;
    for (let i = 0; i < 40; i += 1) {
      await sleep(250);
      const s = await cdp.ev(SNAP);
      /* 一有新的一簇进来（chunks 变了）就立刻读一次 —— 那一下就是"回弹"发生的时刻 */
      if (s.chunks !== stuck.chunks || s.n !== stuck.n) {
        landed = s;
        break;
      }
    }
    check(`[${label}] 等到了更早那一簇装载完成`, !!landed, landed ? `簇 [${stuck.chunks}] → [${landed.chunks}]` : '10 秒内没等到');
    if (landed) {
      const topNow = await topOf(cdp, before.id);
      const drift = topNow === null ? 999 : Math.abs(topNow - before.top);
      check(
        `[${label}] 装载回来那一下，视口里那一条还在原来的位置`,
        drift <= 4,
        `${before.id} 的屏幕坐标 ${before.top} → ${topNow}（位移 ${drift}px；y ${before.y} → ${landed.y}）`
      );
      check(`[${label}] 装载完转圈收掉`, landed.loader === false, JSON.stringify({ loader: landed.loader }));
    }

    /* ---------- ② 取不到的时候：位置一样不许动，转圈继续亮 ---------- */
    /* 拦掉**它下一次真的会去取**的那一簇（不是写死号：每页走到这儿停的位置不一样） */
    const first = await cdp.ev(`Number(document.getElementById('salon-list').dataset.chunkFirst)`);
    const nextChunk = Math.max(0, first - 1);
    await cdp.send('Network.setBlockedURLs', { urls: [`*chunk/${nextChunk}.json*`] });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    for (let i = 0; i < 40; i += 1) {
      const y0 = (await cdp.ev(SNAP)).y;
      await wheel(cdp, -520, 2);
      const y1 = (await cdp.ev(SNAP)).y;
      if (y1 <= 8 || y1 === y0) break;
    }
    const wall = await cdp.ev(SNAP);
    const wallTop = wall.stayTop;
    await sleep(2200);
    const wallLater = await cdp.ev(SNAP);
    const wallTopLater = await topOf(cdp, wall.stayId);
    check(
      `[${label}] 分块取不到时：画面一动不动（不是被弹到这一块的最底下）`,
      wallTopLater !== null && Math.abs(wallTopLater - wallTop) <= 4,
      `拦掉 chunk ${nextChunk}；${wall.stayId} 的屏幕坐标 ${wallTop} → ${wallTopLater}（y ${wall.y} → ${wallLater.y}）`
    );
    check(`[${label}] 分块取不到时：转圈一直亮着（不是闪一下就没）`, wallLater.loader === true, JSON.stringify({ loader: wallLater.loader }));

    /* 放开以后：接着把内容补上；补到最前面那一簇（chunkFirst 到 0）转圈才该灭 */
    await cdp.send('Network.setBlockedURLs', { urls: [] });
    let recovered = null;
    for (let i = 0; i < 40; i += 1) {
      await sleep(250);
      const s = await cdp.ev(SNAP);
      if (s.chunks !== wallLater.chunks || s.n !== wallLater.n) {
        recovered = s;
        break;
      }
    }
    check(`[${label}] 放开以后补上了`, !!recovered, recovered ? `簇 [${recovered.chunks}]、条 ${recovered.n}` : '没补上');
    /* 补上以后转圈就该停：位置已经被顶到离顶很远（y 变大了），不会再去拉更早的簇 */
    let idle = null;
    for (let i = 0; i < 60; i += 1) {
      await sleep(250);
      const s = await cdp.ev(
        `(() => { const l = document.querySelector('[data-salon-loader]'); return { first: document.getElementById('salon-list').dataset.chunkFirst, loader: !!l && !l.hidden }; })()`
      );
      if (!s.loader) {
        idle = s;
        break;
      }
    }
    check(`[${label}] 补完以后转圈收掉（不是一直转着）`, !!idle, idle ? JSON.stringify(idle) : '12 秒内没停');
    if (recovered) {
      const topAfter = await topOf(cdp, wall.stayId);
      const drift = topAfter === null ? 999 : Math.abs(topAfter - wallTop);
      check(
        `[${label}] 补上以后人还在原地`,
        drift <= 4,
        `${wall.stayId} 的屏幕坐标 ${wallTop} → ${topAfter}（位移 ${drift}px）`
      );
    }

    check(`[${label}] 这一趟没有 JS 报错`, cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));
  }
} catch (err) {
  fail++;
  console.log('FAIL  脚本异常: ' + (err?.stack ?? err));
} finally {
  try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { windowsHide: true, stdio: 'ignore' }); } catch {}
  server.close();
  await sleep(250);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
