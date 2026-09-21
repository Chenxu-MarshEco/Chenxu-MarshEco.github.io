#!/usr/bin/env node
/**
 * ============================================================================
 * 「雕像藏进城市影」的取位数据生成器
 * ----------------------------------------------------------------------------
 * 用户要求（2026-09）：
 *   「雕像的出现改为每次进入首页都会让一个雕像随机刷新在和城市影重合的位置
 *     看不出来，然后雕像会偶尔探头出来，引导用户点击」
 *
 * 要做到**看不出来**，只有一条路：
 *   雕像和楼群同一个墨色（--ink #08020c）、画在楼群**前面**，
 *   而且雕像身上每一个不透明的像素，落点处楼群**渲染出来必须是纯墨** ——
 *   只要有一个像素探到楼顶以上、或者压在一条"被缩放抹成半透明"的细楼/天线上，
 *   天上就会多出一块本不该有的黑。
 *
 * 所以判据是**逐像素 + 二维**的，而且用的"实心图"必须是浏览器真正画出来的那张：
 *
 *   ① 源图两条：skyline.png 母本 + 线上那一档（opt/home/skyline-1600.webp）。
 *      两条的屋面并不一样（nearest 重采样会丢列，实测最大差 37% 盒高），
 *      所以**取交集**（两边都实心的地方才敢站）。
 *   ② 浏览器实测两条（headless Chromium 截图，像素恰好 == #08020c 才算实心）：
 *      窄屏上浏览器会走 mipmap，比核还细的天线会被抹成半透明的墨
 *      （实测 390 宽时 p95 差 12.5% 盒高），源图上明明是实心的地方渲染出来不是。
 *   ③ 每条剖面都按**列**存成"不透明区间"的列表，不是只存一条屋面线 ——
 *      楼与楼之间有通到天际的缝，楼身上还有洞（实测第 193 格那一列：
 *      46%~50% 有墨、52% 半透明、58%~74% 整段是天空、76% 以下才有墨）。
 *      雕像比楼矮，可它的**下半截**正好悬在洞里，静止态就露出一块人形。
 *      只按"屋面线"判会放它过去，所以必须算区间。
 *
 * 于是每个候选横坐标的算法是：
 *   对剪影每一列 j，它在那一列占的高度范围是 [sTop[j], sBot[j]]×h；
 *   要求存在一个不透明区间 [a,b] 使 rest 落在 [a − sBot[j]·h, b − sTop[j]·h]；
 *   把所有列允许的 rest 区间**求交**，取其中最小的那个（站得最高 = 探头最容易露出来），
 *   再往下让 MARGIN 的余量；最后数"抬升 PEEK 之后露出来多少剪影像素"，
 *   只保留露出比例合适、而且露出来的确实是上半身（不是某个翅膀尖）的位置。
 *
 * 为什么可以离线算一次就写死：
 *   雕像尺寸按**天际线盒高的百分比**给（不是 px），而 .vapor__skyline 是
 *   background-size:100% 100% + aspect-ratio:1773/526 —— 图像坐标到盒子坐标的
 *   映射是线性的、和视口无关。实测剖面在窄屏（模糊最重）和宽屏各取一条，
 *   交集算出来的位置两边都安全。home-statue-check 会把全部可用格在两个跨度上
 *   逐像素复验一遍。
 *
 * 这个脚本还负责把 statue.png（身体，翅膀被挖掉了）和 statue-wing.png
 * 合成一张完整立像 statue-full.png —— 翅膀单独一层本来是为了扇动，
 * 现在改成"站在楼后面探头"，不扇了，合成一张省掉一层遮罩。
 *
 * 怎么跑：
 *   node tools/egg/fit-statue.mjs                 # 出数据（实测剖面走缓存）
 *   node tools/egg/fit-statue.mjs --remeasure     # 强制重新实测渲染剖面
 *   node tools/egg/fit-statue.mjs --sweep         # 扫一遍参数，看有几处可用
 *   node tools/egg/fit-statue.mjs --map           # 打印雕像剪影字符图
 *   node tools/egg/fit-statue.mjs --hf 0.12 --peek 0.06 --margin 0.01
 *
 * ⚠ 换了 skyline.png / statue*.png，或者改了 .vapor__skyline 的尺寸写法，
 *   都要重跑一遍（末尾那两行 data-* 抄回 HomeStatue.astro）。
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const HOME = path.join(ROOT, 'public', 'img', 'home');
const BODY = path.join(HOME, 'statue.png');
const WING = path.join(HOME, 'statue-wing.png');
const FULL = path.join(HOME, 'statue-full.png');
const SKY = path.join(HOME, 'skyline.png');
/** 线上真正渲染的那一档（页面用的是 variantUrl(skyline.png, 1600)）*/
const SKY1600 = path.join(ROOT, 'public/img/opt/home/skyline-1600.webp');
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : dflt;
};
const WANT_MAP = argv.includes('--map');
const WANT_SWEEP = argv.includes('--sweep');
const REMEASURE = argv.includes('--remeasure');

