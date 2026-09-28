/*
 * ============================================================================
 * 图片上传：大小限制 + 自动压缩 的验收
 * ----------------------------------------------------------------------------
 * 用户原话（2026-09-28）：
 *   「我上传一个 9mb 的图片到编辑器里却提示不能上传超过12mb的图片 请你修复
 *     并放开可以上传的图片大小限制 过大图片自动压制即可」
 *
 * 查出来的原因（三条叠在一起）：
 *   ① 前端 `uploadImage()` 把文件读成 **base64 data URL** 再塞进 JSON POST
 *      （`{ name, dataUrl }`）—— base64 要胀 1/3，9.3MB 的图到了服务端
 *      已经是 12.4MB 的请求体；
 *   ② 服务端 JSON 请求体上限就是 `MAX_BODY_BYTES = 12MB` → 直接 413，
 *      那句"超过 12MB"就是从这儿来的；
 *   ③ 就算没撞上①，还有一条 `MAX_UPLOAD_BYTES = 10MB`，和前端那道 20MB 的墙。
 *
 * 现在：前端把**原图直接当请求体**发（不 base64、不进 JSON），服务端边收边写
 * 临时文件、落盘前统一压（限宽 1920 + mozjpeg/WebP/动图 WebP）。图片没有
 * 产品意义上的大小上限，只有一个 128MB 的海啸阀。
 *
 * 四段：
 *   ① 接口层：9.3MB / >12MB / base64 那条老路 / 大 PNG / 14MB 动图 / SVG /
 *             不支持的类型 / 空 body —— 每种都真发一遍、量落盘结果
 *   ② 界面层：真浏览器里把那张 9.3MB 的图塞进「成员头像」的上传口，
 *             量请求头（content-type + content-length 必须等于**原图**字节数，
 *             不是 base64 的 1.33 倍）、toast 文案、落盘文件
 *   ③ 文案 / 源码：那道 10MB / 20MB / 12MB 的说法全站都不该再出现
 *
 * 全程在副本里跑（.tmp/upload-proj）：真仓库的 public/img/uploads 一个字节都不写。
 * 用法：node tools/checks/upload-limit-check.mjs
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..');
const DST = path.join(SRC, '.tmp', 'upload-proj');
const FILES = path.join(SRC, '.tmp', 'upload-check-files');
const DEBUG_PORT = 9365;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const MB = 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (n) => `${(n / MB).toFixed(2)}MB`;

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

/* ================================================================
 * ⓪ 副本 + 测试图
 * ================================================================ */
console.log('================ ⓪ 准备（副本 + 测试图）================');
if (fs.existsSync(DST)) {
  for (const j of ['node_modules']) {
    const p = path.join(DST, j);
    if (fs.existsSync(p)) { try { execSync(`cmd /c rmdir "${p}"`, { stdio: 'ignore' }); } catch { /* 不是 junction */ } }
  }
  fs.rmSync(DST, { recursive: true, force: true });
}
fs.mkdirSync(DST, { recursive: true });
/* public 要真拷（上传要往 public/img/uploads 写字），但 img/opt 那 40MB 变体不用拷 ——
   只把清单带过去，这样 optimizeOne 是"增量编这一张"而不是全量重编。 */
for (const item of ['src', 'tools', 'astro.config.mjs', 'package.json', 'tsconfig.json']) {
  fs.cpSync(path.join(SRC, item), path.join(DST, item), { recursive: true });
}
fs.cpSync(path.join(SRC, 'public'), path.join(DST, 'public'), {
  recursive: true,
  filter: (from) => {
    const rel = path.relative(path.join(SRC, 'public'), from).replace(/\\/g, '/');
    return !rel.startsWith('img/opt');
  },
});
fs.mkdirSync(path.join(DST, 'public', 'img', 'opt'), { recursive: true });
fs.copyFileSync(path.join(SRC, 'public', 'img', 'opt', 'manifest.json'), path.join(DST, 'public', 'img', 'opt', 'manifest.json'));
execSync(`cmd /c mklink /J "${path.join(DST, 'node_modules')}" "${path.join(SRC, 'node_modules')}"`, { stdio: 'ignore' });
console.log('副本就绪：', DST);

