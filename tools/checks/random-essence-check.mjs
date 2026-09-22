/*
 * 「随机精华」那两颗按钮的验收（首页「每日精华」卡片旁边）。
 *
 * 用户原话（2026-09-22）：
 *   「在首页每日精华旁边加一个按钮 样子是循环符号 右边写"随机精华" 点一下按钮以后
 *    会随机抽取一条精华显示 显示规则和每日精华一样 如果当前显示的是随机精华
 *    那么页面上会再多一个按钮 样子是左箭头 右边写回到每日精华 也就是随机出来的精华
 *    有两个按钮 一个是随机精华 可以继续随机 一个是回到每日精华 可以回到今天系统抽取的精华」
 *
 * 所以这里量的就是这几件事：
 *   ① 两个按钮都在、都不在卡片那个 <a> 里面、都有图标 + 那两句字
 *   ② 一进页面：「回到每日精华」藏着；点「随机精华」之后它才出现
 *   ③ 点一下真的换了内容，而且换出来的那一条**确实在 /salon.json 里**
 *      （名字 / 日期 / 正文都对得上 —— 复用"每日精华"那套显示规则）
 *   ④ 连点就是接着抽：每条都能在清单里找到，且相邻两条不重复
 *   ⑤ 点「回到每日精华」回到**点随机之前那一条**，按钮自己又藏回去
 *   ⑥ 键盘也能按（Tab 到按钮上回车）
 *   ⑦ 卡片在两种状态下都还是 `/salon/#<id>` 的链接，点一下真的落到那一条
 *   ⑧ 手机 390：两个按钮都在卡片里、点得到、不溢出
 *   ⑨ 全程没有 JS 报错
 *
 * 用法：node tools/checks/random-essence-check.mjs [dist目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
const PORT = 4408;
const DEBUG_PORT = 9378;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const skip = (n) => {
  pass++;
  console.log(`SKIP  ${n}`);
};

/* ---------- 首页 HTML + /salon.json ---------- */
const HOME = path.join(root, 'index.html');
const SALON = path.join(root, 'salon.json');
if (!fs.existsSync(HOME) || !fs.existsSync(SALON)) {
  console.error(`找不到 ${HOME} 或 ${SALON}，先构建`);
  process.exit(2);
}
const homeHtml = fs.readFileSync(HOME, 'utf8');
const salon = JSON.parse(fs.readFileSync(SALON, 'utf8'));
const essences = Array.isArray(salon.essences) ? salon.essences : [];
const byId = new Map(essences.map((e) => [String(e.id), e]));
console.log(`首页：${HOME}\n精华清单：${essences.length} 条（${salon.members} 位成员）`);

if (!essences.length) {
  console.error('salon.json 里没有精华，这个检查没东西可量');
  process.exit(2);
}

/* ---------- ① 静态 HTML：按钮在、图标在、字对、不在链接里 ---------- */
const actsBlock = /<div class="daily__acts"[^>]*>([\s\S]*?)<\/div>\s*<a/.exec(homeHtml)?.[1] ?? '';
const btnRandomHtml = /<button[^>]*data-daily-random[\s\S]*?<\/button>/.exec(actsBlock)?.[0] ?? '';
const btnBackHtml = /<button[^>]*data-daily-back[\s\S]*?<\/button>/.exec(actsBlock)?.[0] ?? '';
const pathsOf = (html) => [...html.matchAll(/<path[^>]*d="([^"]+)"/g)].map((m) => m[1]);
const randomPaths = pathsOf(btnRandomHtml);
const backPaths = pathsOf(btnBackHtml);
const cardHtml = /<a[^>]*data-daily-card[\s\S]*?<\/a>/.exec(homeHtml)?.[0] ?? '';

check('① 两颗按钮都在「每日精华」那块里，而且**不在**卡片那个 <a> 里面（卡片整张是链接）',
  !!btnRandomHtml && !!btnBackHtml && !!actsBlock && !!cardHtml &&
    !/data-daily-random/.test(cardHtml) && !/data-daily-back/.test(cardHtml),
  `随机按钮 ${btnRandomHtml.length} 字节 / 回到按钮 ${btnBackHtml.length} 字节`);
check('① 「随机精华」= 循环符号 + 这四个字（图标是带弧线的 SVG，字正好是「随机精华」）',
  /<svg/.test(btnRandomHtml) && /随机精华/.test(btnRandomHtml) &&
    randomPaths.length >= 1 && randomPaths.some((d) => /[aA]\s*[\d.]/.test(d)),
  `路径 ${JSON.stringify(randomPaths)}`);
