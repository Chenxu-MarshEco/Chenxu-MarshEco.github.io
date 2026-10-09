/*
 * ============================================================================
 * 「登录状态」的韧性验收（2026-10-09 晚上）
 * ----------------------------------------------------------------------------
 * 群友反馈："上次推流前，刷新网页 / 重进网站 / 进黎语堂的新页面会掉登录"。
 * 查出来的根因两条（都不是令牌真过期）：
 *   ① 云函数冷启动连不上数据库时回的那个错误码，和"令牌过期"**是同一个 1000**
 *      —— 页面分不出来，就按"过期"处理，**把令牌删了**（网络抖一下 = 永久登出）；
 *   ② 那一瞬间页面只能显示"未登录"，用户看到的就是掉登录。
 * 对应的修法：后端给"令牌无效"单独的 401；页面**只认 401**、失败自动重试、
 * 并且缓存"上次确认过的身份"好让刷新时先画出来。
 *
 * 这个脚本就是钉住这些行为的，分三段：
 *   ① 静态：代码里那两条规矩在（只认 401 / 有重试 / 有缓存）
 *   ② 真跑后端（内存 MongoDB 跑整份云函数）：401 与 1000 确实分得开；改昵称、存偏好能落库
 *   ③ 真浏览器（假云函数，能被我切成"临时失败 / 401 / 断网"三种）：
 *      临时失败**不许**清令牌、不许说"过期"；401 才清；恢复后**不用刷新**自己变回来；
 *      刷新时用缓存先把身份画出来（这就是"掉登录"那个观感的正面）
 *
 * 用法：node tools/checks/liyutang-session-check.mjs [dist目录]
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
const ROOT = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(SRC, 'dist'));
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const DEBUG_PORT = 9405;
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

console.log('=== ① 静态：那两条规矩在代码里 ===');
const client = read(path.join('src', 'utils', 'liyutang-client.ts'));
check('★ 客户端只在 401 时清令牌（不是"只要不是 0 就清"）',
  /Number\(r\.code\) === 401[\s\S]{0,200}clearToken\(\)/.test(client), '');
check('★ 临时失败会重试（1.5s / 3s 三次）', /for \(let attempt = 0; attempt < 3/.test(client), '');
check('★ 失败之后还会自己再试一次（不用用户刷新页面）', /setTimeout\(\(\) => \{[\s\S]{0,80}handle\.refresh\(\)/.test(client), '');
check('★ 有"上次确认过的身份"缓存（刷新时先画出来，不闪未登录）',
  /const USER_KEY = 'lt_user'/.test(client) && /getCachedUser/.test(client) && /setCachedUser/.test(client), '');
check('主动退出会连缓存一起清', /clearToken\(\);[\s\S]{0,120}setCachedUser\(null\)/.test(client), '');
const backendSrc = read(path.join('tools', 'liyutang-backend', 'index.js'));
check('★ 后端给了单独的 401（不再是所有错误都 1000）',
  /const AUTH = 401/.test(backendSrc) && /AUTH/.test(backendSrc), '');
check('后端：改昵称 / 存偏好 / 看别人资料 三个事件都在',
  /LT_PROFILE_SET/.test(backendSrc) && /LT_PREFS_SET/.test(backendSrc) && /LT_USER_GET/.test(backendSrc), '');
check('★ 看别人的资料不发邮箱（账号隐私）', /delete pub\.mail/.test(backendSrc), '');

/* ============================================================ ② 真跑后端 */

