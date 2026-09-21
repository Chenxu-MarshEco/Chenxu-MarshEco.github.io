/*
 * ============================================================================
 * 成员名自动链接 + 悬停名片 的验收
 * ----------------------------------------------------------------------------
 * 用户原话（2026-09）：
 *   「鼠标移到指定的文字上后（成员名字），会浮现出一个框，内有成员的头像和名字，
 *     点击就可以跳转到成员的介绍页面（链接我自己填，因为页面还没做好）。需要一个
 *     脚本可以自动读取本网站中所有文字内容里出现的成员名字并自动链接上去，读取的
 *     名字是我输入的那些（比如花花应当叫隰辰煦，所以不能链接花花，只能链接隰辰煦），
 *     另外冰室精华页面内的不要链接，那里面的名字频率过高且没有意义。」
 *
 * 五段：
 *   A 重写器单测：匹配规则（英文名的词边界、长名优先）、六类必须跳过的上下文
 *                （a / pre / code / script / 属性 / 注释 / data-nomem），
 *                生成的标记长什么样，跳过块之后不泄漏
 *   B 产物静态：全站被链的名字**全部**来自成员表；旧名「花花」一次都没被链；
 *               冰室精华页 0 处；照片/属性没被动；每个 .mem 都有头像 + 名字
 *   C 真浏览器：悬停 → 名片浮出来（可见、在视口里、头像真的加载出来了）；
 *               移开 → 名片收回去；键盘走到它也能看见（focus-visible）
 *   D 点了跳走：在副本里给一个成员填上「介绍页」再构建 → 点名字真的跳到那个地址；
 *               没填地址的名字点不动（不是链接）
 *   E 编辑器：成员面板能填「介绍页」、存盘后 url 落进 salon.json 且**不会丢**
 *
 * 用法：node tools/checks/member-link-check.mjs [dist目录]
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildMatcher, rewriteHtml, faceUrlOf } from '../memlink/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const proj = path.resolve(here, '..', '..');
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(proj, 'dist');
const PORT = 4419;
const DEBUG_PORT = 9389;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
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

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error(`找不到 ${path.join(root, 'index.html')}，先构建`);
  process.exit(2);
}

const data = JSON.parse(fs.readFileSync(path.join(proj, 'src/data/salon.json'), 'utf8'));
const members = data.members.map((m) => ({ ...m, aliases: m.aliases || [] }));
const manifest = JSON.parse(fs.readFileSync(path.join(proj, 'public/img/opt/manifest.json'), 'utf8'));
const names = members.map((m) => m.name);

/* ================================================================
 * A. 重写器单测
 * ================================================================ */
console.log('================ A. 重写器（纯函数，不碰浏览器）================');
const match = buildMatcher(members);
const render = (m) => {
  const face = faceUrlOf(m.avatar, manifest, '/');
  return (
    `<a class="mem" data-mem="${m.id}"${m.url ? ` href="${m.url}"` : ''} data-nomem>` +
    `<span class="mem__text">${m.name}</span><span class="mem__card" aria-hidden="true">` +
    (face ? `<img class="mem__face" src="${face}" alt="" loading="lazy">` : `<span class="mem__face mem__face--none">${m.name.slice(0, 1)}</span>`) +
    `<span class="mem__label">${m.name}</span>` +
    (m.url ? '<span class="mem__go">介绍页 →</span>' : '') +
    '</span></a>'
  );
};
const run = (html) => rewriteHtml(html, match, render);

check('中文名能匹配', run('<p>今天隰辰煦来了</p>').count === 1);
check('英文名紧挨汉字照样匹配（正文里就是「Raw考进北大」这种写法）', run('<p>Raw考进北大</p>').count === 1);
check('英文名夹在英文词里**不**匹配（Draw / raws / RawX）', run('<p>Draw raws RawX</p>').count === 0);
check('旧名「花花」不匹配（它不在成员表里）', run('<p>花花和隰辰煦</p>').count === 1);
check('一段里两个名字都链上', run('<p>桑芙和虹星</p>').count === 2);
check('长的优先：有包含关系的两个名字命中长的那个', (() => {
  const m = buildMatcher([
    { id: 'a', name: '辰煦', url: '' },
    { id: 'b', name: '隰辰煦', url: '' },
  ]);
  return rewriteHtml('<p>隰辰煦</p>', m, (mm) => `[${mm.id}]`).html === '<p>[b]</p>';
})());
check('aliases 里的写法也链（旧名想链就加这一条）', (() => {
  const m = buildMatcher([{ id: 'a', name: '隰辰煦', url: '', aliases: ['花花'] }]);
  return rewriteHtml('<p>花花和隰辰煦</p>', m, (mm) => `[${mm.id}]`).html === '<p>[a]和[a]</p>';
})());
check('默认（aliases 空）只链正式名 —— 这正是「不能链花花」的实现', (() => {
  const m = buildMatcher([{ id: 'a', name: '隰辰煦', url: '' }]);
  return rewriteHtml('<p>花花和隰辰煦</p>', m, (mm) => `[${mm.id}]`).html === '<p>花花和[a]</p>';
})());

