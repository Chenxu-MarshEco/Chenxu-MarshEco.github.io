/*
 * ============================================================================
 * 「导航」面板右栏预览：别再让人手动滚下去找自己正在编的那一节
 * ----------------------------------------------------------------------------
 * 用户 2026-10-12 的原话：
 *   「在编写导航时 如图所示 右边的预览处完全看不到花娅地的导航预览 并且如果把上面三栏
 *     导航收起来以看到花娅地导航预览的话 一但点击添加新条目 原来收起的导航又会全部展开
 *     导致再次无法预览花娅地的导航 必须往下滚动才能看到 非常麻烦」
 *
 * 两个毛病、两个原因，这里逐条量死：
 *   ① 预览整栏跟着面板一起滚（左中右三栏共用一个滚动条）—— 滚下去看预览，中栏输入框跑了；
 *      → 现在预览那一栏 **sticky + 自己一条滚动条**（.nv-pv 的 position/overflow）；
 *   ② 展开状态**没记住**：以前每次重画都 `open = true`，而「＋ 加条目」会整块重画
 *      —— 刚收起来的几节立刻被打回展开；
 *      → 现在收起来的分类记在 navPreviewFolded 里，重画之后照样是收着的。
 *   另外：换到哪一类就**自动滚到哪一节**，加了一条就滚到那一条（不用人再往下拖）。
 *
 * 量法是**真编辑器 + 真浏览器**（点真按钮、读真 DOM 的 scrollTop / open 状态）。
 * ⚠ 全程**不点保存**：只动内存里的草稿，跑完这个脚本自己退出，仓库里的 navs.json 一个字节不变
 *   （脚本最后会核对这一点）。
 *
 * 用法：node tools/checks/editor-navs-preview-check.mjs
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromePath } from './lib/chrome.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = path.join(SRC, 'tools', 'editor', 'server.mjs');
const NAVS_FILE = path.join(SRC, 'src', 'data', 'navs.json');
const CHROME = chromePath();
const PORT = 4338;
const DEBUG_PORT = 9417;
const EDITOR = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

/* 开跑之前先记下 navs.json 的样子，跑完核对没被动过 */
const navsBefore = fs.readFileSync(NAVS_FILE, 'utf8');

/* ---- 数据里得真有"好几个分类"才量得出这件事 ---- */
const cats = JSON.parse(navsBefore).categories ?? [];
info(`仓库里现在有 ${cats.length} 个大分类：${cats.map((c) => c.title).join(' / ')}`);
if (cats.length < 3) {
  console.error('分类太少了，量不出"上面几节把下面那一节顶下去"这件事');
  process.exit(2);
}