console.log('\n=== ② 真跑：内存 MongoDB 里跑整份云函数 ===');
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
  skip('后端那一段', '这台机器上没有现成的 mongodb-memory-server / mongod');
} else {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('twikoo');
  process.env.LT_SECRET = 'session-check-secret';
  process.env.NODE_PATH = candidates[0];
  Module._initPaths();
  const app = createRequire(path.join(candidates[0], 'x.js'))(BACKEND);
  const call = (body) => app.main(body);

  await call({ event: 'LT_REGISTER', nick: 'hoshi', mail: 'h@example.com', pass: 'hoshi123456' });
  await call({ event: 'LT_REGISTER', nick: 'arcarlight', mail: 'a@example.com', pass: 'arc123456789' });
  const tok = (await call({ event: 'LT_LOGIN', nick: 'hoshi', pass: 'hoshi123456' })).token;
  await call({ event: 'SET_PASSWORD', password: createHash('md5').update('admin-pass-123').digest('hex') });
  const users = (await call({ event: 'LT_ADMIN_LIST', password: 'admin-pass-123' })).users;
  await call({ event: 'LT_ADMIN_SET', password: 'admin-pass-123', id: users.find((u) => u.nick === 'hoshi').id, status: 'approved' });

  const noToken = await call({ event: 'LT_ME' });
  check('★ 没带令牌 → 不是 401（页面不该把"没登录"当成"过期"）', noToken.code !== 0 && noToken.code !== 401, `code=${noToken.code}`);
  const bad = await call({ event: 'LT_ME', ltToken: 'garbage.token' });
  check('★ 令牌是坏的 → 401（页面只认这个才清令牌）', bad.code === 401, `code=${bad.code} ${bad.message ?? ''}`);
  const me = await call({ event: 'LT_ME', ltToken: tok });
  check('令牌有效 → 0，并且带着 alias（昵称）', me.code === 0 && me.user.alias === 'hoshi', JSON.stringify(me.user?.alias));

  const renamed = await call({ event: 'LT_PROFILE_SET', ltToken: tok, alias: '虹星' });
  check('★ 改昵称：落库、回传新昵称', renamed.code === 0 && renamed.user.alias === '虹星', JSON.stringify(renamed.user?.alias ?? renamed.message));
  check('改完之后 LT_ME 读到的是新昵称', (await call({ event: 'LT_ME', ltToken: tok })).user.alias === '虹星');
  check('用户名没被动过（nick 还是原来的）', (await call({ event: 'LT_ME', ltToken: tok })).user.nick === 'hoshi');
  check('昵称太长 / 太短会被拒',
    (await call({ event: 'LT_PROFILE_SET', ltToken: tok, alias: 'x' })).code !== 0 &&
      (await call({ event: 'LT_PROFILE_SET', ltToken: tok, alias: 'x'.repeat(30) })).code !== 0);
  check('没登录改昵称 → 401', (await call({ event: 'LT_PROFILE_SET', alias: '随便' })).code === 401);

  const prefs = await call({
    event: 'LT_PREFS_SET',
    ltToken: tok,
    prefs: { palette: ['#ff4d6d', '#FF4D6D', 'red', '#3a86ff'], penSize: 999, eraserSize: 8, color: '#3a86ff', tool: 'eraser', 乱七八糟: '丢掉' },
  });
  check('★ 画板偏好能存：调色盘去重、颜色非法丢掉、粗细夹到 64',
    prefs.code === 0 && prefs.prefs.palette.length === 2 && prefs.prefs.penSize === 64 && prefs.prefs.eraserSize === 8,
    JSON.stringify(prefs.prefs));
  check('★ 不认识的字段进不去库里（不让用户往自己文档塞任意东西）', !('乱七八糟' in (prefs.prefs ?? {})), JSON.stringify(Object.keys(prefs.prefs ?? {})));
  check('偏好跟着账号：LT_ME 里带着它', (await call({ event: 'LT_ME', ltToken: tok })).user.prefs.palette.length === 2);
  check('偏好数据整个不是对象 → 被拒', (await call({ event: 'LT_PREFS_SET', ltToken: tok, prefs: 'x' })).code !== 0);

  /* ---- 昵称贯通：改了名之后，他以前说过的话 / 发过的贴 / 画过的笔划都要显示新昵称 ---- */
  await call({ event: 'LT_CHAT_SEND', ltToken: tok, text: '改名之前说的话' });
  /* ⚠ 版块 id 要用**真版块**（notice），不然帖子压根发不出去 ——
     第一次我写了个假 id，列表是空的，而 `[].every()` 恒真，差点变成一条假绿的验收 */
  const mkPost = await call({ event: 'LT_POST_CREATE', ltToken: tok, board: 'notice', title: '改名之前发的贴', md: '正文' });
  await call({ event: 'LT_DRAW_ADD', ltToken: tok, tool: 'pen', color: '#ff4d6d', size: 6, points: [[10, 10], [20, 20]] });
  const back2 = await call({ event: 'LT_PROFILE_SET', ltToken: tok, alias: '虹星' });
  check('改名成功（为后面的贯通验收做准备）', back2.code === 0, '');
  const chatAfter = await call({ event: 'LT_CHAT_LIST', ltToken: tok });
  check('★ 聊天消息显示的是**当前昵称**（老消息也认新昵称）',
    chatAfter.code === 0 && (chatAfter.messages ?? []).length > 0 && chatAfter.messages.every((m) => m.alias === '虹星'),
    JSON.stringify((chatAfter.messages ?? []).map((m) => m.alias)));
  const postsAfter = await call({ event: 'LT_POST_LIST', board: 'notice', ltToken: tok });
  check('★ 帖子显示的是当前昵称',
    postsAfter.code === 0 && (postsAfter.posts ?? []).length > 0 && postsAfter.posts.every((p) => p.authorAlias === '虹星'),
    JSON.stringify(mkPost).slice(0, 100) + ' | ' + JSON.stringify((postsAfter.posts ?? []).map((p) => p.authorAlias)));
  const onePost = postsAfter.posts?.[0]?.id;
  const postOne = onePost ? await call({ event: 'LT_POST_GET', id: onePost, ltToken: tok }) : { post: {} };
  check('★ 单条帖子也显示当前昵称', postOne.post?.authorAlias === '虹星', JSON.stringify(postOne.post?.authorAlias));
  const drawAfter = await call({ event: 'LT_DRAW_LIST', ltToken: tok });
  check('★ 笔划显示的是当前昵称',
    drawAfter.code === 0 && drawAfter.strokes?.every((s) => s.alias === '虹星'),
    JSON.stringify((drawAfter.strokes ?? []).map((s) => s.alias)));

  const other = users.find((u) => u.nick === 'arcarlight');
  const peek = await call({ event: 'LT_USER_GET', id: other.id, ltToken: tok });
  check('★ 看别人的资料：拿得到昵称/头像，**拿不到邮箱**',
    peek.code === 0 && peek.me === false && peek.user?.alias === 'arcarlight' && !('mail' in (peek.user ?? {})),
    /* 诊断信息要打**整个返回**：只打 keys 的话，"报错"和"字段不对"看起来一样（我踩过） */
    JSON.stringify(peek).slice(0, 180));
  const self = await call({ event: 'LT_USER_GET', id: users.find((u) => u.nick === 'hoshi').id, ltToken: tok });
  check('看自己会带 me:true', self.code === 0 && self.me === true, JSON.stringify(self).slice(0, 150));
  check('看不存在的人 → 被拒', (await call({ event: 'LT_USER_GET', id: 'nobody' })).code !== 0);

  await mongod.stop();
}

