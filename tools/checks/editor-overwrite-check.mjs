/*
 * ============================================================================
 * 编辑器不许覆盖「别人刚改过的文章」—— 验收
 * ----------------------------------------------------------------------------
 * 背景（2026-10-05）：站点的内容不止一个人在改 —— 另一位会推文章，接入的机器人
 * 也会定时往里写稿。编辑器以前是「读进来 → 改 → 整个文件写回去」，中间**不检查
 * 磁盘上那一份有没有被别处改过**：只要那期间别人动过同一个文件，一点保存就把对方
 * 的改动整段抹掉。这是 git 世界里「后写覆盖先写」那类事故，只不过发生在点保存那一刻。
 *
 * 修法：读文件时算一个内容指纹（rev）一起发给浏览器，保存时再算一次比对；
 * 对不上就 **409 拒绝保存**，并在界面上弹一个默认「不覆盖」的确认框 ——
 * 要覆盖得再点一次确定（两次确认），而取消则把你写的内容留在编辑器里，什么都不丢。
 *
 * 这个脚本在副本里真跑一遍（接口 + 界面两条路都量）：
 *   ① GET /api/item 会带回 rev；
 *   ② 指纹对得上 → 正常保存；
 *   ③ 磁盘上被别处改过 → 保存被拒（409），**磁盘上的内容没被覆盖**；
 *   ④ 拿到最新指纹后能正常保存（这道闸不能把正常流程挡住）；
 *   ⑤ 明确 force 才允许覆盖（界面上那条路要两次确认）；
 *   ⑥ 不带 rev 的老客户端 / 脚本行为不变；
 *   ⑦ 界面上真的会弹确认框，选「取消」时磁盘上别人的内容完好。
 *
 * 用法：node tools/checks/editor-overwrite-check.mjs
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..');
const DST = path.join(SRC, '.tmp', 'overwrite-copy');
const DEBUG_PORT = 9467;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

/* ================================================================
 * ① 源码：客户端确实把指纹带上、并且默认不覆盖
 * ================================================================ */
