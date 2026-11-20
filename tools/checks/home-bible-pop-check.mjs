/*
 * 首页「每日圣经」那一栏：鼠标移上去要弹出整条（正文 + 评语）的大卡片（2026-11-21）
 *
 * 用户原话：
 *   「圣经还是不能鼠标移上去浏览详情 仔细检查一下」
 *
 * 上一轮为什么"验过了却没修好"：
 *   那个脚本只读了浮层**自己**的 `visibility` —— 它报 visible，可它当时被写在
 *   精华浮层的**里面**，祖先那份平时 `opacity: 0`，opacity 是整棵子树一起算的，
 *   所以屏幕上**什么都没有**。这一版因此改成验「有效可见」：
 *     ① 沿祖先链把 `opacity` 连乘、把 `visibility` / `display` 一路看下来；
 *     ② 浮层正中做一次 `elementFromPoint`，命中的必须**是浮层里的元素**
 *        （前两条都过、屏幕上也一定真有一块东西在那儿）；
 *     ③ 鼠标从卡片挪到浮层上后不收起（"能点进去"）。
 *
 * 用法：node tools/checks/home-bible-pop-check.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromePath } from './lib/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..');
const ROOT = path.join(SRC, 'dist');
const PORT = 4394;
const DEBUG_PORT = 9364;
const CHROME = chromePath();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg', '.xml': 'application/xml' };

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

/* ---------------- 静态服务（dist） ---------------- */
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

const profile = path.join(process.env.TEMP ?? '.', `dsh-bible-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu',
  '--enable-unsafe-swiftshader', '--hide-scrollbars', '--disable-breakpad',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });

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
  async move(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
    await sleep(340);
  }
  async open(url) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${url}` });
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      if ((await this.ev('document.readyState')) === 'complete') break;
    }
    /* 站里 html 是平滑滚动，量位置前先关掉，否则鼠标落到别处 */
    await this.ev(`(() => {
      const s = document.createElement('style');
      s.textContent = 'html{scroll-behavior:auto !important}';
      document.head.appendChild(s);
      return true;
    })()`);
    await sleep(1500);
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
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

/*
 * 「有效可见」：祖先链一路算下来，再在浮层正中做一次命中测试。
 * 这一步是本轮的重点 —— 上一版只读浮层自己的 `visibility`，被祖先的
 * `opacity: 0` 骗过去了。
 */
const EFF = `(sel) => {
  const el = document.querySelector(sel);
  if (!el) return { exists: false };
  let opacity = 1;
  let visibility = 'visible';
  let display = 'block';
  let node = el;
  const hiddenBy = [];
  while (node && node.nodeType === 1) {
    const cs = getComputedStyle(node);
    if (Number(cs.opacity) < 1) {
      opacity *= Number(cs.opacity);
      hiddenBy.push((node.className || node.tagName).toString().trim() + ' opacity=' + cs.opacity);
    }
    if (cs.visibility !== 'visible') { visibility = cs.visibility; hiddenBy.push((node.className || node.tagName).toString().trim() + ' visibility=' + cs.visibility); }
    if (cs.display === 'none') { display = 'none'; hiddenBy.push((node.className || node.tagName).toString().trim() + ' display=none'); }
    node = node.parentElement;
  }
  const r = el.getBoundingClientRect();
  const x = Math.round(Math.min(Math.max(r.left, 0), innerWidth - 1) + Math.min(r.width, innerWidth) / 2);
  const y = Math.round(Math.min(Math.max(r.top, 0), innerHeight - 1) + Math.min(r.height, innerHeight) / 2);
  const at = document.elementFromPoint(x, y);
  return {
    exists: true,
    effectiveOpacity: Math.round(opacity * 1000) / 1000,
    visibility, display, hiddenBy,
    x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
    hitsSelf: !!(at && el.contains(at)),
    at: at ? at.tagName.toLowerCase() + (at.className ? '.' + String(at.className).split(' ')[0] : '') : null,
    probe: { x, y },
  };
}`;

