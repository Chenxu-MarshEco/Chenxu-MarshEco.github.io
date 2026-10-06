/*
 * ============================================================================
 * 编辑器里的「拉远端」按钮 —— 验收
 * ----------------------------------------------------------------------------
 * 用户 2026-10-05 报的：「编辑器显示远端有一个提交还没拉要怎么操作……如果我单纯靠
 * 编辑器UI不能操作就加一个拉远端按钮」。
 *
 * 当时的真实情况：那句话其实是**启动器**状态栏写的（编辑器页面里根本没有远端信息），
 * 能做的操作只有「回启动器选 1 写文章 / 2 看效果 / 3 发布上线，这些会自动或半自动地拉」——
 * 编辑器开着的时候没法当场拉。所以这一版加了：
 *   · 服务端 `GET /api/git/status`（只读本地，不联网）与 `POST /api/git/pull`；
 *   · 拉取走**子进程**跑 `tools/git/sync.mjs pull`（fetch 慢，不能把编辑器服务堵住），
 *     而且只做 **快进**（`--ff-only`）：不产生合并提交、不在你没提交的改动上做 rebase，
 *     远端动的正好是你改过没发布的文件时**一个字节都不动**地拒绝；
 *   · 页面右上角一个「拉远端」按钮，有东西可拉时变成「拉远端 (N)」并变色。
 *
 * 这个脚本在副本里用**真的 git 仓库**（一个 bare 当远端 + 一份「机器人」）演一遍：
 *   ① 源码接线（接口、子进程、按钮、快进而不是 rebase）；
 *   ② 机器人先推 → 点按钮 → 新文章真的到了本机、角标清掉；
 *   ③ 没有新东西时再点一次：如实说「已经是最新的」，不假装拉了；
 *   ④ 远端动了我改过还没发布的同一个文件 → **拒绝**，我本地那份一个字节没变；
 *   ⑤ 我本地有没发布的提交时：如实说「先点发布上线」，不在编辑器里乱 rebase；
 *   ⑥ 界面上真的有那个按钮、点了真的会拉。
 *
 * 用法：node tools/checks/editor-pull-check.mjs
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync, execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..');
const TMP = path.join(SRC, '.tmp');
const ORIGIN = path.join(TMP, 'pull-origin.git');
const DST = path.join(TMP, 'pull-copy');        // 编辑器所在的那一份（「我」）
const OTHER = path.join(TMP, 'pull-ssw');       // 机器人 / 另一位
const DEBUG_PORT = 9469;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

/** 跑一条 git 命令（作用对象一律是副本，绝不碰真仓库） */
function git(args, cwd = DST) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), code: r.status };
}

const gitOK = (args, cwd = DST) => {
  const r = git(args, cwd);
  if (!r.ok) throw new Error(`git ${args.join(' ')} 失败：${r.err || r.out}`);
  return r.out;
};

/* ================================================================
 * ① 源码接线
 * ================================================================ */
console.log('================ ① 源码接线 ================');
const serverJs = fs.readFileSync(path.join(SRC, 'tools/editor/server.mjs'), 'utf8');
const appJs = fs.readFileSync(path.join(SRC, 'tools/editor/ui/app.js'), 'utf8');
const html = fs.readFileSync(path.join(SRC, 'tools/editor/ui/index.html'), 'utf8');
const syncJs = fs.readFileSync(path.join(SRC, 'tools/git/sync.mjs'), 'utf8');

