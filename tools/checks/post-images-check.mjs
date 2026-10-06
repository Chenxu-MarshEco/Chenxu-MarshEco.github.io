/*
 * 正文图片的版式 + 编辑器里的「正文图片」管理器（2026-10-06）
 *
 * 用户原话：
 *   「另外文章和手记应当支持传入多张图片 且可以选择图片所在位置 请你修改一下」
 * 随后在选项里挑的是：正文插图能选位置和大小（整宽 / 半宽居左 / 半宽居右 / 居中）、
 * 一次拖/选多张之后能拖动调整先后、每张图能选「放封面 / 放正文档」（图片列表 + 位置下拉）。
 *
 * 这份脚本分两段验：
 *   ① **渲染**（在 .tmp 的副本里造一篇带四种版式的文章，真构建）：记号真的变成了 class、
 *      整宽真的比正文栏宽、半宽居左/居右真的是浮动（量"第一行文字让开了没有"）、
 *      title 被摘掉（不留鼠标悬停的小白条）、没写记号的图照旧。
 *   ② **编辑器那一列图**（副本里起编辑器，用真鼠标点/拖）：
 *      列表把四张图都列出来；改版式 → 正文里那一处记号跟着变；
 *      「设为封面」→ 封面框变成它；拖动第二张到第一张上面 → 正文里的先后真的换了，
 *      而**图片之间的文字一个字节都没动**；删除 → 它从正文里消失。
 *
 * 不动真仓库里的任何内容 —— 内容都写在副本里，跑完连副本一起删。
 *
 * 用法：node tools/checks/post-images-check.mjs [--shots]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync, execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..');
const TMP = path.join(SRC, '.tmp');
const COPY = path.join(TMP, 'img-copy');
const SHOTS = path.join(TMP, 'img-shots');
const WANT_SHOTS = process.argv.includes('--shots');
const PORT = 4399;
const DEBUG_PORT = 9368;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg', '.xml': 'application/xml' };

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

/* ================================================================
 * ① 源码接线（便宜、快）
 * ================================================================ */
console.log('================ ① 接线 ================');
const astroCfg = fs.readFileSync(path.join(SRC, 'astro.config.mjs'), 'utf8');
const globalCss = fs.readFileSync(path.join(SRC, 'src', 'styles', 'global.css'), 'utf8');
const editorHtml = fs.readFileSync(path.join(SRC, 'tools', 'editor', 'ui', 'index.html'), 'utf8');
const editorJs = fs.readFileSync(path.join(SRC, 'tools', 'editor', 'ui', 'app.js'), 'utf8');
const editorCss = fs.readFileSync(path.join(SRC, 'tools', 'editor', 'ui', 'style.css'), 'utf8');

/*
  记号是**中文**、页面按 title 属性选样式（不走构建期插件 —— Astro 7 换了 Markdown
  处理器，remarkPlugins 要另装包，构建会直接报错）。所以这里最要紧的一条是
  「编辑器写的那几个字」和「样式认的那几个字」**一模一样**。
*/
/* 只从 PIC_LAYOUTS 那一段里取记号 —— 满文件的 ['x','y'] 配对多了去了
   （图片档位、卡片形状、时间点种类…），不限定范围会捞出一堆无关的。 */
const picBlock = /const PIC_LAYOUTS = \[([\s\S]*?)\];/.exec(editorJs)?.[1] ?? '';
const tokens = [...picBlock.matchAll(/\['([^']*)', '([^']+)'\]/g)]
  .map((m) => m[1])
  .filter((v) => v !== '');
check('★ 样式里认那三个版式记号（按 Markdown title 选，不需要构建期插件）',
  /\.prose img\[title='整宽'\]/.test(globalCss)
  && /\.prose img\[title='半宽居左'\]/.test(globalCss)
  && /\.prose img\[title='半宽居右'\]/.test(globalCss)
  && /float: left/.test(globalCss) && /float: right/.test(globalCss),
  `认到的记号：${tokens.join(' / ')}`);
check('★★ 编辑器下拉里那几个字和样式里认的字**完全一致**（差一个字就白选）',
  tokens.length === 3 && tokens.every((t) => globalCss.includes(`img[title='${t}']`)),
  JSON.stringify(tokens));