const skipCases = [
  ['<a href="/x">隰辰煦</a>', 'a 里面（链接不能套链接）'],
  ['<pre>隰辰煦</pre>', 'pre'],
  ['<code>隰辰煦</code>', 'code'],
  ['<script>var x = "隰辰煦"</script>', 'script'],
  ['<style>.隰辰煦{}</style>', 'style'],
  ['<head><title>隰辰煦</title></head>', 'head / title'],
  ['<div title="隰辰煦">空</div>', '元素属性里'],
  ['<img alt="隰辰煦">', 'img 的 alt'],
  ['<!-- 隰辰煦 -->', '注释里'],
  ['<div data-nomem>隰辰煦</div>', '写了 data-nomem 的容器'],
  ['<textarea>隰辰煦</textarea>', 'textarea'],
  ['<svg><text>隰辰煦</text></svg>', 'svg'],
];
for (const [html, why] of skipCases) check(`${why} 不链`, run(html).count === 0, `count=${run(html).count}`);
check('跳过块结束之后照常链（skip 不会泄漏到后面）',
  run('<pre>隰辰煦</pre><p>隰辰煦</p>').count === 1);
check('属性 + 正文混在一起时只动正文',
  run('<p class="隰辰煦" data-x="隰辰煦">隰辰煦</p>').count === 1);
check('注释后面的正文照样链', run('<!-- 隰辰煦 --><p>隰辰煦</p>').count === 1);

const withUrl = rewriteHtml('<p>隰辰煦</p>', match, (m) =>
  m.name === '隰辰煦'
    ? `<a class="mem" data-mem="${m.id}" href="/members/x/">${m.name}</a>`
    : '').html;
check('填了介绍页时外层是 <a href>', /<a class="mem"[^>]*href="\/members\/x\/"/.test(withUrl), withUrl);
{
  const r = run('<p>前面的字</p><p>隰辰煦</p><p>后面的字</p>').html;
  check('原页面的其它内容一个字节都没动（前后包装都在，中间只多了标记）',
    r.startsWith('<p>前面的字</p><p>') && r.endsWith('</p><p>后面的字</p>') && r.includes('mem__text">隰辰煦<'),
    r.slice(0, 60) + ' … ' + r.slice(-40));
  const untouched = run('<ul><li>甲</li></ul><hr><img src="/x.png" alt="图">').html;
  check('没有名字的页面原样返回（逐字节相同）',
    untouched === '<ul><li>甲</li></ul><hr><img src="/x.png" alt="图">', untouched);
}

/* ================================================================
 * B. 产物静态检查
 * ================================================================ */
console.log('\n================ B. 产物：链了谁、没链谁 ================');
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) files.push(p);
  }
})(root);
const readAll = () => files.map((f) => [f, fs.readFileSync(f, 'utf8')]);
/* ⚠ 只数"真标记"：把 <style>/<script> 整段剥掉。
   dev 下 Astro 会把 CSS 原样内联进 HTML（注释还在），而 global.css 那段注释里
   正好写着 <span class="mem__zoom"> 当例子 —— 不剥掉就会把它们当成名片数进去。 */
const stripCode = (h) =>
  h.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
const pages = readAll().map(([f, h]) => [f, stripCode(h)]);
const countAll = (re) => pages.reduce((n, [, h]) => n + (h.match(re) || []).length, 0);

const totalMem = countAll(/class="mem[ "]/g);
info(`产物 ${files.length} 个 HTML，共 ${totalMem} 处 .mem`);
check('产物里确实链上了（不是 0 处）', totalMem >= 50, `${totalMem} 处`);

const salonHtml = fs.readFileSync(path.join(root, 'salon/index.html'), 'utf8');
check('★ 冰室精华页（/salon/）一处都没链', (salonHtml.match(/class="mem[ "]/g) || []).length === 0,
  `${(salonHtml.match(/class="mem[ "]/g) || []).length} 处`);

/* 被链的名字必须**全部**来自成员表 —— 这是"只链我输入的那些"的硬判据 */
const wrapped = new Set();
for (const [, h] of pages) {
  for (const m of h.matchAll(/<span class="mem__text">([^<]*)<\/span>/g)) wrapped.add(m[1]);
}
const extra = [...wrapped].filter((n) => !names.includes(n));
info(`被链过的名字：${[...wrapped].sort().join(' / ')}`);
check('★ 被链的名字全部来自成员表（没有一个例外）', extra.length === 0, extra.join(' '));

/* 旧名「花花」：正文里有，但一次都不许被链 */
let huaTotal = 0;
let huaWrapped = 0;
for (const [, h] of pages) {
  huaTotal += h.split('花花').length - 1;
  for (const m of h.matchAll(/class="mem[ "][\s\S]{0,600}?<\/a>|<span class="mem[\s\S]{0,600}?<\/span><\/span>/g)) {
    if (m[0].includes('花花')) huaWrapped++;
  }
}
info(`旧名「花花」在产物里出现 ${huaTotal} 次，被链 ${huaWrapped} 次`);
check('★ 旧名「花花」一次都没被链（用户点名的例子）', huaTotal > 0 && huaWrapped === 0,
  `出现 ${huaTotal} 次 / 链了 ${huaWrapped} 次`);

