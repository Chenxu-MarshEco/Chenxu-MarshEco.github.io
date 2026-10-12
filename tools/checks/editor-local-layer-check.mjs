/*
 * ============================================================================
 * 本机外观层 + 预览端口可配（协作者 Arcarlight 的补丁，2026-10-12）
 * ----------------------------------------------------------------------------
 * 补丁的卖点是「**默认零影响**」：没放那两份文件、没设那个环境变量时，行为
 * 与从前一模一样。这话不能只写在提交说明里 —— 这里逐条量死它：
 *
 *   A. 默认那一档（没有本机文件、没设环境变量）
 *      · 服务端吐出来的 index.html 与仓库里那份**逐字节相同**（比 sha256）
 *      · 页面里一个 `local-*` 引用都没有 → 真浏览器里**一个多余的请求都不发**
 *      · 那两条路由被人手敲也只是干净的 404，不会顺手把仓库里别的文件吐出来
 *
 *   B. 放上文件 + 设了端口那一档
 *      · 注入是**纯追加**的：把那几段抠掉之后与原文逐字节相同，且正好贴在 </body> 前
 *      · 真浏览器里它们真的**生效**了（读 CSS 自定义属性 / 模块设的全局变量）
 *      · 图标按名字发得出去（含 `imageUrl` 这种驼峰名）；发不出去的
 *        （不存在 / 名字不合法 / 想跳目录）一律 404 —— **绝不吐仓库里别的文件**
 *      · 把那两份文件删掉之后，**同一条进程**立刻回到 A 的样子（这层是按请求判定的）
 *
 *   C. 预览端口
 *      · app.js / liyutang.js 里不再有写死的 4321，读的是同一个全局
 *      · 注入的号与编辑器自己的端口**互不干扰**（编辑器跑在 4342、号是 4343）
 *      · 启动器 studio.py 读同一个环境变量：默认时命令行与从前**逐字相同**，
 *        设了才显式 --port（astro dev 撞端口会自己往后挪，不显式钉住就白配了）
 *
 *   D. 那两份本机文件确实进不了仓库（git 自己说它们被忽略了）
 *
 * ⚠ 这台机器上如果**本来就有**本机外观层（改外观的那个人就是有）：脚本会先把它整份
 *   备份到 `.tmp/local-layer-backup-<时间戳>/`、跑完**原样放回**并核对字节 —— 不用你手动挪走
 *   （2026-10-12：协作者那边复验时正是这种情况，原来那版是直接拒绝跑）。
 *   临时文件绝不留在盘上改掉别人的外观。
 *
 * 浏览器路径不再写死：见 tools/checks/lib/chrome.mjs（环境变量 DSH_CHROME，或自动找
 * Playwright / Chrome / Edge），所以协作者机器上也能跑。
 *
 * 用法：node tools/checks/editor-local-layer-check.mjs
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromePath } from './lib/chrome.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = path.join(SRC, 'tools', 'editor', 'server.mjs');
const UI = path.join(SRC, 'tools', 'editor', 'ui');
const HTML = path.join(UI, 'index.html');
const STUDIO_DIR = path.join(SRC, 'tools', 'studio');
const CSS_FILE = path.join(SRC, 'tools', 'editor', 'local-style.css');
const ICON_DIR = path.join(SRC, 'tools', 'editor', 'local-icons');
const APPLY_FILE = path.join(ICON_DIR, 'apply-icons.js');
const PNG_FILE = path.join(ICON_DIR, 'icon-imageUrl.png');
const CHROME = chromePath();

const PORT = 4341; // A 档：默认端口 + 没有本机文件
const PORT2 = 4342; // B 档：编辑器自己的端口（故意与预览端口不同）
const PREVIEW_PORT = 4343; // B 档：EDITOR_PREVIEW_PORT
const DEBUG_PORT = 9421;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);

/** 一个目录的内容指纹（相对路径 + 内容）—— 用来核对"备份放回后一个字节没变" */
function dirDigest(dir) {
  const walk = (d, base = '') => {
    const out = [];
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const e of entries.sort((x, y) => x.name.localeCompare(y.name))) {
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...walk(path.join(d, e.name), rel));
      else out.push(`${rel}:${sha(fs.readFileSync(path.join(d, e.name)))}`);
    }
    return out;
  };
  return crypto.createHash('sha256').update(walk(dir).join('\n')).digest('hex').slice(0, 16);
}

