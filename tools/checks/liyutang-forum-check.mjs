/*
 * ============================================================================
 * 黎语堂论坛 + Twikoo 评论区的验收（2026-10-06）
 * ----------------------------------------------------------------------------
 * 量两件事：
 *   ① **构建产物**：论坛首页列出全部版块、每个版块页在、帖子页在、
 *      帖子页上真的挂了 Twikoo（本仓库那份 all 版 JS + CSS + envId 配置都对）
 *   ② **评论区在真浏览器里到底通不通**：开无头 Chromium 打开帖子页，等 Twikoo 初始化，
 *      看它有没有长出评论框、有没有报错（CORS / 匿名登录 / 云函数没建好 都会在这里现形），
 *      顺手把拿到的评论数、错误文案原样打出来。
 *      —— 这一步是替"腾讯云开发那套配置到底对不对"做体检，比人肉点开看快。
 *
 * 用法：node tools/checks/liyutang-forum-check.mjs [dist目录]
 * 说明：默认不重新构建（跑之前先 `node node_modules/astro/bin/astro.mjs build`）。
 *       加 --build 就先构建一次。
 * ============================================================================
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const SRC = String.raw`D:\曼沫砾总线\Chenxu-MarshEco.github.io`;
const ROOT = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(SRC, 'dist'));
const PORT = 4397;
const DEBUG_PORT = 9395;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

/* ---------------------------------------------------------------- ① 静态产物 */

if (process.argv.includes('--build')) {
  console.log('=== 先构建一次 ===');
  execSync('node tools/images/optimize.mjs', { cwd: SRC, stdio: 'ignore' });
  execSync('node node_modules/astro/bin/astro.mjs build', { cwd: SRC, stdio: 'ignore' });
  console.log('      构建完成');
}

const data = JSON.parse(fs.readFileSync(path.join(SRC, 'src', 'data', 'liyutang.json'), 'utf8'));
const boards = (data.boards ?? []).filter((b) => b && b.id && b.title);
const twikooCfg = data.forum?.twikoo ?? {};

console.log('\n=== ① 构建产物 ===');
info(`配置：provider=${data.forum?.provider} enabled=${data.forum?.enabled} envId=${twikooCfg.envId || '(空)'}`);
info(`版块：${boards.map((b) => `${b.icon || ''}${b.title}(${b.id})`).join(' / ') || '(没有)'}`);

const read = (rel) => {
  const f = path.join(ROOT, rel);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};

const home = read('liyutang/index.html');
check('论坛首页构建出来了', home.length > 0, `${Math.round(home.length / 1024)}KB`);
check(
  '首页把每个版块都列出来了（标题 + 帖子数）',
  boards.every((b) => home.includes(b.title) && home.includes(`/liyutang/${b.id}/`)),
  boards.map((b) => b.title).join(' / ')
);
/*
  2026-10-07 晚上：首页那段「留言不用注册、都要先审」的说明按用户要求整段删了，
  换成一句「发帖和留言都要登录；账号注册后要等站长过审」——当时断言跟着改成"页面上有这几个字"。
  2026-10-10 再改一次（**从数据现推**）：那句话现在是站长在编辑器里填的
  （`src/data/liyutang.json` 的 `copy.home.lead` / `copy.home.note`），
  而站长把这两格清空了（用户原话：「把我自己生造的那些介绍句子全删了」）——
  再写死"页面上必须有过审两个字"就必然假红。规矩本身没变，只是换成按数据判：
    · 站长填了 → 页面上就得看得见；
    · 留空   → 页面上一个字都不许有（这类句子**不许写死在代码里**，就是这个 refactor 的意义）。
*/
const copyHome = (() => {
  try {
    return JSON.parse(read(path.join('src', 'data', 'liyutang.json'))).copy?.home ?? {};
  } catch {
    return {};
  }
})();
/* ⚠ 源码要从 SRC 读，不能走上面那个 read()（它是按 ROOT=dist 拼的） */
const homeSrc = fs.readFileSync(path.join(SRC, 'src', 'pages', 'liyutang', 'index.astro'), 'utf8');
if (copyHome.lead || copyHome.note) {
  check('首页把站长填的那句「要登录 / 要过审」显示出来了（copy.home.lead / note）',
    (!!copyHome.lead && home.includes(copyHome.lead)) || (!!copyHome.note && home.includes(copyHome.note)),
    JSON.stringify(copyHome));
} else {
  check('首页没有把「要登录 / 要过审」这类句子写死在代码里（留空 = 不显示，文案归站长）',
    !/过审|审核/.test(home) && /data-lt-copy="home\.lead"/.test(homeSrc) && /data-lt-copy="home\.note"/.test(homeSrc));
}

