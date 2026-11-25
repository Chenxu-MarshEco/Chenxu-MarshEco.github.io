/*
 * 图鉴条目的「传图 / 换图 / 删除」验收（2026-11-25）
 * ---------------------------------------------------------------------------
 * 站长报的两个 bug：
 *   「如果先建好了带名字的条目不传图 那么这个条目就永远不能传图了」
 *   「如果先传了图 那么就删不掉这个条目 只能先取图再删」
 *
 * 在副本里（public 也是副本，传的图落在副本里，真仓库一个字节不动）开真编辑器：
 *   ① 页面工作台打得开；栏底那条「＋ …」在滚动区下面、不压内容，
 *      而且真鼠标点「＋ 图鉴」就能加出一个图鉴块（不是只数按钮个数）；
 *   ② 图鉴里「＋ 空白条目」→ 只有名字的那一条自带「传图」+ 一个 file input；
 *   ③ 点「传图」**真的弹出系统文件选择器**（Page.fileChooserOpened）；
 *   ④ 选一张图 → 这一条真的变成有图（img + /img/uploads/… 的 src），
 *      按钮跟着变成 换图 / 去图 / 截取 / ↑ / ↓ / 删除；
 *   ⑤ **有图之后真鼠标点「删除」→ 这一条直接没了**（不用先「去图」）；
 *   ⑥ 块顶上那个批量口还是「一张图一个新条目」；把图拖到某一条身上 = 只换那一条，不新增；
 *   ⑦ 相册那个「点这里选」也真能弹出选择器（同款 bug 顺手一起修了）；
 *   ⑧ 全程没有 JS 报错，而且没保存：副本里的 home-boards.json 没变。
 *
 * 跑法：node tools/checks/editor-codex-items-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromePath } from './lib/chrome.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DST = path.join(SRC, '.tmp', 'codex-items-copy');
const PORT = 4790;
const DBG = 9463;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};

/* ================= 0. 副本（public 也是副本：上传落在副本里） ================= */
if (fs.existsSync(DST)) {
  const nm = path.join(DST, 'node_modules');
  if (fs.existsSync(nm)) {
    try {
      execSync(`cmd /c rmdir "${nm}"`, { stdio: 'ignore', windowsHide: true });
    } catch { /* 不是 junction */ }
  }
  fs.rmSync(DST, { recursive: true, force: true });
}
fs.mkdirSync(DST, { recursive: true });
for (const it of ['src', 'tools', 'astro.config.mjs', 'package.json', 'tsconfig.json']) {
  fs.cpSync(path.join(SRC, it), path.join(DST, it), { recursive: true });
}
execSync(`cmd /c mklink /J "${path.join(DST, 'node_modules')}" "${path.join(SRC, 'node_modules')}"`, {
  stdio: 'ignore',
  windowsHide: true,
});
/* 一张真图：既给浏览器 drop / fetch 用，也给「选一张图」用 */
const upDir = path.join(SRC, 'public/img/uploads');
const srcImg = fs.readdirSync(upDir).find((f) => /\.(jpe?g|png|webp)$/i.test(f));
if (!srcImg) {
  console.log('FAIL  仓库里没有可用的图（public/img/uploads 是空的）');
  process.exit(1);
}
fs.mkdirSync(path.join(DST, 'public/img/uploads'), { recursive: true });
fs.mkdirSync(path.join(DST, 'public/img/opt'), { recursive: true });
fs.copyFileSync(path.join(upDir, srcImg), path.join(DST, 'public/img/uploads', srcImg));
const manifest = path.join(SRC, 'public/img/opt/manifest.json');
if (fs.existsSync(manifest)) fs.copyFileSync(manifest, path.join(DST, 'public/img/opt/manifest.json'));
const IMG_ON_DISK = path.join(DST, 'public/img/uploads', srcImg);
const IMG_URL = `/img/uploads/${srcImg}`;

const boardsFile = path.join(DST, 'src/data/home-boards.json');
const boardsBefore = fs.readFileSync(boardsFile, 'utf8');

