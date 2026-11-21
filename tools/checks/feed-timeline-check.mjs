/*
 * `/feed/`（推流动态）那条时间轴的验收 —— 真产物、真服务端、真浏览器。
 *
 * 站长 2026-11-21 的原话：
 *   「为推流动态的详情页面也加上精华 圣经一样的时间轴 可根据时间轴查动态 跳转
 *    时间轴跟着动态滚动 注意推流动态页用的是翻页模式 可能需要特殊适配」
 *   「为推流也右边也加上和精华 冰山一样的用户推流数统计」
 *   「推流动态页头像抓取依然不全 没有抓到 Shema_Sunf EtherARM Memori_Monita 等人的头像」
 *   「推流动态也用花娅年代记 不要用自己做的时间轴」
 *
 * 所以这里盯这些事：
 *   ① 左边挂着一条常驻时间轴 —— 而且就是**花娅年代记**（id 对得上、点也是它自己的）；
 *      右边一栏是推流者（头像 + 名字 + 条数）；
 *   ② **只有当前这一页**的条目带 `data-tl-param`（翻页藏起来那些不能留在名单里）；
 *   ③ 滚页面 → 轴顶那个日期 = 视口中线那一条的日期；
 *   ④ 翻页 → 标记跟着换一批，轴照样对得上；
 *   ⑤ 点轴上的塔吊 → 翻到**离那个位置最近**的那一条所在的页、滚过去；
 *   ⑥ 点亮一个推流者 → 只剩他的那些，翻页条收起；再点一下回到全部；
 *   ⑦ 头像：三个人（提交邮箱没绑 GitHub 的那几位）也有图和链接。
 *
 * 用法：node tools/checks/feed-timeline-check.mjs [dist目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromePath } from './lib/chrome.mjs';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
const PORT = 4710;
const DEBUG_PORT = 9510;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.gif': 'image/gif',
};
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`); };

if (!fs.existsSync(path.join(root, 'feed', 'index.html'))) {
  console.error(`找不到 ${path.join(root, 'feed', 'index.html')}，先构建`);
  process.exit(2);
}
const html = fs.readFileSync(path.join(root, 'feed', 'index.html'), 'utf8');
const meta = JSON.parse((/id="feed-meta"[^>]*>([\s\S]*?)<\/script>/.exec(html) || ['', '[]'])[1]);
console.log(`      · 推流动态 ${meta.length} 条｜${new Set(meta.map((r) => r[2])).size} 位推流者`);

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

const profile = path.join(process.env.TEMP ?? '.', `dsh-feedtl-${Date.now()}`);
const chrome = spawn(
  chromePath(),
  ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
   '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
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
  async goto(p, wait = 2200) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 160; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
  }
  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await sleep(60);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(200);
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
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

/** 页面现状：轴停在哪儿、谁离屏幕中线最近、这一页标了多少条 */
const STATE = `(() => {
  const tl = document.querySelector('.tl');
  const items = [...document.querySelectorAll('[data-pager-item]')];
  const vis = items.filter((el) => !el.hidden);
  const mid = innerHeight / 2;
  let best = null, bd = Infinity;
  for (const el of vis) {
    const r = el.getBoundingClientRect();
    const d = Math.abs(r.top + r.height / 2 - mid);
    if (d < bd) { bd = d; best = el; }
  }
  return {
    cur: tl ? Number(tl.dataset.tlCur) : null,
    now: (document.querySelector('[data-tl-nowdate]') || {}).textContent || '',
    pinned: tl ? tl.classList.contains('is-pinned') : false,
    marked: document.querySelectorAll('[data-tl-param]').length,
    markedVisible: vis.filter((el) => el.hasAttribute('data-tl-param')).length,
    total: items.length,
    visible: vis.length,
    page: (document.querySelector('[data-pager-cur]') || {}).textContent || '',
    pagerHidden: !!document.querySelector('[data-pager]')?.hidden,
    nearestDay: best ? (best.dataset.tlDate || '') : '',
    y: Math.round(scrollY),
    url: location.pathname + location.search + location.hash,
  };
})()`;