check('① 「回到每日精华」= 左箭头 + 这六个字（图标是纯直线的箭头，不是弧线）',
  /<svg/.test(btnBackHtml) && /回到每日精华/.test(btnBackHtml) &&
    backPaths.length >= 1 && backPaths.every((d) => /^[MmLlHhVvZz\d\s.,-]+$/.test(d)),
  `路径 ${JSON.stringify(backPaths)}`);
check('① 没跑 JS 时整排按钮是藏着的、「回到每日精华」也是藏着的（不给点了没反应的按钮）',
  /class="daily__acts"[^>]*hidden/.test(homeHtml) && /data-daily-back[^>]*hidden/.test(homeHtml),
  '');

/* ---------- 起静态服务 + 真浏览器 ---------- */
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

const profile = path.join(process.env.TEMP ?? '.', `dsh-rand-${Date.now()}`);
const chrome = spawn(
  CHROME,
  ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
   '--disable-breakpad', '--window-size=1440,900', `--user-data-dir=${profile}`,
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
      ws.addEventListener('error', () => rej(new Error('ws 连不上')), { once: true });
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
  async goto(p, wait = 1800) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 150; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
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
/* 键盘那一条要真按得动：headless 里页面默认不算"有焦点"，得显式打开焦点模拟 */
await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });

/* 页面里读一次状态：按钮可不可见、卡片现在显示谁 */
const PROBE = `(() => {
  const root = document.querySelector('[data-daily]');
  const card = document.querySelector('[data-daily-card]');
  const acts = document.querySelector('[data-daily-acts]');
  const rnd = document.querySelector('[data-daily-random]');
  const back = document.querySelector('[data-daily-back]');
  const vis = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
  const href = card ? card.getAttribute('href') : '';
  const name = (card?.querySelector('.daily__name') || {}).textContent || '';
  const time = (card?.querySelector('.daily__time') || {}).textContent || '';
  const text = (card?.querySelector('.daily__text') || {}).textContent || '';
  const faces = card ? card.querySelectorAll('.daily__face').length : 0;
  const avatars = card ? card.querySelectorAll('img.daily__avatar').length : 0;
  const pic = !!(card && card.querySelector('.daily__pic'));
  return {
    mode: root ? root.dataset.mode : '', built: root ? root.dataset.built : '',
    actsVisible: vis(acts), randomVisible: vis(rnd), backVisible: vis(back),
    backHidden: back ? back.hidden : null,
    randomText: rnd ? rnd.textContent.trim() : '', backText: back ? back.textContent.trim() : '',
    randomName: rnd ? (rnd.getAttribute('aria-label') || '') : '', backName: back ? (back.getAttribute('aria-label') || '') : '',
    tag: card ? card.tagName : '', id: (href.split('#')[1] || ''), href, name, time, text, faces, avatars, pic,
    cardLabel: card ? (card.getAttribute('aria-label') || '') : '',
    cardInView: card ? (() => { const r = card.getBoundingClientRect(); return r.width > 60 && r.height > 40; })() : false,
  };
})()`;

/* ---------------- 桌面端 ---------------- */
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp.goto('/', 2200);
const first = await cdp.ev(PROBE);
console.log('\n================ 一进页面 ================');
console.log(JSON.stringify(first));
check('② 按钮排出来了（脚本拿到 /salon.json 之后才放出来）',
  first.actsVisible === true && first.randomVisible === true, JSON.stringify({ acts: first.actsVisible, rnd: first.randomVisible }));
check('② 「随机精华」有可访问名、字也对；一开始「回到每日精华」是藏着的、mode=daily',
  first.randomText === '随机精华' && first.randomName.length > 0 && first.backHidden === true && first.mode === 'daily',
  JSON.stringify({ 字: first.randomText, 名: first.randomName, backHidden: first.backHidden, mode: first.mode }));
check('② 卡片这一条是清单里真有的（名字/日期/正文都能在 /salon.json 里对上）',
  !!byId.get(first.id) && byId.get(first.id).member === first.name && String(byId.get(first.id).date) === first.time.slice(0, 10),
  `${first.id} ${first.name} ${first.time}`);
const dailyHref = first.href;
const dailyId = first.id;

/* ---------------- 点「随机精华」 ---------------- */
const clickBtn = (sel, times = 1) => cdp.ev(`(async () => {
  const b = document.querySelector(${JSON.stringify(sel)});
  b.focus();
  for (let i = 0; i < ${times}; i++) {
    b.click();
    await new Promise((r) => setTimeout(r, 260));
  }
  return true;
})()`);
await clickBtn('[data-daily-random]');
const afterRandom = await cdp.ev(PROBE);
console.log('\n================ 点一下「随机精华」 ================');
console.log(JSON.stringify(afterRandom));
const pickA = byId.get(afterRandom.id) ?? null;
check('③ 点一下真的换了一条（id 变了），而且换出来的这条在 /salon.json 里',
  afterRandom.id && afterRandom.id !== dailyId && !!pickA, `${dailyId} → ${afterRandom.id}`);
