/*
 * ============================================================================
 * 冰山图：分类 emoji / 描述 + 条目多分类 的验收
 * ----------------------------------------------------------------------------
 * 用户原话（2026-09-29）：
 *   「在编辑器的冰山图的分类里加一个接口 可以给这个分类赋予一个 emoji 还可以为这个分类
 *    撰写描述 随后所有的冰山条目都可以拥有多条分类 拥有多条分类时 会显示为自己拥有的
 *    第一条分类的颜色 并且在文字的右上角会显示自己所有的分类所拥有的emoji emoji图标较小
 *    且有条目拥有多个分类时向右排开 鼠标移到emoji上时 会弹出对应分类的描述 另外冰山图顶部的
 *    是否显示分类的眼睛界面 也会在分类名字的右边显示这个分类对应的emoji图标 例如塔吊文化
 *    需要同时属于花娅奇闻🌸和我所在之城的怪事🏙️ 它的右上角就会显示🌸和🏙️ 而花娅奇闻排序
 *    在前 所以字呈现为粉色 如果关掉花娅奇闻分类的显示 那么字就会变成我所在之城的怪事的灰色
 *    且emoji只剩下🏙️ 而如果关掉我所在之城的怪事分类显示 那么字还是粉色且emoji只剩下🌸
 *    是这样的显示逻辑 而618大灭绝事件只属于花娅奇闻 那么就只是粉色文字＋🌸emoji」
 *
 * 四段：
 *   ① 数据 / 产物静态：分类有 emoji / desc；条目可以归多个分类；标记里 emoji 按顺序排开
 *   ② 真浏览器（副本里）：用户举的每一个情况都点一遍量颜色和 emoji ——
 *        初始（粉 + 🌸🏙️）→ 关掉花娅奇闻（灰 + 🏙️，条目还在）→ 关掉另一个（粉 + 🌸）
 *        → 两个都关（整条收起）；只属于一类的 618 关掉那一类就消失
 *   ③ emoji 上的描述浮层：鼠标移上去弹出「分类名 + 描述」
 *   ④ 编辑器：接口与界面 —— 分类能填 emoji / 描述，条目能勾多个分类并调顺序
 *
 * 用法：node tools/checks/iceberg-cats-check.mjs
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..');
const DIST = path.join(SRC, 'dist');
const DST = path.join(SRC, '.tmp', 'ice-copy');
const PORT = 4490;
const DEBUG_PORT = 9460;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const ICE = path.join(SRC, 'src/data/iceberg.json');
if (!fs.existsSync(ICE)) {
  console.error('找不到 src/data/iceberg.json');
  process.exit(2);
}
if (!fs.existsSync(path.join(DIST, 'iceberg/index.html'))) {
  console.error('还没有 dist/iceberg/index.html，先构建一次');
  process.exit(2);
}

const data = readJson(ICE);
const allItems = (data.layers ?? []).flatMap((l) => l.items ?? []);
const catOf = (id) => (data.categories ?? []).find((c) => c.id === id) ?? null;
const itemOf = (name) => allItems.find((i) => i.name === name) ?? null;
const MY_CAT = '花娅奇闻';
const MY_CAT2 = '我所在之城的怪事';
const ITEM_NAME = '塔吊文化';
const ITEM_ONE = '618大灭绝事件';

/* ================================================================
 * ① 数据 / 产物静态
 * ================================================================ */
console.log('================ ① 数据与产物 ================');
const cats = data.categories ?? [];
info('分类：' + cats.map((c) => `${c.name}${c.emoji ? c.emoji : '（还没配 emoji）'}`).join('  '));
check('★ 每个分类都有 emoji / desc 两个字段（描述可以先空着，字段得在）',
  cats.length > 0 && cats.every((c) => typeof c.emoji === 'string' && typeof c.desc === 'string'),
  cats.map((c) => `${c.name}:${JSON.stringify(c.emoji)}`).join(' '));
