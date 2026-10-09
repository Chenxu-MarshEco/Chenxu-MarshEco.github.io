/*
 * ============================================================================
 * 黎语堂「聊天室」的验收（2026-10-09）
 * ----------------------------------------------------------------------------
 * 用户原话：
 *   「左侧大板块：聊天室　点进去以后所有注册后通过审核的用户只能和QQ聊天一样发一条一条的
 *    消息 可以附带图片之类的 每天保存一次聊天记录 侧边栏套用花涧堂的时间轴系统
 *    可以点击时间轴跳转到当日聊天记录 也可以搜索历史聊天记录 保存的聊天记录最好可以不
 *    调用腾讯云的额度 例如保存在本地仓库？但是需要所有用户都能搜索」
 *
 * 两段：
 *   ① **真跑**：内存里的真 MongoDB，把云函数整份跑一遍 ——
 *      没登录 / 没过审读不到也发不出 → 过审能发（文字、图片）→ 列表按天、按游标增量 →
 *      昵称头像按账号写死 → 各种上限（空消息 / 超长 / 假图片 / 超大图 / 太快 / 一小时条数）→
 *      撤回自己的、撤不了别人的
 *   ② **真浏览器**：把 dist 端上来，后端换成本脚本里的"假云函数"，走完
 *      「过审的人进来 → 看到历史消息 → 打字发出去 → 新消息出现在流里（含轮询拉到别人的）→
 *       撤回」；外加一条访客视角（输入区锁着 + 说清楚为什么）。
 *
 * 用法：node tools/checks/liyutang-chat-check.mjs [dist目录]
 * ② 需要 mongodb-memory-server（在 %TEMP%\huajiantang-twikoofn 里），没装就跳过①。
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
const DEBUG_PORT = 9399;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
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

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF/9UeIAAAAAElFTkSuQmCC';

/* ============================================================ ① 静态 */

console.log('=== ① 静态：该有的东西都在不在 ===');
const backend = read('tools/liyutang-backend/index.js');
check('云函数里有聊天集合与三个事件',
  /const CHAT = 'lt_chat'/.test(backend) &&
  ['LT_CHAT_LIST', 'LT_CHAT_SEND', 'LT_CHAT_DELETE'].every((e) => backend.includes(e)));
check('★ 聊天室**读也要过审**（chatWho 那道闸门）', /async function chatWho/.test(backend) && /chatWho\(payload\)/.test(backend));
check('★ 昵称 / 头像按账号写死（防冒名）', /nick: me\.nick/.test(backend) && /avatar: me\.avatar/.test(backend));
check('有字数 / 图片 / 频率三重上限',
  /CHAT_TEXT_MAX/.test(backend) && /CHAT_IMAGE_MAX/.test(backend) && /CHAT_GAP_MS/.test(backend) && /CHAT_PER_HOUR/.test(backend));
check('按"哪一天"存（day 字段 + 北京时间切日）', /function dayKey/.test(backend) && /day: dayKey\(now\)/.test(backend));

const client = read('src/utils/liyutang-client.ts');
check('前端有收发三件套（listChat / sendChat / deleteChat）',
  /export async function listChat/.test(client) && /export async function sendChat/.test(client) && /export async function deleteChat/.test(client));
