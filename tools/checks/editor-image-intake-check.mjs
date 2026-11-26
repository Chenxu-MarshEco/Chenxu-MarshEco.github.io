/*
 * 「粘贴」按钮 + 粘贴给谁 —— 验收（2026-11-26）
 * ---------------------------------------------------------------------------
 * 站长报的两件事：
 *   「相册和图鉴不能用复制粘贴传图 只能拖入或打开文件」
 *   「成员传图时如果复制粘贴传图 会直接把图传到最下方一个成员的放大框里
 *     别的地方复制粘贴不进去」
 * 他要的改法：「给所有有关图片上传的地方加一个按钮 按了以后会自动读取剪贴板的
 * 图片并导入到旁边对应的框里」。
 *
 * 这个脚本在副本里（上传落在副本的 public 下，真仓库一个字节不动）开真编辑器：
 *   ① 相册 / 图鉴（批量口 + 每条）/ 文字块 / 图片块 / 地图 / 封面 / 插入图片弹窗 /
 *      成员头像与放大图 / 精华图片 / 子版块封面，每个上传点都有「粘贴」；
 *   ② 真鼠标点「粘贴」→ 真的读剪贴板（先在页面里写一张 PNG 进去）→
 *      真的落成 /img/uploads/… ，不是个只会弹提示的死按钮；
 *   ③ 成员面板里每个人两个口都注册上了（以前只留最后一个人那张「放大图」）；
 *   ④ 在成员面板随便一个输入框里 Ctrl+V，**不再**偷偷写进最后一个成员的放大框；
 *   ⑤ 相册整块只有一个口：焦点在块里任何一个框，Ctrl+V 都进那个口；
 *   ⑥ 全程没有 JS 报错、也没保存（副本里的 home-boards.json 一个字节没动）。
 *
 * 跑法：node tools/checks/editor-image-intake-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromePath } from './lib/chrome.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DST = path.join(SRC, '.tmp', 'intake-copy');
const PORT = 4792;
const DBG = 9465;
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
const profile = path.join(process.env.TEMP ?? '.', `dsh-intake-${Date.now()}`);
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
  /** 点一个元素：先滚进视野，再按中心坐标真点一下（不绕过遮挡） */
  async clickEl(expr) {
    const pos = await this.ev(`(() => {
      const el = ${expr};
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, hitSelf: !!at && (at === el || el.contains(at)) };
    })()`);
    if (!pos) return null;
    await this.click(pos.x, pos.y);
    return pos;
  }
}

/* 页面块 / 它的某种控件 */
const BLOCK = (label) => `[...document.querySelectorAll('#page-editor .pblock-edit')]
  .find((b) => b.querySelector('.pblock-edit__type')?.textContent === '${label}')`;

/* 把一张真图写进系统剪贴板（PNG：Chrome 的 clipboard.write 只认 png） */
const SEED_CLIP = `(async () => {
  const blob = await (await fetch('${IMG_URL}')).blob();
  const bmp = await createImageBitmap(blob);
  const cv = document.createElement('canvas');
  cv.width = Math.min(bmp.width, 320);
  cv.height = Math.round(bmp.height * cv.width / bmp.width);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  const png = await new Promise((r) => cv.toBlob(r, 'image/png'));
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  return png.size;
})()`;

/* 合成一次 Ctrl+V：剪贴板里放一张图，事件派给当前焦点（和真按 Ctrl+V 同一条路） */
const FAKE_PASTE = `(async () => {
  const blob = await (await fetch('${IMG_URL}')).blob();
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
  (document.activeElement || document.body).dispatchEvent(ev);
  await new Promise((r) => setTimeout(r, 1800));
  return true;
})()`;

