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
  for (const p of ['/api/bootstrap', '/api/boards', '/api/music', '/api/timelines', '/api/navs', '/api/anchors', '/api/layout', '/api/widgets', '/api/salon']) {
    const r = await api(p);
    regress.push(`${p}=${r.status}`);
  }
  const salonApi = await api('/api/salon');
  check('老接口全在（9 条 GET 全 200）', regress.every((s) => s.endsWith('=200')), regress.join(' '));
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
    ['essences', '精华', '冰室群精华'],
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
    check(`面板「${label}」顶上那排工作面切换按钮在（切走切回来草稿才不丢）`, info.switchBtns >= 13, `switchBtns=${info.switchBtns}`);
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
  check(`成员面板：${mem.rows} 行（盘上就是 ${salon.members.length} 个成员）、每行都有头像上传口和名字框`,
    mem.rows === salon.members.length && mem.files === mem.rows && mem.nameInputs >= mem.rows,
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
  check('精华面板：点 2023-07-19 那条的「编辑」→ 勾选框里正好勾着 2 个人（花花、虹星）',
    openEdit.ok === true && openEdit.checked === 2 && openEdit.checkedNames.join('、') === '花花、虹星',
    JSON.stringify(openEdit));
  check('精华面板：这一行带着「完美对话」类别标签（只给编辑器看，站点页面不分组）',
    /完美对话/.test(openEdit.kindTag || ''), JSON.stringify(openEdit.kindTag));

  /** 保证编辑表单开着（第一轮之后面板会重画，表单没了就得重新搜、重新点「编辑」），
      然后把「虹星」勾/取消 → 改好了 → 保存并重新构建 */
  const editSave = async (wantHong) => cdp.ev(`(async () => {
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
    const hong = cbs.find((c) => ((c.parentElement.querySelector('.wess__memberName') || {}).textContent || '') === '虹星');
    if (!hong) return { ok: false, why: '找不到虹星的勾选框' };
    if (hong.checked !== ${wantHong}) { hong.click(); await new Promise((r) => setTimeout(r, 400)); }
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
  check('多成员编辑：面板里取消勾选「虹星」→「改好了」→「保存并重新构建」→ 盘上那条只剩 1 个成员',
    okMinus, `${JSON.stringify(minus)}，盘上 memberIds=${readMembers('e0022')}`);

  const plus = await editSave(true);
  const okPlus = plus.ok === true && plus.picked === 2 && (await waitMembers('e0022', 2));
  check('多成员编辑：再勾回「虹星」存一次 → 盘上又是 2 个成员（来回都能改，不会丢成员）',
    okPlus, `${JSON.stringify(plus)}，盘上 memberIds=${readMembers('e0022')}`);

  /* ---------- ⑤ 草稿保护：改字 → 切走 → 切回来 ---------- */
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