check('前端有聊天室那套（mountChat：轮询 + 回车发 + 传图）',
  /export function mountChat/.test(client) && /pollMs/.test(client) && /compressImage\(file, \{ max: 1000/.test(client));
check('★ 页面切到后台就停轮询（不烧额度）', /visibilityState === 'visible'/.test(client));

const page = read(path.join('src', 'pages', 'liyutang', 'chatroom.astro'));
check('聊天室页面在，并且挂上了 mountChat', /mountChat\(/.test(page) && /data-lt-chat-log/.test(page));
check('没登录 / 没过审时输入区是锁着的', /lock\(true\)/.test(page) && /账号还在等站长审核/.test(page));
check('侧栏留了"日子"那一列（以后接时间轴）', /data-lt-chat-days/.test(page));

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
  skip('聊天室那一整套的真跑', '这台机器上没有现成的 mongodb-memory-server / mongod 二进制');
} else {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('twikoo');
  process.env.MONGODB_URI = uri;
  process.env.LT_SECRET = 'chat-check-secret';
  process.env.NODE_PATH = candidates[0];
  Module._initPaths();
  const req2 = createRequire(path.join(candidates[0], 'x.js'));
  const app = req2(BACKEND);
  const call = (body) => app.main(body);
  /* 直接连库：用来造"一小时前那 120 条"这种用接口造不出来的状态 */
  const { MongoClient } = req2('mongodb');
  const cli = new MongoClient(uri);
  await cli.connect();
  const raw = cli.db('twikoo').collection('lt_chat');

  await call({ event: 'LT_REGISTER', nick: 'hoshi', mail: 'h@example.com', pass: 'hoshi123456' });
  await call({ event: 'LT_REGISTER', nick: 'arcarlight', mail: 'a@example.com', pass: 'arc123456789' });
  const tokHoshi = (await call({ event: 'LT_LOGIN', nick: 'hoshi', pass: 'hoshi123456' })).token;
  const tokArc = (await call({ event: 'LT_LOGIN', nick: 'arcarlight', pass: 'arc123456789' })).token;

  check('★ 没登录读聊天室 → 被拒', (await call({ event: 'LT_CHAT_LIST' })).code !== 0);
  check('★ 没过审读聊天室 → 被拒（读也要过审）',
    (await call({ event: 'LT_CHAT_LIST', ltToken: tokHoshi })).code !== 0,
    String((await call({ event: 'LT_CHAT_LIST', ltToken: tokHoshi })).message));
  check('没过审发消息 → 被拒', (await call({ event: 'LT_CHAT_SEND', ltToken: tokHoshi, text: 'hi' })).code !== 0);

  await call({ event: 'SET_PASSWORD', password: createHash('md5').update('admin-pass-123').digest('hex') });
  const users = (await call({ event: 'LT_ADMIN_LIST', password: 'admin-pass-123' })).users;
  const idHoshi = users.find((u) => u.nick === 'hoshi').id;
  await call({ event: 'LT_ADMIN_SET', password: 'admin-pass-123', id: idHoshi, status: 'approved' });
  await call({ event: 'LT_AVATAR_SET', ltToken: tokHoshi, avatar: PNG });

  const first = await call({ event: 'LT_CHAT_SEND', ltToken: tokHoshi, text: '第一条！' });
  check('★ 过审之后能发（文字）', first.code === 0 && !!first.message?.id, String(first.message?.id));
  check('消息带着"哪一天"（存档按这个切）', /^\d{4}-\d{2}-\d{2}$/.test(String(first.message?.day)), String(first.message?.day));
  check('昵称和头像按账号写死', first.message?.nick === 'hoshi' && first.message?.avatar === PNG);
  check('自己发的标记成 mine', first.message?.mine === true);

  const tooFast = await call({ event: 'LT_CHAT_SEND', ltToken: tokHoshi, text: '紧接着又一条' });
  check('★ 发太快 → 被拒（1.5 秒一条）', tooFast.code !== 0, String(tooFast.message));
  await sleep(1600);

  check('空消息 → 被拒', (await call({ event: 'LT_CHAT_SEND', ltToken: tokHoshi, text: '   ' })).code !== 0);
  await sleep(1600);
  check(`超长（>800 字）→ 被拒`, (await call({ event: 'LT_CHAT_SEND', ltToken: tokHoshi, text: 'x'.repeat(801) })).code !== 0);
  await sleep(1600);
  check('假图片（data:text/html）→ 被拒',
    (await call({ event: 'LT_CHAT_SEND', ltToken: tokHoshi, image: 'data:text/html;base64,PGI+' })).code !== 0);
  await sleep(1600);
  check('图片太大 → 被拒',
    (await call({ event: 'LT_CHAT_SEND', ltToken: tokHoshi, image: PNG.replace(',', ',' + 'A'.repeat(420000)) })).code !== 0);
  await sleep(1600);

  const withImg = await call({ event: 'LT_CHAT_SEND', ltToken: tokHoshi, image: PNG, text: '带图的' });
  check('★ 能发图片（压过的 data URL 内嵌）', withImg.code === 0, String(withImg.message?.id));
  await sleep(1600);
  const arcMsg = await call({ event: 'LT_CHAT_SEND', ltToken: tokArc, text: 'arcarlight（还没过审）' });
  check('★ 忘了审的 arcarlight 还是发不出', arcMsg.code !== 0 && /审核/.test(String(arcMsg.message)), String(arcMsg.message));

  const list = await call({ event: 'LT_CHAT_LIST', ltToken: tokHoshi });
  check('列表读得到今天的两条（按时间正序）', list.code === 0 && list.messages.length === 2, `${list.messages?.length} 条`);
  check('列表里第一条是"第一条！"', list.messages?.[0]?.text === '第一条！');
  check('列表带 serverNow / today（页面用它判断跨零点）', !!list.serverNow && /^\d{4}-\d{2}-\d{2}$/.test(String(list.today)));
  const cursor = list.messages[list.messages.length - 1].createdAt;
  const inc = await call({ event: 'LT_CHAT_LIST', ltToken: tokHoshi, after: cursor });
  check('★ 按游标增量拉：没有新消息时是空的（轮询就靠这个省流量）', inc.code === 0 && inc.messages.length === 0);
  await sleep(1600);
  await call({ event: 'LT_CHAT_SEND', ltToken: tokHoshi, text: '第三条' });
  const inc2 = await call({ event: 'LT_CHAT_LIST', ltToken: tokHoshi, after: cursor });
  check('★ 有新消息时只回新的那条', inc2.messages?.length === 1 && inc2.messages[0].text === '第三条');

  check('★ 撤回自己的 → 成功', (await call({ event: 'LT_CHAT_DELETE', ltToken: tokHoshi, id: first.message.id })).code === 0);
  const afterDel = await call({ event: 'LT_CHAT_LIST', ltToken: tokHoshi });
  check('撤回之后列表里没有了', !afterDel.messages.some((m) => m.id === first.message.id) && afterDel.messages.length === 2,
    `${afterDel.messages.length} 条`);

  /* 一小时上限：直接往库里塞 120 条"刚过去的这一小时"里的消息（接口造不出来，因为有限速） */
  const now = Date.now();
  await raw.insertMany([
    ...Array.from({ length: 120 }, (_, i) => ({
      id: 'bulk' + i,
      day: new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10),
      userId: idHoshi,
      nick: 'hoshi',
      avatar: '',
      text: '刷屏 ' + i,
      image: '',
      createdAt: now - 60000 - i * 100,
      deleted: false,
    })),
    /* 一条"别人发的"，用来验"撤回不了别人的" */
    { id: 'other1', day: new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10), userId: 'someone-else', nick: '别人', avatar: '', text: '别人的话', image: '', createdAt: now - 500, deleted: false },
  ]);
  /* ⚠ 先等过限速那一关，不然测到的是"发太快"而不是"一小时满了" */
  await sleep(1600);
  const overLimit = await call({ event: 'LT_CHAT_SEND', ltToken: tokHoshi, text: '还能发吗' });
  check('★ 一小时超过 120 条 → 被拒（刷屏挡得住）', overLimit.code !== 0 && /120/.test(String(overLimit.message)), String(overLimit.message));

  check('★ 撤回不了别人的消息', (await call({ event: 'LT_CHAT_DELETE', ltToken: tokHoshi, id: 'other1' })).code !== 0);
  check('撤回自己的还是可以', (await call({ event: 'LT_CHAT_DELETE', ltToken: tokHoshi, id: withImg.message.id })).code === 0);

  await cli.close();
  await mongod.stop();
}

