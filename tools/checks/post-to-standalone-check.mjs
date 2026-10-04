/*
 * ============================================================================
 * 文章能归类到「独立页面」下 —— 验收
 * ----------------------------------------------------------------------------
 * 用户 2026-09-29 报的：「注意到文章不能归类到独立页面下 修复一下」
 *
 * 原因（两处，都在编辑器的「所属子版块」那一块）：
 *   ① `loadSubs()` 只 walk 了 `board.children` —— **独立页面本身就是顶层节点、没有父级**，
 *      于是它压根不进清单，文章怎么都勾不到它（大板块本身同样漏了）；
 *   ② 保存时拿清单当白名单剔 subs：`state.subs.filter(s => valid.has(s))` ——
 *      就算手写进 frontmatter，编辑器一保存也会把这个归类**静默清掉**。
 * 站点的渲染侧本来就没问题（`articlesByNode` 不筛 standalone、`trailsOf` 也认），
 * 所以修的就是这两处。顺带加了一道闸：**清单拉空时一个都不剔**（接口挂了不该清空归类）。
 *
 * 这个脚本在副本里真跑一遍：
 *   ① 界面上「所属子版块」清单里**有**独立页面（meta 写着「独立页面」）、也有大板块；
 *   ② 勾上它 → 保存 → 盘上那篇文章的 frontmatter 里真有这个 id（以前会被剔掉）；
 *   ③ 拿这份数据真构建一次 → **那一页的产物里出现这篇文章**（归类真的生效了）；
 *   ④ 文章页的产物里出现指回那个独立页面的面包屑链接；
 *   ⑤ 源码里有那道"清单拉空就不剔"的闸。
 *
 * 用法：node tools/checks/post-to-standalone-check.mjs
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..');
const DST = path.join(SRC, '.tmp', 'solo-copy');
const DEBUG_PORT = 9464;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/* ================================================================
 * ⑤ 先看一眼源码里那两道修（便宜、快、一眼能定性）
 * ================================================================ */
