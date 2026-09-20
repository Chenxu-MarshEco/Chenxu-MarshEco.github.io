/*
 * 补齐日历这一条的证据：
 *   ① 点特殊日子真的会跳到那天的事件页（之前只量了 href 属性，这里真点一下）
 *   ② 上/下月翻月对不对（翻到别的月就不该再有"今天"的光环）
 * 用副本 + 造一份带事件的数据，工作区不动。
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';

const SRC = String.raw`D:\曼沫砾总线\Chenxu-MarshEco.github.io`;
const DST = path.join(SRC, '.tmp', 'cal-proj');
const PORT = 4387;
const DEBUG_PORT = 9356;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};

/* ---------- 1. 造副本 + 带事件的数据 ---------- */
if (fs.existsSync(DST)) {
  for (const j of ['node_modules', 'public']) {
    const p = path.join(DST, j);
    if (fs.existsSync(p)) {
      try { execSync(`cmd /c rmdir "${p}"`, { stdio: 'ignore' }); } catch {}
    }
  }
  fs.rmSync(DST, { recursive: true, force: true });
}
const skip = new Set(['node_modules', 'public', 'dist', '.git', '.tmp']);
fs.mkdirSync(DST, { recursive: true });
for (const e of fs.readdirSync(SRC, { withFileTypes: true })) {
  if (skip.has(e.name)) continue;
  fs.cpSync(path.join(SRC, e.name), path.join(DST, e.name), { recursive: true });
}
execSync(`cmd /c mklink /J "${path.join(DST, 'node_modules')}" "${path.join(SRC, 'node_modules')}"`, { stdio: 'ignore' });
execSync(`cmd /c mklink /J "${path.join(DST, 'public')}" "${path.join(SRC, 'public')}"`, { stdio: 'ignore' });

const now = new Date();
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = ymd(now);
/*
  ⚠ 这里**故意用"生日那种"写法**：年份写 2004，只有月-日跟今天一样。
  用户的数据就是这么填的（2004-07-14 SSW的生日、2003-08-30 桑芙的生日…），
  而页面以前是拿"今年 + 月日"去查完整日期 —— 于是那些日子永远不变色
  （用户的原话：「特殊日期的图标没有发生变化」）。这条断言就是钉住这个 bug 的。
*/
const birthKey = `2004-${today.slice(5)}`;
const w = JSON.parse(fs.readFileSync(path.join(DST, 'src', 'data', 'home-widgets.json'), 'utf8'));
w.calendar.events = { [birthKey]: { title: '验收用的纪念日', href: '/salon/' } };
fs.writeFileSync(path.join(DST, 'src', 'data', 'home-widgets.json'), JSON.stringify(w, null, 2) + '\n', 'utf8');
execSync(`node "${path.join(SRC, 'node_modules', 'astro', 'bin', 'astro.mjs')}" build --root "${DST}"`, { stdio: 'ignore' });
console.log('副本 + 数据就绪：今天 =', today, '｜事件挂在', birthKey, '（年份不同、月日相同）');

/* ---------- 2. 起静态服务 + 真浏览器 ---------- */
const ROOT = path.join(DST, 'dist');
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