/** 雕像高度 = 天际线盒子高度的这个比例 */
const HF = argOf('hf', 0.11);
/** 探头时抬升多少（同样是盒高的比例），其中含 MARGIN 的余量 */
const PEEK = argOf('peek', 0.05);
/** 源图那一档的腐蚀半径（像素）：把抗锯齿的软边也剔掉 */
const SOLID = argOf('solid', 1);
/** 站定之后再往下让多少（盒高比例）：子像素相位、视差层移位带来的取样相位变化 */
const MARGIN = argOf('margin', 0.01);
/** 露出比例（占剪影实心像素数）的合格区间 */
const R_MIN = argOf('rmin', 0.12);
const R_MAX = argOf('rmax', 0.5);
/** 露出来的部分必须够靠上：最小的自身行号不能超过这个 */
const TOP_ROW = argOf('toprow', 0.4);
/** 候选点密度：沿画面宽度均匀取多少个（索引直接写进 data-rests） */
const GRID = argOf('grid', 200);
/** 实测渲染剖面的跨度：窄屏（模糊最重）和桌面各一条 */
const VIEWPORTS = [[390, 844], [1440, 900]];

const INK = [8, 2, 12];
const pct = (v) => (v * 100).toFixed(1);
const pc = (v) => v * 100;

/* ---------------------------------------------------------------------------
   ① 合成完整剪影 + 取剪影自己的逐列上下沿
   ------------------------------------------------------------------------ */
const bodyMeta = await sharp(BODY).metadata();
const wingMeta = await sharp(WING).metadata();
if (bodyMeta.width !== wingMeta.width || bodyMeta.height !== wingMeta.height) {
  throw new Error('身体和翅膀尺寸不一致，合成会对不上位');
}
await sharp(BODY).composite([{ input: WING }]).png({ compressionLevel: 9 }).toFile(FULL);

const full = await sharp(FULL).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const FW = full.info.width;
const FH = full.info.height;
const FC = full.info.channels;
const at = (j, r) => full.data[(r * FW + j) * FC + 3];

/** 每一列最高的实心行 / 最低的实心行（占自身高度的比例）。1 = 这一列没有实心 */
const sTop = new Float64Array(FW).fill(1);
const sBot = new Float64Array(FW).fill(0);
let opaque = 0;
let offInk = 0;
let minX = FW, maxX = -1, minY = FH, maxY = -1;
for (let j = 0; j < FW; j++) {
  for (let r = 0; r < FH; r++) {
    const i = (r * FW + j) * FC;
    if (full.data[i + 3] > 0) {
      if (sTop[j] === 1) sTop[j] = r / FH;
      sBot[j] = r / FH;
    }
    if (full.data[i + 3] > 127) {
      opaque++;
      if (full.data[i] !== INK[0] || full.data[i + 1] !== INK[1] || full.data[i + 2] !== INK[2]) offInk++;
      if (j < minX) minX = j;
      if (j > maxX) maxX = j;
      if (r < minY) minY = r;
      if (r > maxY) maxY = r;
    }
  }
}
/** 数「露出多少像素」用的实心点表（含自身行号） */
const inkPx = [];
for (let r = 0; r < FH; r++) {
  for (let j = 0; j < FW; j++) {
    if (at(j, r) > 127) inkPx.push(j, r / FH);
  }
}
const inkCount = inkPx.length / 2;
const ASPECT = FW / FH;

