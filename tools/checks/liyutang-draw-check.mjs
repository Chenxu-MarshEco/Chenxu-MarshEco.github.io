/*
 * ============================================================================
 * 久昭卿茶绘「画板」的验收（2026-10-09）
 * ----------------------------------------------------------------------------
 * 用户原话：
 *   「点进去以后是一个巨大的公共画板 有基本的画笔橡皮调色板等功能 所有注册后通过审核的用户
 *    都可以在上面画画 并且有一个折叠栏可以打开今天所有画过画的用户列表 点击其他用户头像可以
 *    开关是否显示由他们画的笔划 …… 让画画的手感可以比较舒服丝滑」
 *
 * 三段：
 *   ① 静态：云函数里那几个事件 + 限额；前端引擎里那几件"手感"的东西（中点平滑、两层画布、
 *      采样过滤、逐人隐藏）都在；
 *   ② 真跑（内存 MongoDB 跑整份云函数）：没登录 / 没过审拉不到也画不上 → 过审能画 →
 *      列表带 uk 和 mine → 游标增量 → 各种脏笔划被拒 → 画太快被拒 → 一小时上限 →
 *      只能撤自己的 → 站长取某天 / 清某天；
 *   ③ 真浏览器（假云函数 + 真构建产物 + **真画布像素**）：访客锁着 → 过审能画 →
 *      **画上去的颜色真的出现在画布那一点上** → 别人的笔划被轮询拉来并画出来 →
 *      **点一下那个人的头像，他的笔划就没了（像素变回纸色）** → 橡皮擦掉 →
 *      撤销会真的请求删除。
 *
 * 用法：node tools/checks/liyutang-draw-check.mjs [dist目录]
 * 说明：② 需要 mongodb-memory-server（在 %TEMP%\huajiantang-twikoofn 里），没装就跳过②。
 * ============================================================================
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawn, execSync } from 'node:child_process';

const SRC = String.raw`D:\曼沫砾总线\Chenxu-MarshEco.github.io`;
const BACKEND = path.join(SRC, 'tools', 'liyutang-backend', 'index.js');
const ROOT = path.resolve(
  process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(SRC, 'dist')
);
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const DEBUG_PORT = 9403;
const PAPER = '#fbf6ee';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
let skipped = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};
const skip = (name, why) => {
  skipped++;
  console.log(`SKIP  ${name}   :: ${why}`);
};
const info = (s) => console.log(`      · ${s}`);
const read = (rel) => {
  const f = path.join(SRC, rel);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};

/* ============================================================ ① 静态 */

console.log('=== ① 静态：事件、限额、以及那几件"手感" ===');
const backend = read('tools/liyutang-backend/index.js');
check('云函数里有画板集合与三个用户事件',
  /const DRAW = 'lt_draw'/.test(backend) &&
  ['LT_DRAW_LIST', 'LT_DRAW_ADD', 'LT_DRAW_DELETE'].every((e) => backend.includes(e)));
check('站长那两个（取某天 / 清某天）也在',
  backend.includes('LT_ADMIN_DRAW_DAY') && backend.includes('LT_ADMIN_DRAW_CLEAR'));