/** 一个 1×1 的透明 PNG —— 只用来量「原样发回来没有」，画的是什么无所谓 */
const PNG_STUB = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);
const CSS_STUB = '/* 本机外观层（测试用，跑完会删） */\n:root { --dsh-local-layer-probe: 1; }\n';
const APPLY_STUB = '/* 本机图标挂载（测试用，跑完会删） */\nwindow.__DSH_LOCAL_ICONS_RAN__ = true;\n';

const htmlBefore = fs.readFileSync(HTML);

/*
  这台机器上**本来就有**本机外观层怎么办？
  （谁就是那个改外观的人，谁就有 —— 协作者那边跑这个脚本时正是这种情况。）
  这个脚本必须在同一组路径上放自己的临时文件，才量得出「放了文件会怎样」。

  以前是发现有就直接拒绝跑，让人"先自己挪走再跑" —— 太不友好，而且手动挪走、
  手动放回的中间崩一次，人家那份外观就丢了。现在改成**整份备份 + 原样放回**：
  备份到 `.tmp/local-layer-backup-<时间戳>/`，跑完写回去，并核对字节一致（最后有一条断言）。
*/
const backupDir = path.join(SRC, '.tmp', `local-layer-backup-${Date.now()}`);
const hadCss = fs.existsSync(CSS_FILE);
const hadIcons = fs.existsSync(ICON_DIR);
const backupCss = hadCss ? fs.readFileSync(CSS_FILE) : null;
if (hadCss || hadIcons) {
  fs.mkdirSync(backupDir, { recursive: true });
  if (hadCss) fs.copyFileSync(CSS_FILE, path.join(backupDir, 'local-style.css'));
  if (hadIcons) fs.cpSync(ICON_DIR, path.join(backupDir, 'local-icons'), { recursive: true });
  if (hadCss) fs.rmSync(CSS_FILE, { force: true });
  if (hadIcons) fs.rmSync(ICON_DIR, { recursive: true, force: true });
}

/** 发一个 GET，把状态、头、原始字节都拿回来 */
const get = (port, pathname) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });

const spawnEditor = (port, previewPort) =>
  spawn(process.execPath, [SERVER, '--port', String(port)], {
    cwd: SRC,
    stdio: 'ignore',
    // 空串 = 「这一档没设」：两种写法（没这个变量 / 是空的）都该退回默认 4321
    env: { ...process.env, EDITOR_PREVIEW_PORT: previewPort },
  });

const waitUp = async (port) => {
  for (let i = 0; i < 60; i += 1) {
    await sleep(400);
    try {
      if ((await get(port, '/')).status === 200) return true;
    } catch {
      /* 还没起来 */
    }
  }
  return false;
};

/** 那三段注入拼起来的样子（跟 server.mjs 里 parts.join('\n  ') + '\n  ' 一致） */
const injectedParts = (port) =>
  [
    `<script>window.__DSH_PREVIEW_PORT__ = ${port};</script>`,
    '<link rel="stylesheet" href="/local-style.css">',
    '<script type="module" src="/local-icons/apply-icons.js"></script>',
  ].join('\n  ') + '\n  ';

let a = null;
let b = null;
let chrome = null;
let profile = '';
let ws = null;

