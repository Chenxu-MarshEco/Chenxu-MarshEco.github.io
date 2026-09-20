/*
 * 验"成员改名 / 换头像之后，他所有精华（含首页那条每日精华）一起变"这条 —— 直接改数据、重建、量页面，
 * 绕开编辑器 UI（编辑器那半子代理在做，这条是数据层绑定本身）。
 *
 * 做法：副本里把 Raw（237 条）改名成 Raw-验收、头像设成 /img/home/logo.png → 重建 →
 *   ① /salon/ 里 237 行的名字都变了、头像都换上了、没有一行还叫旧名字
 *   ② /salon.json 里他那 237 条的 member/avatar 字段都变了
 *   ③ 首页那条每日精华，挑一个"哈希选中 Raw 的日期" → 卡片上的名字和头像也变了
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';

const SRC = String.raw`D:\曼沫砾总线\Chenxu-MarshEco.github.io`;
const DST = path.join(SRC, '.tmp', 'bind-proj');
const PORT = 4386;
const DEBUG_PORT = 9357;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const NEW_NAME = 'Raw-验收';
const AVATAR = '/img/home/logo.png';
/** 页面上的头像走图片管线（/img/opt/home/logo-384.webp 这种），比对时用文件名主干 */
const AVATAR_STEM = 'logo';
const TARGET_MEMBER = 'm02-da43'; // Raw
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const dailyIndex = (dateStr, count) => {
  let h = 2166136261;
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % count;
};

/* ---------- 1. 副本 + 改名换头像 ---------- */
if (fs.existsSync(DST)) {
  for (const j of ['node_modules', 'public']) {
    const p = path.join(DST, j);
    if (fs.existsSync(p)) { try { execSync(`cmd /c rmdir "${p}"`, { stdio: 'ignore' }); } catch {} }
  }
  fs.rmSync(DST, { recursive: true, force: true });
}
const skip = new Set(['node_modules', 'public', 'dist', '.git', '.tmp']);
fs.mkdirSync(DST, { recursive: true });
for (const e of fs.readdirSync(SRC, { withFileTypes: true })) {
  if (skip.has(e.name)) continue;
  fs.cpSync(path.join(SRC, e.name), path.join(DST, e.name), { recursive: true });
}
execSync(`cmd /c mklink /J "${path.join(DST, 'node_modules')}" "${path.join(SRC, 'node_modules')}"`, { stdio: 'ignore' });
execSync(`cmd /c mklink /J "${path.join(DST, 'public')}" "${path.join(SRC, 'public')}"`, { stdio: 'ignore' });

const salonPath = path.join(DST, 'src', 'data', 'salon.json');
const salon = JSON.parse(fs.readFileSync(salonPath, 'utf8'));
const before = salon.members.find((m) => m.id === TARGET_MEMBER);
console.log('目标成员:', JSON.stringify(before), ' 他名下的精华:', salon.essences.filter((e) => (e.memberIds || []).includes(TARGET_MEMBER)).length, '条');
before.name = NEW_NAME;
before.avatar = AVATAR;
fs.writeFileSync(salonPath, JSON.stringify(salon, null, 2) + '\n', 'utf8');
execSync(`node "${path.join(SRC, 'node_modules', 'astro', 'bin', 'astro.mjs')}" build --root "${DST}"`, { stdio: 'ignore' });
console.log('副本已改名换头像并重建完成');

/* ---------- 2. 找一个"哈希会选中他"的日期（给首页每日精华用） ---------- */
const targetCount = salon.essences.filter((e) => (e.memberIds || []).includes(TARGET_MEMBER)).length;
let hitDate = '';
for (let d = 0; d < 400 && !hitDate; d++) {
  const dt = new Date(2026, 9, 1 + d); // 2026-10 起往后找
  const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const pick = salon.essences[dailyIndex(key, salon.essences.length)];
  if (pick && (pick.memberIds || []).includes(TARGET_MEMBER)) hitDate = key;
}
console.log('哈希会选中他的日期:', hitDate);

