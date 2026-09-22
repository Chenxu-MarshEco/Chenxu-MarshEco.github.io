/*
 * 编辑器五个新面板的**界面级**验收（快，约 40 秒，不构建、不写盘）。
 *
 * 为什么不并进 editor-panels-e2e.mjs：那支是"接口 + 真站点"的完整链路（要传图、
 * 要构建三次，跑一趟三四分钟）。面板的 UI 改一行就得复验一次，所以这里单独做一支
 * 只开浏览器点面板的：node_modules / public 都走 junction，副本里一个字节都不写。
 *
 * 量的是这五件事：
 *   ① 五个工作面都打得开，开出来的确实是那一块（提示文案对得上）
 *   ② 「成员」面板：16 行、每行一个头像上传口 + 名字输入框、「名下 N 条精华」加起来 = 735
 *   ③ 在「成员」面板里把某个成员改名 → 切到「精华」面板搜这个名字 → 命中条数 = 他的精华数
 *      （成员和精华的绑定，在 UI 这一层也是通的；全程不保存，盘上数据不动）
 *   ④ 「精华」面板：735 条、搜索能筛、有「＋ 新增一条」的入口
 *   ⑤ 草稿保护：改了字切走再切回来，字还在、状态栏还写着"没保存"
 *
 * 用法：node tools/checks/editor-ui-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const SRC = String.raw`D:\曼沫砾总线\Chenxu-MarshEco.github.io`;
const DST = path.join(SRC, '.tmp', 'ui-proj');
const DEBUG_PORT = 9364;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const RENAME_TO = '验收UI改名';
const RAW_ID = 'm02-da43';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};

/* ---------- 副本（public / node_modules 走 junction，测试不写盘） ---------- */
if (fs.existsSync(DST)) {
  for (const j of ['node_modules', 'public']) {
    const p = path.join(DST, j);
    if (fs.existsSync(p)) { try { execSync(`cmd /c rmdir "${p}"`, { stdio: 'ignore' }); } catch { /* 不是 junction */ } }
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
console.log('副本就绪（junction，不落盘）:', DST);

const salon = JSON.parse(fs.readFileSync(path.join(DST, 'src', 'data', 'salon.json'), 'utf8'));
const rawRows = salon.essences.filter((e) => (e.memberIds ?? []).includes(RAW_ID)).length;
console.log(`盘上数据：精华 ${salon.essences.length} 条 / 成员 ${salon.members.length} 个 / ${RAW_ID} 名下 ${rawRows} 条`);

/* ---------- 编辑器（副本自己的 server.mjs） ---------- */
const editor = spawn(process.execPath, [path.join(DST, 'tools', 'editor', 'server.mjs')], { cwd: DST, stdio: ['ignore', 'pipe', 'pipe'] });
let elog = '';
editor.stdout.on('data', (b) => { elog += b.toString('utf8'); });
editor.stderr.on('data', (b) => { elog += b.toString('utf8'); });
let base = '';
for (let i = 0; i < 300 && !base; i++) {
  await sleep(150);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(elog);
  if (m) base = `http://127.0.0.1:${m[1]}`;
}
if (!base) { console.log('FAIL  编辑器没起来: ' + elog.slice(-500)); process.exit(1); }
console.log('编辑器（副本）在', base);

const api = async (p) => {
  const r = await fetch(base + p);
  return { status: r.status, json: await r.json().catch(() => null) };
};

const profile = path.join(process.env.TEMP ?? '.', `dsh-ui-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

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
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    });
  }
  static async attach(u) {
    const ws = new WebSocket(u);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('ws')), { once: true }); });
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
  async open(u, wait = 1500) {
    this.errors = [];
    await this.send('Page.navigate', { url: u });
    for (let i = 0; i < 120; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
  }
}

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* 还没起来 */ }
  }
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });

  const regress = [];
  for (const p of ['/api/bootstrap', '/api/boards', '/api/music', '/api/timelines', '/api/navs', '/api/anchors', '/api/layout', '/api/widgets', '/api/salon', '/api/iceberg']) {
    const r = await api(p);
    regress.push(`${p}=${r.status}`);
  }
  const salonApi = await api('/api/salon');
  check('老接口全在（10 条 GET 全 200）', regress.every((s) => s.endsWith('=200')), regress.join(' '));
  check('GET /api/salon 里的数字和盘上一致',
    salonApi.status === 200 && salonApi.json?.essences?.length === salon.essences.length && salonApi.json?.members?.length === salon.members.length,
    `${salonApi.json?.members?.length} 成员 / ${salonApi.json?.essences?.length} 精华`);

  await cdp.open(base + '/', 1200);
  const boot = await cdp.ev(`(() => ({ hasOpen: typeof window.__openWs === 'function', title: document.title }))()`);
  check('编辑器页面起来了', boot.hasOpen === true, boot.title);

  /* ---------- ① 五个工作面都能开，开的是那一块 ---------- */
  const wanted = [
    ['calendar', '日历', '特殊日子'],
    ['about', '关于我', '小圆片'],
    ['iceberg', '冰室冰山', '塔吊'],
    ['ice-chart', '冰山图', '完备标识'],
    ['essences', '精华', '冰室精华'],
    ['members', '成员', '成员 id'],
  ];
  const panels = {};
  for (const [id, label, keyword] of wanted) {
    const info = await cdp.ev(`(async () => {
      await window.__openWs(${JSON.stringify(id)});
      await new Promise((r) => setTimeout(r, 1000));
      const all = [...document.querySelectorAll('.wpanel')];
      const w = all.find((el) => el.getBoundingClientRect().height > 0);
      if (!w) return { ok: false, inDom: all.length };
      const hint = (w.querySelector('.wpanel__hint') || {}).textContent || '';
      return { ok: true, hint, hintOk: hint.includes(${JSON.stringify(keyword)}),
        boxes: [...w.querySelectorAll('.wbox__title')].map((t) => t.textContent),
        switchBtns: w.querySelectorAll('.wsswitch__btn').length,
        h: Math.round(w.getBoundingClientRect().height),
        files: w.querySelectorAll('input[type=file]').length,
        textareas: w.querySelectorAll('textarea').length }; })()`);
    panels[id] = info;
    check(`面板「${label}」打得开、开的是这一块（提示里含「${keyword}」）`, info.ok === true && info.hintOk === true,
      JSON.stringify({ hint: (info.hint ?? '').slice(0, 34), boxes: info.boxes, h: info.h }));
    check(`面板「${label}」顶上那排工作面切换按钮在（切走切回来草稿才不丢）`, info.switchBtns >= 14, `switchBtns=${info.switchBtns}`);
  }

  /* ---------- ② 成员面板：行数 / 头像通道 / 名字框 / 名下条数 ---------- */  const mem = await cdp.ev(`(async () => {
    await window.__openWs('members');
    await new Promise((r) => setTimeout(r, 1000));
    const w = [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
    const rows = [...w.querySelectorAll('.wmem')];
    const counts = rows.map((r) => (r.querySelector('.wmem__count') || {}).textContent || '');
    const sum = counts.map((t) => Number((/名下 (\\d+) 条/.exec(t) || [0, 0])[1])).reduce((a, b) => a + b, 0);
    return { rows: rows.length, files: w.querySelectorAll('.wmem input[type=file]').length,
      nameInputs: w.querySelectorAll('.wmem input[type=text], .wmem input:not([type])').length,
      addBtn: [...w.querySelectorAll('button')].some((b) => b.textContent.includes('新增成员')),
      sample: counts.slice(0, 3), sum, titles: [...w.querySelectorAll('.wbox__title')].map((t) => t.textContent) }; })()`);
  /* 每行的上传口现在是两个：成员头像 + 放大头像时固定显示的那张（可选的「卡片特效」） */
  check(`成员面板：${mem.rows} 行（盘上就是 ${salon.members.length} 个成员）、每行都有头像/放大图两个上传口和名字框`,
    mem.rows === salon.members.length && mem.files === mem.rows * 2 && mem.nameInputs >= mem.rows * 4,
    JSON.stringify({ rows: mem.rows, files: mem.files, nameInputs: mem.nameInputs, titles: mem.titles }));
  const slots = salon.essences.reduce((a, e) => a + (e.memberIds ?? []).length, 0);
  check(`成员面板：「名下 N 条精华」加起来 = ${slots}（= 每条精华挂的成员数之和；多成员的那 11 条会各算一次）`,
    mem.sum === slots, `合计 ${mem.sum}；精华 ${salon.essences.length} 条、成员位 ${slots} 个；前几行 ${JSON.stringify(mem.sample)}`);
  check('成员面板：有「＋ 新增成员」的入口', mem.addBtn === true, '');

  /* ②b 图和链接这两个"预留接口"在 UI 上也要有入口（选图片 / 拖进来 / 粘贴） */
  check('「关于我」面板里有头像上传口', panels.about.files >= 1, `input[type=file] ${panels.about.files} 个`);
  check('「冰室冰山」面板里有图片上传口', panels.iceberg.files >= 1, `input[type=file] ${panels.iceberg.files} 个`);
  check('「日历」面板能写事件（特殊日子那张表有「＋ 添加一天」）',
    panels.calendar.textareas >= 2 && panels.calendar.boxes.some((t) => t.includes('特殊日子')),
    JSON.stringify({ textareas: panels.calendar.textareas, boxes: panels.calendar.boxes }));

  /* ---------- ③ 面板里改名 → 精华面板里搜得到（绑定是通的） ---------- */
  const rename = await cdp.ev(`(async () => {
    const w = [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
    const row = w.querySelector('.wmem[data-member-id="${RAW_ID}"]');
    if (!row) return { ok: false, why: '找不到 ${RAW_ID} 那一行' };
    const before = row.querySelector('.wmem__count').textContent;
    const input = [...row.querySelectorAll('input')].find((i) => i.type !== 'file' && i.value && !i.value.startsWith('/'));
    if (!input) return { ok: false, why: '找不到名字输入框' };
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(input, ${JSON.stringify(RENAME_TO)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    const status = [...document.querySelectorAll('.wpanel__status')].map((s) => s.textContent).filter(Boolean);
    return { ok: true, before, oldValue: input.value, status }; })()`);
  check(`成员面板：把 ${RAW_ID} 的名字改成「${RENAME_TO}」（原样 ${rename.before}）`,
    rename.ok === true && rename.oldValue === RENAME_TO, JSON.stringify(rename));
  check('改完状态栏提示「有改动没保存」（草稿保护看得见）', Array.isArray(rename.status) && rename.status.some((s) => /保存/.test(s)), JSON.stringify(rename.status));

  const bound = await cdp.ev(`(async () => {
    await window.__openWs('essences');
    await new Promise((r) => setTimeout(r, 1200));
    const w = [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
    const s = w.querySelector('.wess__search');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(s, ${JSON.stringify(RENAME_TO)});
    s.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 800));
    const w2 = [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
    const count = (w2.querySelector('.wess__count') || {}).textContent || '';
    const first = w2.querySelector('.wess__rows li');
    return { count, firstText: first ? first.textContent.slice(0, 70) : '' }; })()`);
  check(`精华面板：搜刚改的新名字 → 命中 ${rawRows} 条（和改名那个成员名下的条数一致：成员↔精华是绑定的）`,
    new RegExp(`命中 ${rawRows} / 共 ${salon.essences.length} 条`).test(bound.count), JSON.stringify(bound));

  /* ---------- ④ 精华面板：735 条 + 搜索 + 新增入口 ---------- */
  const ess = await cdp.ev(`(async () => {
    const w = [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
    const s = w.querySelector('.wess__search');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(s, '');
    s.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 800));
    const w2 = [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
    const rowsBefore = w2.querySelectorAll('.wess__rows li').length;
    const more = [...w2.querySelectorAll('button')].find((b) => b.textContent.includes('加载更多'));
    if (more) { more.click(); await new Promise((r) => setTimeout(r, 700)); }
    const w3 = [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
    const rowsAfter = w3.querySelectorAll('.wess__rows li').length;
    return { count: (w3.querySelector('.wess__count') || {}).textContent || '', rowsBefore, rowsAfter,
      hasSearch: !!w3.querySelector('.wess__search') }; })()`);
  check(`精华面板：一进来显示「共 ${salon.essences.length} 条」`, new RegExp(`共 ${salon.essences.length} 条`).test(ess.count), ess.count);
  check('精华面板：搜索框在', ess.hasSearch === true, '');
  check('精华面板：「加载更多」能接着往下画（每点一次 +60 条）', ess.rowsAfter === ess.rowsBefore + 60, `${ess.rowsBefore} → ${ess.rowsAfter}`);

  /* 注意：上面点过「加载更多」之后面板整个重画过，按钮得**重新查一次**再点
     （抓着旧节点点等于什么都没发生，第一版就栽在这儿） */
  const form = await cdp.ev(`(async () => {
    const w = [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
    const addBtn = [...w.querySelectorAll('button')].find((b) => b.textContent.includes('新增一条'));
    if (!addBtn) return { ok: false, why: '找不到「＋ 新增一条」' };
    addBtn.click();
    await new Promise((r) => setTimeout(r, 600));
    const w2 = [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
    const box = w2.querySelector('.wess__form');
    if (!box) return { ok: false, why: '点了没出表单' };
    const grid = box.querySelector('.wess__memberGrid');
    const cbs = grid ? [...grid.querySelectorAll('input[type=checkbox]')] : [];
    const kinds = box.querySelector('select');
    return { ok: true, inputs: box.querySelectorAll('input, textarea, select').length,
      checkboxes: cbs.length, checked: cbs.filter((c) => c.checked).length,
      head: (box.querySelector('.wess__membersHead') || {}).textContent || '',
      kindOptions: kinds ? kinds.options.length : 0,
      title: (box.querySelector('.wbox__title') || {}).textContent || '',
      actions: [...box.querySelectorAll('button')].map((b) => b.textContent).slice(0, 6) }; })()`);
  check('精华面板：「＋ 新增一条」点开会出表单，成员是**多选**（每个人一个勾选框，人数 = 成员表人数）',
    form.ok === true && form.checkboxes === salon.members.length && form.inputs >= 4,
    JSON.stringify(form));
  check('精华面板：表单里有「已选 N 人」的提示（这轮要求的多成员入口看得见）',
    /已选|一个人都没选/.test(form.head), JSON.stringify(form.head));

  /* ---------- ④b 多成员：在面板里**改** 2023-07-19 那条（花花、虹星）并真的存盘 ----------
     这是用户最怕丢的一条链路：面板里勾选的人 → 落盘 → 数据里还是多成员。
     全程在副本里，改的是 .tmp/ui-proj/src/data/salon.json，工作区一个字节不动。 */
  const MEMBERS_FILE = path.join(DST, 'src', 'data', 'salon.json');
  const readMembers = (id) => {
    try {
      const d = JSON.parse(fs.readFileSync(MEMBERS_FILE, 'utf8'));
      const e = d.essences.find((x) => x.id === id);
      return e ? e.memberIds.length : -1;
    } catch { return -1; }
  };
  const waitMembers = async (id, expect, ms = 90000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (readMembers(id) === expect) return true;
      await sleep(700);
    }
    return false;
  };

  const openEdit = await cdp.ev(`(async () => {
    await window.__openWs('essences');
    await new Promise((r) => setTimeout(r, 1300));
    const panel = () => [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
    let w = panel();
    const s = w.querySelector('.wess__search');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(s, '剪下指甲');
    s.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1000));
    w = panel();
    const row = [...w.querySelectorAll('.wess__rows li')].find((li) => li.textContent.includes('剪下指甲'));
    if (!row) return { ok: false, why: '搜不到 2023-07-19 那条' };
    const kindTag = (row.querySelector('.wess__kind') || {}).textContent || '';
    const editBtn = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === '编辑');
    if (!editBtn) return { ok: false, why: '这一行没有「编辑」按钮' };
    editBtn.click();
    await new Promise((r) => setTimeout(r, 800));
    w = panel();
    const box = w.querySelector('.wess__form');
    if (!box) return { ok: false, why: '没出编辑表单' };
    const cbs = [...box.querySelectorAll('.wess__memberGrid input[type=checkbox]')];
    const nameOf = (c) => (c.parentElement.querySelector('.wess__memberName') || {}).textContent || '';
    return { ok: true, kindTag, boxes: cbs.length, checked: cbs.filter((c) => c.checked).length,
      checkedNames: cbs.filter((c) => c.checked).map(nameOf),
      head: (box.querySelector('.wess__membersHead') || {}).textContent || '',
      rowText: row.textContent.slice(0, 60) }; })()`);
  /*
    ⚠ 这一条**不能写死成员名字**。
    2023-07-19 那条的两名成员是数据里来的，而成员名随时可能在编辑器里被改
    （实测踩过：用户把「花花」改名成「隰辰煦」，这条断言就凭空失败了）。
    所以期望值现场从副本的 salon.json 里按 memberIds 查出来。
  */
  const e0022 = salon.essences.find((e) => e.id === 'e0022');
  const name2 = (id) => (salon.members.find((m) => m.id === id) || {}).name || '';
  const pairPair = (e0022?.memberIds ?? []).map(name2).filter(Boolean);
  const pairText = pairPair.join('、');
  const second = pairPair[1] || pairPair[0] || '';
  check(`精华面板：点 2023-07-19 那条的「编辑」→ 勾选框里正好勾着 2 个人（${pairText}）`,
    openEdit.ok === true && openEdit.checked === 2 && openEdit.checkedNames.join('、') === pairText,
    JSON.stringify(openEdit));
  check('精华面板：这一行带着「完美对话」类别标签（只给编辑器看，站点页面不分组）',
    /完美对话/.test(openEdit.kindTag || ''), JSON.stringify(openEdit.kindTag));

  /** 保证编辑表单开着（第一轮之后面板会重画，表单没了就得重新搜、重新点「编辑」），
      然后把第二个人（${second}）勾/取消 → 改好了 → 保存并重新构建。
      ⚠ 名字不能写死：成员名会在编辑器里被改，期望值从数据里来（见上面那条注释）。 */
  const editSave = async (wantSecond) => cdp.ev(`(async () => {
    const panel = () => [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
    const setVal = (el, v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    let w = panel();
    if (!w.querySelector('.wess__form')) {
      const rowOf = () => [...(panel()).querySelectorAll('.wess__rows li')].find((li) => li.textContent.includes('剪下指甲'));
      if (!rowOf()) { setVal((panel()).querySelector('.wess__search'), '剪下指甲'); await new Promise((r) => setTimeout(r, 1000)); }
      const row = rowOf();
      if (!row) return { ok: false, why: '搜不到那条精华了' };
      const editBtn = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === '编辑');
      if (!editBtn) return { ok: false, why: '这一行没有「编辑」按钮' };
      editBtn.click();
      await new Promise((r) => setTimeout(r, 800));
    }
    w = panel();
    const box = w.querySelector('.wess__form');
    if (!box) return { ok: false, why: '表单没打开' };
    const cbs = [...box.querySelectorAll('.wess__memberGrid input[type=checkbox]')];
    const target = cbs.find((c) => ((c.parentElement.querySelector('.wess__memberName') || {}).textContent || '') === ${JSON.stringify(second)});
    if (!target) return { ok: false, why: '找不到 ${second} 的勾选框' };
    if (target.checked !== ${wantSecond}) { target.click(); await new Promise((r) => setTimeout(r, 400)); }
    const head = (box.querySelector('.wess__membersHead') || {}).textContent || '';
    const picked = cbs.filter((c) => c.checked).length;
    const done = [...box.querySelectorAll('button')].find((b) => b.textContent.trim() === '改好了');
    if (!done) return { ok: false, why: '找不到「改好了」', picked, head };
    done.click();
    await new Promise((r) => setTimeout(r, 800));
    const bar = (panel()).querySelector('.wpanel__bar');
    const save = bar && [...bar.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存并重新构建');
    if (!save) return { ok: false, why: '找不到「保存并重新构建」', picked, head };
    save.click();
    return { ok: true, picked, head }; })()`);

  const minus = await editSave(false);
  const okMinus = minus.ok === true && minus.picked === 1 && (await waitMembers('e0022', 1));
  check(`多成员编辑：面板里取消勾选「${second}」→「改好了」→「保存并重新构建」→ 盘上那条只剩 1 个成员`,
    okMinus, `${JSON.stringify(minus)}，盘上 memberIds=${readMembers('e0022')}`);

  const plus = await editSave(true);
  const okPlus = plus.ok === true && plus.picked === 2 && (await waitMembers('e0022', 2));
  check(`多成员编辑：再勾回「${second}」存一次 → 盘上又是 2 个成员（来回都能改，不会丢成员）`,
    okPlus, `${JSON.stringify(plus)}，盘上 memberIds=${readMembers('e0022')}`);

  /* ---------- ④c 左边那条时间轴：面板里选一条 → 存盘 → 盘上是那个 id ----------
     用户的原话：「可以在编辑器里选一个时间轴放在那个位置」。选的只是**一个 id**，
     页面那边原样渲染那条轴；所以这里要验的就是"选完存下去，盘上是这个 id，
     而且换成员/改精华的保存不会把它弄丢"。 */
  const tlIds = JSON.parse(fs.readFileSync(path.join(DST, 'src', 'data', 'timelines.json'), 'utf8')).timelines.map((t) => t.id);
  const readTl = () => { try { return JSON.parse(fs.readFileSync(MEMBERS_FILE, 'utf8')).timelineId || ''; } catch { return '?'; } };
  const waitTl = async (expect, ms = 90000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (readTl() === expect) return true; await sleep(700); }
    return false;
  };

  const tlBox = await cdp.ev(`(async () => {
    await window.__openWs('essences');
    await new Promise((r) => setTimeout(r, 1400));
    const w = [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
    const boxes = [...w.querySelectorAll('.wbox')];
    const box = boxes.find((b) => ((b.querySelector('.wbox__title') || {}).textContent || '').includes('时间轴'));
    if (!box) return { ok: false, titles: boxes.map((b) => (b.querySelector('.wbox__title') || {}).textContent) };
    const sel = box.querySelector('select');
    return { ok: true, value: sel.value, options: [...sel.options].map((o) => o.value + '|' + o.textContent),
      hint: (box.querySelector('.wbox__hint') || {}).textContent || '' }; })()`);
  check('精华面板里有「左边那条时间轴」的下拉，选中的就是盘上那条（选项来自站点的时间轴清单）',
    tlBox.ok === true && tlBox.value === readTl() && tlBox.options.length === tlIds.length + 1,
    JSON.stringify(tlBox));

  /*
    ⚠ 这一步必须**等界面空下来**再动第二次：
    「保存并重新构建」按下去之后按钮会变成「正在保存…」、面板还会整块重画
    （saveSalon 里 `await loadSalon()`），保存 + 构建要好几秒。
    直接找按钮会扑空（报"找不到「保存并重新构建」"，而其实只是正在保存中），
    所以这里先轮询等一个**可点的**保存按钮，再重新查一次 select/按钮（旧引用可能已经被重画掉）。
  */
  const setTl = async (id) => cdp.ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    /*
      ⚠ 面板要**按内容认**，不能只挑"第一个可见的 .wpanel"：
      编辑器里同时挂着的面板不止一个（成员/精华/日历…），
      只按可见挑的时候，我这边读到的是精华面板的下拉，
      点下去却可能点到另一个面板的「保存并重新构建」——
      表现就是"点了保存但盘上没变"（这个坑真踩到过）。
      精华面板的特征：里面有「左边那条时间轴」这一块。
    */
    const salonPanel = () => [...document.querySelectorAll('.wpanel')]
      .filter((el) => el.getBoundingClientRect().height > 0)
      .find((w) => [...w.querySelectorAll('.wbox__title')].some((t) => (t.textContent || '').includes('时间轴')));
    const saveBtn = (w) => {
      const bar = w && w.querySelector('.wpanel__bar');
      const b = bar && [...bar.querySelectorAll('button')].find((x) => x.textContent.trim() === '保存并重新构建');
      return b && !b.disabled && b.isConnected ? b : null;
    };
    /* 上一轮保存 + 重新构建要好几秒，等它空下来再动（否则按钮还是「正在保存…」） */
    const t0 = Date.now();
    while (!saveBtn(salonPanel())) {
      if (Date.now() - t0 > 60000) return { ok: false, why: '等了 60 秒也没等到精华面板上可点的「保存并重新构建」' };
      await sleep(300);
    }
    const w = salonPanel();
    const box = [...w.querySelectorAll('.wbox')].find((b) => ((b.querySelector('.wbox__title') || {}).textContent || '').includes('时间轴'));
    if (!box) return { ok: false, why: '精华面板里找不到「左边那条时间轴」那一块' };
    const sel = box.querySelector('select');
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    set.call(sel, ${JSON.stringify(id)});
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(400);
    const status = [...salonPanel().querySelectorAll('.wpanel__status')].map((s) => s.textContent).filter(Boolean);
    const value = sel.value;
    const save = saveBtn(salonPanel());
    if (!save) return { ok: false, why: '找不到可点的「保存并重新构建」', value, status };
    save.click();
    return { ok: true, value, status }; })()`);

  const other = tlIds.find((id) => id !== readTl());
  const sw1 = await setTl(other);
  const okSw1 = sw1.ok === true && (await waitTl(other));
  check(`时间轴选择：面板里换成另一条（${other}）→ 存盘 → salon.json 的 timelineId 就是它`,
    okSw1, `${JSON.stringify(sw1)}，盘上 timelineId=${readTl()}`);

  const back = readTl() === other ? tlIds.find((id) => id !== other) : '';
  const sw2 = back ? await setTl(back) : { ok: false, why: '没有可换回去的 id' };
  const okSw2 = sw2.ok === true && (await waitTl(back));
  check(`时间轴选择：换回原来那条（${back}）→ 存盘 → 盘上也跟着回去（来回都能改）`,
    okSw2, `${JSON.stringify(sw2)}，盘上 timelineId=${readTl()}`);

  /* ---------- ⑤ 冰山图面板（src/data/iceberg.json） ----------
     这一轮新加的整块：分类 / 标签 / 层级 / 条目四样都能在面板里建、改、删、排序，
     存下去之后**站点那一页真的跟着变**（最后一条会去副本的构建产物里找新条目）。
     期望值全部从副本的数据里现算，不写死名字和条数。 */
  const ICE_FILE = path.join(DST, 'src', 'data', 'iceberg.json');
  const readIce = () => JSON.parse(fs.readFileSync(ICE_FILE, 'utf8'));
  const ice0 = readIce();
  const iceLayer0 = ice0.layers[0];
  const iceItems0 = iceLayer0.items.length;
  const iceDone0 = iceLayer0.items.filter((i) => String(i.desc ?? '').trim()).length;
  const NEW_CAT = '验收分类';
  const NEW_COLOR = '#00ff88';
  const NEW_ITEM = '验收新条目';
  const NEW_DESC = '验收用的详细描述：填了它就该有完备标识。';

  const iceUi = await cdp.ev(`(async () => {
    await window.__openWs('ice-chart');
    await new Promise((r) => setTimeout(r, 1400));
    /* ⚠ 面板要**按内容认**（有 .wice 的那个）：编辑器里同时挂着的面板不止一个，
       只挑"第一个可见的 .wpanel"会读到别的面板上去（这个坑这个文件里踩过一次）。 */
    const w = [...document.querySelectorAll('.wpanel')]
      .filter((el) => el.getBoundingClientRect().height > 0)
      .find((el) => el.querySelector('.wice'));
    if (!w) return { ok: false, why: '面板没开' };
    const boxOf = (kw) => [...w.querySelectorAll('.wbox')].find((b) => ((b.querySelector('.wbox__title') || {}).textContent || '').includes(kw));
    const catBox = boxOf('分类');
    const tagBox = boxOf('标签');
    const layBox = boxOf('层级');
    const itemBox = boxOf('条目');
    const cats = [...(catBox?.querySelectorAll('.wice__cat') ?? [])];
    const tags = [...(tagBox?.querySelectorAll('.wice__tag') ?? [])];
    const lays = [...(layBox?.querySelectorAll('.wice__layer') ?? [])];
    const items = [...(itemBox?.querySelectorAll('.wice__item') ?? [])];
    return {
      ok: true,
      cols: w.querySelectorAll('.wice__col').length,
      cats: cats.length,
      catNames: cats.map((c) => (c.querySelector('input.wice__name') || {}).value || ''),
      catColors: cats.map((c) => (c.querySelector('input[type=color]') || {}).value || ''),
      catEyes: cats.map((c) => (c.querySelector('.wice__eye') || {}).textContent || ''),
      tags: tags.length,
      tagNames: tags.map((t) => (t.querySelector('input.wice__name') || {}).value || ''),
      tagUsed: tags.map((t) => (t.querySelector('.wice__used') || {}).textContent || ''),
      layers: lays.length,
      layerTitles: lays.map((l) => (l.querySelector('.wice__pick b') || {}).textContent || ''),
      layerOps: lays.map((l) => l.querySelectorAll('.wice__ops button').length),
      itemRows: items.length,
      itemNames: items.map((it) => (it.querySelector('.wice__itemName') || {}).textContent || ''),
      itemVia: items.map((it) => (it.querySelector('.wice__itemVia') || {}).textContent || ''),
      doneBadges: items.filter((it) => ((it.querySelector('.wice__badge') || {}).textContent || '') === '完备').length,
      offBadges: items.filter((it) => ((it.querySelector('.wice__badge') || {}).textContent || '').includes('缺描述')).length,
      sum: (w.querySelector('.wice__sum') || {}).textContent || '',
      hasSearch: !!w.querySelector('.wice__search'),
      imgRows: w.querySelectorAll('.wice__imgrow').length,
      files: w.querySelectorAll('input[type=file]').length,
      adds: [...w.querySelectorAll('button')].map((b) => b.textContent).filter((t) => /新增|新建|添加/.test(t)),
      count: (itemBox?.querySelector('.wess__count') || {}).textContent || '',
    }; })()`);
  check('冰山图面板：三栏（分类标签 / 层级 / 条目）都在',
    iceUi.ok === true && iceUi.cols === 3, JSON.stringify({ cols: iceUi.cols }));
  check(`冰山图面板：分类 ${ice0.categories.length} 行（名字框 + 取色器 + 显示开关都有）、颜色 = 盘上的颜色`,
    iceUi.cats === ice0.categories.length &&
      iceUi.catColors.join(',') === ice0.categories.map((c) => String(c.color).toLowerCase()).join(',') &&
      iceUi.catNames.every((n) => n.length > 0) &&
      iceUi.catEyes.every((t) => t === '显示' || t === '隐藏'),
    JSON.stringify({ cats: iceUi.cats, colors: iceUi.catColors, eyes: iceUi.catEyes }));
  check(`冰山图面板：标签 ${ice0.tags.length} 个，每个都写着有几条在用`,
    iceUi.tags === ice0.tags.length && iceUi.tagUsed.every((t) => /条在用|还没人用/.test(t)),
    JSON.stringify({ tags: iceUi.tags, used: iceUi.tagUsed }));
  check(`冰山图面板：层级 ${ice0.layers.length} 行、每行 ↑↓✕ 三个按钮、顺序和盘上一致`,
    iceUi.layers === ice0.layers.length && iceUi.layerOps.every((n) => n === 3) &&
      iceUi.layerTitles.join('|') === ice0.layers.map((l) => l.title || '（还没有标题）').join('|'),
    JSON.stringify({ layers: iceUi.layers, titles: iceUi.layerTitles }));
  check(`冰山图面板：第一层的 ${iceItems0} 条都列出来了，名字对得上`,
    iceUi.itemRows === iceItems0 && iceUi.itemNames.join('|') === iceLayer0.items.map((i) => i.name || '（还没有名字）').join('|'),
    JSON.stringify({ rows: iceUi.itemRows, names: iceUi.itemNames }));
  check(`冰山图面板：完备标识 = 有详细描述的那 ${iceDone0} 条（剩下的写着「缺描述」）`,
    iceUi.doneBadges === iceDone0 && iceUi.offBadges === iceItems0 - iceDone0,
    JSON.stringify({ done: iceUi.doneBadges, off: iceUi.offBadges }));
  check('冰山图面板：有搜索框、有「这一层」的背景图 / 头图两个上传口、（＋ 新增分类 / 新建层级 / 新增条目）三个入口',
    iceUi.hasSearch === true && iceUi.imgRows === 2 && iceUi.files >= 2 && iceUi.adds.length >= 3,
    JSON.stringify({ imgRows: iceUi.imgRows, files: iceUi.files, adds: iceUi.adds }));
  check('冰山图面板：底栏写着「N 分类 · N 标签 · N 层 · N 条（N 完备）」',
    /分类/.test(iceUi.sum) && /标签/.test(iceUi.sum) && /层/.test(iceUi.sum) && /完备/.test(iceUi.sum),
    iceUi.sum);

  /* ⑤b 新增分类 → 新增条目（选这个新分类、勾一个 tag、写描述）→ 完成 → 层级 ↓ 调序 */
  const iceEdit = await cdp.ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    /* 按内容认面板（见上面 iceUi 那条注释） */
    const panel = () => [...document.querySelectorAll('.wpanel')]
      .filter((el) => el.getBoundingClientRect().height > 0)
      .find((el) => el.querySelector('.wice'));
    const setVal = (el, v) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const boxOf = (w, kw) => [...w.querySelectorAll('.wbox')].find((b) => ((b.querySelector('.wbox__title') || {}).textContent || '').includes(kw));
    const clickText = (root, txt) => [...root.querySelectorAll('button')].find((b) => b.textContent.includes(txt));

    let w = panel();
    clickText(w, '新增分类').click();
    await sleep(700);
    w = panel();
    const cats = [...boxOf(w, '分类').querySelectorAll('.wice__cat')];
    const last = cats[cats.length - 1];
    setVal(last.querySelector('input.wice__name'), ${JSON.stringify(NEW_CAT)});
    setVal(last.querySelector('input[type=color]'), ${JSON.stringify(NEW_COLOR)});
    await sleep(300);
    const catCount = cats.length;

    clickText(w, '新增条目').click();
    await sleep(700);
    w = panel();
    const form = w.querySelector('.wice__form');
    if (!form) return { ok: false, why: '新增条目没出表单' };
    const nameInput = form.querySelector('.wice__form input.input');
    setVal(nameInput, ${JSON.stringify(NEW_ITEM)});
    const sel = form.querySelector('select.wice__select');
    const newOpt = [...sel.options].find((o) => o.textContent.includes(${JSON.stringify(NEW_CAT)}));
    if (!newOpt) return { ok: false, why: '新增的分类没出现在下拉里' };
    sel.value = newOpt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const firstTag = form.querySelector('.wess__memberGrid input[type=checkbox]');
    if (firstTag) { firstTag.click(); await sleep(200); }
    const area = form.querySelector('textarea');
    setVal(area, ${JSON.stringify(NEW_DESC)});
    await sleep(300);
    const state = (form.querySelector('.wice__descState') || {}).textContent || '';
    const stateOn = !!(form.querySelector('.wice__descState') || {}).classList?.contains('is-on');
    clickText(form, '完成').click();
    await sleep(800);

    w = panel();
    const rows = [...boxOf(w, '条目').querySelectorAll('.wice__item')];
    const added = rows.find((r) => ((r.querySelector('.wice__itemName') || {}).textContent || '') === ${JSON.stringify(NEW_ITEM)});
    /* 层级调序：把第一层的 ↓ 点一下 */
    const layRows = [...boxOf(w, '层级').querySelectorAll('.wice__layer')];
    const beforeTitles = layRows.map((l) => (l.querySelector('.wice__pick b') || {}).textContent || '');
    [...layRows[0].querySelectorAll('.wice__ops button')].find((b) => b.textContent === '↓').click();
    await sleep(700);
    w = panel();
    const afterTitles = [...boxOf(w, '层级').querySelectorAll('.wice__layer')].map((l) => (l.querySelector('.wice__pick b') || {}).textContent || '');

    return { ok: true, catCount, state, stateOn,
      itemRows: rows.length,
      added: added ? { badge: (added.querySelector('.wice__badge') || {}).textContent || '',
        via: (added.querySelector('.wice__itemVia') || {}).textContent || '' } : null,
      beforeTitles, afterTitles,
      status: [...panel().querySelectorAll('.wpanel__status')].map((s) => s.textContent).filter(Boolean) }; })()`);
  check(`冰山图面板：＋ 新增分类 → 多一行「${NEW_CAT}」`,
    iceEdit.ok === true && iceEdit.catCount === ice0.categories.length + 1, JSON.stringify({ catCount: iceEdit.catCount }));
  check('冰山图面板：新增条目 → 表单里名字 / 分类下拉 / tag 勾选框 / 描述 / 链接都在，描述一写就提示「会有完备标识」',
    iceEdit.ok === true && iceEdit.stateOn === true && /会有完备标识/.test(iceEdit.state),
    JSON.stringify({ state: iceEdit.state }));
  check(`冰山图面板：按「完成」→ 这一层多出「${NEW_ITEM}」，而且它带着完备标识、归在新分类下`,
    iceEdit.ok === true && iceEdit.added?.badge === '完备' && iceEdit.added?.via.includes(NEW_CAT) && iceEdit.itemRows === iceItems0 + 1,
    JSON.stringify(iceEdit.added));
  check('冰山图面板：层级 ↓ 能把两层换个位置（顺序是在面板里调的）',
    iceEdit.ok === true && iceEdit.afterTitles[0] === iceEdit.beforeTitles[1] && iceEdit.afterTitles[1] === iceEdit.beforeTitles[0],
    JSON.stringify({ before: iceEdit.beforeTitles, after: iceEdit.afterTitles }));
  check('冰山图面板：改完状态栏写着「有改动没保存」', Array.isArray(iceEdit.status) && iceEdit.status.some((s) => /保存/.test(s)), JSON.stringify(iceEdit.status));

  /* ⑤c 保存并重新构建 → 盘上的 iceberg.json → 副本构建出来的 /iceberg/ 页面 */
  const readIceItem = () => {
    try {
      const d = readIce();
      const l = d.layers.flatMap((x) => x.items).find((i) => i.name === NEW_ITEM);
      return l ? JSON.stringify(l) : '';
    } catch { return ''; }
  };
  const waitIce = async (ms = 120000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (readIceItem()) return true;
      await sleep(800);
    }
    return false;
  };
  const iceSave = await cdp.ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const panel = () => [...document.querySelectorAll('.wpanel')]
      .filter((el) => el.getBoundingClientRect().height > 0)
      .find((el) => el.querySelector('.wice'));
    const save = () => {
      const w = panel();
      const bar = w && w.querySelector('.wpanel__bar');
      const b = bar && [...bar.querySelectorAll('button')].find((x) => x.textContent.trim() === '保存并重新构建' && !x.disabled);
      return b || null;
    };
    /* 顺手记一笔网络：保存这一步要是卡住，失败详情里能看出请求到底发出去没有、卡在哪 */
    window.__net = [];
    const of = window.fetch;
    window.fetch = async (...a) => {
      const t0 = Date.now();
      try {
        const r = await of(...a);
        window.__net.push({ url: String(a[0]), status: r.status, ms: Date.now() - t0 });
        return r;
      } catch (e) {
        window.__net.push({ url: String(a[0]), err: String(e && e.message || e), ms: Date.now() - t0 });
        throw e;
      }
    };
    const t0 = Date.now();
    while (!save()) { if (Date.now() - t0 > 60000) return { ok: false, why: '等不到可点的保存按钮' }; await sleep(300); }
    save().click();
    /* 只负责"点下去"：保存结果由 Node 这边独立盯盘上的文件和构建产物，
       就算浏览器这一趟卡住（构建慢），证据也不受影响 */
    return { ok: true }; })()`);
  const iceSaved = iceSave.ok === true && (await waitIce(120000));
  const ice1 = readIce();
  const savedItem = ice1.layers.flatMap((l) => l.items).find((i) => i.name === NEW_ITEM);
  const savedCat = ice1.categories.find((c) => c.name === NEW_CAT);
  check(`★ 冰山图：面板里「保存并重新构建」→ 盘上 src/data/iceberg.json 真有「${NEW_ITEM}」`,
    iceSaved, `${JSON.stringify(iceSave)}；盘上 ${readIceItem() || '（没有）'}`);
  check('★ 冰山图：存下去的条目带着详细描述（= 页面上会有完备标识）',
    String(savedItem?.desc ?? '').trim() === NEW_DESC, JSON.stringify(savedItem?.desc ?? ''));
  check(`★ 冰山图：存下去的分类颜色就是面板里选的那个（${NEW_COLOR}），条目也真的归在它下面`,
    savedCat?.color === NEW_COLOR && savedItem?.categoryId === savedCat?.id,
    JSON.stringify({ color: savedCat?.color, catId: savedCat?.id, itemCat: savedItem?.categoryId }));
  check('★ 冰山图：层级的顺序也存下去了（面板里换过位置 → 盘上跟着换）',
    ice1.layers[0]?.title === ice0.layers[1]?.title && ice1.layers[1]?.title === ice0.layers[0]?.title,
    ice1.layers.map((l) => l.title).join(' | '));
  check('冰山图：没有多存 / 少存别的层级和分类（层数没变、分类正好 +1）',
    ice1.layers.length === ice0.layers.length && ice1.categories.length === ice0.categories.length + 1,
    `${ice1.layers.length} 层 / ${ice1.categories.length} 分类`);

  /*
    页面上真的出现了：副本构建出来的 dist/iceberg/index.html。
    构建这一步在编辑器（服务端）里是**同步等完**才回响应的，慢的时候要几十秒 ——
    所以这里独立轮询 240 秒，不跟浏览器那一趟的等待绑在一起。
  */
  const iceDist = path.join(DST, 'dist', 'iceberg', 'index.html');
  let iceHtml = '';
  for (let i = 0; i < 240 && !iceHtml; i++) {
    try {
      const t = fs.readFileSync(iceDist, 'utf8');
      if (t.includes(NEW_ITEM)) iceHtml = t;
    } catch { /* 还没构建好 */ }
    if (!iceHtml) await sleep(1000);
  }
  const net = await cdp.ev('JSON.stringify(window.__net || [])');
  check(`★ 冰山图：站点那一页（构建产物 dist/iceberg/index.html）里真出现了「${NEW_ITEM}」—— 面板 → 数据 → 页面整条链路通了`,
    iceHtml.includes(NEW_ITEM) && iceHtml.includes(NEW_COLOR),
    iceHtml ? `产物 ${iceHtml.length} 字节，条目和颜色都在` : `产物里没找到；这一趟的网络：${net}`);

  /*
    构建产物都出来了 → 保存那一次请求肯定已经回来了，这时候读面板的提示才准。
    ⚠ 但要**等它**：产物里出现新条目这件事，可能是上一轮构建（用户在别的面板刚存的）
    顺手就做完了 —— 那时候本次保存的响应还没回来，读到的是上一条 toast（踩过）。
  */
  let iceToast = '';
  for (let i = 0; i < 120 && !/冰山图已保存|保存失败/.test(iceToast); i++) {
    iceToast = await cdp.ev(`(document.querySelector('#toast') || {}).textContent || ''`);
    if (!/冰山图已保存|保存失败/.test(iceToast)) await sleep(500);
  }
  check('★ 冰山图：这次保存的构建面板自己也是这么报的（「已保存并重新构建」）',
    /冰山图已保存并重新构建/.test(String(iceToast)), `toast「${String(iceToast).slice(0, 80)}」`);

  /* ---------- ⑥ 草稿保护：改字 → 切走 → 切回来 ---------- */
  const draft = await cdp.ev(`(async () => {
    await window.__openWs('calendar');
    await new Promise((r) => setTimeout(r, 900));
    const w = [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
    const ta = w.querySelector('textarea');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(ta, '验收草稿一句话');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    await window.__openWs('about');
    await new Promise((r) => setTimeout(r, 700));
    await window.__openWs('calendar');
    await new Promise((r) => setTimeout(r, 900));
    const w2 = [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
    const ta2 = w2.querySelector('textarea');
    const status = [...w2.querySelectorAll('.wpanel__status')].map((s) => s.textContent).filter(Boolean);
    return { kept: ta2.value, status, dirty: status.some((s) => /保存/.test(s)) }; })()`);
  check('草稿保护：改过的字切走再切回来还在', draft.kept === '验收草稿一句话', JSON.stringify(draft.kept));
  check('草稿保护：切回来后状态栏仍然写着「有改动没保存」（不会假装存过了）', draft.dirty === true, JSON.stringify(draft.status));

  /* ---------- ⑦ 「上方位置链接」那两个编辑口子（子版块面板 / 页面工作台） ----------
     用户原话：「注意到导航栏若是选择了纷湖 上方会有可以点击的纷湖二字 如果预留了点击位
     那么请加入可以编辑点击跳转到的链接的接口」。
     面板里填的那一项，要真的落进 draft（保存后写进 home-boards.json 的 crumbHref）。 */
  const CRUMB_TO = '/salon/';
  const crumbUi = await cdp.ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const setVal = (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    /* ① 子版块面板：每一行第二排都有一个「上方位置链接」输入框 */
    await window.__openWs('boards');
    await sleep(1800);
    const modal = document.querySelector('#boards-modal');
    const inputs = [...(modal ? modal.querySelectorAll('input.boardedit__crumb') : [])];
    return { ok: inputs.length > 0, count: inputs.length, placeholder: inputs[0] ? inputs[0].placeholder : '', first: inputs[0] ? inputs[0].value : '' };
  })()`);
  check(`子版块面板：每个版块都有一个「上方位置链接」输入框（共 ${crumbUi.count} 个）`,
    crumbUi.ok === true && /上方位置链接/.test(crumbUi.placeholder || ''),
    JSON.stringify(crumbUi));

  const crumbSave = await cdp.ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const modal = document.querySelector('#boards-modal');
    const input = modal && modal.querySelector('input.boardedit__crumb');
    if (!input) return { ok: false, why: '找不到输入框' };
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(CRUMB_TO)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);
    const save = [...modal.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存');
    if (!save) return { ok: false, why: '找不到保存按钮' };
    save.click();
    await sleep(1500);
    return { ok: true, value: input.value };
  })()`);
  const boardsFile = path.join(DST, 'src', 'data', 'home-boards.json');
  const crumbWritten = (() => {
    try {
      const t = JSON.parse(fs.readFileSync(boardsFile, 'utf8'));
      const walk = (list) => {
        for (const n of list ?? []) {
          if (n?.crumbHref === CRUMB_TO) return n;
          const hit = walk(n?.children);
          if (hit) return hit;
        }
        return null;
      };
      return walk(t.boards);
    } catch { return null; }
  })();
  check(`★ 在面板里给某个版块填「${CRUMB_TO}」→ 保存 → 盘上那个节点真的带上了 crumbHref`,
    crumbSave.ok === true && !!crumbWritten,
    `${JSON.stringify(crumbSave)}｜盘上 ${crumbWritten ? crumbWritten.id || crumbWritten.title : '（没有）'}`);

  const crumbPageUi = await cdp.ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await window.__openWs('pages');
    await sleep(2000);
    const labels = [...document.querySelectorAll('#pw-fields .pw-field__label')].map((l) => l.textContent.trim());
    const field = [...document.querySelectorAll('#pw-fields .pw-field')]
      .find((f) => (f.querySelector('.pw-field__label') || {}).textContent === '上方位置链接');
    return { labels, has: !!field, hint: field ? (field.querySelector('.pw-field__hint') || {}).textContent || '' : '',
      value: field ? (field.querySelector('input') || {}).value || '' : '' };
  })()`);
  check('★ 页面工作台里也有「上方位置链接」这一项（带说明：留空 = 回它自己那页）',
    crumbPageUi.has === true && /留空/.test(crumbPageUi.hint || ''),
    JSON.stringify({ has: crumbPageUi.has, hint: (crumbPageUi.hint || '').slice(0, 60), 面板字段: crumbPageUi.labels.slice(0, 8) }));

  /* ---------- ⑧ 「导航」面板里那个「顶栏点它去哪」 ----------
     用户原话：「我说的是这个导航二字旁边的纷湖 为什么可以点 点了根本没反应
     要么加可以写链接的接口要么删掉」。所以面板里得能填这个链接，而且填完要落盘。 */
  const NAV_LINK_TO = '/salon/';
  const navUi = await cdp.ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await window.__openWs('navs');
    await sleep(2200);
    const field = [...document.querySelectorAll('.nv-field')]
      .find((f) => (f.querySelector('.nv-field__label') || {}).textContent === '顶栏点它去哪');
    const input = field ? field.querySelector('input') : null;
    return {
      has: !!field,
      placeholder: input ? input.placeholder : '',
      hint: field ? ((field.querySelector('.nv-field__hint') || {}).textContent || '') : '',
      labels: [...document.querySelectorAll('.nv-field__label')].map((l) => l.textContent),
    };
  })()`);
  check('★ 「导航」面板里多了一项「顶栏点它去哪」（填的就是那个分类名点击后的地址）',
    navUi.has === true && /留空/.test(navUi.placeholder || ''),
    JSON.stringify({ has: navUi.has, placeholder: navUi.placeholder, 面板字段: navUi.labels }));

  const navSave = await cdp.ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const field = [...document.querySelectorAll('.nv-field')]
      .find((f) => (f.querySelector('.nv-field__label') || {}).textContent === '顶栏点它去哪');
    const input = field && field.querySelector('input');
    if (!input) return { ok: false, why: '找不到输入框' };
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(NAV_LINK_TO)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);
    const save = document.querySelector('#navs-save');
    if (!save) return { ok: false, why: '找不到保存按钮' };
    save.click();
    await sleep(2500);
    return { ok: true, value: input.value };
  })()`);
  const navWritten = (() => {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(DST, 'src', 'data', 'navs.json'), 'utf8'));
      return (t.categories ?? []).find((c) => c.link === NAV_LINK_TO)?.title ?? null;
    } catch { return null; }
  })();
  check(`★ 在「导航」面板里填「${NAV_LINK_TO}」→ 保存 → 盘上的 navs.json 里那个分类真带上了 link`,
    navSave.ok === true && !!navWritten,
    `${JSON.stringify(navSave)}｜盘上：${navWritten ?? '（没有）'}`);

  /* ---------- ⑨ 「这一页的内容」那排「＋ 文字 / ＋ 图片 / …」一直吸在下方 ----------
     用户原话：「在编辑【这一页的内容】时，不论怎样滚动滚轮 那些+文字 +图片 +链接等选项
     可以始终保持在UI下方 不需要在一个地方点加号插入 然后滚到最下面点+文字
     然后又滚回去编辑了」。 */
  const stickyBar = await cdp.ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await window.__openWs('pages');
    await sleep(2000);
    const col = document.querySelector('.pstudio__col--edit');
    const bar = document.querySelector('.pblock-add');
    if (!col || !bar) return { ok: false, why: '找不到编辑区或那排按钮' };
    const boxOf = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }; };
    const cs = getComputedStyle(bar);
    col.scrollTop = 0;
    await sleep(250);
    const atTop = { col: boxOf(col), bar: boxOf(bar), scrollTop: Math.round(col.scrollTop) };
    /* 滚到最底下：这一排必须还在编辑区可见范围里 */
    col.scrollTop = col.scrollHeight;
    await sleep(400);
    const atBottom = { col: boxOf(col), bar: boxOf(bar), scrollTop: Math.round(col.scrollTop), scrollH: Math.round(col.scrollHeight) };
    /* 滚到中间：一样要在 */
    col.scrollTop = Math.round(col.scrollHeight / 2);
    await sleep(400);
    const atMid = { col: boxOf(col), bar: boxOf(bar), scrollTop: Math.round(col.scrollTop) };
    /* 那个坐标上点得到的真是它（没被别的东西压住） */
    const r = bar.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    const buttons = [...bar.querySelectorAll('button')].map((b) => b.textContent.trim());
    return {
      ok: true, position: cs.position, bottom: cs.bottom,
      atTop, atBottom, atMid,
      hitInBar: !!hit && (hit === bar || bar.contains(hit)),
      buttons,
    };
  })()`);
  console.log('\n================ 「这一页的内容」那排按钮 ================');
  console.log(JSON.stringify(stickyBar));
  const inView = (s) => s && s.bar.top >= s.col.top - 2 && s.bar.bottom <= s.col.bottom + 12;
  check('⑨★ 那排「＋ 文字 / ＋ 图片 / …」是 sticky 贴在编辑区下方的',
    stickyBar.ok === true && stickyBar.position === 'sticky',
    `position=${stickyBar.position} bottom=${stickyBar.bottom}`);
  check('⑨★ 滚到**最底下**它还在编辑区可见范围里（不用再滚回去找加号）',
    inView(stickyBar.atBottom), JSON.stringify({ col: stickyBar.atBottom?.col, bar: stickyBar.atBottom?.bar }));
  check('⑨★ 滚到**中间**也在（编辑哪一段都够得着）',
    inView(stickyBar.atMid), JSON.stringify({ col: stickyBar.atMid?.col, bar: stickyBar.atMid?.bar }));
  check('⑨ 那个位置点得到的确实是这一排（没被内容压住），而且按钮齐（文字/图片/链接…）',
    stickyBar.hitInBar === true && (stickyBar.buttons ?? []).length >= 10 &&
      ['＋ 文字', '＋ 图片', '＋ 链接'].every((t) => (stickyBar.buttons ?? []).includes(t)),
    JSON.stringify(stickyBar.buttons));

  check('这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));

  try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch { /* 已退出 */ }
  await sleep(250);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
} catch (err) {
  fail++;
  console.log('FAIL  脚本异常: ' + (err?.stack ?? err));
} finally {
  try { editor.kill(); } catch { /* ignore */ }
  try { execSync(`taskkill /pid ${editor.pid} /T /F`, { stdio: 'ignore' }); } catch { /* ignore */ }
  await sleep(400);
  for (const j of ['node_modules', 'public']) {
    const p = path.join(DST, j);
    if (fs.existsSync(p)) { try { execSync(`cmd /c rmdir "${p}"`, { stdio: 'ignore' }); } catch { /* ignore */ } }
  }
  try { fs.rmSync(DST, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log('副本已清理:', !fs.existsSync(DST));
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