/* ---- 真浏览器：一次拉起、两次导航，省掉一次冷启动 ---- */
const launchChrome = async () => {
  profile = path.join(process.env.TEMP ?? '.', `dsh-locallayer-${Date.now()}`);
  chrome = spawn(
    CHROME,
    ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--mute-audio', '--disable-breakpad',
      '--window-size=1400,900', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
    { stdio: 'ignore' },
  );
  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {
      /* 等 */
    }
  }
  if (!target) throw new Error('无头 Chrome 没起来');
  let id = 0;
  const pending = new Map();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  });
  const send = (method, params = {}) => {
    const n = ++id;
    ws.send(JSON.stringify({ id: n, method, params }));
    return new Promise((resolve, reject) => pending.set(n, { resolve, reject }));
  };
  await send('Runtime.enable');
  await send('Page.enable');
  return {
    send,
    ev: async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} :: ${String(expr).slice(0, 80)}`);
      return r.result.value;
    },
    browse: async (url) => {
      await send('Page.navigate', { url });
      for (let i = 0; i < 150; i += 1) {
        await sleep(120);
        try {
          if ((await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true })).result.value === 'complete') break;
        } catch {
          /* 还在导航 */
        }
      }
      await sleep(1800);
    },
  };
};

/** 浏览器眼里那两份本机东西的状态 */
const PROBE = `(() => {
  const perf = performance.getEntriesByType('resource');
  const local = perf.filter((e) => String(e.name).includes('local-'));
  return {
    port: window.__DSH_PREVIEW_PORT__ === undefined ? null : window.__DSH_PREVIEW_PORT__,
    probe: getComputedStyle(document.documentElement).getPropertyValue('--dsh-local-layer-probe').trim(),
    iconsRan: window.__DSH_LOCAL_ICONS_RAN__ === true,
    linkTag: !!document.querySelector('link[href="/local-style.css"]'),
    scriptTag: !!document.querySelector('script[src="/local-icons/apply-icons.js"]'),
    localReqs: local.map((e) => ({ name: String(e.name).replace(location.origin, ''), status: e.responseStatus ?? null })),
    badLocal: local.filter((e) => (e.responseStatus ?? 200) >= 400).length,
    count: local.length,
  };
})()`;

try {
  /* ======================================================================
     A 档：默认（没有本机文件、没设环境变量）—— 量「到底有没有影响」
     ====================================================================== */
  a = spawnEditor(PORT, '');
  if (!await waitUp(PORT)) throw new Error(`编辑器 ${PORT} 没起来`);
  info(`A 档编辑器起来了（127.0.0.1:${PORT}，没设 EDITOR_PREVIEW_PORT、盘上也没有本机文件）`);

  const aIndex = await get(PORT, '/');
  check('★ 默认这一档：服务端吐的 index.html 与仓库里那份**逐字节相同**',
    aIndex.buf.equals(htmlBefore),
    `仓库 ${htmlBefore.length}B/${sha(htmlBefore)}　服务端 ${aIndex.buf.length}B/${sha(aIndex.buf)}`);
  check('默认这一档：页面里不含预览端口的那段注入', !aIndex.buf.includes('__DSH_PREVIEW_PORT__'));
  check('默认这一档：页面里不引用本机外观层（没人会去请求它们）',
    !aIndex.buf.includes('local-style.css') && !aIndex.buf.includes('local-icons'));

  const aCss = await get(PORT, '/local-style.css');
  const aApply = await get(PORT, '/local-icons/apply-icons.js');
  const aIcon = await get(PORT, '/local-icons/icon-imageUrl.png');
  check('默认这一档：即使有人手敲 /local-style.css，也只是 404（不是 500、也不吐别的东西）',
    aCss.status === 404, `HTTP ${aCss.status}`);
  check('默认这一档：/local-icons/apply-icons.js 同样是 404', aApply.status === 404, `HTTP ${aApply.status}`);
  check('默认这一档：/local-icons/icon-*.png 是「这张本地图标不存在」的 404',
    aIcon.status === 404 && aIcon.buf.toString('utf8').includes('这张本地图标不存在'), `HTTP ${aIcon.status}`);

  const ui = await launchChrome();
  await ui.browse(`http://127.0.0.1:${PORT}/`);
  const pa = await ui.ev(PROBE);
  info(`浏览器里：preview 全局=${pa.port}，本机资源请求 ${pa.count} 个`);
  check('★ 默认这一档：真浏览器**一个** `local-*` 请求都没发（不多一个请求、不多一条 404）',
    pa.count === 0, JSON.stringify(pa.localReqs));
  check('默认这一档：页面上没有那段预览端口注入、也没有外观层的标签',
    pa.port === null && pa.probe === '' && !pa.linkTag && !pa.scriptTag,
    JSON.stringify({ port: pa.port, probe: pa.probe, link: pa.linkTag, script: pa.scriptTag }));

  /* ======================================================================
     B 档：放上两份本机文件 + 设 EDITOR_PREVIEW_PORT
     ====================================================================== */
  fs.writeFileSync(CSS_FILE, CSS_STUB, 'utf8');
  fs.mkdirSync(ICON_DIR, { recursive: true });
  fs.writeFileSync(APPLY_FILE, APPLY_STUB, 'utf8');
  fs.writeFileSync(PNG_FILE, PNG_STUB);
  info('临时放上了 local-style.css / local-icons/{apply-icons.js,icon-imageUrl.png}（跑完会删）');

  b = spawnEditor(PORT2, String(PREVIEW_PORT));
  if (!await waitUp(PORT2)) throw new Error(`编辑器 ${PORT2} 没起来`);

  const bIndex = await get(PORT2, '/');
  const bText = bIndex.buf.toString('utf8');
  const parts = injectedParts(PREVIEW_PORT);
  check('★ 设了端口之后：页面上注入了那个号，而且**编辑器自己的端口没被牵连**',
    bIndex.status === 200 && bText.includes(`<script>window.__DSH_PREVIEW_PORT__ = ${PREVIEW_PORT};</script>`),
    `编辑器在 ${PORT2}、注入的预览端口是 ${PREVIEW_PORT}`);
  check('放上文件之后：样式与图标脚本的标签都挂上了',
    bText.includes('<link rel="stylesheet" href="/local-style.css">') &&
    bText.includes('<script type="module" src="/local-icons/apply-icons.js"></script>'));
  const at = bText.indexOf(parts);
  check('★ 注入是**纯追加**的：把那几段抠掉之后与仓库里那份逐字节相同',
    at > 0 && bText.replace(parts, '') === htmlBefore.toString('utf8'),
    `注入块在偏移 ${at}`);
  check('注入的位置正好贴在 </body> 前面（不插在正文中间）',
    at > 0 && bText.slice(at + parts.length).startsWith('</body>'),
    JSON.stringify(bText.slice(at + parts.length, at + parts.length + 12)));

  const bCss = await get(PORT2, '/local-style.css');
  const bApply = await get(PORT2, '/local-icons/apply-icons.js');
  const bIcon = await get(PORT2, '/local-icons/icon-imageUrl.png');
  check('/local-style.css 按 text/css 原样发回来',
    bCss.status === 200 && String(bCss.headers['content-type']).startsWith('text/css') && bCss.buf.toString('utf8') === CSS_STUB,
    `HTTP ${bCss.status} ${bCss.headers['content-type']}`);
  check('/local-icons/apply-icons.js 按 text/javascript 原样发回来',
    bApply.status === 200 && String(bApply.headers['content-type']).startsWith('text/javascript') && bApply.buf.toString('utf8') === APPLY_STUB,
    `HTTP ${bApply.status} ${bApply.headers['content-type']}`);
  check('★ 图标按名字发得出去（含 imageUrl 这种驼峰名），字节一个不差',
    bIcon.status === 200 && String(bIcon.headers['content-type']) === 'image/png' && bIcon.buf.equals(PNG_STUB),
    `HTTP ${bIcon.status} ${bIcon.buf.length}B`);

  /*
    「排版」模式不是浏览器直连预览服务，是让服务端代理去取（跨源在服务端解决）。
    这条路上写的是 PREVIEW_ORIGINS —— 它也得跟着环境变量换，否则换了端口以后
    「预览」好了、「排版」还指着 4321。4343 上没东西，所以这里必然连不上，
    正好用那句报错把号读出来。
  */
  const bPrev = await get(PORT2, '/api/preview?path=/');
  const bPrevText = bPrev.buf.toString('utf8');
  check('★ 服务端代理预览（「排版」模式）也跟着换端口：报错里写的是新号，不是 4321',
    bPrev.status === 502 && bPrevText.includes(`（${PREVIEW_PORT}）`) && !bPrevText.includes('（4321）'),
    `HTTP ${bPrev.status} ${bPrevText.slice(0, 100)}`);

  /* 发不出去的：一律 404，而且**绝不能**吐仓库里别的文件 */
  const bad = [
    ['/local-icons/icon-nope.png', '名字合法但盘上没有'],
    ['/local-icons/icon-a.txt', '扩展名不是 .png'],
    ['/local-icons/icon-..png', '名字里带点'],
    ['/local-icons/../server.mjs', '想往上跳一层'],
    ['/local-icons/%2e%2e%2fserver.mjs', '编码过的跳目录'],
    ['/local-icons/sub/apply-icons.js', '想读子目录'],
    ['/local-style.css/../server.mjs', '合法前缀后面接跳目录'],
  ];
  const badResults = [];
  for (const [p, why] of bad) {
    const r = await get(PORT2, p);
    /* 判定标准是「没吐出源码」而不是只看状态码：/server.mjs 本来就不在白名单里 */
    const leaked = r.buf.toString('utf8').includes('EDITOR_CODE_FILES') || r.buf.includes(PNG_STUB);
    badResults.push({ p, why, status: r.status, leaked });
  }
  info(`七个坏地址：${badResults.map((r) => `${r.p}→${r.status}`).join('  ')}`);
  check('★ 七种「要不到」的地址全是 404，并且一个字节的仓库文件都没漏出去',
    badResults.every((r) => r.status === 404 && !r.leaked),
    JSON.stringify(badResults.filter((r) => r.status !== 404 || r.leaked)));

  /* ---- 真浏览器：那两份东西真的生效了吗 ---- */
  await ui.browse(`http://127.0.0.1:${PORT2}/`);
  const pb = await ui.ev(PROBE);
  info(`浏览器里：preview 全局=${pb.port}，本机资源 ${JSON.stringify(pb.localReqs)}`);
  check('★ 真浏览器里：预览端口那个全局被读到了（前端跟着换地址）', pb.port === PREVIEW_PORT, String(pb.port));
  check('★ 真浏览器里：local-style.css **真的生效了**（读得到它定义的自定义属性）',
    pb.probe === '1', JSON.stringify(pb.probe));
  check('★ 真浏览器里：local-icons/apply-icons.js **真的执行了**', pb.iconsRan === true, String(pb.iconsRan));
  check('★ 真浏览器里：这两份东西都是 200，没有一条 404',
    pb.count === 2 && pb.badLocal === 0, JSON.stringify(pb.localReqs));

  /* ---- 这层是按请求判定的：文件一删，同一条进程立刻回到默认样子 ---- */
  fs.rmSync(CSS_FILE, { force: true });
  fs.rmSync(ICON_DIR, { recursive: true, force: true });
  const cIndex = await get(PORT2, '/');
  const cText = cIndex.buf.toString('utf8');
  const cCss = await get(PORT2, '/local-style.css');
  check('★ 文件一删，**同一条进程**里页面立刻回到「只注入端口、不挂外观层」',
    cText.includes(`window.__DSH_PREVIEW_PORT__ = ${PREVIEW_PORT}`) &&
    !cText.includes('local-style.css') && !cText.includes('local-icons'),
    `css 标签还在？${cText.includes('local-style.css')}`);
  check('文件删掉之后 /local-style.css 又变回 404（而不是缓存住旧内容）',
    cCss.status === 404, `HTTP ${cCss.status}`);

  /* ======================================================================
     C 档：源代码层面的红线 + 启动器那一半
     ====================================================================== */
  const appJs = fs.readFileSync(path.join(UI, 'app.js'), 'utf8');
  const lyJs = fs.readFileSync(path.join(UI, 'liyutang.js'), 'utf8');
  const serverSrc = fs.readFileSync(SERVER, 'utf8');
  const studioSrc = fs.readFileSync(path.join(STUDIO_DIR, 'studio.py'), 'utf8');
  check('★ app.js / liyutang.js 里再没有写死的 `http://127.0.0.1:4321`',
    !appJs.includes("'http://127.0.0.1:4321'") && !lyJs.includes("'http://127.0.0.1:4321'"),
    `app.js=${appJs.includes("'http://127.0.0.1:4321'")} liyutang.js=${lyJs.includes("'http://127.0.0.1:4321'")}`);
  check('两边都从同一个全局读端口',
    appJs.includes('window.__DSH_PREVIEW_PORT__') && lyJs.includes('window.__DSH_PREVIEW_PORT__'));
  check('服务端读的是 EDITOR_PREVIEW_PORT', serverSrc.includes('EDITOR_PREVIEW_PORT'));
  check('启动器 studio.py 也读了同一个变量，两个 spawn 都走 dev_args',
    studioSrc.includes('EDITOR_PREVIEW_PORT') && (studioSrc.match(/dev_args\(self\.resolve\)/g) ?? []).length === 2,
    `dev_args 用了几处：${(studioSrc.match(/dev_args\(self\.resolve\)/g) ?? []).length}`);

  /* 启动器那一半：用真 python 起一次模块，看它拼出来的命令行 */
  const pyCode =
    "import json,studio;print('PY'+json.dumps({'port':studio.PREVIEW_PORT,'args':studio.dev_args(lambda x:x)},ensure_ascii=False))";
  const py = (v) => {
    for (const exe of ['python', 'py']) {
      const r = spawnSync(exe, ['-c', pyCode], {
        cwd: STUDIO_DIR,
        env: { ...process.env, EDITOR_PREVIEW_PORT: v },
        encoding: 'utf8',
      });
      if (!r.error) return r;
    }
    return null;
  };
  const pyDefault = py('');
  const pySet = py('4325');
  if (!pyDefault || !pySet) {
    info('这台机器上没有 python，启动器那一半只做了源码层面的检查（跳过两条）');
  } else {
    const read = (r) => {
      const line = String(r.stdout ?? '').split('\n').find((l) => l.startsWith('PY'));
      return line ? JSON.parse(line.slice(2)) : null;
    };
    const d = read(pyDefault);
    const s = read(pySet);
    check('★ 启动器默认档：命令行与从前**逐字相同**（不多一个 --port）',
      !!d && d.port === 4321 && JSON.stringify(d.args) === JSON.stringify(['pnpm', 'dev', '--host', '127.0.0.1']),
      JSON.stringify(d));
    check('★ 启动器设了变量之后：显式钉住端口（astro dev 撞端口会自己往后挪，不钉就白配）',
      !!s && s.port === 4325 && JSON.stringify(s.args) === JSON.stringify(['pnpm', 'dev', '--host', '127.0.0.1', '--port', '4325']),
      JSON.stringify(s));
  }

  /* ======================================================================
     D 档：这两份本机文件确实进不了仓库
     ====================================================================== */
  const gi = spawnSync('git', ['check-ignore', '-v', 'tools/editor/local-style.css', 'tools/editor/local-icons/apply-icons.js'], {
    cwd: SRC, encoding: 'utf8',
  });
  check('★ git 自己认为这两份本机文件是被忽略的（协作者不会把它们误提交上来）',
    gi.status === 0 && gi.stdout.includes('local-style.css') && gi.stdout.includes('local-icons'),
    String(gi.stdout ?? '').trim().split('\n').slice(0, 2).join(' | '));
} finally {
  /* ⚠ 必须删干净：留着的话站长（和别的协作者）的编辑器外观就被改了 */
  try { fs.rmSync(CSS_FILE, { force: true }); } catch { /* 忽略 */ }
  try { fs.rmSync(ICON_DIR, { recursive: true, force: true }); } catch { /* 忽略 */ }
  try { ws?.close(); } catch { /* 忽略 */ }
  try { chrome?.kill(); } catch { /* 忽略 */ }
  try { a?.kill(); } catch { /* 忽略 */ }
  try { b?.kill(); } catch { /* 忽略 */ }
  await sleep(800);
  /* 把跑之前备份的那份**人自己的**外观层放回去（备份目录留着，下面核对完再删） */
  try {
    if (hadCss) fs.writeFileSync(CSS_FILE, backupCss);
    if (hadIcons) fs.cpSync(path.join(backupDir, 'local-icons'), ICON_DIR, { recursive: true });
  } catch (err) {
    info(`⚠ 你原来那份外观层没放回去，备份还在：${backupDir}（${err?.message || err}）`);
  }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome 还占着就算了 */ }
}