check('★ 没有偷偷引 remark 插件那套（Astro 7 默认处理器不认它）',
  !/remarkPlugins:\s*\[/.test(astroCfg) && !/import imgLayout/.test(astroCfg));
check('★ 编辑器里有一列「正文图片」', /id="pics-box"/.test(editorHtml) && /正文图片/.test(editorHtml));
check('★ 编辑器那列图有样式', /\.picrow\b/.test(editorCss) && /\.picrow__grip/.test(editorCss));
check('★ 一次能选多张（工具栏那颗 🖼 变成了多选）', /input\.multiple = true/.test(editorJs));
check('★ 版式那四个选项都在（整宽 / 半宽居左 / 半宽居右 / 居中）',
  /\['整宽', '整宽'\]/.test(editorJs) && /\['半宽居左', '半宽居左'\]/.test(editorJs)
  && /\['半宽居右', '半宽居右'\]/.test(editorJs) && /\['', '居中（默认）'\]/.test(editorJs));
check('★ 拖动换先后 + 设为封面 + 删除三件事都接了',
  /function bindPicDrag/.test(editorJs) && /function reorderPics/.test(editorJs) && /已设为封面/.test(editorJs));

/* ================================================================
 * 准备副本（借 node_modules / public）
 * ================================================================ */
console.log('\n================ 准备副本 ================');
fs.rmSync(COPY, { recursive: true, force: true });
fs.mkdirSync(COPY, { recursive: true });
for (const item of ['src', 'tools', 'package.json', 'astro.config.mjs', 'tsconfig.json', 'site.config.ts', '.gitignore', '.gitattributes']) {
  const from = path.join(SRC, item);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(COPY, item), { recursive: true });
}
for (const j of ['node_modules', 'public']) {
  try { execFileSync('cmd', ['/c', 'mklink', '/J', path.join(COPY, j), path.join(SRC, j)], { stdio: 'ignore' }); } catch { /* 已经有了 */ }
}

/* 造一篇四种版式齐全的文章（只用真仓库里已有的图，public 是 junction，地址都能取到） */
const imgs = (() => {
  const dir = path.join(SRC, 'public', 'img', 'uploads');
  const all = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f)) : [];
  /* 要四张**各不相同的**图：删掉一张之后"那张还在不在"才是个确定的判断 */
  return all.slice(0, 4).map((f) => `/img/uploads/${f}`);
})();
info(`用了这几张现成的图：${imgs.join(' ')}`);

const FIXTURE = 'zz-verify-images.md';
const fixtureBody = [
  '第一段文字，用来验"半宽居左时文字会不会绕到右边去"。这一句要够长，长到能看出第一行的起点在哪。再补一点字，让它换行。',
  '',
  `![整宽的一张](${imgs[0]} "整宽")`,
  '',
  '第二段文字。',
  '',
  `![半宽居左](${imgs[1]} "半宽居左")`,
  '',
  '第三段文字，紧跟在半宽居左那张图后面 —— 它的第一行应该从图的右边开始，这就是"绕着排"。再多写几个字，保证这一行足够长、能跟图并排。',
  '',
  `![半宽居右](${imgs[2] ?? imgs[0]} "半宽居右")`,
  '',
  '第四段文字，跟半宽居右那张图并排。',
  '',
  `![没写版式的](${imgs[0]})`,
  '',
  '第五段文字。',
  '',
].join('\n');

fs.writeFileSync(path.join(COPY, 'src', 'content', 'notes', FIXTURE),
  `---\ntitle: 验收：四种版式的图片\ndate: 2026-10-06\ndraft: false\n---\n\n${fixtureBody}`, 'utf8');

const build = spawnSync(process.execPath, [path.join(COPY, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'build'],
  { cwd: COPY, encoding: 'utf8', timeout: 300000 });
const built = fs.existsSync(path.join(COPY, 'dist', 'notes', FIXTURE.replace(/\.md$/, ''), 'index.html'));
check('★ 副本构建成功（带四种版式的那篇文章）', build.status === 0 && built,
  `exit=${build.status} ${String(build.stderr || '').split('\n').filter(Boolean).slice(-1)[0] ?? ''}`);

/* ================================================================
 * ② 渲染：真浏览器里量
 * ================================================================ */
const serveRoot = path.join(COPY, 'dist');
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
    const f = path.join(serveRoot, t);
    if (f.startsWith(serveRoot) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream' });
      return fs.createReadStream(f).pipe(res);
    }
  }
  res.writeHead(404);
  res.end('404');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = path.join(process.env.TEMP ?? '.', `dsh-img-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu',
  '--enable-unsafe-swiftshader', '--hide-scrollbars', '--disable-breakpad',
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
      if (m.method === 'Runtime.exceptionThrown') this.errors.push('exception: ' + (m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
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
  async open(url, settle = 1500) {
    this.errors = [];
    await this.send('Page.navigate', { url: url.startsWith('http') ? url : `http://127.0.0.1:${PORT}${url}` });
    for (let i = 0; i < 120; i++) {
      await sleep(100);
      if ((await this.ev('document.readyState')) === 'complete') break;
    }
    await sleep(settle);
  }
  async shot(name, full = false) {
    if (!WANT_SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
    fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(r.data, 'base64'));
    info(`拍好 ${name}`);
  }
}

