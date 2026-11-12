/*
 * ============================================================================
 * 首页「吊车吊着置顶公告」的验收（真浏览器 + 真几何）
 * ----------------------------------------------------------------------------
 * 用户原话（2026-11-11，第二版，推翻重做）：
 *   「和预期的差非常多 需要推翻重做 …… 参考你以前在背景里制作的这种塔吊
 *     然后看画面右侧我用红色线条描绘的部分 塔吊只露出前半截横向吊臂
 *     下面吊有货物 货物本身就是公告UI框 你做的可以比我的小一点
 *     呈现出这台塔吊相对于背景的塔吊更靠近摄像机的感觉
 *     这台塔吊也和背景的一样吊臂会微微转动」
 *
 * 所以这里量的是「像一台吊车」而不是「好看不好看」：
 *   A  构建产物：横臂 / 小车 / 吊带 / 货箱都在，旧版的立式塔吊痕迹清干净了
 *   B  桌面 1600×900 的几何：横臂从屏幕右缘伸进来（右端被屏幕切掉，不是画出来的端头）、
 *      横臂中轴跟「花涧堂」的视觉中线齐平、货箱挂在右侧而且整只在视口里、
 *      货箱和标题一个像素都不重叠
 *   C  回转：横臂真的在缓缓动（几秒内位移几像素），但幅度不至于把货箱晃出界；
 *      系统开了「减少动态效果」时一律不动
 *   D  滚动：往下滚过封面 → 整组退到屏幕右缘之外；滚回顶部 → 原样回来
 *   E  点击：点货箱正中 → 真的进那条公告的地址
 *   F  手机 390×844：横臂在标题块**下沿以下**（不横穿标题和那行副标题）、货箱整只可见
 *   G  别的页面没被带坏 + 全程没有 JS 报错
 *
 * 用法：node tools/checks/home-pinned-crane-check.mjs [dist目录]
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { chromePath } from './lib/chrome.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
const PORT = 4499;
const DEBUG_PORT = 9399;
const CHROME = chromePath();
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

const indexPath = path.join(root, 'index.html');
if (!fs.existsSync(indexPath)) {
  console.error(`找不到 ${indexPath}，先构建`);
  process.exit(2);
}

/* ================================================================
 * A. 构建产物
 * ================================================================ */
console.log('================ A. 构建产物 ================');
const html = fs.readFileSync(indexPath, 'utf8');
check('首页有置顶公告容器（data-home-pinned）', /data-home-pinned/.test(html));
check('横臂的桁架在上面（homepin__jib / homepin__chord / homepin__web）',
  /homepin__jib/.test(html) && /homepin__chord/.test(html) && /homepin__web/.test(html));
check('有挂货的小车（homepin__trolley）', /homepin__trolley/.test(html));
/* 回转必须挂在 <g class="homepin__slew"> 上：挂在 <svg> 上的话视口裁切框会跟着缩放，
   臂就离开屏幕右缘了（2026-11-12 实测过一次） */
check('回转挂在横臂内部的 <g> 上（不是挂在 <svg> 上）',
  /<g class="homepin__slew"/.test(html));
check('有吊绳 + 两根吊带（homepin__cable / homepin__slings / homepin__hook）',
  /homepin__cable/.test(html) && /homepin__slings/.test(html) && /homepin__hook/.test(html));
check('货箱就是公告本体（.homepin__box 是个 <a>，带公告 id）',
  /class="homepin__box"[^>]*href=/.test(html) && /data-announce-id=/.test(html));
/* 注意 homepin__cab 必须加 \b：不加的话会把 homepin__cable 也匹配上 */
check('旧版「立式塔吊 + 塔身 + 捆绳」的痕迹清干净了',
  !/homepin__mast/.test(html) && !/homepin__rope/.test(html) && !/homepin__cab\b/.test(html));

const astroDir = path.join(root, '_astro');
const css = fs.existsSync(astroDir)
  ? fs.readdirSync(astroDir).filter((f) => f.endsWith('.css'))
    .map((f) => fs.readFileSync(path.join(astroDir, f), 'utf8')).join('\n')
  : '';