console.log('① 合成立像剪影');
console.log(`   源   ${path.relative(ROOT, BODY)} + ${path.relative(ROOT, WING)}`);
console.log(`   成品 ${path.relative(ROOT, FULL)}  ${FW}×${FH}  宽高比 ${ASPECT.toFixed(4)}`);
console.log(`   实心像素 ${opaque}（${((opaque / (FW * FH)) * 100).toFixed(1)}%），bbox x${minX}..${maxX} y${minY}..${maxY}`);
console.log(`   非 --ink 的实心像素 ${offInk} 个（这张图只当遮罩用，颜色由 background 给，所以不影响）`);

if (WANT_MAP) {
  const CW = 46, CH = 30;
  console.log('\n   剪影字符图（# = 实心）');
  for (let cy = 0; cy < CH; cy++) {
    let line = '   ';
    for (let cx = 0; cx < CW; cx++) {
      const x0 = Math.floor((cx * FW) / CW), x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * FW) / CW));
      const y0 = Math.floor((cy * FH) / CH), y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * FH) / CH));
      let n = 0, t = 0;
      for (let r = y0; r < y1; r++) for (let j = x0; j < x1; j++) { t++; if (at(j, r) > 127) n++; }
      const f = n / t;
      line += f > 0.6 ? '#' : f > 0.25 ? '+' : f > 0.05 ? '.' : ' ';
    }
    console.log(line);
  }
}

/* ---------------------------------------------------------------------------
   ② 工具：把一张遮罩按列切成"不透明区间"
   ------------------------------------------------------------------------ */
/**
 * 逐列切区间（都是占图高的比例）：
 *   runs[x] = [[a,b], …]  这一段里这一列是实心的
 *   top[x]  第一个实心像素（楼的屋面），数"探出来多少"时用它当真正的边界
 */
function columnRuns(mask, w, h) {
  const runs = new Array(w);
  const top = new Float64Array(w).fill(1);
  for (let x = 0; x < w; x++) {
    const list = [];
    let y = 0;
    while (y < h) {
      if (!mask[y * w + x]) { y++; continue; }
      const a = y;
      while (y < h && mask[y * w + x]) y++;
      list.push([a / h, y / h]);
    }
    runs[x] = list;
    if (list.length) top[x] = list[0][0];
  }
  return { runs, top };
}

/* ---------------------------------------------------------------------------
   ③ 源图两条剖面（母本 + 线上那一档），各带一点腐蚀剔掉抗锯齿软边
   ------------------------------------------------------------------------ */
async function sourceProfile(file, R) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const c = info.channels;
  const ink = new Uint8Array(w * h);
  let bad = 0;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * c;
      if (data[i + 3] > 127) {
        ink[y * w + x] = 1;
        if (data[i] !== INK[0] || data[i + 1] !== INK[1] || data[i + 2] !== INK[2]) bad++;
      }
    }
  }
  /*
    腐蚀：以这个像素为中心、边长 2R+1 的方块里全是墨才算实心。
    源图的边缘是抗锯齿的（半透明的墨），缩放之后会变成"比纸还淡的一圈"，
    雕像压上去就不是同色叠同色了。二维腐蚀拆成横竖两趟（可分离）。
    出界按边界钳 —— background-size:100% 100% 时图正好铺满盒子，边缘外没别的东西。
  */
  const erode = (src, horiz) => {
    const out = new Uint8Array(w * h);
    const n = horiz ? w : h;
    const m = horiz ? h : w;
    for (let b = 0; b < m; b++) {
      for (let a = 0; a < n; a++) {
        let all = 1;
        for (let d = -R; d <= R && all; d++) {
          const aa = Math.max(0, Math.min(n - 1, a + d));
          if (!src[horiz ? b * w + aa : aa * w + b]) all = 0;
        }
        out[horiz ? b * w + a : a * w + b] = all;
      }
    }
    return out;
  };
  const er = R > 0 ? erode(erode(ink, true), false) : ink;
  return { w, h, bad, R, ...columnRuns(er, w, h) };
}