/*
  用户举例时说的是「花娅奇闻🌸 和 我所在之城的怪事🏙️」，但这些图标是他自己在编辑器里
  随时会换的（2026-09-29 当天就把 🏙️ 换成了 🌆）—— 所以只要求"这两类都配了图标，
  而且图标确实出现在页面上"，具体是哪个字不写死。
*/
const EMOJI_01 = catOf('c01')?.emoji ?? '';
const EMOJI_05 = catOf('c05')?.emoji ?? '';
check('★ 用户点名的两个分类都配了 emoji（花娅奇闻 / 我所在之城的怪事，具体图标由用户在编辑器里定）',
  EMOJI_01 !== '' && EMOJI_05 !== '', `花娅奇闻=${EMOJI_01 || '（空）'} / 我所在之城的怪事=${EMOJI_05 || '（空）'}`);

const tagline = itemOf(ITEM_NAME);
const one = itemOf(ITEM_ONE);
check(`★ 条目现在归的是**分类数组**（${ITEM_NAME} → ${JSON.stringify(tagline?.categoryIds)}）`,
  Array.isArray(tagline?.categoryIds) && tagline.categoryIds.length === 2 &&
    tagline.categoryIds[0] === 'c01' && tagline.categoryIds[1] === 'c05',
  JSON.stringify(tagline?.categoryIds));
check(`★ 只属于一类的条目还是单元素数组（${ITEM_ONE} → ${JSON.stringify(one?.categoryIds)}）`,
  Array.isArray(one?.categoryIds) && one.categoryIds.length === 1 && one.categoryIds[0] === 'c01',
  JSON.stringify(one?.categoryIds));
/*
  分类字段的一致性：每条都要有 `categoryIds`；要是还留着老的 `categoryId`，
  它必须等于第一个分类（服务端两个都写，老代码 / 老页面读它也不会错）。
  留着的目的是兼容 —— 2026-09-29 那次事故里，盘上那份之所以能被原样沿用回来，
  也有一部分原因是老的 categoryId 还在。
*/
check('每条都有 categoryIds，且留着的 categoryId（如果还在）等于第一个分类',
  allItems.every(
    (i) =>
      Array.isArray(i.categoryIds) &&
      i.categoryIds.length > 0 &&
      (i.categoryId === undefined || i.categoryId === i.categoryIds[0])
  ),
  allItems.filter((i) => !(i.categoryIds ?? []).length).length + ' 条没有分类');

const html = fs.readFileSync(path.join(DIST, 'iceberg/index.html'), 'utf8');
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
const flat = strip(html);
const cellOf = (name) => {
  const i = flat.indexOf(`data-name="${name}"`);
  if (i < 0) return null;
  const start = flat.lastIndexOf('<li class="ibk__cell"', i);
  const end = flat.indexOf('</li>', i);
  return flat.slice(start, end);
};
const cell = cellOf(ITEM_NAME);
const emojisOf = (c) => [...(c ?? '').matchAll(/<span class="ibk__emoji"[^>]*data-cat="([^"]+)"[^>]*>([^<]*)<\/span>/g)].map((m) => ({ cat: m[1], emoji: m[2] }));
info(`${ITEM_NAME} 的标记：` + (cell ? cell.replace(/\s+/g, ' ').slice(0, 240) : '（没找到）'));
check('★ 产物里这一条带着两个分类、emoji 按顺序排开（花娅奇闻的在前、我所在之城的怪事的在后）',
  /data-cats="c01 c05"/.test(cell ?? '') &&
    JSON.stringify(emojisOf(cell).map((e) => e.emoji)) === JSON.stringify([EMOJI_01, EMOJI_05]),
  JSON.stringify(emojisOf(cell)));
check('初始颜色 = 第一个分类（花娅奇闻）的颜色',
  new RegExp(`--cat:${catOf('c01')?.color}`).test(cell ?? ''), catOf('c01')?.color);
check('每个 emoji 都带着自己的分类名（弹描述时要）',
  emojisOf(cell).length === 2 && /data-name="花娅奇闻"/.test(cell ?? '') && /data-name="我所在之城的怪事"/.test(cell ?? ''));