const inlineCss = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const allCss = css + inlineCss;
check('回转动画的样式在产物里（两条 @keyframes 都在，都挂在 .homepin__slew 上）',
  /@keyframes homepin-jib-slew/.test(allCss) && /@keyframes homepin-load-slew/.test(allCss)
  && /\.homepin__slew[^{]*\{[^}]*homepin-jib-slew/.test(allCss),
  'homepin-jib-slew / homepin-load-slew');
check('横臂用的墨色跟背景天际线同一个变量（--ink）', /var\(--ink/.test(allCss));
check('吊绳 / 吊带也是黑色的（和背景那三台塔吊的吊索一个墨色）',
  /* 产物里的选择器会带上 Astro 的作用域属性，所以中间那段用 [^{]* 兜住 */
  /\.homepin__cable[^{]*\{[^}]*stroke:\s*var\(--ink/.test(allCss)
  && /\.homepin__slings[^{]*\{[^}]*stroke:\s*var\(--ink/.test(allCss));
/* 产物 CSS 是压缩过的：scaleX(0.875) 会写成 scaleX(.875)，所以数字要容许省略前导 0 */
check('横臂回转照背景的做法：同时有 scaleX 和一点 rotate',
  /@keyframes homepin-jib-slew\{[\s\S]{0,400}?scaleX\(\.?8/.test(allCss)
  && /@keyframes homepin-jib-slew\{[\s\S]{0,400}?rotate\(-?\.?\d/.test(allCss));
check('货箱只绕着绳头轻晃（rotate，不横移、不会被推出屏幕）',
  /@keyframes homepin-load-slew\{[\s\S]{0,400}?rotate\(-?\.?\d/.test(allCss)
  && !/@keyframes homepin-load-slew\{[\s\S]{0,400}?translate/.test(allCss));
check('鼠标移上去有反馈（.homepin__box:hover 抬起来 + 光晕）',
  /* 产物里选择器长这样：.homepin__box[data-astro-cid-x]:hover{...}，作用域属性在 :hover 前面 */
  /\.homepin__box[^{]*:hover[^{]*\{[^}]*translateY\(-2px\)/.test(allCss));

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

const profileDir = path.join(process.env.TEMP ?? '.', `dsh-homepin-${Date.now()}`);
const chrome = spawn(
  CHROME,
  ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--disable-breakpad', '--window-size=1600,900', `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' },
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
    await sleep(60);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(40);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }
  /** 截图并解成裸像素（量桁架的墨色范围用） */
  async shot() {
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const { data, info } = await sharp(Buffer.from(r.data, 'base64')).raw().toBuffer({ resolveWithObject: true });
    return { data, w: info.width, h: info.height, c: info.channels };
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

/** 停掉动画/过渡，好让几何是可量的（B/D/F 段用） */
const FREEZE = `(() => {
  if (document.getElementById('__freeze')) return 1;
  const s = document.createElement('style');
  s.id = '__freeze';
  s.textContent = '*,*::before,*::after{animation:none !important;transition:none !important}';
  document.head.append(s);
  return 1;
})()`;

/*
 * 一次量全：横臂、货箱、标题、副标题、视口。
 * 「横臂的桁架中轴」不是 svg 的中心 —— 桁架在 viewBox 0..27 里占 y=6~22，
 * 中轴在 14/27 ≈ 0.52 处（下面那 5 个单位留给小车）。
 */
const GEOM = `(() => {
  const el = document.querySelector('[data-home-pinned]');
  if (!el) return { missing: true };
  const r = (n) => { const e = document.querySelector(n); return e ? e.getBoundingClientRect() : null; };
  const j = r('.homepin__jib');
  const b = r('.homepin__box');
  const t = r('.brand__title');
  const g = r('.brand__tagline');
  const rig = document.querySelector('.homepin__rig').getBoundingClientRect();
  const cs = getComputedStyle(document.querySelector('[data-home-pinned]'));
  const jj = j ? { left: j.left, right: j.right, top: j.top, height: j.height } : null;
  const bb = b ? { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height } : null;
  return {
    vw: document.documentElement.clientWidth,
    vh: window.innerHeight,
    jib: jj,
    trussCenter: jj ? jj.top + jj.height * 0.52 : null,
    box: bb,
    rig: { left: rig.left, right: rig.right, top: rig.top, bottom: rig.bottom },
    title: t ? { left: t.left, right: t.right, top: t.top, bottom: t.bottom, height: t.height } : null,
    tagline: g ? { left: g.left, right: g.right, top: g.top, bottom: g.bottom } : null,
    opacity: Number(cs.opacity),
    href: (document.querySelector('.homepin__box') || {}).getAttribute ? document.querySelector('.homepin__box').getAttribute('href') : '',
    away: el.classList.contains('is-away')
  };
})()`;

const overlap = (a, b) => !!a && !!b
  && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5
  && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;

/* ================================================================
 * B. 桌面几何
 * ================================================================ */
console.log('\n================ B. 桌面 1600×900 ================');
await cdp.setViewport(1600, 900, false);
await cdp.goto('/');
await cdp.ev(FREEZE);
await sleep(200);
let g = await cdp.ev(GEOM);
info(`视口 ${g.vw}×${g.vh}；横臂 ${Math.round(g.jib.left)}→${Math.round(g.jib.right)}、桁架中轴 ${Math.round(g.trussCenter)}`);
info(`货箱 ${Math.round(g.box.left)}→${Math.round(g.box.right)}，${Math.round(g.box.top)}→${Math.round(g.box.bottom)}`);
check('横臂从屏幕右缘伸进来（右端正好贴住视口右边，被切掉）',
  Math.abs(g.jib.right - g.vw) <= 1, `右端 ${g.jib.right.toFixed(1)} vs 视口 ${g.vw}`);
check('横臂伸进画面的长度是画面宽度的 12%~35%（"只露出前半截"）',
  (g.vw - g.jib.left) / g.vw > 0.12 && (g.vw - g.jib.left) / g.vw < 0.35,
  `${Math.round(((g.vw - g.jib.left) / g.vw) * 100)}% 宽`);
check('横臂中轴跟「花涧堂」的视觉中线齐平（差 ≤ 标题高度的 12%）',
  Math.abs(g.trussCenter - (g.title.top + g.title.height * 0.46)) <= g.title.height * 0.12,
  `桁架 ${g.trussCenter.toFixed(0)} vs 标题中线 ${(g.title.top + g.title.height * 0.46).toFixed(0)}`);
check('货箱整只在视口里（右边不越界、下边不出屏）',
  g.box.right <= g.vw + 0.5 && g.box.bottom <= g.vh, `右 ${g.box.right.toFixed(0)} / 下 ${g.box.bottom.toFixed(0)}`);
check('货箱挂在画面右半边、靠着右缘（离右缘 ≤ 40px）',
  g.box.left > g.vw * 0.55 && g.vw - g.box.right <= 40,
  `左 ${Math.round(g.box.left)}、离右缘 ${Math.round(g.vw - g.box.right)}px`);
check('货箱和标题块一个像素都不重叠', !overlap(g.box, g.title) && !overlap(g.jib, g.title));
check('货箱宽度不超过画面的 20%（不能盖住半个封面）', g.box.width <= g.vw * 0.2, `${Math.round(g.box.width)}px`);
/* 吊车"更靠近摄像机"：横臂比背景那三台大得多（背景最高那台 290px，横臂只有画面宽度的 1/4 左右） */
const bgCrane = await cdp.ev(`(() => { const c = document.querySelector('.crane--gap .crane__art');
  return c ? c.getBoundingClientRect().width : 0; })()`);
check('横臂明显比背景里最高那台塔吊宽（读得出"更近"）',
  (g.jib.right - g.jib.left) > bgCrane, `横臂 ${Math.round(g.jib.right - g.jib.left)}px vs 背景 ${Math.round(bgCrane)}px`);
check('货箱顶着「置顶」标签（公告 UI 本体，不是别的东西）',
  await cdp.ev(`(() => { const b = document.querySelector('.homepin__box');
    return !!b && /置顶/.test(b.textContent) && !!b.querySelector('.homepin__title'); })()`));
check('货箱是指向那条公告的链接', /^\/huaya\/bingshi\/photo\/20261001/.test(g.href || ''), g.href || '(空)');

/* ================================================================
 * C. 回转
 * ================================================================ */
console.log('\n================ C. 横臂缓缓回转（照背景那三台的做法：横向伸缩 + 一点点转） ================');
await cdp.goto('/'); /* 重新进来，去掉 B 段的冻结 */
const JIBRECT = '(() => { const j = document.querySelector(".homepin__slew").getBoundingClientRect(); return { top: j.top, left: j.left, right: j.right, width: j.width }; })()';
const live1 = await cdp.ev(JIBRECT);
await sleep(4200);
const live2 = await cdp.ev(JIBRECT);
const dTop = Math.abs(live2.top - live1.top);
const dLeft = Math.abs(live2.left - live1.left);
const dWidth = Math.abs(live2.width - live1.width);
info(`4.2 秒里横臂：左端移 ${dLeft.toFixed(1)}px、高度变 ${dWidth.toFixed(1)}px、纵向 ${dTop.toFixed(1)}px`);
check('横臂在转（4 秒内横向位移至少 1px）', dLeft > 1);
check('是**横向伸缩**（回转的透视缩短），不是上下摆动 —— 纵向位移 ≤ 6px', dTop <= 6, `纵向 ${dTop.toFixed(1)}px`);
check('伸缩幅度约 4 秒 10~50px（看得出在转、又不夸张）', dLeft >= 10 && dLeft <= 50, `${dLeft.toFixed(1)}px`);
const movingBox = await cdp.ev(GEOM);
check('动的时候货箱仍然在视口里（没被转出屏幕）',
  movingBox.box.right <= movingBox.vw + 0.5 && movingBox.box.bottom <= movingBox.vh);

/*
 * 吊绳要一直挂在小车下面：横臂压缩时小车会横着移，货箱要靠自己的 translateX 跟上。
 * 小车的包围盒取的是它在 SVG 里的矩形（会带上横臂的 transform），
 * 吊绳那一条的横坐标 = 吊带 SVG（= 货箱宽）的中线，两者必须一直重合。
 * 顺带核一下纵向：小车底边和吊带顶边是同一条线。
 */
const LINK = `(() => {
  const t = document.querySelector('.homepin__trolley').getBoundingClientRect();
  const s = document.querySelector('.homepin__sling').getBoundingClientRect();
  return { dx: Math.abs((t.left + t.width / 2) - (s.left + s.width / 2)),
    dy: Math.abs(t.bottom - s.top) };
})()`;
let worstDx = 0;
let worstDy = 0;
for (let i = 0; i < 9; i++) {
  const l = await cdp.ev(LINK);
  worstDx = Math.max(worstDx, l.dx);
  worstDy = Math.max(worstDy, l.dy);
  await sleep(430);
}
info(`吊绳与小车：横向最大偏差 ${worstDx.toFixed(1)}px、纵向最大偏差 ${worstDy.toFixed(1)}px`);
check('吊绳一直连在小车上（横向偏差 ≤ 3px，整段回转过程中都不断）', worstDx <= 3, `${worstDx.toFixed(1)}px`);
check('吊绳顶到小车底（纵向偏差 ≤ 3px，中间不剩空隙）', worstDy <= 3, `${worstDy.toFixed(1)}px`);

/*
 * 用**像素**再核一遍回转这件事（几何量不出"画出来的臂在哪"）。
 * 把 CSS 动画用 Web Animations API 定到某一刻：0% 是最长、31%（=8.06s）是最短，
 * 各截一张图，扫一条横带里墨色（亮度 < 25；背景那圈紫约 36、货箱不在这一带）的左右边界：
 *   · 两帧的左边界差 = 臂尖横向收了多少（必须 ≥ 12px，而且纵向基本不动）
 *   · 每一帧的右边界都要压在视口右缘上 —— 臂的右端永远是被屏幕切掉的那一刀
 *     （2026-11-12 就是这里翻过车：变换挂在 <svg> 上时裁切框跟着缩放，
 *      压缩那一帧臂离了屏幕边缘 19px，几何断言全过、只有像素看得见）
 */
const SEEK = (ms) => `(() => {
  const g = document.querySelector('.homepin__slew');
  const anims = g.getAnimations().concat(document.querySelector('.homepin__load').getAnimations());
  for (const a of anims) { a.pause(); a.currentTime = ${ms}; }
  const r = document.querySelector('.homepin__jib').getBoundingClientRect();
  return { jibTop: r.top, jibH: r.height, jibLeft: r.left,
    /* 截图带滚动条那 15px，所以比的是**布局视口**（clientWidth），不是图片宽度 */
    layoutW: document.documentElement.clientWidth };
})()`;
const INK = 25;
async function inkEdges(ms) {
  const m = await cdp.ev(SEEK(ms));
  await sleep(160);
  const px = await cdp.shot();
  const y0 = Math.round(m.jibTop + m.jibH * 0.2);
  const y1 = Math.round(m.jibTop + m.jibH * 0.85);
  let left = -1;
  let right = -1;
  for (let y = y0; y <= y1; y++) {
    for (let x = 1100; x < px.w; x++) {
      const i = (y * px.w + x) * px.c;
      const lum = 0.2126 * px.data[i] + 0.7152 * px.data[i + 1] + 0.0722 * px.data[i + 2];
      if (lum < INK) {
        if (left < 0 || x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  return { left, right, vw: px.w, layoutW: m.layoutW };
}
const inked = await inkEdges(0);
const inkedMin = await inkEdges(8060);
info(`像素：伸出去 ${inked.left}→${inked.right}；缩回来 ${inkedMin.left}→${inkedMin.right}（布局视口 ${inked.layoutW}、截图 ${inked.vw}）`);
check('像素上也是横向伸缩：臂尖收进去 ≥ 12px', inkedMin.left - inked.left >= 12,
  `${inkedMin.left - inked.left}px`);
check('缩到最紧那一帧，臂的右端仍然压在视口右缘（右端始终被屏幕切掉）',
  inked.right >= inked.layoutW - 4 && inkedMin.right >= inked.layoutW - 4,
  `${inked.right} / ${inkedMin.right} vs 右缘 ${inked.layoutW - 1}`);
await cdp.ev('document.querySelectorAll(".homepin__slew, .homepin__load").forEach((e) => e.getAnimations().forEach((a) => a.play()))');

/* 减少动态效果：一律不动 */
await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await cdp.goto('/');
const rm1 = await cdp.ev(JIBRECT);
await sleep(1500);
const rm2 = await cdp.ev(JIBRECT);
check('系统开了「减少动态效果」→ 横臂完全静止',
  Math.abs(rm1.top - rm2.top) < 0.2 && Math.abs(rm1.left - rm2.left) < 0.2,
  `纵向 ${Math.abs(rm1.top - rm2.top).toFixed(2)}px / 横向 ${Math.abs(rm1.left - rm2.left).toFixed(2)}px`);
await cdp.send('Emulation.setEmulatedMedia', { features: [] });

/* ================================================================
 * D. 滚动收起 / 回来
 * ================================================================ */
console.log('\n================ D. 往下滚就缩进右侧 ================');
await cdp.goto('/');
/* 这一段比对的是"收走前后的差别"，回转动画会让货箱自己飘几像素，所以先冻住 */
await cdp.ev(FREEZE);
await sleep(200);
const before = await cdp.ev(GEOM);
check('刚进首页时是展开的（没有 is-away）', before.away === false && before.opacity === 1);
/* 往上滚一点点不应该收（阈值是 max(220, 45vh)） */
await cdp.ev('window.scrollTo(0, 80); 1');
await sleep(500);
check('只滚一点点（80px）不会收走',
  (await cdp.ev('document.querySelector("[data-home-pinned]").classList.contains("is-away")')) === false);
await cdp.ev('window.scrollTo(0, 900); 1');
await sleep(1500);
const gone = await cdp.ev(GEOM);
check('滚过封面 → 整组退到屏幕右缘之外（或透明）',
  gone.away === true && (gone.rig.left >= gone.vw - 1 || gone.opacity < 0.05),
  `left ${Math.round(gone.rig.left)} / vw ${gone.vw} / opacity ${gone.opacity}`);
/* 退出去以后不该再挡住页面上的东西 */
check('退出去以后不再挡住下面版块的点击（pointer-events 仍是 none）',
  (await cdp.ev('getComputedStyle(document.querySelector("[data-home-pinned]")).pointerEvents')) === 'none');
await cdp.ev('window.scrollTo(0, 0); 1');
await sleep(1500);
const back = await cdp.ev(GEOM);
check('滚回顶部 → 原样回来（还在原位、不透明）',
  back.away === false && back.opacity === 1
  && Math.abs(back.box.right - before.box.right) < 2 && Math.abs(back.box.top - before.box.top) < 2);

/* ================================================================
 * E. 点得到
 * ================================================================ */
console.log('\n================ E. 鼠标移上去 / 点货箱 ================');
/*
 * 悬停反馈：要和首页下方那些板块卡（.board / .lyt）同一手感 ——
 * 抬起来一点 + 边框提亮 + 粉光晕。这里在真浏览器里把鼠标移到货箱正中，
 * 比对 transform 和 box-shadow 有没有变。
 */
const HOVER = `(() => { const b = document.querySelector('.homepin__box'); const cs = getComputedStyle(b);
  return { transform: cs.transform, shadow: cs.boxShadow, border: cs.borderTopColor }; })()`;
const idle = await cdp.ev(HOVER);
const hoverPt = await cdp.ev(`(() => { const b = document.querySelector('.homepin__box').getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hoverPt.x, y: hoverPt.y, button: 'none' });
await sleep(400);
const hovered = await cdp.ev(HOVER);
info(`悬停前 transform=${idle.transform}`);
info(`悬停后 transform=${hovered.transform}`);
check('鼠标移上货箱 → 整块抬起（transform 变了，和首页其他卡片一样）',
  idle.transform !== hovered.transform && /matrix/.test(hovered.transform),
  `${idle.transform} → ${hovered.transform}`);
check('鼠标移上货箱 → 边框提亮 / 亮起粉光晕（不只是位移）',
  hovered.shadow !== idle.shadow && hovered.border !== idle.border);

const target = await cdp.ev(`(() => { const b = document.querySelector('.homepin__box').getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
const hitName = await cdp.ev(`(() => { const el = document.elementFromPoint(${target.x}, ${target.y});
  return el ? el.className.toString() : ''; })()`);
check('货箱正中点得到（不是被别的层盖住的死区）', /homepin/.test(hitName), hitName);
await cdp.click(target.x, target.y);
await sleep(1200);
const url = await cdp.ev('location.pathname + location.hash');
check('点下去真的进了那条公告', /^\/huaya\/bingshi\/photo\/20261001/.test(url), url);

/* ================================================================
 * F. 手机
 * ================================================================ */
console.log('\n================ F. 手机 390×844 ================');
await cdp.setViewport(390, 844, true);
await cdp.goto('/');
await cdp.ev(FREEZE);
await sleep(200);
const m = await cdp.ev(GEOM);
info(`横臂 ${Math.round(m.jib.left)}→${Math.round(m.jib.right)}、顶边 ${Math.round(m.jib.top)}；标题块下沿 ${Math.round(Math.max(m.title.bottom, m.tagline ? m.tagline.bottom : 0))}`);
check('横臂仍然从右缘伸进来', Math.abs(m.jib.right - m.vw) <= 1, `${m.jib.right.toFixed(1)} vs ${m.vw}`);
check('横臂在标题块下沿以下（不横穿「花涧堂」和那行副标题）',
  m.jib.top >= Math.max(m.title.bottom, m.tagline ? m.tagline.bottom : 0) - 1,
  `横臂顶 ${Math.round(m.jib.top)} vs 标题块下沿 ${Math.round(Math.max(m.title.bottom, m.tagline ? m.tagline.bottom : 0))}`);
check('货箱整只可见（右、下都不越界）',
  m.box.right <= m.vw + 0.5 && m.box.bottom <= m.vh, `右 ${Math.round(m.box.right)} / 下 ${Math.round(m.box.bottom)}`);
check('货箱和标题块不重叠', !overlap(m.box, m.title) && !overlap(m.jib, m.title)
  && !overlap(m.box, m.tagline) && !overlap(m.jib, m.tagline));
check('手机上货箱不窄于 130px（标题还得读得出来）', m.box.width >= 130, `${Math.round(m.box.width)}px`);
/* 极端窄屏也不撞标题 */
await cdp.setViewport(360, 640, true);
await cdp.goto('/');
await cdp.ev(FREEZE);
await sleep(200);
const tiny = await cdp.ev(GEOM);
check('360×640 这种小屏：横臂同样在标题块下面、货箱不越界',
  tiny.jib.top >= Math.max(tiny.title.bottom, tiny.tagline ? tiny.tagline.bottom : 0) - 1
  && tiny.box.right <= tiny.vw + 0.5 && !overlap(tiny.box, tiny.title));

/* ================================================================
 * G. 别的页面 + 报错
 * ================================================================ */
console.log('\n================ G. 别处没坏 / 无报错 ================');
await cdp.setViewport(1440, 900, false);
for (const p of ['/zongxian/', '/huaya/memory/mianyu', '/huaya/bingshi/photo/20261001']) {
  await cdp.goto(p, 500);
  const ok = await cdp.ev('!!document.querySelector("main, article, .page, body")');
  check(`${p} 打得开、没有把置顶吊车塞进别的页面`,
    ok && (await cdp.ev('!document.querySelector("[data-home-pinned]")')), '');
}
check('全程没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));

console.log(`\n================ 结果：PASS ${pass} / FAIL ${fail} ================`);
chrome.kill();
server.close();
process.exit(fail === 0 ? 0 : 1);