check('★ 走的是和聊天室同一个门槛（过审才画得上）', /async function handleDrawEvent/.test(backend) && /await chatWho\(payload\)/.test(backend));
check('★ 颜色只收 #rrggbb（不给用户写 CSS 的机会）', /function drawColor/.test(backend) && /\^#\[0-9a-f\]\{6\}\$/.test(backend));
check('坐标夹进画板、点数有上限', /function cleanDrawPoints/.test(backend) && /DRAW_MAX_POINTS/.test(backend));
check('限速：80 毫秒一笔、一小时 4000 笔', /DRAW_GAP_MS = 80/.test(backend) && /DRAW_PER_HOUR = 4000/.test(backend));
check('★ 发出去的是账号 id 的短哈希（逐人显隐要稳定键，但不泄露账号 id）',
  /const drawUk = \(id\) => crypto\.createHash\('sha1'\)/.test(backend));

const engine = read(path.join('src', 'utils', 'liyutang-draw.ts'));
check('前端引擎在（mountBoard）', /export function mountBoard/.test(engine));
check('★ 平滑走共享几何（strokeSegments，和存档 SVG 同一份）', /strokeSegments/.test(engine));
check('★ 两层画布：定下来的笔划进离屏缓存，只有集合变了才重画', /const cache = document\.createElement\('canvas'\)/.test(engine) && /cacheDirty/.test(engine));
check('★ 本地先画（抬笔立刻出现在自己屏幕上，后台再送）', /const commit = async/.test(engine) && /local-/.test(engine));
check('采样过滤（画板坐标里 1.2px 以内不留点）', /< 1\.2/.test(engine));
check('★ 逐人显隐（hidden 集合 + 重画）', /const hidden = new Set<string>\(\)/.test(engine) && /hidden\.has\(s\.uk\)/.test(engine));
check('橡皮按纸色画（和服务端 / 存档 SVG 一个规矩）', /ERASER_COLOR = PAPER/.test(engine));
check('页面接上了：工具条 + 画布 + 人表', /mountBoard\(/.test(read(path.join('src', 'pages', 'liyutang', 'teahouse.astro'))));
check('画板尺寸是固定坐标系（2400×1500）', /BOARD_W = 2400/.test(read(path.join('src', 'utils', 'liyutang-strokes.mjs'))));

/* ============================================================ ② 真跑 */

console.log('\n=== ② 真跑：内存里的 MongoDB，把云函数整份跑一遍 ===');
const candidates = [
  path.join(process.env.TEMP ?? '', 'huajiantang-twikoofn', 'node_modules'),
  path.join(SRC, '.tmp', 'twikoofn', 'node_modules'),
  path.join(SRC, 'node_modules'),
];
let MongoMemoryServer = null;
let mongodBinary = '';
for (const dir of candidates) {
  try {
    const req = createRequire(path.join(dir, 'x.js'));
    MongoMemoryServer = req('mongodb-memory-server').MongoMemoryServer;
    for (const cache of [
      path.join(dir, '.cache', 'mongodb-memory-server'),
      path.join(process.env.USERPROFILE ?? '', '.cache', 'mongodb-binaries'),
    ]) {
      if (!fs.existsSync(cache)) continue;
      const hit = fs.readdirSync(cache).find((f) => /^mongod-.*\.exe$/i.test(f));
      if (hit) {
        mongodBinary = path.join(cache, hit);
        process.env.MONGOMS_SYSTEM_BINARY = mongodBinary;
        break;
      }
    }
    break;
  } catch {
    /* 换下一个 */
  }
}

if (!MongoMemoryServer || !mongodBinary) {
  skip('画板那一整套的真跑', '这台机器上没有现成的 mongodb-memory-server / mongod 二进制');
} else {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('twikoo');
  process.env.MONGODB_URI = uri;
  process.env.LT_SECRET = 'draw-check-secret';
  process.env.NODE_PATH = candidates[0];
  Module._initPaths();
  const req2 = createRequire(path.join(candidates[0], 'x.js'));
  const app = req2(BACKEND);
  const call = (body) => app.main(body);
  const { MongoClient } = req2('mongodb');
  const cli = new MongoClient(uri);
  await cli.connect();
  const raw = cli.db('twikoo').collection('lt_draw');

  await call({ event: 'LT_REGISTER', nick: 'hoshi', mail: 'h@example.com', pass: 'hoshi123456' });
  await call({ event: 'LT_REGISTER', nick: 'arcarlight', mail: 'a@example.com', pass: 'arc123456789' });
  const tokHoshi = (await call({ event: 'LT_LOGIN', nick: 'hoshi', pass: 'hoshi123456' })).token;
  const tokArc = (await call({ event: 'LT_LOGIN', nick: 'arcarlight', pass: 'arc123456789' })).token;

  check('★ 没登录拉画板 → 被拒', (await call({ event: 'LT_DRAW_LIST' })).code !== 0);
  check('★ 没过审拉画板 → 被拒（会员画板）', (await call({ event: 'LT_DRAW_LIST', ltToken: tokHoshi })).code !== 0);
  check('没过审画一笔 → 被拒',
    (await call({ event: 'LT_DRAW_ADD', ltToken: tokHoshi, tool: 'pen', color: '#ff0000', size: 4, points: [[10, 10], [20, 20]] })).code !== 0);

  await call({ event: 'SET_PASSWORD', password: createHash('md5').update('admin-pass-123').digest('hex') });
  const users = (await call({ event: 'LT_ADMIN_LIST', password: 'admin-pass-123' })).users;
  const idHoshi = users.find((u) => u.nick === 'hoshi').id;
  await call({ event: 'LT_ADMIN_SET', password: 'admin-pass-123', id: idHoshi, status: 'approved' });

  const one = await call({ event: 'LT_DRAW_ADD', ltToken: tokHoshi, tool: 'pen', color: '#FF0000', size: 999, points: [[10, 10], [50, 10], [90, 40]] });
  check('★ 过审之后能画一笔', one.code === 0 && !!one.stroke?.id, String(one.stroke?.id));
  check('颜色被规整成小写、粗细夹到 64', one.stroke?.color === '#ff0000' && one.stroke?.size === 64, `${one.stroke?.color} / ${one.stroke?.size}`);
  check('★ 返回里带 uk（短哈希）而不是账号 id', /^[0-9a-f]{8}$/.test(String(one.stroke?.uk)) && !JSON.stringify(one.stroke).includes(idHoshi), String(one.stroke?.uk));
  check('自己画的标成 mine', one.stroke?.mine === true);

  const tooFast = await call({ event: 'LT_DRAW_ADD', ltToken: tokHoshi, tool: 'pen', color: '#ff0000', size: 4, points: [[1, 1], [2, 2]] });
  check('★ 画太快 → 被拒（80 毫秒一笔）', tooFast.code !== 0, String(tooFast.message));
  await sleep(150);

  check('工具只能是 pen / eraser', (await call({ event: 'LT_DRAW_ADD', ltToken: tokHoshi, tool: 'spray', color: '#ffffff', size: 4, points: [[1, 1]] })).code !== 0);
  await sleep(150);
  check('★ 颜色不是 #rrggbb → 被拒', (await call({ event: 'LT_DRAW_ADD', ltToken: tokHoshi, tool: 'pen', color: 'red', size: 4, points: [[1, 1]] })).code !== 0);
  await sleep(150);
  check('一个点都没有 → 被拒', (await call({ event: 'LT_DRAW_ADD', ltToken: tokHoshi, tool: 'pen', color: '#ffffff', size: 4, points: [] })).code !== 0);
  await sleep(150);
  const clamp = await call({ event: 'LT_DRAW_ADD', ltToken: tokHoshi, tool: 'pen', color: '#00ff00', size: 3, points: [[-999, -999], [99999, 99999]] });
  check('★ 越界坐标被夹进画板（2400×1500）',
    clamp.code === 0 && clamp.stroke.points[0][0] === 0 && clamp.stroke.points[1][0] === 2400 && clamp.stroke.points[1][1] === 1500,
    JSON.stringify(clamp.stroke?.points));

  const list = await call({ event: 'LT_DRAW_LIST', ltToken: tokHoshi });
  check('列表读得到今天的笔划（按时间正序）', list.code === 0 && list.strokes.length === 2, `${list.strokes?.length} 笔`);
  check('列表带 today / serverNow（页面判断跨零点）', /^\d{4}-\d{2}-\d{2}$/.test(String(list.today)) && !!list.serverNow);
  const cur = list.strokes[list.strokes.length - 1].createdAt;
  check('★ 游标增量：没有新笔划时是空的', (await call({ event: 'LT_DRAW_LIST', ltToken: tokHoshi, after: cur })).strokes.length === 0);
  await sleep(150);
  await call({ event: 'LT_DRAW_ADD', ltToken: tokHoshi, tool: 'eraser', color: PAPER, size: 20, points: [[5, 5], [6, 6]] });
  check('★ 有新的时只回新的那笔', (await call({ event: 'LT_DRAW_LIST', ltToken: tokHoshi, after: cur })).strokes.length === 1);

  check('★ 撤自己那笔 → 成功', (await call({ event: 'LT_DRAW_DELETE', ltToken: tokHoshi, id: one.stroke.id })).code === 0);
  const after = await call({ event: 'LT_DRAW_LIST', ltToken: tokHoshi });
  check('撤完列表里就没有了', !after.strokes.some((s) => s.id === one.stroke.id), `${after.strokes.length} 笔`);
  check('★ 撤别人画的不行（先塞一笔别人的）', await (async () => {
    await raw.insertOne({
      id: 'other1',
      day: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10),
      userId: 'someone-else',
      uk: 'deadbeef',
      nick: '别人',
      avatar: '',
      tool: 'pen',
      color: '#000000',
      size: 3,
      points: [[1, 1], [2, 2]],
      createdAt: Date.now(),
      deleted: false,
    });
    return (await call({ event: 'LT_DRAW_DELETE', ltToken: tokHoshi, id: 'other1' })).code !== 0;
  })());

  /* 一小时上限：直接塞 4000 笔（接口造不出来，因为限速） */
  const now = Date.now();
  await raw.insertMany(
    Array.from({ length: 4000 }, (_, i) => ({
      id: 'bulk' + i,
      day: new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10),
      userId: idHoshi,
      uk: one.stroke.uk,
      nick: 'hoshi',
      avatar: '',
      tool: 'pen',
      color: '#123456',
      size: 2,
      points: [[i % 100, i % 50]],
      createdAt: now - 1000 - i,
      deleted: false,
    }))
  );
  await sleep(200);
  const over = await call({ event: 'LT_DRAW_ADD', ltToken: tokHoshi, tool: 'pen', color: '#123456', size: 2, points: [[1, 1]] });
  check('★ 一小时超过 4000 笔 → 被拒（脚本刷不动）', over.code !== 0 && /4000/.test(String(over.message)), String(over.message));

  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const day = await call({ event: 'LT_ADMIN_DRAW_DAY', password: 'admin-pass-123', day: today });
  check('★ 站长能取某天的全部笔划（存档要用）', day.code === 0 && day.count >= 4002, `${day.count} 笔`);
  check('取出来的带着 tool / color / points（够画回一张 SVG）',
    day.strokes.every((s) => s.tool && s.color && Array.isArray(s.points)), '');
  const cleared = await call({ event: 'LT_ADMIN_DRAW_CLEAR', password: 'admin-pass-123', day: today });
  check('★ 站长清某天（搬进仓库之后把云端删掉）', cleared.code === 0 && cleared.cleared >= 4002, String(cleared.cleared));
  check('清完之后那天真的空了', (await call({ event: 'LT_ADMIN_DRAW_DAY', password: 'admin-pass-123', day: today })).count === 0);
  check('站长密码不对 → 取不到 / 清不掉',
    (await call({ event: 'LT_ADMIN_DRAW_DAY', password: '乱猜', day: today })).code !== 0 &&
    (await call({ event: 'LT_ADMIN_DRAW_CLEAR', password: '乱猜', day: today })).code !== 0);

  await cli.close();
  await mongod.stop();
}

