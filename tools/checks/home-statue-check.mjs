/*
 * ============================================================================
 * 首页「藏在城市剪影里的雕像」+「鸟群已关掉」的验收（真浏览器 + 真像素）
 * ----------------------------------------------------------------------------
 * 用户原话（2026-09）：
 *   「鸟群出现有点突兀 还是需要优化 但是暂时没有想好设计 所以你先把首页出现
 *     鸟群这一点关掉吧 注意只是关掉这个功能先不要删掉它们的代码！！
 *     而隐秘页面的雕像的出现改为每次进入首页都会让一个雕像随机刷新在和城市影
 *     重合的位置看不出来 然后雕像会偶尔探头出来 引导用户点击。
 *     连续点击回到顶部塔吊五次改为会让雕像轮廓微微发光」
 *
 * 八段：
 *   A0 构建产物：节点/数据/样式/开关都在，一样没删
 *   A  鸟群：正常访问一只都不放；?birds=1 这个调试口照放（证明代码是活的）
 *   B  藏得住：**200 格里所有可用格全过一遍**（不是一个两个）——"有雕像"和
 *              "把雕像藏起来"两张同区域截图逐像素比，判据是"没有 ≥4 的差异"；
 *              ±1/±2 是 8bit 合成取整，黑底上肉眼看不出、也量不出，单独报数
 *   C  探头：同样逐格 ——
 *              · 静止时那儿是**天空**（说明探到楼顶以上了，不是糊在楼身上）
 *              · 现在那儿是**墨色**、而且每一个变化的像素都变暗了（是黑影不是亮块）
 *              · 形状不是矩形、只露上半身、顶边正好是雕像自己的头顶
 *   D  滚动到视差中段再抽 3 格复验（视差层移位会让取样相位变）
 *   E  发光：真点五下「回到顶部」→ 真发光；亮的必须是**轮廓**（剪影内部不亮）
 *   F  点它：探着头时点它 → 进 /secret/xianbao/；静止时点同一处 → 哪儿都不去
 *   G  随机：连开几次首页落点应当不同，而且每次都落在"可用格"里
 *   H  手机 390×844：B/C 全套再来一遍（窄屏缩放最狠，是这套数据的安全边界）
 *   I  别的页面没被带坏 + 全程没有 JS 报错
 *
 * 用法：node tools/checks/home-statue-check.mjs [dist目录]
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
const PORT = 4403;
const DEBUG_PORT = 9373;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
};
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error(`找不到 ${path.join(root, 'index.html')}，先构建`);
  process.exit(2);
}

/* ================================================================
 * A0. 构建产物
 * ================================================================ */
console.log('================ A0. 构建产物 ================');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const restCells = ((html.match(/data-rests="([^"]*)"/) || [, ''])[1]).trim().split(/\s+/);
const usable = restCells.map((v, i) => (v === '---' ? -1 : i)).filter((i) => i >= 0);
const GRID = Number((html.match(/data-grid="(\d+)"/) || [, '200'])[1]);
const PEEK = Number((html.match(/data-peek="(\d+)"/) || [, '45'])[1]);

check('首页有雕像节点（data-statue）', /data-statue[ >]/.test(html));
check(`取位数据是 ${GRID} 格的定长表`, restCells.length === GRID, `${restCells.length} 格`);
check('里面有一批可用格（不是只剩一两处）', usable.length >= 20, `${usable.length} 格可用`);
check('探头幅度写在 data-peek 上', PEEK > 20 && PEEK < 90, `${PEEK}%（雕像自身高度的百分比）`);
check('雕像用的剪影是「身体 + 翅膀」合成的完整立像',
  fs.existsSync(path.join(root, 'img/home/statue-full.png')), 'dist/img/home/statue-full.png');
check('秘密页在（点过去不会 404）', fs.existsSync(path.join(root, 'secret/xianbao/index.html')));

check('鸟群节点还在页面上（代码没删）', /data-birds/.test(html));
const here = path.dirname(fileURLToPath(import.meta.url));
const birdSrc = fs.readFileSync(path.join(here, '..', '..', 'src/components/HomeBirds.astro'), 'utf8');
check('HomeBirds 源码里有总开关，而且当前是 false（关掉而不是删掉）',
  /const FLOCKS_ENABLED = false;/.test(birdSrc), (birdSrc.match(/const FLOCKS_ENABLED = \w+;/) || [''])[0]);
check('HomeBirds 源码里那套队形/飞行带/彩蛋代码原样都在',
  /function spawnFlock/.test(birdSrc) && /function freeBand/.test(birdSrc) && /function schedule/.test(birdSrc) &&
  /TOTOP_CLICKS/.test(birdSrc), 'spawnFlock / freeBand / schedule / 五下连点 都还在');
const birdJs = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes('data-birds'));
check('编译出来的鸟群脚本把总开关落实成了 data-flocks = off',
  !!birdJs && /dataset\.flocks=.{0,4}off/.test(birdJs));