/* ============================================================ ③ 真浏览器 */

console.log('\n=== ③ 真浏览器：假云函数 + 真构建产物 ===');
const liveApi = (() => {
  try {
    return JSON.parse(read('src/data/liyutang.json')).forum?.twikoo?.envId ?? '';
  } catch {
    return '';
  }
})();
const seen = { sends: [], lists: 0 };
/*
  假后端：时间戳**按当下算**，不能用固定小数字 ——
  页面轮询带的是"只要比这个游标新的"，而发出去的那条时间戳是最新的；
  固定成 3000 的话，注入的那条永远比游标旧，就永远拉不到（第一版就是这么假红的）。
*/
const t0 = Date.now();
const history = [
  { id: 'm1', day: '2026-10-09', nick: '测试者', avatar: '', text: '第一条历史消息', image: '', createdAt: t0 - 20000, mine: true },
  { id: 'm2', day: '2026-10-09', nick: '虹星', avatar: '', text: '我是别人', image: '', createdAt: t0 - 10000, mine: false },
];
const injected = () => ({ id: 'm3', day: '2026-10-09', nick: '虹星', avatar: '', text: '轮询拉到的新消息', image: '', createdAt: Date.now(), mine: false });
const fakeBackend = (body) => {
  const event = String(body?.event || '');
  if (event === 'LT_ME') return { code: 0, user: { nick: '测试者', mail: '', status: 'approved', avatar: '', label: '' }, posts: 0 };
  if (event === 'LT_CHAT_LIST') {
    seen.lists += 1;
    const all = seen.lists >= 2 ? [...history, injected()] : history;
    const after = Number(body?.after) || 0;
    return { code: 0, day: '2026-10-09', today: '2026-10-09', serverNow: Date.now(), messages: all.filter((m) => m.createdAt > after) };
  }
  if (event === 'LT_CHAT_SEND') {
    seen.sends.push(body);
    return {
      code: 0,
      message: { id: 'mine' + seen.sends.length, day: '2026-10-09', nick: '测试者', avatar: '', text: String(body.text || ''), image: '', createdAt: Date.now(), mine: true },
    };
  }
  if (event === 'LT_CHAT_DELETE') return { code: 0, id: body.id };
  return { code: 0 };
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
};
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