const api = (p) =>
  new Promise((resolve, reject) => {
    const req = http.request(`${EDITOR}${p}`, { method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });

let editor = null;
let chrome = null;
let profile = '';
try {
  editor = spawn(process.execPath, [SERVER, '--port', String(PORT)], { cwd: SRC, stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 60 && !up; i += 1) {
    await sleep(400);
    try {
      up = (await api('/api/navs')).status === 200;
    } catch {
      /* 还没起来 */
    }
  }
  if (!up) throw new Error(`编辑器 ${PORT} 没起来`);
  info(`编辑器起来了（${EDITOR}）`);

  profile = path.join(process.env.TEMP ?? '.', `dsh-navpv-${Date.now()}`);
  chrome = spawn(
    CHROME,
    ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--mute-audio', '--disable-breakpad',
      '--window-size=1500,950', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
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
  const ws = new WebSocket(target.webSocketDebuggerUrl);
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
    if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails?.text).slice(0, 160));
    if (m.method === 'Page.javascriptDialogOpening') ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: false } }));
  });
  const send = (method, params = {}) => {
    const n = ++id;
    ws.send(JSON.stringify({ id: n, method, params }));
    return new Promise((resolve, reject) => pending.set(n, { resolve, reject }));
  };
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} :: ${String(expr).slice(0, 90)}`);
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${EDITOR}/` });
  for (let i = 0; i < 150; i += 1) {
    await sleep(120);
    try {
      if ((await ev('document.readyState')) === 'complete') break;
    } catch {
      /* 还在导航 */
    }
  }
  await sleep(1500);

  /* ---- 打开「导航」面板 ---- */
  const opened = await ev(`(() => {
    if (typeof window.__openWs !== 'function') return '没有 __openWs';
    window.__openWs('navs');
    return 'ok';
  })()`);
  await sleep(2500);
  check('能打开「导航」面板', opened === 'ok', String(opened));

  /*
    读预览那一栏的状态：
      · pvSticky / pvOverflow —— 它是不是"自己 sticky + 自己滚"（这是毛病①的修法）
      · cats —— 每一节：标题、开没开、是不是正在编辑的那一节、相对预览框的位置
  */
  const PV = `(() => {
    const host = document.querySelector('#navs-editor .nv-pv');
    if (!host) return null;
    const cs = getComputedStyle(host);
    const hr = host.getBoundingClientRect();
    const secs = [...host.querySelectorAll('.nv-pv__cat')].map((d) => {
      const r = d.getBoundingClientRect();
      return {
        id: d.dataset.catId,
        title: (d.querySelector('.nv-pv__catTitle') || {}).textContent || '',
        open: d.open,
        current: d.classList.contains('is-current'),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
      };
    });
    return {
      count: secs.length,
      secs,
      sticky: cs.position,
      overflow: cs.overflowY,
      scrollTop: Math.round(host.scrollTop),
      scrollH: Math.round(host.scrollHeight),
      clientH: Math.round(host.clientHeight),
      boxTop: Math.round(hr.top),
      boxBottom: Math.round(hr.bottom),
      minis: [...host.querySelectorAll('.nv-pv__mini')].map((b) => b.textContent),
      activeIndex: [...document.querySelectorAll('#navs-editor .nv-cat')].findIndex((r) => r.classList.contains('is-active')),
      addItems: document.querySelectorAll('#navs-editor .nv-additem').length,
    };
  })()`;

  const first = await ev(PV);
  info(`预览里 ${first.count} 节；正在编辑第 ${first.activeIndex + 1} 个；sticky=${first.sticky} overflow=${first.overflow}`);
  check('预览那一栏是 sticky + 自己一条滚动条（毛病①的修法：不用再整块面板往下滚）',
    first.sticky === 'sticky' && first.overflow === 'auto', `${first.sticky} / ${first.overflow}`);
  check('两颗小按钮在（只看正在编辑的 / 全部展开）',
    (first.minis || []).join(',') === '只看正在编辑的,全部展开', JSON.stringify(first.minis));
  check('正在编辑的那一节标出来了（is-current）',
    first.secs.filter((s) => s.current).length === 1 && first.secs[first.activeIndex]?.current === true,
    JSON.stringify(first.secs.map((s) => `${s.title}:${s.current ? '当前' : ''}${s.open ? '开' : '收'}`)));

  /* ---- 换到最后一个分类：预览要自动滚到它、并且把它展开 ---- */
  const jump = await ev(`(() => {
    const rows = [...document.querySelectorAll('#navs-editor .nv-cat .nv-cat__pick')];
    const last = rows[rows.length - 1];
    if (!last) return '没有分类行';
    last.click();
    return String(rows.length);
  })()`);
  await sleep(900);
  const afterJump = await ev(PV);
  const cur = afterJump.secs[afterJump.activeIndex];
  info(`切到「${cur?.title}」之后：预览 scrollTop=${afterJump.scrollTop}，它的位置 ${cur?.top}~${cur?.bottom}（预览框 ${afterJump.boxTop}~${afterJump.boxBottom}）`);
  check('★ 换到最后一类 → 预览自动滚到它，那一节整个落在预览框里（不用人往下拖）',
    !!cur && cur.current === true && cur.open === true && cur.top >= afterJump.boxTop - 2 && cur.bottom <= afterJump.boxBottom + 2,
    JSON.stringify({ title: cur?.title, top: cur?.top, bottom: cur?.bottom, boxTop: afterJump.boxTop, boxBottom: afterJump.boxBottom }));

  /* ---- 把上面几节收起来 → 再点「＋ 加条目」→ 收起来的必须还是收着的（毛病②） ---- */
  const collapsed = await ev(`(() => {
    const secs = [...document.querySelectorAll('#navs-editor .nv-pv__cat')];
    let n = 0;
    for (const d of secs) {
      if (d.classList.contains('is-current')) continue;
      const sum = d.querySelector('summary');
      if (d.open && sum) { sum.click(); n += 1; }
    }
    return n;
  })()`);
  await sleep(500);
  const afterCollapse = await ev(PV);
  info(`手动收起了 ${collapsed} 节；现在开着的：${afterCollapse.secs.filter((s) => s.open).map((s) => s.title).join('、')}`);
  check('手动点「收起 / 展开」真的收起来了', collapsed > 0 && afterCollapse.secs.filter((s) => s.open).length === 1,
    JSON.stringify(afterCollapse.secs.map((s) => `${s.title}:${s.open ? '开' : '收'}`)));

  const added = await ev(`(() => {
    const btn = document.querySelector('#navs-editor .nv-additem');
    if (!btn) return '没有 ＋ 加条目';
    btn.click();
    return 'ok';
  })()`);
  await sleep(900);
  const afterAdd = await ev(PV);
  const stillFolded = afterAdd.secs.filter((s) => !s.open).length;
  info(`点完「＋ 加条目」之后开着的：${afterAdd.secs.filter((s) => s.open).map((s) => s.title).join('、')}`);
  check('★ 点「＋ 加条目」重画一遍之后，刚才收起来的**还是收着的**（用户报的毛病②）',
    added === 'ok' && stillFolded === afterCollapse.secs.filter((s) => !s.open).length && stillFolded > 0,
    `收起 ${stillFolded} 节（重画前也是这么多）`);

  const cur2 = afterAdd.secs[afterAdd.activeIndex];
  check('★ 加完那一条之后，预览还停在正在编辑的那一节上（没被顶回顶上）',
    !!cur2 && cur2.open === true && cur2.top >= afterAdd.boxTop - 2 && cur2.bottom <= afterAdd.boxBottom + 2,
    JSON.stringify({ title: cur2?.title, top: cur2?.top, boxBottom: afterAdd.boxBottom }));

  const newItemVisible = await ev(`(() => {
    const host = document.querySelector('#navs-editor .nv-pv');
    const items = [...host.querySelectorAll('.nv-pv__item[data-nav-id]')];
    const box = host.getBoundingClientRect();
    const shown = items.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= box.top - 2 && r.bottom <= box.bottom + 2;
    });
    const last = items[items.length - 1];
    return { total: items.length, shown: shown.length, lastText: last ? last.textContent.trim() : '', lastVisible: last ? (last.getBoundingClientRect().top >= box.top - 2) : false };
  })()`);
  check('刚加的那一条自己能看见（在预览框里）', newItemVisible.total > 0 && newItemVisible.lastVisible === true,
    JSON.stringify(newItemVisible));

  /* ---- 两颗小按钮 ---- */
  const onlyOne = await ev(`(() => {
    const btns = [...document.querySelectorAll('#navs-editor .nv-pv__mini')];
    const b = btns.find((x) => x.textContent.includes('只看'));
    if (!b) return '没有那颗按钮';
    b.click();
    return 'ok';
  })()`);
  await sleep(700);
  const afterOnly = await ev(PV);
  check('★ 「只看正在编辑的」→ 只剩下正在编辑的那一节开着',
    onlyOne === 'ok' && afterOnly.secs.filter((s) => s.open).length === 1 && afterOnly.secs[afterOnly.activeIndex].open === true,
    JSON.stringify(afterOnly.secs.map((s) => `${s.title}:${s.open ? '开' : '收'}`)));

  const expandAll = await ev(`(() => {
    const btns = [...document.querySelectorAll('#navs-editor .nv-pv__mini')];
    const b = btns.find((x) => x.textContent.includes('全部展开'));
    if (!b) return '没有那颗按钮';
    b.click();
    return 'ok';
  })()`);
  await sleep(700);
  const afterAll = await ev(PV);
  check('「全部展开」→ 每一节都开着，而且预览这下真的比自己高（有自己的滚动条）',
    expandAll === 'ok' && afterAll.secs.every((s) => s.open) && afterAll.scrollH > afterAll.clientH,
    JSON.stringify({ open: afterAll.secs.filter((s) => s.open).length, scrollH: afterAll.scrollH, clientH: afterAll.clientH }));

  check('全程没有 JS 异常', errors.length === 0, errors.join(' | ') || '干净');

  /* 关掉面板（不保存！）—— 草稿只在内存里 */
  await ev(`(() => { window.__openWs('docs'); return 'ok'; })()`);
  await sleep(400);
} finally {
  try { chrome?.kill(); } catch { /* 忽略 */ }
  try { editor?.kill(); } catch { /* 忽略 */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome 还占着就算了 */ }
}

/* ---- 最后核对：仓库里的 navs.json 一个字节都没变（这个脚本从不点保存） ---- */
const navsAfter = fs.readFileSync(NAVS_FILE, 'utf8');
check('★ 跑完仓库里的 navs.json 一个字节没变（只动内存草稿、从没保存）',
  navsAfter === navsBefore, navsAfter === navsBefore ? '一致' : '被改了！');

console.log(`\n${pass} pass / ${fail} fail`);
process.exitCode = fail ? 1 : 0;
