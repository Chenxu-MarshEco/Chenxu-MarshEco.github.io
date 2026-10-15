/*
 * ============================================================================
 * 「侧边栏」块 + 文字里的「带小图标的行内条目」（2026-10-15）
 * ----------------------------------------------------------------------------
 * 站长发的参考图是 Minecraft wiki 那种：页面右边一条信息栏（左标题 + 右内容，
 * 还能是带图标的条目列表），以及正文里"文字旁边带一个小图标"的条目。
 * 原话：
 *   「在页面中可以添加侧边栏 …… 侧边栏存在于页面的右侧 可以自由编辑其分为几个格子
 *    格子里的内容表现形式类似于导航 但也可以上传文字或图片 也可以把文图挂为链接等
 *    侧边栏的高度应当可以自由编辑横跨哪几个板块 并且会根据高度自行调节适配」
 *   「可以在+文字的文字中插入类似导航条目的东西 重点是这个条目索引会带一个小图片
 *    在一旁 就像导航栏里的一样」
 *
 * 四段：
 *   ① 接线：块类型在并集 / 渲染 / cleanBlocks / 编辑器按钮表 / 位置选择器里都登记了
 *   ② 真产物：在一份副本里给某页装上侧边栏（4 种格子都用上）+ 一行内条目 → 构建
 *      → 真浏览器量：右栏、跨 N 块、标题/内容/图标/图都画出来了、行内图标和文字同一行
 *   ③ 窄屏：侧边栏掉到正文里、占满整宽（不挤在右边）
 *   ④ 存一次：走编辑器的保存接口，侧边栏和它的格子**一个都不许丢**（这类"静默吞块"
 *      是这个站最容易出的事故，必须钉住）
 *
 * 用法：node tools/checks/sidebar-check.mjs
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromePath } from './lib/chrome.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DST = path.join(SRC, '.tmp', 'sidebar-copy');
const PORT = 4433;
const DEBUG_PORT = 9381;
const CHROME = chromePath();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

/* ================================================================
 * ① 接线（不构建，纯源码）
 * ================================================================ */
console.log('================ ① 接线 ================');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const boardsTs = read('src/utils/boards.ts');
const pageContent = read('src/components/PageContent.astro');
const serverJs = read('tools/editor/server.mjs');
const appJs = read('tools/editor/ui/app.js');
const anchorsTs = read('src/utils/anchors.ts');

check('数据模型里登记了 sidebar 块（格子 + 跨几块）',
  /type: 'sidebar'; text\?: string; rows: SidebarRow\[\]; span\?: number/.test(boardsTs)
  && /export interface SidebarRow\b/.test(boardsTs) && /export interface SidebarItem\b/.test(boardsTs));
check('站点渲染：有侧边栏时给 .page 加 page--side，侧边栏渲染成 <aside class="pside">',
  /hasSide && 'page--side'/.test(pageContent) && /<aside class="pside"/.test(pageContent));
