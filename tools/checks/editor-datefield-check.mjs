/*
 * 编辑器「日历」面板的日期框：能不能**直接敲数字**（用户要求），不弹系统日历。
 *
 * 用户原话：
 *   「先快点给编辑器加一个更新 日历页面的时间可以和时间轴一样直接输入数字
 *     不要展开日历点 更新好这个小改动再继续做之前的工作」
 *
 * 全程在副本 `.tmp/date-proj` 里跑（自己的 server.mjs、自己的 src/data），
 * 绝不碰工作区数据。
 *
 * 用法：node tools/checks/editor-datefield-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';

const SRC = String.raw`D:\曼沫砾总线\Chenxu-MarshEco.github.io`;
const DST = path.join(SRC, '.tmp', 'date-proj');
const DEBUG_PORT = 9374;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};

/* ---------- 副本 ---------- */
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

/* ---------- 副本自己的编辑器 ---------- */
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
console.log('副本编辑器在', base);

const profile = path.join(process.env.TEMP ?? '.', `dsh-date-${Date.now()}`);
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
    });
  }
  static async attach(u) {
    const ws = new WebSocket(u);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('ws')), { once: true }); });
    return new CDP(ws);
  }
  send(m, p = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method: m, params: p })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
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
    const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const pg = l.find((t) => t.type === 'page');
    if (pg) cdp = await CDP.attach(pg.webSocketDebuggerUrl);
  } catch { /* 还没起来 */ }
}
if (!cdp) { console.log('FAIL  Chromium 没起来'); process.exit(1); }
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Page.navigate', { url: base });
for (let i = 0; i < 150; i++) { await sleep(120); if ((await cdp.ev('document.readyState')) === 'complete') break; }
await sleep(2000);