/* ---------- 3. 真浏览器 ---------- */
const ROOT = path.join(DST, 'dist');
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
const profile = path.join(process.env.TEMP ?? '.', `dsh-bind-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' ')); }); }
  static async attach(u) { const ws = new WebSocket(u); await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('ws')), { once: true }); }); return new CDP(ws); }
  send(m, p = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method: m, params: p })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  async ev(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? '')); return r.result.value; }
  async goto(p, wait = 1800) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 120; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
  }
}

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) { await sleep(300); try { const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json(); target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl); } catch {} }
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  /* ① /salon/ 里所有属于他的行 */
  await cdp.goto('/salon/', 3500);
  const list = await cdp.ev(`(() => {
    const rows = [...document.querySelectorAll('#salon-list .salon__item')];
    const nameOf = (r) => (r.querySelector('.salon__name') || {}).textContent || '';
    /* 一条精华可能有多个成员：这一行里的**任意一个**头像换成新图就算对，
       不能只看第一个（多成员那行第一个头像可能是别人的）。 */
    const hasMyAvatar = (r) => [...r.querySelectorAll('.salon__avatar')].some((a) => a.tagName === 'IMG' && (a.getAttribute('src') || '').includes(${JSON.stringify(AVATAR_STEM)}));
    const avOf = (r) => { const a = r.querySelector('.salon__avatar'); return a ? (a.tagName === 'IMG' ? a.getAttribute('src') : '(占位)') : null; };
    /* 一条精华可能挂着好几个人（完美对话那种），所以按 data-members 认领，
       不能拿"名字正好等于新名字"来数 —— 那样多成员的行会被漏掉。 */
    const isMine = (r) => (r.dataset.members || '').split(' ').includes(${JSON.stringify(TARGET_MEMBER)});
    const mine = rows.filter(isMine);
    const oldNameLeft = rows.filter((r) => nameOf(r) === 'Raw').length;
    const withAvatar = mine.filter(hasMyAvatar).length;
    const total = rows.length;
    return { total, mine: mine.length, oldNameLeft, withAvatar, sampleAvatar: mine[0] ? avOf(mine[0]) : null, sampleName: mine[0] ? nameOf(mine[0]) : null };
  })()`);
  check(`/salon/：改名之后他名下 **${targetCount}** 行全变成新名字`, list.mine === targetCount, JSON.stringify(list));
  check('/salon/：没有一行还叫旧名字（Raw 归零）', list.oldNameLeft === 0, JSON.stringify({ oldNameLeft: list.oldNameLeft }));
  check('/salon/：他那些行的头像都换成了新上传的那张（走图片管线，所以是变体地址）', list.withAvatar === targetCount, JSON.stringify({ withAvatar: list.withAvatar, 期望: targetCount, sample: list.sampleAvatar }));

  /* ② /salon.json（首页挑一条就读它） */
  const api = await cdp.ev(`(async () => { const j = await (await fetch('/salon.json')).json();
    const isMine = (e) => (e.members || []).some((m) => m.name === ${JSON.stringify(NEW_NAME)});
    const mine = j.essences.filter(isMine);
    const old = j.essences.filter((e) => e.member === 'Raw').length;
    return { mine: mine.length, old, avatarOk: mine.every((e) => (e.members || []).some((m) => m.name === ${JSON.stringify(NEW_NAME)} && (m.avatar || '').includes(${JSON.stringify(AVATAR_STEM)}))), sample: mine[0] ? { id: mine[0].id, member: mine[0].member, avatar: mine[0].avatar } : null }; })()`);
  check(`/salon.json：他那 ${targetCount} 条的成员/头像都跟着变了`, api.mine === targetCount && api.old === 0 && api.avatarOk === true, JSON.stringify(api));

  /* ③ 首页每日精华（把页面时间设成"哈希会选中他"的那天） */
  if (hitDate) {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const FIXED = new Date('${hitDate}T12:00:00');
        const Real = Date;
        class FakeDate extends Real { constructor(...a) { if (a.length === 0) super(FIXED.getTime()); else super(...a); } static now() { return FIXED.getTime(); } }
        window.Date = FakeDate;
      })();`,
    });
    await cdp.goto('/', 2600);
    const daily = await cdp.ev(`(() => {
      const card = document.querySelector('[data-daily-card]');
      const av = card.querySelector('.daily__avatar');
      return { name: (card.querySelector('.daily__name') || {}).textContent || '', avatar: av ? (av.tagName === 'IMG' ? av.getAttribute('src') : '(占位)') : null, time: (card.querySelector('.daily__time') || {}).textContent || '', hasText: !!card.querySelector('.daily__text'), hasPic: !!card.querySelector('.daily__pic') };
    })()`);
    check(`首页每日精华（那天哈希选中他）：名字/头像都跟着变了 —— ${hitDate}`, daily.name === NEW_NAME && (daily.avatar || '').includes(AVATAR_STEM), JSON.stringify(daily));
  } else {
    check('首页每日精华：找到"哈希选中他"的日期', false, '没找到');
  }
  check('这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));
} catch (err) {
  fail++;
  console.log('FAIL  脚本异常: ' + (err?.stack ?? err));
} finally {
  try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  server.close();
  await sleep(250);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  for (const j of ['node_modules', 'public']) {
    const p = path.join(DST, j);
    if (fs.existsSync(p)) { try { execSync(`cmd /c rmdir "${p}"`, { stdio: 'ignore' }); } catch {} }
  }
  try { fs.rmSync(DST, { recursive: true, force: true }); } catch {}
  console.log('副本已清理:', !fs.existsSync(DST));
}
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