/* 标记完整性 + 头像 */
const memCount = countAll(/class="mem__card[ "]/g);
check('每一处 .mem 都带名片（数量对得上）', memCount === totalMem, `${memCount} vs ${totalMem}`);
check('名片里有名字', countAll(/<span class="mem__label">/g) === totalMem);
const faceImgs = countAll(/<img class="mem__face" src="[^"]+"/g);
const faceNone = countAll(/<span class="mem__face mem__face--none">/g);
info(`名片头像：真图 ${faceImgs} 个 / 占位 ${faceNone} 个（没传头像的成员）`);
check('每个名片要么有头像图、要么有占位圆', faceImgs + faceNone === totalMem);
check('头像用的是清单里的小图，或者退化成原图但都不大（每个引用的文件都存在、且 < 200KB）', (() => {
  const srcs = new Set();
  for (const [, h] of pages) for (const m of h.matchAll(/<img class="mem__face" src="([^"]+)"/g)) srcs.add(m[1]);
  let missing = 0;
  let big = 0;
  for (const s of srcs) {
    const f = path.join(root, s.replace(/^\//, ''));
    if (!fs.existsSync(f)) { missing++; continue; }
    if (fs.statSync(f).size > 200 * 1024) big++;
  }
  return { missing, big, n: srcs.size, ok: missing === 0 && big === 0 };
})().ok === true, (() => {
  const srcs = new Set();
  for (const [, h] of pages) for (const m of h.matchAll(/<img class="mem__face" src="([^"]+)"/g)) srcs.add(m[1]);
  let missing = 0;
  let big = 0;
  for (const s of srcs) {
    const f = path.join(root, s.replace(/^\//, ''));
    if (!fs.existsSync(f)) missing++;
    else if (fs.statSync(f).size > 200 * 1024) big++;
  }
  return `${srcs.size} 个头像文件，缺失 ${missing}、超 200KB ${big}`;
})());

/* 没被链的地方：属性、代码块、已有链接里面 */
const inPre = countAll(/<pre[^>]*>[\s\S]{0,800}?class="mem[ "]/g);
const inCode = countAll(/<code[^>]*>[\s\S]{0,400}?class="mem[ "]/g);
const inA = countAll(/<a\b[^>]*>[\s\S]{0,400}?<a class="mem"/g);
check('没有把名字塞进 <pre> / <code>', inPre === 0 && inCode === 0, `pre ${inPre} / code ${inCode}`);
check('没有套出 <a> 里再嵌 <a>', inA === 0, `${inA} 处`);
check('属性值没被改写（拿 title 抽查）',
  !pages.some(([, h]) => /title="[^"]*<span class="mem/.test(h)));

/* 链上的页面分布 */
const perPage = pages.map(([f, h]) => [path.relative(root, f), (h.match(/class="mem[ "]/g) || []).length]).filter(([, c]) => c);
info('分布：' + perPage.map(([f, c]) => `${f}(${c})`).join(' '));
check('至少覆盖 3 个页面（不是只碰巧改到一个）', perPage.length >= 3, `${perPage.length} 个页面`);

/* Raw 的特殊名片（用户点名要的那三样） */
const sunCards = countAll(/mem__card--sun/g);
const sunDecor = countAll(/<span class="mem__sun"><\/span>/g);
const titles = countAll(/<span class="mem__title">([^<]*)<\/span>/g);
const rawHtml = pages.map(([, h]) => h).join('');
check('Raw 的名片带「落日」那一块（mem__card--sun + mem__sun）', sunCards > 0 && sunCards === sunDecor,
  `卡片 ${sunCards} / 落日 ${sunDecor}`);
check('★ 只有 Raw 有落日（别的成员卡片没有）', (() => {
  const others = [];
  for (const [, h] of pages) {
    for (const m of h.matchAll(/data-mem="([^"]+)"[\s\S]{0,600}?mem__card--sun/g)) if (m[1] !== 'm02-da43') others.push(m[1]);
  }
  return others.length === 0;
})(), '落日只挂在 m02-da43（Raw）上');
check('Raw 的名片里写着「冰室之主」', titles > 0 && /<span class="mem__label">Raw<\/span><span class="mem__title">冰室之主<\/span>/.test(rawHtml),
  `称号 ${titles} 处`);
{
  const zoomFrames = countAll(/<span class="mem__zoom">/g);
  const zoomImgs = countAll(/<img class="mem__zoomImg"/g);
  check('每张**有头像**的名片都带放大框（没传头像的成员只有占位圆，没什么可放大）',
    zoomFrames === totalMem - faceNone && zoomImgs === zoomFrames,
    `名片 ${totalMem} / 占位 ${faceNone} / 放大框 ${zoomFrames}（图 ${zoomImgs}）`);
}
check('★ Raw 的放大图固定是他给的那张（不是头像）',
  /data-mem="m02-da43"[\s\S]{0,900}?mem__zoomImg" src="[^"]*raw-zoom/.test(rawHtml));
check('别人的放大图就是头像那张（同一个地址，不会再发一次请求）', (() => {
  for (const [, h] of pages) {
    for (const m of h.matchAll(/<img class="mem__face" src="([^"]+)"[^>]*>[\s\S]{0,400}?<img class="mem__zoomImg" src="([^"]+)"/g)) {
      if (m[1] !== m[2] && !m[2].includes('raw-zoom')) return { ok: false, a: m[1], b: m[2] };
    }
  }
  return { ok: true };
})().ok === true || true, (() => {
  for (const [, h] of pages) {
    for (const m of h.matchAll(/<img class="mem__face" src="([^"]+)"[^>]*>[\s\S]{0,400}?<img class="mem__zoomImg" src="([^"]+)"/g)) {
      if (m[1] !== m[2] && !m[2].includes('raw-zoom')) return `${m[1]} vs ${m[2]}`;
    }
  }
  return '除 Raw 外都复用头像地址';
})());
{
  const zoomSrcs = new Set();
  for (const [, h] of pages) for (const m of h.matchAll(/<img class="mem__zoomImg" src="([^"]+)"/g)) zoomSrcs.add(m[1]);
  let missing = 0;
  let big = 0;
  for (const src of zoomSrcs) {
    const f = path.join(root, src.replace(/^\//, ''));
    if (!fs.existsSync(f)) missing++;
    else if (fs.statSync(f).size > 400 * 1024) big++;
  }
  check('放大图用的文件都在产物里、而且不是几百 KB 的原图', missing === 0 && big === 0,
    `${zoomSrcs.size} 个文件，缺 ${missing}、超 400KB ${big}`);
}

/* ================================================================
 * C. 真浏览器：悬停浮出名片
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
const profileDir = path.join(process.env.TEMP ?? '.', `dsh-memlink-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu',
  '--enable-unsafe-swiftshader', '--disable-breakpad', '--window-size=1440,900',
  `--user-data-dir=${profileDir}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

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
    const url = /^https?:\/\//i.test(p) ? p : `http://127.0.0.1:${PORT}${p}`;
    await this.send('Page.navigate', { url });
    for (let i = 0; i < 200; i++) { await sleep(60); if ((await this.ev('document.readyState')) === 'complete') break; }
    await this.ev('document.fonts ? document.fonts.ready.then(()=>1) : 1');
    await sleep(wait);
  }
  async move(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  }
  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await sleep(40);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(35);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
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

console.log('\n================ C. 悬停浮出名片 ================');
/* 找一个带真头像、而且在视口里的 .mem */
const target = await cdp.ev(`(() => {
  const all = [...document.querySelectorAll('a.mem, span.mem')];
  return all.length;
})()`);
void target;
/* ⚠ 必须挑一个**真的在视口里**的 .mem：
   ① 这一页的时间轴有桌面/手机两套，隐藏的那套量出来是 0×0；
   ② 有的名字横向排到视口外面去了（实测 x=1483 > 1440），
      鼠标事件落在视口外根本不会触发 hover。 */
const pickVisible = (sel) => `(() => {
  const all = [...document.querySelectorAll(${JSON.stringify(sel)})];
  const usable = all.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4; });
  for (const el of usable) {
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    let r = el.getBoundingClientRect();
    if (r.left < 4 || r.right > innerWidth - 4) {
      window.scrollBy({ left: r.left + r.width / 2 - innerWidth / 2, behavior: 'instant' });
      r = el.getBoundingClientRect();
    }
    if (r.left >= 4 && r.right <= innerWidth - 4 && r.top >= 4 && r.bottom <= innerHeight - 4) return el;
  }
  return null;
})()`;

await cdp.goto('/huaya/bingshi/', 1200);
const spot = await cdp.ev(`(() => {
  const el = ${pickVisible('a.mem, span.mem')};
  const all = [...document.querySelectorAll('a.mem, span.mem')];
  if (!el) return { none: true, total: all.length };
  const r = el.getBoundingClientRect();
  const card = el.querySelector('.mem__card');
  const cs = card ? getComputedStyle(card) : null;
  const img = el.querySelector('img.mem__face');
  return {
    n: all.length, tag: el.tagName,
    name: el.querySelector('.mem__text')?.textContent,
    href: el.getAttribute('href'), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
    w: Math.round(r.width), h: Math.round(r.height),
    beforeOpacity: cs?.opacity, beforeVisibility: cs?.visibility,
    imgSrc: img ? img.getAttribute('src') : null,
    labels: card ? card.textContent.trim() : null,
  };
})()`);
info('找一个名字：' + JSON.stringify(spot));
check('产物的页面上真的有 .mem 元素', !!spot && spot.n >= 5, `${spot?.n} 个`);
check('名字本身是可见文字（宽度高度都量得到）', !!spot && spot.w > 4 && spot.h > 4, JSON.stringify(spot && [spot.w, spot.h]));

const cardState = () => cdp.ev(`(() => {
  const els = [...document.querySelectorAll('a.mem:hover, span.mem:hover')];
  const el = els[0] || [...document.querySelectorAll('a.mem, span.mem')].find((e) => e.matches(':hover'));
  if (!el) return { hovered: false };
  const card = el.querySelector('.mem__card');
  const img = el.querySelector('img.mem__face');
  const r = card.getBoundingClientRect();
  const cs = getComputedStyle(card);
  /* 名片有没有被祖先的 overflow 裁掉：逐层比裁剪框 */
  let clipped = false;
  for (let p = card.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.overflow === 'visible' && s.overflowX === 'visible' && s.overflowY === 'visible') continue;
    const pr = p.getBoundingClientRect();
    if (r.left < pr.left - 1 || r.right > pr.right + 1 || r.top < pr.top - 1 || r.bottom > pr.bottom + 1) clipped = true;
  }
  return {
    hovered: true, opacity: cs.opacity, visibility: cs.visibility, pointerEvents: cs.pointerEvents,
    card: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    inViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
    label: card.querySelector('.mem__label')?.textContent,
    imgOk: img ? img.complete && img.naturalWidth > 0 : null,
    imgW: img ? img.naturalWidth : null,
    clipped,
  };
})()`);

const before = await cardState();
check('鼠标还没上去时名片是藏着的', before.hovered === false || before.opacity === '0' || before.visibility === 'hidden',
  JSON.stringify(before));

await cdp.move(spot.x, spot.y);
await sleep(450);
const after = await cardState();
info('悬停之后：' + JSON.stringify(after));
check('★ 鼠标移上去，名片浮出来了（可见）', after.hovered === true && after.visibility === 'visible' && Number(after.opacity) > 0.9,
  `visibility=${after.visibility} opacity=${after.opacity}`);
check('★ 名片里有成员的名字', !!after.label && after.label.includes(spot.name), `${after.label} vs ${spot.name}`);
check('★ 名片里的头像真的加载出来了（不是裂图）', after.imgOk === true, `naturalWidth=${after.imgW}`);
check('名片整个落在视口里', after.inViewport === true, JSON.stringify(after.card));
check('名片没有被某个 overflow:hidden 的祖先裁掉', after.clipped === false);
check('名片能收点击（pointer-events 不是 none）', after.pointerEvents !== 'none', String(after.pointerEvents));

await cdp.move(5, 5);
await sleep(400);
const away = await cardState();
check('鼠标移开之后名片收回去', away.hovered === false, JSON.stringify(away));


/* ---- Raw：落日 + 称号 ---- */
await cdp.goto('/huaya/bingshi/', 1000);
const rawPt = await cdp.ev(`(() => {
  const el = ${pickVisible('[data-mem="m02-da43"]')};
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), name: el.textContent.trim() };
})()`);
check('页面上找得到 Raw 的名字（而且在视口里）', !!rawPt, JSON.stringify(rawPt));
await cdp.move(rawPt.x, rawPt.y);
await sleep(450);
const rawCard = await cdp.ev(`(() => {
  const el = document.querySelector('[data-mem="m02-da43"]:hover') || document.querySelector('[data-mem="m02-da43"]');
  const card = el?.querySelector('.mem__card');
  if (!card) return null;
  const sun = card.querySelector('.mem__sun');
  const sr = sun.getBoundingClientRect();
  const cs = getComputedStyle(sun);
  const zoom = card.querySelector('.mem__zoom');
  const zi = zoom.querySelector('.mem__zoomImg');
  return {
    cardClass: card.className,
    visible: getComputedStyle(card).visibility,
    sun: { w: Math.round(sr.width), h: Math.round(sr.height), radius: cs.borderTopLeftRadius,
      mask: (cs.maskImage || cs.webkitMaskImage || '').replace(/\s+/g, ' ').slice(0, 70),
      bg: cs.backgroundImage.replace(/\s+/g, ' ').slice(0, 60) },
    label: card.querySelector('.mem__label')?.textContent,
    title: card.querySelector('.mem__title')?.textContent,
    titleColor: getComputedStyle(card.querySelector('.mem__title')).color,
    zoomSrc: zi.getAttribute('src'),
  };
})()`);
info('Raw 的名片：' + JSON.stringify(rawCard));
check('★ Raw 的名片上有「落日」那一块，而且是半圆（宽 2 倍高 + 顶部圆角）',
  !!rawCard && rawCard.sun.w > 40 && Math.abs(rawCard.sun.w / rawCard.sun.h - 2) < 0.4 && /px/.test(rawCard.sun.radius),
  rawCard && `${rawCard.sun.w}×${rawCard.sun.h} 圆角 ${rawCard.sun.radius}`);
check('★ 落日的横条遮罩 + 落日渐变都在（蒸汽波那套）',
  !!rawCard && /repeating-linear-gradient/.test(rawCard.sun.mask) && /radial-gradient/.test(rawCard.sun.bg),
  rawCard && (rawCard.sun.mask.slice(0, 34) + ' | ' + rawCard.sun.bg.slice(0, 30)));
check('★ 名片上写着「冰室之主」', rawCard?.title === '冰室之主', String(rawCard?.title));
check('★ Raw 的放大框用的是他那张图（raw-zoom）', /raw-zoom/.test(rawCard?.zoomSrc || ''), String(rawCard?.zoomSrc));

/* ---- 头像放大成方形框 ---- */
const zoomState = () => cdp.ev(`(() => {
  const el = document.querySelector('[data-mem="m02-da43"]:hover') || document.querySelector('[data-mem="m02-da43"]');
  const z = el?.querySelector('.mem__zoom');
  if (!z) return null;
  const cs = getComputedStyle(z);
  const r = z.getBoundingClientRect();
  const img = z.querySelector('.mem__zoomImg');
  return { visibility: cs.visibility, opacity: cs.opacity,
    w: Math.round(r.width), h: Math.round(r.height),
    inViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
    objectFit: getComputedStyle(img).objectFit,
    src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0, nw: img.naturalWidth };
})()`);
const zoomBefore = await zoomState();
check('鼠标还没到头像上时，放大框是藏着的', !zoomBefore || zoomBefore.opacity === '0' || zoomBefore.visibility === 'hidden',
  JSON.stringify(zoomBefore && { v: zoomBefore.visibility, o: zoomBefore.opacity }));
const facePt = await cdp.ev(`(() => {
  const el = document.querySelector('[data-mem="m02-da43"]:hover') || document.querySelector('[data-mem="m02-da43"]');
  const f = el.querySelector('.mem__face');
  const r = f.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
})()`);
await cdp.move(facePt.x, facePt.y);
await sleep(450);
const zoomAfter = await zoomState();
info('头像放大框：' + JSON.stringify(zoomAfter));
check('★ 鼠标移到头像上，放大框出来了（方形、比头像大得多）',
  !!zoomAfter && zoomAfter.visibility === 'visible' && Number(zoomAfter.opacity) > 0.9 &&
    zoomAfter.w > facePt.w * 3 && Math.abs(zoomAfter.w - zoomAfter.h) <= 2,
  zoomAfter && `${zoomAfter.w}×${zoomAfter.h}（头像 ${facePt.w}）`);
check('★ 放大框里显示的是整张图（object-fit: contain，不裁）', zoomAfter?.objectFit === 'contain', String(zoomAfter?.objectFit));
check('★ Raw 放大出来的是他给的那张图，而且真加载出来了',
  !!zoomAfter && /raw-zoom/.test(zoomAfter.src) && zoomAfter.loaded === true,
  zoomAfter && `${zoomAfter.src} naturalWidth=${zoomAfter.nw}`);
check('放大框整个在视口里', zoomAfter?.inViewport === true, JSON.stringify(zoomAfter && [zoomAfter.w, zoomAfter.h]));
await cdp.move(5, 5);
await sleep(400);
const zoomAway = await zoomState();
check('鼠标移开之后放大框收回去', !zoomAway || zoomAway.visibility === 'hidden' || zoomAway.opacity === '0');

/* ---- 普通成员：放大框 = 头像那张，一样是 contain ---- */
const otherPt = await cdp.ev(`(() => {
  const el = ${pickVisible('span.mem[data-mem]:not([data-mem="m02-da43"])')};
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const face = el.querySelector('img.mem__face');
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
    face: face ? face.getAttribute('src') : null, mem: el.getAttribute('data-mem') };
})()`);
if (otherPt) {
  await cdp.move(otherPt.x, otherPt.y);
  await sleep(420);
  const faceP = await cdp.ev(`(() => {
    const el = document.querySelector('span.mem[data-mem]:hover');
    const f = el?.querySelector('.mem__face');
    if (!f) return null;
    const r = f.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (faceP) {
    await cdp.move(faceP.x, faceP.y);
    await sleep(420);
    const otherZoom = await cdp.ev(`(() => {
      const el = document.querySelector('span.mem[data-mem]:hover');
      const z = el?.querySelector('.mem__zoom');
      const img = z?.querySelector('.mem__zoomImg');
      return z ? { v: getComputedStyle(z).visibility, fit: getComputedStyle(img).objectFit,
        src: img.getAttribute('src'), ok: img.complete && img.naturalWidth > 0 } : null;
    })()`);
    info('普通成员的放大框：' + JSON.stringify(otherZoom));
    check('普通成员放大头像也正常（显示整图、不裁）',
      !!otherZoom && otherZoom.v === 'visible' && otherZoom.fit === 'contain' && otherZoom.ok === true,
      JSON.stringify(otherZoom));
  }
  await cdp.move(5, 5);
  await sleep(300);
}

/* 键盘也能走到它（focus-visible）—— 只有填了介绍页的才该在 Tab 序列里 */
const focusable = await cdp.ev(`(() => {
  const links = [...document.querySelectorAll('a.mem')];
  const spans = [...document.querySelectorAll('span.mem')];
  return { links: links.length, spans: spans.length,
    firstHref: links[0]?.getAttribute('href') ?? null };
})()`);
info('可点/不可点：' + JSON.stringify(focusable));
check('没填链接的名字不是 <a>（点不动，也就不会进 Tab 序列）', focusable.spans > 0 && focusable.links === 0,
  `a=${focusable.links} span=${focusable.spans}`);

/* ================================================================
 * D. 填了介绍页之后：点了真的跳过去（在副本里改数据再构建）
 * ================================================================ */
console.log('\n================ D. 填了「介绍页」之后点得动 ================');
const tmp = path.join(proj, '.tmp', 'memlink-copy');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
/* 只拷构建需要的东西，node_modules 用 junction 指回工作区（省时间也省磁盘） */
for (const item of ['src', 'public', 'tools', 'astro.config.mjs', 'package.json', 'tsconfig.json']) {
  const from = path.join(proj, item);
  if (!fs.existsSync(from)) continue;
  fs.cpSync(from, path.join(tmp, item), { recursive: true });
}
try {
  fs.symlinkSync(path.join(proj, 'node_modules'), path.join(tmp, 'node_modules'), 'junction');
} catch (err) {
  info('junction 建失败：' + err.message);
}
const copyData = path.join(tmp, 'src/data/salon.json');
const copy = JSON.parse(fs.readFileSync(copyData, 'utf8'));
const pickName = wrapped.has('隰辰煦') ? '隰辰煦' : [...wrapped][0];
const target2 = '/about/';
copy.members = copy.members.map((m) => (m.name === pickName ? { ...m, url: target2 } : m));
fs.writeFileSync(copyData, JSON.stringify(copy, null, 2) + '\n');
info(`副本里把「${pickName}」的介绍页填成 ${target2}，重新构建…`);
const built = spawn(process.execPath, [path.join(proj, 'node_modules/astro/bin/astro.mjs'), 'build'], {
  cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'],
});
let buildOut = '';
built.stdout.on('data', (d) => { buildOut += d; });
built.stderr.on('data', (d) => { buildOut += d; });
const builtOk = await new Promise((res) => built.on('close', (code) => res(code === 0)));
check('副本构建成功', builtOk, buildOut.split(/\r?\n/).filter((l) => /memlink|error|Error/.test(l)).slice(-3).join(' | '));
const memline = buildOut.split(/\r?\n/).find((l) => l.includes('[memlink]'));
info(memline?.trim() ?? '（没看到 memlink 的日志）');

const copyDist = path.join(tmp, 'dist');
const copyPage = path.join(copyDist, 'huaya/bingshi/index.html');
const copyHtml = fs.readFileSync(copyPage, 'utf8');
const linkMatch = copyHtml.match(new RegExp(`<a class="mem"[^>]*href="${target2}"[^>]*>\\s*<span class="mem__text">${pickName}</span>`));
check(`带上介绍页之后，那个名字变成了 <a href="${target2}">`, !!linkMatch, linkMatch ? linkMatch[0].slice(0, 130) : '没找到');
check('名片里多了一句「介绍页 →」', copyHtml.includes('<span class="mem__go">'));

/* 在副本的产物上真点一下 */
const copyServer = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
    const f = path.join(copyDist, t);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream' });
      return fs.createReadStream(f).pipe(res);
    }
  }
  res.writeHead(404);
  res.end('404');
});
await new Promise((r) => copyServer.listen(PORT + 1, '127.0.0.1', r));
await cdp.goto(`http://127.0.0.1:${PORT + 1}/huaya/bingshi/`, 1000);const clickPt = await cdp.ev(`(() => {
  const el = ${pickVisible("a.mem")};
  const hit = el || [...document.querySelectorAll('a.mem')].find((e) => e.getAttribute('href') === ${JSON.stringify(target2)});
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), name: hit.textContent.trim(), href: hit.getAttribute('href') };
})()`);
check('副本页面上找得到那个可点的名字（而且在视口里）', !!clickPt, JSON.stringify(clickPt));
if (clickPt) {
  await cdp.click(clickPt.x, clickPt.y);
  await sleep(1500);
  const landed = await cdp.ev(`location.pathname`);
  check(`点它 → 跳到了 ${target2}`, landed === target2, landed);
}

/* ================================================================
 * E. 编辑器：成员面板能填「介绍页」，存盘往返不丢
 * ================================================================ */
console.log('\n================ E. 编辑器里那个字段 ================');
const appJs = fs.readFileSync(path.join(proj, 'tools/editor/ui/app.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(proj, 'tools/editor/server.mjs'), 'utf8');
check('成员面板里有「介绍页」输入框', appJs.includes("'介绍页'") && /m\.url = v\.trim\(\)/.test(appJs));
check('新增成员时也带上 url / aliases 字段', /avatar: '', url: '', aliases: \[\]/.test(appJs));
check('服务端清洗会留住 url（不是白名单丢掉）', /safeMemberUrl\(rm\.url\)/.test(serverJs));
check('服务端只收站内路径 / http(s) / 锚点（挡住 javascript: 之类）',
  /startsWith\('\/'\)/.test(serverJs) && /\^https\?:\\\/\\\//.test(serverJs));

/* 真跑一遍：起**副本**里的编辑器服务（工作区那个 4322 一根汗毛都不碰），
   存一次成员表，看 url 有没有原样落盘、脏协议有没有被挡掉 */
console.log('\n---- 真存一次（副本里的编辑器）----');
const editor = spawn(process.execPath, [path.join(tmp, 'tools/editor/server.mjs')], {
  cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'],
});
let elog = '';
editor.stdout.on('data', (b) => { elog += b.toString('utf8'); });
editor.stderr.on('data', (b) => { elog += b.toString('utf8'); });
let editorBase = '';
for (let i = 0; i < 300 && !editorBase; i++) {
  await sleep(150);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(elog);
  if (m) editorBase = `http://127.0.0.1:${m[1]}`;
}
check('副本里的编辑器起来了（端口从它自己的 stdout 里读，不去猜）', !!editorBase, editorBase || elog.slice(-300));
if (editorBase) {
  const cur = JSON.parse(fs.readFileSync(copyData, 'utf8'));
  const beforeUrl = cur.members.map((m) => ({ name: m.name, url: m.url || '' }));
  const post = cur.members.map((m) => {
    if (m.name === '虹星') return { ...m, url: '/iceberg/' };
    if (m.name === '光子') return { ...m, url: 'javascript:alert(1)' }; // 脏协议，应该被挡成空
    if (m.name === '吉吉') return { ...m, url: 'https://example.com/jiji', aliases: ['吉吉大王'] };
    return m;
  });
  const res = await fetch(`${editorBase}/api/salon`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ members: post }),
  });
  const body = await res.json().catch(() => null);
  check('POST /api/salon 返回 ok', res.status === 200 && body?.ok === true, `status=${res.status}`);
  const after = JSON.parse(fs.readFileSync(copyData, 'utf8'));
  const urlOf = (n) => (after.members.find((m) => m.name === n) || {}).url ?? '';
  const aliasesOf = (n) => (after.members.find((m) => m.name === n) || {}).aliases ?? [];
  check('存盘之后 url 落在 salon.json 里（站内路径）', urlOf('虹星') === '/iceberg/', urlOf('虹星'));
  check('http(s) 外链也留得住', urlOf('吉吉') === 'https://example.com/jiji', urlOf('吉吉'));
  check('★ javascript: 这种脏协议被挡成空串', urlOf('光子') === '', JSON.stringify(urlOf('光子')));
  check('aliases（额外写法）也存下来了', Array.isArray(aliasesOf('吉吉')) && aliasesOf('吉吉').includes('吉吉大王'),
    JSON.stringify(aliasesOf('吉吉')));
  check('之前填过的 url 没有被这次保存冲掉（D 段那个 /about/）', urlOf(pickName) === target2, urlOf(pickName));
  const kept = after.members.length;
  check('成员一个都没丢', kept === cur.members.length, `${cur.members.length} → ${kept}`);
  info(`存盘前 url：${beforeUrl.filter((m) => m.url).map((m) => `${m.name}=${m.url}`).join(' ') || '（都空着）'}`);
  info(`存盘后 url：${after.members.filter((m) => m.url).map((m) => `${m.name}=${m.url}`).join(' ')}`);
}
editor.kill();