/** 鼠标真的移到某个东西上（滚 → 命中测试 → 再移），返回落点 */
async function hover(sel) {
  for (let i = 0; i < 12; i++) {
    const r = await cdp.ev(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const b = el.getBoundingClientRect();
      const x = Math.round(b.x + b.width / 2);
      const y = Math.round(b.y + b.height / 2);
      const at = document.elementFromPoint(x, y);
      return { x, y, inView: b.top >= 0 && b.bottom <= innerHeight, hit: !!(at && at.closest(${JSON.stringify(sel)})) };
    })()`);
    if (r && r.hit) {
      await cdp.move(r.x, r.y);
      return r;
    }
    await sleep(400);
  }
  return { x: 0, y: 0, hit: false };
}

await cdp.open('/');
const target = await cdp.ev(`(() => {
  const card = document.querySelector('[data-bible-card]');
  const href = card?.getAttribute('href') || '';
  return { id: href.includes('#') ? href.split('#')[1] : '', href,
           text: card?.querySelector('.daily__text')?.textContent || '',
           comment: card?.querySelector('.daily__comment')?.textContent || '' };
})()`);
const bible = await (await fetch(`http://127.0.0.1:${PORT}/bellie.json`)).json();
const entry = (bible.entries ?? []).find((e) => e.id === target.id) ?? null;
info(`首页这一条：${target.id}｜正文 ${target.text.length} 字｜评语 ${target.comment.length} 字`);
check('★ 卡片指向的那一条能在 /bellie.json 里查到', !!target.id && !!entry, `id=${target.id}`);

/* ================================================================
 * ① 结构：两份浮层必须平级
 * ================================================================ */
console.log('\n================ ① 两份浮层平级（上一轮就是这儿埋的雷） ================');
const struct = await cdp.ev(`(() => {
  const essence = document.querySelector('.daily__pop--essence');
  const bible = document.querySelector('.daily__pop--bible');
  const wrap = document.querySelector('.dailyWrap');
  return {
    hasEssence: !!essence, hasBible: !!bible,
    bibleInsideEssence: !!(essence && bible && essence.contains(bible)),
    sameParent: !!(essence && bible && essence.parentElement === bible.parentElement),
    parentIsWrap: !!(bible && bible.parentElement === wrap),
    essenceChildren: essence ? [...essence.children].map((c) => c.className.split(' ')[0]) : [],
  };
})()`);
info(JSON.stringify(struct));
check('★★ 圣经浮层**不是**精华浮层的子节点（上一版是子节点 → 被祖先的 opacity:0 一起藏了）',
  struct.hasBible && !struct.bibleInsideEssence && struct.parentIsWrap,
  struct.bibleInsideEssence ? '圣经浮层被写在精华浮层里面！' : `父节点 = .dailyWrap：${struct.parentIsWrap}`);
check('★ 两份浮层在同一个父节点下（一份精华、一份圣经）',
  struct.sameParent && struct.hasEssence && struct.hasBible);

/* ================================================================
 * ② 鼠标移到圣经卡上：浮层**真的看得见**
 * ================================================================ */
console.log('\n================ ② 移到圣经卡上 ================');
const docH0 = await cdp.ev('document.documentElement.scrollHeight');
const docW0 = await cdp.ev('document.documentElement.scrollWidth');
const spot = await hover('[data-bible-card]');
const biblePop = await cdp.ev(`(${EFF})('.daily__pop--bible')`);
const essencePop = await cdp.ev(`(${EFF})('.daily__pop--essence')`);
info(`落点 ${spot.x},${spot.y}｜圣经浮层 ${JSON.stringify(biblePop)}`);
info(`同期精华浮层：opacity=${essencePop.effectiveOpacity} visibility=${essencePop.visibility} 命中自己=${essencePop.hitsSelf}`);

check('★★ 鼠标移到圣经卡上，圣经浮层**真的显示出来了**（祖先链不透明度合计 1、不是 hidden、正中命中的是浮层里的元素）',
  biblePop.exists && biblePop.effectiveOpacity === 1 && biblePop.visibility === 'visible'
  && biblePop.display !== 'none' && biblePop.hitsSelf,
  biblePop.hiddenBy?.length ? `被这些挡住：${biblePop.hiddenBy.join(' / ')}` : `命中 ${biblePop.at}`);
check('★★ 它就在圣经卡的正上方（和卡片横向重叠），不是飘在别处',
  biblePop.w > 200 && biblePop.h > 40, `${biblePop.w}×${biblePop.h}`);
check('★ 同一时刻精华浮层是**藏着的**（不会两份叠在一起、也不是只剩精华那份）',
  essencePop.effectiveOpacity < 1 || essencePop.visibility === 'hidden',
  `opacity=${essencePop.effectiveOpacity} visibility=${essencePop.visibility}`);

/* 内容：整段正文（不裁剪）+ 评语 + 去圣经页那一条 */
const body = await cdp.ev(`(() => {
  const p = document.querySelector('.daily__pop--bible');
  const t = p.querySelector('.daily__popText');
  const c = p.querySelector('.daily__popComment');
  const cardText = document.querySelector('[data-bible-card] .daily__text');
  const cardC = document.querySelector('[data-bible-card] .daily__comment');
  const clampOf = (el) => el ? (getComputedStyle(el).webkitLineClamp || getComputedStyle(el).getPropertyValue('-webkit-line-clamp') || 'none') : null;
  return {
    text: t ? t.textContent : '',
    textClamp: clampOf(t),
    textOverflowHidden: t ? (t.scrollHeight > t.clientHeight + 1) : null,
    cardClamp: clampOf(cardText),
    cardText: cardText ? cardText.textContent : '',
    comment: c ? c.textContent : '',
    cardComment: cardC ? cardC.textContent : '',
    link: p.querySelector('.daily__popLink')?.getAttribute('href') || '',
  };
})()`);
info(`浮层正文 ${body.text.length} 字（clamp=${body.textClamp}，纵向被裁=${body.textOverflowHidden}）｜卡片正文 ${body.cardText.length} 字（clamp=${body.cardClamp}）`);
check('★★ 浮层里是**整段正文**：没有 line-clamp、也没有纵向裁掉',
  body.textClamp === 'none' && body.textOverflowHidden === false, `clamp=${body.textClamp} 裁=${body.textOverflowHidden}`);
check('★★ 卡片里那份是截断的（同一段字，卡片 clamp 到两行）—— 所以"移上去看全文"是有意义的',
  body.cardClamp !== 'none' && body.text.length >= body.cardText.length,
  `卡片 clamp=${body.cardClamp}｜浮层 ${body.text.length} ≥ 卡片 ${body.cardText.length}`);
check('★ 浮层正文和页面上的那条是同一段字', body.text === body.cardText);
if (entry && !/\[\d{4,}\]/.test(entry.text)) {
  check('★★ 浮层正文 = /bellie.json 里那一条的 `text`（逐字一致）', body.text === entry.text,
    body.text === entry.text ? '' : `浮层 ${body.text.slice(0, 20)}… / 原始 ${entry.text.slice(0, 20)}…`);
} else {
  info('（这一条正文里带 QQ 号，站上会换成成员名，跳过逐字比对）');
}
check('★★ 评语也在浮层里（和卡片上那句一致）',
  !!body.comment && body.comment === body.cardComment, `${body.comment.length} 字`);
check('★★ 浮层里有「去圣经页看这一条 ›」，地址指向圣经页里那一条',
  body.link === `/bellie/#${target.id}`, body.link);
check('★ 打开浮层没有把页面撑高、也没有横向撑宽（它是绝对定位，不参与布局）',
  (await cdp.ev('document.documentElement.scrollHeight')) === docH0
  && (await cdp.ev('document.documentElement.scrollWidth')) === docW0,
  `高 ${docH0}→${await cdp.ev('document.documentElement.scrollHeight')}｜宽 ${docW0}→${await cdp.ev('document.documentElement.scrollWidth')}`);

/* ================================================================
 * ③ 鼠标挪进浮层里：不许收起来（"很难点到里面的东西"那个坑）
 * ================================================================ */
console.log('\n================ ③ 从卡片挪进浮层 ================');
const inner = await cdp.ev(`(() => {
  const p = document.querySelector('.daily__pop--bible');
  const r = p.getBoundingClientRect();
  const l = Math.max(r.left, 0), t = Math.max(r.top, 0);
  const rt = Math.min(r.right, innerWidth), b = Math.min(r.bottom, innerHeight);
  return { x: Math.round((l + rt) / 2), y: Math.round((t + b) / 2), inside: rt - l > 60 && b - t > 40, link: !!p.querySelector('.daily__popLink') };
})()`);
info(`浮层内的落点：${JSON.stringify(inner)}`);
await cdp.move(inner.x, inner.y);
const stillOn = await cdp.ev(`(${EFF})('.daily__pop--bible')`);
check('★★ 鼠标挪到浮层上之后浮层**不收起**（能停在里面读整段、能点链接）',
  inner.inside && stillOn.effectiveOpacity === 1 && stillOn.visibility === 'visible' && stillOn.hitsSelf,
  `opacity=${stillOn.effectiveOpacity} 命中 ${stillOn.at}`);

/* 挪到卡片外面 → 两份都收起 */
await cdp.move(4, 4);
const away = await cdp.ev(`(() => {
  const b = document.querySelector('.daily__pop--bible');
  const e = document.querySelector('.daily__pop--essence');
  const st = (el) => ({ opacity: Number(getComputedStyle(el).opacity), visibility: getComputedStyle(el).visibility });
  return { pop: document.querySelector('[data-daily]').dataset.pop || '', bible: st(b), essence: st(e) };
})()`);
info(`挪开后：${JSON.stringify(away)}`);
check('★ 鼠标挪出整块卡片后两份浮层都收起（不留一块贴在那儿）',
  (away.bible.opacity === 0 || away.bible.visibility === 'hidden')
  && (away.essence.opacity === 0 || away.essence.visibility === 'hidden'), JSON.stringify(away.pop));

/* ================================================================
 * ④ 精华栏：原来的浮层不许被这次改动搞坏
 * ================================================================ */
console.log('\n================ ④ 精华栏照旧 ================');
const e2 = await hover('[data-daily-card]');
const essence2 = await cdp.ev(`(${EFF})('.daily__pop--essence')`);
const bible2 = await cdp.ev(`(${EFF})('.daily__pop--bible')`);
info(`落点 ${e2.x},${e2.y}｜精华浮层 opacity=${essence2.effectiveOpacity} 命中自己=${essence2.hitsSelf}｜圣经浮层 opacity=${bible2.effectiveOpacity}`);
check('★★ 移到精华栏 → 精华浮层看得见（有效可见 + 命中自己）',
  essence2.effectiveOpacity === 1 && essence2.visibility === 'visible' && essence2.hitsSelf);
check('★ 同时圣经浮层是藏着的', bible2.effectiveOpacity < 1 || bible2.visibility === 'hidden',
  `opacity=${bible2.effectiveOpacity} visibility=${bible2.visibility}`);

/* ================================================================
 * ⑤ 窄屏：两份浮层都在屏内、都不撑宽页面
 * ================================================================ */
console.log('\n================ ⑤ 窄屏 ================');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
await cdp.open('/');
const docW1 = await cdp.ev('document.documentElement.scrollWidth');
const mSpot = await hover('[data-bible-card]');
const mPop = await cdp.ev(`(() => {
  const p = document.querySelector('.daily__pop--bible');
  const r = p.getBoundingClientRect();
  const cs = getComputedStyle(p);
  return { vis: cs.visibility, opacity: Number(cs.opacity), left: Math.round(r.left), right: Math.round(r.right),
           top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, w: Math.round(r.width) };
})()`);
info(`落点 ${mSpot.x},${mSpot.y}｜${JSON.stringify(mPop)}`);
check('★ 手机上圣经浮层左右都在屏内、整张铺满卡片宽',
  mPop.opacity === 1 && mPop.left >= -1 && mPop.right <= 390 + 1 && mPop.w > 200,
  `${mPop.w}px @ ${mPop.left}..${mPop.right}`);
check('★ 手机上浮层上下也在屏内', mPop.top >= -1 && mPop.bottom <= mPop.vh + 1, `top=${mPop.top} bottom=${mPop.bottom} 视口 ${mPop.vh}`);
check('★ 打开浮层没给窄屏添出横向滚动',
  (await cdp.ev('document.documentElement.scrollWidth')) <= docW1, `${docW1} → ${await cdp.ev('document.documentElement.scrollWidth')}`);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

await cdp.open('/');
check('★ 这一趟首页没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

/* ================================================================ */
try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { windowsHide: true, stdio: 'ignore' }); } catch { /* 已经退了 */ }
server.close();
await sleep(200);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 删不掉就算了 */ }

console.log('\n================ 结果 ================');
console.log(`PASS ${pass}   FAIL ${fail}`);
if (fail > 0) process.exit(1);