/* ---------------------------------------------------------------------------
   ④ 浏览器实测剖面：页面上那条屋面到底画成什么样
   ------------------------------------------------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function measureRendered(width, height) {
  const dist = path.join(ROOT, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.log('   ⚠ 没有 dist/（先构建一次），跳过实测');
    return null;
  }
  const cache = path.join(ROOT, '.tmp', `roof-rendered-${width}.json`);
  if (!REMEASURE && fs.existsSync(cache)) {
    const c = JSON.parse(fs.readFileSync(cache, 'utf8'));
    if (c.v === 3) return c;
  }
  const port = 4411 + (width % 7);
  const dport = 9381 + (width % 7);
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
      const f = path.join(dist, t);
      if (fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream' });
        return fs.createReadStream(f).pipe(res);
      }
    }
    res.writeHead(404); res.end('404');
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const profDir = path.join(process.env.TEMP ?? '.', `dsh-statuefit-${width}-${Date.now()}`);
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu',
    '--enable-unsafe-swiftshader', '--disable-breakpad', `--window-size=${width},${height}`,
    `--user-data-dir=${profDir}`, `--remote-debugging-port=${dport}`, 'about:blank'], { stdio: 'ignore' });
  let out = null;
  try {
    let ws = null;
    for (let i = 0; i < 80 && !ws; i++) {
      await sleep(250);
      try {
        const list = await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json();
        const page = list.find((t) => t.type === 'page');
        if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
      } catch { /* 还没起来 */ }
    }
    if (!ws) throw new Error('chromium 没起来');
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    let id = 0;
    const pend = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pend.has(m.id)) {
        const { res, rej } = pend.get(m.id);
        pend.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      }
    });
    const send = (method, params = {}) => {
      const i = ++id;
      ws.send(JSON.stringify({ id: i, method, params }));
      return new Promise((res, rej) => pend.set(i, { res, rej }));
    };
    const ev = async (expression) =>
      (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/?statue=off&birds=0` });
    for (let i = 0; i < 200; i++) { await sleep(80); if ((await ev('document.readyState')) === 'complete') break; }
    await ev('document.fonts ? document.fonts.ready.then(()=>1) : 1');
    await sleep(700);
    await ev(`(() => { const s = document.createElement('style');
      s.textContent = '*,*::before,*::after{animation:none !important;transition:none !important}';
      document.head.append(s); return 1; })()`);
    await sleep(150);
    const box = await ev(`(() => { const b = document.querySelector('.vapor__horizon').getBoundingClientRect();
      return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; })()`);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const { data: px, info: meta } = await sharp(Buffer.from(shot.data, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const mask = new Uint8Array(box.w * box.h);
    for (let x = 0; x < box.w; x++) {
      for (let y = 0; y < box.h; y++) {
        const i = ((box.y + y) * meta.width + (box.x + x)) * meta.channels;
        if (Math.abs(px[i] - INK[0]) <= 2 && Math.abs(px[i + 1] - INK[1]) <= 2 && Math.abs(px[i + 2] - INK[2]) <= 2) {
          mask[y * box.w + x] = 1;
        }
      }
    }
    const { runs, top } = columnRuns(mask, box.w, box.h);
    out = { v: 3, width, height, boxW: box.w, boxH: box.h, runs, top };
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, JSON.stringify(out));
    try { await send('Browser.close'); } catch { /* ignore */ }
  } catch (err) {
    console.log(`   ⚠ ${width}×${height} 实测失败：${err.message}`);
  } finally {
    chrome.kill();
    server.close();
    await sleep(400);
    try { fs.rmSync(profDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* ignore */ }
  }
  return out;
}

const measured = [];
for (const [w, h] of VIEWPORTS) {
  const r = await measureRendered(w, h);
  if (r) measured.push(r);
}

const png = await sourceProfile(SKY, Math.round(SOLID * (1773 / 1600)));
const v16 = fs.existsSync(SKY1600) ? await sourceProfile(SKY1600, SOLID) : null;
const W = png.w;
const H = png.h;

let noInk = 0;
for (let x = 0; x < W; x++) if (!png.runs[x].length) noInk++;
console.log('\n② 天际线的实心剖面');
console.log(`   母本 ${path.relative(ROOT, SKY)}  ${W}×${H}  腐蚀半径 ${png.R}px`);
console.log(`   实墨非 --ink 像素 ${png.bad} 个 ${png.bad === 0 ? '✓ 与雕像同一支墨（谁盖谁都一样黑）' : '⚠ 颜色不纯'}`);
console.log(`   完全没有实墨的列 ${noInk} 列（楼与楼之间通到岸线的缝）`);
if (v16) {
  let diff = 0;
  let worstU = 0;
  let worstD = 0;
  for (let i = 0; i < v16.w; i++) {
    const u = (i + 0.5) / v16.w;
    const a = png.top[Math.min(W - 1, Math.round(u * W))];
    const b = v16.top[i];
    const d = Math.abs(a - b);
    if (d > 0.001) diff++;
    if (d > worstD) { worstD = d; worstU = u; }
  }
  console.log(`   线上那一档 ${path.relative(ROOT, SKY1600)}  ${v16.w}×${v16.h}（nearest 重采样）`);
  console.log(`     · 和母本屋面不一样的位置 ${diff}/${v16.w} 处，最大差 ${pct(worstD)}% 盒高（x=${pct(worstU)}%）` +
    ` → 两条都实心的地方才敢站`);
} else {
  console.log('   ⚠ 没找到线上那一档（先跑一次 node tools/images/optimize.mjs），' +
    '这次只用母本剖面 —— 遇到被 nearest 丢掉的天线会露馅');
}
if (measured.length) {
  console.log(`   浏览器实测 ${measured.map((m) => `${m.width}×${m.height}（盒 ${m.boxW}×${m.boxH}）`).join(' / ')}`);
} else {
  console.log('   ⚠ 一条实测剖面都没有 —— 只用源图剖面，窄屏上被缩放抹细的天线会露馅');
}

/* ---------------------------------------------------------------------------
   ⑤ 逐像素解安全位（全部用「盒宽 / 盒高的比例」，和视口无关）
   ------------------------------------------------------------------------ */
/** 雕像在盒宽里占多少 */
const wFrac = HF * (H / W) * ASPECT;
/** 剪影第 j 列 → 相对雕像中轴的位置（盒宽比例） */
const colOffset = (j) => (j / FW - 0.5) * wFrac;

/** 区间列表规范化：排序 + 合并重叠/相接的段（不合并的话求交会越滚越多，实测跑爆堆） */
function normalize(list) {
  if (list.length < 2) return list;
  const s = list.slice().sort((p, q) => p[0] - q[0]);
  const out = [s[0].slice()];
  for (let i = 1; i < s.length; i++) {
    const last = out[out.length - 1];
    if (s[i][0] <= last[1] + 1e-9) last[1] = Math.max(last[1], s[i][1]);
    else out.push(s[i].slice());
  }
  return out;
}

/**
 * 某个位置必须多实心：把四条剖面在同一列的区间求交。
 * 结果按 u 缓存（剪影有 150 列，而 u 只落在很窄的一段里，不缓存会重复算上万次）。
 */
const runsCache = new Map();
function runsAt(u) {
  const key = Math.round(Math.max(0, Math.min(1, u)) * 40000);
  const hit = runsCache.get(key);
  if (hit) return hit;
  const cl = (v) => Math.max(0, Math.min(1, v));
  const cu = cl(u);
  let acc = null;
  const add = (list) => {
    if (!acc) { acc = list.map((r) => r.slice()); return; }
    const out = [];
    for (const [a1, b1] of acc) {
      for (const [a2, b2] of list) {
        const a = Math.max(a1, a2);
        const b = Math.min(b1, b2);
        if (b > a) out.push([a, b]);
      }
    }
    acc = normalize(out);
  };
  add(png.runs[Math.min(W - 1, Math.round(cu * W))]);
  if (v16) add(v16.runs[Math.min(v16.w - 1, Math.round(cu * v16.w))]);
  for (const m of measured) add(m.runs[Math.min(m.boxW - 1, Math.round(cu * m.boxW))]);
  acc = acc || [];
  runsCache.set(key, acc);
  return acc;
}

/** 位置的「实墨屋面」—— 数"探出来多少"用它，那才是天上的真正边界 */
function tInkAt(u) {
  const cl = (v) => Math.max(0, Math.min(1, v));
  const a = png.top[Math.min(W - 1, Math.round(cl(u) * W))];
  const b = v16 ? v16.top[Math.min(v16.w - 1, Math.round(cl(u) * v16.w))] : 1;
  return v16 ? Math.max(a, b) : a;
}

/** 两个区间列表求交 */
function intersect(A, B) {
  const out = [];
  for (const [a1, b1] of A) {
    for (const [a2, b2] of B) {
      const a = Math.max(a1, a2);
      const b = Math.min(b1, b2);
      if (b >= a) out.push([a, b]);
    }
  }
  return normalize(out);
}

/**
 * 某个横坐标上"站得最高又不露馅"的藏位。
 * 每一列给出允许的 rest 区间集合，逐列求交；取最小的可行 rest（站得越高，
 * 探头抬同样的高度越容易露出来）。区间高度不够装下整只剪影的直接丢掉。
 */
function restAt(cu) {
  let feas = null;
  for (let j = 0; j < FW; j++) {
    if (sTop[j] >= 1) continue; // 剪影这一列本身没实心，不构成约束
    const u = cu + colOffset(j);
    if (u < 0 || u > 1) return null;
    const lo = sTop[j] * HF;
    const hi = sBot[j] * HF;
    const iv = [];
    for (const [a, b] of runsAt(u)) {
      if (b - a < HF + MARGIN * 2) continue; // 这一段装不下整只剪影
      /* 约束是"剪影在那一列占的每一行都落在 [a,b] 里"：
           rest + sTop·h ≥ a  →  rest ≥ a − lo
           rest + sBot·h ≤ b  →  rest ≤ b − hi
         ⚠ 这两行一开始写反了（x0 用 hi、x1 用 lo），于是雕像被放高了
         (sBot−sTop)·h —— 最多能高出一整只雕像，静止态脑袋直接探出楼顶。
         home-statue-check 的逐像素比对把它逮住了。 */
      const x0 = a - lo;
      const x1 = b - hi;
      if (x1 >= x0) iv.push([x0, x1]);
    }
    if (!iv.length) return null;
    feas = feas ? intersect(feas, iv) : normalize(iv);
    if (!feas.length) return null;
  }
  if (!feas) return null;
  for (const [a, b] of feas) {
    if (b < 0.02) continue; // 贴着盒子顶边不算（那上面是天空，本来就站不住）
    return Math.max(0.02, a) + MARGIN;
  }
  return null;
}

/** 抬升 PEEK 之后露出多少、露得够不够靠上 */
function revealAt(cu, rest) {
  let n = 0;
  let topRow = 1;
  for (let k = 0; k < inkPx.length; k += 2) {
    const j = inkPx[k];
    const r = inkPx[k + 1];
    if (rest + r * HF - PEEK < tInkAt(cu + colOffset(j))) {
      n++;
      if (r < topRow) topRow = r;
    }
  }
  return { n, frac: n / inkCount, topRow };
}

function scan(hf, peek, margin) {
  const wf = hf * (H / W) * ASPECT;
  const out = [];
  for (let i = 0; i < GRID; i++) {
    const cu = (i + 0.5) / GRID;
    const rest = restAt(cu);
    if (rest === null || rest + hf > 1) continue;
    let n = 0, topRow = 1;
    for (let k = 0; k < inkPx.length; k += 2) {
      const j = inkPx[k];
      const r = inkPx[k + 1];
      if (rest + r * hf - peek < tInkAt(cu + (j / FW - 0.5) * wf)) { n++; if (r < topRow) topRow = r; }
    }
    const frac = n / inkCount;
    out.push({ i, cu, rest, frac, topRow, ok: frac >= R_MIN && frac <= R_MAX && topRow <= TOP_ROW });
  }
  return out;
}

if (WANT_SWEEP) {
  console.log('\n③ 参数扫描（GRID=' + GRID + '，括号里是可用点的 x 覆盖范围）');
  const hfs = [0.08, 0.09, 0.1, 0.11, 0.12, 0.13];
  const peeks = [0.045, 0.05, 0.055, 0.065, 0.08];
  console.log('   hf\\peek   ' + peeks.map((p) => String(p).padStart(14)).join(''));
  for (const hf of hfs) {
    const cells = [];
    for (const peek of peeks) {
      const r = scan(hf, peek, MARGIN);
      const ok = r.filter((v) => v.ok);
      const xs = ok.map((v) => Math.round(v.cu * 100));
      cells.push(`${ok.length}(${xs.length ? Math.min(...xs) + '-' + Math.max(...xs) : '—'})`.padStart(14));
    }
    console.log(`   ${hf.toFixed(2)}      ` + cells.join(''));
  }
}

const cells = scan(HF, PEEK, MARGIN);
const good = cells.filter((v) => v.ok);

console.log(`\n③ 安全位（雕像高 ${pct(HF)} 盒高、宽 ${pct(wFrac)} 盒宽；` +
  `探头抬升 ${pct(PEEK)} 盒高 = 自身高的 ${pct(PEEK / HF)}%，其中 ${pct(MARGIN)} 是余量）`);
console.log(`   判据：四条剖面在雕像落点处都实心（按列切区间算，楼身上的洞也算），` +
  `探头露出 ${pct(R_MIN)}~${pct(R_MAX)}% 的实心像素，且露出的最上行 ≤ ${TOP_ROW}（是上半身）`);
console.log(`   ${GRID} 个候选点里可用 ${good.length} 个`);
if (!good.length) {
  console.log('   ⚠ 一个可用点都没有 —— 跑 --sweep 换个 hf/peek 再来');
  process.exit(1);
}

const buckets = new Map();
for (const v of good) {
  const b = Math.floor(v.cu * 10);
  if (!buckets.has(b)) buckets.set(b, []);
  buckets.get(b).push(v);
}
console.log('   x 分布（每 10% 一档）：' +
  [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([b, v]) => `${b * 10}%:${v.length}`).join('  '));
console.log('   例子：');
for (const v of good.filter((_, k) => k % Math.max(1, Math.floor(good.length / 6)) === 0)) {
  console.log(`     第 ${String(v.i).padStart(3)} 格 x=${pct(v.cu).padStart(5)}%  ` +
    `藏位 ${pct(v.rest).padStart(5)}%  探头露出 ${pct(v.frac).padStart(4)}%  最上行 ${v.topRow.toFixed(2)}`);
}

/* ---------------------------------------------------------------------------
   ⑥ 输出可以直接抄进组件的那两行
   ------------------------------------------------------------------------ */
const rests = new Array(GRID).fill('---');
for (const v of good) rests[v.i] = String(Math.round(pc(v.rest) * 10)).padStart(3, '0');
const peekFig = Math.round(pc(PEEK / HF));
const line = rests.join(' ');

console.log('\n④ 抄进 HomeStatue.astro 的数据（rests 是 3 位定长：盒高百分比×10，--- = 这一格不能用）');
console.log(`   data-grid="${GRID}"`);
console.log(`   data-peek="${peekFig}"`);
console.log(`   data-rests="${line}"`);
console.log(`   （${line.length} 字符）`);

const dest = path.join(ROOT, '.tmp', 'statue-fit.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify({
  hf: HF, peek: PEEK, margin: MARGIN, solid: SOLID, peekFig, grid: GRID,
  rMin: R_MIN, rMax: R_MAX, topRow: TOP_ROW, wFrac, spanXBoxFrac: wFrac,
  skyline: { w: W, h: H, noInk },
  sprite: { w: FW, h: FH, aspect: ASPECT, opaque },
  measured: measured.map((m) => ({ w: m.width, h: m.height, boxW: m.boxW, boxH: m.boxH })),
  good: good.map((v) => ({ i: v.i, x: pc(v.cu), rest: pc(v.rest), reveal: pc(v.frac), topRow: v.topRow })),
  attr: line,
}, null, 2));
console.log(`\n   明细 ${path.relative(ROOT, dest)}`);