const profile = path.join(process.env.TEMP ?? '.', `dsh-lytchat-${Date.now()}`);
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
  async goto(url) {
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
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const base = `http://127.0.0.1:${PORT}`;

  /* ---- 访客 ---- */
  await cdp.goto(`${base}/liyutang/chatroom/`);
  const guestPainted = await cdp.wait(`(() => { const a = document.querySelector('[data-lt-account]'); return !!(a && a.dataset.state); })()`);
  const guest = await cdp.ev(`(() => ({
      state: (document.querySelector('[data-lt-account]')||{}).dataset?.state || '',
      gate: (document.querySelector('[data-lt-chat-gate]')||{}).textContent || '',
      inputDisabled: !!(document.querySelector('[data-lt-chat-text]')||{}).disabled,
      sendDisabled: !!(document.querySelector('[data-lt-chat-send]')||{}).disabled,
      msgs: document.querySelectorAll('.lyt-msg').length,
    }))()`);
  info('访客看到：' + JSON.stringify(guest));
  check('★ 访客：账号区画出来了（state=guest）', guestPainted === true && guest.state === 'guest', guest.state);
  check('★ 访客：输入框和发送键都是锁着的', guest.inputDisabled === true && guest.sendDisabled === true);
  check('访客：说明白了要先登录 / 过审', /登录/.test(guest.gate) && !/正在看登录状态/.test(guest.gate), guest.gate.slice(0, 50));
  check('访客：看不到消息流（聊天室要过审才读得到）', guest.msgs === 0);

  /* ---- 过审的人 ---- */
  await cdp.ev(`localStorage.setItem('lt_token','fake-token')`);
  await cdp.goto(`${base}/liyutang/chatroom/`);
  const ready = await cdp.wait(`(() => {
      const i = document.querySelector('[data-lt-chat-text]');
      return !!i && !i.disabled && document.querySelectorAll('.lyt-msg').length >= 2;
    })()`, 20000);
  check('★ 过审账号进来：输入区解锁 + 历史消息画出来了', ready === true);

  const painted = await cdp.ev(`(() => ({
      msgs: [...document.querySelectorAll('.lyt-msg')].map((m) => ({
        nick: (m.querySelector('.lyt-msg__nick')||{}).textContent||'',
        text: (m.querySelector('.lyt-msg__text')||{}).textContent||'',
        hasRevert: !!m.querySelector('.tkc__link'),
      })),
      gate: (document.querySelector('[data-lt-chat-gate]')||{}).textContent||'',
    }))()`);
  info('画出来的消息：' + JSON.stringify(painted.msgs));
  check('历史消息按顺序画出来了（含别人的）', painted.msgs.length === 2 && painted.msgs[1].text === '我是别人');
  check('自己那条有「撤回」，别人的没有', painted.msgs[0].hasRevert === true && painted.msgs[1].hasRevert === false);
  check('页面上写着"你以 测试者 的身份"', /测试者/.test(painted.gate), painted.gate.slice(0, 40));

  /* 打字发出去 */
  await cdp.ev(`(() => {
      const i = document.querySelector('[data-lt-chat-text]');
      i.value = '浏览器里发的一句';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  await cdp.ev(`document.querySelector('[data-lt-chat-send]').click()`);
  const mineShown = await cdp.wait(`[...document.querySelectorAll('.lyt-msg__text')].some((n) => n.textContent === '浏览器里发的一句')`);
  check('★ 点「发出去」→ 自己那条立刻出现在流里', mineShown === true);
  check('★ 发给后端的请求带对了（事件 / 令牌 / 文字）',
    seen.sends.length === 1 && seen.sends[0].event === 'LT_CHAT_SEND' && seen.sends[0].ltToken === 'fake-token' && seen.sends[0].text === '浏览器里发的一句',
    JSON.stringify(seen.sends[0] ?? {}));
  const cleared = await cdp.ev(`document.querySelector('[data-lt-chat-text]').value === ''`);
  check('发完输入框清空了', cleared === true);

  /* 轮询：假后端第二趟会多给一条"别人发的" */
  const polled = await cdp.wait(`[...document.querySelectorAll('.lyt-msg__text')].some((n) => n.textContent === '轮询拉到的新消息')`, 20000);
  check('★ 轮询拉到了别人刚发的消息（不用刷新页面）', polled === true, `问了 ${seen.lists} 次`);
  check('轮询次数 > 1（确实在按间隔问）', seen.lists > 1, `${seen.lists} 次`);

  /* 存一张截图给人看（.tmp/shots/chat-<时间>.png） */
  try {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(path.join(SRC, '.tmp', 'shots'), { recursive: true });
    fs.writeFileSync(path.join(SRC, '.tmp', 'shots', 'chat-room.png'), Buffer.from(shot.data, 'base64'));
  } catch {
    /* 截不到不影响验收 */
  }

  /* 回车发 —— 聊天软件的手感 */
  const before = seen.sends.length;
  await cdp.ev(`(() => {
      const i = document.querySelector('[data-lt-chat-text]');
      i.value = '回车发的';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`);
  await sleep(600);
  check('★ 回车就能发（Shift+回车换行）', seen.sends.length === before + 1 && seen.sends[seen.sends.length - 1].text === '回车发的',
    JSON.stringify(seen.sends[seen.sends.length - 1] ?? {}));

  check('这一趟没有未捕获的 JS 异常', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));
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