console.log('================ ① 源码里的接线 ================');
const appJs = fs.readFileSync(path.join(SRC, 'tools/editor/ui/app.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(SRC, 'tools/editor/server.mjs'), 'utf8');
check('★ 服务端读文件时算内容指纹（rev）',
  /function revOf\(text\)[\s\S]{0,500}?createHash\('sha1'\)/.test(serverJs)
  && /rev: revOf\(raw\)/.test(serverJs));
check('★ 保存前比指纹，对不上就 409（而不是闷头写下去）',
  /async function checkStale\(type, base, payload\)/.test(serverJs)
  && /stale: true,[\s\S]{0,300}?这次保存被拒绝了/.test(serverJs));
check('★ 界面上带指纹保存、并处理 stale 的 409（默认不覆盖，覆盖要再确认一次）',
  /rev: state\.current\?\.rev \|\| ''/.test(appJs)
  && /err\.data\.stale/.test(appJs)
  && /真的要覆盖吗/.test(appJs));
check('★ 保存成功后把新指纹存回去（不然下一次保存会被自己的旧指纹挡住）',
  /state\.current\.rev = res\.rev \|\| ''/.test(appJs));

/* ================================================================
 * 准备副本 + 起编辑器
 * ================================================================ */
console.log('\n================ 准备副本 ================');
if (fs.existsSync(DST)) {
  const j = path.join(DST, 'node_modules');
  if (fs.existsSync(j)) { try { execSync(`cmd /c rmdir "${j}"`, { stdio: 'ignore' }); } catch { /* 不是 junction */ } }
  fs.rmSync(DST, { recursive: true, force: true });
}
fs.mkdirSync(DST, { recursive: true });
for (const item of ['src', 'tools', 'package.json', 'astro.config.mjs', 'tsconfig.json']) {
  fs.cpSync(path.join(SRC, item), path.join(DST, item), { recursive: true });
}
try {
  execSync(`cmd /c mklink /J "${path.join(DST, 'node_modules')}" "${path.join(SRC, 'node_modules')}"`, { stdio: 'ignore' });
} catch { /* 已经有了 */ }

const postsDir = path.join(DST, 'src/content/posts');
const POST = fs.readdirSync(postsDir).filter((f) => f.endsWith('.md')).sort()[0];
const POST_ABS = path.join(postsDir, POST);
const disk = () => fs.readFileSync(POST_ABS, 'utf8');
check('副本里挑得到一篇文章来试', Boolean(POST), POST);

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

const api = async (p) => (await fetch(base + p)).json();
const save = async (payload) => {
  const r = await fetch(`${base}/api/save`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'posts', file: POST, ...payload }),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};

/* ================================================================
 * ② 接口：指纹对得上 / 对不上 / 明确覆盖 / 老客户端
 * ================================================================ */
console.log('\n================ ② 接口：什么时候该拒绝 ================');
if (base) {
  const item = await api(`/api/item?type=posts&file=${encodeURIComponent(POST)}`);
  const rev0 = item?.rev;
  check('★ GET /api/item 带回内容指纹 rev', typeof rev0 === 'string' && rev0.length >= 8, String(rev0));

  // 指纹对得上 → 正常保存
  const saved1 = await save({
    frontmatter: { ...item.frontmatter, title: '验收：我改的标题' }, body: item.body, rev: rev0,
  });
  check('★ 指纹对得上时正常保存（这道闸不会挡住正常写作）',
    saved1.status === 200 && saved1.json?.ok === true, `HTTP ${saved1.status}`);
  check('★ 保存之后的响应带回新的指纹（前端接着用它）',
    typeof saved1.json?.rev === 'string' && saved1.json.rev !== rev0,
    `${String(rev0).slice(0, 8)} → ${String(saved1.json?.rev).slice(0, 8)}`);
  check('★ 盘上确实写进去了', /验收：我改的标题/.test(disk()));

  // —— 机器人这时候也改了同一个文件（我们手里的指纹就过期了）——
  const robotText = disk().replace(/^title:.*$/m, 'title: 机器人改过的标题');
  fs.writeFileSync(POST_ABS, `${robotText.replace(/\s*$/, '')}\n\n机器人加的一句话。\n`);
  const beforeReject = disk();

  const saved2 = await save({
    frontmatter: { ...item.frontmatter, title: '验收：我要盖掉它' }, body: item.body, rev: saved1.json.rev,
  });
  check('★ 文件在别处被改过 → 保存被拒（HTTP 409 + stale）',
    saved2.status === 409 && saved2.json?.stale === true, `HTTP ${saved2.status}`);
  check('★ 被拒的提示说清了原因（别处改过 / 为避免覆盖别人）',
    /别处被改过/.test(saved2.json?.error ?? '') && /覆盖别人/.test(saved2.json?.error ?? ''),
    String(saved2.json?.error ?? '').slice(0, 60));
  check('★★ 磁盘上**别人的内容完好**（一个字都没被盖掉）', disk() === beforeReject);
  check('★ 机器人改的标题和它加的那句话都还在',
    /机器人改过的标题/.test(disk()) && /机器人加的一句话/.test(disk()));
  check('★ 被拒时把磁盘上现在那份的指纹也带回来了（前端可以据此重试）',
    typeof saved2.json?.rev === 'string' && saved2.json.rev !== saved1.json.rev);

  // 拿最新指纹再存 → 应该成功
  const fresh = await api(`/api/item?type=posts&file=${encodeURIComponent(POST)}`);
  const saved3 = await save({ frontmatter: fresh.frontmatter, body: fresh.body, rev: fresh.rev });
  check('★ 重新读一遍再存就正常了（人是能继续干活的）',
    saved3.status === 200 && saved3.json?.ok === true, `HTTP ${saved3.status}`);

  // 明确 force → 允许覆盖（这是用户自己在弹窗里点过两次的那条路）
  fs.writeFileSync(POST_ABS, disk().replace(/^title:.*$/m, 'title: 机器人又改了一次'));
  const forced = await save({
    frontmatter: { ...fresh.frontmatter, title: '验收：我确认要覆盖' }, body: fresh.body,
    rev: saved3.json.rev, force: true,
  });
  check('★ 明确 force 时才允许覆盖', forced.status === 200 && /验收：我确认要覆盖/.test(disk()),
    `HTTP ${forced.status}`);

  // 老客户端 / 脚本不带 rev → 行为不变
  const legacy = await save({ frontmatter: { ...fresh.frontmatter, title: '验收：不带指纹' }, body: fresh.body });
  check('★ 不带 rev 的老客户端 / 脚本行为不变（照样能存）',
    legacy.status === 200 && /验收：不带指纹/.test(disk()), `HTTP ${legacy.status}`);

  // 文件被别处删掉 → 也是 stale（不是闷头重新建出来）
  const item4 = await api(`/api/item?type=posts&file=${encodeURIComponent(POST)}`);
  fs.rmSync(POST_ABS, { force: true });
  const gone = await save({ frontmatter: item4.frontmatter, body: item4.body, rev: item4.rev });
  check('★ 文件被别处删掉时也拦一下（不会把别人删掉的东西悄悄复活）',
    gone.status === 409 && gone.json?.missing === true, `HTTP ${gone.status}`);
  const recreated = await save({ frontmatter: item4.frontmatter, body: item4.body, rev: item4.rev, force: true });
  check('★ 想重建就明确 force（重建成功）', recreated.status === 200 && fs.existsSync(POST_ABS));
}

/* ================================================================
 * ③ 界面上：真点一次保存，看确认框和磁盘
 * ================================================================ */
console.log('\n================ ③ 界面上真点一次保存 ================');
const profile = path.join(process.env.TEMP ?? '.', `dsh-overwrite-${Date.now()}`);
if (base) {
  spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu',
    '--enable-unsafe-swiftshader', '--disable-breakpad', '--window-size=1440,960',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
  { stdio: 'ignore' });
}

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
if (base) {
  for (let i = 0; i < 80 && !cdp; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const p = list.find((t) => t.type === 'page');
      if (p) cdp = await CDP.attach(p.webSocketDebuggerUrl);
    } catch { /* 等 */ }
  }
  check('无头浏览器起来了', !!cdp);
}