check('③ 显示规则和「每日精华」一样：名字 / 日期时间 / 正文（有的话）/ 头像（有的话）都按这一条来',
  !!pickA && afterRandom.name === pickA.member && afterRandom.time.startsWith(String(pickA.date)) &&
    (pickA.text ? afterRandom.text.startsWith(String(pickA.text).slice(0, 12)) : afterRandom.text === '') &&
    afterRandom.faces === Math.max(1, (pickA.members ?? []).length),
  JSON.stringify({ 名字: afterRandom.name, 日期: afterRandom.time, 头像位: afterRandom.faces, 清单里成员位: (pickA?.members ?? []).length }));
check('③ 卡片还是 `/salon/#<这一条 id>` 的链接，aria-label 也跟着换了',
  afterRandom.tag === 'A' && afterRandom.href.endsWith(`/salon/#${afterRandom.id}`) &&
    afterRandom.cardLabel.includes(afterRandom.name),
  `${afterRandom.href}｜label=${afterRandom.cardLabel}`);
check('②★ 现在多出来那颗「← 回到每日精华」出现了（字与可访问名都对）',
  afterRandom.id !== dailyId && afterRandom.backVisible === true && afterRandom.backHidden === false &&
    afterRandom.backText === '回到每日精华' && afterRandom.backName.length > 0 && afterRandom.mode === 'random',
  JSON.stringify({ 可见: afterRandom.backVisible, 字: afterRandom.backText, mode: afterRandom.mode }));

/* ---------------- 连点就是接着抽 ---------------- */
const ids = [afterRandom.id];
for (let i = 0; i < 7; i++) {
  await clickBtn('[data-daily-random]');
  const s = await cdp.ev(PROBE);
  ids.push(s.id);
}
const allKnown = ids.every((id) => byId.has(id));
const noRepeatNeighbour = ids.every((id, i) => i === 0 || id !== ids[i - 1]);
const distinct = new Set(ids).size;
console.log('\n================ 连点 8 次 ================');
console.log(JSON.stringify({ ids, distinct }));
check('④ 连点就是接着抽：8 次抽出来的每条都在清单里、相邻两次不重复',
  allKnown && noRepeatNeighbour, `8 条：${ids.join(' ')}`);
check(`④ 确实是在"随机"（8 次里出现 ${distinct} 条不同的；784 条里连着抽 8 次不该老是一条）`,
  distinct >= 5, `不同条数 ${distinct} / 8`);

/* ---------------- 回到每日精华 ---------------- */
await clickBtn('[data-daily-back]');
const backState = await cdp.ev(PROBE);
console.log('\n================ 点「回到每日精华」 ================');
console.log(JSON.stringify({ id: backState.id, href: backState.href, mode: backState.mode, backHidden: backState.backHidden }));
check('⑤★ 点「回到每日精华」→ 回到点随机之前那一条（同一个 id、同一个 href）',
  backState.id === dailyId && backState.href === dailyHref, `${backState.id} vs ${dailyId}`);
check('⑤ 回到每日精华之后，那颗「回到每日精华」自己又藏回去了、mode 回到 daily',
  backState.backHidden === true && backState.mode === 'daily' && backState.backVisible === false,
  JSON.stringify({ backHidden: backState.backHidden, mode: backState.mode }));

/*
  ★ 规则（用户 2026-09-22 补的）：
    「如果当前显示的已经是每日精华了 就不要显示回到每日精华按钮
     只有在显示随机精华的时候需要这个按钮」
  也就是看**现在显示的是不是今天那条**，而不是"点没点过随机"。
  这条要**确定性地**验：先随机一次（离开每日精华），再把 Math.random 钉死在
  "今天那条"的下标上，点随机 → 抽到的就是今天那条 → 按钮必须藏着。
*/
const dailyIdx = essences.findIndex((e) => String(e.id) === dailyId);
await clickBtn('[data-daily-random]');
const beforeForce = await cdp.ev(PROBE);
await cdp.ev(`(() => { window.__r = Math.random; Math.random = () => ${(dailyIdx + 0.5)} / ${essences.length}; return true; })()`);
await clickBtn('[data-daily-random]');
const forced = await cdp.ev(PROBE);
await cdp.ev(`(() => { Math.random = window.__r; return true; })()`);
console.log('\n================ 随机正好抽到"今天那条" ================');
console.log(JSON.stringify({ 抽之前: beforeForce.id, 抽到: forced.id, 今天那条: dailyId, backHidden: forced.backHidden, mode: forced.mode }));
check('★ 随机正好抽到「就是每日精华那条」时：那颗「回到每日精华」**不出现**（显示的已经是每日精华了）',
  dailyIdx >= 0 && forced.id === dailyId && forced.backHidden === true && forced.backVisible === false && forced.mode === 'daily',
  `钉住下标 ${dailyIdx} → 抽到 ${forced.id}（今天那条 ${dailyId}）｜backHidden=${forced.backHidden} mode=${forced.mode}`);