/* ============================================================ ③ 真浏览器 */

console.log('\n=== ③ 真浏览器：临时失败不许掉登录、401 才掉、恢复后自己变回来 ===');
const liveApi = (() => {
  try {
    return JSON.parse(read(path.join('src', 'data', 'liyutang.json'))).forum?.twikoo.envId ?? '';
  } catch {
    return '';
  }
})();

/** 假云函数：mode 决定 LT_ME 怎么回 —— ok / slow（临时失败 1000）/ auth（401）/ down（直接断） */
let mode = 'ok';
let meHits = 0;
const USER = { nick: 'hoshi', alias: '虹星', mail: '', status: 'approved', label: '', avatar: 'data:image/png;base64,iVBORw0KGgo=', createdAt: 1, prefs: { palette: ['#ff4d6d'], penSize: 12, eraserSize: 30 } };
const fakeBackend = (body) => {
  const event = String(body?.event || '');
  if (event === 'LT_ME') {
    meHits += 1;
    if (mode === 'slow') return { code: 1000, message: "Socket 'secureConnect' timed out after 5001ms" };
    if (mode === 'auth') return { code: 401, message: '登录状态过期了，重新登录一下' };
    return { code: 0, user: USER, posts: 0 };
  }
  if (event === 'LT_CHAT_LIST' || event === 'LT_DRAW_LIST') return { code: 0, messages: [], strokes: [], day: '2026-10-09', today: '2026-10-09', serverNow: Date.now(), more: false };
  return { code: 0 };
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__mode') {
    mode = String(url.searchParams.get('m') || 'ok');
    meHits = 0;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ mode }));
    return;
  }
  if (url.pathname === '/__hits') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ hits: meHits, mode }));
    return;
  }
  if (url.pathname === '/__lt') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (mode === 'down') {
        req.socket.destroy();
        return;
      }
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

const profile = path.join(process.env.TEMP ?? '.', `dsh-lytsession-${Date.now()}`);
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