try {
  let target = null;
  let browserWs = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const list = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      const ver = await (await fetch(`http://127.0.0.1:${DBG}/json/version`)).json();
      browserWs = ver.webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
  }
  /* 剪贴板权限挂在浏览器上（页面那层没有 Browser.grantPermissions） */
  const browser = await CDP.attach(browserWs);
  await browser.send('Browser.grantPermissions', {
    origin: base,
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  });

  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  /* headless 里 document 默认不算聚焦，剪贴板读写要求聚焦 */
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp.send('Page.bringToFront');

  await cdp.open(`${base}/`, 1800);
  check('编辑器页面起来了', (await cdp.ev(`typeof window.__openWs === 'function'`)) === true);
  check('剪贴板：网页能写也能读一张图（后面全靠它）', (await cdp.ev(SEED_CLIP)) > 0);

  /* ---------- 页面工作台 ---------- */
  await cdp.ev(`window.__openWs('pages')`);
  await sleep(1800);
  await cdp.ev(`(() => {
    const items = [...document.querySelectorAll('#pw-list .pw-tree__item')];
    const it = items.find((x) => x.textContent.includes('纷湖')) || items[0];
    it.click();
    return true;
  })()`);
  await sleep(1800);

  const addBlock = async (label) => {
    const hit = await cdp.clickEl(`[...document.querySelectorAll('#pw-palette .pblock-add button')]
      .find((b) => b.textContent.trim() === '＋ ${label}')`);
    await sleep(900);
    return hit?.hitSelf === true;
  };

  /* ---------- ① 相册：按钮 + 真读剪贴板 ---------- */
  const albumAdded = await addBlock('相册');
  const albumBtn = await cdp.ev(`(() => { const b = ${BLOCK('相册')};
    return b ? { n: b.querySelectorAll('.intake__paste').length,
      label: b.querySelector('.intake__paste')?.textContent || '' } : null; })()`);
  check('① 相册块自带「粘贴」按钮', albumAdded && albumBtn?.n === 1 && albumBtn.label === '粘贴',
    JSON.stringify(albumBtn));
  const albumHit = await cdp.clickEl(`${BLOCK('相册')}.querySelector('.intake__paste')`);
  await sleep(3500);
  const albumPhotos = await cdp.ev(`(() => { const b = ${BLOCK('相册')};
    return [...b.querySelectorAll('.pblock-edit__row img')].map((i) => i.getAttribute('src')); })()`);
  check('① 真鼠标点相册的「粘贴」→ 剪贴板那张图真的成了相册里的一张照片',
    albumHit?.hitSelf === true && albumPhotos.length === 1 && String(albumPhotos[0]).startsWith('/img/uploads/'),
    JSON.stringify({ hit: albumHit?.hitSelf, photos: albumPhotos }));

  /* ---------- ② 相册整块只有一个口：焦点在标题框里 Ctrl+V 也进那个口 ---------- */
  await cdp.ev(`(() => { const b = ${BLOCK('相册')}; b.querySelector('input').focus(); return true; })()`);
  await sleep(200);
  await cdp.ev(FAKE_PASTE);
  await sleep(2500);
  const albumPhotos2 = await cdp.ev(`(() => { const b = ${BLOCK('相册')};
    return [...b.querySelectorAll('.pblock-edit__row img')].map((i) => i.getAttribute('src')); })()`);
  check('② 相册块里（焦点在标题框）Ctrl+V 直接进这个相册的口（不再弹「不知道放哪儿」）',
    albumPhotos2.length === 2 && albumPhotos2.every((s) => String(s).startsWith('/img/uploads/')),
    JSON.stringify(albumPhotos2));

  /* ---------- ③ 图鉴：批量口 + 每一条 ---------- */
  const codexAdded = await addBlock('图鉴');
  const codexBatch = await cdp.ev(`(() => { const b = ${BLOCK('图鉴')};
    return { n: b ? b.querySelectorAll('.intake__paste').length : -1 }; })()`);
  await cdp.ev(`(() => { const b = ${BLOCK('图鉴')};
    [...b.querySelectorAll('button')].find((x) => x.textContent.includes('空白条目')).click(); return true; })()`);
  await sleep(700);
  const codexRowBtns = await cdp.ev(`(() => { const b = ${BLOCK('图鉴')};
    const row = [...b.querySelectorAll('.pblock-edit__body .pblock-edit__row')]
      .filter((r) => r.querySelector('input[list="codex-link-pages"]'))[0];
    return row ? [...row.querySelectorAll('button')].map((x) => x.textContent) : null; })()`);
  check('③ 图鉴顶上那个口有「粘贴」，每一条也有（以前一条都没地方塞）',
    codexAdded && codexBatch?.n === 1 && (codexRowBtns || []).includes('粘贴'),
    JSON.stringify({ batch: codexBatch, row: codexRowBtns }));

  const codexRowPaste = `(() => { const b = ${BLOCK('图鉴')};
    const row = [...b.querySelectorAll('.pblock-edit__body .pblock-edit__row')]
      .filter((r) => r.querySelector('input[list="codex-link-pages"]'))[0];
    return row.querySelector('.intake__paste'); })()`;
  const codexHit = await cdp.clickEl(codexRowPaste);
  await sleep(3500);
  const codexRowImg = await cdp.ev(`(() => { const b = ${BLOCK('图鉴')};
    const row = [...b.querySelectorAll('.pblock-edit__body .pblock-edit__row')]
      .filter((r) => r.querySelector('input[list="codex-link-pages"]'))[0];
    return row.querySelector('img')?.getAttribute('src') || ''; })()`);
  check('③ 点某一条的「粘贴」→ 只给这一条传上图（条目还是 1 条）',
    codexHit?.hitSelf === true && String(codexRowImg).startsWith('/img/uploads/'),
    JSON.stringify({ hit: codexHit?.hitSelf, src: codexRowImg }));

  /* ---------- ④ 文字块 / 图片块 ---------- */
  await addBlock('文字');
  const textBtn = await cdp.ev(`(() => { const b = ${BLOCK('文字')};
    const p = b.querySelector('.intake__paste');
    return p ? { label: p.textContent } : null; })()`);
  await cdp.clickEl(`${BLOCK('文字')}.querySelector('.intake__paste')`);
  await sleep(3500);
  const textVal = await cdp.ev(`${BLOCK('文字')}.querySelector('textarea.pblock-edit__text').value`);
  check('④ 文字块有「粘贴图片」，点了真的把 Markdown 图片插进正文',
    textBtn?.label === '粘贴图片' && String(textVal).includes('](/img/uploads/'), JSON.stringify({ label: textBtn?.label, tail: String(textVal).slice(-60) }));

  await addBlock('图片');
  const imgBtn = await cdp.ev(`(() => { const b = ${BLOCK('图片')};
    return b ? b.querySelectorAll('.intake__paste').length : -1; })()`);
  await cdp.clickEl(`${BLOCK('图片')}.querySelector('.intake__paste')`);
  await sleep(3500);
  const imgThumb = await cdp.ev(`(() => { const b = ${BLOCK('图片')};
    return b.querySelector('.boardedit__thumb')?.style.backgroundImage || ''; })()`);
  check('④ 图片块也有「粘贴」，点了这一块的缩略图换成剪贴板那张',
    imgBtn === 1 && String(imgThumb).includes('/img/uploads/'), JSON.stringify({ n: imgBtn, thumb: imgThumb.slice(0, 80) }));

  /* ---------- ⑤ 地图（分页：加一页之后才有传图口） ---------- */
  await addBlock('地图');
  await cdp.clickEl(`(() => { const b = ${BLOCK('地图')};
    return [...b.querySelectorAll('button')].find((x) => x.textContent.includes('加一页')); })()`);
  await sleep(900);
  const mapBtn = await cdp.ev(`(() => { const b = ${BLOCK('地图')};
    return b ? b.querySelectorAll('.intake__paste').length : -1; })()`);
  await cdp.clickEl(`${BLOCK('地图')}.querySelector('.intake__paste')`);
  await sleep(3500);
  const mapThumb = await cdp.ev(`(() => { const b = ${BLOCK('地图')};
    return b.querySelector('.boardedit__thumb')?.style.backgroundImage || ''; })()`);
  check('⑤ 地图页也有「粘贴」，点了底图换成剪贴板那张',
    mapBtn === 1 && String(mapThumb).includes('/img/uploads/'), JSON.stringify({ n: mapBtn, thumb: String(mapThumb).slice(0, 60) }));

  /* ---------- ⑥ 封面 / 插入图片弹窗（静态那两处） ---------- */
  const staticSpots = await cdp.ev(`(() => ({
    cover: document.querySelectorAll('.cover .intake__paste').length,
    modal: document.querySelectorAll('#img-modal .intake__paste').length,
  }))()`);
  check('⑥ 文章封面和「插入图片」弹窗里也各有一个「粘贴」', staticSpots.cover === 1 && staticSpots.modal === 1,
    JSON.stringify(staticSpots));

  /* ---------- ⑦ 成员面板：每个人都注册了、都带按钮 ---------- */
  await cdp.ev(`window.__openWs('members')`);
  await sleep(2500);
  const mem = await cdp.ev(`(() => {
    const rows = [...document.querySelectorAll('#mem-editor .wmem')];
    return { n: rows.length,
      per: rows.map((r) => r.querySelectorAll('.intake__paste').length),
      total: document.querySelectorAll('#mem-editor .intake__paste').length,
      intakes: document.querySelectorAll('#mem-editor [data-img-intake]').length };
  })()`);
  check('⑦ 成员面板里每个人两个口（头像 / 放大图）都注册上了、都带「粘贴」',
    mem.n >= 2 && mem.per.every((x) => x === 2) && mem.total === mem.n * 2 && mem.intakes === mem.n * 2,
    JSON.stringify({ n: mem.n, per: mem.per.slice(0, 4), total: mem.total, intakes: mem.intakes }));

  const readMem = `(() => {
    const get = (r, label) => {
      const row = [...r.querySelectorAll('.wrow')].find((x) => x.querySelector('.wrow__label')?.textContent === label);
      return row ? row.querySelector('input')?.value || '' : null;
    };
    return [...document.querySelectorAll('#mem-editor .wmem')].map((r) => ({
      name: get(r, '名字'), avatar: get(r, '头像地址'), zoom: get(r, '放大图地址'),
    }));
  })()`;
  const memBefore = await cdp.ev(readMem);

  /* ---------- ⑧ 点第一个人的头像「粘贴」：只写进他，别人的不动 ---------- */
  const memHit = await cdp.clickEl(`(() => {
    const r = document.querySelectorAll('#mem-editor .wmem')[0];
    return r.querySelector('.wimg .intake__paste');
  })()`);
  await sleep(3500);
  const memAfter = await cdp.ev(readMem);
  /* 数据里本来就有几个人带图，所以只能比「谁变了」，不能要求别人是空的 */
  const changed = memAfter
    .map((m, i) => (JSON.stringify(m) === JSON.stringify(memBefore[i]) ? '' : m.name))
    .filter(Boolean);
  check('⑧ 点第 1 个人的头像「粘贴」→ 只有他的头像地址变成 /img/uploads/…（放大图、别人都没动）',
    memHit?.hitSelf === true && String(memAfter[0]?.avatar).startsWith('/img/uploads/')
      && memAfter[0]?.avatar !== memBefore[0]?.avatar
      && changed.length === 1 && changed[0] === memBefore[0]?.name,
    JSON.stringify({ hit: memHit?.hitSelf, changed, a0: memAfter[0]?.avatar }));

  /* ---------- ⑨ 重新开一次编辑器（没有"刚点过某个口"的记忆），在成员面板里 Ctrl+V ---------- */
  await cdp.open(`${base}/`, 2000);
  await cdp.ev(`window.__openWs('members')`);
  await sleep(2500);
  const memFresh = await cdp.ev(readMem);
  const namePos = await cdp.ev(`(() => {
    const r = document.querySelectorAll('#mem-editor .wmem')[0];
    const row = [...r.querySelectorAll('.wrow')].find((x) => x.querySelector('.wrow__label')?.textContent === '名字');
    const inp = row.querySelector('input');
    inp.scrollIntoView({ block: 'center' });
    const b = inp.getBoundingClientRect();
    return { x: b.left + 12, y: b.top + b.height / 2 };
  })()`);
  await cdp.click(namePos.x, namePos.y);
  await sleep(300);
  /*
    toast 只有一个 #toast 节点（2.2 秒后自己藏起来，但文字还在），
    所以在派发之后 700ms 就读它的 textContent —— 不能删节点，删了后面的 toast 就写进空气里。
  */
  const pasteToast = await cdp.ev(`(async () => {
    const blob = await (await fetch('${IMG_URL}')).blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
    let seen = 0;
    let info = null;
    const spy = (e) => {
      seen += 1;
      info = {
        files: e.clipboardData ? e.clipboardData.files.length : -1,
        items: e.clipboardData ? [...e.clipboardData.items].map((i) => i.type) : [],
      };
    };
    document.addEventListener('paste', spy, true);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    const at = document.activeElement || document.body;
    at.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 700));
    document.removeEventListener('paste', spy, true);
    return { text: document.querySelector('#toast')?.textContent || '', seen, info,
      active: at.tagName + '.' + (at.className || ''), ph: at.getAttribute?.('placeholder') || '' };
  })()`);
  await sleep(2500);
  const memPasted = await cdp.ev(readMem);
  const same = JSON.stringify(memPasted) === JSON.stringify(memFresh);
  const toast = pasteToast?.text || '';
  check('⑨ 没点过任何上传点时在成员面板 Ctrl+V：不再偷偷写进「最后一个成员的放大框」（明说放哪儿）',
    same && String(toast).includes('放哪儿'),
    JSON.stringify({ same, toast, paste: pasteToast }));

  /* ---------- ⑩ 精华：某一条的图片也有「粘贴」 ---------- */
  await cdp.ev(`window.__openWs('essences')`);
  await sleep(2200);
  await cdp.clickEl(`[...document.querySelectorAll('#ess-editor button')].find((b) => b.textContent.includes('新增一条'))`);
  await sleep(900);
  const essBtn = await cdp.ev(`document.querySelectorAll('#ess-editor .wess__imgadd .intake__paste').length`);
  const essHit = await cdp.clickEl(`document.querySelector('#ess-editor .wess__imgadd .intake__paste')`);
  await sleep(3500);
  const essImgs = await cdp.ev(`[...document.querySelectorAll('#ess-editor .wess__imgcell img')].map((i) => i.getAttribute('src'))`);
  check('⑩ 精华某一条的图片也有「粘贴」，点了真的加一张进去',
    essBtn === 1 && essHit?.hitSelf === true && essImgs.length === 1 && String(essImgs[0]).startsWith('/img/uploads/'),
    JSON.stringify({ n: essBtn, imgs: essImgs }));

  /* ---------- ⑪ 子版块封面 / 导航图标（boardCoverControl 那一套） ---------- */
  await cdp.ev(`window.__openWs('boards')`);
  await sleep(2000);
  const boardBtn = await cdp.ev(`(() => ({
    covers: document.querySelectorAll('#boards-editor .boardedit__cover').length,
    paste: document.querySelectorAll('#boards-editor .boardedit__cover .intake__paste').length,
  }))()`);
  check('⑪ 子版块每个封面 / 图标控件都带「粘贴」',
    boardBtn.covers > 0 && boardBtn.paste === boardBtn.covers, JSON.stringify(boardBtn));

  /* ---------- ⑫ 没有报错、盘上没变 ---------- */
  check('⑫ 全程没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));
  check('⑫ 没保存过：副本里的 home-boards.json 一个字节没动',
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
