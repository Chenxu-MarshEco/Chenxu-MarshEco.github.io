/*
 * 这一轮还没验到的几处：
 *  A. 回归：**板块页**那条时间轴（非常驻模式）还能不能正常开关（我改了 Timeline.astro）
 *  B. 手机端：首页新增那一屏 + 冰室精华页的排版（不横向溢出、单列堆叠）
 *  C. 首页「每日精华」的"隔天自动换"那条路（客户端重挑 + 重写出来的 DOM 有没有样式）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const ROOT = path.resolve(process.argv[2]);
const PORT = 4390;
const DEBUG_PORT = 9353;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

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

const profile = path.join(process.env.TEMP ?? '.', `dsh-round-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

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
        m.error ? reject(new Error(m.error.message + ' ' + JSON.stringify(m.error.data ?? ''))) : resolve(m.result);
      }
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
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
  async viewport(w, h, touch) {
    await this.send('Emulation.setTouchEmulationEnabled', touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: !!touch });
  }
  async goto(p, wait = 1500) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 120; i++) {
      await sleep(120);
      if ((await this.ev('document.readyState')) === 'complete') break;
    }
    await sleep(wait);
  }
}

/* 和服务端同一套挑法（utils/daily.ts）：用来算"某一天应当挑到第几条" */
const dailyIndex = (dateStr, count) => {
  if (count <= 0) return -1;
  let h = 2166136261;
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % count;
};

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {}
  }
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });

  /* ================= A. 板块页时间轴（非常驻）回归 ================= */
  console.log('================ A. 板块页那条时间轴（非常驻）================');
  await cdp.viewport(1440, 900, false);
  await cdp.goto('/huaya/', 2000);
  const board = await cdp.ev(`(async () => {
    const tab = document.querySelector('.tl__tab');
    const panel = document.querySelector('.tl__panel');
    const close = document.querySelector('.tl__close');
    if (!tab || !panel) return { ok: false, why: 'no tab/panel' };
    const before = { hidden: panel.hidden, open: document.querySelector('.tl').classList.contains('is-open') };
    tab.click();
    await new Promise((r) => setTimeout(r, 900));
    const opened = { hidden: panel.hidden, open: document.querySelector('.tl').classList.contains('is-open'), hasClose: !!close };
    close && close.click();
    await new Promise((r) => setTimeout(r, 700));
    const closed = { hidden: panel.hidden, open: document.querySelector('.tl').classList.contains('is-open') };
    return { ok: true, before, opened, closed, pinned: document.querySelector('.tl').classList.contains('is-pinned') };
  })()`);
  check('板块页时间轴：书签点开 → 面板出来（可以关）', board.ok && board.before.hidden === true && board.opened.hidden === false && board.opened.open === true && board.opened.hasClose === true, JSON.stringify(board));
  check('板块页时间轴：关闭按钮能收回', board.ok && board.closed.hidden === true && board.closed.open === false, JSON.stringify(board.closed));
  check('板块页时间轴：没被我这轮的"常驻模式"改坏（不是 is-pinned）', board.pinned === false, JSON.stringify({ pinned: board.pinned }));
  check('板块页 JS 没报错', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));

  /* ================= B. 手机端排版 ================= */
  console.log('\n================ B. 手机端 390×844 ================');
  await cdp.viewport(390, 844, true);
  await cdp.goto('/', 2200);
  const mHome = await cdp.ev(`(() => {
    const q = (s) => document.querySelector(s);
    const r = (s) => { const el = q(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      cal: r('.cal'), ice: r('.ice'), daily: r('.daily'),
      cols: getComputedStyle(q('.extras__grid')).gridTemplateColumns,
      boards: r('.boards'), cards: document.querySelectorAll('.boards .board').length,
      card1: r('.boards .board:nth-child(1)'), card2: r('.boards .board:nth-child(2)'),
      calDays: document.querySelectorAll('.cal__day').length,
      dayW: q('.cal__day') ? Math.round(q('.cal__day').getBoundingClientRect().width) : null,
      pill: r('.about-pill'),
    };
  })()`);
  check('手机端首页：不横向溢出', mHome.overflow <= 1, JSON.stringify({ overflow: mHome.overflow }));
  check('手机端首页：新增三块竖着堆叠（单列）', !/\\s/.test(mHome.cols || '') && mHome.cal && mHome.ice && mHome.daily && mHome.cal.w > 300 && mHome.cal.x < 30, JSON.stringify({ cols: mHome.cols, cal: mHome.cal, ice: mHome.ice, daily: mHome.daily }));
  check('手机端首页：日历格子仍然排得开（7 列、圆还认得出来）', mHome.calDays >= 28 && mHome.dayW >= 24, JSON.stringify({ days: mHome.calDays, dayW: mHome.dayW }));
  check('手机端首页：原来两张板块卡没被挤坏（还是两张、竖着堆叠）', mHome.cards === 2 && mHome.card2 && mHome.card1 && mHome.card2.y > mHome.card1.y && mHome.boards.w > 300, JSON.stringify({ cards: mHome.cards, card1: mHome.card1, card2: mHome.card2 }));
  check(
    '手机端首页：关于我小圆片在页头里、贴着左边那一组（没被挤到右边）',
    mHome.pill && mHome.pill.x >= 0 && mHome.pill.x < 200 && mHome.pill.y >= 0 && mHome.pill.y < 60,
    JSON.stringify({ pill: mHome.pill, note: '窄屏上按设计只留圆圈（字藏起来）' })
  );
  check('手机端首页 JS 没报错', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));

  await cdp.goto('/salon/', 3500);
  const mSalon = await cdp.ev(`(() => {
    const q = (s) => document.querySelector(s);
    const side = q('.salon__side').getBoundingClientRect();
    const main = q('.salon__main').getBoundingClientRect();
    const panel = q('.tl__panel').getBoundingClientRect();
    const body = q('.tl__body').getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sideTop: Math.round(side.top), sideW: Math.round(side.width),
      mainTop: Math.round(main.top), mainW: Math.round(main.width),
      panelW: Math.round(panel.width), bodyH: Math.round(body.height),
      stacked: main.top > side.top + 100,
    };
  })()`);
  check('手机端精华页：不横向溢出', mSalon.overflow <= 1, JSON.stringify({ overflow: mSalon.overflow }));
  check('手机端精华页：时间轴挪到上面、占满宽度、没塌', mSalon.stacked && mSalon.panelW > 300 && mSalon.bodyH > 250, JSON.stringify(mSalon));
  check('手机端精华页 JS 没报错', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));

  /* ================= C. 「每日精华」隔天自动换（客户端重挑） ================= */
  console.log('\n================ C. 每日精华：隔天自动换 ================');
  await cdp.viewport(1440, 900, false);
  await cdp.goto('/', 2200);
  const ssr = await cdp.ev(`(() => ({ built: document.querySelector('[data-daily]').dataset.built, name: (document.querySelector('.daily__name')||{}).textContent||'', time: (document.querySelector('.daily__time')||{}).textContent||'' }))()`);

  // 让页面以为是另一天：在页面脚本跑之前把 Date 换掉
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const FIXED = new Date('2026-10-05T12:00:00');
      const Real = Date;
      class FakeDate extends Real {
        constructor(...a) { if (a.length === 0) super(FIXED.getTime()); else super(...a); }
        static now() { return FIXED.getTime(); }
      }
      window.Date = FakeDate;
    })();`,
  });
  await cdp.goto('/', 2600);
  const shifted = await cdp.ev(`(() => {
    const card = document.querySelector('[data-daily-card]');
    const name = card.querySelector('.daily__name');
    const time = card.querySelector('.daily__time');
    const av = card.querySelector('.daily__avatar');
    const cs = name ? getComputedStyle(name) : null;
    const avcs = av ? getComputedStyle(av) : null;
    return {
      built: document.querySelector('[data-daily]').dataset.built,
      name: name ? name.textContent : null,
      time: time ? time.textContent.trim() : null,
      text: ((card.querySelector('.daily__text') || {}).textContent || '').slice(0, 30),
      nameColor: cs ? cs.color : null,
      avRadius: avcs ? avcs.borderTopLeftRadius : null,
      avW: av ? Math.round(av.getBoundingClientRect().width) : null,
      hasPic: !!card.querySelector('.daily__pic'),
    };
  })()`);

  // 用同一套哈希算出"2026-10-05 应当挑到哪一条"
  const api = await (await fetch(`http://127.0.0.1:${PORT}/salon.json`)).json();
  const idx = dailyIndex('2026-10-05', api.essences.length);
  const expect = api.essences[idx];
  check('每日精华：页面以为今天是另一天时，卡片会重挑一条（成员+时间对上那一刻该挑的那条）', shifted.name === expect.member && shifted.time === `${expect.date}${expect.time ? ' ' + expect.time : ''}`, JSON.stringify({ got: { name: shifted.name, time: shifted.time }, expect: { name: expect.member, time: `${expect.date} ${expect.time}` }, built: shifted.built }));
  check('每日精华：重写出来的 DOM **有样式**（不是裸标签）', shifted.nameColor === 'rgb(255, 255, 255)' && shifted.avRadius === '50%' && shifted.avW === 26, JSON.stringify({ color: shifted.nameColor, radius: shifted.avRadius, w: shifted.avW }));
  check('每日精华：服务端先渲染的那条和重挑的那条确实不一样（说明这条路真跑了）', ssr.name !== shifted.name || ssr.time !== shifted.time, JSON.stringify({ ssr, shifted: { name: shifted.name, time: shifted.time } }));
  check('每日精华：重挑 JS 没报错', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));
} catch (err) {
  fail++;
  console.log('FAIL  脚本异常: ' + (err?.stack ?? err));
} finally {
  try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  server.close();
  await sleep(250);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