/* 界面上要操作的控件的 id：标题框是 f-title（不是 title），保存按钮是 btn-save */
const TITLE = '#f-title';

if (cdp) {
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: `${base}/` });
  for (let i = 0; i < 300; i++) { await sleep(100); if ((await cdp.ev('document.readyState')) === 'complete') break; }
  await sleep(1500);

  // 打开那篇文章，等它真的读完（判据：标题框里出现了盘上那个标题）
  const diskTitle = (/^title:\s*(.+)$/m.exec(disk()) ?? [, ''])[1].trim();
  const opened = await cdp.ev(`(async () => {
    let li = null;
    for (let i = 0; i < 120; i++) {
      li = document.querySelector('li.doc[data-file=${JSON.stringify(POST)}]');
      if (li) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!li) return { ok: false, why: '侧栏里找不到这篇文章' };
    li.click();
    let title = '';
    for (let i = 0; i < 150; i++) {
      const t = document.querySelector(${JSON.stringify(TITLE)});
      title = t ? t.value.trim() : '';
      if (title === ${JSON.stringify(diskTitle)}) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return { ok: true, title, want: ${JSON.stringify(diskTitle)},
             hasTitleBox: !!document.querySelector(${JSON.stringify(TITLE)}),
             hasSave: !!document.getElementById('btn-save') };
  })()`);
  check('界面上打开了这篇文章，而且标题框里已经是盘上那个标题',
    opened?.ok === true && opened.title === opened.want,
    `${JSON.stringify(opened).slice(0, 150)}`);

  // 把 confirm 换成可控的桩：记录问了什么、统一按 __answer 回答
  await cdp.ev(`(() => {
    window.__confirms = [];
    window.__answer = false;
    window.confirm = (m) => { window.__confirms.push(String(m)); return window.__answer; };
    return true;
  })()`);

  // 先正常存一次（界面上带指纹）
  const firstSave = await cdp.ev(`(async () => {
    const t = document.querySelector(${JSON.stringify(TITLE)});
    t.value = '验收：界面上改的标题';
    t.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    document.getElementById('btn-save').click();
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (/已保存/.test(document.body.innerText)) break;
    }
    return { text: document.body.innerText.slice(-400), confirms: window.__confirms.length };
  })()`);
  check('★ 界面上正常保存成功（没被指纹闸挡住）', /已保存/.test(firstSave.text) && firstSave.confirms === 0,
    `confirm 次数 ${firstSave.confirms}`);
  check('★ 盘上是界面上改的那个标题', /验收：界面上改的标题/.test(disk()));

  // —— 机器人改同一个文件 ——
  const robotVersion = `${disk().replace(/^title:.*$/m, 'title: 机器人抢在我前面改的').replace(/\s*$/, '')}\n\n机器人写的一段话。\n`;
  fs.writeFileSync(POST_ABS, robotVersion);

  // 界面上再改一次标题并保存：应该弹确认框；桩回答「取消」→ 什么都不覆盖
  const secondSave = await cdp.ev(`(async () => {
    window.__confirms = [];
    const t = document.querySelector(${JSON.stringify(TITLE)});
    t.value = '验收：我想盖掉机器人改的';
    t.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    document.getElementById('btn-save').click();
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 120));
      if (window.__confirms.length) break;
    }
    await new Promise((r) => setTimeout(r, 300));
    return { confirms: window.__confirms.slice(), text: document.body.innerText.slice(-300) };
  })()`);
  check('★ 磁盘被别处改过时，界面上弹出确认框（而不是闷头保存）',
    secondSave.confirms.length > 0, `confirm 次数 ${secondSave.confirms.length}`);
  check('★ 确认框写清了「会把对方刚写的内容盖掉」',
    /盖掉/.test(secondSave.confirms[0] ?? ''), String(secondSave.confirms[0] ?? '').slice(0, 70));
  check('★★ 选「取消」时磁盘上机器人的内容一个字都没变', disk() === robotVersion);
  check('★ 取消后界面上给了明确反馈，没假装保存成功',
    !/已保存/.test(secondSave.text), secondSave.text.replace(/\s+/g, ' ').slice(-90));

  // 桩改成「确定」→ 走两段确认 → 允许覆盖
  const thirdSave = await cdp.ev(`(async () => {
    window.__answer = true;
    window.__confirms = [];
    const t = document.querySelector(${JSON.stringify(TITLE)});
    t.value = '验收：确认覆盖';
    t.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    document.getElementById('btn-save').click();
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 120));
      if (/已保存/.test(document.body.innerText)) break;
    }
    return { confirms: window.__confirms.length, text: document.body.innerText.slice(-300) };
  })()`);
  check('★ 明确选「确定」时要**两次确认**才真的覆盖', thirdSave.confirms >= 2,
    `confirm 次数 ${thirdSave.confirms}`);
  check('★ 明确确认之后才写下去', /验收：确认覆盖/.test(disk()));
} else if (base) {
  check('无头浏览器起来了', false, '没连上 CDP');
}

/* ================================================================ */
try { editor.kill(); } catch { /* 已经退出 */ }
try { execSync('taskkill /F /T /IM chrome.exe', { stdio: 'ignore' }); } catch { /* 没有就算了 */ }

/* 收摊：先摘掉 node_modules 那个 junction（rmSync 会顺着它删掉真依赖！），再删副本 */
try {
  const j = path.join(DST, 'node_modules');
  if (fs.existsSync(j)) execSync(`cmd /c rmdir "${j}"`, { stdio: 'ignore' });
  fs.rmSync(DST, { recursive: true, force: true });
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  console.log('副本已清理:', !fs.existsSync(DST));
} catch (err) {
  console.log('副本没删干净（不影响结论）：', String(err.message ?? err).slice(0, 120));
}

console.log('\n================ 结果 ================');
console.log(`PASS ${pass}   FAIL ${fail}`);
if (fail > 0) process.exit(1);