/* ---- 造测试图 ---- */
fs.rmSync(FILES, { recursive: true, force: true });
fs.mkdirSync(FILES, { recursive: true });
/** 噪声（不可压缩）像素：尺寸 × 质量直接决定字节数，好按目标大小捏 */
const noise = (w, h) => {
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < buf.length; i++) buf[i] = (Math.random() * 256) | 0;
  return buf;
};
const jpegOf = (w, h, q) =>
  sharp(noise(w, h), { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: q, mozjpeg: true }).toBuffer();

/** 用户的那个尺寸：9MB 出头 */
const userJpg = await jpegOf(4000, 3000, 92);
fs.writeFileSync(path.join(FILES, 'user-9mb.jpg'), userJpg);
/** 比旧的 12MB 请求体上限还大的一张 */
const hugeJpg = await jpegOf(5000, 3600, 96);
fs.writeFileSync(path.join(FILES, 'huge.jpg'), hugeJpg);
/** 大 PNG（截图那种） */
const bigPng = await sharp(noise(2200, 2200), { raw: { width: 2200, height: 2200, channels: 3 } })
  .png({ compressionLevel: 6 })
  .toBuffer();
fs.writeFileSync(path.join(FILES, 'big.png'), bigPng);
/** 矢量图 */
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#ff4fa3"/></svg>');
fs.writeFileSync(path.join(FILES, 'vec.svg'), svg);

/**
 * 手写一个**真的大动图 GIF**：256 级灰度调色板 + "只发字面量码"的 LZW
 * （每 250 个码补一个 CLEAR，码表就不涨、固定 9 位）。这样不用真编码器也能
 * 造出十几 MB 的动图，用来验"动图也自动压"。
 */
function makeGif(w, h, frames) {
  const out = [];
  out.push(Buffer.from('GIF89a', 'latin1'));
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(w, 0);
  lsd.writeUInt16LE(h, 2);
  lsd[4] = 0xf7; // 有全局色表、256 色
  out.push(lsd);
  const pal = Buffer.alloc(256 * 3);
  for (let i = 0; i < 256; i++) { pal[i * 3] = i; pal[i * 3 + 1] = i; pal[i * 3 + 2] = i; }
  out.push(pal);
  for (let f = 0; f < frames; f++) {
    out.push(Buffer.from([0x21, 0xf9, 0x04, 0x00, 0x04, 0x00, 0x00, 0x00])); // 停 4/100 秒
    const id = Buffer.alloc(10);
    id[0] = 0x2c;
    id.writeUInt16LE(w, 5);
    id.writeUInt16LE(h, 7);
    out.push(id);
    out.push(Buffer.from([0x08]));
    const chunks = [];
    let acc = 0;
    let bits = 0;
    const push9 = (code) => {
      acc |= code << bits;
      bits += 9;
      while (bits >= 8) { chunks.push(acc & 0xff); acc >>= 8; bits -= 8; }
    };
    let sinceClear = 0;
    push9(0x100);
    for (let i = 0; i < w * h; i++) {
      push9((Math.random() * 256) | 0);
      if (++sinceClear >= 250) { push9(0x100); sinceClear = 0; }
    }
    push9(0x101);
    if (bits > 0) chunks.push(acc & 0xff);
    const data = Buffer.from(chunks);
    for (let i = 0; i < data.length; i += 255) {
      const part = data.subarray(i, i + 255);
      out.push(Buffer.from([part.length]), part);
    }
    out.push(Buffer.from([0x00]));
  }
  out.push(Buffer.from([0x3b]));
  return Buffer.concat(out);
}
const bigGif = makeGif(900, 600, 24);
fs.writeFileSync(path.join(FILES, 'anim.gif'), bigGif);