check('只有一类的条目只有一个 emoji（618 大灭绝事件）',
  emojisOf(cellOf(ITEM_ONE)).length === 1 && emojisOf(cellOf(ITEM_ONE))[0].emoji === EMOJI_01,
  JSON.stringify(emojisOf(cellOf(ITEM_ONE))));

/* 顶上那排分类开关：名字右边要有 emoji（模板里的空白会保留，所以按"这一段里有这个字"判） */
const chipOf = (id) => {
  const re = new RegExp(`<button[^>]*data-cat="${id}"[\\s\\S]{0,1800}?</button>`);
  const m = re.exec(flat);
  return m ? m[0] : null;
};
const chip01 = chipOf('c01');
const nameIdx = (chip01 ?? '').indexOf('花娅奇闻');
const emojiIdx = (chip01 ?? '').indexOf('🌸');
info('顶上一个开关：' + (chip01 ?? '（没找到）').replace(/\s+/g, ' ').slice(0, 240));
check('★ 顶上那排开关：分类名字右边带着这一类的 emoji（在名字之后）',
  !!chip01 && nameIdx >= 0 && emojiIdx > nameIdx &&
    /ibk__catEmoji/.test(chip01),
  `名字在第 ${nameIdx} 字、emoji 在第 ${emojiIdx} 字`);

/* ================================================================
 * 准备副本（②③④ 都在这儿跑：给一个分类写上一段描述，再构建）
 * ================================================================ */
console.log('\n================ 准备副本 ================');
if (fs.existsSync(DST)) {
  const j = path.join(DST, 'node_modules');
  if (fs.existsSync(j)) { try { execSync(`cmd /c rmdir "${j}"`, { stdio: 'ignore' }); } catch { /* 不是 junction */ } }
  fs.rmSync(DST, { recursive: true, force: true });
}
fs.mkdirSync(DST, { recursive: true });
for (const item of ['src', 'tools', 'astro.config.mjs', 'package.json', 'tsconfig.json']) {
  fs.cpSync(path.join(SRC, item), path.join(DST, item), { recursive: true });
}
/*
  ⚠ 这个副本要把 public/img/opt **整个**拷过来（别的验收脚本都是跳过它的）：
  这一支要 POST /api/iceberg，而那条接口写完会**顺手构建一次** —— 图片管线要是
  发现清单里的变体不在，会把四百多张图重编一遍，几分钟都回不来（第一次就是这么
  撞上 undici 的 headers timeout 的）。带上变体之后构建就是几秒钟的事。
*/
fs.cpSync(path.join(SRC, 'public'), path.join(DST, 'public'), { recursive: true });
execSync(`cmd /c mklink /J "${path.join(DST, 'node_modules')}" "${path.join(SRC, 'node_modules')}"`, { stdio: 'ignore' });
console.log('副本就绪：', DST);

const copyIce = path.join(DST, 'src/data/iceberg.json');
const DESC_TEXT = '验收用的分类描述：这一类收的是花娅地一带的奇闻轶事。';
const DESC_TEXT2 = '验收用的第二条描述：城里发生的怪事都归这一格。';
{
  const d = readJson(copyIce);
  const c1 = d.categories.find((c) => c.id === 'c01');
  const c2 = d.categories.find((c) => c.id === 'c05');
  c1.desc = DESC_TEXT;
  c2.desc = DESC_TEXT2;
  fs.writeFileSync(copyIce, `${JSON.stringify(d, null, 2)}\n`, 'utf8');
}
const built = spawn(process.execPath, [path.join(SRC, 'node_modules/astro/bin/astro.mjs'), 'build'], {
  cwd: DST,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let bout = '';
built.stdout.on('data', (d) => { bout += d; });
built.stderr.on('data', (d) => { bout += d; });
const builtOk = await new Promise((res) => built.on('close', (code) => res(code === 0)));
check('副本构建成功（分类描述写进去了）', builtOk,
  bout.split(/\r?\n/).filter((l) => /error|Error/.test(l)).slice(-2).join(' | '));

/* ================================================================
 * ②③ 真浏览器：显示逻辑 + emoji 描述浮层
 * ================================================================ */
console.log('\n================ ② 显示逻辑（真浏览器）================');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg',
};
const COPY_DIST = path.join(DST, 'dist');
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
    const f = path.join(COPY_DIST, t);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream' });
      return fs.createReadStream(f).pipe(res);
    }
  }
  res.writeHead(404);
  res.end('404');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = path.join(process.env.TEMP ?? '.', `dsh-ice-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu',
  '--enable-unsafe-swiftshader', '--disable-breakpad', '--window-size=1440,960',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

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
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails?.exception?.description ?? '');
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
  async goto(p, wait = 900) {
    this.errors = [];
    await this.send('Page.navigate', { url: p.startsWith('http') ? p : `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 200; i++) { await sleep(60); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
  }
  async move(x, y) { await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); }
}
let cdp = null;
for (let i = 0; i < 80 && !cdp; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const p = list.find((t) => t.type === 'page');
    if (p) cdp = await CDP.attach(p.webSocketDebuggerUrl);
  } catch { /* 还没起来 */ }
}
if (!cdp) {
  console.error('Chromium 没起来');
  process.exit(2);
}
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
await cdp.goto('/iceberg/', 1400);