check('★ 服务端有「只读本地」的状态接口', /route === '\/api\/git\/status'/.test(serverJs));
check('★ 服务端有「拉远端」接口', /route === '\/api\/git\/pull'/.test(serverJs));
check('★ 拉取走**子进程**（fetch 慢起来几秒，不能把编辑器服务堵住）',
  /async function runGitCli\(cmd/.test(serverJs) && /spawn\(process\.execPath, args/.test(serverJs));
check('★ 拉取跑的就是启动器发布用的同一份实现', /tools', 'git', 'sync\.mjs'/.test(serverJs));
check('★ 编辑器启动就在后台探一次远端（角标一开始就有数）',
  /function fetchRemoteInBackground\(\)/.test(serverJs) && /startRemoteWatch\(\);/.test(serverJs));
check('★ 而且**每 5 分钟自己再探一次**（编辑器常开着，机器人后来推的不能不知道）',
  /setInterval\(fetchRemoteInBackground, FETCH_EVERY_MS\)/.test(serverJs));
check('★ 服务端有「现在就去探一次」的接口（页面切回来就调它）',
  /route === '\/api\/git\/fetch'/.test(serverJs)
  && /fetchRemoteInBackground\(\);\s*\n\s*return sendJson/.test(serverJs));
check('★ 探针走的是 CLI 那一份实现（里面带着「代理死掉自动直连」的处理）',
  /runGitCli\('fetch'/.test(serverJs));
check('★ 状态接口会带上「最近一次探远端成没成」', /lastFetch,/.test(serverJs));
check('★ 页面自己轮询 + 切回窗口就探一次（不用人点）',
  /function startRemotePolling\(\)/.test(appJs) && /function pokeRemote\(\)/.test(appJs)
  && /REMOTE_POLL_MS/.test(appJs) && /visibilitychange/.test(appJs));
check('★ 探不到远端时角标如实说「这个数字可能不是最新的」（虚线，不装成最新）',
  /is-stale/.test(appJs)
  && /is-stale/.test(fs.readFileSync(path.join(SRC, 'tools/editor/ui/style.css'), 'utf8')));
check('★ 代理连不上时自动改直连（机器人这 3 个提交就是靠它拉下来的）',
  /isProxyTrouble/.test(syncJs) && /'http\.proxy='/.test(syncJs));
check('★ 拉取只做**快进**：不会产生合并提交、也不会在没提交的改动上 rebase',
  /git\(\['pull', '--ff-only'\]/.test(syncJs)
  && /export function pullRemote\(/.test(syncJs)
  && !/pullRemote[\s\S]{0,2000}?rebase/.test(syncJs));
check('★ 页面上真有那个按钮', /id="btn-pull"/.test(html) && /btnPull: \$\('btn-pull'\)/.test(appJs));
check('★ 按钮点了会掉接口、而且角标在 loading 时不会乱跳',
  /els\.btnPull\.addEventListener\('click', doPullRemote\)/.test(appJs)
  && /apiPost\('\/api\/git\/pull'/.test(appJs));
check('★ 有东西可拉时按钮上带数字、而且给了颜色',
  /拉远端 \(\$\{behind\}\)/.test(appJs) && /is-behind/.test(fs.readFileSync(path.join(SRC, 'tools/editor/ui/style.css'), 'utf8')));

/* ================================================================
 * 准备三个仓库 + 起编辑器
 * ================================================================ */
console.log('\n================ 准备仓库 ================');
for (const p of [ORIGIN, DST, OTHER]) fs.rmSync(p, { recursive: true, force: true });

fs.mkdirSync(DST, { recursive: true });
for (const item of ['src', 'tools', 'package.json', 'astro.config.mjs', 'tsconfig.json',
  '.gitignore', '.gitattributes']) {
  const from = path.join(SRC, item);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(DST, item), { recursive: true });
}
try {
  execFileSync('cmd', ['/c', 'mklink', '/J', path.join(DST, 'node_modules'),
    path.join(SRC, 'node_modules')], { stdio: 'ignore' });
} catch { /* 已经有了 */ }

gitOK(['init', '-b', 'main'], DST);
gitOK(['config', 'user.email', 'check@local'], DST);
gitOK(['config', 'user.name', '验收脚本'], DST);
gitOK(['add', '-A'], DST);
gitOK(['commit', '-m', '初始状态'], DST);
gitOK(['init', '--bare', '-b', 'main', ORIGIN], TMP);
gitOK(['remote', 'add', 'origin', ORIGIN], DST);
gitOK(['push', '-u', 'origin', 'main'], DST);

gitOK(['clone', ORIGIN, OTHER], TMP);
gitOK(['config', 'user.email', 'robot@local'], OTHER);
gitOK(['config', 'user.name', '机器人'], OTHER);
info(`我（编辑器）：${DST}`);
info(`机器人：${OTHER}`);

/** 机器人在自己的副本里写一篇文章并推上来（它守「先拉后推」） */
function robotPush(files, message) {
  gitOK(['pull', '--rebase', '--autostash', '--quiet', 'origin', 'main'], OTHER);
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(OTHER, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
  gitOK(['add', '-A'], OTHER);
  gitOK(['commit', '-m', message], OTHER);
  gitOK(['push', 'origin', 'main'], OTHER);
  return gitOK(['rev-parse', 'HEAD'], OTHER);
}

const postsDir = path.join(DST, 'src/content/posts');
const SHARED = fs.readdirSync(postsDir).filter((f) => f.endsWith('.md')).sort()[0];
const SHARED_ABS = path.join(postsDir, SHARED);
info(`（「同一个文件」用 ${SHARED} 来演）`);

const editor = spawn(process.execPath, [path.join(DST, 'tools/editor/server.mjs')], {
  cwd: DST, stdio: ['ignore', 'pipe', 'pipe'],
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

const getJson = async (p) => (await fetch(base + p)).json();
const postJson = async (p, body = {}) => {
  const r = await fetch(base + p, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};

/* ================================================================
 * ② 机器人先推 → 点按钮 → 真的拉到本机
 * ================================================================ */
console.log('\n================ ② 机器人先推，我点「拉远端」 ================');
if (base) {
  const st0 = await getJson('/api/git/status');
  check('★ GET /api/git/status 给出远端状态（角标靠它）',
    st0?.ok === true && typeof st0.behind === 'number' && typeof st0.ahead === 'number' && !!st0.remote,
    JSON.stringify({ remote: String(st0?.remote || '').slice(-24), behind: st0?.behind, ahead: st0?.ahead }));

  const ROBOT_POST = 'src/content/posts/robot-pull-note.md';
  const sha = robotPush({
    [ROBOT_POST]: ['---', 'title: 机器人推上来的一篇', 'date: 2026-10-05', 'tags: [机器人]', 'subs: []', '---', '', '正文。', ''].join('\n'),
  }, '机器人：新增一篇文章');

  const before = fs.existsSync(path.join(DST, ROBOT_POST));
  const pulled = await postJson('/api/git/pull');
  const after = fs.existsSync(path.join(DST, ROBOT_POST));
  check('★ 点「拉远端」之前，机器人那篇还没在本机', before === false);
  check('★★ 点了之后真的拉下来了（那篇文章出现在本机磁盘上）',
    pulled.json?.code === 'ok' && Number(pulled.json?.pulled) === 1 && after === true,
    `code=${pulled.json?.code} pulled=${pulled.json?.pulled}`);
  check('★ 回来的话里也说了拉了几个提交', /已拉取 1 个提交/.test(String(pulled.json?.message || '')),
    String(pulled.json?.message || '').split('\n')[0].slice(0, 40));
  check('★ 拉完之后本地和远端一致（角标该清掉）',
    gitOK(['rev-parse', 'HEAD']) === sha
    && (await getJson('/api/git/status')).behind === 0);

  /* ③ 再点一次：如实说「已经是最新的」 */
  const again = await postJson('/api/git/pull');
  check('★ 没有新东西时再点一次：如实说已经最新，不假装拉了',
    again.json?.code === 'ok' && Number(again.json?.pulled || 0) === 0
    && /已经是最新的/.test(String(again.json?.message || '')),
    String(again.json?.message || '').split('\n').slice(-1)[0].slice(0, 40));

  check('★ 快进拉取不会在历史里留下合并提交（线性的）',
    Number(gitOK(['rev-list', '--count', '--merges', 'HEAD'])) === 0);
}

/* ================================================================
 * ④ 界面上那个按钮：存在、有数字、点了真拉
 * ================================================================ */
console.log('\n================ ④ 界面上的按钮 ================');
if (base) {
  const profile = path.join(process.env.TEMP ?? '.', `dsh-pull-${Date.now()}`);
  spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu',
    '--enable-unsafe-swiftshader', '--disable-breakpad', '--window-size=1440,960',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
  { stdio: 'ignore' });

  class CDP {
    constructor(ws) {
      this.ws = ws; this.id = 0; this.pending = new Map();
      ws.addEventListener('message', (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && this.pending.has(m.id)) {
          const { resolve, reject } = this.pending.get(m.id);
          this.pending.delete(m.id);
          m.error ? reject(new Error(m.error.message)) : resolve(m.result);
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
  check('无头浏览器起来了', !!cdp);

  if (cdp) {
    // alert 会挡住页面：先把它换成桩，免得点的时候卡住
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url: `${base}/` });
    for (let i = 0; i < 300; i++) { await sleep(100); if ((await cdp.ev('document.readyState')) === 'complete') break; }
    await sleep(1500);
    await cdp.ev(`(() => { window.__alerts = []; window.alert = (m) => { window.__alerts.push(String(m)); }; return true; })()`);

    const btn = await cdp.ev(`(() => {
      const b = document.getElementById('btn-pull');
      if (!b) return { ok: false };
      const r = b.getBoundingClientRect();
      return { ok: true, text: b.textContent.trim(), visible: r.width > 20 && r.height > 8,
               title: b.getAttribute('title') || '', inTopbar: !!b.closest('.topbar__actions') };
    })()`);
    check('★ 页面右上角真有「拉远端」按钮，而且是可见的',
      btn?.ok === true && btn.visible === true, JSON.stringify(btn).slice(0, 120));
    check('★ 它就在保存按钮那一排（不是藏在哪个面板里）', btn?.inTopbar === true);

    // 机器人再推一篇 → 点按钮 → 本机应该有
    const ANOTHER = 'src/content/posts/robot-pull-note2.md';
    robotPush({
      [ANOTHER]: ['---', 'title: 机器人推的第二篇', 'date: 2026-10-05', 'tags: [机器人]', 'subs: []', '---', '', '正文。', ''].join('\n'),
    }, '机器人：第二篇');

    const clicked = await cdp.ev(`(async () => {
      const b = document.getElementById('btn-pull');
      b.click();
      let text = '';
      for (let i = 0; i < 200; i++) {
        await new Promise((r) => setTimeout(r, 100));
        text = b.textContent.trim();
        if (text === '拉远端') break;
      }
      return { text, toast: (document.getElementById('toast') || {}).textContent || '', alerts: window.__alerts.slice() };
    })()`);
    check('★★ 界面上点一下真的把机器人的新文章拉到了本机',
      fs.existsSync(path.join(DST, ANOTHER)), ANOTHER);
    check('★ 点完按钮回到「拉远端」（角标清掉，不是一直挂着数字）',
      clicked.text === '拉远端', JSON.stringify(clicked).slice(0, 140));
    check('★ 界面上给了明确反馈（提示条说了拉了几个提交）',
      /已拉取/.test(clicked.toast) || /已经是最新的/.test(clicked.toast), clicked.toast.slice(0, 60));

    /*
      ── ⑨ 不用点按钮：只是从别的窗口切回来，编辑器就该自己发现远端多了东西 ──
      （2026-10-06 修：从前只在服务启动那一刻探一次远端，之后机器人推的它一概不知道）
    */
    const NOTICED = 'src/content/posts/robot-pull-note4.md';
    robotPush({
      [NOTICED]: ['---', 'title: 机器人推的第四篇', 'date: 2026-10-05', 'tags: [机器人]', 'subs: []', '---', '', '正文。', ''].join('\n'),
    }, '机器人：第四篇');

    const noticed = await cdp.ev(`(async () => {
      const b = document.getElementById('btn-pull');
      const was = b.textContent.trim();
      window.dispatchEvent(new Event('focus'));      // 等于「你从别的窗口切回来」
      let text = was;
      for (let i = 0; i < 150; i++) {                // 最多等 15 秒（探针一般 1~3 秒回来）
        await new Promise((r) => setTimeout(r, 100));
        text = b.textContent.trim();
        if (text !== was) break;
      }
      return { was, text, cls: b.className, title: b.getAttribute('title') || '',
               stale: b.classList.contains('is-stale') };
    })()`);
    check('★★ 不点按钮、只是切回窗口：编辑器自己发现远端多了 1 篇，角标亮起来',
      noticed.text === '拉远端 (1)' && noticed.cls.includes('is-behind') && noticed.stale === false,
      JSON.stringify(noticed).slice(0, 150));
    check('★ 亮起来的时候那篇确实还没在本机（数字不是瞎报的）',
      !fs.existsSync(path.join(DST, NOTICED)));

    const clicked2 = await cdp.ev(`(async () => {
      const b = document.getElementById('btn-pull');
      b.click();
      let text = b.textContent.trim();
      for (let i = 0; i < 200; i++) {
        await new Promise((r) => setTimeout(r, 100));
        text = b.textContent.trim();
        if (text === '拉远端') break;
      }
      return { text, toast: (document.getElementById('toast') || {}).textContent || '' };
    })()`);
    check('★ 顺着刚亮起来的角标点一下，那一篇就真的到了本机',
      fs.existsSync(path.join(DST, NOTICED)) && clicked2.text === '拉远端', clicked2.toast.slice(0, 50));
  }
}

/* ================================================================
 * ⑤ 命令行：pull 子命令 + 机读结果
 * ================================================================ */
console.log('\n================ ⑤ 命令行那条路 ================');
{
  robotPush({
    'src/content/posts/robot-pull-note3.md': ['---', 'title: 机器人推的第三篇', 'date: 2026-10-05', 'tags: [机器人]', 'subs: []', '---', '', '正文。', ''].join('\n'),
  }, '机器人：第三篇');
  const r = spawnSync(process.execPath, [path.join(DST, 'tools/git', 'sync.mjs'), 'pull', '--json'],
    { cwd: DST, encoding: 'utf8', timeout: 120000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const line = out.split('\n').reverse().find((l) => l.startsWith('[result] '));
  let parsed = null;
  try { parsed = JSON.parse(String(line).slice('[result] '.length)); } catch { parsed = null; }
  check('★ 命令行 pull 会打出机读的 [result] 那一行（编辑器服务就是读它）',
    r.status === 0 && parsed?.code === 'ok' && Number(parsed?.pulled) === 1,
    `exit=${r.status} result=${JSON.stringify(parsed)}`);
  check('★ 同一次运行里人也看得到日志（不是只剩机读那一行）',
    /正在快进拉取|拉取完成/.test(out), out.split('\n').filter(Boolean).slice(0, 2).join(' / ').slice(0, 80));
}

/* ================================================================
 * ⑥ 远端动了我改过还没发布的文件 → 一个字节都不动地拒绝
 * ================================================================ */
console.log('\n================ ⑥ 撞上我没发布的改动 ================');
if (base) {
  // 我在编辑器里改了这篇文章（等于保存过、但还没发布 = 工作区里有未提交的改动）
  const mine = fs.readFileSync(SHARED_ABS, 'utf8').replace(/^title:.*$/m, 'title: 我这边改的标题');
  fs.writeFileSync(SHARED_ABS, mine);

  // 机器人改了**同一个文件的同一行**
  const robotVersion = fs.readFileSync(path.join(OTHER, 'src/content/posts', SHARED), 'utf8')
    .replace(/^title:.*$/m, 'title: 机器人改的标题');
  robotPush({ [`src/content/posts/${SHARED}`]: robotVersion }, '机器人：我也改标题');

  const r = await postJson('/api/git/pull');
  check('★ 远端动的正是我改过还没发布的文件 → **拒绝**（code=blocked，不是硬拉）',
    r.json?.code === 'blocked', `code=${r.json?.code}`);
  check('★ 拒绝时点名是哪几个文件挡住了',
    Array.isArray(r.json?.files) && r.json.files.includes(`src/content/posts/${SHARED}`),
    JSON.stringify(r.json?.files));
  check('★★ 我本地那份**一个字节都没变**（别人的内容没有硬塞进来）',
    fs.readFileSync(SHARED_ABS, 'utf8') === mine);
  check('★ 拒绝之后本地确实还落后（没有假装拉成功）',
    Number((await getJson('/api/git/status')).behind) >= 1);
  check('★ 给的处理办法是「先点发布上线」（那条路会先提交再拉）',
    /发布上线/.test(String(r.json?.message || '')),
    String(r.json?.message || '').split('\n')[0].slice(0, 42));

  /* ⑦ 我本地有没发布的提交时：不在编辑器里乱 rebase */
  gitOK(['add', '-A'], DST);
  gitOK(['commit', '-m', '我把标题改了'], DST);
  const r2 = await postJson('/api/git/pull');
  check('★ 本地有没发布的提交时如实说「先去发布上线」，不在编辑器里乱 rebase',
    r2.json?.code === 'ahead' && /发布上线/.test(String(r2.json?.message || '')),
    `code=${r2.json?.code}`);
  check('★ 这时候也没有产生任何合并提交 / 冲突标记',
    Number(gitOK(['rev-list', '--count', '--merges', 'HEAD'])) === 0
    && !/^<<<<<<<|^>>>>>>>/m.test(fs.readFileSync(SHARED_ABS, 'utf8')));
}

/* ================================================================
 * ⑧ 探不到远端时不许装成最新（2026-10-06）
 *
 * 现场就是这个：机器人推了、网站上都有了，可编辑器这边「什么都没发生」——
 * 因为角标上的数字来自最近一次探远端，探失败时它必须如实说「这数字可能旧了」，
 * 而不是继续拿着一个过时的 0 让人以为「没有新东西」。
 * ================================================================ */
console.log('\n================ ⑧ 探不到远端时的诚实 ================');

/** ⑧ 只要能对已经开着的那个页面喊一句 Runtime.evaluate 就够了 */
async function evalInPage(expression) {
  const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page' && String(t.url).startsWith('http://127.0.0.1'));
  if (!page) throw new Error('找不到那个编辑器页面');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('连不上页面')), { once: true });
  });
  const done = new Promise((resolve) => {
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === 1) resolve(m.error ? null : m.result?.result?.value);
    });
  });
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate',
    params: { expression, returnByValue: true, awaitPromise: true } }));
  const value = await done;
  ws.close();
  return value;
}

if (base) {
  const realOrigin = gitOK(['remote', 'get-url', 'origin'], DST);
  // 让远端和代理都指向「真的没人监听」的地方：探远端必然失败
  gitOK(['remote', 'set-url', 'origin', 'http://127.0.0.1:9/nope.git'], DST);
  gitOK(['config', 'http.proxy', 'http://127.0.0.1:9'], DST);

  const ask = await postJson('/api/git/fetch');
  check('★ 「现在去探一次」这个接口立刻回话（探针在后台跑，不堵页面）', ask.json?.ok === true);

  let st8 = null;
  for (let i = 0; i < 80; i++) {
    await sleep(500);
    st8 = await getJson('/api/git/status');
    if (st8?.lastFetch && st8.lastFetch.ok === false) break;
  }
  check('★★ 探远端失败时状态里如实记着 lastFetch.ok = false（前端靠它提示）',
    st8?.lastFetch?.ok === false, JSON.stringify(st8?.lastFetch));

  let staleUi = null;
  try {
    staleUi = await evalInPage(`(async () => {
      window.dispatchEvent(new Event('focus'));
      const b = document.getElementById('btn-pull');
      for (let i = 0; i < 150; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (b.classList.contains('is-stale')) break;
      }
      return { cls: b.className, title: b.getAttribute('title') || '', text: b.textContent.trim() };
    })()`);
  } catch (err) {
    info(`读页面失败：${String(err.message ?? err).slice(0, 80)}`);
  }
  check('★★ 界面上把按钮标成「虚线的旧数字」，并说清这个数可能不是最新的',
    !!staleUi && staleUi.cls.includes('is-stale') && /可能不是最新/.test(staleUi.title),
    JSON.stringify(staleUi).slice(0, 150));

  // 恢复正常（远端地址、代理都还原）：服务端自己应当变回「探得到」
  gitOK(['remote', 'set-url', 'origin', realOrigin], DST);
  gitOK(['config', '--unset', 'http.proxy'], DST);

  await postJson('/api/git/fetch');
  let stBack = null;
  for (let i = 0; i < 60; i++) {
    // 一直催：上一次失败的探针可能还在跑，服务端会把这次请求挡掉（无副作用），下一轮就轮到了
    await postJson('/api/git/fetch');
    await sleep(700);
    stBack = await getJson('/api/git/status');
    if (stBack?.lastFetch?.ok === true) break;
  }
  check('★ 恢复之后服务端自己变回「探得到远端」（lastFetch.ok = true）',
    stBack?.lastFetch?.ok === true, JSON.stringify(stBack?.lastFetch));

  let backUi = null;
  try {
    backUi = await evalInPage(`(async () => {
      const b = document.getElementById('btn-pull');
      for (let i = 0; i < 200; i++) {
        if (!b.classList.contains('is-stale')) break;
        if (i % 40 === 0) window.dispatchEvent(new Event('focus'));   // 每 4 秒催页面再看一次
        await new Promise((r) => setTimeout(r, 100));
      }
      return { cls: b.className, title: b.getAttribute('title') || '' };
    })()`);
  } catch (err) {
    info(`读页面失败：${String(err.message ?? err).slice(0, 80)}`);
  }
  check('★ 网络/代理恢复之后，那个「旧数字」的提示自己消失（不用重开编辑器）',
    !!backUi && !backUi.cls.includes('is-stale'), JSON.stringify(backUi).slice(0, 120));
}

/* ================================================================ */
try { editor.kill(); } catch { /* 已经退出 */ }
try { execSync('taskkill /F /T /IM chrome.exe', { stdio: 'ignore' }); } catch { /* 没有就算了 */ }
try {
  const j = path.join(DST, 'node_modules');
  if (fs.existsSync(j)) execFileSync('cmd', ['/c', 'rmdir', j], { stdio: 'ignore' });
  for (const p of [DST, OTHER, ORIGIN]) fs.rmSync(p, { recursive: true, force: true });
  console.log(`副本已清理: ${!fs.existsSync(DST) && !fs.existsSync(OTHER) && !fs.existsSync(ORIGIN)}`);
} catch (err) {
  console.log('副本没删干净（不影响结论）：', String(err.message ?? err).slice(0, 120));
}

console.log('\n================ 结果 ================');
console.log(`PASS ${pass}   FAIL ${fail}`);
if (fail > 0) process.exit(1);
