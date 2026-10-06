/*
 * 文章 / 手记页的「老式电视机」皮肤验收（2026-10-06）
 *
 * 用户原话：
 *   「不要用现在这种亮粉色 而是和其他的页面类似 但是文章和手记的页面相比其他页面
 *     凸显出一种正在观看老式电视机的风格 正文部分的框内应当清晰好阅读
 *     而背景部分则是模糊且有蒸汽波和老式电视的栅格线运动且偶尔闪烁失真与雪花」
 *
 * 这件事最难的是「不许自说自话」：CSS 写没写、写了以后人眼看到的是什么，
 * 是两件事。所以这里的每一条都落在这三种证据上：
 *   ① 结构/计算样式：那一层在不在、模糊半径多少、动画跑没跑；
 *   ② **真截图里的像素**：把 PNG 解开，量背景两帧之间变了多少（栅格线真的在动吗）、
 *      量正文框里文字和底色的实际对比度（读得清吗）、量正文框稳不稳；
 *   ③ 行为：偶发的那几层（闪烁 / 撕裂 / 雪花）在 13 秒里到底闪过没有 ——
 *      用 rAF 采样它们的 opacity，而不是看 CSS 里写了 keyframes 就当它会闪。
 *
 * 用法：node tools/checks/post-crt-check.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..');
const ROOT = path.join(SRC, 'dist');
const PORT = 4391;
const DEBUG_PORT = 9361;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg', '.xml': 'application/xml' };

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

/* ================================================================
 * 极简 PNG 解码：只认 Chrome 截图会给出的那两种（8 位、非隔行、RGB/RGBA）
 * ================================================================ */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let at = 8;
  let w = 0;
  let h = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (at + 12 <= buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('ascii', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`没见过的 PNG：bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    line.copy(cur);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = cur[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    prev = cur;
  }
  return { width: w, height: h, bpp, data: out };
}

const px = (img, x, y) => {
  const i = (y * img.width + x) * img.bpp;
  return { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] };
};
/** 一块区域的平均色 */
function avgColor(img, x0, y0, w, h) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const c = px(img, x, y);
      r += c.r;
      g += c.g;
      b += c.b;
      n++;
    }
  }
  return { r: r / n, g: g / n, b: b / n };
}
/** 两帧之间「明显变了」的像素占比 */
function diffRatio(a, b) {
  const n = Math.min(a.width * a.height, b.width * b.height);
  let changed = 0;
  for (let i = 0; i < n; i++) {
    const ia = i * a.bpp;
    const ib = i * b.bpp;
    if (Math.abs(a.data[ia] - b.data[ib]) > 10
      || Math.abs(a.data[ia + 1] - b.data[ib + 1]) > 10
      || Math.abs(a.data[ia + 2] - b.data[ib + 2]) > 10) changed++;
  }
  return changed / n;
}
const srgb = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = (c) => 0.2126 * srgb(c.r) + 0.7152 * srgb(c.g) + 0.0722 * srgb(c.b);
const contrast = (a, b) => {
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
/**
 * 从一张「文字压在底上」的截图中量出对比度：
 * 底取所有像素的中位亮度，字取最亮的那 2%（深底浅字，本站就是这样）。
 * 这样量到的是**真画出来的颜色**（含面板 0.93 的透明度、玻璃反光、暗角），
 * 而不是 CSS 里写的那个值 —— 两者可以差很多，必须量像素。
 */
function textContrast(img) {
  const list = [];
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const c = px(img, x, y);
      list.push({ c, l: lum(c) });
    }
  }
  list.sort((a, b) => a.l - b.l);
  const pick = (q) => {
    const at = Math.min(list.length - 1, Math.floor(list.length * q));
    return list[at].c;
  };
  const bg = pick(0.5);
  const fg = pick(0.985);
  return { ratio: contrast(fg, bg), bg, fg };
}

/* ================================================================
 * 起静态服务 + 无头浏览器
 * ================================================================ */
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

const profile = path.join(process.env.TEMP ?? '.', `dsh-crt-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu',
  '--enable-unsafe-swiftshader', '--hide-scrollbars', '--disable-breakpad',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

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
        this.errors.push(`exception: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`);
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.errors.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
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
  /** 截一块区域的像素（给下面的「量像素」用） */
  async shot(clip) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    return decodePng(Buffer.from(r.data, 'base64'));
  }
  async open(url) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${url}` });
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      if ((await this.ev('document.readyState')) === 'complete') break;
    }
    await sleep(900);
  }
}

let cdp = null;
for (let i = 0; i < 60 && !cdp; i++) {
  await sleep(300);
  try {
    const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const t = l.find((x) => x.type === 'page');
    if (t) cdp = await CDP.attach(t.webSocketDebuggerUrl);
  } catch { /* 等它起来 */ }
}
check('无头浏览器起来了', !!cdp);
if (!cdp) process.exit(1);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const POST = '/posts/hello/';
const NOTE = '/notes/2026-10-05-songren/';
const LIST_POSTS = '/posts/';
const LIST_NOTES = '/notes/';
const OTHER = '/huaya/01nikki/';   // 对照组：这块皮肤**不该**跑到别的页面上去

/* ================================================================
 * ① 结构和计算样式：该有的层在不在、模糊了多少、动画跑没跑
 * ================================================================ */
console.log('\n================ ① 皮肤接线 ================');
await cdp.open(POST);
const wire = await cdp.ev(`(() => {
  const crt = document.querySelector('.crt');
  const box = document.querySelector('.crt-screen');
  const layers = ['crt__sky','crt__haze','crt__sun','crt__floor','crt__grid','crt__horizon',
                  'crt__scan','crt__snow','crt__tear','crt__bar','crt__flicker','crt__glass'];
  const has = {};
  for (const c of layers) has[c] = !!document.querySelector('.' + c);
  const cs = (sel) => getComputedStyle(document.querySelector(sel));
  const scanAnim = cs('.crt__scan');
  const body = getComputedStyle(document.body);
  return {
    bodyClass: document.body.className,
    bodyBg: body.backgroundColor,
    has,
    crtAria: crt ? crt.getAttribute('aria-hidden') : null,
    crtZ: crt ? cs('.crt').zIndex : null,
    crtPos: crt ? cs('.crt').position : null,
    hires: !!document.querySelector('.crt__tear--b') && !!document.querySelector('.crt__tear--c'),
    hazeBlur: cs('.crt__haze').filter,
    gridBlur: cs('.crt__grid').filter,
    gridTransform: cs('.crt__grid').transform,
    scanAnim: scanAnim.animationName + ' ' + scanAnim.animationDuration + ' ' + scanAnim.animationIterationCount,
    scanTile: scanAnim.backgroundImage.slice(0, 30),
    snowBlend: cs('.crt__snow').mixBlendMode,
    boxExists: !!box,
    boxWrapsProse: !!(box && box.querySelector('.prose')),
    boxBg: box ? cs('.crt-screen').backgroundColor : '',
    boxBackdrop: box ? cs('.crt-screen').backdropFilter : '',
    // 正文框里**没有**任何覆盖在文字上的装饰层（要求「正文部分清晰好阅读」）
    overlaysInsideProse: box ? box.querySelectorAll('.prose .crt__scan, .prose .crt__snow, .prose .crt__tear, .prose .crt__flicker').length : -1,
    animCount: document.getAnimations().length,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
})()`);

check('★ 这几页的 body 挂着 is-crt（配色令牌、页头页脚都挂在那个选择器上）',
  /\bis-crt\b/.test(wire.bodyClass), wire.bodyClass);
check('★ 背景那一层在，而且是 aria-hidden 的纯装饰（读屏/键盘都碰不到）',
  wire.crtAria === 'true', `aria-hidden=${wire.crtAria}`);
check('★ 它压在正文后面（position:fixed + z-index:-1），不挡点击',
  wire.crtPos === 'fixed' && wire.crtZ === '-1', `${wire.crtPos} / z-index ${wire.crtZ}`);
check('★ 蒸汽波那几件都在：天空 / 色雾 / 落日 / 栅格 / 地平线',
  ['crt__sky', 'crt__haze', 'crt__sun', 'crt__floor', 'crt__grid', 'crt__horizon'].every((c) => wire.has[c]),
  JSON.stringify(wire.has));
check('★ CRT 那几件都在：栅格线 / 雪花 / 撕裂（三条）/ 上滚亮带 / 闪烁 / 暗角',
  ['crt__scan', 'crt__snow', 'crt__tear', 'crt__bar', 'crt__flicker', 'crt__glass'].every((c) => wire.has[c]) && wire.hires,
  JSON.stringify({ tear: wire.has.crt__tear, three: wire.hires }));
check('★ 背景是**真的模糊**（色雾 blur ≥ 20px、栅格也带一点模糊）',
  /blur\((\d+(\.\d+)?)px\)/.test(wire.hazeBlur) && Number(/blur\((\d+(\.\d+)?)px\)/.exec(wire.hazeBlur)[1]) >= 20
  && /blur\(/.test(wire.gridBlur),
  `色雾 ${wire.hazeBlur} / 栅格 ${wire.gridBlur}`);
check('★ 栅格是**躺着透视**的（有 rotateX 变换，不是贴一张平图）',
  /matrix3d/.test(wire.gridTransform), wire.gridTransform);
check('★ CRT 栅格线一直在滚（infinite 的动画，贴图就是站里那张 8×32 内联 PNG）',
  /crt-scan-roll/.test(wire.scanAnim) && /infinite/.test(wire.scanAnim) && /data:image\/png/.test(wire.scanTile),
  wire.scanAnim);
check('★ 雪花用的是 SVG 湍流噪点 + screen 混合（不是一张要额外下载的图）',
  wire.snowBlend === 'screen', wire.snowBlend);
check('★ 正文被包在「电视机」框里，框是半透明 + backdrop 模糊的',
  wire.boxExists && wire.boxWrapsProse && /rgba\(/.test(wire.boxBg) && /blur/.test(wire.boxBackdrop),
  `${wire.boxBg} / ${wire.boxBackdrop}`);
check('★★ 正文文字上**没有任何**覆盖层（扫描线/雪花/撕裂都只在正文框后面）',
  wire.overlaysInsideProse === 0, `prose 内的装饰层数=${wire.overlaysInsideProse}`);
check('★ 页面上真的跑着动画（不是只有一堆静态层）',
  wire.animCount >= 8, `${wire.animCount} 个动画`);
check('★ 没有横向溢出', wire.overflow <= 1, `${wire.overflow}px`);

/* ================================================================
 * ② 量像素：背景在动、正文框稳、字读得清
 * ================================================================ */
console.log('\n================ ② 真截图里的像素 ================');
const geo = await cdp.ev(`(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
  const box = document.querySelector('.crt-screen');
  const p = document.querySelector('.prose p');
  const footer = document.querySelector('.site-footer');
  return {
    box: r(box),
    para: r(p),
    vw: innerWidth,
    vh: innerHeight,
    footerTop: footer ? footer.getBoundingClientRect().top + scrollY : null,
  };
})()`);
info(`正文框：x=${Math.round(geo.box.x)} y=${Math.round(geo.box.y)} ${Math.round(geo.box.w)}×${Math.round(geo.box.h)}；视口 ${geo.vw}×${geo.vh}`);

// 背景取样区：正文框左边那条空白（栅格 / 色雾 / 扫描线都在那儿动）
const bgClip = { x: 12, y: Math.round(geo.vh * 0.62), width: 260, height: 200 };
const bgA = await cdp.shot(bgClip);
await sleep(450);
const bgB = await cdp.shot(bgClip);
const bgMove = diffRatio(bgA, bgB);
check('★★ 背景那块真的在动（两帧之间有明显变化的像素超过 5%）',
  bgMove > 0.05, `变了 ${(bgMove * 100).toFixed(1)}%`);

// 正文取样区：一段正文（要求「清晰好阅读」，所以它必须**稳**）
const paraClip = {
  x: Math.round(geo.para.x) + 4,
  y: Math.round(geo.para.y) + 2,
  width: Math.min(Math.round(geo.para.w) - 8, 560),
  height: Math.round(geo.para.h) + 6,
};
const paraA = await cdp.shot(paraClip);
await sleep(450);
const paraB = await cdp.shot(paraClip);
const paraMove = diffRatio(paraA, paraB);
check('★★ 正文框里稳如纸面（同样两帧，变化的像素不到 2% —— 动效不许跑到字上）',
  paraMove < 0.02, `变了 ${(paraMove * 100).toFixed(2)}%`);

const bodyText = textContrast(paraA);
check('★★ 正文的**实际对比度** ≥ 7:1（AAA 那一档，量的是画出来的像素）',
  bodyText.ratio >= 7,
  `${bodyText.ratio.toFixed(1)}:1  字 rgb(${Math.round(bodyText.fg.r)},${Math.round(bodyText.fg.g)},${Math.round(bodyText.fg.b)}) 底 rgb(${Math.round(bodyText.bg.r)},${Math.round(bodyText.bg.g)},${Math.round(bodyText.bg.b)})`);

// 次级文字（日期、页脚那种 muted）在框里也要够 4.5:1
const muted = await cdp.ev(`(() => {
  const b = document.querySelector('.post-header__meta').getBoundingClientRect();
  return { x: Math.round(b.x) + 2, y: Math.round(b.y) + 2, width: Math.min(Math.round(b.width), 420), height: Math.round(b.height) };
})()`);
const mutedShot = await cdp.shot(muted);
const mutedText = textContrast(mutedShot);
check('★ 次级文字（日期/说明）也过 AA 4.5:1',
  mutedText.ratio >= 4.5, `${mutedText.ratio.toFixed(1)}:1`);

// 页面底色：不能还是那层亮粉
const bgShot = await cdp.shot({ x: 8, y: 150, width: 120, height: 90 });
const bgColor = avgColor(bgShot, 0, 0, bgShot.width, bgShot.height);
const pink = { r: 0xe8, g: 0xd0, b: 0xdd };
const pinkDist = Math.hypot(bgColor.r - pink.r, bgColor.g - pink.g, bgColor.b - pink.b);
check('★★ 页面底色不再是那层亮粉（#e8d0dd 距离 > 60，且亮度很低）',
  pinkDist > 60 && lum(bgColor) < 0.25,
  `rgb(${Math.round(bgColor.r)},${Math.round(bgColor.g)},${Math.round(bgColor.b)}) 距原亮粉 ${Math.round(pinkDist)} 亮度 ${lum(bgColor).toFixed(3)}`);

const bodyBg = await cdp.ev(`getComputedStyle(document.body).backgroundColor`);
check('★ body 自己的 background-color 也是深色（无障碍工具只认祖先链上的这个值）',
  lum(avgColor(await cdp.shot({ x: 0, y: 0, width: 4, height: 4 }), 0, 0, 2, 2)) < 0.5 && /^rgb\((\d+), (\d+), (\d+)\)$/.test(bodyBg)
  && (() => {
    const m = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(bodyBg);
    return lum({ r: +m[1], g: +m[2], b: +m[3] }) < 0.05;
  })(), bodyBg);

/* ================================================================
 * ③ 行为：偶尔的闪烁 / 撕裂 / 雪花，30 秒里真的出现过吗
 * ----------------------------------------------------------------
 * 为什么要 30 秒：三条撕裂带的周期是 13 / 19 / 29 秒（刻意错开，不然三条一起闪
 * 就不像信号不稳了）。窗口最短，所以必须采满最长那条一个周期，才量得到「三条都出现过」。
 * 采的是 rAF 里的 computed opacity —— 也就是说这些层是真的在闪，而不是 CSS 里
 * 写了 keyframes 就算数。
 * ================================================================ */
console.log('\n================ ③ 「偶尔」的那几下（采 30 秒） ================');
const bursts = await cdp.ev(`(async () => {
  const read = (sel) => Number(getComputedStyle(document.querySelector(sel)).opacity);
  const seen = { flicker: 0, tearA: 0, tearB: 0, tearC: 0, snowMin: 9, snowMax: -1, snow: 0 };
  const t0 = performance.now();
  while (performance.now() - t0 < 30000) {
    await new Promise((r) => requestAnimationFrame(r));
    seen.flicker = Math.max(seen.flicker, read('.crt__flicker'));
    seen.tearA = Math.max(seen.tearA, read('.crt__tear--a'));
    seen.tearB = Math.max(seen.tearB, read('.crt__tear--b'));
    seen.tearC = Math.max(seen.tearC, read('.crt__tear--c'));
    const s = read('.crt__snow');
    seen.snowMin = Math.min(seen.snowMin, s);
    seen.snowMax = Math.max(seen.snowMax, s);
    seen.snow++;
  }
  return seen;
})()`);
check('★★ 闪烁真的发生过（30 秒里 .crt__flicker 亮到过 0.5 以上）',
  bursts.flicker >= 0.5, `峰值 ${bursts.flicker.toFixed(2)}`);
check('★★ 三条失真撕裂带各自都出现过（周期 13/19/29 秒错开，不是一直挂着）',
  bursts.tearA >= 0.5 && bursts.tearB >= 0.5 && bursts.tearC >= 0.5,
  `A ${bursts.tearA.toFixed(2)} / B ${bursts.tearB.toFixed(2)} / C ${bursts.tearC.toFixed(2)}`);
check('★★ 雪花会「偶尔爆一下」（同一个窗口里最弱和最强大不一样）',
  bursts.snowMax - bursts.snowMin > 0.15, `${bursts.snowMin.toFixed(2)} → ${bursts.snowMax.toFixed(2)}（采样 ${bursts.snow} 帧）`);

/* ================================================================
 * ④ 「动效可以关」：系统开了减少动态效果时，这一堆循环动画要真的停
 * ================================================================ */
console.log('\n================ ④ 减少动态效果 ================');
await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await cdp.open(POST);
const reduced = await cdp.ev(`(() => {
  const names = ['.crt__scan', '.crt__snow', '.crt__tear--a', '.crt__flicker', '.crt__grid', '.crt__haze']
    .map((s) => getComputedStyle(document.querySelector(s)).animationName);
  return { names, running: document.getAnimations().filter((a) => a.playState === 'running').length };
})()`);
check('★ 系统开了「减少动态效果」时，背景那几层的动画全部停掉（不是压到 0.01ms 乱跳）',
  reduced.names.every((n) => n === 'none'), reduced.names.join(' / '));
check('★ 而且页面上没有还在跑的动画', reduced.running === 0, `${reduced.running} 个 running`);
await cdp.send('Emulation.setEmulatedMedia', { features: [] });

/* ================================================================
 * ⑤ 别把皮肤洒到别的页面 / 手记和列表页也真的换了
 * ================================================================ */
console.log('\n================ ⑤ 只管这几页 ================');
for (const [label, url, want] of [
  ['手记详情页', NOTE, true],
  ['文章列表页', LIST_POSTS, true],
  ['手记列表页', LIST_NOTES, true],
  ['别的页面（版块页）', OTHER, false],
]) {
  await cdp.open(url);
  const r = await cdp.ev(`(() => ({
    cls: document.body.className,
    crt: !!document.querySelector('.crt'),
    screen: !!document.querySelector('.crt-screen'),
    hasContent: !!document.querySelector('.crt-screen .prose, .crt-screen .post-list'),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))()`);
  const isCrt = /\bis-crt\b/.test(r.cls) && r.crt && r.screen && r.hasContent;
  if (want) {
    check(`★ ${label} 换上了这套皮肤（背景层 + 正文/列表都在框里）`, isCrt && r.overflow <= 1, JSON.stringify(r).slice(0, 120));
    check(`★ ${label} 没有 JS 报错`, cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));
  } else {
    check(`★ ${label} **没有**被这套皮肤污染（还是原来那个样子）`,
      !/\bis-crt\b/.test(r.cls) && !r.crt, `class=${r.cls}`);
  }
}

await cdp.open(POST);
check('★ 文章详情页也没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

/* ================================================================
 * ⑥ 窄屏（390×844）：框要贴屏、不能溢出、字还得读得清
 * ================================================================ */
console.log('\n================ ⑥ 窄屏 ================');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp.open(POST);
const mob = await cdp.ev(`(() => {
  const box = document.querySelector('.crt-screen').getBoundingClientRect();
  const p = document.querySelector('.prose p').getBoundingClientRect();
  return {
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    boxX: Math.round(box.x), boxW: Math.round(box.width), vw: innerWidth, vh: innerHeight,
    para: { x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) },
    blur: getComputedStyle(document.querySelector('.crt__haze')).filter,
  };
})()`);
check('★ 手机上不横向溢出，正文框贴着屏宽（两侧还留了边）',
  mob.overflow <= 1 && mob.boxX >= 0 && mob.boxX + mob.boxW <= mob.vw + 1,
  `溢出 ${mob.overflow}px，框 x=${mob.boxX} w=${mob.boxW} / 视口 ${mob.vw}`);
/* 取样框要夹在视口里：clip 超出可视区 Chrome 会直接报参数错 */
const mobW = Math.max(60, mob.para.width - 4);
const mobH = Math.max(10, Math.min(mob.para.height, mob.vh - 4));
const mobY = Math.max(0, Math.min(mob.para.y, mob.vh - mobH - 2));
const mobShot = await cdp.shot({ x: Math.max(0, mob.para.x + 2), y: mobY, width: mobW, height: mobH });
const mobText = textContrast(mobShot);
check('★ 手机上正文对比度照样 ≥ 7:1', mobText.ratio >= 7, `${mobText.ratio.toFixed(1)}:1`);
check('★ 窄屏下背景的模糊半径收小了（省电，也不至于糊成一片）',
  /blur\((\d+(\.\d+)?)px\)/.test(mob.blur) && Number(/blur\((\d+(\.\d+)?)px\)/.exec(mob.blur)[1]) <= 40,
  mob.blur);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

/* ================================================================ */
try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch { /* 已经退了 */ }
server.close();
await sleep(200);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 删不掉就算了 */ }

console.log('\n================ 结果 ================');
console.log(`PASS ${pass}   FAIL ${fail}`);
if (fail > 0) process.exit(1);