/* 帖子文件：src/content/liyutang/<版块>/<帖子>.md */
const contentDir = path.join(SRC, 'src', 'content', 'liyutang');
const topics = [];
const walk = (dir, base = '') => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), rel);
    else if (e.name.endsWith('.md')) topics.push(rel.replace(/\.md$/, ''));
  }
};
walk(contentDir);
info(`帖子：${topics.join(' / ') || '(没有)'}`);

for (const t of topics) {
  const page = read(`liyutang/${t}/index.html`);
  check(`帖子页 /liyutang/${t}/ 构建出来了`, page.length > 0, `${Math.round(page.length / 1024)}KB`);
  if (!page) continue;
  check(`  · 挂了本站的 Twikoo 前端（all 版 JS + CSS）`,
    page.includes('/vendor/twikoo/twikoo.all.min.js') && page.includes('/vendor/twikoo/twikoo.css'),
    '');
  check(`  · 前端脚本用的是 all 版（腾讯云开发 SDK 在里面）`, /twikoo\.all\.min\.js/.test(page));
  check(`  · 页面里带着 envId 配置`, twikooCfg.envId ? page.includes(twikooCfg.envId) : false, twikooCfg.envId);
  check(`  · 评论区容器 #tcomment 在`, page.includes('id="tcomment"'));
}

for (const b of boards) {
  const page = read(`liyutang/${b.id}/index.html`);
  check(`版块页 /liyutang/${b.id}/ 构建出来了`, page.length > 0);
  check(`  · 「${b.title}」版块页挂着「自由讨论」留言线`, page.includes('id="tcomment"') && page.includes('自由讨论'));
}

check('Twikoo 前端文件确实在仓库里（不依赖国外 CDN）',
  fs.existsSync(path.join(SRC, 'public', 'vendor', 'twikoo', 'twikoo.all.min.js')) &&
    fs.existsSync(path.join(SRC, 'public', 'vendor', 'twikoo', 'twikoo.css')));
check('这些论坛页都标了 noindex（还没正式对外开放）',
  ['liyutang/index.html', ...topics.map((t) => `liyutang/${t}/index.html`)].every(
    (r) => /name="robots"[^>]*noindex/.test(read(r))
  ));
check('搜索索引里暂时没有它们（和 noindex 保持一致）', (() => {
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'search.json'), 'utf8'));
    return !idx.items.some((it) => it.h.replace(/\/$/, '').startsWith('/liyutang'));
  } catch {
    return true; /* 没有 search.json 就不判 */
  }
})());

/* ---------------------------------------------------------------- ② 真浏览器 */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
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