const profile = path.join(process.env.TEMP ?? '.', `dsh-cal-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' ')); }); }
  static async attach(u) { const ws = new WebSocket(u); await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('ws')), { once: true }); }); return new CDP(ws); }
  send(m, p = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method: m, params: p })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  async ev(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? '')); return r.result.value; }
  async goto(p, wait = 1800) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 120; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
  }
}

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) { await sleep(300); try { const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json(); target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl); } catch {} }
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.goto('/');

  const hasEvent = await cdp.ev(`(() => { const a = document.querySelector('a.cal__day--event'); if (!a) return null; a.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = a.getBoundingClientRect(); return { href: a.getAttribute('href'), title: a.getAttribute('title'), x: r.left + r.width / 2, y: r.top + r.height / 2, inView: r.top > 0 && r.bottom < innerHeight }; })()`);
  check('日历：今天那个特殊日子是可点的链接（并已滚进视口）', !!hasEvent && hasEvent.href === '/salon/' && hasEvent.inView === true, JSON.stringify(hasEvent));

  // 真点一下（用 CDP 发真鼠标事件：合成的 element.click() 在 Chromium 里不会触发跨文档跳转）
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hasEvent.x, y: hasEvent.y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hasEvent.x, y: hasEvent.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hasEvent.x, y: hasEvent.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(2500);
  check('日历：点它真的跳到了那天的事件页', (await cdp.ev('location.pathname')) === '/salon/', await cdp.ev('location.pathname'));

  // 翻月
  await cdp.goto('/');
  const nav = await cdp.ev(`(async () => {
    const lab = () => (document.querySelector('.cal__month') || {}).textContent;
    const days = () => document.querySelectorAll('.cal__day').length;
    const todayCount = () => document.querySelectorAll('.cal__day--today').length;
    const evCount = () => document.querySelectorAll('.cal__day--event').length;
    /* 三张卡的高度：翻月不能让这一排变高变矮（用户实测到的 bug） */
    const hs = () => {
      const r = (s) => Math.round(document.querySelector(s).getBoundingClientRect().height);
      return { cal: r('.cal'), ice: r('.ice'), daily: r('.daily') };
    };
    const snap = () => ({ label: lab(), days: days(), today: todayCount(), events: evCount(), h: hs() });
    const cur = snap();
    document.querySelector('[data-cal-prev]').click();
    await new Promise((r) => setTimeout(r, 300));
    const prev = snap();
    document.querySelector('[data-cal-next]').click();
    document.querySelector('[data-cal-next]').click();
    await new Promise((r) => setTimeout(r, 300));
    const next = snap();
    document.querySelector('[data-cal-prev]').click();
    await new Promise((r) => setTimeout(r, 300));
    const back = snap();
    return { cur, prev, next, back };
  })()`);
  const m = now.getMonth();
  const mName = (i) => `${now.getFullYear() + Math.floor(i / 12)} 年 ${(((i % 12) + 12) % 12) + 1} 月`;
  const dim = (i) => new Date(now.getFullYear(), (i % 12 + 12) % 12 + 1, 0).getDate();
  check('日历：点 ‹ 翻到上个月（月份标题 + 当月天数都对）', nav.prev.label === mName(m - 1) && nav.prev.days === dim(m - 1), JSON.stringify(nav.prev));
  check('日历：翻到别的月就不该再有"今天"的光环', nav.prev.today === 0 && nav.next.today === 0, JSON.stringify({ prevToday: nav.prev.today, nextToday: nav.next.today }));
  check('日历：点 › 翻到下个月、再点 ‹ 回到本月，今天的光环回来了', nav.next.label === mName(m + 1) && nav.next.days === dim(m + 1) && nav.back.label === mName(m) && nav.back.today === 1, JSON.stringify({ next: nav.next, back: nav.back }));
  check('日历：特殊日子只在当月那一格上（翻月不串）', nav.back.events === 1 && nav.next.events === 0 && nav.prev.events === 0, JSON.stringify({ cur: nav.cur.events, prev: nav.prev.events, next: nav.next.events, back: nav.back.events }));
  /*
    ⚠ 用户实测到的问题：翻到 8 月（跨 6 个星期）整排卡片一起变高、翻回 9 月又缩回去。
    现在日历**永远按 6 行占位**，所以任何一种月份下三张卡的高度都必须一模一样。
  */
  const hsList = [nav.cur.h, nav.prev.h, nav.next.h, nav.back.h];
  const sameH = (k) => new Set(hsList.map((x) => x[k])).size === 1;
  console.log('翻月时三张卡的高度：', JSON.stringify({ cur: nav.cur.label + ' ' + JSON.stringify(nav.cur.h), prev: nav.prev.label + ' ' + JSON.stringify(nav.prev.h), next: nav.next.label + ' ' + JSON.stringify(nav.next.h) }));
  check('日历：翻月（本月 / 上个月 / 下个月）卡片高度一个像素都不变',
    sameH('cal') && sameH('ice') && sameH('daily'),
    hsList.map((x) => JSON.stringify(x)).join(' '));
  check('日历：翻月时另外两张卡（冰室冰山 / 每日精华）也不会被带着变高变矮',
    new Set(hsList.map((x) => x.cal)).size === 1 && hsList.every((x) => x.cal === x.ice && x.ice === x.daily),
    JSON.stringify(hsList));

  /* ---------- ① 年份不同、月日相同也要亮（就是上面那个 bug 的回归断言） ---------- */
  await cdp.goto('/');
  const yearless = await cdp.ev(`(() => {
    const evDay = document.querySelector('.cal__day--event');
    const box = document.querySelector('[data-cal-today]');
    const norm = document.querySelector('.cal__day:not(.cal__day--event)');
    return { events: document.querySelectorAll('.cal__day--event').length,
      isToday: evDay ? evDay.classList.contains('cal__day--today') : null,
      todayText: box ? box.textContent.trim() : null,
      todayIsEvent: box ? box.classList.contains('cal__today--event') : null,
      label: evDay ? evDay.getAttribute('aria-label') : null,
      /* 不该再有浏览器那个白底 title（会盖住自绘的提示卡） */
      nativeTitle: evDay ? evDay.getAttribute('title') : undefined,
      tip: evDay ? ((evDay.querySelector('.cal__tip') || {}).textContent || null) : null,
      normLabel: norm ? norm.getAttribute('aria-label') : null,
      normCount: document.querySelectorAll('.cal__day').length - document.querySelectorAll('.cal__day--event').length,
      hasNorm: !!norm }; })()`);
  console.log('年份不同的事件：', JSON.stringify(yearless));
  check('日历：事件只写了"2004-月-日"（年份和今年不一样），今天那一格照样亮成特殊日子',
    yearless.events === 1 && yearless.isToday === true,
    `特殊日子 ${yearless.events} 格；今天那格是特殊日子=${yearless.isToday}`);
  check('日历：右下角小框也认这一天（写「今天是验收用的纪念日」）', /今天是验收用的纪念日/.test(yearless.todayText || '') && yearless.todayIsEvent === true,
    JSON.stringify(yearless.todayText));
  /*
    用户要求：别再像 debug 输出（以前是「2026-08-30 桑芙的生日（填的是 2003-08-30）」），
    改成「桑芙的生日 2003-08-30」。
  */
  check('日历：特殊日那句话是「{名字} {填的日期}」，不带"填的是"、也不再顶一串今年日期',
    yearless.label === '验收用的纪念日 2004-09-21' && !/填的是/.test(yearless.tip || ''),
    `aria-label=${yearless.label}｜提示卡=${yearless.tip}`);
  check('日历：普通日那句话就是这一天', /^\d{4}-\d{2}-\d{2}$/.test(yearless.normLabel || ''), yearless.normLabel);
  check('日历：不再挂浏览器原生的 title（那个白底提示就是它）', yearless.nativeTitle === null, JSON.stringify(yearless.nativeTitle));

  /* ---------- ①b 悬停弹的是自绘的提示卡（深紫底 + 粉边），不是白板 ---------- */
  const hovered = await cdp.ev(`(() => {
    const norm = document.querySelector('.cal__day:not(.cal__day--event)');
    norm.scrollIntoView({ block: 'center', behavior: 'instant' });
    return true; })()`);
  void hovered;
  const normBox = await cdp.ev(`(() => { const el = document.querySelector('.cal__day:not(.cal__day--event)');
    const b = el.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: normBox.x, y: normBox.y, button: 'none' });
  await sleep(400);
  const tip = await cdp.ev(`(() => {
    const el = document.querySelector('.cal__day:hover') || document.querySelector('.cal__day:not(.cal__day--event)');
    const t = el.querySelector('.cal__tip');
    if (!t) return { ok: false };
    const cs = getComputedStyle(t);
    const r = t.getBoundingClientRect();
    return { ok: true, text: t.textContent, opacity: cs.opacity, visibility: cs.visibility,
      bg: cs.backgroundColor, border: cs.borderTopColor, color: cs.color, radius: cs.borderRadius,
      fontSize: cs.fontSize, w: Math.round(r.width), h: Math.round(r.height),
      hovering: !!document.querySelector('.cal__day:hover') }; })()`);
  console.log('悬停提示卡：', JSON.stringify(tip));
  check('日历：鼠标指上去会弹出提示卡（自绘的），不再只有浏览器那个白板',
    tip.ok === true && tip.hovering === true && tip.opacity === '1' && tip.visibility === 'visible' && tip.w > 20,
    JSON.stringify({ text: tip.text, opacity: tip.opacity, w: tip.w, hovering: tip.hovering }));
  check('日历：那张提示卡是站点 UI 的皮（深紫底 + 粉边 + 粉字 + 7px 圆角），和时间轴那块一致',
    /rgba\(24, 3, 36/.test(tip.bg || '') && /rgba\(255, 120, 190/.test(tip.border || '') &&
      tip.color === 'rgb(255, 217, 239)' && tip.radius === '7px',
    `bg=${tip.bg} 边=${tip.border} 字=${tip.color} 圆角=${tip.radius}`);

  /* 特殊日子那张也要能弹（而且文案是「名字 + 填的日期」、边是暖橙） */
  const evBox2 = await cdp.ev(`(() => { const el = document.querySelector('.cal__day--event');
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const b = el.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: evBox2.x, y: evBox2.y, button: 'none' });
  await sleep(400);
  const evTip = await cdp.ev(`(() => {
    const el = document.querySelector('.cal__day--event:hover') || document.querySelector('.cal__day--event');
    const t = el.querySelector('.cal__tip');
    if (!t) return { ok: false };
    const cs = getComputedStyle(t);
    return { ok: true, text: t.textContent, opacity: cs.opacity, border: cs.borderTopColor, color: cs.color,
      hovering: !!document.querySelector('.cal__day--event:hover'), w: Math.round(t.getBoundingClientRect().width) }; })()`);
  console.log('特殊日的提示卡：', JSON.stringify(evTip));
  check('日历：特殊日子指上去也弹提示卡，文案是「{名字} {填的日期}」',
    evTip.ok === true && evTip.hovering === true && evTip.opacity === '1' && evTip.text === '验收用的纪念日 2004-09-21',
    JSON.stringify(evTip));
  check('日历：特殊日子那张卡的边是暖橙（和它的圆头一套），不是粉色',
    /rgba\(255, 180, 70/.test(evTip.border || '') && evTip.color === 'rgb(255, 233, 192)',
    `边=${evTip.border} 字=${evTip.color}`);

  /* ---------- ② 图标：普通日 = 建筑图钉，特殊日 = 区域图钉（两套要真的不一样） ---------- */
  const pin = await cdp.ev(`(() => {
    const norm = document.querySelector('.cal__day:not(.cal__day--event)');
    const spec = document.querySelector('.cal__day--event');
    const cs = (el, p, prop) => (el ? getComputedStyle(el, p).getPropertyValue(prop) : null);
    const sz = (el) => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; };
    const num = spec ? spec.querySelector('.cal__num') : null;
    const specBox = spec ? spec.getBoundingClientRect() : null;
    const numBox = num ? num.getBoundingClientRect() : null;
    return {
      norm: { bg: cs(norm, '::before', 'background-image'), radius: cs(norm, '::before', 'border-radius'),
        mask: cs(norm, '::before', '-webkit-mask-image') || cs(norm, '::before', 'mask-image'),
        shadow: norm ? getComputedStyle(norm).filter : null, size: sz(norm) },
      spec: { bg: cs(spec, '::before', 'background-image'), radius: cs(spec, '::before', 'border-radius'),
        shadow: spec ? getComputedStyle(spec).filter : null, size: sz(spec) },
      /* 用户要求"把向下的小尖头去掉"：::after 那个三角不该再有了 */
      normTipW: cs(norm, '::after', 'border-top-width'),
      specTipW: cs(spec, '::after', 'border-top-width'),
      numInsideHead: !!(numBox && specBox) && numBox.width <= specBox.width + 0.5 && numBox.height <= specBox.height + 0.5,
    }; })()`);
  console.log('两种图钉：', JSON.stringify(pin));
  check('普通日 = 建筑图钉那套（粉色渐变 + 方头 8px + 横向格栅 + 粉色投影）',
    /rgb\(255, 217, 239\)/.test(pin.norm.bg || '') && pin.norm.radius === '8px' && /repeating-linear-gradient/.test(pin.norm.mask || '') &&
      /255, 40, 130/.test(pin.norm.shadow || ''),
    JSON.stringify(pin.norm));
  check('特殊日 = 区域图钉那套（落日橙黄渐变 + 圆头 + 橙色投影）',
    /rgb\(255, 242, 184\)/.test(pin.spec.bg || '') && pin.spec.radius === '50%' && /255, 150, 40/.test(pin.spec.shadow || ''),
    JSON.stringify(pin.spec));
  check('两种图标确实**长得不一样**（背景 / 圆角 / 投影 三样都不同）',
    pin.norm.bg !== pin.spec.bg && pin.norm.radius !== pin.spec.radius && pin.norm.shadow !== pin.spec.shadow,
    `bg同=${pin.norm.bg === pin.spec.bg} radius同=${pin.norm.radius === pin.spec.radius}`);
  check('向下的小尖头已经去掉了（两种都只剩一个"头"，高度 = 宽度，::after 没有三角）',
    pin.norm.size.h === pin.norm.size.w && pin.spec.size.h === pin.spec.size.w &&
      (parseFloat(pin.normTipW) === 0 || pin.normTipW === '0px') && (parseFloat(pin.specTipW) === 0 || pin.specTipW === '0px') &&
      pin.numInsideHead === true,
    `普通 ${pin.norm.size.w}×${pin.norm.size.h}（尖 ${pin.normTipW}）/ 特殊 ${pin.spec.size.w}×${pin.spec.size.h}（尖 ${pin.specTipW}）`);

  /* 图钉比原来的圆高：确认排与排之间没有互相压住（尖头别扎进下一排的头） */
  const overlap = await cdp.ev(`(() => {
    const cells = [...document.querySelectorAll('.cal__grid > *')].map((el) => { const b = el.getBoundingClientRect(); return { t: +b.top.toFixed(1), b: +b.bottom.toFixed(1), l: +b.left.toFixed(1), r: +b.right.toFixed(1), cls: el.className }; })
      .filter((x) => x.r > x.l && x.b > x.t);
    let bad = 0, sample = null;
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i], c = cells[j];
        const hit = a.t < c.b - 0.5 && c.t < a.b - 0.5 && a.l < c.r - 0.5 && c.l < a.r - 0.5;
        if (hit) { bad++; if (!sample) sample = a.cls + ' 压住 ' + c.cls + ' ' + JSON.stringify([a, c]); }
      }
    }
    return { cells: cells.length, bad, sample }; })()`);
  check('日历：图钉之间没有互相压住（尖头没扎进下一排）', overlap.bad === 0, JSON.stringify(overlap));
  check('这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));
} catch (err) {
  fail++;
  console.log('FAIL  脚本异常: ' + (err?.stack ?? err));
} finally {
  try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  server.close();
  await sleep(250);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  // 收拾副本：先摘 junction 再删
  for (const j of ['node_modules', 'public']) {
    const p = path.join(DST, j);
    if (fs.existsSync(p)) {
      try { execSync(`cmd /c rmdir "${p}"`, { stdio: 'ignore' }); } catch {}
    }
  }
  try { fs.rmSync(DST, { recursive: true, force: true }); } catch {}
  console.log('副本已清理:', !fs.existsSync(DST));
}
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