check('站点渲染：跨几块走 --pside-span（转成"最小高度 = 跨几块 × 6rem"）',
  /--pside-span: \$\{sideSpan\(side\)\}/.test(pageContent)
  && /min-height: calc\(var\(--pside-span/.test(pageContent)
  /* ⚠ 布局不能退回"往栅格里加一列"：auto-fill 会把窄图填进那一列（验收逮到过） */
  && !/grid-template-columns: repeat\(auto-fill, minmax\(min\(20rem, 100%\), 1fr\)\) minmax\(0, 18rem\)/.test(pageContent));
check('编辑器服务端放行 sidebar（cleanBlocks 里有这一支）',
  /if \(type === 'sidebar'\) \{/.test(serverJs) && /SIDEBAR_KINDS/.test(serverJs));
check('模版脱内容也认它（只留格子的类型 / 标题，内容丢掉 + 打空格子记号）',
  /case 'sidebar': \{/.test(serverJs) && /return withPlaceholder\(block\);/.test(serverJs));
check('编辑器按钮表里有「侧边栏」，格子编辑器也在',
  /\['sidebar', '侧边栏'/.test(appJs) && /function sidebarRowsEditor\(/.test(appJs));
check('刚加进来还没填格子时不会被"空块清理"删掉', /b\.type === 'sidebar' \|\|/.test(appJs));
check('位置选择器认得它（anchors 里那一条的名字）', /case 'sidebar': \{/.test(anchorsTs));
check('文字里的行内条目：站点认 ico: 前缀并输出小图标',
  /ICO_PREFIX/.test(pageContent) && /phover__ico/.test(pageContent)
  && /\.ptext :global\(\.phover__ico\)/.test(pageContent));
check('编辑器里有「＋ 行内条目（带小图）」这个入口',
  /＋ 行内条目（带小图）/.test(appJs) && /function inlineItemTool\(/.test(appJs));

/* ================================================================
 * ② 造副本：给一页装上侧边栏 + 行内条目，然后真构建
 * ================================================================ */
console.log('\n================ ② 副本 + 构建 ================');
if (fs.existsSync(DST)) {
  const j = path.join(DST, 'node_modules');
  if (fs.existsSync(j)) { try { execSync(`cmd /c rmdir "${j}"`, { stdio: 'ignore', windowsHide: true }); } catch { /* 不是 junction */ } }
  fs.rmSync(DST, { recursive: true, force: true });
}
fs.mkdirSync(DST, { recursive: true });
for (const item of ['src', 'tools', 'astro.config.mjs', 'package.json', 'tsconfig.json']) {
  fs.cpSync(path.join(SRC, item), path.join(DST, item), { recursive: true });
}
fs.cpSync(path.join(SRC, 'public'), path.join(DST, 'public'), {
  recursive: true,
  filter: (from) => !path.relative(path.join(SRC, 'public'), from).replace(/\\/g, '/').startsWith('img/opt'),
});
fs.mkdirSync(path.join(DST, 'public/img/opt'), { recursive: true });
fs.copyFileSync(path.join(SRC, 'public/img/opt/manifest.json'), path.join(DST, 'public/img/opt/manifest.json'));
execSync(`cmd /c mklink /J "${path.join(DST, 'node_modules')}" "${path.join(SRC, 'node_modules')}"`, { stdio: 'ignore', windowsHide: true });

/* 挑一张真图（侧边栏图片格 + 行内条目的小图标都用它） */
const uploads = fs.readdirSync(path.join(SRC, 'public/img/uploads')).filter((f) => /\.(png|webp|jpe?g)$/i.test(f));
const IMG = `/img/uploads/${uploads[0]}`;
info(`用的图：${IMG}`);

/* 找一页有内容的页（board 节点上有 page 数组的那种），把我们的块插到最前面 */
const boardsFile = path.join(DST, 'src/data/home-boards.json');
const tree = JSON.parse(fs.readFileSync(boardsFile, 'utf8'));
const allNodes = [];
const walk = (list) => {
  for (const n of list ?? []) {
    allNodes.push(n);
    walk(n.children);
    walk(n.boards);
  }
};
walk(tree.boards);
/*
  优先挂到「隰辰煦家」那一页（站长点的名）：它是真正的内容长页，块多，
  侧边栏"跨几个板块"在那种页面上才量得出意思；找不到就退而求其次，
  挑块最多的那一页（块太少的话跨 3 块跟跨 1 块看不出区别）。
*/
const pagish = allNodes.filter((n) => Array.isArray(n.page) && n.page.length > 0 && !n.external);
const host = pagish.find((n) => String(n.title || '').includes('隰辰煦家'))
  ?? pagish.slice().sort((a, b) => b.page.length - a.page.length)[0];
if (!host) {
  console.error('副本里没找到能装侧边栏的页面');
  process.exit(2);
}
info(`装到页面「${host.title || host.id}」上（它原来有 ${host.page.length} 块）`);

const SIDE_ROWS = [
  { id: 'chk-r1', kind: 'text', label: '类型', text: '验收用的**道具**' },
  { id: 'chk-r2', kind: 'link', label: '出处', text: '冰山图', href: '/iceberg' },
  { id: 'chk-r3', kind: 'image', label: '图标', src: IMG, alt: '验收图' },
  { id: 'chk-r4', kind: 'items', label: '道具池', items: [
    { id: 'chk-i1', text: '验收条目甲', image: IMG, href: '/iceberg' },
    { id: 'chk-i2', text: '验收条目乙', image: IMG },
  ] },
];
host.page = [
  { id: 'chk-side', type: 'sidebar', text: '验收侧边栏', rows: SIDE_ROWS, span: 3 },
  { id: 'chk-text', type: 'text', text: `验收段落：指一下${''}[[验收行内条目|ico:${IMG}|/iceberg]]看看小图标在不在文字旁边。` },
  ...host.page,
];
fs.writeFileSync(boardsFile, `${JSON.stringify(tree, null, 2)}\n`, 'utf8');

const built = spawn(process.execPath, [path.join(DST, 'node_modules/astro/bin/astro.mjs'), 'build'], {
  cwd: DST,
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let blog = '';
built.stdout.on('data', (d) => { blog += d; });
built.stderr.on('data', (d) => { blog += d; });
const builtOk = await new Promise((res) => built.on('close', (code) => res(code === 0)));
check('副本带侧边栏构建通过', builtOk, blog.split(/\r?\n/).filter((l) => /error|Error/.test(l)).slice(-2).join(' | '));
if (!builtOk) {
  console.log('\n================ 结果 ================');
  console.log(`PASS ${pass}   FAIL ${fail}`);
  process.exit(1);
}

/*
  页面地址：直接在产物里找**带我们那个块**的那一页（`id="blk-chk-side"`）。
  为什么不按数据推 URL：能装侧边栏的页面不止版块页（这次就落到了「铃忆的冰室日记」
  这种独立页上），地址规则不止一套 —— 扫产物最实在，也顺带验了"侧边栏也是锚点目标"。
*/
const HREF = (() => {
  const stack = [path.join(DST, 'dist')];
  while (stack.length) {
    const dir = stack.pop();
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '.prerender') stack.push(p); continue; }
      if (!e.name.endsWith('.html')) continue;
      if (fs.readFileSync(p, 'utf8').includes('id="blk-chk-side"')) {
        return `/${path.relative(path.join(DST, 'dist'), p).replace(/\\/g, '/').replace(/index\.html$/, '')}`;
      }
    }
  }
  return null;
})();
check('产物里找得到装了我们侧边栏的那一页（侧边栏也是锚点目标 id=blk-…）', Boolean(HREF), String(HREF));
info(`页面地址：${HREF}`);
if (!HREF) {
  console.log('\n================ 结果 ================');
  console.log(`PASS ${pass}   FAIL ${fail}`);
  process.exit(1);
}

/* ================================================================
 * ③ 真浏览器：右栏 / 跨块 / 格子内容 / 行内图标 / 窄屏
 * ================================================================ */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.gif': 'image/gif',
};
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
    const f = path.join(DST, 'dist', t);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream' });
      return fs.createReadStream(f).pipe(res);
    }
  }
  res.writeHead(404);
  res.end('404');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = path.join(process.env.TEMP ?? '.', `dsh-sidebar-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu',
  '--enable-unsafe-swiftshader', '--disable-breakpad', `--user-data-dir=${profile}`,
  `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });

let ws = null;
try {
  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* 等 */ }
  }
  if (!target) throw new Error('无头 Chrome 没起来');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
  });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
    if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails?.text).slice(0, 120));
  });
  const send = (method, params = {}) => {
    const n = ++id;
    ws.send(JSON.stringify({ id: n, method, params }));
    return new Promise((resolve, reject) => pending.set(n, { resolve, reject }));
  };
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} :: ${String(expr).slice(0, 80)}`);
    return r.result.value;
  };
  const goto = async (w, h, url) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 });
    await send('Page.navigate', { url });
    for (let i = 0; i < 150; i += 1) {
      await sleep(120);
      try {
        if ((await ev('document.readyState')) === 'complete') break;
      } catch { /* 还在导航 */ }
    }
    await sleep(700);
  };

  await send('Runtime.enable');
  await send('Page.enable');

  /* ---- 宽屏 ---- */
  await goto(1400, 950, `http://127.0.0.1:${PORT}${HREF}`);
  const wide = await ev(`(() => {
    const page = document.querySelector('.page');
    const side = document.querySelector('.pside');
    if (!page || !side) return { missing: true };
    const pr = page.getBoundingClientRect();
    const sr = side.getBoundingClientRect();
    const blocks = [...page.querySelectorAll(':scope > .pblock')];
    const br = blocks.map((b) => b.getBoundingClientRect());
    const rows = [...side.querySelectorAll('.pside__row')].map((r) => ({
      label: (r.querySelector('.pside__label')?.textContent || '').trim(),
      text: (r.querySelector('.pside__text')?.textContent || '').trim(),
      items: r.querySelectorAll('.pside__items .navblk__item').length,
      icons: r.querySelectorAll('.pside__items .navblk__ico').length,
      img: (() => { const i = r.querySelector('.pside__img'); return i ? Math.round(i.getBoundingClientRect().width) : 0; })(),
      link: (() => { const a = r.querySelector('.pside__link'); return a ? a.getAttribute('href') : ''; })(),
    }));
    const ico = document.querySelector('.ptext .phover__ico');
    const lab = document.querySelector('.ptext .phover__label');
    const ir = ico?.getBoundingClientRect();
    const lr = lab?.getBoundingClientRect();
    return {
      hasSideClass: page.classList.contains('page--side'),
      display: getComputedStyle(page).display,
      /* 布局是"正文让出右边距 + 侧边栏绝对定位贴在里面"，不是往栅格里加列 */
      position: getComputedStyle(side).position,
      sideW: Math.round(sr.width),
      minH: Math.round(parseFloat(getComputedStyle(side).minHeight) || 0),
      pagePadRight: Math.round(parseFloat(getComputedStyle(page).paddingRight) || 0),
      /* 它纵向到底盖住了几个块：拿正文第 1~3 块的底边比 */
      blockBottoms: br.slice(0, 3).map((r) => Math.round(r.bottom)),
      blockTops: br.slice(0, 3).map((r) => Math.round(r.top)),
      sideTop: Math.round(sr.top),
      sideBottom: Math.round(sr.bottom),
      sideLeft: Math.round(sr.left), sideRight: Math.round(sr.right), sideW: Math.round(sr.width),
      pageLeft: Math.round(pr.left), pageRight: Math.round(pr.right),
      firstBlockRight: br.length ? Math.round(Math.max(...br.map((r) => r.right))) : 0,
      rows,
      icoH: ir ? Math.round(ir.height * 10) / 10 : 0,
      labelFontPx: lab ? Math.round(parseFloat(getComputedStyle(lab).fontSize) * 10) / 10 : 0,
      sameLine: ir && lr ? Math.abs((ir.top + ir.height / 2) - (lr.top + lr.height / 2)) < lr.height * 0.6 : false,
      icoBeforeLabel: ir && lr ? ir.left < lr.left : false,
      labelHref: lab?.getAttribute('href') || (lab?.tagName === 'A' ? lab.href : ''),
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      /* 调试：谁伸进了侧边栏那一列 / 前 3 块长什么样 */
      wide: blocks.map((b, i) => ({ i, cls: b.className.replace(/pblock|astro-cid-\S+/g, '').trim(), top: Math.round(br[i].top), bottom: Math.round(br[i].bottom), right: Math.round(br[i].right), over: br[i].right > sr.left + 2 })).filter((x) => x.over || x.i < 3),
    };
  })()`);
  info(`宽屏：${JSON.stringify({ 右栏左缘: wide.sideLeft, 正文最右: wide.firstBlockRight, 跨行: wide.gridRow, 格子: wide.rows.map((r) => `${r.label}|${r.items}条`) })}`);
  info(`  [调试] ${JSON.stringify(wide.wide)}`);

  check('有侧边栏时 .page 上了 page--side，而且是栅格', wide.hasSideClass === true && wide.display === 'grid',
    `display=${wide.display}`);
  check('★ 侧边栏在**右侧那一列**（它的左缘在正文块的右边之外）',
    wide.sideLeft >= wide.firstBlockRight - 2, `侧边栏左缘 ${wide.sideLeft} vs 正文最右 ${wide.firstBlockRight}`);
  check('★ 它是"贴在那段右边距里"的（absolute + 正文让出 19.5rem）',
    wide.position === 'absolute' && wide.pagePadRight >= 300 && wide.sideW >= 260,
    JSON.stringify({ position: wide.position, 让出: wide.pagePadRight, 栏宽: wide.sideW }));
  check('★ 「跨 3 个板块」= 最小高度 3×6rem（内容更多就更高，自适应）',
    Math.abs(wide.minH - 3 * 96) <= 6, `${wide.minH}px`);
  /*
    光看 CSS 文本还不算数，再量一次"它和第 3 块的关系"：
    侧边栏是**贴着自己内容高**的（align-self: start，像参考图那个信息栏），所以它的底边
    一般落在第 3 块中间 —— 该成立的是「顶边和第 1 块齐、第 3 块的开头落在它纵向范围里」。
  */
  check('★ 它从正文顶端开始、纵向盖到了第 3 个板块（"跨 3 块"看得见）',
    wide.sideTop <= wide.blockTops[0] + 4 && wide.blockTops[2] < wide.sideBottom,
    `侧边栏 ${wide.sideTop}~${wide.sideBottom} vs 第1块顶 ${wide.blockTops[0]} / 第3块顶 ${wide.blockTops[2]}`);
  check('★ 四格都画出来了，标题各就各位',
    wide.rows.length === 4 && wide.rows.map((r) => r.label).join(',') === '类型,出处,图标,道具池',
    JSON.stringify(wide.rows.map((r) => r.label)));
  check('文字格渲染了文字（**粗体**按 Markdown 走了）', wide.rows[0].text.includes('验收用的') && wide.rows[0].text.includes('道具'), wide.rows[0].text);
  check('链接格是条真链接（点了跳 /iceberg）', wide.rows[1].link === '/iceberg', wide.rows[1].link);
  check('图片格真的加载出了图（量到宽度 > 0）', wide.rows[2].img > 40, `${wide.rows[2].img}px`);
  check('★ 条目列表格：两条条目、各带小图标（就是导航条目那个样子）',
    wide.rows[3].items === 2 && wide.rows[3].icons === 2, JSON.stringify(wide.rows[3]));
  check('★ 行内条目：文字旁边有小图标，而且和文字**同一行**、在文字左边',
    wide.icoH > 0 && wide.sameLine === true && wide.icoBeforeLabel === true,
    JSON.stringify({ 图标高: wide.icoH, 字号: wide.labelFontPx, 同一行: wide.sameLine, 在左边: wide.icoBeforeLabel }));
  check('★ 小图标是"跟字号走"的（约 1.15em）',
    Math.abs(wide.icoH - wide.labelFontPx * 1.15) < wide.labelFontPx * 0.2,
    `图标 ${wide.icoH}px / 字号 ${wide.labelFontPx}px`);
  check('行内条目带上了链接（点了跳 /iceberg）', /\/iceberg\/?$/.test(String(wide.labelHref)), String(wide.labelHref));
  check('宽屏没有横向溢出', wide.overflowX === false);

  /* ---- 窄屏 ---- */
  await goto(390, 844, `http://127.0.0.1:${PORT}${HREF}`);
  const narrow = await ev(`(() => {
    const page = document.querySelector('.page');
    const side = document.querySelector('.pside');
    if (!page || !side) return { missing: true };
    const pr = page.getBoundingClientRect();
    const sr = side.getBoundingClientRect();
    const ico = document.querySelector('.ptext .phover__ico');
    const ir = ico?.getBoundingClientRect();
    return {
      display: getComputedStyle(page).display,
      sideLeft: Math.round(sr.left), sideW: Math.round(sr.width), pageLeft: Math.round(pr.left), pageW: Math.round(pr.width),
      position: getComputedStyle(side).position,
      icoW: ir ? Math.round(ir.width) : 0,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  })()`);
  info(`窄屏：${JSON.stringify(narrow)}`);
  check('★ 窄屏（390）侧边栏掉到正文里、占满整宽（不再是右边那一栏）',
    narrow.sideLeft <= narrow.pageLeft + 4 && narrow.sideW >= narrow.pageW - 12,
    `侧边栏 ${narrow.sideLeft}w${narrow.sideW} vs 正文 ${narrow.pageLeft}w${narrow.pageW}`);
  check('窄屏也不吸顶（sticky 只在宽屏那一栏里用）', narrow.position !== 'sticky' || narrow.display !== 'grid', narrow.position);
  check('窄屏行内图标照旧在（而且没溢出）', narrow.icoW > 0 && narrow.overflowX === false, JSON.stringify({ 图标宽: narrow.icoW }));
  check('全程没有 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | ') || '干净');
} catch (err) {
  fail += 1;
  console.log(`FAIL  ★ 浏览器那一段自己炸了：${err?.message || err}`);
} finally {
  try { ws?.close(); } catch { /* 忽略 */ }
  try { chrome.kill(); } catch { /* 忽略 */ }
  server.close();
  await sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 占着就算了 */ }
}