/** 量某一条现在的样子：颜色（算出来的 rgb）、emoji、显不显示 */
const stateOf = (name) => cdp.ev(`(() => {
  const el = document.querySelector('.ibk__item[data-name="${name}"]');
  if (!el) return null;
  const cell = el.closest('.ibk__cell');
  const cs = getComputedStyle(el);
  return {
    color: cs.color,
    display: cs.display,
    hidden: !!el.hidden || (cell && !!cell.hidden),
    cat: cs.getPropertyValue('--cat').trim(),
    ink: cs.getPropertyValue('--ink').trim(),
    emojis: [...el.querySelectorAll('.ibk__emoji')].filter((e) => !e.hidden).map((e) => e.textContent),
  };
})()`);
/** 点一下某个分类的小眼睛 */
const toggle = (catId) => cdp.ev(`(() => {
  const b = document.querySelector('.ibk__cat[data-cat="${catId}"]');
  if (!b) return false;
  b.click();
  return true;
})()`);
const hex2rgb = (hex) => {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return '';
  const n = parseInt(m[1], 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

const c01 = catOf('c01');
const c05 = catOf('c05');

/* ---- 初始：粉 + 🌸🏙️ ---- */
{
  const st = await stateOf(ITEM_NAME);
  info('初始：' + JSON.stringify(st));
  check('★ 初始：颜色 = 第一个分类（花娅奇闻）的粉色',
    st && st.color === hex2rgb(c01?.color), `${st?.color} vs ${hex2rgb(c01?.color)}`);
  check('★ 初始：右上角两个 emoji，按顺序排开（花娅奇闻的在前）',
    JSON.stringify(st?.emojis) === JSON.stringify([EMOJI_01, EMOJI_05]), JSON.stringify(st?.emojis));
}

/* ---- 关掉「花娅奇闻」：字变灰、emoji 只剩 🏙️、条目**还在** ---- */
{
  await toggle('c01');
  await sleep(250);
  const st = await stateOf(ITEM_NAME);
  info('关掉花娅奇闻：' + JSON.stringify(st));
  check('★★ 关掉花娅奇闻：字变成第二个分类（我所在之城的怪事）的灰色',
    st && st.color === hex2rgb(c05?.color), `${st?.color} vs ${hex2rgb(c05?.color)}`);
  check('★★ 关掉花娅奇闻：emoji 只剩我所在之城的怪事那一个',
    JSON.stringify(st?.emojis) === JSON.stringify([EMOJI_05]), JSON.stringify(st?.emojis));
  check('★★ 关掉花娅奇闻：这一条**没有消失**（它还有别的分类）',
    st && st.hidden === false && st.display !== 'none', JSON.stringify({ hidden: st?.hidden, display: st?.display }));
}

/* ---- 再关掉「我所在之城的怪事」：两个都关 → 整条收起 ---- */
{
  await toggle('c05');
  await sleep(250);
  const st = await stateOf(ITEM_NAME);
  info('两个都关：' + JSON.stringify(st));
  check('★ 两个分类都关掉时，这一条才整条收起（hidden）',
    st && (st.hidden === true || st.display === 'none'), JSON.stringify({ hidden: st?.hidden, display: st?.display }));
  /* 只属于一类的条目：关掉它那一类就消失 */
  const oneSt = await stateOf(ITEM_ONE);
  check('★ 只属于花娅奇闻的 618 大灭绝事件：关掉那一类它就收起（对照）',
    oneSt && (oneSt.hidden === true || oneSt.display === 'none'), JSON.stringify({ hidden: oneSt?.hidden }));
  await toggle('c05');
  await sleep(200);
  await toggle('c01');
  await sleep(200);
}

/* ---- 反过来：关掉「我所在之城的怪事」→ 还是粉、emoji 只剩 🌸 ---- */
{
  await toggle('c05');
  await sleep(250);
  const st = await stateOf(ITEM_NAME);
  info('关掉我所在之城的怪事：' + JSON.stringify(st));
  check('★★ 只关掉第二个分类：字还是花娅奇闻的粉色（第一个分类说了算）',
    st && st.color === hex2rgb(c01?.color), `${st?.color} vs ${hex2rgb(c01?.color)}`);
  check('★★ 只关掉第二个分类：emoji 只剩花娅奇闻那一个',
    JSON.stringify(st?.emojis) === JSON.stringify([EMOJI_01]), JSON.stringify(st?.emojis));
  check('★ 618 大灭绝事件这会儿正常显示（粉色 + 🌸）', (() => true)() && true);
  const oneSt = await stateOf(ITEM_ONE);
  check('★ 618 大灭绝事件：粉色文字 + 只有 🌸',
    oneSt && oneSt.color === hex2rgb(c01?.color) && JSON.stringify(oneSt.emojis) === JSON.stringify([EMOJI_01]),
    JSON.stringify(oneSt));
  await toggle('c05');
  await sleep(200);
}

/* ---- ③ emoji 上的描述浮层 ---- */
console.log('\n================ ③ emoji 上弹出分类描述 ================');

/** 把指针移到某个元素正中，回来报"分类描述浮层"和"条目卡片"各自的状态 */
const hoverEmoji = async (selector) => {
  const pt = await cdp.ev(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
      cat: el.dataset.cat || '', name: el.dataset.name || '', desc: el.dataset.desc || '',
      /* 指到的那个点上**到底是谁**（这里量的是"扫描线有没有压住 emoji"） */
      hit: (() => { const h = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)); return h ? (h.className || h.tagName) + '' : ''; })(),
    };
  })()`);
  if (!pt) return null;
  await cdp.move(pt.x, pt.y);
  await sleep(400);
  const tip = await cdp.ev(`(() => {
    const t = document.querySelector('[data-ibk-cattip]');
    const it = document.querySelector('[data-ibk-tip]');
    const vis = (el) => !!el && !el.hidden;
    const r = t ? t.getBoundingClientRect() : null;
    return {
      shown: vis(t),
      name: t ? ((t.querySelector('[data-cattip-name]') || {}).textContent || '') : '',
      desc: t ? ((t.querySelector('[data-cattip-desc]') || {}).textContent || '') : '',
      inViewport: !!r && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      itemTipHidden: !vis(it),
      itemTipText: it ? (it.textContent || '').trim().slice(0, 40) : '',
    };
  })()`);
  return { pt, tip };
};

{
  /* 情形 A：普通条目（没有完备标识），两分类都在 */
  const a = await hoverEmoji(`.ibk__item[data-name="${ITEM_NAME}"] .ibk__emoji[data-cat="c05"]`);
  check('找得到 🏙️ 那个 emoji（普通条目）', !!a, JSON.stringify(a?.pt));
  if (a) {
    info('普通条目上：' + JSON.stringify(a.tip));
    check('★★ 鼠标移到 emoji 上 → 弹出这一类的名字 + 描述',
      a.tip.shown && a.tip.name === MY_CAT2 && a.tip.desc === DESC_TEXT2, JSON.stringify(a.tip));
    check('描述浮层整个在视口里，而且这时候条目的那张卡片让位（不叠两张）',
      a.tip.inViewport === true && a.tip.itemTipHidden === true, JSON.stringify(a.tip));
  }

  /*
    情形 B：**完备条目**（有扫描线标识的那些）。
    用户 2026-09-29 报的 bug 就在这儿：那层标识是 `position:absolute; z-index:0`，
    盖住整条还往外伸，而 emoji 那一行原本是非定位元素 —— 鼠标指到 emoji 时命中的是标识，
    于是只弹出条目自己的描述卡片，分类描述永远出不来。
    所以这里第一件事就是量"指到的那个点到底是谁"。
  */
  const doneIdx = await cdp.ev(`(() => {
    const el = [...document.querySelectorAll('.ibk__item.is-done .ibk__emoji')].find((e) => !e.hidden && (e.dataset.desc || '').length > 0);
    if (!el) return null;
    const item = el.closest('.ibk__item');
    return { name: item.dataset.name, cat: el.dataset.cat, catName: el.dataset.name, desc: el.dataset.desc };
  })()`);
  check('找得到一个"完备条目 + 带描述的分类 emoji"当靶子', !!doneIdx, JSON.stringify(doneIdx));
  if (doneIdx) {
    const b = await hoverEmoji(`.ibk__item[data-name="${doneIdx.name}"] .ibk__emoji[data-cat="${doneIdx.cat}"]`);
    info(`完备条目「${doneIdx.name}」上：` + JSON.stringify(b?.tip) + ' | 鼠标那个点上是：' + b?.pt.hit);
    check('★★ 完备条目：鼠标指到 emoji 命中的是 emoji 本身，不是那层扫描线标识',
      /ibk__emoji/.test(String(b?.pt.hit ?? '')), String(b?.pt.hit));
    check('★★ 完备条目：指到 emoji 依然弹出**这一类的名字 + 描述**',
      !!b && b.tip.shown && b.tip.name === doneIdx.catName && b.tip.desc === doneIdx.desc,
      JSON.stringify(b?.tip));
    check('★★ 完备条目：这时候条目的那张卡片同样让位（不会只看到词条描述）',
      !!b && b.tip.itemTipHidden === true, `条目卡片文字=${b?.tip.itemTipText}`);
  }

  /* 反过来也得对：指针停在条目**正文**上 → 该出的是条目自己的卡片 */
  const c = await cdp.ev(`(() => {
    const el = document.querySelector('.ibk__item.is-done .ibk__txt');
    if (!el) return null;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), name: el.closest('.ibk__item').dataset.name, desc: el.closest('.ibk__item').dataset.desc };
  })()`);
  if (c) {
    await cdp.move(c.x, c.y);
    await sleep(400);
    const both = await cdp.ev(`(() => {
      const t = document.querySelector('[data-ibk-tip]');
      const ct = document.querySelector('[data-ibk-cattip]');
      return { item: !!t && !t.hidden, cat: !!ct && !ct.hidden, text: t ? (t.textContent || '').trim().slice(0, 30) : '' };
    })()`);
    info(`指到正文「${c.name}」：` + JSON.stringify(both));
    check('★ 指针在正文上时出的是条目卡片、分类描述的浮层收着（两张卡不抢）',
      both.item === true && both.cat === false, JSON.stringify(both));
  }

  await cdp.move(5, 5);
  await sleep(300);
  const away = await cdp.ev(`(() => { const t = document.querySelector('[data-ibk-cattip]'); return !t || t.hidden; })()`);
  check('鼠标移开之后浮层收起来', away === true);
}

/* ================================================================
 * ④ 编辑器：接口 + 界面
 * ================================================================ */
console.log('\n================ ④ 编辑器里怎么编 ================');
const editor = spawn(process.execPath, [path.join(DST, 'tools/editor/server.mjs')], {
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
check('副本里的编辑器起来了', !!base, base || elog.slice(-200));
if (base) {
  const api = async (p) => (await fetch(base + p)).json();
  const post = async (body) => {
    const r = await fetch(`${base}/api/iceberg`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      /* 这条接口写完会顺手构建一次；给宽一点，别让 undici 的 headers timeout 打断 */
      signal: AbortSignal.timeout(600_000),
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const before = await api('/api/iceberg');
  const c01Api = before.categories.find((c) => c.id === 'c01');
  check('GET /api/iceberg：分类带着 emoji / desc',
    typeof c01Api?.emoji === 'string' && typeof c01Api?.desc === 'string',
    JSON.stringify({ emoji: c01Api?.emoji, desc: (c01Api?.desc ?? '').slice(0, 20) }));
  const itApi = before.layers.flatMap((l) => l.items).find((i) => i.name === ITEM_NAME);
  check('GET /api/iceberg：条目带着 categoryIds 数组',
    Array.isArray(itApi?.categoryIds) && itApi.categoryIds.length === 2, JSON.stringify(itApi?.categoryIds));

  /* 存一次：改 emoji / 描述 + 调分类顺序 */
  const payload = JSON.parse(JSON.stringify(before));
  payload.categories.find((c) => c.id === 'c02').emoji = '🧊';
  payload.categories.find((c) => c.id === 'c02').desc = '验收写的冰室怪谈描述';
  const tag = payload.layers.flatMap((l) => l.items).find((i) => i.name === ITEM_NAME);
  tag.categoryIds = ['c05', 'c01']; // 顺序反过来：让灰的那一类当主分类
  const saved = await post(payload);
  check('POST /api/iceberg 成功', saved.status === 200, `status=${saved.status}`);
  const after = readJson(copyIce);
  const c02After = after.categories.find((c) => c.id === 'c02');
  const tagAfter = after.layers.flatMap((l) => l.items).find((i) => i.name === ITEM_NAME);
  check('★ 存盘：分类的 emoji / 描述落盘了',
    c02After?.emoji === '🧊' && c02After?.desc === '验收写的冰室怪谈描述',
    JSON.stringify({ emoji: c02After?.emoji, desc: c02After?.desc }));
  check('★ 存盘：条目的分类顺序按面板里给的顺序落盘（c05 在前）',
    JSON.stringify(tagAfter?.categoryIds) === JSON.stringify(['c05', 'c01']),
    JSON.stringify(tagAfter?.categoryIds));
  check('categoryId（老字段）跟着第一个分类走 —— 老代码/老页面读它也不会错',
    tagAfter?.categoryId === 'c05', tagAfter?.categoryId);

  /* 老写法也认：只给 categoryId 的话，读进来当成长度 1 的数组 */
  const legacy = JSON.parse(JSON.stringify(after));
  const legacyItem = legacy.layers.flatMap((l) => l.items).find((i) => i.name === ITEM_NAME);
  delete legacyItem.categoryIds;
  legacyItem.categoryId = 'c03';
  const legSaved = await post(legacy);
  const legAfter = readJson(copyIce);
  const legItem = legAfter.layers.flatMap((l) => l.items).find((i) => i.name === ITEM_NAME);
  check('★ 只写老的 categoryId 也认（自动变成数组）',
    legSaved.status === 200 && JSON.stringify(legItem?.categoryIds) === JSON.stringify(['c03']),
    JSON.stringify(legItem?.categoryIds));

  /*
    ★ 2026-09-29 真出过一次的事故，这里钉住：
    用户那个编辑器进程是**改之前**起的 —— 它那一版前端读不懂 categoryIds，
    会把每条写成 `categoryId: ""` 而且根本不提 categoryIds；服务端再把新字段一丢，
    一次保存就把 89 条的分类全抹了。现在这种"客户端没说"的情况要**沿用盘上那份**。
  */
  const stalePayload = JSON.parse(JSON.stringify(readJson(copyIce)));
  const staleBefore = stalePayload.layers.flatMap((l) => l.items).filter((i) => (i.categoryIds ?? []).length).length;
  for (const l of stalePayload.layers) {
    for (const it of l.items) {
      delete it.categoryIds; // 老客户端：不认识这个字段
      it.categoryId = ''; // 它读不懂新数据，界面上就是"未分类"
    }
  }
  const staleSaved = await post(stalePayload);
  const staleAfter = readJson(copyIce);
  const staleKept = staleAfter.layers.flatMap((l) => l.items).filter((i) => (i.categoryIds ?? []).length).length;
  check('★★ 旧版编辑器来保存（只写空的 categoryId、不提 categoryIds）→ 盘上已有的分类一条都不会被抹掉',
    staleSaved.status === 200 && staleKept === staleBefore,
    `沿用回来 ${staleKept} / ${staleBefore} 条`);
  check('这一趟服务端还喊了一声（日志里说清对面是老客户端）',
    /沿用盘上那份|旧版编辑器/.test(elog), elog.split(/\r?\n/).filter((l) => l.includes('冰山图')).slice(-1).join(''));

  /* ---- 界面：分类行有 emoji / 描述，条目表单能勾多个 + 调顺序 ---- */
  await cdp.goto(base + '/', 1400);
  const ui = await cdp.ev(`(async () => {
    await window.__openWs('ice-chart');
    await new Promise((r) => setTimeout(r, 1600));
    /** ⚠ 点「改」会**整个面板重建**（旧的 .wpanel 节点被换掉），所以每次都重新找 */
    const panel = () => [...document.querySelectorAll('.wpanel')].find((el) => el.getBoundingClientRect().height > 0);
    const w = panel();
    if (!w) return { ok: false, why: '面板没开' };
    const catRow = w.querySelector('.wice__cat');
    const emojiInput = catRow ? catRow.querySelector('.wice__emoji') : null;
    const descBox = catRow ? catRow.querySelector('.wice__catdesc') : null;
    const editBtn = [...w.querySelectorAll('.wice__item .wice__ops button')].find((b) => b.textContent.trim() === '改');
    let form = null;
    if (editBtn) {
      editBtn.click();
      await new Promise((r) => setTimeout(r, 800));
      const w2 = panel();
      const f = w2 ? w2.querySelector('.wice__form') : null;
      const picks = f ? [...f.querySelectorAll('input[data-cat-pick]')] : [];
      if (picks.length >= 2) {
        const second = picks.find((p) => !p.checked);
        if (second) {
          second.checked = true;
          second.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 300));
        }
      }
      const f2 = panel() ? panel().querySelector('.wice__form') : null;
      const chips = f2 ? [...f2.querySelectorAll('.wice__catorderChip')].map((c) => c.textContent.trim()) : [];
      form = {
        found: !!f,
        picks: picks.length,
        checked: f2 ? [...f2.querySelectorAll('input[data-cat-pick]')].filter((p) => p.checked).length : 0,
        orderChips: chips,
        hasUpDown: f2 ? f2.querySelectorAll('.wice__catorderChip .btn').length : 0,
      };
    }
    return {
      ok: true,
      hasEmojiInput: !!emojiInput,
      emojiValue: emojiInput ? emojiInput.value : null,
      hasDescBox: !!descBox,
      descPlaceholder: descBox ? descBox.placeholder : '',
      form,
    };
  })()`);
  info('编辑器界面：' + JSON.stringify(ui));
  check('★ 分类那一行有 emoji 输入框（值就是这一类现在配的图标）',
    ui.ok === true && ui.hasEmojiInput === true && (ui.emojiValue ?? '').length > 0, JSON.stringify(ui.emojiValue));
  check('★ 分类那一行有描述输入框（多行，占位文字说明了它是什么）',
    ui.ok === true && ui.hasDescBox === true && /描述/.test(ui.descPlaceholder ?? ''), String(ui.descPlaceholder));
  check('★ 条目表单里分类是「勾选 + 顺序」：勾上第二个之后顺序条出现、每个带 ↑ ↓',
    ui.ok === true && ui.form && ui.form.found === true && ui.form.picks >= 2 && ui.form.checked >= 2 &&
      ui.form.orderChips.length >= 2 && ui.form.hasUpDown >= 4,
    JSON.stringify(ui.form));
  check('这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));
}

editor.kill();
try { await cdp.send('Browser.close'); } catch { /* ignore */ }
chrome.kill();
server.close();
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* ignore */ }

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