check('★ 反过来：抽到的是**别的**条目时，那颗按钮就出现（对照组）',
  beforeForce.id !== dailyId && beforeForce.backHidden === false && beforeForce.mode === 'random',
  `抽到 ${beforeForce.id}｜backHidden=${beforeForce.backHidden} mode=${beforeForce.mode}`);

/* 回到每日精华，方便后面几条从"每日精华"这个状态开始 */
await clickBtn('[data-daily-back]');

/* ---------------- 键盘：聚焦到按钮上回车 ---------------- */
await cdp.ev(`(() => {
  const b = document.querySelector('[data-daily-random]');
  b.scrollIntoView({ block: 'center', behavior: 'instant' });
  b.focus();
  return document.activeElement === b;
})()`);
await sleep(200);
await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await cdp.send('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await sleep(600);
const kb = await cdp.ev(PROBE);
check('⑥ 键盘也能抽（聚焦到「随机精华」上按回车 → 内容换了）',
  kb.id && kb.id !== dailyId && byId.has(kb.id), `回车后 ${kb.id}`);

/* ---------------- 卡片还是能点进去（两种状态下都是） ---------------- */
const beforeJump = await cdp.ev(PROBE);
await cdp.ev('window.scrollTo({ top: 0, behavior: "instant" })');
const cardBox = await cdp.ev(`(() => {
  const a = document.querySelector('[data-daily-card]');
  a.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = a.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), id: (a.getAttribute('href') || '').split('#')[1] || '' };
})()`);
await sleep(250);
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cardBox.x, y: cardBox.y, buttons: 0 });
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cardBox.x, y: cardBox.y, button: 'left', clickCount: 1, buttons: 1 });
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cardBox.x, y: cardBox.y, button: 'left', clickCount: 1, buttons: 0 });
await sleep(2200);
const landed = await cdp.ev(`(() => ({ path: location.pathname, hash: location.hash }))()`);
check(`⑦ 卡片还是能点进去：抽出来的这条点一下 → 落到 /salon/#${cardBox.id}`,
  landed.path === '/salon/' && landed.hash === `#${cardBox.id}`,
  `在 ${beforeJump.mode} 状态下点 ${cardBox.id} → ${landed.path}${landed.hash}`);

/* ---------------- 手机 390 ---------------- */
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp.goto('/', 2200);
await clickBtn('[data-daily-random]');
const mob = await cdp.ev(`(() => {
  const rnd = document.querySelector('[data-daily-random]');
  const back = document.querySelector('[data-daily-back]');
  const sec = document.querySelector('[data-daily]');
  /* 先滚到这一块 —— 不然按钮在视口外，elementFromPoint 量不到 */
  sec.scrollIntoView({ block: 'center', behavior: 'instant' });
  const R = (el) => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
  const sr = R(sec);
  const pick = (el) => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)); return !!(hit && hit.closest && hit.closest('[data-daily-random],[data-daily-back]')); };
  return {
    sec: sr, rnd: R(rnd), back: R(back),
    rndInside: R(rnd).l >= sr.l - 1 && R(rnd).r <= sr.r + 1 && R(rnd).b <= sr.b + 1,
    backInside: !back.hidden && R(back).l >= sr.l - 1 && R(back).r <= sr.r + 1 && R(back).b <= sr.b + 1,
    rndClickable: pick(rnd), backClickable: pick(back),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
})()`);
console.log('\n================ 手机 390 ================');
console.log(JSON.stringify(mob));
check('⑧ 手机端两颗按钮都在卡片里、都在视口内那块区域里、点得到',
  mob.rndInside && mob.backInside && mob.rndClickable && mob.backClickable,
  `卡片 ${mob.sec.w}×${mob.sec.h}；随机 ${mob.rnd.w}×${mob.rnd.h}｜回到 ${mob.back.w}×${mob.back.h}`);
check('⑧ 手机端没有横向溢出', mob.overflow <= 1, `scrollWidth - clientWidth = ${mob.overflow}`);
check('⑨ 全程没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

try { await cdp.send('Browser.close'); } catch { /* ignore */ }
chrome.kill();
server.close();
console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