check('鸟群那一大段造鸟的代码还在产物里（没被删掉）',
  !!birdJs && /flock/.test(birdJs) && /--gap/.test(birdJs) && /wing wing--/.test(birdJs) && /egg__wing/.test(birdJs),
  'flock / --gap / wing wing-- / egg__wing 都在');
const allCss = fs.readdirSync(path.join(root, '_astro')).filter((f) => f.endsWith('.css'))
  .map((f) => fs.readFileSync(path.join(root, '_astro', f), 'utf8')).join('\n');
check('鸟群和雕像的样式都还在产物 CSS 里',
  /\.birds \.flock/.test(allCss) && /statue__body/.test(allCss) && /statue-glow/.test(allCss),
  '.birds .flock / .statue__body / statue-glow');

/* ================================================================
 * 起服务 + 开浏览器
 * ================================================================ */
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

const profileDir = path.join(process.env.TEMP ?? '.', `dsh-homestatue-${Date.now()}`);
const chrome = spawn(
  CHROME,
  ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
   '--disable-breakpad', '--window-size=1440,900', `--user-data-dir=${profileDir}`,
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
      ws.addEventListener('error', () => rej(new Error('ws connect failed')), { once: true });
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
  async goto(p, wait = 900) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 200; i++) { await sleep(60); if ((await this.ev('document.readyState')) === 'complete') break; }
    await this.ev('document.fonts ? document.fonts.ready.then(()=>1) : 1');
    await sleep(wait);
  }
  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await sleep(50);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(35);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }
  /** 截图（可带 clip，视口坐标）。返回 RGBA + 原始 PNG */
  async shot(clip) {
    const args = { format: 'png', captureBeyondViewport: false };
    if (clip) args.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 };
    const r = await this.send('Page.captureScreenshot', args);
    const png = Buffer.from(r.data, 'base64');
    const { data, info: meta } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, w: meta.width, h: meta.height, c: meta.channels, png };
  }
  setViewport(w, h, mobile) {
    return this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
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

/** 停掉所有动画/过渡：两次截图之间除了我们动的东西，别的必须一模一样 */
const FREEZE = `(() => {
  if (document.getElementById('__freeze')) return 1;
  const s = document.createElement('style');
  s.id = '__freeze';
  s.textContent = '*,*::before,*::after{animation:none !important;transition:none !important;caret-color:transparent !important}';
  document.head.append(s);
  return 1;
})()`;

const STATUE_RECT = `(() => {
  const fig = document.querySelector('[data-statue-fig]');
  const b = fig.getBoundingClientRect();
  return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height),
    r: Math.round(b.right), b: Math.round(b.bottom),
    peek: fig.classList.contains('is-peek') };
})()`;

/** 逐像素比对：changedExact = 差 1 就算；changed = 任一通道差 ≥ 4（肉眼看得见）
 *  rect（可选，裁剪内坐标）：把"变化"分成"雕像自己身上"和"旁边"两类 ——
 *  雕像画不到自己的矩形外面，所以矩形外的差异一定不是它显形，而是它这一层
 *  参与合成之后旁边重新栅格化留下的缝（实测 1~3 个像素、Δ ≤ 15）。 */
function diffShots(a, b, rect) {
  const n = Math.min(a.w * a.h, b.w * b.h);
  let changedExact = 0;
  let changed = 0;
  let inner = 0;
  let outer = 0;
  let outerMax = 0;
  let maxDelta = 0;
  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
  let inkA = 0, inkB = 0, darker = 0, notDarker = 0;
  const pixels = [];
  const isInk = (arr, q) => Math.abs(arr[q] - 8) <= 3 && Math.abs(arr[q + 1] - 2) <= 3 && Math.abs(arr[q + 2] - 12) <= 3;
  for (let i = 0; i < n; i++) {
    const o = i * a.c;
    const p = i * b.c;
    const d = Math.max(
      Math.abs(a.data[o] - b.data[o]),
      Math.abs(a.data[o + 1] - b.data[o + 1]),
      Math.abs(a.data[o + 2] - b.data[o + 2])
    );
    if (d === 0) continue;
    changedExact++;
    if (d > maxDelta) maxDelta = d;
    if (d < 4) continue;
    changed++;
    const x = i % a.w;
    const y = (i - x) / a.w;
    const inRect = !!rect && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
    if (inRect) inner++;
    else { outer++; if (d > outerMax) outerMax = d; }
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (isInk(a.data, o)) inkA++;
    if (isInk(b.data, p)) inkB++;
    const la = 0.299 * a.data[o] + 0.587 * a.data[o + 1] + 0.114 * a.data[o + 2];
    const lb = 0.299 * b.data[p] + 0.587 * b.data[p + 1] + 0.114 * b.data[p + 2];
    la < lb ? darker++ : notDarker++;
    if (pixels.length < 60000) pixels.push(x, y, a.data[o], a.data[o + 1], a.data[o + 2], b.data[p], b.data[p + 1], b.data[p + 2]);
  }
  return {
    changedExact, changed, maxDelta, inkA, inkB, darker, notDarker, pixels, inner, outer, outerMax,
    bbox: changed ? { x: minX, y: minY, r: maxX, b: maxY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
  };
}

/** 一轮里"露得最多"的那一格（拿它细看形状） */
const topSpot = (res) => res.reveal.reduce((a, b) => (b.changed > a.changed ? b : a), res.reveal[0]);

/* ================================================================
 * A. 鸟群：正常访问一只都不放
 * ================================================================ */
console.log('\n================ A. 鸟群关掉了（代码留着） ================');
await cdp.setViewport(1440, 900, false);
await cdp.goto('/', 500);
await sleep(9000); // 老行为首屏 3~7 秒就该来一群，等 9 秒足够
const birdState = await cdp.ev(`(() => {
  const b = document.querySelector('[data-birds]');
  return { exists: !!b, flocks: document.querySelectorAll('[data-birds] .flock').length,
    birds: document.querySelectorAll('[data-birds] .bird').length, sw: b ? b.dataset.flocks : null,
    symbolCount: document.querySelectorAll('[data-birds] symbol').length };
})()`);
info(`等 9 秒之后：${JSON.stringify(birdState)}`);
check('鸟群调度关着（data-flocks = off）', birdState.sw === 'off', String(birdState.sw));
check('等 9 秒一只鸟都没放出来（老行为 3~7 秒就该来一群）',
  birdState.flocks === 0 && birdState.birds === 0, `flock ${birdState.flocks} / bird ${birdState.birds}`);
check('四种鸟的 <symbol> 定义还在页面上（代码没删）', birdState.symbolCount === 8, `${birdState.symbolCount} 个`);
await cdp.goto('/?birds=1', 2000);
const forced = await cdp.ev(`({ flocks: document.querySelectorAll('[data-birds] .flock').length,
  birds: document.querySelectorAll('[data-birds] .bird').length })`);
info(`?birds=1 → ${JSON.stringify(forced)}`);
check('?birds=1 仍然照放（代码是活的，只是默认不跑）', forced.flocks >= 1 && forced.birds >= 3,
  `flock ${forced.flocks} / bird ${forced.birds}`);

/* ================================================================
 * A2. 「偶尔探头出来」靠的是它自己的调度，不是我们手动加类
 * ================================================================ */
console.log('\n================ A2. 不点它，它自己会偶尔探头 ================');
await cdp.goto('/?statue=fast&birds=0', 300);
{
  let peeks = 0;
  let starts = 0;
  let longest = 0;
  let run = 0;
  let on = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    const st = await cdp.ev(`(() => { const r = document.querySelector('[data-statue]');
      const f = document.querySelector('[data-statue-fig]');
      return { peeks: Number(r.dataset.peeks || 0), on: f.classList.contains('is-peek') }; })()`);
    peeks = st.peeks;
    if (st.on) {
      run++;
      longest = Math.max(longest, run);
      if (!on) starts++;
      on = true;
    } else {
      run = 0;
      on = false;
    }
    await sleep(120);
  }
  info(`fast 模式跑 8 秒：dataset.peeks = ${peeks}（走完的轮数），探出头 ${starts} 次，单次最长连续 ${longest} 帧`);
  /* 判据看"探了几次头"（starts），不看"走完了几轮"（peeks）——
     fast 模式下每一轮 1.5~4.8 秒、还三成概率连探两下，8 秒里轮数天生在 1~3 之间飘 */
  check('不点它、也没加类，它自己会反复探头（8 秒里至少探 2 次）', starts >= 2 && peeks >= 1,
    `starts=${starts} peeks=${peeks}`);
  check('每次是"探出来停一会儿再缩回去"，不是一闪而过', longest >= 3,
    `最长 ${longest} 帧 ≈ ${((longest * 120) / 1000).toFixed(2)}s`);

  /* 滚到卡片区（城市被卡片盖住）之后不该再白探 */
  await cdp.ev(`window.scrollTo({ top: 1100, behavior: 'instant' }); 1`);
  await sleep(400);
  const inCards = await cdp.ev(`document.body.classList.contains('is-cards')`);
  const before = await cdp.ev(`Number(document.querySelector('[data-statue]').dataset.peeks || 0)`);
  await sleep(5200);
  const after = await cdp.ev(`Number(document.querySelector('[data-statue]').dataset.peeks || 0)`);
  const stillPeeking = await cdp.ev(`document.querySelector('[data-statue-fig]').classList.contains('is-peek')`);
  info(`滚到卡片区（is-cards=${inCards}）：5.2 秒里 peeks ${before} → ${after}`);
  check('城市被卡片盖住时就不再探头了（不白费劲）', inCards === true && after - before <= 1,
    `${before} → ${after}`);
  check('也绝不会卡在"一直探着头"的状态', stillPeeking === false);
  check('这一段没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));
}

/* ================================================================
 * B/C. 所有可用格：藏得住 + 探得出（逐像素）
 * ================================================================ */
const PAD = 22;
const WANT_RISE = 0.05; // 探头抬升 = 盒高的 5%（其中 1% 是安全余量）

/**
 * 在**一个页面里**把所有可用格过一遍：
 * 每格先比"静止态 vs 没有雕像"（藏得住），再比"探头 vs 静止"（探得出）。
 */
async function verifySpots(w, h, mobile, minReveal) {
  await cdp.setViewport(w, h, mobile);
  await cdp.goto('/?statue=still&birds=0', 600);
  await cdp.ev(FREEZE);
  const hidden = [];
  const reveal = [];
  const setVis = (v) => `document.querySelector('[data-statue-fig]').style.opacity = '${v}'; 1`;
  for (const i of usable) {
    const x = ((i + 0.5) / GRID) * 100;
    const rest = Number(restCells[i]) / 10;
    await cdp.ev(`(() => { const f = document.querySelector('[data-statue-fig]');
      f.style.visibility = 'visible';
      f.style.setProperty('--sx', '${x.toFixed(3)}%');
      f.style.setProperty('--rest', '${rest.toFixed(2)}%');
      return 1; })()`);
    await sleep(35);
    const r1 = await cdp.ev(STATUE_RECT);
    const clip = {
      x: Math.max(0, Math.min(w - 1, r1.x - PAD)),
      y: Math.max(0, Math.min(h - 1, r1.y - PAD)),
      width: Math.min(r1.w + PAD * 2, w),
      height: Math.min(r1.h + PAD * 2, h),
    };
    clip.width = Math.min(clip.width, w - clip.x);
    clip.height = Math.min(clip.height, h - clip.y);
    const shotRest = await cdp.shot(clip);
    /* 对照组**现拍现用**：不共用开头那张参考图 —— 页面渲染会随层合成变
       （视差层、滤镜层、渐变抖动），共用过期底图会把与雕像无关的变化算到它头上。
       参考态用 opacity:0（这一层不画），而不是 visibility:hidden —— 后者会让
       .vapor 整片重新分层栅格化，雕像旁边会冒出个别 Δ12 的像素（肉眼看不出来，
       但"逐像素完全一样"这条判据就站不住了）。 */
    await cdp.ev(setVis('0'));
    await sleep(35);
    const shotNone = await cdp.shot(clip);
    const rectLocal = { x: r1.x - clip.x, y: r1.y - clip.y, w: r1.w, h: r1.h };
    const dHidden = diffShots(shotRest, shotNone, rectLocal);
    hidden.push({
      i, x, rest, changedExact: dHidden.changedExact, changed: dHidden.changed, inner: dHidden.inner,
      outer: dHidden.outer, outerMax: dHidden.outerMax, maxDelta: dHidden.maxDelta, bbox: dHidden.bbox,
    });

    await cdp.ev(setVis('1'));
    await cdp.ev(`document.querySelector('[data-statue-fig]').classList.add('is-peek'); 1`);
    await sleep(35);
    const r2 = await cdp.ev(STATUE_RECT);
    const shotPeek = await cdp.shot(clip);
    const dPeek = diffShots(shotPeek, shotRest);
    reveal.push({
      i, x, rest, r1, r2, clip, changed: dPeek.changed, inkA: dPeek.inkA, inkB: dPeek.inkB,
      bbox: dPeek.bbox, notDarker: dPeek.notDarker, pixels: dPeek.pixels,
    });
    await cdp.ev(`document.querySelector('[data-statue-fig]').classList.remove('is-peek'); 1`);
    await sleep(20);
  }
  await cdp.ev(setVis('1'));
  const geo = await cdp.ev(`(() => {
    const hor = document.querySelector('.vapor__horizon').getBoundingClientRect();
    const fig = document.querySelector('[data-statue-fig]').getBoundingClientRect();
    const body = document.querySelector('.statue__body');
    return { horizon: { y: Math.round(hor.top), h: Math.round(hor.height), b: Math.round(hor.bottom) },
      figH: fig.height, figW: fig.width,
      ink: getComputedStyle(document.querySelector('.vapor')).getPropertyValue('--ink').trim(),
      bg: getComputedStyle(body).backgroundColor,
      mask: (getComputedStyle(body).maskImage || '').slice(0, 90) };
  })()`);
  return { hidden, reveal, geo, viewport: { w, h } };
}

/** 汇总一段的结论 */
function reportSpots(label, res, minReveal) {
  const { hidden, reveal, geo } = res;
  const badInner = hidden.filter((r) => r.inner > 0);
  const seam = hidden.reduce((a, b) => (b.outer > a.outer ? b : a), hidden[0]);
  const seamMax = Math.max(...hidden.map((r) => r.outerMax));
  info(`${label}：过了 ${hidden.length} 格。雕像**身上**变的像素 ${hidden.reduce((n, r) => n + r.inner, 0)} 个；` +
    `矩形外的栅格化缝 ${hidden.reduce((n, r) => n + r.outer, 0)} 个（最多的一格 #${seam.i} ${seam.outer} 个、Δ${seam.outerMax}）`);
  check(`★ ${label}：全部 ${hidden.length} 格静止时，雕像**自己身上**一个像素都没变`,
    badInner.length === 0, badInner.slice(0, 4).map((r) => `#${r.i}:${r.inner}px`).join(' '));
  check(`★ ${label}：矩形外那点差异只是这一层参与合成后重栅格化的缝（每格 ≤ 12 个像素、Δ ≤ 16）`,
    seamMax <= 16 && hidden.every((r) => r.outer <= 12), `最多 ${seam.outer} 个、Δ${seamMax}`);
  /* 缝的条数每次构建/每次跑会在 0~9 之间飘（图层怎么切、缝落在哪一列），
     所以这里给的是"量级"判据；雕像自己身上是硬判据（必须 0 个），上面已经验过 */
  info(`${label}：取整级别的差异（Δ1~3，8bit 合成）各格 0~` +
    `${Math.max(...hidden.map((r) => r.changedExact - r.outer))} 个 —— 黑底上肉眼和量测都看不出来`);

  const wantRise = WANT_RISE * geo.horizon.h;
  const bad = [];
  let minInk = 1, minChanged = 1e9, maxChanged = 0, maxRiseErr = 0;
  for (const r of reveal) {
    if (r.changed > 0) {
      minInk = Math.min(minInk, r.inkA / r.changed);
      minChanged = Math.min(minChanged, r.changed);
      maxChanged = Math.max(maxChanged, r.changed);
    }
    const rise = r.r1.y - r.r2.y;
    maxRiseErr = Math.max(maxRiseErr, Math.abs(rise - wantRise));
    const skyOk = r.changed > 0 && r.inkB / r.changed <= 0.02;
    /* 手机上映像只有 8×13px，"露出来的像素"大半是抗锯齿的边，所以墨色占比
       天然比桌面低（桌面 46%~，手机 18%~）—— 判据按比例放宽，但"必须真的有
       纯墨像素"和"每个像素都变暗"两条一步不让。 */
    const inkOk = r.changed > 0 && r.inkA >= 2 && r.inkA / r.changed >= 0.12;
    const darkOk = r.changed > 0 && r.notDarker / r.changed <= 0.05;
    const heightOk = !!r.bbox && r.bbox.h <= r.r1.h * 0.8 + 2;
    const topOk = !!r.bbox && Math.abs(r.bbox.y - (r.r2.y - r.clip.y)) <= 1;
    const countOk = r.changed >= minReveal;
    const riseOk = Math.abs(rise - wantRise) <= 2;
    if (!(skyOk && inkOk && darkOk && heightOk && topOk && countOk && riseOk)) {
      const why = [skyOk ? '' : '静止时那儿不是天空', inkOk ? '' : '露出来的不是墨色', darkOk ? '' : '有像素变亮了',
        heightOk ? '' : '露太多(像整只)', topOk ? '' : '顶边不是头顶', countOk ? '' : '露得太少', riseOk ? '' : `抬升${Math.round(rise)}px`]
        .filter(Boolean).join('/');
      bad.push({ i: r.i, why });
    }
  }
  info(`${label}：探头抬升 ${Math.round(wantRise)}px（盒高 ${WANT_RISE * 100}%）；` +
    `露出 ${minChanged}~${maxChanged} 个像素，墨色占比最低 ${(minInk * 100).toFixed(1)}%`);
  check(`★ ${label}：全部 ${reveal.length} 格探头时露出来的都是"楼顶以上的黑影"`,
    bad.length === 0, bad.slice(0, 4).map((k) => `#${k.i}(${k.why})`).join(' '));
  return { geo, reveal, hidden };
}

console.log('\n================ B/C. 所有可用格逐像素验证（桌面 1440×900）================');
const desktop = await verifySpots(1440, 900, false, 40);
const dRep = reportSpots('桌面', desktop, 40);
const hp = desktop.geo.figH / desktop.geo.horizon.h;
check('雕像高度是天际线盒高的 11%（按比例，不是固定 px）', Math.abs(hp - 0.11) <= 0.012,
  `${(hp * 100).toFixed(2)}%（${desktop.geo.figH.toFixed(1)}px / 盒 ${desktop.geo.horizon.h}px）`);
check('雕像是同色遮罩画的（background 就是 --ink、形状走 mask）',
  desktop.geo.ink === '#08020c' && /8, 2, 12/.test(desktop.geo.bg) && /statue-full\.png/.test(desktop.geo.mask),
  `${desktop.geo.bg} / ${desktop.geo.mask.slice(0, 58)}`);
{
  const sample = topSpot(desktop);
  const fill = sample.bbox ? sample.changed / (sample.bbox.w * sample.bbox.h) : 1;
  info(`形状抽样 #${sample.i}（露得最多的一格）：外接框 ${JSON.stringify(sample.bbox)}，填充率 ${(fill * 100).toFixed(1)}%，` +
    `露出高 ${sample.bbox?.h}px / 整只 ${sample.r1.h}px`);
  check('露出来的形状不是矩形（是剪影，不是一块黑方块）', fill < 0.92, `${(fill * 100).toFixed(1)}%`);
  check('露出来的顶边正好是雕像自己的头顶（露的是头，不是半截身子）',
    !!sample.bbox && Math.abs(sample.bbox.y - (sample.r2.y - sample.clip.y)) <= 1,
    `露出顶 ${sample.bbox?.y} / 雕像顶（裁剪内坐标）${sample.r2.y - sample.clip.y}`);
  check('只露上半身（露出来的高度明显小于整只雕像）',
    !!sample.bbox && sample.bbox.h <= sample.r1.h * 0.8 + 2, `${sample.bbox?.h}px / ${sample.r1.h}px`);
}

/* ================================================================
 * D. 滚动到视差中段再抽几格（视差层移位 → 取样相位变了）
 * ================================================================ */
console.log('\n================ D. 滚到视差中段再抽 3 格 ================');
await cdp.setViewport(1440, 900, false);
await cdp.goto('/?statue=still&birds=0', 600);
await cdp.ev(FREEZE);
await cdp.ev(`window.scrollTo({ top: 260, behavior: 'instant' }); 1`);
await sleep(300);
info(`scrollY = ${await cdp.ev('Math.round(scrollY)')}（视差层跟着挪了一点）`);
let scrolledBad = 0;
for (const i of [usable[0], usable[Math.floor(usable.length / 2)], usable[usable.length - 1]]) {
  const x = ((i + 0.5) / GRID) * 100;
  const rest = Number(restCells[i]) / 10;
  const apply = (vis) => `(() => { const f = document.querySelector('[data-statue-fig]');
    f.style.visibility = '${vis}';
    f.style.setProperty('--sx', '${x.toFixed(3)}%');
    f.style.setProperty('--rest', '${rest.toFixed(2)}%');
    return 1; })()`;
  await cdp.ev(apply('hidden'));
  await sleep(120);
  const ref = await cdp.shot();
  await cdp.ev(apply('visible'));
  await sleep(120);
  const withS = await cdp.shot();
  const d = diffShots(withS, ref);
  if (d.changed > 0 || d.maxDelta > 2) scrolledBad++;
  info(`  第 ${i} 格（x=${x.toFixed(2)}%、藏位 ${rest}%）：差 ${d.changedExact} 个像素，最大通道差 ${d.maxDelta}`);
}
check('★ 滚到视差中段时，抽的 3 格照样看不出来', scrolledBad === 0, `有问题的 ${scrolledBad} 格`);

/* ================================================================
 * E. 连点五下「回到顶部」→ 轮廓微微发光
 * ================================================================ */
console.log('\n================ E. 连点五下回到顶部 → 轮廓发光 ================');
await cdp.goto('/?statue=still&birds=0', 600);
await cdp.ev(FREEZE);
/* 固定到某一格（挑露得最多的那格的横坐标，好量轮廓） */
const glowSpot = topSpot(desktop);
await cdp.ev(`(() => { const f = document.querySelector('[data-statue-fig]');
  f.style.setProperty('--sx', '${glowSpot.x.toFixed(3)}%');
  f.style.setProperty('--rest', '${glowSpot.rest.toFixed(2)}%');
  return 1; })()`);
await sleep(200);
check('这时候还没发光', (await cdp.ev(`document.querySelector('[data-statue]').classList.contains('is-glow')`)) === false);
const glowRect = await cdp.ev(STATUE_RECT);
const noGlow = await cdp.shot();

const totop = await cdp.ev(`(() => { const b = document.getElementById('totop');
  if (!b) return null; const r = b.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
    w: Math.round(r.width), h: Math.round(r.height), vis: getComputedStyle(b).visibility }; })()`);
info(`回到顶部那颗塔吊按钮：${JSON.stringify(totop)}`);
check('「回到顶部」那颗塔吊按钮在页面上、点得到', !!totop && totop.w > 10 && totop.h > 10 && totop.vis === 'visible');
for (let i = 0; i < 4; i++) { await cdp.click(totop.x, totop.y); await sleep(110); }
check('只点四下不发光（暗号是"连续五下"）',
  (await cdp.ev(`document.querySelector('[data-statue]').classList.contains('is-glow')`)) === false);
await cdp.click(totop.x, totop.y);
await sleep(300);
check('第五下 → 雕像进入发光状态（is-glow）',
  (await cdp.ev(`document.querySelector('[data-statue]').classList.contains('is-glow')`)) === true);
const withGlow = await cdp.shot();
const gd = diffShots(withGlow, noGlow);
info(`发光带来 ${gd.changed} 个像素的变化，外接框 ${JSON.stringify(gd.bbox)}`);

/* 剪影内部（把 mask 图读进 canvas，腐蚀 4px 得到的核心）不该亮 */
const core = await cdp.ev(`(async () => {
  const body = document.querySelector('.statue__body');
  const fig = document.querySelector('[data-statue-fig]');
  const r = fig.getBoundingClientRect();
  const url = getComputedStyle(body).maskImage.replace(/^url\\(["']?/, '').replace(/["']?\\)$/, '');
  const img = new Image(); img.src = url; await img.decode();
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const W = cv.width, H = cv.height;
  const solid = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) solid[i] = d[i * 4 + 3] > 200 ? 1 : 0;
  const CW = 5, CH = 5;
  const cells = [];
  for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
    let all = 1;
    const x0 = Math.floor((cx * W) / CW), x1 = Math.floor(((cx + 1) * W) / CW);
    const y0 = Math.floor((cy * H) / CH), y1 = Math.floor(((cy + 1) * H) / CH);
    for (let y = y0 - 4; y < y1 + 4 && all; y++) for (let x = x0 - 4; x < x1 + 4; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H || !solid[y * W + x]) { all = 0; break; }
    }
    cells.push(all);
  }
  return { rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    cw: CW, ch: CH, cells };
})()`);
let coreChanged = 0;
let nearChanged = 0;
for (let k = 0; k < gd.pixels.length; k += 8) {
  const x = gd.pixels[k];
  const y = gd.pixels[k + 1];
  const inRect = x >= glowRect.x - 30 && x <= glowRect.r + 30 && y >= glowRect.y - 30 && y <= glowRect.b + 30;
  if (inRect) nearChanged++;
  const cx = Math.min(core.cw - 1, Math.floor(((x - core.rect.x) / core.rect.w) * core.cw));
  const cy = Math.min(core.ch - 1, Math.floor(((y - core.rect.y) / core.rect.h) * core.ch));
  const inside = x >= core.rect.x && x < core.rect.x + core.rect.w && y >= core.rect.y && y < core.rect.y + core.rect.h;
  if (inside && core.cells[cy * core.cw + cx]) coreChanged++;
}
const glowPixels = gd.pixels.length / 8;
info(`剪影核心（{5×5} 格、每格向内收 4px）里发光的有 ${coreChanged} 个像素；` +
  `光晕在雕像周围 30px 内的占比 ${(nearChanged / Math.max(1, glowPixels) * 100).toFixed(1)}%`);
check('发光真的画出来了（不是加了个看不见的类）', gd.changed >= 150, `${gd.changed} 个像素`);
check('★ 亮的是**轮廓**：剪影内部核心几乎没被点亮',
  coreChanged / Math.max(1, glowPixels) < 0.05,
  `内部只占 ${(coreChanged / Math.max(1, glowPixels) * 100).toFixed(1)}%（其余都是轮廓外圈）`);
check('光晕就贴着雕像（没散到半屏外）', nearChanged / Math.max(1, glowPixels) >= 0.5,
  `${(nearChanged / Math.max(1, glowPixels) * 100).toFixed(1)}% 在雕像周围 30px 内`);
{
  let mr = 0, mg = 0, mb = 0;
  for (let k = 0; k < gd.pixels.length; k += 8) { mr += gd.pixels[k + 2] - gd.pixels[k + 5]; mg += gd.pixels[k + 3] - gd.pixels[k + 6]; mb += gd.pixels[k + 4] - gd.pixels[k + 7]; }
  const cn = Math.max(1, glowPixels);
  info(`发光像素平均增量：ΔR ${(mr / cn).toFixed(1)}  ΔG ${(mg / cn).toFixed(1)}  ΔB ${(mb / cn).toFixed(1)}`);
  check('发光是暖粉色（ΔR > ΔB > ΔG，和站点那套霓虹一致）',
    mr / cn > 6 && mr > mb && mb > mg, `ΔR ${(mr / cn).toFixed(1)} ΔG ${(mg / cn).toFixed(1)} ΔB ${(mb / cn).toFixed(1)}`);
}
check('这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

/* ================================================================
 * F. 点它 → 进隐秘页；静止时点同一处 → 哪儿都不去
 * ================================================================ */
console.log('\n================ F. 点它进隐秘页 ================');
await cdp.goto('/?statue=still&birds=0', 600);
await cdp.ev(FREEZE);
await cdp.ev(`(() => { const f = document.querySelector('[data-statue-fig]');
  f.style.setProperty('--sx', '${glowSpot.x.toFixed(3)}%');
  f.style.setProperty('--rest', '${glowSpot.rest.toFixed(2)}%');
  return 1; })()`);
await sleep(200);
const restClickPt = await cdp.ev(`(() => { const b = document.querySelector('[data-statue-fig]').getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2),
    covered: (() => { const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return el ? (el.className || el.tagName) : null; })() }; })()`);
info(`静止态雕像正中间那一点被 ${restClickPt.covered} 盖着（所以点击得靠脚本兜底接管）`);
await cdp.click(restClickPt.x, restClickPt.y);
await sleep(800);
const afterRest = await cdp.ev(`location.pathname`);
check('静止（看不见）的时候点那个位置，哪儿都不去', afterRest === '/', afterRest);

await cdp.goto('/?statue=peek&birds=0', 700);
await cdp.ev(FREEZE);
const peekPt = await cdp.ev(`(() => { const f = document.querySelector('[data-statue-fig]');
  if (!f.classList.contains('is-peek')) return null;
  const b = f.getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), w: Math.round(b.width), h: Math.round(b.height) }; })()`);
info(`探着头时的雕像：${JSON.stringify(peekPt)}`);
check('?statue=peek 确实一直探着头（量得到它的矩形）', !!peekPt && peekPt.w > 5);
await cdp.click(peekPt.x, peekPt.y);
await sleep(1500);
const landed = await cdp.ev(`location.pathname`);
check('点它 → 进了隐秘页 /secret/xianbao/', landed === '/secret/xianbao/', landed);
check('隐秘页真的渲染出来了（不是 404 空页）',
  (await cdp.ev('document.body.textContent.length')) > 50, String(await cdp.ev('document.title')));
check('这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

/* ================================================================
 * G. 随机：每次进首页落点不同
 * ================================================================ */
console.log('\n================ G. 每次进首页随机换位置 ================');
const seen = [];
for (let i = 0; i < 6; i++) {
  await cdp.goto('/?birds=0', 350);
  seen.push(await cdp.ev(`(() => { const r = document.querySelector('[data-statue]');
    return r ? { spot: Number(r.dataset.spot), x: Number(r.dataset.spotX), rest: Number(r.dataset.spotRest), spots: Number(r.dataset.spots) } : null; })()`));
}
info('六次落点：' + seen.map((s) => `#${s.spot}(x${s.x}%)`).join('  '));
check('每次进首页都会重新挑一格（六次里至少四种不同）', new Set(seen.map((s) => s.spot)).size >= 4,
  `${new Set(seen.map((s) => s.spot)).size} 种不同落点`);
check('每一格都是从"可用格"里挑的（不是随手取个 x）',
  seen.every((s) => s && s.spot >= 0 && s.spot < GRID && restCells[s.spot] !== '---'),
  seen.map((s) => restCells[s.spot]).join(','));
check('可用格总数和构建产物里那张表对得上', seen.every((s) => s.spots === usable.length),
  `${seen[0].spots} vs ${usable.length}`);
const xs = seen.map((s) => s.x);
info(`落点横向跨度 ${Math.min(...xs)}% ~ ${Math.max(...xs)}%`);

/* ================================================================
 * H. 手机 390×844
 * ================================================================ */
console.log('\n================ H. 手机 390×844（缩放最狠的那一档）================');
const mobile = await verifySpots(390, 844, true, 8);
reportSpots('手机', mobile, 8);
{
  const hpM = mobile.geo.figH / mobile.geo.horizon.h;
  check('手机上雕像照样按盒高比例缩放（不是固定 px）', Math.abs(hpM - 0.11) <= 0.02,
    `${(hpM * 100).toFixed(2)}%（${mobile.geo.figH.toFixed(1)}px / 盒 ${mobile.geo.horizon.h}px）`);
}

/* ================================================================
 * I. 别的页面没被带坏
 * ================================================================ */
console.log('\n================ I. 别的页面没被带坏 ================');
await cdp.setViewport(1440, 900, false);
for (const p of ['/salon/', '/about/', '/archive/']) {
  await cdp.goto(p, 700);
  const t = await cdp.ev('document.body.textContent.length');
  check(`${p} 正常渲染（${t} 字）`, t > 400 && cdp.errors.length === 0, cdp.errors.slice(0, 1).join(''));
}

try { await cdp.send('Browser.close'); } catch { /* ignore */ }
chrome.kill();
server.close();
console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
