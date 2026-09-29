/*
 * ============================================================================
 * 精华里的动图：恢复得对不对 + 编辑器的 GIF 上传通不通
 * ----------------------------------------------------------------------------
 * 用户 2026-09-29 原话：
 *   「注意到精华消息里有些图片原文件是gif 然而上传到本站后却变成了图片 请你按照这个精华
 *    图包把对应的应该是gif的精华条目修复 并且在编辑器的页面与独立页面等可以上传图片的
 *    地方也同步加入上传gif的接口」
 *
 * 当年那次导出把动图拍平成了静态 jpg（第一帧 + 铺底）。用户这次给了原图包（21 张 gif），
 * 已按"抓图时刻 + 画面内容（必要时按透明铺底再比）"认回来，并按站里**已有那条规矩**
 * 处理：转成动图 WebP，帧数一帧不少、比原 GIF 小才换（68.4MB → 35.9MB）。
 *
 * 这个脚本盯四件事：
 *   ① 盘上：那 21 条精华指向的是动图文件、文件真的是多帧、旧的静态图已经不在引用了；
 *   ② 产物：精华页把它们当普通 <img> 发（没有静态变体把动图冻住）、清单里标着 animated；
 *   ③ 真浏览器：盯着其中一张，隔一会儿截两次图 —— **像素会变 = 真的在动**（旁边那张静态图作对照）；
 *   ④ 编辑器上传：GIF 能传、传上去还是动图；源码里每个图片上传口都收 image/gif。
 *
 * 用法：node tools/checks/salon-gif-check.mjs
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..');
const DIST = path.join(SRC, 'dist');
const DST = path.join(SRC, '.tmp', 'gif-copy');
const FIXTURE = path.join(here, 'fixtures', 'spin.gif');
const PORT = 4492;
const DEBUG_PORT = 9462;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/* sharp 是项目的直接依赖，从这个文件往上找 node_modules 就能解析到
   （⚠ 不能用绝对路径 import：Windows 上裸的 D:\… 不是合法 ESM URL，得先转 file://） */
const { default: sharp } = await import('sharp');
const framesOf = async (abs) => {
  const m = await sharp(abs, { failOn: 'none' }).metadata();
  return { frames: m.pages ?? 1, w: m.width, h: m.height, format: m.format };
};

const SALON = path.join(SRC, 'src/data/salon.json');
const PUBLIC = path.join(SRC, 'public');
const data = readJson(SALON);
/* 图片管线的清单：动图的宽高、有没有变体、标没标 animated 都在这里 */
const manifest = readJson(path.join(PUBLIC, 'img/opt/manifest.json'));
const allImages = data.essences.flatMap((e) => (e.images ?? []).map((p) => ({ id: e.id, p })));

/* ================================================================
 * ① 盘上：动图恢复得对不对
 * ================================================================ */