/* ================================================================
 * ④ 存一次：侧边栏和格子一个都不许丢
 * ================================================================ */
console.log('\n================ ④ 编辑器存一次 ================');
{
  const editor = spawn(process.execPath, [path.join(DST, 'tools/editor/server.mjs')], { cwd: DST, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let elog = '';
  editor.stdout.on('data', (b) => { elog += b.toString('utf8'); });
  editor.stderr.on('data', (b) => { elog += b.toString('utf8'); });
  let base = '';
  for (let i = 0; i < 300 && !base; i += 1) {
    await sleep(150);
    const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(elog);
    if (m) base = `http://127.0.0.1:${m[1]}`;
  }
  if (!base) {
    check('副本里的编辑器起得来', false, elog.slice(-200));
  } else {
    const r = await fetch(`${base}/api/boards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ boards: tree.boards }),
    }).catch((e) => ({ status: 0, err: e }));
    const ok = r.status === 200;
    const saved = JSON.parse(fs.readFileSync(boardsFile, 'utf8'));
    const again = [];
    const walk2 = (list) => {
      for (const n of list ?? []) {
        again.push(n);
        walk2(n.children);
        walk2(n.boards);
      }
    };
    walk2(saved.boards);
    const host2 = again.find((n) => (n.page ?? []).some((b) => b.id === 'chk-side'));
    const side = host2?.page?.find((b) => b.id === 'chk-side');
    check('★ 保存成功（接口 200）', ok, `status=${r.status}`);
    check('★ 侧边栏没有在保存时被静默吞掉', Boolean(side), side ? '还在' : '没了！');
    check('★ 四格都在（类型 / 标题 / 内容字段一个不少）',
      (side?.rows ?? []).length === 4
      && side.rows[0].kind === 'text' && side.rows[0].label === '类型' && String(side.rows[0].text).includes('道具')
      && side.rows[1].kind === 'link' && side.rows[1].href === '/iceberg'
      && side.rows[2].kind === 'image' && side.rows[2].src === IMG,
      JSON.stringify((side?.rows ?? []).map((x) => `${x.kind}:${x.label}`)));
    check('★ 条目列表那格的两条（含图标 + 地址）也留住了',
      (side?.rows?.[3]?.items ?? []).length === 2
      && side.rows[3].items[0].image === IMG && side.rows[3].items[0].href === '/iceberg',
      JSON.stringify(side?.rows?.[3]?.items));
    check('跨几块（span）也留住了', Number(side?.span) === 3, String(side?.span));
  }
  try { editor.kill(); } catch { /* 忽略 */ }
}

console.log('\n================ 结果 ================');
console.log(`PASS ${pass}   FAIL ${fail}`);
if (fail > 0) process.exit(1);