try {
  /* 打开「日历」面板 */
  await cdp.ev(`(async () => { await window.__openWs('calendar'); await new Promise((r) => setTimeout(r, 1200)); return true; })()`);

  const shape = await cdp.ev(`(() => {
    const panel = [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
    if (!panel) return { ok: false, why: '没有可见面板' };
    /* 「＋ 添加一天」先加一天，保证表里至少有一行可量 */
    const add = [...panel.querySelectorAll('button')].find((b) => b.textContent.includes('添加一天'));
    if (add) add.click();
    return { ok: true, added: !!add }; })()`);
  await sleep(800);

  const shape2 = await cdp.ev(`(() => {
    const panel = [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
    const row = panel.querySelector('.wcal-row');
    if (!row) return { ok: false, why: '没有特殊日子行' };
    const field = row.querySelector('.datefield');
    const text = row.querySelector('.datefield__text');
    const nat = row.querySelectorAll('input[type=date]');
    const btn = row.querySelector('.datefield__btn');
    const live = row.querySelector('.datefield__live');
    const cs = nat[0] ? getComputedStyle(nat[0]) : null;
    return { ok: true, hasField: !!field, type: text && text.type, inputMode: text && text.inputMode,
      placeholder: text && text.placeholder, value: text && text.value,
      nativeCount: nat.length, nativeHidden: cs ? cs.opacity === '0' || cs.width === '1px' : null,
      hasCalBtn: !!btn, calBtnText: btn && btn.textContent, hasLive: !!live,
      rawDateInputs: [...document.querySelectorAll('.wpanel input[type=date]:not(.datefield__cal)')].length,
      hint: (() => {
        /* 要的是「特殊日子」那一块的提示，不是第一个 wbox（那是「今天那句话」） */
        const box = [...panel.querySelectorAll('.wbox')].find((b) => ((b.querySelector('.wbox__title') || {}).textContent || '').includes('特殊日子'));
        return box ? ((box.querySelector('.wbox__hint') || {}).textContent || '') : '';
      })() }; })()`);
  console.log('日期行：', JSON.stringify(shape2));
  check('日历面板的日期是**文本框**（可以敲数字），不是原生日期控件', shape2.ok === true && shape2.type === 'text',
    `type=${shape2.type} inputmode=${shape2.inputMode}`);
  check('文本框提示可以直接敲数字（placeholder 20230110）', shape2.placeholder === '20230110', `placeholder=${shape2.placeholder}`);
  check('面板里没有会"一聚焦就弹日历"的原生日期控件', shape2.rawDateInputs === 0,
    `可见的原生 date 输入 ${shape2.rawDateInputs} 个；隐藏的那个 ${shape2.nativeCount} 个（opacity/尺寸 ${JSON.stringify([shape2.nativeHidden])}）`);
  check('右边留着 📅 按钮（想翻日历的人才用，不点不弹）', shape2.hasCalBtn === true && shape2.calBtnText === '📅', JSON.stringify(shape2.calBtnText));
  check('没有时间轴专有的「实时」开关（这里就是一个固定日期）', shape2.hasLive === false);
  check('面板提示也改口了（写的是"直接敲数字"）', /直接敲数字/.test(shape2.hint), shape2.hint.slice(0, 60));

  /* 真的敲一遍数字：先清空，再一个个敲 20261231 → 应该自动变成 2026-12-31
     （用**刚加的那一行**，别去改已有的那一天） */
  const typed = await cdp.ev(`(async () => {
    const panel = [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
    const rows = [...panel.querySelectorAll('.wcal-row')];
    const row = rows[rows.length - 1];
    const el = row.querySelector('.datefield__text');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const type = async (s) => {
      for (const ch of s) {
        set.call(el, el.value + ch);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 30));
      }
    };
    el.focus();
    await type('20261231');
    const mid = el.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    await new Promise((r) => setTimeout(r, 600));
    const after = el.value;
    /* 落定之后这一行应该已经变成新日期（说明值真的写进事件表了） */
    const nowRows = [...([...document.querySelectorAll('.wpanel')].find((x) => x.getBoundingClientRect().height > 0)).querySelectorAll('.wcal-row')];
    return { mid, after, bad: el.classList.contains('is-bad'), rowDates: nowRows.map((r) => r.dataset.date) }; })()`);
  console.log('敲字过程：', JSON.stringify(typed));
  check('一个个敲数字会自动补成 2026-12-31（不用点日历）', typed.after === '2026-12-31', `中途「${typed.mid}」→ 落定「${typed.after}」`);
  check('敲完这一行真的变成了 2026-12-31（值写进事件表了）', (typed.rowDates || []).includes('2026-12-31'), JSON.stringify(typed.rowDates));
  check('敲完没有报错、字段也没被标红', typed.bad === false);

  /* 换成另一种写法（2026/1/5）也要认 */
  const typed2 = await cdp.ev(`(async () => {
    const panel = [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
    const el = panel.querySelector('.wcal-row .datefield__text');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, '2026/1/5');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    return { after: el.value, bad: el.classList.contains('is-bad') }; })()`);
  check('粘贴/敲 2026/1/5 这种写法也认（会规范成 2026-01-05）', typed2.after === '2026-01-05', JSON.stringify(typed2));

  /* 数字但不成日期（2026-13-45）：标红、不写数据、也不抛错 */
  const bad = await cdp.ev(`(async () => {
    const panel = [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
    const rows = [...panel.querySelectorAll('.wcal-row')];
    const el = rows[rows.length - 1].querySelector('.datefield__text');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, '2026-13-45');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    return { bad: el.classList.contains('is-bad'), title: el.title, keep: el.value }; })()`);
  check('不合法的日期会被标红（而不是悄悄写坏数据）', bad.bad === true, JSON.stringify(bad));

  /* 「精华」面板的日期走的是同一个控件，一起确认一下（别再冒出个原生日历） */
  await cdp.ev(`(async () => { await window.__openWs('essences'); await new Promise((r) => setTimeout(r, 1400)); return true; })()`);
  const ess = await cdp.ev(`(() => {
    const panel = [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
    if (!panel) return { ok: false, why: '没有可见面板' };
    const row = [...panel.querySelectorAll('.wess__rows li')][0];
    if (!row) return { ok: false, why: '精华列表是空的' };
    const btn = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === '编辑');
    if (btn) btn.click();
    return { ok: true, opened: !!btn }; })()`);
  await sleep(900);
  const essField = await cdp.ev(`(() => {
    const panel = [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
    const box = panel.querySelector('.wess__form');
    if (!box) return { ok: false, why: '表单没打开' };
    const f = box.querySelector('.datefield__text');
    const wide = [...box.querySelectorAll('.wess__row')].find((r) => /日期/.test(r.textContent));
    return { ok: true, type: f && f.type, placeholder: f && f.placeholder,
      native: box.querySelectorAll('input[type=date]:not(.datefield__cal)').length,
      time: !!box.querySelector('.wtime'),
      hint: wide ? (wide.querySelector('.hint') || {}).textContent || '' : '' }; })()`);
  console.log('精华面板的日期：', JSON.stringify(essField));
  check('精华面板的日期也换成能直接敲数字的文本框了', essField.ok === true && essField.type === 'text' && essField.native === 0,
    JSON.stringify(essField));
  check('精华面板的「时间」输入没被弄坏（还是原来那个 HH:MM 框）', essField.time === true);

  /*
    时间轴的日期控件（就是"直接敲数字"那套的出处）要确认没被我这次改动弄坏：
    它那边**多一个「实时」开关**（存哨兵 today）。
  */
  await cdp.ev(`(async () => { await window.__openWs('timelines'); await new Promise((r) => setTimeout(r, 2000)); return true; })()`);
  const tlField = await cdp.ev(`(async () => {
    const panel = [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0) || document.querySelector('#tl-editor');
    const text = panel && panel.querySelector('.tl-edit .datefield__text');
    const live = panel && panel.querySelector('.tl-edit .datefield__live');
    if (!text || !live) return { ok: false, hasText: !!text, hasLive: !!live };
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const before = { pressed: live.getAttribute('aria-pressed'), disabled: text.disabled };
    live.click();
    await new Promise((r) => setTimeout(r, 300));
    const on = { pressed: live.getAttribute('aria-pressed'), disabled: text.disabled, placeholder: text.placeholder, value: text.value };
    live.click();
    await new Promise((r) => setTimeout(r, 300));
    const off = { pressed: live.getAttribute('aria-pressed'), disabled: text.disabled, value: text.value };
    set.call(text, '20250102');
    text.dispatchEvent(new Event('input', { bubbles: true }));
    text.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    return { ok: true, before, on, off, typed: text.value }; })()`);
  console.log('时间轴面板的日期：', JSON.stringify(tlField));
  check('时间轴的日期控件没坏：能敲数字 + 「实时」开关还在，「实时」打开时禁用/关掉后能填',
    tlField.ok === true && tlField.on.pressed === 'true' && tlField.on.disabled === true &&
      tlField.off.pressed === 'false' && tlField.off.disabled === false && tlField.typed === '2025-01-02',
    JSON.stringify(tlField));

  check('这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));
} catch (err) {
  fail++;
  console.log('FAIL  脚本异常: ' + (err?.stack ?? err));
} finally {
  try { await cdp.send('Browser.close'); } catch { /* ignore */ }
  try { execSync(`taskkill /pid ${editor.pid} /T /F`, { stdio: 'ignore' }); } catch { /* ignore */ }
  try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch { /* ignore */ }
  for (const j of ['node_modules', 'public']) {
    const p = path.join(DST, j);
    if (fs.existsSync(p)) { try { execSync(`cmd /c rmdir "${p}"`, { stdio: 'ignore' }); } catch { /* ignore */ } }
  }
  try { fs.rmSync(DST, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log('副本已清理:', !fs.existsSync(DST));
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