console.log(
  `测试图：9MB 那张 ${mb(userJpg.length)} / 更大那张 ${mb(hugeJpg.length)} / ` +
    `PNG ${mb(bigPng.length)} / 动图 GIF ${mb(bigGif.length)}（24 帧）/ SVG ${svg.length}B`
);
check('测试图造出来了（9MB 那张确实 ≥ 9MB —— 就是用户说的那个尺寸）',
  userJpg.length >= 9 * MB, mb(userJpg.length));
check('另有一张比旧的 12MB 请求体上限还大的（原始字节 > 12MB）',
  hugeJpg.length > 12 * MB, mb(hugeJpg.length));
check('动图 GIF 确实是被 sharp 认作多帧的（不是一帧假动图）',
  ((await sharp(bigGif, { animated: true }).metadata()).pages ?? 1) === 24,
  `pages=${(await sharp(bigGif, { animated: true }).metadata()).pages}`);

/* ---- 起副本里的编辑器 ---- */
const editor = spawn(process.execPath, [path.join(DST, 'tools', 'editor', 'server.mjs')], {
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
if (!base) {
  console.error('编辑器没起来：' + elog.slice(-600));
  process.exit(2);
}
console.log('副本里的编辑器在', base);
const UPLOAD_DIR = path.join(DST, 'public', 'img', 'uploads');
const uploadsBefore = new Set(fs.readdirSync(UPLOAD_DIR));

/** 原始二进制上传（前端现在走的那条路） */
async function postRaw(buf, name, type) {
  const res = await fetch(`${base}/api/upload?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': type },
    body: buf,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}
/** 老的 base64 JSON 上传（旧前端 / editor-panels-e2e 那条路） */
async function postBase64(buf, name, type) {
  const res = await fetch(`${base}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, dataUrl: `data:${type};base64,${buf.toString('base64')}` }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}
const newFiles = () => fs.readdirSync(UPLOAD_DIR).filter((f) => !uploadsBefore.has(f));
const fileInfo = async (p) => {
  /* 站点路径（/img/uploads/…）→ 副本里的绝对路径（public/ 底下） */
  const abs = path.join(DST, 'public', p.replace(/^\//, ''));
  const stat = fs.statSync(abs);
  const meta = await sharp(abs, { animated: true, failOn: 'none' }).metadata().catch(() => ({}));
  return { abs, bytes: stat.size, ext: path.extname(abs).toLowerCase(), w: meta.width ?? 0, h: meta.height ?? 0, pages: meta.pages ?? 1, format: meta.format };
};

/* ================================================================
 * ① 接口层
 * ================================================================ */
console.log('\n================ ① 接口：多大的图都收，落盘前压 ================');

/* --- 1. 用户那张 9MB（原始二进制）--- */
{
  const r = await postRaw(userJpg, 'user-9mb.jpg', 'image/jpeg');
  check('★ 9MB 那张图（用户报的尺寸）原始二进制上传 → 200', r.status === 200 && r.body?.ok === true,
    `status=${r.status} ${r.body?.error ?? ''}`);
  if (r.body?.ok) {
    const f = await fileInfo(r.body.path);
    info(`9MB：${mb(userJpg.length)} → ${mb(f.bytes)}（${r.body.note}），落盘 ${f.w}×${f.h}，${path.basename(f.abs)}`);
    check('★ 落盘的是压过的那一份（≤ 1.5MB），不是原来那 9MB',
      f.bytes <= 1.5 * MB, mb(f.bytes));
    check('★ 宽度被限到 1920（高度按比例，长图不会被压矮）',
      f.w <= 1920 && f.h > 0 && Math.abs(f.h / f.w - 3000 / 4000) < 0.02, `${f.w}×${f.h}`);
    check('接口把压前 / 压后的真实字节数回了前端（提示里报的就是它）',
      r.body.before === userJpg.length && r.body.after === f.bytes,
      `before=${r.body.before} after=${r.body.after} 盘上=${f.bytes}`);
    check('压缩说明里写了怎么压的（不是空话）', /压缩|WebP|PNG/.test(String(r.body.note)), String(r.body.note));
  }
}

/* --- 2. 比旧的 12MB 请求体上限还大的一张 --- */
{
  const r = await postRaw(hugeJpg, 'huge.jpg', 'image/jpeg');
  const f = r.body?.ok ? await fileInfo(r.body.path) : null;
  info(`更大那张：${mb(hugeJpg.length)} → ${f ? mb(f.bytes) : '（失败）'}（${r.body?.note ?? r.body?.error}）`);
  check('★ 原始字节 > 12MB 的图也能传（这条以前连门都进不来）',
    r.status === 200 && r.body?.ok === true && f && f.bytes <= 1.5 * MB,
    `status=${r.status} ${f ? mb(f.bytes) : r.body?.error}`);
}

/* --- 3. 老的 base64 JSON 路：这条正是用户看到的那句 12MB --- */
{
  const r = await postBase64(userJpg, 'user-9mb-b64.jpg', 'image/jpeg');
  const wire = Buffer.byteLength(JSON.stringify({ name: 'user-9mb-b64.jpg', dataUrl: `data:image/jpeg;base64,${userJpg.toString('base64')}` }));
  const f = r.body?.ok ? await fileInfo(r.body.path) : null;
  info(`base64 老路：请求体 ${mb(wire)}（原图 ${mb(userJpg.length)} 的 1.33 倍）→ status=${r.status} ${f ? mb(f.bytes) : r.body?.error}`);
  check('★ 9MB 的图走老的 base64 JSON 路也不再报 12MB（请求体 12MB+，现在照样 200）',
    wire > 12 * MB && r.status === 200 && r.body?.ok === true && f && f.bytes <= 1.5 * MB,
    `请求体 ${mb(wire)}，status=${r.status}`);
}

/* --- 4. 大 PNG --- */
{
  const r = await postRaw(bigPng, 'big.png', 'image/png');
  const f = r.body?.ok ? await fileInfo(r.body.path) : null;
  info(`PNG：${mb(bigPng.length)} → ${f ? `${mb(f.bytes)}（${f.ext}，${r.body.note}）` : r.body?.error}`);
  check('★ 14MB 的 PNG 也收（压完换成 WebP 那一份），落盘 ≤ 2.5MB、宽 ≤ 1920',
    r.status === 200 && r.body?.ok === true && f && f.bytes <= 2.5 * MB && f.w <= 1920,
    f ? `${mb(f.bytes)} ${f.w}×${f.h} ${f.ext}` : `status=${r.status} ${r.body?.error}`);
}

/* --- 5. 14MB 的动图 GIF（这条以前是"原样落盘"，等于把 14MB 塞进仓库）--- */
{
  const r = await postRaw(bigGif, 'anim.gif', 'image/gif');
  const f = r.body?.ok ? await fileInfo(r.body.path) : null;
  info(`动图 GIF：${mb(bigGif.length)} → ${f ? `${mb(f.bytes)}（${f.ext}，${f.pages} 帧，${r.body.note}）` : r.body?.error}`);
  check('★ 14MB 的动图也自动压（转成动图 WebP），而且帧数没丢',
    r.status === 200 && r.body?.ok === true && f && f.bytes < bigGif.length * 0.8 && (f.pages ?? 1) > 1,
    f ? `${mb(f.bytes)} ${f.ext} pages=${f.pages}` : `status=${r.status} ${r.body?.error}`);
}

/* --- 6. SVG：矢量图不该被重编码 --- */
{
  const r = await postRaw(svg, 'vec.svg', 'image/svg+xml');
  const f = r.body?.ok ? await fileInfo(r.body.path) : null;
  const same = f ? fs.readFileSync(f.abs).equals(svg) : false;
  info(`SVG：${svg.length}B → ${f ? `${f.bytes}B（${r.body.note}）` : r.body?.error}`);
  check('矢量图原样保留（重编码等于拍成位图）', r.status === 200 && same, r.body?.note);
}

/* --- 7. 不认的类型 / 空 body --- */
{
  const r = await postRaw(Buffer.from('这不是图片'), 'note.txt', 'text/plain');
  check('不认的扩展名 → 415，而且消息里列了允许的格式',
    r.status === 415 && /png|jpeg|gif|webp|svg/.test(String(r.body?.error)), `status=${r.status} ${r.body?.error}`);
  const r2 = await postRaw(Buffer.alloc(0), 'empty.jpg', 'image/jpeg');
  check('空的图片 body → 400', r2.status === 400, `status=${r2.status} ${r2.body?.error}`);
}

/* --- 8. 没有留下临时残片 --- */
{
  const strays = newFiles().filter((f) => f.startsWith('.') || f.startsWith('recv'));
  const tmpStrays = fs.readdirSync(process.env.TEMP ?? '.').filter((f) => f.startsWith('dsh-upload-')).length;
  check('落盘目录里没有临时残片（收图片用的是系统临时目录，压完就删）',
    strays.length === 0, `${strays.join(' ') || '（没有）'}；系统临时目录里 dsh-upload-* 还有 ${tmpStrays} 个`);
}

/* ================================================================
 * ② 界面层：真浏览器里把 9MB 的图塞进上传口
 * ================================================================ */
console.log('\n================ ② 界面：真在编辑器里传一遍 9MB ================');
const profile = path.join(process.env.TEMP ?? '.', `dsh-profile-upload-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu',
  '--enable-unsafe-swiftshader', '--disable-breakpad', '--window-size=1440,960',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; this.net = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails?.exception?.description ?? '');
      if (m.method === 'Network.requestWillBeSent' && /\/api\/upload/.test(m.params.request.url)) {
        this.net.push({
          id: m.params.requestId,
          url: m.params.request.url,
          method: m.params.request.method,
          headers: m.params.request.headers,
          postData: m.params.request.postData,
          hasPostData: m.params.request.hasPostData,
        });
      }
      /* requestWillBeSent 那份头里常常没有 content-length（协议层后加的），
         extraInfo 这份才有 —— 两个都收，取得到的那个用 */
      if (m.method === 'Network.requestWillBeSentExtraInfo') {
        const hit = (this.net || []).find((r) => r.id === m.params.requestId);
        if (hit) hit.extra = m.params.headers;
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
  async open(u, wait = 1500) {
    this.errors = [];
    await this.send('Page.navigate', { url: u });
    for (let i = 0; i < 200; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
  }
}

let cdp = null;
for (let i = 0; i < 80 && !cdp; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    if (page) cdp = await CDP.attach(page.webSocketDebuggerUrl);
  } catch { /* 还没起来 */ }
}
if (!cdp) {
  console.error('Chromium 没起来');
  editor.kill();
  process.exit(2);
}
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Network.enable');
await cdp.send('DOM.enable');
await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });

await cdp.open(base + '/', 1400);
check('编辑器页面起来了', (await cdp.ev('typeof window.__openWs === "function"')) === true);

/* 打开「成员」面板，挑第一行那个头像上传口（imageSlot → uploadImage，三条路都汇到它） */
const rowId = await cdp.ev(`(async () => {
  await window.__openWs('members');
  await new Promise((r) => setTimeout(r, 1200));
  const w = [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
  const row = w && w.querySelector('.wmem');
  return row ? row.dataset.memberId : '';
})()`);
check('成员面板打开了，拿得到第一行成员', !!rowId, rowId);

let uploadState = null;
if (rowId) {
  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  const node = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: `.wmem[data-member-id="${rowId}"] input[type=file]` });
  check('那个成员的头像上传口在（隐藏的 input[type=file]）', !!node?.nodeId, `nodeId=${node?.nodeId}`);
  if (node?.nodeId) {
    /* 先把这一行的头像清空：这一行本来就有头像（值是老的 /img/uploads/… 路径），
       不清空的话"等它变成 /img/uploads/"会在上传还没完的时候就命中旧值。 */
    const cleared = await cdp.ev(`(async () => {
      const row = document.querySelector('.wmem[data-member-id="${rowId}"]');
      const btn = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === '清空');
      if (!btn) return { ok: false, why: '找不到清空按钮' };
      btn.click();
      await new Promise((r) => setTimeout(r, 200));
      const inputs = [...row.querySelectorAll('input[type=text], input:not([type])')];
      return { ok: true, values: inputs.map((i) => i.value).filter(Boolean) };
    })()`);
    info('上传前先把这一行的头像清空：' + JSON.stringify(cleared));
    check('上传前先清空（这样"值变成 /img/uploads/"就一定是这次传的）',
      cleared.ok === true && !cleared.values.some((v) => v.startsWith('/img/uploads/')), JSON.stringify(cleared));

    await cdp.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [path.join(FILES, 'user-9mb.jpg')] });
    /* 等它传完：那一行的头像地址框会变成 /img/uploads/... */
    for (let i = 0; i < 200; i++) {
      await sleep(300);
      uploadState = await cdp.ev(`(() => {
        const row = document.querySelector('.wmem[data-member-id="${rowId}"]');
        if (!row) return null;
        const inputs = [...row.querySelectorAll('input[type=text], input:not([type])')];
        const hit = inputs.find((i) => (i.value || '').startsWith('/img/uploads/'));
        const t = document.getElementById('toast');
        return {
          path: hit ? hit.value : '',
          toast: t && !t.hidden ? t.textContent : '',
          thumb: (row.querySelector('img') || {}).getAttribute ? row.querySelector('img').getAttribute('src') : '',
        };
      })()`);
      if (uploadState && uploadState.path) break;
    }
    info('界面上传结果：' + JSON.stringify(uploadState));
    check('★ 界面上传 9MB 那张成功了（那一行的头像地址变成刚传的那张 /img/uploads/…）',
      !!uploadState && /^\/img\/uploads\//.test(uploadState.path || ''), JSON.stringify(uploadState));
    /* 提示里那句"压前 → 压后"的压前数必须等于磁盘上那张的字节数 ——
       9.3MB；如果传的是 base64，这里会变成 12.4MB。（压后小于 1MB 时单位是 KB） */
    const toastNums = /（([\d.]+)(MB|KB) → ([\d.]+)(MB|KB)/.exec(uploadState?.toast || '');
    const toMb = (v, u) => (u === 'MB' ? Number(v) : Number(v) / 1024);
    check('★ 提示里报了真实的压缩结果（压前那个数就是原图的 9.3MB，不是 base64 的 12.4MB）',
      !!toastNums &&
        Math.abs(toMb(toastNums[1], toastNums[2]) - userJpg.length / MB) < 0.05 &&
        toMb(toastNums[3], toastNums[4]) < 1.5,
      String(uploadState?.toast));
    check('缩略图换成了新传的那张（不是还挂着旧的）',
      !!uploadState && uploadState.thumb === uploadState.path, `${uploadState?.thumb} vs ${uploadState?.path}`);

    /* 请求头：这是"不再 base64"的硬证据 —— 请求体字节数 = 原图字节数 */
    const req = (cdp.net || []).find((r) => r.method === 'POST');
    check('★ 界面这次上传只有一个 POST /api/upload（没有先编码成 data URL 再发第二遍）',
      (cdp.net || []).length === 1, JSON.stringify((cdp.net || []).map((r) => r.url)));
    if (req) {
      const pick = (name) => {
        const a = Object.fromEntries(Object.entries(req.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
        const b = Object.fromEntries(Object.entries(req.extra || {}).map(([k, v]) => [k.toLowerCase(), v]));
        return a[name] ?? b[name];
      };
      const len = pick('content-length');
      const chunked = pick('transfer-encoding');
      const type = pick('content-type');
      info('上传请求头：' + JSON.stringify({ type, len, transfer: chunked, postData: req.postData ? `${String(req.postData).length} 字节` : '（二进制，没有 postData）' }));
      check('★ 请求体就是原图本身：content-length == 磁盘上那张的字节数（base64 会是它的 1.33 倍）',
        Number(len) === userJpg.length || (!len && /chunked/i.test(String(chunked)) && req.hasPostData === true && !req.postData),
        `content-length=${len}，原图=${userJpg.length}（base64 会是 ${Math.ceil(userJpg.length / 3) * 4}），postData=${req.postData ? '有' : '无'}`);
      check('★ 请求头是图片类型，不是 application/json（不走 JSON 就没有那条 12MB 上限）',
        /^image\//.test(String(type)) && !/json/.test(String(type)), String(type));
    } else {
      check('抓到那次上传请求', false, 'Network 里没看到 /api/upload');
    }

    /* 落盘：界面上传的这张也必须是压过的小图 */
    if (uploadState?.path) {
      const f = await fileInfo(uploadState.path);
      info(`界面上传落盘：${mb(f.bytes)}，${f.w}×${f.h}`);
      check('★ 界面传的这张落盘也是压过的（≤ 1.5MB、宽 ≤ 1920）',
        f.bytes <= 1.5 * MB && f.w <= 1920, `${mb(f.bytes)} ${f.w}×${f.h}`);
    }
    check('界面上这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));
  }
}

/* ================================================================
 * ③ 文案 / 源码：那些"不能超过 10MB / 12MB / 20MB"的说法
 * ================================================================ */
console.log('\n================ ③ 那些大小限制的说法都没了 ================');
const appJs = fs.readFileSync(path.join(SRC, 'tools/editor/ui/app.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(SRC, 'tools/editor/server.mjs'), 'utf8');
const uiHtml = fs.readFileSync(path.join(SRC, 'tools/editor/ui/index.html'), 'utf8');
const editorReadme = fs.readFileSync(path.join(SRC, 'tools/editor/README.md'), 'utf8');

check('服务端没有「单张图片不能超过 10MB」这条了（MAX_UPLOAD_BYTES 也删了）',
  !/MAX_UPLOAD_BYTES/.test(serverJs) && !/不能超过 10MB/.test(serverJs));
check('服务端 JSON 上传路的上限单独抬高了（不是那个 12MB）',
  /MAX_JSON_UPLOAD_BYTES = 192 \* 1024 \* 1024/.test(serverJs) && /readBody\(req, MAX_JSON_UPLOAD_BYTES/.test(serverJs));
check('服务端按 content-type 分流：JSON 走老路、二进制走流式（边收边写盘）',
  /ct\.includes\('application\/json'\)/.test(serverJs) && /handleImageUpload\(req, res, url\)/.test(serverJs) &&
    /function receiveImage\(/.test(serverJs));
check('前端没有 20MB 那道墙了，也不再 base64（readFileAsDataURL 已经没人用/没了）',
  !/20 \* 1024 \* 1024/.test(appJs) && !/function readFileAsDataURL/.test(appJs) && !/readFileAsDataURL\(/.test(appJs) &&
    /body: file/.test(appJs) && /\/api\/upload\?name=/.test(appJs));
check('前端上传时给个反馈（几 MB 的图会说"正在上传并压缩"）',
  /正在上传并压缩/.test(appJs));
check('「插入图片」弹窗那行小字不再写"单张不超过 10MB"',
  !/不超过 10MB/.test(uiHtml) && !/不超过 10MB/.test(appJs) && /多大的图都行/.test(uiHtml) && /多大的图都行/.test(appJs));
check('编辑器那本说明也改了（不再写"单张上限 10MB；请求体上限 12MB"）',
  !/单张上限 10MB/.test(editorReadme) && /没有大小限制/.test(editorReadme));
check('动图也自动压（GIF → 动图 WebP），不再"原样落盘"',
  /gifWebp/.test(fs.readFileSync(path.join(SRC, 'tools/images/optimize.mjs'), 'utf8')) &&
    /动图 → WebP/.test(fs.readFileSync(path.join(SRC, 'tools/images/optimize.mjs'), 'utf8')));

/* ================================================================
 * 收尾
 * ================================================================ */
try { await cdp.send('Browser.close'); } catch { /* ignore */ }
chrome.kill();
editor.kill();
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* 浏览器还占着就算了 */ }
console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
console.log(`（落盘目录里这次多了 ${newFiles().length} 个文件，都在副本里：${DST}）`);
process.exit(fail === 0 ? 0 : 1);