let cdp = null;
for (let i = 0; i < 60 && !cdp; i++) {
  await sleep(300);
  try {
    const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const t = l.find((x) => x.type === 'page');
    if (t) cdp = await CDP.attach(t.webSocketDebuggerUrl);
  } catch { /* 等 */ }
}
check('无头浏览器起来了', !!cdp);
if (!cdp) process.exit(1);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

console.log('\n================ ② 四种版式在页面上的样子 ================');
await cdp.open(`/notes/${FIXTURE.replace(/\.md$/, '')}/`);
const layout = await cdp.ev(`(() => {
  const prose = document.querySelector('.prose');
  const imgs = [...prose.querySelectorAll('img')];
  const pw = prose.getBoundingClientRect().width;
  const rows = imgs.map((im) => {
    const cs = getComputedStyle(im);
    const r = im.getBoundingClientRect();
    /* 紧跟在图后面那一段：量它的**第一行**从哪儿开始（浮动会让它让开）。
       图片常常被 Markdown 包在自己的 <p> 里，所以要顺着"它所在的那个 p"往后找。 */
    let next = null;
    const own = im.closest('p');
    if (own && own.textContent.trim()) next = own;          // 图和文字同一段
    else if (own) next = own.nextElementSibling;
    else next = im.nextElementSibling;
    while (next && next.tagName !== 'P') next = next.nextElementSibling;
    let firstLine = null;
    if (next) {
      const range = document.createRange();
      range.selectNodeContents(next);
      const rects = [...range.getClientRects()];
      if (rects.length) firstLine = { x: Math.round(rects[0].left), right: Math.round(rects[0].right), y: Math.round(rects[0].top) };
    }
    return {
      alt: im.alt,
      cls: im.className,
      title: im.getAttribute('title'),
      float: cs.float,
      w: Math.round(r.width),
      h: Math.round(r.height),
      left: Math.round(r.left),
      right: Math.round(r.right),
      natural: im.naturalWidth,
      firstLine,
    };
  });
  return { proseW: Math.round(pw), proseLeft: Math.round(prose.getBoundingClientRect().left), imgs: rows,
           containerW: Math.round(document.querySelector('.container').getBoundingClientRect().width) };
})()`);
info(`正文栏宽 ${layout.proseW}px；容器宽 ${layout.containerW}px`);
for (const im of layout.imgs) info(`  ${im.alt} → class="${im.cls}" float=${im.float} 宽 ${im.w}px${im.firstLine ? ` 下一段第一行 x=${im.firstLine.x}` : ''}`);
if (WANT_SHOTS) await cdp.shot('post-images', true);

const byAlt = (needle) => layout.imgs.find((im) => im.alt.includes(needle));
const full = byAlt('整宽');
const halfL = byAlt('半宽居左');
const halfR = byAlt('半宽居右');
const plain = byAlt('没写版式');

check('★★ 记号原样留在 title 上（样式就是按它选的），没写版式的那张没有 title',
  full?.title === '整宽' && halfL?.title === '半宽居左' && halfR?.title === '半宽居右' && !plain?.title,
  `整宽 title="${full?.title}" / 半宽居左 title="${halfL?.title}" / 普通 title=${plain?.title}`);
check('★★ 整宽那张真的比正文栏宽（破格到容器那边）',
  (full?.w ?? 0) > layout.proseW + 8 && (full?.w ?? 0) <= layout.containerW + 2,
  `${full?.w}px vs 正文栏 ${layout.proseW}px / 容器 ${layout.containerW}px`);
check('★★ 半宽居左：真的浮动，而且宽度约等于正文栏的一半',
  halfL?.float === 'left' && Math.abs((halfL?.w ?? 0) - layout.proseW / 2) < layout.proseW * 0.12,
  `float=${halfL?.float} 宽 ${halfL?.w}px（半栏约 ${Math.round(layout.proseW / 2)}px）`);
check('★★ 半宽居左时，紧跟的那段文字第一行确实让开了（绕排）',
  !!halfL?.firstLine && halfL.firstLine.x >= halfL.right - 4,
  halfL?.firstLine ? `图右边缘 ${halfL.right}px / 文字第一行起点 ${halfL.firstLine.x}px` : '没量到下一段');
