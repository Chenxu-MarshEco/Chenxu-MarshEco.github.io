/*
 * 时间轴上「有链接的塔吊节点」悬停行为的验收 —— 真构建、真浏览器、真服务端。
 *
 * 用户 2026-11-17 的原话（照抄）：
 *   「时间轴上被赋予了跳转链接的塔吊节点有bug 鼠标移上去后字变成了难以看清的棕色
 *     且多了个打开 不要有这些变化 加了链接的只要鼠标移上去会变成可以点的手指样式
 *     并且塔吊图标微微放大即可 框内的字不要变 问题详见26年国庆冰室大聚会那个事件标」
 *
 * 所以这里盯的是四件事：
 *   ① 鼠标移上去以后，名字和塔吊**颜色一个都不许变**（变白、变淡黄都不行）；
 *   ② 卡片里不许冒出「打开 ›」；
 *   ③ 卡片里的字必须是原来的粉色 —— 不能退回浅色主题那套棕色（#8f4a10），
 *      压在深紫卡片上根本看不清；
 *   ④ 光标是"能点"的手，塔吊**微微放大**（不能不变，也不能放大到抢戏）。
 *
 * 为什么会出那个棕色：卡片里的 b/em/i/a 是脚本 paintTips() 用 createElement
 * 重建的，节点上没有 Astro 的 data-astro-cid 属性，样式没套 :global() 就一条都
 * 匹配不上，有链接的那一行还被包进 <a>，于是吃全局 `a { color: var(--c-link) }`
 * —— 浅色 token 是棕色。修法见 Timeline.astro 里那段「⚠⚠ 别去掉」的注释。
 *
 * 用法：node tools/checks/timeline-hover-check.mjs [dist目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromePath } from './lib/chrome.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
const PORT = 4488;
const DEBUG_PORT = 9488;
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

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error(`找不到 ${path.join(root, 'index.html')}，先构建`);
  process.exit(2);
}

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

const profile = path.join(process.env.TEMP ?? '.', `dsh-tlhover-${Date.now()}`);
const chrome = spawn(
  CHROME,
  ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
   '--disable-breakpad', '--window-size=1440,1000', `--user-data-dir=${profile}`,
   `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' }
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
  async goto(p, wait = 2600) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 150; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
  }
  async move(x, y) { await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await sleep(320); }
  async tap(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await sleep(60);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(60);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(500);
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

/* ------------------------------------------------------------------ *
 * 颜色对比度（用来判"这字还能不能看清"）
 * ------------------------------------------------------------------ */