try {
  await cdp.goto('/feed/', 2800);

  /* ---------------- ① 骨架 ---------------- */
  const shell = await cdp.ev(`(() => {
    const tl = document.querySelector('.tl');
    const people = [...document.querySelectorAll('[data-who]')].map((b) => ({
      who: b.dataset.who,
      count: (b.querySelector('.feeds__count') || {}).textContent || '',
      face: !!b.querySelector('img.feeds__face'),
      img: (b.querySelector('img.feeds__face') || {}).getAttribute ? (b.querySelector('img.feeds__face') || {}).getAttribute('src') : '',
    }));
    return {
      hasTl: !!tl,
      pinned: tl ? tl.classList.contains('is-pinned') : false,
      side: !!document.querySelector('.feeds__side'),
      tlId: tl ? tl.dataset.tlId || '' : '',
      points: document.querySelectorAll('.tl__item').length,
      firstPointDate: (document.querySelector('.tl__item') || {}).dataset ? (document.querySelector('.tl__item').dataset.date || '') : '',
      people,
      pager: !!document.querySelector('[data-pager]'),
      items: document.querySelectorAll('[data-pager-item]').length,
    };
  })()`);
  check('★ /feed/ 左边挂着一条常驻时间轴（和精华 / 圣经同一个摆法）',
    shell.hasTl === true && shell.pinned === true && shell.side === true, JSON.stringify({ hasTl: shell.hasTl, pinned: shell.pinned }));

  /* 站长 2026-11-21：「推流动态也用花娅年代记 不要用自己做的时间轴」 */
  const tlFile = path.resolve('src/data/timelines.json');
  const tlRaw = fs.existsSync(tlFile) ? JSON.parse(fs.readFileSync(tlFile, 'utf8')) : { timelines: [] };
  const huaya = (tlRaw.timelines || []).find((t) => t.title === '花娅年代记') || {};
  const huayaPoints = (huaya.points || []).length;
  check('★ 挂的就是**花娅年代记**那条轴（id 对得上、点也是它自己的，不是现造的）',
    !!huaya.id && shell.tlId === huaya.id && shell.points === huayaPoints,
    JSON.stringify({ 页面: shell.tlId, 花娅年代记: huaya.id, 页面点: shell.points, 轴的点: huayaPoints }));
  check('★ 右边有推流者那一栏（头像 + 名字 + 条数），条数和数据对得上',
    shell.people.length === new Set(meta.map((r) => r[2])).size &&
      shell.people.every((p) => /^\d+ 条$/.test(p.count)) &&
      shell.people.reduce((a, p) => a + Number(p.count.replace(' 条', '')), 0) === meta.length,
    JSON.stringify(shell.people.map((p) => `${p.who} ${p.count}`)));
  check('翻页条在（占个位，筛人的时候会收起来）', shell.pager === true);

  /* 头像：三张以前抓不到的 */
  const wanted = ['Shema-Sunf', 'EtherARM', 'MemoriMonita'];
  const faces = shell.people.filter((p) => wanted.includes(p.who));
  check(`★ 提交邮箱没绑 GitHub 的那三位也拿到头像了（${wanted.join(' / ')}）`,
    faces.length === 3 && faces.every((p) => p.face === true && /avatars\.githubusercontent\.com/.test(p.img)),
    JSON.stringify(faces.map((p) => ({ who: p.who, img: p.img.slice(0, 48) }))));

  /* ---------------- ② 只有当前页带标记 ---------------- */
  const s0 = await cdp.ev(STATE);
  const perPage = Math.round(meta.length / Math.max(1, Math.ceil(meta.length / 37))) && shell.items > 37 ? 37 : shell.items;
  check('★ 只有**当前这一页**的条目带 data-tl-param（藏起来的那些不能留在名单里）',
    s0.marked === s0.visible && s0.markedVisible === s0.visible && s0.visible === Math.min(perPage, meta.length),
    JSON.stringify({ marked: s0.marked, visible: s0.visible, markedVisible: s0.markedVisible }));

  /* ---------------- ③ 滚页面：轴跟着走 ---------------- */
  const rows = [];
  for (const y of [900, 1800, 3000]) {
    await cdp.ev(`window.scrollTo(0, ${y})`);
    await sleep(650);
    rows.push(await cdp.ev(STATE));
  }
  check('★ 滚页面时轴上的日期跟着变（不是一直停在最新那天）',
    new Set(rows.map((r) => r.now)).size >= 2, JSON.stringify(rows.map((r) => r.now)));
  check('★ 每一屏轴上那个日期都等于视口中线那一条的日期',
    rows.every((r) => r.nearestDay && r.now === r.nearestDay),
    JSON.stringify(rows.map((r) => ({ 轴: r.now, 列表: r.nearestDay }))));

  /* ---------------- ④ 翻页：标记换一批 ---------------- */
  await cdp.ev(`(() => { const a = [...document.querySelectorAll('.pager__num')].find((n) => n.dataset.page === '5'); if (a) a.click(); return 1; })()`);
  await sleep(1600);
  const s5 = await cdp.ev(STATE);
  check('★ 翻到第 5 页：标记跟着换了一批（还是只有这一页那 37 条）',
    s5.page === '5' && s5.marked === s5.visible && s5.markedVisible === s5.visible && s5.visible === Math.min(perPage, meta.length),
    JSON.stringify({ page: s5.page, marked: s5.marked, visible: s5.visible }));
  check('★ 翻页之后轴也对得上（日期 = 列表那一条）',
    !!s5.nearestDay && s5.now === s5.nearestDay, JSON.stringify({ 轴: s5.now, 列表: s5.nearestDay }));

  /* ---------------- ⑤ 点轴上的塔吊：翻页 + 滚过去 ---------------- */
  /*
    ⚠ 别按坐标点 `.tl__item`：它是**零尺寸**的锚点（真正的塔吊画在 SVG 里，
    `getBoundingClientRect()` 给的是 0×0、位置也不对），按坐标点下去点到的是那段弧。
    这里直接 `el.click()`：验的是"页面收到这一下的 param 之后有没有翻页滚过去"。
  */
  const target = await cdp.ev(`(() => {
    const cur = Number(document.querySelector('.tl')?.dataset.tlCur || 0);
    const items = [...document.querySelectorAll('.tl__item')].filter((t) => Number.isFinite(Number(t.dataset.param)));
    /* 挑一个离轴现在的位置最远的（保证一定要翻页） */
    const far = items.slice().sort((a, b) => Math.abs(Number(b.dataset.param) - cur) - Math.abs(Number(a.dataset.param) - cur))[0];
    if (!far) return null;
    const param = Number(far.dataset.param);
    const date = far.dataset.date || '';
    far.click();
    return { param, date };
  })()`);
  check('轴上有可以点的塔吊 / 刻度（花娅年代记自己的那些点）', !!target && Number.isFinite(target.param), JSON.stringify(target));
  if (target) {
    /*
      花娅年代记上的点是**历史事件**的日期，推流只覆盖最近那两个月 ——
      所以"点轴"的语义和精华页一样：跳到**离那个位置最近的那一条推流**，
      不是"跳到那一天"（那一天可能根本没人推流）。期望值在这里按 meta 算好。
    */
    let wantIdx = 0;
    let wantD = Infinity;
    meta.forEach((r, i) => {
      const d = Math.abs(Number(r[1]) - target.param);
      if (d < wantD) { wantD = d; wantIdx = i; }
    });
    const wantDay = meta[wantIdx][0];
    const wantPage = String(Math.floor(wantIdx / 37) + 1);
    await sleep(1900);
    const after = await cdp.ev(STATE);
    check('★ 点轴上的点：翻到**离那儿最近**的那一条所在的页，滚过去，轴和列表也对得上',
      after.nearestDay === wantDay && after.now === after.nearestDay && after.page === wantPage,
      JSON.stringify({ 点的是: target.date, 期望: { 天: wantDay, 页: wantPage }, 实到: { 天: after.nearestDay, 页: after.page, 轴: after.now } }));
  }

  /* ---------------- ⑥ 点亮一个推流者 = 只看他的 ---------------- */
  const who = shell.people.find((p) => Number(p.count.replace(' 条', '')) > 1 && p.who !== 'Chenxu-MarshEco') || shell.people[0];
  const pos = await cdp.ev(`(() => {
    const b = [...document.querySelectorAll('[data-who]')].find((x) => x.dataset.who === ${JSON.stringify(who.who)});
    if (!b) return null;
    b.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (pos) {
    await cdp.click(pos.x, pos.y);
    await sleep(1000);
    const filtered = await cdp.ev(`(() => {
      const items = [...document.querySelectorAll('[data-pager-item]')];
      const vis = items.filter((el) => !el.hidden);
      const names = vis.map((el) => (el.querySelector('.feed__who') || {}).textContent || '');
      return {
        visible: vis.length,
        onlyHim: names.every((n) => n === ${JSON.stringify(who.who)}),
        pressed: document.querySelector('[data-who=' + JSON.stringify(${JSON.stringify(who.who)}) + ']')?.getAttribute('aria-pressed'),
        pagerHidden: !!document.querySelector('[data-pager]')?.hidden,
        marked: document.querySelectorAll('[data-tl-param]').length,
      };
    })()`);
    check(`★ 点亮「${who.who}」：只剩他的 ${who.count.replace(' 条', '')} 条，翻页条收起`,
      filtered.visible === Number(who.count.replace(' 条', '')) && filtered.onlyHim === true && filtered.pagerHidden === true,
      JSON.stringify(filtered));
    check('筛选时时间轴也还是只认看得见的那几条', filtered.marked === filtered.visible, JSON.stringify({ marked: filtered.marked, visible: filtered.visible }));

    /* 再点一下：回到全部（还是刚才那一页） */
    const pos2 = await cdp.ev(`(() => {
      const b = [...document.querySelectorAll('[data-who]')].find((x) => x.dataset.who === ${JSON.stringify(who.who)});
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (pos2) {
      await cdp.click(pos2.x, pos2.y);
      await sleep(900);
      const back = await cdp.ev(STATE);
      check('★ 再点一下熄灭：回到全部（一页 37 条、翻页条回来）',
        back.pagerHidden === false && back.visible === Math.min(perPage, meta.length) && back.marked === back.visible,
        JSON.stringify({ visible: back.visible, marked: back.marked, hidden: back.pagerHidden }));
    }
  } else {
    check('推流者那一栏点得到', false);
  }

  check('整场没有脚本报错', cdp.errors.filter(Boolean).length === 0, cdp.errors.filter(Boolean).slice(0, 2).join(' | '));
} catch (err) {
  fail += 1;
  console.log(`FAIL  ★ 脚本自己炸了：${err?.message || err}`);
} finally {
  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  try { chrome.kill(); } catch { /* 已退 */ }
  server.close();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}
process.exit(fail ? 1 : 0);