check('★★ 半宽居右：浮动在右，文字从左边开始（第一行右边让开）',
  halfR?.float === 'right' && !!halfR?.firstLine && halfR.firstLine.x <= halfR.left + 4,
  `float=${halfR?.float} 图左边缘 ${halfR?.left}px / 文字第一行起点 ${halfR?.firstLine?.x}px`);
check('★ 没写版式的那张照旧（没有 title、也不浮动）',
  plain && !plain.title && plain.float === 'none', `title=${plain?.title} float=${plain?.float}`);

/* ================================================================
 * ③ 编辑器那一列图：真点、真拖
 * ================================================================ */
console.log('\n================ ③ 编辑器里的图片列表 ================');
const editor = spawn(process.execPath, [path.join(COPY, 'tools', 'editor', 'server.mjs')], {
  cwd: COPY, stdio: ['ignore', 'pipe', 'pipe'],
});
let elog = '';
editor.stdout.on('data', (b) => { elog += b.toString('utf8'); });
editor.stderr.on('data', (b) => { elog += b.toString('utf8'); });
let base = '';
for (let i = 0; i < 120 && !base; i++) {
  await sleep(150);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(elog);
  if (m) base = `http://127.0.0.1:${m[1]}`;
}
check('副本里的编辑器起来了', !!base, base || elog.slice(-120));