/* ---- 收尾核对：仓库里那份 index.html 没被动过、本机外观层也清干净了 ---- */
check('跑完 index.html 一个字节没变（这个脚本从不改前端文件）',
  fs.readFileSync(HTML).equals(htmlBefore));
if (hadCss || hadIcons) {
  /* 这台机器本来就有人家自己那份：核对"原样放回" */
  const sameCss = !hadCss || (fs.existsSync(CSS_FILE) && fs.readFileSync(CSS_FILE).equals(backupCss));
  const sameIcons = !hadIcons || dirDigest(ICON_DIR) === dirDigest(path.join(backupDir, 'local-icons'));
  info(`这台机器上本来就有本机外观层（${hadCss ? 'local-style.css' : ''}${hadCss && hadIcons ? ' + ' : ''}${hadIcons ? 'local-icons/' : ''}），已原样放回`);
  check('★ 你原来那份本机外观层跑完还是原样（一个字节没动，不用你手动挪来挪去）',
    sameCss && sameIcons, sameCss && sameIcons ? '字节一致' : `放回不一致；备份留在 ${backupDir}`);
  if (sameCss && sameIcons) {
    try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch { /* 留着也不碍事 */ }
  }
} else {
  check('★ 收尾：临时放的那两份本机文件已经删掉（不留在站长机器上改外观）',
    !fs.existsSync(CSS_FILE) && !fs.existsSync(ICON_DIR));
}
const gitSt = spawnSync('git', ['status', '--porcelain'], { cwd: SRC, encoding: 'utf8' });
check('收尾：git 的待提交列表里没有本机外观层的影子',
  !String(gitSt.stdout ?? '').includes('local-style.css') && !String(gitSt.stdout ?? '').includes('local-icons'),
  String(gitSt.stdout ?? '').trim().split('\n').filter((l) => l.includes('local-')).join(' | ') || '干净');

console.log('\n================ 结果 ================');
console.log(`PASS ${pass}   FAIL ${fail}`);
if (fail > 0) process.exit(1);