console.log('================ ① 编辑器源码里那两处 ================');
const appJs = fs.readFileSync(path.join(SRC, 'tools/editor/ui/app.js'), 'utf8');
check('★ 顶层节点自己也进「所属子版块」清单（独立页面 = 顶层节点，以前整类漏掉）',
  /for \(const board of data\.boards \|\| \[\]\) \{[\s\S]{0,400}?flat\.push\(\{[\s\S]{0,200}?board: board\.standalone === true \? '独立页面' : '大板块'/.test(appJs));
check('★ 清单拉空时**一个都不剔**（接口挂了不该把文章的归类清空）',
  /const valid = new Set\(state\.allSubs\.map\(\(s\) => s\.id\)\);\s*\n\s*if \(valid\.size\) \{/.test(appJs));

/* ================================================================
 * 准备副本
 * ================================================================ */
console.log('\n================ 准备副本 ================');
if (fs.existsSync(DST)) {
  const j = path.join(DST, 'node_modules');
  if (fs.existsSync(j)) { try { execSync(`cmd /c rmdir "${j}"`, { stdio: 'ignore' }); } catch { /* 不是 junction */ } }
  fs.rmSync(DST, { recursive: true, force: true });
}
fs.mkdirSync(DST, { recursive: true });
for (const item of ['src', 'tools', 'astro.config.mjs', 'package.json', 'tsconfig.json']) {
  fs.cpSync(path.join(SRC, item), path.join(DST, item), { recursive: true });
}
/* public 整个拷过来（含 img/opt 变体）：这样副本里的构建只要几秒，不用重编四百张图 */
fs.cpSync(path.join(SRC, 'public'), path.join(DST, 'public'), { recursive: true });
execSync(`cmd /c mklink /J "${path.join(DST, 'node_modules')}" "${path.join(SRC, 'node_modules')}"`, { stdio: 'ignore' });
console.log('副本就绪：', DST);

const copyBoards = readJson(path.join(DST, 'src/data/home-boards.json'));
const tops = copyBoards.boards.map((b) => ({
  id: b.id,
  title: b.title,
  standalone: b.standalone === true,
  href: b.href || '',
}));
info('副本里的顶层节点：' + tops.map((t) => `${t.standalone ? '[独立页面]' : '[大板块]'}${t.title}`).join(' '));
const solos = tops.filter((t) => t.standalone);
check('副本里至少有一个独立页面可以试（没有就跳过后面那几条）', solos.length > 0, solos.map((s) => s.title).join('、'));

/* 挑一篇现成的文章来挂 */
const postsDir = path.join(DST, 'src/content/posts');
const postFile = fs.readdirSync(postsDir).find((f) => /\.md$/.test(f));
const postRaw = fs.readFileSync(path.join(postsDir, postFile), 'utf8');
const postTitle = (/title:\s*["']?([^"'\n]+)/.exec(postRaw)?.[1] ?? postFile).trim();
const postSlug = postFile.replace(/\.md$/, '');
const subsBefore = (/subs:\s*\[([^\]]*)\]/.exec(postRaw)?.[1] ?? '')
  .split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
info(`拿这篇来试：「${postTitle}」（${postFile}）· 现在挂的 subs=${JSON.stringify(subsBefore)}`);

/* ================================================================
 * 起编辑器 + 真浏览器
 * ================================================================ */
const editor = spawn(process.execPath, [path.join(DST, 'tools/editor/server.mjs')], {
  cwd: DST,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let elog = '';
editor.stdout.on('data', (b) => { elog += b.toString('utf8'); });
editor.stderr.on('data', (b) => { elog += b.toString('utf8'); });
let base = '';
for (let i = 0; i < 400 && !base; i++) {
  await sleep(150);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(elog);
  if (m) base = `http://127.0.0.1:${m[1]}`;
}
check('副本里的编辑器起来了', !!base, base || elog.slice(-160));

const profile = path.join(process.env.TEMP ?? '.', `dsh-solo-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu',
  '--enable-unsafe-swiftshader', '--disable-breakpad', '--window-size=1440,960',
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
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails?.exception?.description ?? '');
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
}
let cdp = null;
for (let i = 0; i < 80 && !cdp; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const p = list.find((t) => t.type === 'page');
    if (p) cdp = await CDP.attach(p.webSocketDebuggerUrl);
  } catch { /* 等 */ }
}
if (!cdp) {
  console.error('Chromium 没起来');
  process.exit(2);
}
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });

/* ================================================================
 * ② 界面上：打开一篇文章，看「所属子版块」清单
 * ================================================================ */
console.log('\n================ ② 界面上能不能勾到独立页面 ================');
let opened = null;
if (base) {
  await cdp.send('Page.navigate', { url: `${base}/` });
  for (let i = 0; i < 300; i++) { await sleep(100); if ((await cdp.ev('document.readyState')) === 'complete') break; }
  await sleep(1800);

  opened = await cdp.ev(`(async () => {
    /* 先等侧栏那篇文件出现再点它 */
    let li = null;
    for (let i = 0; i < 100; i++) {
      li = document.querySelector('li.doc[data-file=${JSON.stringify(postFile)}]');
      if (li) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!li) return { ok: false, why: '侧栏里找不到这篇文章', list: [...document.querySelectorAll('li.doc')].map((x) => x.dataset.file).slice(0, 8) };
    li.click();
    /*
      ⚠ 等**文章真的加载完**再动勾选框（第一版就是在这儿翻车的）：
      「所属子版块」那一块画得比文件加载早，那时候 state.subs 还是空的 ——
      抢在前面勾，等文件读回来会把整个 state.subs 覆盖掉，白勾。
      判据：标题框里已经是这篇文章的标题、而且原来挂着的 subs 已经勾上了。
    */
    const wantChecked = ${JSON.stringify(subsBefore)};
    for (let i = 0; i < 150; i++) {
      const t = document.getElementById('title');
      const box = document.getElementById('subs-box');
      const cbs = box ? [...box.querySelectorAll('input[data-sub-id]')] : [];
      const done = t && t.value.trim() === ${JSON.stringify(postTitle)} && cbs.length > 0 &&
        wantChecked.every((id) => (cbs.find((c) => c.dataset.subId === id) || {}).checked);
      if (done) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 250));
    const box = document.getElementById('subs-box');
    const items = [...(box ? box.querySelectorAll('.subpick__item') : [])].map((el) => ({
      id: (el.querySelector('input[data-sub-id]') || {}).dataset?.subId || '',
      label: ((el.querySelector('span') || {}).textContent || '').replace(/\\u3000/g, '').trim(),
      meta: ((el.querySelector('em') || {}).textContent || '').trim(),
      checked: !!(el.querySelector('input[data-sub-id]') || {}).checked,
    }));
    return { ok: true, count: items.length, items, title: (document.getElementById('title') || {}).value || '' };
  })()`);
  info('清单：' + JSON.stringify(opened).slice(0, 600));
  check('★ 「所属子版块」清单拉出来了', opened?.ok === true && opened.count > 0, JSON.stringify(opened?.why ?? opened?.count));
  if (opened?.ok) {
    const missing = tops.filter((t) => !opened.items.some((i) => i.id === t.id));
    check('★★ 每一个顶层节点都在清单里（独立页面 + 大板块，一个不漏）',
      missing.length === 0, missing.map((t) => `${t.standalone ? '独立页面' : '大板块'}${t.title}`).join('、') || `共 ${tops.length} 个都在`);
    const soloItems = opened.items.filter((i) => i.meta === '独立页面');
    check('★★ 独立页面在清单里标着「独立页面」（和子版块区分开）',
      soloItems.length === solos.length, `${soloItems.length} 个：` + soloItems.map((i) => i.label).join('、'));
    check('大板块在清单里标着「大板块」',
      opened.items.filter((i) => i.meta === '大板块').length === tops.filter((t) => !t.standalone).length,
      opened.items.filter((i) => i.meta === '大板块').map((i) => i.label).join('、'));
    info('子版块（没变的那些）：' + opened.items.filter((i) => i.meta !== '独立页面' && i.meta !== '大板块').map((i) => i.label).join('、'));
  }
}

/* ================================================================
 * ③ 勾上独立页面 → 保存 → 盘上真写进去了
 * ================================================================ */
console.log('\n================ ③ 勾上它、保存、看盘上 ================');
const target = solos[0];
if (base && opened?.ok && target) {
  const saved = await cdp.ev(`(async () => {
    const box = document.getElementById('subs-box');
    /* 按 id 精确找那一项（标签可能重名、也可能带缩进空格） */
    const cb = box.querySelector('input[data-sub-id=${JSON.stringify(target.id)}]');
    if (!cb) return { ok: false, why: '清单里找不到这个独立页面的勾选框', ids: [...box.querySelectorAll('input[data-sub-id]')].map((x) => x.dataset.subId) };
    if (!cb.checked) {
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 400));
    const btn = document.getElementById('btn-save');
    btn.click();
    /* 等保存真的跑完：按钮先被禁用、再恢复 */
    let sawDisabled = false;
    for (let i = 0; i < 300; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (btn.disabled) sawDisabled = true;
      else if (sawDisabled) break;
    }
    await new Promise((r) => setTimeout(r, 400));
    return { ok: true, checked: cb.checked, sawDisabled };
  })()`);
  info('勾选并保存：' + JSON.stringify(saved).slice(0, 300));
  await sleep(1200);

  const after = fs.readFileSync(path.join(postsDir, postFile), 'utf8');
  const subsAfter = (/subs:\s*\[([^\]]*)\]/.exec(after)?.[1] ?? '')
    .split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  info(`盘上现在的 subs：${JSON.stringify(subsAfter)}`);
  check('★★ 保存之后 frontmatter 里**真的有**那个独立页面的 id（以前会被静默剔掉）',
    subsAfter.includes(target.id), `${JSON.stringify(subsAfter)} 里有 ${target.id}`);
  check('★ 原来挂着的那几个没被剔掉（只加不减）',
    subsBefore.every((s) => subsAfter.includes(s)), `原来 ${JSON.stringify(subsBefore)}`);

  /* ================================================================
   * ④ 真构建：那一页的产物里出现这篇文章
   * ================================================================ */
  console.log('\n================ ④ 真构建：独立页面下真的有这篇文章 ================');
  const built = spawn(process.execPath, [path.join(SRC, 'node_modules/astro/bin/astro.mjs'), 'build'], {
    cwd: DST,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let bout = '';
  built.stdout.on('data', (d) => { bout += d; });
  built.stderr.on('data', (d) => { bout += d; });
  const ok = await new Promise((res) => built.on('close', (code) => res(code === 0)));
  check('副本构建成功', ok, bout.split(/\r?\n/).filter((l) => /error|Error/.test(l)).slice(-2).join(' | '));

  const href = String(target.href || '').replace(/\/+$/, '');
  const pageFile = path.join(DST, 'dist', href.replace(/^\//, ''), 'index.html');
  check(`独立页面「${target.title}」的产物在（${href}/）`, fs.existsSync(pageFile), href);
  if (fs.existsSync(pageFile)) {
    const html = fs.readFileSync(pageFile, 'utf8');
    const hasTitle = html.includes(postTitle);
    const hasLink = new RegExp(`/posts/${postSlug}/`).test(html);
    info(`产物 ${(html.length / 1024).toFixed(0)}KB；有文章标题=${hasTitle}；有指向文章页的链接=${hasLink}`);
    check('★★ 这一页的产物里**列出了这篇文章**（归类真的生效）', hasTitle, postTitle);
    check('★ 而且那一项是指向文章页的链接', hasLink, `/posts/${postSlug}/`);
    check('那一页不再显示「这一层还没有内容」',
      !/这一层还没有内容/.test(html) || hasTitle);
  }

  const postFile2 = path.join(DST, 'dist', 'posts', postSlug, 'index.html');
  if (fs.existsSync(postFile2)) {
    const html = fs.readFileSync(postFile2, 'utf8');
    const back = new RegExp(`href="${href}/?"`).test(html) || html.includes(href);
    info(`文章页里有没有指回独立页面的面包屑：${back}`);
    check('★ 文章页的产物里出现指回那个独立页面的面包屑链接', back, href);
  } else {
    info(`（找不到 /posts/${postSlug}/ 的产物，跳过面包屑那条）`);
  }

  check('编辑器这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));
} else {
  info('（没有可用的独立页面或清单没拉出来，跳过界面那几条）');
}

editor.kill();
try { await cdp.send('Browser.close'); } catch { /* ignore */ }
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* ignore */ }

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