const profile = path.join(process.env.TEMP ?? '.', `dsh-lyt-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    this.failed = [];
    /* 评论区请求过的服务端地址（腾讯云开发那些域名），排查配置时最有用 */
    this.serverCalls = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
      if (m.method === 'Runtime.exceptionThrown') {
        this.errors.push(String(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text).slice(0, 200));
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
      }
      if (m.method === 'Network.loadingFailed') {
        this.failed.push(`${m.params.type} ${m.params.errorText}`);
      }
      /* 评论区到底在跟哪台服务器说话（腾讯云开发那几个域名）—— 排查时这条最有用 */
      if (m.method === 'Network.requestWillBeSent') {
        const u = String(m.params?.request?.url ?? '');
        if (/cloudbase|tcb|tencent|myqcloud/i.test(u)) this.serverCalls.push(u);
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
}

console.log('\n=== ② 评论区在真浏览器里通不通（这一步同时体检腾讯云开发那套配置）===');
try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {
      /* 等 */
    }
  }
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  const target0 = topics[0];
  const url = `http://127.0.0.1:${PORT}/liyutang/${target0}/`;
  cdp.errors = [];
  cdp.failed = [];
  cdp.serverCalls = [];
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 120; i++) {
    await sleep(120);
    if ((await cdp.ev('document.readyState')) === 'complete') break;
  }

  /* 等 Twikoo 长出东西来：先等库到位，再等它渲染 */
  let lib = false;
  for (let i = 0; i < 100 && !lib; i++) {
    await sleep(200);
    lib = await cdp.ev(`typeof window.twikoo === 'object' || typeof window.twikoo === 'function'`);
  }
  check('本站那份 twikoo.all.min.js 真的执行了（window.twikoo 有了）', lib === true, lib ? '' : '没等到');

  /* 读一次页面状态（两趟都用它：访客一趟、#admin 一趟） */
  const readState = `(() => {
      const box = document.getElementById('tcomment');
      const root = document.querySelector('.twikoo');
      const err = document.querySelector('.tk-error, .tk-error__title, .tk-error__detail');
      const txt = (box ? box.innerText : '').replace(/\\s+/g, ' ').trim();
      const authBox = document.querySelector('[data-lt-account]');
      return {
        hasRoot: !!root,
        inputs: document.querySelectorAll('#tcomment input, #tcomment textarea').length,
        buttons: document.querySelectorAll('#tcomment button').length,
        submit: !!document.querySelector('.tk-submit'),
        commentsTitle: (document.querySelector('.tk-comments-title') || {}).innerText || '',
        errorText: err ? err.innerText.replace(/\\s+/g, ' ').trim().slice(0, 300) : '',
        text: txt.slice(0, 300),
        boxHidden: box ? box.hasAttribute('hidden') : null,
        authState: authBox ? authBox.dataset.state || '(还没画出来)' : '(没有账号区)',
        authText: authBox ? (authBox.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 200) : '',
        tabs: [...document.querySelectorAll('[data-lt-account] .tkc__tab')].map((b) => b.textContent.trim()),
      };
    })()`;

  let state = null;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    state = await cdp.ev(readState);
    if (state?.errorText || state?.submit || (state?.authState && state.authState !== '(还没画出来)')) break;
  }

  info('页面上的评论区状态：' + JSON.stringify(state));
  if (cdp.errors.length) info('console 报错：' + cdp.errors.slice(0, 3).join(' | '));
  if (cdp.failed.length) info('加载失败的请求：' + [...new Set(cdp.failed)].slice(0, 5).join(' | '));
  if (cdp.serverCalls.length) {
    info('评论区请求过的服务端地址：' + [...new Set(cdp.serverCalls)].slice(0, 6).join('  |  '));
  }

  /*
    2026-10-07 起：评论区**默认藏着**，只露「登录 / 注册」——
    只有登录且过审的账号才看得见输入框（服务端还会再验一遍令牌）。
    所以这里断言的是"没登录的人看到什么"，而不是"输入框在不在"。
  */
  check('账号区画出来了（不是一直停在"正在看登录状态"）', state?.authState === 'guest', String(state?.authState));
  check('没登录时给的是「登录 / 注册」两个入口', (state?.tabs ?? []).join(',') === '登录,注册', JSON.stringify(state?.tabs));
  check('★ 没登录时评论区是**藏着的**（不是谁点开都能发）', state?.boxHidden === true, 'hidden=' + String(state?.boxHidden));
  check('没登录时 Twikoo 还没启动（不白拉评论，也不给发帖入口）', state?.hasRoot === false);
  info('账号区写了：' + String(state?.authText ?? '').slice(0, 120));
  check('页面上没有报错盒子', !state?.errorText, state?.errorText || '');
  if (state?.errorText) {
    info('⚠ 这是 Twikoo 自己报的错，照着它去查腾讯云开发那一侧（跨域白名单 / 匿名登录 / 云函数状态）');
  }
  check('这一趟没有未捕获的 JS 异常', cdp.errors.filter((e) => /Uncaught|TypeError|ReferenceError/.test(e)).length === 0,
    cdp.errors.slice(0, 2).join(' | '));

  /*
    ---- 第三趟：站长后门 #admin ----
    这条是 2026-10-07 线上真踩出来的：后门那段代码在 cfg 还没解析出来的时候就调了启动函数，
    于是「ReferenceError: cfg is not defined」—— 评论区露出来了，但 Twikoo 起不来。
    而**已过审的用户登录后走的是同一条路**（render('approved') → showComment() → startTwikoo()），
    所以这个 bug 不修的话，过审的人根本看不到输入框。留一趟在这里盯着它。

    ⚠ 只改 hash 的导航不会重新加载页面 —— 必须先跳 about:blank。
  */
  console.log('\n=== ③ 站长后门 #admin（顺带验证"登录之后能启动 Twikoo"那条路）===');
  cdp.errors = [];
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await sleep(500);
  await cdp.send('Page.navigate', { url: `${url}#admin` });
  for (let i = 0; i < 150; i++) {
    await sleep(120);
    if ((await cdp.ev('document.readyState')) === 'complete') break;
  }
  let adm = null;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    adm = await cdp.ev(readState);
    if (adm?.hasRoot || adm?.errorText) break;
  }
  info('#admin 状态：' + JSON.stringify({ boxHidden: adm?.boxHidden, hasRoot: adm?.hasRoot, inputs: adm?.inputs, err: adm?.errorText }));
  check('★ #admin 把评论区强制露出来了', adm?.boxHidden === false, 'hidden=' + String(adm?.boxHidden));
  check('★ Twikoo 真的启动了（这条就是那个 cfg bug 的哨兵）', adm?.hasRoot === true);
  check('输入框出来了（能发言）', (adm?.inputs ?? 0) > 0, `inputs=${adm?.inputs}`);
  check('#admin 这一趟没有 JS 报错', cdp.errors.filter((e) => /Uncaught|TypeError|ReferenceError/.test(e)).length === 0, cdp.errors.slice(0, 2).join(' | '));
} catch (err) {
  fail++;
  console.log('FAIL  浏览器那一段异常: ' + (err?.stack ?? err));
} finally {
  try {
    execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' });
  } catch {
    /* 已退 */
  }
  server.close();
  await sleep(200);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