/* ============================================================ ③ 真浏览器 */

console.log('\n=== ③ 真浏览器：假云函数 + 真画布像素 ===');
const liveApi = (() => {
  try {
    return JSON.parse(read('src/data/liyutang.json')).forum?.twikoo.envId ?? '';
  } catch {
    return '';
  }
})();

/* 假后端：自己画的记下来；轮询时给一笔"别人画的"（在 1800,1100，蓝色） */
const seen = { add: [], del: [], lists: 0 };
const OTHER = { id: 'other-stroke', uk: 'beef1234', nick: '虹星', avatar: '', tool: 'pen', color: '#3a86ff', size: 24, points: [[1750, 1050], [1850, 1100], [1950, 1150]], createdAt: 0, mine: false };
const fakeBackend = (body) => {
  const event = String(body?.event || '');
  if (event === 'LT_ME') return { code: 0, user: { nick: '测试者', mail: '', status: 'approved', avatar: '', label: '' }, posts: 0 };
  if (event === 'LT_DRAW_LIST') {
    seen.lists += 1;
    const after = Number(body?.after) || 0;
    /* 第一趟（没有游标）给空的：板子上先是干净的；之后给"别人画的"那一笔 */
    const all = after ? [{ ...OTHER, createdAt: after + 1 }] : [];
    return { code: 0, day: '2026-10-09', today: '2026-10-09', serverNow: Date.now(), more: false, strokes: all.filter((s) => s.createdAt > after) };
  }
  if (event === 'LT_DRAW_ADD') {
    seen.add.push(body);
    return {
      code: 0,
      stroke: { id: 'mine' + seen.add.length, uk: 'aaaa1111', nick: '测试者', avatar: '', tool: body.tool, color: body.color, size: body.size, points: body.points, createdAt: Date.now(), mine: true },
    };
  }
  if (event === 'LT_DRAW_DELETE') {
    seen.del.push(body);
    return { code: 0, id: body.id };
  }
  return { code: 0 };
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__lt') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        /* 空 */
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(fakeBackend(body)));
    });
    return;
  }
  const p = decodeURIComponent(url.pathname);
  for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
    const f = path.join(ROOT, t);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ext = path.extname(f).toLowerCase();
      let buf = fs.readFileSync(f);
      if (ext === '.html' && liveApi) {
        buf = Buffer.from(buf.toString('utf8').split(liveApi).join(`http://127.0.0.1:${server.address().port}/__lt`), 'utf8');
      }
      res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
      return res.end(buf);
    }
  }
  res.writeHead(404);
  res.end('404');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const profile = path.join(process.env.TEMP ?? '.', `dsh-lytdraw-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(String(m.params.exceptionDetails?.text).slice(0, 140));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 140));
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
  async wait(expr, ms = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try {
        if (await this.ev(expr)) return true;
      } catch {
        /* 页面还在换 */
      }
      await sleep(200);
    }
    return false;
  }
  async go(url) {
    await this.send('Page.navigate', { url });
    for (let i = 0; i < 150; i++) {
      await sleep(100);
      try {
        if ((await this.ev('document.readyState')) === 'complete') return;
      } catch {
        /* 还在导航 */
      }
    }
  }
}

/*
  画布上某一点的颜色（**画板坐标**）。
  2026-10-09 起画布的内部像素尺寸跟着"它显示多大 × DPR"走、还带缩放平移，
  所以读像素要走引擎给的那个调试口 `window.__ltBoard.pixelAt`（它自己会把画板坐标换算成设备像素）。
  ——这不影响"量的是真画出来的像素"：读的还是 canvas 的 getImageData。
*/
const pixelAt = (x, y) => `(() => (window.__ltBoard ? window.__ltBoard.pixelAt(${x}, ${y}) : '(没有 __ltBoard)'))()`;

/** 画板坐标 → 屏幕坐标（要过视野：缩放 + 平移） */
const toScreen = (x, y) => `(() => {
  const c = document.querySelector('[data-lt-canvas]');
  const r = c.getBoundingClientRect();
  const v = (window.__ltBoard && window.__ltBoard.view) || { scale: 1, x: 0, y: 0 };
  return { x: Math.round(r.left + (${x} - v.x) * v.scale), y: Math.round(r.top + (${y} - v.y) * v.scale) };
})()`;

/** 当前视野（缩放 + 平移 + DPR） */
const viewOf = `(() => (window.__ltBoard ? window.__ltBoard.view : null))()`;

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {
      /* 等 */
    }
  }
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  const base = `http://127.0.0.1:${PORT}`;

  /** 在画布上画一笔（合成的真鼠标事件：按下 → 走几段 → 抬起） */
  /** 把画布滚到视口中间（合成事件的坐标必须落在视口里，不然点了也白点） */
  const showCanvas = async () => {
    await cdp.ev("document.querySelector('[data-lt-canvas]').scrollIntoView({ block: 'center', behavior: 'instant' })");
    await sleep(400);
  };

  const drawOn = async (points) => {
    await showCanvas();
    const first = await cdp.ev(toScreen(points[0][0], points[0][1]));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: first.x, y: first.y, button: 'left', clickCount: 1, buttons: 1 });
    for (const [bx, by] of points.slice(1)) {
      const s = await cdp.ev(toScreen(bx, by));
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y, button: 'left', buttons: 1 });
      await sleep(25);
    }
    const last = await cdp.ev(toScreen(points[points.length - 1][0], points[points.length - 1][1]));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: last.x, y: last.y, button: 'left', clickCount: 1, buttons: 0 });
    await sleep(500);
  };

  /* ---- 访客 ---- */
  await cdp.go(`${base}/liyutang/teahouse/`);
  await cdp.wait(`(() => { const a = document.querySelector('[data-lt-account]'); return !!(a && a.dataset.state); })()`);
  const guest = await cdp.ev(`(() => ({
      state: (document.querySelector('[data-lt-account]')||{}).dataset?.state || '',
      gate: (document.querySelector('[data-lt-draw-gate]')||{}).textContent || '',
      locked: [...document.querySelectorAll('.lyt-draw__bar button, .lyt-draw__bar input')].every((el) => el.disabled),
      pointerEvents: getComputedStyle(document.querySelector('[data-lt-canvas]')).pointerEvents,
    }))()`);
  info('访客看到：' + JSON.stringify(guest));
  check('★ 访客：工具条全锁着、画布也点不动', guest.locked === true && guest.pointerEvents === 'none', `${guest.locked} / ${guest.pointerEvents}`);
  check('访客：说明白了要先登录 / 过审', /登录/.test(guest.gate) && !/正在看登录状态/.test(guest.gate), guest.gate.slice(0, 40));

  /* ---- 过审的人 ---- */
  await cdp.ev(`localStorage.setItem('lt_token','fake-token')`);
  await cdp.go(`${base}/liyutang/teahouse/`);
  const ready = await cdp.wait(`(() => {
      const b = document.querySelector('[data-lt-tool="pen"]');
      return !!b && !b.disabled && document.querySelectorAll('.lyt-draw__swatch').length >= 6;
    })()`, 20000);
  check('★ 过审账号进来：工具条解锁 + 调色板画出来了', ready === true);
  const empty = await cdp.ev(pixelAt(600, 375));
  check('一开始画布是干净的（纸色）', empty === PAPER, empty);

  /* 画一笔：从左到右一条水平线，正好经过 (600,375) */
  await cdp.ev(`[...document.querySelectorAll('.lyt-draw__swatch')].find((b) => b.dataset.color === '#1d1430').click()`);
  await drawOn([[400, 375], [500, 375], [600, 375], [700, 375]]);
  const myPix = await cdp.ev(pixelAt(600, 375));
  check('★ 画上去的墨色真的出现在画布那一点上（不是"看着像"）', myPix === '#1d1430', myPix);
  check('★ 发上去的是笔划（事件 / 令牌 / 工具 / 颜色 / 点集都对）',
    seen.add.length === 1 && seen.add[0].event === 'LT_DRAW_ADD' && seen.add[0].ltToken === 'fake-token' &&
      seen.add[0].tool === 'pen' && seen.add[0].color === '#1d1430' && seen.add[0].points.length >= 3,
    JSON.stringify({ ev: seen.add[0]?.event, tool: seen.add[0]?.tool, color: seen.add[0]?.color, pts: seen.add[0]?.points?.length }));
  check('点集是画板坐标系（2400 宽那块板），不是屏幕像素',
    seen.add[0].points.every(([x, y]) => x >= 0 && x <= 2400 && y >= 0 && y <= 1500), JSON.stringify(seen.add[0].points.slice(0, 3)));

  /* 轮询：别人的那一笔（1800,1100 附近，蓝色）要被拉下来画出来 */
  const gotOther = await cdp.wait(
    `(() => (window.__ltBoard ? window.__ltBoard.pixelAt(1850, 1100) : '') === '#3a86ff')()`,
    20000
  );
  const otherPix = await cdp.ev(pixelAt(1850, 1100));
  check('★ 别人画的笔划被轮询拉到、并画在画布上（像素是那个蓝）', gotOther === true, otherPix);
  const faces = await cdp.ev(`[...document.querySelectorAll('.lyt-draw__face')].map((b) => b.textContent.trim())`);
  check('★「今天画过画的人」那张表里有两个人', faces.length === 2, JSON.stringify(faces));

  /* 点那个人的头像 → 他的笔划看不见了（像素变回纸色） */
  const toggled = await cdp.ev(`(() => {
      const b = [...document.querySelectorAll('.lyt-draw__face')].find((x) => x.textContent.includes('虹星'));
      if (!b) return false;
      b.click();
      return true;
    })()`);
  await sleep(700);
  const offPix = await cdp.ev(pixelAt(1850, 1100));
  check('★ 点一下那个人的头像 → 他的笔划就不画了（像素变回纸色）', toggled === true && offPix === PAPER, offPix);
  const backOn = await cdp.ev(`(() => {
      const b = [...document.querySelectorAll('.lyt-draw__face')].find((x) => x.textContent.includes('虹星'));
      b.click();
      return true;
    })()`);
  await sleep(700);
  const onPix = await cdp.ev(pixelAt(1850, 1100));
  check('再点一下 → 又回来了（开关是双向的）', backOn === true && onPix !== PAPER, onPix);

  /* ---- 缩放 / 平移（2026-10-09 晚上加的） ---- */
  const v0 = await cdp.ev(viewOf);
  check('★ 进来时是"全览"：整块板正好装下（缩放 = fit）、原点在左上角、读数 1.0×',
    v0 && Math.abs(v0.scale - v0.fit) < 0.002 && v0.x === 0 && v0.y === 0 && Math.abs(v0.zoom - 1) < 0.02,
    JSON.stringify(v0));
  check('画布的像素尺寸 = 显示大小 × DPR（不是死板的 2400×1500）',
    await cdp.ev(`(() => {
      const c = document.querySelector('[data-lt-canvas]');
      const r = c.getBoundingClientRect();
      const d = (window.__ltBoard && window.__ltBoard.view.dpr) || 1;
      return Math.abs(c.width - Math.round(r.width * d)) <= 1 && Math.abs(c.height - Math.round(r.height * d)) <= 1;
    })()`), '');

  /* 把光标放在"我已经画了那一点"上滚轮放大：那一点的颜色必须还在光标底下（缩放钉住光标） */
  await showCanvas();
  const hold = await cdp.ev(toScreen(600, 375));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hold.x, y: hold.y, button: 'none' });
  for (let i = 0; i < 4; i += 1) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: hold.x, y: hold.y, deltaX: 0, deltaY: -120 });
    await sleep(150);
  }
  await sleep(400);
  const v1 = await cdp.ev(viewOf);
  check('★ 滚轮能放大（全览 → >1.5×）', v1 && v1.zoom > 1.5, JSON.stringify({ zoom: v1?.zoom, x: v1?.x, y: v1?.y }));
  const underCursor = await cdp.ev(`(() => {
    const c = document.querySelector('[data-lt-canvas]');
    const r = c.getBoundingClientRect();
    const v = window.__ltBoard.view;
    /* 光标那一点对应的画板坐标（就是把 toBoard 反过来算一遍） */
    const bx = v.x + (${hold.x} - r.left) / v.scale;
    const by = v.y + (${hold.y} - r.top) / v.scale;
    return { bx: Math.round(bx * 10) / 10, by: Math.round(by * 10) / 10, color: window.__ltBoard.pixelAt(bx, by) };
  })()`);
  check('★ 放大的时候光标底下那一点没跑（还是那条线的墨色）',
    underCursor.color === '#1d1430', JSON.stringify(underCursor));
  check('页面上的缩放读数跟着变', await cdp.ev(`/\\d\\.\\d×/.test((document.querySelector('[data-lt-zoom]')||{}).textContent||'')`),
    await cdp.ev(`(document.querySelector('[data-lt-zoom]')||{}).textContent||''`));

  /* 放大状态留一张截图（人眼看"放大之后是什么样"） */
  try {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(path.join(SRC, '.tmp', 'shots'), { recursive: true });
    fs.writeFileSync(path.join(SRC, '.tmp', 'shots', 'teahouse-board-zoom.png'), Buffer.from(shot.data, 'base64'));
  } catch {
    /* 截不到不影响验收 */
  }

  /* 放大状态下画一笔：坐标要还是**画板坐标**（不能把屏幕像素当成画板坐标发上去） */
  const beforeZoomDraw = seen.add.length;
  await cdp.ev(`document.querySelector('[data-lt-tool="pan"]').classList.remove('is-on'); [...document.querySelectorAll('.lyt-draw__bar button')].find((b) => b.textContent.trim() === '画笔').click()`);
  await cdp.ev(`[...document.querySelectorAll('.lyt-draw__swatch')].find((b) => b.dataset.color === '#8ac926').click()`);
  await drawOn([[500, 500], [560, 500], [620, 500]]);
  const zoomStroke = seen.add[seen.add.length - 1];
  check('★ 放大之后画的笔划，坐标依旧是画板坐标（不是屏幕像素）',
    seen.add.length === beforeZoomDraw + 1 &&
      zoomStroke.points.every(([x, y]) => Math.abs(y - 500) <= 6 && x >= 495 && x <= 625),
    JSON.stringify(zoomStroke?.points?.slice(0, 4)));
  check('放大之后画上去的颜色也在画布上（那一点是新的绿色）',
    (await cdp.ev(pixelAt(560, 500))) === '#8ac926', await cdp.ev(pixelAt(560, 500)));

  /* 「抓手」拖动：板子跟着走 */
  await cdp.ev(`document.querySelector('[data-lt-tool="pan"]').click()`);
  const vBeforePan = await cdp.ev(viewOf);
  await showCanvas();
  const p0 = await cdp.ev(toScreen(1200, 750));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p0.x, y: p0.y, button: 'left', clickCount: 1, buttons: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p0.x - 120, y: p0.y - 60, button: 'left', buttons: 1 });
  await sleep(200);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p0.x - 120, y: p0.y - 60, button: 'left', clickCount: 1, buttons: 0 });
  await sleep(400);
  const vAfterPan = await cdp.ev(viewOf);
  check('★ 抓手能把板子拖走（平移量 ≈ 拖动距离 / 缩放）',
    vAfterPan.x > vBeforePan.x && vAfterPan.y > vBeforePan.y &&
      Math.abs(vAfterPan.x - vBeforePan.x - 120 / vBeforePan.scale) < 6,
    JSON.stringify({ before: vBeforePan, after: vAfterPan }));
  check('拖动的时候不会顺手画出一笔（那一笔的笔划表没变长）', seen.add.length === beforeZoomDraw + 1, `${seen.add.length} 笔`);

  /* 双指捏合（手机上没滚轮，只有这一条路）—— 用 CDP 的真触摸事件驱动 */
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const center = await cdp.ev(`(() => {
    const r = document.querySelector('[data-lt-canvas]').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  const anchors = `(() => {
    const c = document.querySelector('[data-lt-canvas]');
    const r = c.getBoundingClientRect();
    const v = window.__ltBoard.view;
    return { bx: Math.round((v.x + (${center.x} - r.left) / v.scale) * 10) / 10, by: Math.round((v.y + (${center.y} - r.top) / v.scale) * 10) / 10, zoom: v.zoom };
  })()`;
  const pinchBefore = await cdp.ev(anchors);
  const pinchStrokes = seen.add.length;
  const touchPts = (spread) => [
    { x: center.x - 60 - spread, y: center.y, id: 1 },
    { x: center.x + 60 + spread, y: center.y, id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touchPts(0) });
  for (const spread of [20, 45, 70, 95]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touchPts(spread) });
    await sleep(120);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(500);
  const pinchAfter = await cdp.ev(anchors);
  check('★ 双指张开能放大（手机上没滚轮，这是唯一的路）',
    pinchAfter.zoom > pinchBefore.zoom * 1.15, JSON.stringify({ before: pinchBefore.zoom, after: pinchAfter.zoom }));
  check('★ 双指缩放也把中点底下那个画板点钉住了（没跑偏）',
    Math.abs(pinchAfter.bx - pinchBefore.bx) <= 4 && Math.abs(pinchAfter.by - pinchBefore.by) <= 4,
    JSON.stringify({ before: [pinchBefore.bx, pinchBefore.by], after: [pinchAfter.bx, pinchAfter.by] }));
  check('★ 捏一下不会顺手画出一道（笔划一条没多）',
    seen.add.length === pinchStrokes, `${pinchStrokes} → ${seen.add.length}`);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });

  /* 「全览」按钮 */
  await cdp.ev(`document.querySelector('[data-lt-reset]').click()`);
  await sleep(400);
  const vReset = await cdp.ev(viewOf);
  check('★ 点「全览」回到 fit / 原点 / 读数 1.0×',
    vReset && Math.abs(vReset.scale - vReset.fit) < 0.002 && vReset.x === 0 && vReset.y === 0 && Math.abs(vReset.zoom - 1) < 0.02,
    JSON.stringify(vReset));

  /* 橡皮：擦过自己那条线 → 那点变回纸色 */
  await cdp.ev(`document.querySelector('[data-lt-tool="eraser"]').click()`);
  await drawOn([[400, 375], [500, 375], [600, 375], [700, 375]]);
  const erased = await cdp.ev(pixelAt(600, 375));
  check('★ 橡皮擦过之后那一点变回纸色', erased === PAPER, erased);
  /*
    ⚠ 别写死"第 2 笔"：缩放那一段插在橡皮之前，所以橡皮不一定是第几笔 ——
    看**最后一笔**才对（2026-10-09 挪顺序时这条假红过一次）。
  */
  const lastStroke = seen.add[seen.add.length - 1];
  check('橡皮那一笔也发上去了（最后一笔 tool=eraser、颜色是纸色）',
    lastStroke?.tool === 'eraser' && lastStroke?.color === '#fbf6ee',
    JSON.stringify({ tool: lastStroke?.tool, color: lastStroke?.color }));

  /* ---- 撤销：删自己最后那一笔 ---- */
  await cdp.ev(`document.querySelector('[data-lt-undo]').click()`);
  await sleep(600);
  check('★ 撤销会真的请求删掉自己那一笔（LT_DRAW_DELETE）',
    seen.del.length === 1 && seen.del[0].event === 'LT_DRAW_DELETE' && seen.del[0].ltToken === 'fake-token', JSON.stringify(seen.del[0] ?? {}));

  check('这一趟没有未捕获的 JS 异常', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

  /* 截图留一张（人眼看） */
  try {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(path.join(SRC, '.tmp', 'shots'), { recursive: true });
    fs.writeFileSync(path.join(SRC, '.tmp', 'shots', 'teahouse-board.png'), Buffer.from(shot.data, 'base64'));
  } catch {
    /* 截不到不影响验收 */
  }
} catch (err) {
  fail++;
  console.log('FAIL  浏览器那一段异常: ' + (err?.stack ?? err));
} finally {
  try {
    execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' });
  } catch {
    /* 已退 */
  }
  server.close();
  await sleep(200);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}

console.log(`\n==== ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''} ====`);
process.exit(fail ? 1 : 0);