const stateOf = `(() => {
  const a = document.querySelector('[data-lt-account]');
  return { state: a ? a.dataset.state : '(没有账号区)', text: (document.querySelector('[data-lt-account]')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 120) };
})()`;
const tokenOf = `(() => { try { return localStorage.getItem('lt_token') || ''; } catch { return ''; } })()`;
const cacheOf = `(() => { try { return localStorage.getItem('lt_user') || ''; } catch { return ''; } })()`;

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
  const page = '/liyutang/chatroom/';

  /* 先做一次"正常登录"的底：令牌进 localStorage、身份进缓存 */
  await cdp.go(`${base}${page}`);
  await cdp.ev(`localStorage.setItem('lt_token','good-token'); localStorage.removeItem('lt_user');`);
  await cdp.go(`${base}${page}`);
  await sleep(1500);
  const okState = await cdp.ev(stateOf);
  check('正常情况：登录状态读得出来（approved）', okState.state === 'approved', JSON.stringify(okState));
  check('正常情况会缓存一份身份（供刷新时先画）', (await cdp.ev(cacheOf)).includes('虹星'), String(await cdp.ev(cacheOf)).slice(0, 60));

  /* ---- 场景 A：服务器临时出问题（就是群友那次）---- */
  await fetch(`${base}/__mode?m=slow`);
  await cdp.go(`${base}${page}`);
  await sleep(7000); // 三次重试跑完（1.5s + 3s）
  const slowState = await cdp.ev(stateOf);
  const slowTok = await cdp.ev(tokenOf);
  info('临时失败时页面：' + JSON.stringify(slowState.text));
  check('★★ 服务器临时出问题 → 令牌**还在**（不再被当成过期删掉）', slowTok === 'good-token', `token=${slowTok || '(空)'}`);
  check('★ 临时失败时不说"过期"（说的是连不上/稍后重试）',
    /连不上|稍后|重试/.test(slowState.text) && !/过期/.test(slowState.text), slowState.text.slice(0, 60));
  check('★ 身份按缓存显示：还是 approved（头像名字都在，不是"未登录"）', slowState.state === 'approved', slowState.state);

  /* ---- 场景 B：服务器恢复 → 不刷新页面也应该自己变回来 ---- */
  await fetch(`${base}/__mode?m=ok`);
  await sleep(9000); // 等那句"过一会儿自己再试"
  const healed = await cdp.ev(stateOf);
  const hits = await (await fetch(`${base}/__hits`)).json();
  check('★★ 服务器恢复之后**不用刷新页面**就自己变回登录态', healed.state === 'approved' && hits.hits >= 1, `state=${healed.state} · 又问了一次（${hits.hits} 次）`);

  /* ---- 场景 C：刷新页面（有缓存 + 服务器临时失败）→ 观感上不该"掉登录" ---- */
  await fetch(`${base}/__mode?m=slow`);
  await cdp.send('Page.reload');
  await sleep(2500); // 只等一会儿：这时候重试还没跑完
  const midReload = await cdp.ev(stateOf);
  check('★★ 刷新之后立刻就是登录态（用缓存先画，不闪"未登录"）', midReload.state === 'approved', JSON.stringify(midReload.state));
  await sleep(6000);
  check('刷新 + 临时失败之后令牌依旧在', (await cdp.ev(tokenOf)) === 'good-token', '');

  /* ---- 场景 D：令牌真的无效（401）→ 这时才该掉登录 ---- */
  await fetch(`${base}/__mode?m=auth`);
  await cdp.go(`${base}${page}`);
  await sleep(1200);
  const authState = await cdp.ev(stateOf);
  check('★ 后端明确 401 → 清令牌、提示重新登录（这才是真过期）',
    (await cdp.ev(tokenOf)) === '' && authState.state === 'guest' && /过期|重新登录/.test(authState.text),
    JSON.stringify({ token: await cdp.ev(tokenOf), state: authState.state, text: authState.text.slice(0, 50) }));
  check('401 之后身份缓存也清了（不会留着上一个身份的残影）', (await cdp.ev(cacheOf)) === '', '');

  /* ---- 场景 E：整个断网 ---- */
  await fetch(`${base}/__mode?m=ok`);
  await cdp.ev(`localStorage.setItem('lt_token','good-token')`);
  await cdp.go(`${base}${page}`);
  await sleep(1200);
  await fetch(`${base}/__mode?m=down`);
  await cdp.send('Page.reload');
  await sleep(7000);
  check('★ 断网（请求直接失败）→ 令牌也留着', (await cdp.ev(tokenOf)) === 'good-token', `token=${(await cdp.ev(tokenOf)) || '(空)'}`);

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
