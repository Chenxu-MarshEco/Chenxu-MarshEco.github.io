/*
 * ============================================================================
 * 黎语堂管理页「下半截滚不到、没法编辑」的验收（2026-10-10）
 * ----------------------------------------------------------------------------
 * 用户原话：
 *   「黎语堂管理里很多地方根本无法进行编辑」——鼠标滚轮推不下去，版块 / 页面文案 /
 *   帖子管理 / 评论系统四块（都在下半截）根本够不着。
 *
 * 根因（已查实，不用再找别的解释）：
 *   这一页引用的 /style.css 是给**三栏编辑器**（ui/index.html）写的。那份第 74-88 行
 *   把 html / body 钉成 height:100% + overflow:hidden —— 三栏编辑器每一栏各自滚，
 *   所以外层绝对不能滚。liyutang.html 却**不是**三栏：它是 sticky 顶栏 + 一整篇往下排
 *   的文档（main 里依次六块 .wbox）。套上那条 overflow:hidden 之后，多出来的内容被
 *   body 直接裁掉，整页一个滚动条都没有 → 滚轮推不动 → 下半截编辑不了。
 *
 * 修法：在 liyutang.html 自己的 <style> 里（排在 <link rel="stylesheet"> 之后，所以
 *   压得过它）**只对 body.lytadmin** 把文档滚动还回来。主编辑器用的是 body 上别的类，
 *   天然碰不到 —— 这就是下面第 ⑥ 条回归要盯的事。
 *
 * 这一支量两件事：
 *   ① 真编辑器（4322）+ 真无头 Chrome（1280×900）打开 /liyutang-admin：
 *      页面比一屏长、真滚轮推得动、**推得到底**、底那一块 #lt-forum-box 进得了视口、
 *      顶栏 sticky 照旧粘在视口顶部、没有横向溢出；
 *   ② 回归：**同一次运行里**打开主编辑器 /，确认它照旧整页不滚，证明这条修改没波及三栏。
 *
 * ⚠⚠ 量"滚不滚得动"必须打**真滚轮**（CDP Input.dispatchMouseEvent → mouseWheel），
 *   **不能只用 window.scrollTo** —— 这是这一支最容易写错的地方，第一版就写错了：
 *     `overflow: hidden` 的盒子仍然是**滚动容器**，只是属于"用户滚不动"的那一种：
 *     脚本 scrollTo / scrollTop 照样动得起来，被挡住的是滚轮、触摸和滚动条。
 *     所以只断言 scrollTo，改之前也会全绿（第一版实测 scrollY=2881，全"通过"），
 *     而用户嘴里那句"无法进行编辑"一点都没测到。
 *   下面 ② 两条是**成对**的：先验真滚轮推得动，再验真滚轮能一直推到底。
 *
 * ⚠ 还有一个连带的坑（也是第一版量出来的）：共用 style.css 里
 *   `html, body { height: 100% }` 把 body 钉成一屏高，而 sticky 的约束矩形是
 *   它的**包含块** —— 于是顶栏只能在前 816px（900 - 顶栏高）里粘住，
 *   再往下就被 body 的底边带走（实测滚到底时 top = -2065，等于根本没粘住）。
 *   所以第 ④ 条同时是" sticky 有没有被 height:100% 弄坏"的体检。
 *
 * ⚠ 断言**不挂在** /api/liyutang 的数据上：数据读不到时页面顶多显示「读取失败」，
 *   #lt-forum-box 这些壳子是模板里写死的（ui/liyutang.html 第 284-308 行的
 *   <section class="wbox" id="...">），所以一定在。量的全是"滚不滚得动 / 结构在不在"。
 *
 * 用法：node tools/checks/editor-liyutang-scroll-check.mjs
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const SRC = String.raw`D:\曼沫砾总线\Chenxu-MarshEco.github.io`;
const HOST = '127.0.0.1';
/* 真编辑器固定的那个端口（server.mjs 第 76 行 PORT_START = 4322） */
const EDITOR_PORT = 4322;
const ADMIN = `http://${HOST}:${EDITOR_PORT}/liyutang-admin`;
const HOME = `http://${HOST}:${EDITOR_PORT}/`;
const DEBUG_PORT = 9470;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const VIEW = { width: 1280, height: 900 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

/* ---------------------------------------------------------------- 前置 */

if (!fs.existsSync(CHROME)) {
  console.log(`FAIL  无头 Chrome 不在：${CHROME}`);
  console.log('      别的验收脚本用的就是这个路径；装好 Playwright 的 chromium 再跑。');
  process.exit(1);
}
const uiFiles = ['ui/liyutang.html', 'ui/index.html', 'ui/style.css'].map((f) =>
  path.join(SRC, 'tools', 'editor', f)
);
for (const f of uiFiles) {
  if (!fs.existsSync(f)) {
    console.log(`FAIL  编辑器界面文件不在：${f}`);
    process.exit(1);
  }
}
const adminHtml = fs.readFileSync(uiFiles[0], 'utf8');
const sharedCss = fs.readFileSync(uiFiles[2], 'utf8');
check('模板里 #lt-forum-box 是写死的（所以数据读不到也一定在）', /id="lt-forum-box"/.test(adminHtml));
/* 共用样式那条"钉死一屏"的本意是给三栏编辑器的，不能为了让这一页滚得动就把共用文件改掉 */
check('共用 style.css 里那条 overflow: hidden 还在（没去改共用文件）',
  /html,\s*\nbody\s*\{\s*\n\s*height:\s*100%;/.test(sharedCss) && /overflow:\s*hidden;/.test(sharedCss));
/* 压过它的那几条必须挂在 body.lytadmin 上，不然会连主编辑器一起改掉。
   ⚠ 挑规则之前必须先剥掉两类注释，少剥一层就会挑出**假规则**：
   ① HTML 注释：文件开头那段注释里就写着「写在下面的 <style> 里」，
      直接 lastIndexOf('<style>') 会命中**注释里的那一个**，从这里切下去就全乱了；
   ② CSS 注释：样式块里的注释写着 "html, body { height: 100% }" 这些**带花括号**的例子，
      不抠掉的话按 { 切选择器会切出一堆注释里的字（第一版就是这么假绿的）。 */
{
  const htmlBare = adminHtml.replace(/<!--[\s\S]*?-->/g, '');
  const styleBlock = /<style>([\s\S]*?)<\/style>/.exec(htmlBare);
  const own = (styleBlock ? styleBlock[1] : '').replace(/\/\*[\s\S]*?\*\//g, '');
  const scoped = [...own.matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((sel) => !sel.startsWith('@') && /(^|[,\s>+~(])(html|body)(?![\w-])/.test(sel));
  check('这一页自己的样式块里，碰到 html/body 的规则全都挂在 body.lytadmin 上',
    !!styleBlock && scoped.length > 0 && scoped.every((sel) => sel.includes('.lytadmin')),
    scoped.join(' | ').slice(0, 160) || '（没找到这类规则）');
}

/* 起服务**之前**先探一眼 4322：被别的东西占着的话，下面测的就不是我起的这个，得说清楚 */
const probe = async (url, ms = 1500) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return { status: r.status, body: await r.text() };
  } catch {
    return { status: 0, body: '' };
  }
};
const before = await probe(ADMIN);
if (before.status) {
  console.log(`[!] 起服务之前 ${EDITOR_PORT} 上就已经有东西在应答（HTTP ${before.status}）。`);
  console.log('    多半是你自己开着的那个编辑器。这一趟测的就是它（同一份仓库文件），');
  console.log('    但「服务是我起的」这条不成立 —— 下面标记为「复用已在跑的」，不算通过也不算失败。');
}

/* ------------------------------------------------------- ① 真编辑器 */

console.log('\n=== ① 起真编辑器（4322） ===');
const editor = spawn('node', ['tools/editor/server.mjs'], { cwd: SRC, stdio: 'ignore' });

let admin = null;
for (let i = 0; i < 100 && !admin; i++) {
  await sleep(300);
  const r = await probe(ADMIN, 2000);
  /* 认出确实是这一页：应答里得有 .lytadmin（liyutang.html 的 body 类） */
  if (r.status === 200 && /lytadmin/.test(r.body)) admin = r;
}
if (!admin) {
  const last = await probe(ADMIN, 2000);
  check(
    `真编辑器起来了（${ADMIN} 给出了 liyutang-admin 那一页）`,
    false,
    `三十秒内没等到；最后一次探测 HTTP ${last.status}，正文开头 ${JSON.stringify(last.body.slice(0, 120))}`
  );
  info('常见原因：4322 被别的程序占着（server.mjs 会往后找端口，就不在 4322 了）、');
  info('node 不在 PATH 里、或 tools/editor/server.mjs 起不来（手动跑一遍看报错）。');
  try {
    execSync(`taskkill /pid ${editor.pid} /T /F`, { stdio: 'ignore' });
  } catch {
    /* 已退 */
  }
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(1);
}
check(`真编辑器起来了（${ADMIN} 给出了 liyutang-admin 那一页）`, true);
if (before.status) info('复用了 4322 上已在跑的那一个（不是我起的）');

/* ------------------------------------------------------- ② 无头 Chrome */

const profile = path.join(process.env.TEMP ?? '.', `dsh-lytscroll-${Date.now()}`);
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--no-sandbox',
    '--mute-audio',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
    '--disable-breakpad',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

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
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(String(m.params.exceptionDetails?.text).slice(0, 140));
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
  async wait(expr, ms = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try {
        if (await this.ev(expr)) return true;
      } catch {
        /* 页面还在换 */
      }
      await sleep(200);
    }
    return false;
  }
  async goto(url) {
    await this.send('Page.navigate', { url });
    for (let i = 0; i < 150; i++) {
      await sleep(100);
      try {
        if ((await this.ev('document.readyState')) === 'complete') return;
      } catch {
        /* 还在导航 */
      }
    }
  }
}

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://${HOST}:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {
      /* 等 Chrome 起来 */
    }
  }
  if (!target) throw new Error(`无头 Chrome 的调试端口 ${DEBUG_PORT} 起不来（/json/list 一直没应答）`);

  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: VIEW.width,
    height: VIEW.height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  /* =============================================== ③ 管理页：滚得动吗 */

  console.log('\n=== ② 黎语堂管理页（1280×900）：真滚轮推得动、推得到底、底那一块进得来 ===');
  await cdp.goto(ADMIN);
  const painted = await cdp.wait(
    `document.body.classList.contains('lytadmin') && !!document.querySelector('#lt-forum-box') && !!document.querySelector('.lytadmin__top')`
  );
  check('页面画出来了（body.lytadmin + 顶栏 + #lt-forum-box 都在）', painted === true);

  await cdp.send('Page.bringToFront');
  /* 每次都从顶上、拿一个形状固定的快照，好前后对比 */
  const geom = () =>
    cdp.ev(`(() => {
      const se = document.scrollingElement || document.documentElement;
      const top = document.querySelector('.lytadmin__top').getBoundingClientRect();
      const forum = document.querySelector('#lt-forum-box').getBoundingClientRect();
      const cs = getComputedStyle(document.body);
      return {
        scrollY: Math.round(window.scrollY),
        maxScroll: se.scrollHeight - window.innerHeight,
        scrollHeight: se.scrollHeight,
        clientHeight: se.clientHeight,
        innerHeight: window.innerHeight,
        innerWidth: window.innerWidth,
        scrollWidth: se.scrollWidth,
        bodyOverflow: cs.overflow,
        bodyOverflowY: cs.overflowY,
        bodyHeight: cs.height,
        htmlHeight: getComputedStyle(document.documentElement).height,
        topTop: Math.round(top.top),
        topBottom: Math.round(top.bottom),
        topHeight: Math.round(top.height),
        forumTop: Math.round(forum.top),
        forumBottom: Math.round(forum.bottom),
      };
    })()`);

  /* ⚠ 打**真滚轮**：overflow:hidden 只挡用户输入，不挡脚本 scrollTo（见文件头那条）。 */
  const wheel = async (deltaY, times = 1) => {
    for (let i = 0; i < times; i++) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: Math.round(VIEW.width / 2),
        y: Math.round(VIEW.height / 2),
        deltaX: 0,
        deltaY,
        pointerType: 'mouse',
      });
      await sleep(90);
    }
    await sleep(450);
  };

  await cdp.ev(`window.scrollTo(0, 0)`);
  await wheel(0, 0);
  const g0 = await geom();
  info(
    `滚之前：scrollY=${g0.scrollY}  scrollHeight=${g0.scrollHeight}  innerHeight=${g0.innerHeight}  ` +
      `body.overflow=${g0.bodyOverflow} (overflow-y=${g0.bodyOverflowY})  body.height=${g0.bodyHeight}  ` +
      `html.height=${g0.htmlHeight}`
  );

  check(
    '① 页面内容本来就比一屏长（scrollHeight 明显大于 innerHeight）',
    g0.scrollHeight > g0.innerHeight + 100,
    `scrollHeight=${g0.scrollHeight}  innerHeight=${g0.innerHeight}  差=${g0.scrollHeight - g0.innerHeight}`
  );

  /* ---- ② 真滚轮推得动吗（这一条才是用户那句"无法进行编辑"） ---- */
  await wheel(600, 1);
  const g1 = await geom();
  const wheelWorks = g1.scrollY > 0;
  check(
    '② 真滚轮推得动（mouseWheel 之后 scrollY > 0）',
    wheelWorks,
    `scrollY=${g1.scrollY}（改之前这里会是 0：overflow:hidden 的盒子挡的就是滚轮）`
  );

  /* ---- ② 真滚轮能不能一直推到底 ---- */
  let gBottom = g1;
  if (wheelWorks) {
    let last = -1;
    let stall = 0;
    for (let i = 0; i < 40; i++) {
      stall = gBottom.scrollY === last ? stall + 1 : 0;
      last = gBottom.scrollY;
      if (stall >= 2) break;
      await wheel(600, 1);
      gBottom = await geom();
    }
  }
  check(
    '② 真滚轮能一直推到底（scrollY 到了 scrollHeight - innerHeight）',
    wheelWorks && gBottom.maxScroll > 0 && Math.abs(gBottom.scrollY - gBottom.maxScroll) <= 2,
    wheelWorks
      ? `scrollY=${gBottom.scrollY}  期望≈${gBottom.maxScroll}  差=${Math.abs(gBottom.scrollY - gBottom.maxScroll)}`
      : '滚轮推不动（见上一条），没法往下推'
  );

  /* ---- ② 任务书点名的那条：脚本 scrollTo 也要能到底（顺带把位置钉到底，好量下面几条） ---- */
  const after = await cdp.ev(`(() => {
      window.scrollTo(0, 99999);
      const se = document.scrollingElement || document.documentElement;
      const forum = document.querySelector('#lt-forum-box').getBoundingClientRect();
      const top = document.querySelector('.lytadmin__top').getBoundingClientRect();
      return {
        scrollY: window.scrollY,
        scrollHeight: se.scrollHeight,
        clientHeight: se.clientHeight,
        innerHeight: window.innerHeight,
        innerWidth: window.innerWidth,
        scrollWidth: se.scrollWidth,
        forumTop: forum.top,
        forumBottom: forum.bottom,
        topTop: top.top,
        topBottom: top.bottom,
        topHeight: top.height,
      };
    })()`);
  const maxScroll = after.scrollHeight - after.innerHeight;
  info(
    `滚到底：scrollY=${after.scrollY}  能滚的最大值=${maxScroll}  ` +
      `#lt-forum-box top=${Math.round(after.forumTop)} bottom=${Math.round(after.forumBottom)}  ` +
      `顶栏 top=${Math.round(after.topTop)}`
  );

  check(
    '② scrollTo(0, 99999) 之后 scrollY > 0（任务书那条）',
    after.scrollY > 0,
    `scrollY=${after.scrollY}`
  );
  check(
    '② 而且真的滚到了底（scrollY 接近 scrollHeight - innerHeight）',
    maxScroll > 0 && Math.abs(after.scrollY - maxScroll) <= 2,
    `scrollY=${after.scrollY}  期望≈${maxScroll}  差=${Math.abs(after.scrollY - maxScroll)}`
  );
  check(
    '③ 滚到底之后最下面那块 #lt-forum-box（评论系统）在视口里 —— 这就是"能编辑"',
    after.forumTop < after.innerHeight && after.forumBottom > 0,
    `top=${Math.round(after.forumTop)}  bottom=${Math.round(after.forumBottom)}  innerHeight=${after.innerHeight}`
  );
  check(
    '④ 顶栏 sticky 照旧粘在视口顶部（滚到底之后 top 仍在 0 附近、且看得见）',
    Math.abs(after.topTop) <= 2 && after.topHeight > 0 && after.topBottom > 0,
    `top=${Math.round(after.topTop)}  height=${Math.round(after.topHeight)}  bottom=${Math.round(after.topBottom)}`
  );
  check(
    '⑤ 这一页没有横向溢出',
    after.scrollWidth - after.innerWidth <= 1,
    `scrollWidth=${after.scrollWidth}  innerWidth=${after.innerWidth}  差=${after.scrollWidth - after.innerWidth}`
  );

  /* =============================================== ④ 回归：主编辑器 */

  console.log('\n=== ③ 回归：主编辑器 /（三栏）照旧整页不滚 ===');
  await cdp.goto(HOME);
  const homePainted = await cdp.wait(`document.readyState === 'complete' && !!document.body`);
  const home = await cdp.ev(`(() => {
      const se = document.scrollingElement || document.documentElement;
      const cs = getComputedStyle(document.body);
      window.scrollTo(0, 99999);
      return {
        overflow: cs.overflow,
        bodyHeight: cs.height,
        innerHeight: window.innerHeight,
        scrollY: window.scrollY,
        scrollHeight: se.scrollHeight,
        clientHeight: se.clientHeight,
        bodyClass: document.body.className,
      };
    })()`);
  info(
    `主编辑器：body.overflow=${home.overflow}  body.height=${home.bodyHeight}  ` +
      `innerHeight=${home.innerHeight}  scrollHeight=${home.scrollHeight}  scrollY=${home.scrollY}  ` +
      `body.class=${JSON.stringify(home.bodyClass)}`
  );
  /* 判据挑「body 的计算 overflow 是 hidden」：
     这就是 style.css 第 87 行那条、三栏编辑器赖以"各栏自己滚"的那一条。
     liyutang.html 的修改只写在 body.lytadmin 上，所以这里必须还是 hidden。 */
  check(
    '⑥ 回归：主编辑器 body 的计算 overflow 仍为 hidden（三栏那套没被波及）',
    homePainted === true && home.overflow === 'hidden',
    `overflow=${home.overflow}（期望 hidden）`
  );
  check(
    '⑥ 回归：主编辑器滚不动（scrollY 仍是 0）',
    home.scrollY === 0,
    `scrollY=${home.scrollY}  scrollHeight=${home.scrollHeight}  clientHeight=${home.clientHeight}`
  );

  check('这一趟没有未捕获的 JS 异常', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));
} catch (err) {
  fail++;
  console.log('FAIL  浏览器那一段异常: ' + (err?.stack ?? err));
} finally {
  try {
    execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' });
  } catch {
    /* 已退 */
  }
  try {
    execSync(`taskkill /pid ${editor.pid} /T /F`, { stdio: 'ignore' });
  } catch {
    /* 已退 */
  }
  await sleep(300);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