const parse = (s) => {
  const m = String(s).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const n = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
  return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 };
};
const lum = ({ r, g, b }) => {
  const f = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (fg, bg) => {
  const a = lum(fg) + 0.05;
  const b = lum(bg) + 0.05;
  return a > b ? a / b : b / a;
};
const CARD_BG = parse('rgb(24, 3, 36)');

/* ------------------------------------------------------------------ *
 * 桌面端：/salon/ 左边那条固定的时间轴
 * ------------------------------------------------------------------ */
const FIND = (linked) => `(() => {
  const sel = '.tl__item' + (${linked} ? '[data-href]' : ':not([data-href])');
  const out = [];
  for (const it of document.querySelectorAll(sel)) {
    const name = it.querySelector('.tl__name');
    const crane = it.querySelector('.tl__crane');
    if (!name || !crane) continue;
    const b = name.getBoundingClientRect();
    const c = crane.getBoundingClientRect();
    // 被「时刻」开关藏掉的点、被 overflow 裁掉的点：盒子小或点不到，跳过
    if (b.width < 8 || b.height < 4 || c.width < 4) continue;
    const okName = b.left > 8 && b.top > 70 && b.right < innerWidth - 8 && b.bottom < innerHeight - 8;
    const okCrane = c.left > 4 && c.top > 60 && c.right < innerWidth - 4 && c.bottom < innerHeight - 4;
    if (!okName || !okCrane) continue;
    const nx = Math.round(b.left + b.width / 2), ny = Math.round(b.top + b.height / 2);
    const cx = Math.round(c.left + c.width / 2), cy = Math.round(c.top + c.height / 2);
    // 真拿鼠标点得到才算（时间轴上的字/塔吊会互相压住，也会被裁掉）
    const atName = document.elementFromPoint(nx, ny);
    const atCrane = document.elementFromPoint(cx, cy);
    const hitName = !!atName && atName.closest('.tl__item') === it;
    const hitCrane = !!atCrane && atCrane.closest('.tl__item') === it;
    if (!hitName || !hitCrane) continue;
    out.push({ point: it.dataset.point, label: it.dataset.label, kind: it.dataset.kind,
      name: { x: nx, y: ny }, crane: { x: cx, y: cy } });
  }
  return out;
})()`;

const SNAP = (point) => `(() => {
  const it = document.querySelector('.tl__item[data-point="' + ${JSON.stringify(point)} + '"]');
  if (!it) return null;
  const name = it.querySelector('.tl__name');
  const crane = it.querySelector('.tl__crane');
  const tip = it.querySelector('.tl__tip');
  const cs = (el) => getComputedStyle(el);
  const inn = tip.querySelector('i');
  const b = tip.querySelector('b');
  const em = tip.querySelector('em');
  return {
    nameColor: cs(name).color, nameDeco: cs(name).textDecorationLine, nameCursor: cs(name).cursor,
    craneColor: cs(crane).color, craneScale: cs(crane).scale, craneCursor: cs(crane).cursor,
    tipOpacity: cs(tip).opacity, tipVis: cs(tip).visibility, tipBg: cs(tip).backgroundColor,
    tipColor: cs(tip).color,
    bColor: b ? cs(b).color : null, emColor: em ? cs(em).color : null,
    hintVisible: !!inn && cs(inn).display !== 'none' && cs(inn).visibility !== 'hidden',
    hintText: inn ? inn.textContent.trim() : '', inner: tip.innerText || '',
  };
})()`;

await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await cdp.goto('/salon/');

let targets = await cdp.ev(FIND(true));
if (!targets.length) {
  // 时间轴是跟着"今天"滚的：窗口再高一点，能看见的日子就更多
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1600, deviceScaleFactor: 1, mobile: false });
  await sleep(700);
  targets = await cdp.ev(FIND(true));
}
check('找得到一个"在视口里、带链接"的时间点（26 年国庆冰室大聚会那种）', targets.length > 0,
  targets.length ? targets.map((t) => `${t.label}[${t.kind}]`).join(', ') : '视口里没有；见文件头的说明');