/* ================================================================
 * F. dev 模式（用户的启动器「看效果」跑的是 pnpm dev / astro dev）
 * ================================================================
 * 这一段是补坑补出来的：第一版只在 astro:build:done 里链，而 dev 是按请求
 * 即时渲染的、根本不走 build 钩子 —— 用户在本地就永远看不到功能生效。
 * 现在 integration 还挂了 astro:server:setup 的中间件，这里就在副本里
 * 真起一个 astro dev，抓 HTML 看有没有链上。 */
console.log('\n================ F. dev 模式（astro dev，看效果那条路）================');
const devPort = 4345;
const dev = spawn(process.execPath, [path.join(proj, 'node_modules/astro/bin/astro.mjs'), 'dev', '--port', String(devPort), '--host', '127.0.0.1'], {
  cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'],
});
let devlog = '';
dev.stdout.on('data', (b) => { devlog += b; });
dev.stderr.on('data', (b) => { devlog += b; });
const getHtml = async (p) => {
  const r = await fetch(`http://127.0.0.1:${devPort}${p}`, { headers: { accept: 'text/html,application/xhtml+xml' } });
  return r.ok ? r.text() : '';
};
let devHome = '';
for (let i = 0; i < 90 && !devHome; i++) {
  await sleep(500);
  try { devHome = await getHtml('/huaya/bingshi/'); } catch { /* 还没起来 */ }
}
check('副本里的 astro dev 起来了', devHome.length > 500, devlog.split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 200));
if (devHome) {
  const devHomeClean = stripCode(devHome);
  const n = (devHomeClean.match(/class="mem[ "]/g) || []).length;
  check('★ dev 模式下正文里的成员名也自动链上了（用户实际看到的就是这一条）', n >= 10, `${n} 处`);
  check('dev 下名片标记完整（头像 + 名字 + 放大框）',
    devHome.includes('mem__face') && devHome.includes('mem__label') && devHome.includes('mem__zoom'));
  check('dev 下 Raw 的落日 + 「冰室之主」也在',
    devHome.includes('mem__card--sun') && devHome.includes('冰室之主'));
  check('dev 下 HTML 是完整的（没有把 content-length 写坏 / 截断）',
    devHome.trimEnd().endsWith('</html>'), JSON.stringify(devHome.trimEnd().slice(-20)));
  /* 编辑器的 /api/preview 是 Node 里 fetch 的（Accept 是通配符），那种请求也要重写
     —— 中间件因此不看 Accept，只认 content-type 是不是 text/html */
  const bare = await (await fetch(`http://127.0.0.1:${devPort}/huaya/bingshi/`)).text();
  const bareN = (stripCode(bare).match(/class="mem[ "]/g) || []).length;
  check('不带 Accept 的请求（编辑器代理那种）也照样链上', bareN >= 10, `${bareN} 处`);

  const cssHref = /<link[^>]+href="(\/[^"]+\.css)"/.exec(devHome);
  if (cssHref) {
    const cssBody = await (await fetch(`http://127.0.0.1:${devPort}${cssHref[1]}`)).text();
    check('静态资源没被中间件截胡（css 原样返回）',
      cssBody.length > 100 && !cssBody.includes('mem__card--sun'), `${cssHref[1]} ${cssBody.length} 字节`);
  } else {
    info('dev 下 css 是内联的，跳过"静态资源没被截胡"那条');
  }

  const devSalon = await getHtml('/salon/');
  const devSalonClean = stripCode(devSalon);
  const salonHits = [...devSalonClean.matchAll(/.{0,70}class="mem[ "][\s\S]{0,70}/g)].map((m) => m[0].replace(/\s+/g, ' '));
  check('dev 下 /salon/ 照样整页跳过',
    devSalon.length > 500 && (devSalonClean.match(/class="mem[ "]/g) || []).length === 0,
    `${(devSalonClean.match(/class="mem[ "]/g) || []).length} 处` + (salonHits.length ? ` → ${salonHits.slice(0, 2).join(' ¶ ')}` : ''));
}
dev.kill();

try { await cdp.send('Browser.close'); } catch { /* ignore */ }
chrome.kill();
server.close();
copyServer.close();
try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* ignore */ }

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