/* ================= 1. 编辑器（副本自己的 server.mjs） ================= */
const editor = spawn(process.execPath, [path.join(DST, 'tools/editor/server.mjs'), '--port', String(PORT)], {
  cwd: DST, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let elog = '';
editor.stdout.on('data', (b) => { elog += b.toString('utf8'); });
editor.stderr.on('data', (b) => { elog += b.toString('utf8'); });
const base = `http://127.0.0.1:${PORT}`;
let up = false;
for (let i = 0; i < 120 && !up; i++) {
  await sleep(150);
  try {
    const r = await fetch(`${base}/api/boards`);
    up = r.ok;
  } catch { /* 还没起来 */ }
}
if (!up) {
  console.log('FAIL  编辑器没起来：' + elog.slice(-400));
  process.exit(1);
}
console.log('编辑器（副本）在', base);

/* ================= 2. 浏览器 ================= */
const profile = path.join(process.env.TEMP ?? '.', `dsh-codex-items-${Date.now()}`);
const chrome = spawn(chromePath(), ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu',
  '--enable-unsafe-swiftshader', '--disable-breakpad', `--user-data-dir=${profile}`,
  `--remote-debugging-port=${DBG}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.errors = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
      if (m.method) this.events.push({ m: m.method, p: m.params });
      if (m.method === 'Runtime.exceptionThrown') {
        this.errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
      }
    });
  }
  static async attach(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
    });
    return new CDP(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async ev(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
    return r.result.value;
  }
  async obj(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: false });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.objectId;
  }
  async open(url, wait = 1500) {
    await this.send('Page.navigate', { url });
    for (let i = 0; i < 120; i++) {
      await sleep(120);
      if ((await this.ev('document.readyState')) === 'complete') break;
    }
    await sleep(wait);
  }
  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }
  /** 点一个按钮：先把它滚进视野，再按它中心的坐标真点一下（不绕过遮挡） */
  async clickEl(expr) {
    const pos = await this.ev(`(() => {
      const el = ${expr};
      if (!el) return null;
      el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, hitSelf: !!at && (at === el || el.contains(at)) };
    })()`);
    if (!pos) return null;
    await this.click(pos.x, pos.y);
    return pos;
  }
}

/* 图鉴块 & 它里面第 n 条那一行（只在 .pblock-edit__body 里找，避开「对应时间」那行） */
const CODEX = `[...document.querySelectorAll('#page-editor .pblock-edit')].find((b) => b.querySelector('.pblock-edit__type')?.textContent === '图鉴')`;
const rowsOf = (n) => `[...${CODEX}.querySelectorAll('.pblock-edit__body .pblock-edit__row')].filter((r) => r.querySelector('input[list="codex-link-pages"]'))[${n}]`;

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const list = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* 还没起来 */ }
  }
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  /* 选择器一弹就取消（免得卡住），但 Page.fileChooserOpened 事件照发 —— 用它证明「真的能点开」 */
  await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true, cancel: true });

  await cdp.open(`${base}/`, 1800);
  const boot = await cdp.ev(`({ hasOpen: typeof window.__openWs === 'function' })`);
  check('编辑器页面起来了', boot.hasOpen === true);

  await cdp.ev(`window.__openWs('pages')`);
  await sleep(1800);
  await cdp.ev(`(() => {
    const items = [...document.querySelectorAll('#pw-list .pw-tree__item')];
    const it = items.find((x) => x.textContent.includes('纷湖')) || items[0];
    it.click();
    return true;
  })()`);
  await sleep(1800);
  check('页面工作台选中了一页（内容块在）',
    (await cdp.ev(`document.querySelectorAll('#page-editor .pblock-edit').length`)) > 5);

  /* ---------- ① 底栏不压内容，真鼠标点「＋ 图鉴」 ---------- */
  const bar = await cdp.ev(`(() => {
    const col = document.querySelector('.pstudio__col--edit');
    const sc = document.querySelector('#pw-scroll');
    const pal = document.querySelector('#pw-palette');
    const row = pal ? pal.querySelector('.pblock-add') : null;
    if (!col || !sc || !pal || !row) return { ok: false };
    sc.scrollTop = 0;
    const r = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; };
    const btns = [...row.querySelectorAll('button')].map((b) => {
      const rr = b.getBoundingClientRect();
      const hit = document.elementFromPoint(rr.left + rr.width / 2, rr.top + rr.height / 2);
      return { t: b.textContent.trim(), self: !!hit && (hit === b || b.contains(hit)) };
    });
    return { ok: true, col: r(col), sc: r(sc), pal: r(pal), btns,
      position: getComputedStyle(row).position };
  })()`);
  const covered = (bar.btns ?? []).filter((b) => !b.self).map((b) => b.t);
  check('① 栏底那条「＋ …」在滚动区下面、不压内容（不 sticky）',
    bar.ok === true && bar.position !== 'sticky' && bar.pal.top >= bar.sc.bottom - 1 && bar.pal.bottom <= bar.col.bottom + 2,
    JSON.stringify({ position: bar.position, sc: bar.sc, pal: bar.pal, col: bar.col }));
  check('① 滚到最上面时每个「＋ …」都点得到（含 ＋ 相册 / ＋ 图鉴）',
    covered.length === 0 && (bar.btns ?? []).length >= 10
      && ['＋ 相册', '＋ 图鉴'].every((t) => bar.btns.some((b) => b.t === t)),
    `被盖住：${JSON.stringify(covered)}；共 ${(bar.btns ?? []).length} 个`);

  const plusCodex = `[...document.querySelectorAll('#pw-palette .pblock-add button')].find((b) => b.textContent.trim() === '＋ 图鉴')`;
  const plusCodexHit = await cdp.clickEl(plusCodex);
  await sleep(900);
  const types = await cdp.ev(`[...document.querySelectorAll('#page-editor .pblock-edit__type')].map((t) => t.textContent)`);
  check('① 真鼠标点「＋ 图鉴」就加出一个图鉴块（这是站长说的「点不到」那一条）',
    plusCodexHit?.hitSelf === true && types[types.length - 1] === '图鉴', JSON.stringify(types.slice(-3)));

  /* ---------- ② 只有名字的条目：自带传图口 ---------- */
  await cdp.ev(`(() => { const blk = ${CODEX}; blk.scrollIntoView({ block: 'center' });
    [...blk.querySelectorAll('button')].find((b) => b.textContent.includes('空白条目')).click(); return true; })()`);
  await sleep(600);
  await cdp.ev(`(() => { const row = ${rowsOf(0)}; const inp = row.querySelector('input');
    inp.value = '梅莉'; inp.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const blankRow = await cdp.ev(`(() => { const row = ${rowsOf(0)};
    return { buttons: [...row.querySelectorAll('button')].map((b) => b.textContent),
      files: row.querySelectorAll('input[type="file"]').length,
      imgs: row.querySelectorAll('img').length }; })()`);
  check('② 只有名字的条目自带「传图」和一个 file input（以前这里根本没地方塞图）',
    blankRow.buttons.includes('传图') && blankRow.files >= 1 && blankRow.imgs === 0,
    JSON.stringify(blankRow));

  /* ---------- ③ 点「传图」真的弹出选择器 ---------- */
  const evMark = cdp.events.length;
  const pickHit = await cdp.clickEl(`[...${rowsOf(0)}.querySelectorAll('button')].find((b) => b.textContent === '传图')`);
  await sleep(900);
  const chooserOpened = cdp.events.slice(evMark).some((e) => e.m === 'Page.fileChooserOpened');
  check('③ 点「传图」真的弹出系统文件选择器（不是个死按钮）', chooserOpened === true, `hitSelf=${pickHit?.hitSelf}`);

  /* ---------- ④ 选一张图 → 这一条变成有图 ---------- */
  const inputObj = await cdp.obj(`(() => ${rowsOf(0)}.querySelector('input[type="file"]'))()`);
  await cdp.send('DOM.setFileInputFiles', { objectId: inputObj, files: [IMG_ON_DISK] });
  await sleep(3000);
  const filled = await cdp.ev(`(() => { const row = ${rowsOf(0)};
    return { buttons: [...row.querySelectorAll('button')].map((b) => b.textContent),
      imgs: row.querySelectorAll('img').length,
      src: row.querySelector('img')?.getAttribute('src') || '' }; })()`);
  check('④ 选了图之后这一条真的有图了（src 是 /img/uploads/…）',
    filled.imgs === 1 && String(filled.src).startsWith('/img/uploads/'), JSON.stringify(filled));
  check('④ 有图之后按钮齐了：换图 / 去图 / 截取 / ↑ / ↓ / 删除',
    ['换图', '去图', '截取', '↑', '↓', '删除'].every((t) => filled.buttons.includes(t)),
    JSON.stringify(filled.buttons));

  /* ---------- ⑤ 有图的条目：真鼠标点「删除」就没了 ---------- */
  const delHit = await cdp.clickEl(`[...${rowsOf(0)}.querySelectorAll('button')].find((b) => b.textContent === '删除')`);
  await sleep(800);
  const afterDel = await cdp.ev(`(() => ({ rows: [...${CODEX}.querySelectorAll('.pblock-edit__body .pblock-edit__row')]
    .filter((r) => r.querySelector('input[list="codex-link-pages"]')).length }))()`);
  check('⑤ 先传了图的那一条，点「删除」直接删掉（不用先「去图」）',
    delHit?.hitSelf === true && afterDel.rows === 0, JSON.stringify({ hitSelf: delHit?.hitSelf, rows: afterDel.rows }));

  /* ---------- ⑥ 批量口仍然是「一张图一个新条目」；拖到某一条身上只换那一条 ---------- */
  const dropTwo = `(async () => {
    const blk = ${CODEX};
    blk.scrollIntoView({ block: 'center' });
    const drop = blk.querySelector('[data-img-intake]');
    const r = await fetch('${IMG_URL}');
    const blob = await r.blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'a.jpg', { type: 'image/jpeg' }));
    dt.items.add(new File([blob], 'b.jpg', { type: 'image/jpeg' }));
    drop.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  })()`;
  await cdp.ev(dropTwo);
  await sleep(4000);
  const two = await cdp.ev(`(() => { const blk = ${CODEX};
    const rows = [...blk.querySelectorAll('.pblock-edit__body .pblock-edit__row')].filter((r) => r.querySelector('input[list="codex-link-pages"]'));
    return { rows: rows.length, imgs: rows.map((r) => (r.querySelector('img')?.getAttribute('src') || '')) }; })()`);
  check('⑥ 块顶上拖两张 → 还是「一张图一个新条目」（两条都在、都有图）',
    two.rows === 2 && two.imgs.every((s) => String(s).startsWith('/img/uploads/')),
    JSON.stringify({ rows: two.rows, imgs: two.imgs.length }));

  const rowDrop = `(async () => {
    const row = ${rowsOf(0)};
    const r = await fetch('${IMG_URL}');
    const blob = await r.blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'c.jpg', { type: 'image/jpeg' }));
    row.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  })()`;
  const firstSrcBefore = two.imgs[0];
  await cdp.ev(rowDrop);
  await sleep(3000);
  const afterRowDrop = await cdp.ev(`(() => { const blk = ${CODEX};
    const rows = [...blk.querySelectorAll('.pblock-edit__body .pblock-edit__row')].filter((r) => r.querySelector('input[list="codex-link-pages"]'));
    return { rows: rows.length, imgs: rows.map((r) => (r.querySelector('img')?.getAttribute('src') || '')) }; })()`);
  check('⑥ 把图拖到某一条身上 = 只换那一条的图，不多出条目',
    afterRowDrop.rows === 2 && afterRowDrop.imgs[0] !== firstSrcBefore
      && afterRowDrop.imgs[0].startsWith('/img/uploads/'),
    JSON.stringify({ rows: afterRowDrop.rows, before: firstSrcBefore, after: afterRowDrop.imgs[0] }));

  /* ---------- ⑦ 相册那个「点这里选」也能点开（同款 bug） ---------- */
  const plusAlbumHit = await cdp.clickEl(`[...document.querySelectorAll('#pw-palette .pblock-add button')].find((b) => b.textContent.trim() === '＋ 相册')`);
  await sleep(900);
  const evMark2 = cdp.events.length;
  const albumDropHit = await cdp.clickEl(`(() => {
    const blk = [...document.querySelectorAll('#page-editor .pblock-edit')]
      .find((b) => b.querySelector('.pblock-edit__type')?.textContent === '相册');
    if (!blk) return null;
    blk.scrollIntoView({ block: 'center' });
    return blk.querySelector('[data-img-intake]');
  })()`);
  await sleep(900);
  const albumChooser = cdp.events.slice(evMark2).some((e) => e.m === 'Page.fileChooserOpened');
  check('⑦ 相册的「拖照片到这里，或点这里选」现在也真能点开（+ 相册也点得到）',
    plusAlbumHit?.hitSelf === true && albumDropHit?.hitSelf === true && albumChooser === true,
    JSON.stringify({ plusAlbum: plusAlbumHit?.hitSelf, drop: albumDropHit?.hitSelf, chooser: albumChooser }));

  /* ---------- ⑧ 独立页面工作台：同一批控件搬过去，底栏也得跟着搬 ---------- */
  await cdp.ev(`window.__openWs('solo')`);
  await sleep(1500);
  await cdp.ev(`(() => { const it = document.querySelector('#solo-list .solo__item'); if (it) it.click(); return !!it; })()`);
  await sleep(1500);
  const solo = await cdp.ev(`(() => {
    const pal = document.querySelector('#solo-palette > .pblock-add');
    const sc = document.querySelector('#solo-scroll');
    return { hasPal: !!pal, btns: pal ? pal.querySelectorAll('button').length : 0,
      scrolls: !!sc, pwPalEmpty: (document.querySelector('#pw-palette')?.textContent || '') === '',
      palCount: document.querySelectorAll('.pstudio__palette').length,
      blocks: document.querySelectorAll('#page-editor .pblock-edit').length };
  })()`);
  const soloAdd = await cdp.clickEl(`[...document.querySelectorAll('#solo-palette .pblock-add button')].find((b) => b.textContent.trim() === '＋ 文字')`);
  await sleep(900);
  const soloAfter = await cdp.ev(`document.querySelectorAll('#page-editor .pblock-edit').length`);
  check('⑧ 独立页面工作台里底栏也在（画进它自己那条，不是把容器搬过去套两层），点「＋ 文字」能加块',
    solo.hasPal && solo.btns >= 10 && solo.scrolls && solo.pwPalEmpty === true
      && solo.palCount === 2 && soloAdd?.hitSelf === true && soloAfter === solo.blocks + 1,
    JSON.stringify({ ...solo, after: soloAfter }));
  await cdp.ev(`window.__openWs('pages')`);
  await sleep(1500);
  const back = await cdp.ev(`(() => ({
    pal: document.querySelectorAll('#pw-palette > .pblock-add button').length,
    soloEmpty: (document.querySelector('#solo-palette')?.textContent || '') === '',
    palCount: document.querySelectorAll('.pstudio__palette').length,
    blocks: document.querySelectorAll('#page-editor .pblock-edit').length,
  }))()`);
  check('⑧ 切回「页面」工作台：底栏搬回来了，独立页面那边不留一份',
    back.pal >= 10 && back.soloEmpty === true && back.palCount === 2 && back.blocks > 0, JSON.stringify(back));

  /* ---------- ⑨ 没有报错、盘上没变 ---------- */
  check('⑨ 全程没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));
  check('⑨ 没保存过：副本里的 home-boards.json 一个字节没动',
    fs.readFileSync(boardsFile, 'utf8') === boardsBefore);
} catch (err) {
  check(`跑完（出错：${err.message}）`, false);
} finally {
  try { chrome.kill(); } catch { /* ignore */ }
  try { editor.kill(); } catch { /* ignore */ }
  await sleep(400);
  console.log(`\nPASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}