if (targets.length) {
  // 挑「事件」那档（用户报的就是这个）—— 没有就退而求其次
  const target = targets.find((t) => t.kind === 'event') ?? targets[0];
  const before = await cdp.ev(SNAP(target.point));

  // 先把鼠标放到空白处，确保不是"继承来的悬停"
  await cdp.move(4, 990);
  const rest = await cdp.ev(SNAP(target.point));

  check('没指上去时卡片是藏着的', rest.tipVis === 'hidden' || Number(rest.tipOpacity) === 0,
    `visibility=${rest.tipVis} opacity=${rest.tipOpacity}`);

  await cdp.move(target.name.x, target.name.y);
  const hover = await cdp.ev(SNAP(target.point));
  await sleep(120);
  const hover2 = await cdp.ev(SNAP(target.point)); // 过渡跑完再看一眼

  check('指上去：卡片照样浮出来（框要留着）', hover2.tipVis === 'visible' && Number(hover2.tipOpacity) > 0.9,
    `visibility=${hover2.tipVis} opacity=${hover2.tipOpacity}`);

  check('指上去：名字的颜色一个像素都没变', hover2.nameColor === rest.nameColor,
    `${rest.nameColor} → ${hover2.nameColor}`);

  check('指上去：名字没长下划线', !/underline/.test(hover2.nameDeco), hover2.nameDeco);

  check('指上去：塔吊的颜色也没变（不再染淡黄）', hover2.craneColor === rest.craneColor,
    `${rest.craneColor} → ${hover2.craneColor}`);

  const scale = Number.parseFloat(hover2.craneScale) || 0;
  check('指上去：塔吊微微放大（1.05~1.35）', scale >= 1.05 && scale <= 1.35, `scale=${hover2.craneScale}`);

  check('名字上是"能点"的手指光标', hover2.nameCursor === 'pointer', hover2.nameCursor);
  check('塔吊上也是"能点"的手指光标', hover2.craneCursor === 'pointer', hover2.craneCursor);

  check('卡片里不再冒出「打开 ›」', !hover2.hintVisible && hover2.inner.indexOf('打开') < 0,
    `hintVisible=${hover2.hintVisible} 卡片上看得见的字=${JSON.stringify(hover2.inner)}`);

  const nameFg = parse(hover2.bColor ?? hover2.tipColor);
  const dateFg = parse(hover2.emColor ?? hover2.tipColor);
  const bg = parse(hover2.tipBg) ?? CARD_BG;
  const ratioName = nameFg ? contrast(nameFg, bg) : 0;
  const ratioDate = dateFg ? contrast(dateFg, bg) : 0;
  check('卡片里的名字还看得清（对比度 ≥ 4.5，棕色只有 2.7）', ratioName >= 4.5,
    `${hover2.bColor} 对 ${hover2.tipBg} = ${ratioName.toFixed(2)}:1`);
  check('卡片里的日期还看得清（对比度 ≥ 3）', ratioDate >= 3,
    `${hover2.emColor} 对 ${hover2.tipBg} = ${ratioDate.toFixed(2)}:1`);
  check('卡片里的字没跑成浅色主题那套棕色', !/143,\s*74,\s*16/.test(`${hover2.bColor}|${hover2.emColor}|${hover2.tipColor}`),
    `${hover2.bColor} / ${hover2.emColor}`);

  /* 没链接的点：原有行为（变淡黄、不放大）一个字都不许动 */
  await cdp.move(4, 990);
  const plain = await cdp.ev(FIND(false));
  if (plain.length) {
    const p = plain[0];
    const pRest = await cdp.ev(SNAP(p.point));
    await cdp.move(p.name.x, p.name.y);
    await sleep(120);
    const pHover = await cdp.ev(SNAP(p.point));
    check('没链接的点照旧：悬停变淡黄、也不放大（原来的手感不被动）',
      pHover.craneColor !== pRest.craneColor && (Number.parseFloat(pHover.craneScale) || 1) === 1,
      `${pRest.craneColor} → ${pHover.craneColor} scale=${pHover.craneScale}`);
  } else {
    check('没链接的点照旧：悬停变淡黄、也不放大（原来的手感不被动）', false, '视口里没有可比对的无链接点');
  }
}

/* ------------------------------------------------------------------ *
 * 手机端：手指没有悬停，卡片里那句「打开 ›」得留着
 * ------------------------------------------------------------------ */
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp.goto('/salon/', 2200);

const mFind = await cdp.ev(`(() => {
  for (const it of document.querySelectorAll('.tl__item[data-href]')) {
    const c = it.querySelector('.tl__crane').getBoundingClientRect();
    if (c.width < 4 || c.height < 4) continue;
    if (c.left < 2 || c.top < 70 || c.right > innerWidth - 2 || c.bottom > innerHeight - 90) continue;
    const x = Math.round(c.left + c.width / 2), y = Math.round(c.top + c.height / 2);
    const at = document.elementFromPoint(x, y);
    if (!at || at.closest('.tl__item') !== it) continue;
    return { point: it.dataset.point, label: it.dataset.label, x, y };
  }
  return null;
})()`);

if (mFind) {
  await cdp.tap(mFind.x, mFind.y);
  const open = await cdp.ev(`(() => {
    const it = document.querySelector('.tl__item.is-open');
    if (!it) return { open: false };
    const tip = it.querySelector('.tl__tip');
    const i = tip.querySelector('i');
    return { open: true, vis: getComputedStyle(tip).visibility, hasI: !!i,
      hintVisible: !!i && getComputedStyle(i).display !== 'none', hint: i ? i.textContent.trim() : '' };
  })()`);
  check('手机端：点开卡片后「打开 ›」还在（手指得知道这行能点）',
    open.open === true && open.hasI === true && open.hintVisible === true,
    JSON.stringify(open));
} else {
  check('手机端：点开卡片后「打开 ›」还在（手指得知道这行能点）', false, '手机视口里没找到带链接的塔吊');
}

/* ---------- 收尾 ---------- */
const errs = cdp.errors.filter(Boolean);
check('整场没有脚本报错', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log(`\nPASS ${pass} / FAIL ${fail}`);
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);