console.log('================ ① 精华里的动图（盘上）================');
const anim = allImages.filter((x) => /\.(gif|webp)$/i.test(x.p));
info(`精华图总共 ${allImages.length} 张，其中动图 ${anim.length} 张：` + anim.map((a) => a.id).join(' '));
check('★ 当年被拍平的那 21 条现在指的都是动图（.gif / .webp）', anim.length === 21, `${anim.length} 张`);
check('★ 这些动图都在盘上（没有指到空气）',
  anim.every((a) => fs.existsSync(path.join(PUBLIC, a.p.replace(/^\//, '')))),
  anim.filter((a) => !fs.existsSync(path.join(PUBLIC, a.p.replace(/^\//, '')))).map((a) => a.p).join(' '));

const frameRows = [];
for (const a of anim) {
  const f = await framesOf(path.join(PUBLIC, a.p.replace(/^\//, '')));
  frameRows.push({ ...a, ...f, bytes: fs.statSync(path.join(PUBLIC, a.p.replace(/^\//, ''))).size });
}
check('★ 每一个都**真的是多帧**（不是把静态图改了扩展名）',
  frameRows.every((r) => r.frames > 1),
  frameRows.map((r) => `${r.id}:${r.frames}帧`).join(' '));
info('帧数与体积：' + frameRows.map((r) => `${r.id} ${r.frames}帧 ${(r.bytes / 1024).toFixed(0)}KB`).join(' · '));

/*
  ★ 体积预算（2026-09-29 用户要求「压一下动图 以后上传的也要压」）。
  调档前：q72 不封宽 → 合计 35.9MB、最大一张 10.9MB。
  调档后：q50 + 封宽 800 → 合计 19.5MB、最大一张 3.9MB。
  这里钉住这个量级：以后谁把档调回去、或者塞进来一张没压过的大动图，立刻红。
*/
const animTotal = frameRows.reduce((n, r) => n + r.bytes, 0);
const animMax = frameRows.reduce((a, b) => (b.bytes > a.bytes ? b : a), frameRows[0]);
info(`动图合计 ${(animTotal / 1048576).toFixed(1)}MB，最大一张 ${animMax.id} ${(animMax.bytes / 1048576).toFixed(1)}MB`);
check('★ 21 张动图合计不超过 24MB（压缩档被调回去就会红）',
  animTotal < 24 * 1024 * 1024, `${(animTotal / 1048576).toFixed(1)}MB`);
check('★ 单张动图不超过 5MB',
  animMax.bytes < 5 * 1024 * 1024, `${animMax.id} ${(animMax.bytes / 1048576).toFixed(1)}MB`);
/* 落盘的动图都不该宽过封宽线（动图没有变体，落盘那份就是显示那份） */
const GIF_MAX_W = 800;
const tooWide = anim.filter((a) => (manifest.items?.[a.p]?.w ?? 0) > GIF_MAX_W);
check(`★ 没有超过封宽线（${GIF_MAX_W}px）的动图`,
  tooWide.length === 0, tooWide.map((a) => `${a.p}(${manifest.items?.[a.p]?.w}px)`).join(' ') || `都 ≤ ${GIF_MAX_W}px`);

check('★ 被顶掉的那些静态图（<id>-1.jpg）已经不在盘上了（不留重复的一份）',
  anim.every((a) => !fs.existsSync(path.join(PUBLIC, `img/salon/${a.id}-1.jpg`))),
  anim.filter((a) => fs.existsSync(path.join(PUBLIC, `img/salon/${a.id}-1.jpg`))).map((a) => a.id).join(' '));
check('盘上每一张精华图都在（292 张一张不少）',
  allImages.every((a) => fs.existsSync(path.join(PUBLIC, a.p.replace(/^\//, '')))),
  allImages.filter((a) => !fs.existsSync(path.join(PUBLIC, a.p.replace(/^\//, '')))).map((a) => a.p).join(' '));
check('图包里的原始 GIF 没有被塞进仓库（存的是压过的动图）',
  !fs.existsSync(path.join(PUBLIC, 'img/salon')) ||
    fs.readdirSync(path.join(PUBLIC, 'img/salon')).filter((f) => /\.gif$/i.test(f)).length === 0,
  fs.readdirSync(path.join(PUBLIC, 'img/salon')).filter((f) => /\.gif$/i.test(f)).length + ' 个 .gif');

/* ================================================================
 * ② 产物：动图不会被静态变体冻住
 * ================================================================ */
console.log('\n================ ② 产物里怎么发的 ================');
const html = fs.readFileSync(path.join(DIST, 'salon/index.html'), 'utf8');
const missInHtml = anim.filter((a) => !html.includes(a.p));
check('★ 21 张动图在精华页上都出现了', missInHtml.length === 0, missInHtml.map((a) => a.p).join(' '));

const withVariants = anim.filter((a) => (manifest.items?.[a.p]?.variants ?? []).length > 0);
check('★ 清单里这些动图都没有静态变体（有变体就会被浏览器挑走、动图当场变静图）',
  withVariants.length === 0, withVariants.map((a) => a.p).join(' '));
check('★ 清单里它们都标着 animated: true',
  anim.every((a) => manifest.items?.[a.p]?.animated === true),
  anim.filter((a) => manifest.items?.[a.p]?.animated !== true).map((a) => a.p).join(' '));
/* 页面上发给它们的是原文件（不是 -400/-520/-800 那种截图变体） */
const wrongSrc = anim.filter((a) => new RegExp(`${a.p.replace(/\.webp$/, '')}-\\d+\\.(webp|avif)`).test(html));
check('★ 页面上引用的就是动图本体的地址（没有 -400/-800 那种静态档）',
  wrongSrc.length === 0, wrongSrc.map((a) => a.p).join(' '));
check('页面上没有残留指向已删静态图的引用',
  !/img\/salon\/(e0008|e0164|e0177|e0185|e0242|e0248|e0262|e0275|e0310|e0343|e0350|e0415|e0545|e0560|e0572|e0611|e0616|e0625|e0671|e0673|e0678)-1\.jpg/.test(html));

/* ================================================================
 * ③ 真浏览器：它真的在动
 * ================================================================ */
console.log('\n================ ③ 真浏览器：真的会动吗 ================');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg',
};
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
    const f = path.join(DIST, t);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream' });
      return fs.createReadStream(f).pipe(res);
    }
  }
  res.writeHead(404);
  res.end('404');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = path.join(process.env.TEMP ?? '.', `dsh-gif-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu',
  '--enable-unsafe-swiftshader', '--disable-breakpad', '--window-size=1200,900',
  '--force-device-scale-factor=1',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

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
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails?.exception?.description ?? '');
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
let cdp = null;
for (let i = 0; i < 80 && !cdp; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const p = list.find((t) => t.type === 'page');
    if (p) cdp = await CDP.attach(p.webSocketDebuggerUrl);
  } catch { /* 等 */ }
}
if (!cdp) {
  console.error('Chromium 没起来');
  process.exit(2);
}
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/salon/` });
for (let i = 0; i < 300; i++) { await sleep(100); if ((await cdp.ev('document.readyState')) === 'complete') break; }
await sleep(1200);

/**
 * 把某张图滚到视口中间，等它**真的加载完**，再量出它在**页面坐标**里的矩形。
 *
 * ⚠ 两个坑（第一版都踩了）：
 *   · `Page.captureScreenshot` 的 clip 用的是**页面坐标**（文档坐标），不是视口坐标 ——
 *     滚动之后直接拿 getBoundingClientRect 的值去裁，裁到的是页面别处（一片纯色，
 *     PNG 只有 1.4KB，两张当然"一模一样"）；
 *   · 图片是 loading="lazy"，滚动进视口之后还要等一会儿才下载完 —— 没加载完截到的也是空白。
 */
const rectOf = async (sel) =>
  cdp.ev(`(async () => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    for (let i = 0; i < 100; i++) {
      if (el.complete && el.naturalWidth > 0) break;
      await new Promise((r) => setTimeout(r, 60));
    }
    await new Promise((r) => setTimeout(r, 250));
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left + window.scrollX),
      y: Math.round(r.top + window.scrollY),
      w: Math.round(r.width),
      h: Math.round(r.height),
      loaded: el.complete && el.naturalWidth > 0,
      natural: el.naturalWidth + '×' + el.naturalHeight,
    };
  })()`);

/** 连续截两张（中间等一会儿），比 PNG 字节 —— 不一样就说明画面在变 */
const shotTwice = async (r, gapMs = 420) => {
  const clip = {
    x: Math.max(0, r.x),
    y: Math.max(0, r.y),
    width: Math.max(8, Math.min(r.w, 600)),
    height: Math.max(8, Math.min(r.h, 600)),
    scale: 1,
  };
  const a = await cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
  await sleep(gapMs);
  const b = await cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
  return { same: a.data === b.data, bytesA: a.data.length, bytesB: b.data.length };
};

const animId = anim[0].p; // 随便挑一张真动图
const animRect = await rectOf(`img[src="${animId}"]`);
check(`找得到动图那张 <img>（${animId}）并等到它加载完`, !!animRect && animRect.loaded === true, JSON.stringify(animRect));
if (animRect) {
  const s = await shotTwice(animRect);
  info(`动图两次截图：${s.bytesA} / ${s.bytesB} 字节，字节相同=${s.same}`);
  check('截图那块地方不是一片纯色（不是没画出来的空白）', s.bytesA > 4000, `${s.bytesA} 字节`);
  check('★★ 真浏览器里这张图**在动**（隔 420ms 截两次图，像素不一样）', s.same === false,
    `两次截图字节 ${s.bytesA}/${s.bytesB}`);
}
/* 对照：旁边一张静态图应该两次完全一样（证明上面那个方法量的确实是"动没动"） */
const staticImg = allImages.find((a) => /\.jpg$/i.test(a.p) && html.includes(a.p));
const staticRect = staticImg ? await rectOf(`img[src="${staticImg.p}"]`) : null;
if (staticRect) {
  const s = await shotTwice(staticRect);
  info(`（对照）静态图 ${staticImg.p}：字节相同=${s.same}`);
  check('（对照）静态图两次截图一模一样 —— 说明上面那一条量的不是"渲染噪声"', s.same === true,
    `两次截图字节 ${s.bytesA}/${s.bytesB}`);
}

/* ================================================================
 * ④ 编辑器：GIF 传得上去、传上去还是动图
 * ================================================================ */
console.log('\n================ ④ 编辑器里的 GIF 上传 ================');
/* ④-1 源码扫一遍：每个图片上传口都收 gif，服务端白名单也有 */
{
  const app = fs.readFileSync(path.join(SRC, 'tools/editor/ui/app.js'), 'utf8');
  const accepts = [...app.matchAll(/accept\s*=\s*'([^']*image[^']*)'/g)].map((m) => m[1]);
  const constAccept = /const IMAGE_ACCEPT = '([^']+)'/.exec(app)?.[1] ?? '';
  info(`界面上的图片 accept 列表共 ${accepts.length} 处；IMAGE_ACCEPT = ${constAccept}`);
  check('★ 编辑器界面上每个图片上传口都收 image/gif（含页面 / 独立页面用的那个共用组件）',
    constAccept.includes('image/gif') && accepts.every((a) => a.includes('image/gif') || a === '') &&
      accepts.filter((a) => a.startsWith('image/')).every((a) => a.includes('image/gif')),
    accepts.filter((a) => a.startsWith('image/') && !a.includes('image/gif')).join(' | ') || '全部包含 image/gif');
  const srv = fs.readFileSync(path.join(SRC, 'tools/editor/server.mjs'), 'utf8');
  check('★ 服务端上传白名单里有 image/gif',
    /UPLOAD_MIME = new Map\(\[[\s\S]{0,200}'image\/gif'/.test(srv),
    (/UPLOAD_MIME = new Map\(\[[\s\S]{0,200}?\]/.exec(srv)?.[0] ?? '').replace(/\s+/g, ' '));
  const opt = fs.readFileSync(path.join(SRC, 'tools/images/optimize.mjs'), 'utf8');
  check('★ 上传压缩那段对动图是"转成动图 WebP / 编不了就原样留 GIF"（不会拍平成一帧）',
    /isAnimated[\s\S]{0,400}animated: true/.test(opt) && /动图 → WebP/.test(opt));
}

/* ④-2 真接口：POST 一个真动图上去 */
{
  /* 副本：和别的验收一样，改坏了也不动真仓库 */
  if (fs.existsSync(DST)) {
    const j = path.join(DST, 'node_modules');
    if (fs.existsSync(j)) { try { execSync(`cmd /c rmdir "${j}"`, { stdio: 'ignore' }); } catch { /* 不是 junction */ } }
    fs.rmSync(DST, { recursive: true, force: true });
  }
  fs.mkdirSync(DST, { recursive: true });
  for (const item of ['src', 'tools', 'astro.config.mjs', 'package.json', 'tsconfig.json']) {
    fs.cpSync(path.join(SRC, item), path.join(DST, item), { recursive: true });
  }
  fs.cpSync(path.join(SRC, 'public'), path.join(DST, 'public'), { recursive: true });
  execSync(`cmd /c mklink /J "${path.join(DST, 'node_modules')}" "${path.join(SRC, 'node_modules')}"`, { stdio: 'ignore' });
  console.log('副本就绪：', DST);

  const fixture = fs.readFileSync(FIXTURE);
  const fMeta = await framesOf(FIXTURE);
  info(`测试用的动图：${FIXTURE.split(path.sep).pop()} ${fMeta.w}×${fMeta.h} ${fMeta.frames} 帧 ${(fixture.length / 1024).toFixed(0)}KB`);

  const editor = spawn(process.execPath, [path.join(DST, 'tools/editor/server.mjs')], {
    cwd: DST,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let elog = '';
  editor.stdout.on('data', (b) => { elog += b.toString('utf8'); });
  editor.stderr.on('data', (b) => { elog += b.toString('utf8'); });
  let base = '';
  for (let i = 0; i < 400 && !base; i++) {
    await sleep(150);
    const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(elog);
    if (m) base = `http://127.0.0.1:${m[1]}`;
  }
  check('副本里的编辑器起来了', !!base, base || elog.slice(-160));

  if (base) {
    const r = await fetch(`${base}/api/upload?name=spin.gif`, {
      method: 'POST',
      headers: { 'content-type': 'image/gif' },
      body: fixture,
      signal: AbortSignal.timeout(120_000),
    });
    const json = await r.json().catch(() => null);
    info('上传结果：' + JSON.stringify(json).slice(0, 260));
    check('★ POST /api/upload 收 image/gif（不再报"不支持的图片类型"）', r.status === 200, `status=${r.status}`);
    /* 回执字段是 path（老版本叫 url，两个都认） */
    const url = String(json?.path ?? json?.url ?? '');
    check('上传之后拿到的是一个站内地址', url.startsWith('/img/'), url || JSON.stringify(json).slice(0, 120));
    const stored = path.join(DST, 'public', url.replace(/^\//, ''));
    check('★ 传上去的文件真的落盘了', fs.existsSync(stored), url);
    if (fs.existsSync(stored)) {
      const st = await framesOf(stored);
      info(`落盘：${path.basename(stored)} ${st.w}×${st.h} ${st.frames} 帧 ${st.format}`);
      check('★★ 传上去的**还是动图**（帧数 > 1 —— 这一条就是用户说的"变成图片"的反面）',
        st.frames > 1, `${st.frames} 帧`);
      check('★ 而且接口把这件事写在回执里了（"动图 → WebP（N 帧）"或"动图原样保留"）',
        /动图/.test(String(json?.note ?? '')), String(json?.note ?? ''));
    }

    /* ④-3b ★ 用户要求「以后上传的也要压」：传一张**超宽**的动图，落盘必须被压到封宽线以内。
       超宽那张不用提交进仓库，现场从测试动图拉宽出来（只为了验证"封宽"这一步真的在跑）。 */
    const wide = await sharp(fixture, { failOn: 'none', animated: true })
      .resize({ width: 1200, height: 260, fit: 'fill' })
      .gif({ loop: 0, delay: 80 })
      .toBuffer();
    const wideMeta = await framesOf(wide);
    info(`现场造的宽动图：1200×260 ${wideMeta.frames} 帧 ${(wide.length / 1024).toFixed(0)}KB`);
    const rw = await fetch(`${base}/api/upload?name=wide.gif`, {
      method: 'POST',
      headers: { 'content-type': 'image/gif' },
      body: wide,
      signal: AbortSignal.timeout(180_000),
    });
    const jw = await rw.json().catch(() => null);
    const wurl = String(jw?.path ?? jw?.url ?? '');
    info('宽动图上传结果：' + JSON.stringify(jw).slice(0, 200));
    check('★ 超宽动图也收（status 200）', rw.status === 200 && wurl.startsWith('/img/'), `${rw.status} ${wurl}`);
    if (wurl.startsWith('/img/')) {
      const wstored = path.join(DST, 'public', wurl.replace(/^\//, ''));
      const wm = await framesOf(wstored);
      info(`落盘：${path.basename(wstored)} ${wm.w}×${wm.h} ${wm.frames} 帧 ${(wm.bytes ?? 0) / 1024 || (fs.statSync(wstored).size / 1024).toFixed(0)}KB`);
      check('★★ 上传时被压到封宽线以内（1200 → ≤800px，动图没有变体，落盘那份就是最终那份）',
        wm.w <= 800, `${wm.w}px`);
      check('★ 压完还是动图（帧数没丢）', wm.frames > 1, `${wm.frames} 帧`);
      check('★ 体积也确实小了（回执里 before > after）',
        Number(jw?.before) > Number(jw?.after), `before=${jw?.before} after=${jw?.after}`);
    }

    /* ④-4 真界面：在冰山图面板的图片口里传同一张动图 */
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `${base}/` });
    for (let i = 0; i < 300; i++) { await sleep(100); if ((await cdp.ev('document.readyState')) === 'complete') break; }
    await sleep(1200);
    const fileInput = await cdp.ev(`(async () => {
      await window.__openWs('ice-chart');
      await new Promise((r) => setTimeout(r, 1600));
      const w = [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
      if (!w) return null;
      /* 分类/层级里第一个 file input 就是「背景图」上传口 */
      const input = w.querySelector('input[type=file]');
      if (!input) return null;
      input.setAttribute('data-gif-probe', '1');
      return { accept: input.accept || '', cls: input.className };
    })()`);
    check('★ 编辑器面板里的图片上传口收 gif（accept 里有 image/gif）',
      !!fileInput && String(fileInput.accept).includes('image/gif'), JSON.stringify(fileInput));
    if (fileInput) {
      await cdp.send('DOM.enable');
      const doc = await cdp.send('DOM.getDocument', { depth: -1 });
      const node = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[data-gif-probe="1"]' });
      check('找得到那个 file input 节点', node.nodeId > 0, String(node.nodeId));
      await cdp.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [FIXTURE] });
      await sleep(2500);
      const picked = await cdp.ev(`(() => {
        const w = [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
        const info = [...(w ? w.querySelectorAll('.wice__imgMeta, .wice__hint, .wsalon__hint, span, em') : [])]
          .map((el) => (el.textContent || '').trim()).filter((s) => /动图|上传|KB|MB/.test(s)).slice(0, 3);
        const imgs = [...(w ? w.querySelectorAll('img') : [])].map((el) => el.getAttribute('src')).filter(Boolean).slice(0, 3);
        return { info, imgs };
      })()`);
      info('传完之后界面上的提示：' + JSON.stringify(picked));
      check('★ 界面上认了这个动图（地址里是刚上传的那份，提示里提到动图/压缩）',
        (picked.imgs ?? []).some((s) => /\/img\/(uploads|salon|opt)\//.test(String(s))) ||
          (picked.info ?? []).some((s) => /动图/.test(String(s))),
        JSON.stringify(picked));
    }
    check('编辑器这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));
  }
  editor.kill();
}

try { await cdp.send('Browser.close'); } catch { /* ignore */ }
chrome.kill();
server.close();
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* ignore */ }

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