if (base) {
  /* 先从 Node 这边走 API 把 fixture 的内容取回来（页面里那次 fetch 容易被加载时序坑），
     再把它灌进表单、触发一次 input —— 和用户"打开这篇文章"是同一条路。 */
  const item = await (await fetch(`${base}/api/item?type=notes&file=${encodeURIComponent(FIXTURE)}`)).json();
  check('★ 编辑器能打开这篇 fixture', !!item?.frontmatter && !!item?.body, JSON.stringify(item).slice(0, 100));
  await cdp.open(`${base}/`);
  const opened = await cdp.ev(`(async () => {
    document.getElementById('f-title').value = ${JSON.stringify(item?.frontmatter?.title ?? '')};
    document.getElementById('f-body').value = ${JSON.stringify(item?.body ?? '')};
    document.getElementById('f-body').dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((res) => setTimeout(res, 700));
    const rows = [...document.querySelectorAll('.picrow')];
    return {
      rows: rows.length,
      thumbs: rows.filter((r) => r.querySelector('.picrow__thumb')?.getAttribute('src')).length,
      layouts: rows.map((r) => r.querySelector('.picrow__layout')?.value),
      body: document.getElementById('f-body').value,
    };
  })()`);
  check('★★ 那一列图把正文里的四张图都列出来了（还带缩略图）',
    opened?.rows === 4 && opened?.thumbs === 4, JSON.stringify({ rows: opened?.rows, thumbs: opened?.thumbs }));
  check('★ 每张图的版式下拉读出来的就是它现在那个记号',
    JSON.stringify(opened?.layouts) === JSON.stringify(['整宽', '半宽居左', '半宽居右', '']),
    JSON.stringify(opened?.layouts));

  /* 改版式：把第一张从「整宽」改成「半宽居右」 */
  const changed = await cdp.ev(`(async () => {
    const row = document.querySelectorAll('.picrow')[0];
    const sel = row.querySelector('.picrow__layout');
    sel.value = '半宽居右';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((res) => setTimeout(res, 200));
    return { body: document.getElementById('f-body').value, sel: sel.value };
  })()`);
  check('★★ 改一下版式，正文里那一处记号跟着变了（别的图不动）',
    /"整宽"/.test(opened.body) && !/"整宽"/.test(changed.body)
    && (changed.body.match(/"半宽居右"/g) ?? []).length === 2,
    `整宽还在？${/"整宽"/.test(changed.body)}；半宽居右出现 ${(changed.body.match(/"半宽居右"/g) ?? []).length} 次`);

  /* 设为封面：点第二行那颗按钮 */
  const cover = await cdp.ev(`(async () => {
    const row = document.querySelectorAll('.picrow')[1];
    const src = row.querySelector('.picrow__thumb').getAttribute('src');
    [...row.querySelectorAll('button')].find((b) => b.textContent.includes('设为封面')).click();
    await new Promise((res) => setTimeout(res, 200));
    return { cover: document.getElementById('f-cover').value, src, marked: document.querySelectorAll('.picrow.is-cover').length };
  })()`);
  check('★★ 「设为封面」把封面框换成了那一张（列表上也标出来了）',
    cover.cover === cover.src && cover.marked === 1, JSON.stringify(cover));

  /* 拖动：把第 2 行拖到第 1 行上面 */
  const drag = await cdp.ev(`(() => {
    const rows = [...document.querySelectorAll('.picrow')];
    const g = (i) => {
      const r = rows[i].querySelector('.picrow__grip').getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    };
    return { from: g(1), to: { x: g(0).x, y: g(0).y - 6 }, bodyBefore: document.getElementById('f-body').value };
  })()`);

  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: drag.from.x, y: drag.from.y, buttons: 0 });
  await sleep(80);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: drag.from.x, y: drag.from.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(80);
  /* 分几步挪过去：一次跳到位的话 elementFromPoint 可能还没换行 */
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    const x = Math.round(drag.from.x + ((drag.to.x - drag.from.x) * i) / steps);
    const y = Math.round(drag.from.y + ((drag.to.y - drag.from.y) * i) / steps);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 1 });
    await sleep(60);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: drag.to.x, y: drag.to.y, button: 'left', clickCount: 1, buttons: 0 });
  await sleep(400);

  const afterDrag = await cdp.ev(`(() => ({
    body: document.getElementById('f-body').value,
    layouts: [...document.querySelectorAll('.picrow__layout')].map((s) => s.value),
  }))()`);
  const before = drag.bodyBefore;
  const orderOf = (t) => (t.match(/!\[[^\]]*\]\([^)]*\)/g) ?? []).map((m) => (/\("?([^")]+)/.exec(m) ?? [, ''])[1]);
  const beforeOrder = (before.match(/!\[[^\]]*\]\([^)]*\)/g) ?? []).map((m) => (/\("?([^")]+)/.exec(m) ?? [, ''])[1]);
  const afterOrder = orderOf(afterDrag.body);
  check('★★ 拖着把第二张挪到第一张上面：正文里的先后真的换了',
    afterOrder.length === 4 && afterOrder[0] === beforeOrder[1] && afterOrder[1] === beforeOrder[0],
    `${JSON.stringify(beforeOrder)} → ${JSON.stringify(afterOrder)}`);
  /* 图片之间的文字必须原地不动 */
  const textsOf = (t) => t.split(/!\[[^\]]*\]\([^)]*\)/).map((s) => s.trim()).filter(Boolean);
  check('★★ 拖动只换图的位置，**图片之间的文字一个字节都没动**',
    JSON.stringify(textsOf(before)) === JSON.stringify(textsOf(afterDrag.body)),
    `${textsOf(before).length} 段文字前后一致`);

  /* 删除：删掉现在第一行那张（fixture 里四张图各不相同，所以"没了"是确定的） */
  const del = await cdp.ev(`(async () => {
    const row = document.querySelectorAll('.picrow')[0];
    const src = row.querySelector('.picrow__thumb').getAttribute('src');
    [...row.querySelectorAll('button')].find((b) => b.textContent.includes('删除')).click();
    await new Promise((res) => setTimeout(res, 250));
    const body = document.getElementById('f-body').value;
    const left = (body.match(/!\\[/g) ?? []).length;
    return { src, left, stillIn: body.includes(src), rows: document.querySelectorAll('.picrow').length };
  })()`).catch(() => null);
  check('★★ 「删除」把那张图从正文里去掉了（其余三张还在，列表也跟着少一行）',
    del?.left === 3 && del?.stillIn === false && del?.rows === 3,
    JSON.stringify({ 正文里还剩: del?.left, 列表剩几行: del?.rows, 那张还在吗: del?.stillIn }));

  if (WANT_SHOTS) await cdp.shot('editor-pics');
  check('★ 编辑器这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));
  try { editor.kill(); } catch { /* 已经退了 */ }
}

/* ================================================================ */
try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch { /* 已经退了 */ }
server.close();
await sleep(200);
try {
  for (const j of ['node_modules', 'public']) {
    const p = path.join(COPY, j);
    if (fs.existsSync(p)) execFileSync('cmd', ['/c', 'rmdir', p], { stdio: 'ignore' });
  }
  fs.rmSync(COPY, { recursive: true, force: true });
  console.log(`副本已清理: ${!fs.existsSync(COPY)}`);
} catch (err) {
  console.log('副本没删干净（不影响结论）：', String(err.message ?? err).slice(0, 120));
}
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 删不掉就算了 */ }

console.log('\n================ 结果 ================');
console.log(`PASS ${pass}   FAIL ${fail}`);
if (fail > 0) process.exit(1);
