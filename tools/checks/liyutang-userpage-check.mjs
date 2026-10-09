/*
 * ============================================================================
 * 黎语堂「常驻栏 + 用户页」的验收（2026-10-09 晚上）
 * ----------------------------------------------------------------------------
 * 用户这一轮点名要的东西，一条一条对着验：
 *   ① 三条黎语堂页面（/liyutang/、/chatroom/、/teahouse/）顶上都有常驻栏，而且是 sticky；
 *   ② 左边 logo + 「花涧堂」点回主站首页（href = /），而且**只有一处**徽记（原来那颗固定定位的没了）；
 *   ③ 没登录时右边是登录入口；登录之后右边是昵称 + 头像；
 *   ④ 点右边进用户页：本人有编辑区、改完昵称页面上立刻变；换一个 id 看别人 → 编辑控件数 = 0；
 *   ⑤ 改完昵称，别的地方显示新昵称（聊天室页那一行 + 画板页那一行 + 常驻栏）；
 *   ⑥ code 401 与 code 1000 的行为差别（401 才删令牌、才当未登录）；
 *   ⑦ 窄屏 390×780 不横向溢出，而且名字收起来只留头像；
 *   ⑧ 没有未捕获的 JS 异常、没有 404 / 加载失败。
 *
 * 后端（tools/liyutang-backend/index.js）还没部署，所以这里自己起一个**假云函数**：
 * 本地 http 服务器接管 `/__lt`，把构建产物 HTML 里那个真地址整体替换掉 ——
 * 做法照 tools/checks/liyutang-chat-check.mjs / liyutang-draw-check.mjs。
 * 静态服务器用 `listen(0)` 随机端口（固定端口以前撞过）。
 *
 * 用法：node tools/checks/liyutang-userpage-check.mjs [dist目录]
 * ============================================================================
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, execSync } from 'node:child_process';

const SRC = String.raw`D:\曼沫砾总线\Chenxu-MarshEco.github.io`;
const ROOT = path.resolve(
  process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(SRC, 'dist')
);
/*
  ⚠ 调试口**不写死**（别的验收脚本写的是 9399 / 9403 / 9371）：两个脚本同时跑的时候，
  后来那个 Chrome 抢不到端口还是其次 —— 要命的是两边都去问 `/json/list`，
  抢输的那个会连上**别人的浏览器**，然后整场都在跟另一个页面说话。
  这里让 Chrome 自己挑（`--remote-debugging-port=0`），端口从 DevToolsActivePort 里读回来。
*/
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const SHOTS = path.join(SRC, '.tmp', 'shots');
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

console.log('=== ① 静态：该有的东西在不在一起 ===');
const bar = read('src/components/LiyutangTopBar.astro');
const layout = read('src/layouts/ForumLayout.astro');
const page = read('src/pages/liyutang/u/index.astro');
check('常驻栏组件在（LiyutangTopBar.astro）', bar.length > 1000, `${Math.round(bar.length / 1024)}KB`);
check('ForumLayout 把它挂上了（黎语堂每一页都走这个壳）', /<LiyutangTopBar\s*\/>/.test(layout));
check(
  '★ 常驻栏是 sticky，不是 fixed（fixed 不占文档流，正文会被压在底下）',
  /position:\s*sticky/.test(bar)
);
check('★ 左边徽记沿用 `.forum__brand` 这个名字（老的 announce 验收认它）',
  /class="forum__brand ltbar__brand"/.test(bar));
check('★ 徽记和主站用同一张图 / 同一档宽度', /\/img\/home\/logo\.png/.test(bar) && /clamp\(30px, 3\.2vw, 38px\)/.test(bar));
check('★ 右边显示的是 alias（昵称），不是 nick',
  /u\.alias \|\| u\.nick/.test(bar) && !/\$\{u\.nick\}/.test(bar));
check(
  '★ 只有 401 才清令牌（别的非 0 只是"这次没成"）',
  /r\.code === 401/.test(bar) && /clearToken\(\)/.test(bar) && /paint\('retry'\)/.test(bar)
);
check('★ 窄屏 700px 名字收起来只留头像', /@media \(max-width: 700px\)/.test(bar) && /\.ltbar__name\s*\{\s*display:\s*none/.test(bar));

check('用户页在（src/pages/liyutang/u/index.astro）', page.length > 2000, `${Math.round(page.length / 1024)}KB`);
check('用户页自己调 LT_ME / LT_USER_GET（不带 id = 看自己）',
  /'LT_ME'/.test(page) && /'LT_USER_GET'/.test(page) && /if \(!wantId && !token\)/.test(page));
check('★ 改昵称走 LT_PROFILE_SET、换头像走 LT_AVATAR_SET + compressImage',
  /'LT_PROFILE_SET'/.test(page) && /'LT_AVATAR_SET'/.test(page) && /compressImage\(picked/.test(page));
check('★ 用户页也只在 401 才清令牌',
  /r\.code === 401/.test(page) && /clearToken\(\)/.test(page) && /trouble\(/.test(page));
/*
  编辑区是脚本现建的：**构建产物里一个静态的编辑框都不该有** ——
  有的话"看别人"那一趟就得靠 display:none 藏，而用户要的是"压根不出现"。
  这里直接查 dist 里那一页的 HTML。
*/
const distUserPage = path.join(ROOT, 'liyutang', 'u', 'index.html');
const distUserHtml = fs.existsSync(distUserPage) ? fs.readFileSync(distUserPage, 'utf8') : '';
check('★ 编辑区在构建产物里是"0 个静态节点"（脚本现建，看别人时压根不出现）',
  distUserHtml.length > 0 && /data-lt-user-edit-host/.test(distUserHtml) && !/data-lt-user-edit=/.test(distUserHtml) && /ltUserEdit = ''/.test(page),
  `${Math.round(distUserHtml.length / 1024)}KB`);
/*
  2026-10-09 改（原来这两条盯的是页面里**写死**的那两句文案）：
  用户要求「把你自己生造的提示和简介全部删掉，给对应的位置留下编辑器接口」——
   · 「用户名 / 昵称的区别」那段 → 搬进 `src/data/liyutang.json` 的 `copy.user.lead`（留空就不渲染）；
   · 「以后会长在这里」那块占位说明（里面写着 background 字段 / authorId / src/data/draw
     这些内部术语）→ 整块从页面上删掉，TODO 留在代码注释里。
  所以断言也跟着改成"新设计"的：源码里**不许**再有那句写死的解释，读的是 copy；
  浏览器那两条改成"跟着 copy 走 / 占位块不存在"。条数不变（这个脚本一共 100 条）。
*/
const copyUserLead = (() => {
  try {
    return String(JSON.parse(read('src/data/liyutang.json'))?.copy?.user?.lead ?? '').trim();
  } catch {
    return '';
  }
})();
check(
  '★ 用户名 / 昵称那段说明搬进了 copy.user.lead（源码里不再写死那句话，空则不渲染）',
  /copy\(\)/.test(page) && /c\.user\.lead/.test(page) && /c\.user\.lead &&/.test(page)
    /* 判"页面上没有"要在**剥掉注释**的源码上判：那段历史（为什么删）本来就要写在注释里 */
    && !/不能改/.test(page.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' '))
);
check(
  '★ 用户页上不再有「以后会长在这里」那块占位说明（内部术语不上页面；TODO 留在代码注释里）',
  !/data-lt-user-later/.test(page.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' '))
    && /TODO/.test(page) && /background 字段/.test(page)
);

/* 显示名的口径：哪些地方还在用 nick 显示（这一段只打印，不断言 —— 有一半在别人正在改的文件里） */
const nickSpots = [];
for (const rel of [
  'src/utils/liyutang-client.ts',
  'src/utils/liyutang-draw.ts',
  'src/utils/liyutang-strokes.mjs',
  'src/pages/liyutang/chatroom/[day].astro',
  'src/pages/liyutang/teahouse/[day].astro',
]) {
  const text = read(rel);
  const hits = [];
  text.split('\n').forEach((line, i) => {
    if (/\b(nick|authorNick)\b/.test(line) && /(append|textContent|title|publicMsg|authorNick:|\$\{|el\()/.test(line)) {
      hits.push(`${i + 1}`);
    }
  });
  if (hits.length) nickSpots.push(`${rel}:${hits.join(',')}`);
}
info('还在拿 nick 当显示名的地方（这一轮不该我改的，见报告）：');
for (const s of nickSpots) info('  ' + s);

/* ============================================================ ② 假云函数 */

const liveApi = (() => {
  try {
    return JSON.parse(read('src/data/liyutang.json')).forum?.twikoo?.envId ?? '';
  } catch {
    return '';
  }
})();

/** 造一张真 PNG（Node 自带 zlib）当上传用的头像 —— 不用手抄 base64，那张 1×1 的图能不能解码不敢赌 */
const crc32 = (buf) => {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
};
const pngChunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const makePng = (size, [r, g, b]) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; /* 位深 */
  ihdr[9] = 2; /* 真彩色 RGB */
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y += 1) {
    const off = y * (size * 3 + 1);
    raw[off] = 0; /* filter: none */
    for (let x = 0; x < size; x += 1) {
      raw[off + 1 + x * 3] = r;
      raw[off + 2 + x * 3] = g;
      raw[off + 3 + x * 3] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};
const AVATAR_PNG = path.join(SRC, '.tmp', 'check-avatar.png');
fs.mkdirSync(path.dirname(AVATAR_PNG), { recursive: true });
fs.writeFileSync(AVATAR_PNG, makePng(32, [255, 120, 190]));

/* 假后端的状态：mode 让某一种事件"这次没成 / 令牌过期"，用来验错误码那一条 */
const T0 = Date.now() - 3 * 24 * 3600 * 1000;
const OLD_AVATAR =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF/9UeIAAAAAElFTkSuQmCC';
const state = {
  mode: { me: 'ok', userGet: 'ok', profile: 'ok' },
  me: {
    nick: 'hoshi',
    alias: '星野',
    mail: 'hoshi@example.com',
    status: 'approved',
    label: '',
    avatar: OLD_AVATAR,
    createdAt: T0,
  },
  other: { nick: 'arcarlight', alias: '弧光', status: 'approved', avatar: '', createdAt: T0 - 86400000 },
  aliasSets: [],
  avatarSets: [],
  events: [],
  chatLists: 0,
};
/* 假后端真的把新昵称存下来 —— 后面别的页面才可能显示"新昵称" */
const meUser = () => ({ ...state.me });

const fakeBackend = (body) => {
  const event = String(body?.event || '');
  state.events.push(event);
  if (event === 'LT_ME') {
    if (state.mode.me === 'expired') return { code: 401, message: '登录状态过期了' };
    if (state.mode.me === 'trouble') return { code: 1000, message: '服务器看到一半走神了' };
    return { code: 0, user: meUser(), posts: 3 };
  }
  if (event === 'LT_USER_GET') {
    if (state.mode.userGet === 'trouble') return { code: 1000, message: '服务器看到一半走神了' };
    const id = String(body?.id || '');
    if (id === 'u-me') return { code: 0, user: meUser(), me: true, posts: 3 };
    if (id === 'u-other') {
      /* 看别人：后端把 mail 摘掉了，这里也照做 */
      return { code: 0, user: { ...state.other }, me: false, posts: 5 };
    }
    return { code: 1000, message: '没有这个人' };
  }
  if (event === 'LT_PROFILE_SET') {
    if (state.mode.profile === 'expired') return { code: 401, message: '请先登录' };
    if (state.mode.profile === 'trouble') return { code: 1000, message: '这次没存上' };
    state.aliasSets.push(String(body?.alias ?? ''));
    state.me.alias = String(body?.alias ?? '');
    return { code: 0, user: meUser() };
  }
  if (event === 'LT_AVATAR_SET') {
    state.avatarSets.push(String(body?.avatar ?? ''));
    state.me.avatar = String(body?.avatar ?? '');
    return { code: 0, avatar: state.me.avatar };
  }
  /* 聊天室 / 画板那两页会顺手发起这些：给个成功的样子，而且**照当前后端的契约发 alias** */
  if (event === 'LT_CHAT_LIST') {
    state.chatLists += 1;
    return {
      code: 0,
      day: '2026-10-09',
      today: '2026-10-09',
      serverNow: Date.now(),
      messages: [
        {
          id: 'm1',
          day: '2026-10-09',
          /* 后端现在两个都发：nick（用户名，登录用）+ alias（昵称，显示用），页面认 alias */
          nick: state.me.nick,
          alias: state.me.alias,
          avatar: state.me.avatar,
          text: '（假后端的一条历史消息）',
          image: '',
          createdAt: Date.now() - 60000,
          mine: true,
        },
      ],
    };
  }
  if (event === 'LT_DRAW_LIST') {
    /*
      一根"我画的"笔划：nick 是用户名、alias 是昵称（后端 publicStroke 两个都发）。
      画板那边的"今天画过画的人"那张表现在读的是哪一个 —— 见下面那条记一笔。
    */
    return {
      code: 0,
      day: '2026-10-09',
      today: '2026-10-09',
      serverNow: Date.now(),
      more: false,
      strokes: [
        {
          id: 's1',
          uk: 'aaaa1111',
          nick: state.me.nick,
          alias: state.me.alias,
          avatar: state.me.avatar,
          tool: 'pen',
          color: '#1d1430',
          size: 6,
          points: [[10, 10], [20, 20]],
          createdAt: Date.now() - 30000,
          updatedAt: Date.now() - 30000,
          mine: true,
        },
      ],
    };
  }
  if (event === 'LT_PREFS_SET') return { code: 0, prefs: {} };
  return { code: 0 };
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
};
const notFound = [];
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
        /* 空请求体 */
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
      /* 真云函数地址 → 本地假后端（只在 HTML 里，页面是从 data-api 上读的） */
      if (ext === '.html' && liveApi) {
        buf = Buffer.from(buf.toString('utf8').split(liveApi).join(`http://127.0.0.1:${server.address().port}/__lt`), 'utf8');
      }
      res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
      return res.end(buf);
    }
  }
  notFound.push(url.pathname);
  res.writeHead(404);
  return res.end('404');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;

/* ============================================================ ③ 真浏览器 */

console.log('\n=== ② 真浏览器：假云函数 + 真构建产物 ===');
const profile = path.join(process.env.TEMP ?? '.', `dsh-lytuser-${Date.now()}`);
/*
  `--remote-debugging-port=0` = 让 Chrome 自己挑一个空闲端口，然后把真实端口写进
  `<user-data-dir>/DevToolsActivePort`（第一行）。原来写死 9417 有个真实的坑：
  同一台机器上别人也在跑验收脚本时，两个 Chrome 会抢调试口 ——
  抢输的那个"连上的是别人的浏览器"，后面每一步都在跟另一个页面说话（2026-10-09 踩到）。
*/
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--no-sandbox',
    '--mute-audio',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
    '--disable-breakpad',
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    'about:blank',
  ],
  { stdio: 'ignore' }
);
/*
  整体兜底：以前没有这一条，页面那边一卡（比如别人正在改画板、渲染进程死在死循环里），
  一次 Runtime.evaluate 就永远不回，脚本就吊在那里 —— 加个 10 分钟的硬闸门。
*/
const watchdog = setTimeout(() => {
  console.log('FAIL  整体超时（10 分钟）—— 页面那边多半卡住了');
  try {
    execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' });
  } catch {
    /* 已经退了 */
  }
  process.exit(1);
}, 10 * 60 * 1000);

/** 等 Chrome 把调试端口写出来（它的格式就一行端口 + 一行 ws 路径） */
const dbgPort = await (async () => {
  const f = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100; i += 1) {
    if (fs.existsSync(f)) {
      const n = Number(fs.readFileSync(f, 'utf8').split('\n')[0].trim());
      if (n) return n;
    }
    await sleep(200);
  }
  return 0;
})();
info(`Chrome 的调试口：${dbgPort || '（没等到 DevToolsActivePort）'}`);

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    this.bad = [];
    this.failed = [];
    /* 连接断了就把还挂着的那些请求全部拒掉 —— 不然它们会永远等着一个不会来的回复 */
    ws.addEventListener('close', () => {
      for (const p of this.pending.values()) p.reject(new Error('调试连接断了'));
      this.pending.clear();
    });
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
      /*
        异常要记详细一点：`exceptionDetails.text` 永远只有一句"Uncaught"，
        真正的原因在 exception.description 里（第一行就是报错文案）。
      */
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails || {};
        const desc = String(d.exception?.description || d.exception?.value || '').split('\n')[0];
        this.errors.push(
          `[throw] ${d.text}${desc ? ` ${desc}` : ''} @ ${d.url || '?'}:${d.lineNumber ?? '?'}`
        );
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.errors.push(
          '[console] ' + m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 160)
        );
      }
      /* 404 / 5xx */
      if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
        this.bad.push(`${m.params.response.status} ${m.params.response.url}`);
      }
      /* 加载失败（自己取消的不算：导航换页时很常见） */
      if (m.method === 'Network.loadingFailed' && !m.params.canceled) {
        this.failed.push(`${m.params.errorText} ${m.params.requestId}`);
      }
    });
  }
  static async attach(u) {
    const ws = new WebSocket(u);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('ws 连不上')), { once: true });
    });
    return new CDP(ws);
  }
  /*
    每条命令都带超时：页面要是卡在死循环里（渲染进程不吭声），
    没有超时的话这个 Promise 永远不落地 —— 整个脚本就吊死了（2026-10-09 晚上真吊过一次）。
  */
  send(m, p = {}, timeoutMs = 20000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${m} 超时 ${timeoutMs}ms（页面多半卡住了）`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method: m, params: p }));
    });
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
    for (let i = 0; i < 150; i += 1) {
      await sleep(100);
      try {
        if ((await this.ev('document.readyState')) === 'complete') return;
      } catch {
        /* 还在导航 */
      }
    }
  }
}

/** 常驻栏那几件事，一次问清楚 */
const BAR_STATE = `(() => {
  const bar = document.querySelector('[data-lt-topbar]');
  if (!bar) return { none: true };
  const cs = getComputedStyle(bar);
  const login = bar.querySelector('[data-lt-topbar-login]');
  const user = bar.querySelector('[data-lt-topbar-user]');
  const retry = bar.querySelector('[data-lt-topbar-retry]');
  const name = bar.querySelector('[data-lt-topbar-name]');
  const face = bar.querySelector('[data-lt-topbar-face]');
  const img = face ? face.querySelector('img') : null;
  const brand = document.querySelector('.forum__brand');
  const r = bar.getBoundingClientRect();
  return {
    position: cs.position,
    zIndex: cs.zIndex,
    top: Math.round(r.top),
    brandCount: document.querySelectorAll('.forum__brand').length,
    brandHref: brand ? brand.getAttribute('href') : null,
    /* 老那条 announce 验收量的是"徽记贴在左上角"（top / left 都 < 60），这里也量一遍 */
    brandTop: brand ? Math.round(brand.getBoundingClientRect().top) : -1,
    brandLeft: brand ? Math.round(brand.getBoundingClientRect().left) : -1,
    brandText: brand ? (brand.textContent || '').trim() : '',
    brandImg: brand && brand.querySelector('img') ? brand.querySelector('img').getAttribute('src') : '',
    loginShown: !!login && !login.hidden && getComputedStyle(login).display !== 'none',
    loginHref: login ? login.getAttribute('href') : null,
    userShown: !!user && !user.hidden && getComputedStyle(user).display !== 'none',
    userHref: user ? user.getAttribute('href') : null,
    retryShown: !!retry && !retry.hidden && getComputedStyle(retry).display !== 'none',
    name: name ? (name.textContent || '').trim() : '',
    nameDisplay: name ? getComputedStyle(name).display : '',
    faceDisplay: face ? getComputedStyle(face).display : '',
    faceSrc: img ? img.getAttribute('src') : '',
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
})()`;

/** 用户页那几件事 */
const PAGE_STATE = `(() => {
  const p = document.querySelector('[data-lt-user-page]');
  if (!p) return { none: true };
  const q = (s) => p.querySelector(s);
  const t = (s) => (q(s) ? (q(s).textContent || '').trim() : null);
  const card = q('[data-lt-user-card]');
  const edits = p.querySelectorAll('[data-lt-user-edit]');
  const inputs = p.querySelectorAll('[data-lt-user-edit] input');
  const btns = p.querySelectorAll('[data-lt-user-edit] button');
  return {
    head: t('[data-lt-user-head]'),
    msg: t('[data-lt-user-msg]'),
    cardShown: !!card && !card.hidden,
    alias: t('[data-lt-user-alias]'),
    at: t('[data-lt-user-at]'),
    nick: t('[data-lt-user-nick]'),
    alias2: t('[data-lt-user-alias2]'),
    since: t('[data-lt-user-since]'),
    posts: t('[data-lt-user-posts]'),
    faceSrc: q('[data-lt-user-face] img') ? q('[data-lt-user-face] img').getAttribute('src') : '',
    editCount: edits.length,
    inputCount: inputs.length,
    buttonCount: btns.length,
    fileInputs: p.querySelectorAll('[data-lt-user-avatar-file]').length,
    laterShown: !!q('[data-lt-user-later]'),
    retry: [...p.querySelectorAll('.ltuser__cta')].map((n) => (n.textContent || '').trim()),
    token: (() => { try { return localStorage.getItem('lt_token') || ''; } catch { return ''; } })(),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
})()`;

let scrollTested = 0;
try {
  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {
      /* 等 Chrome 起来 */
    }
  }
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  const shot = async (name) => {
    try {
      const s = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.mkdirSync(SHOTS, { recursive: true });
      fs.writeFileSync(path.join(SHOTS, name), Buffer.from(s.data, 'base64'));
    } catch {
      /* 截不到不影响验收 */
    }
  };
  /** 页面加载完 + 常驻栏画完（它一定会调一次 LT_ME，除非本来就没登录） */
  const open = async (p, ready = true) => {
    await cdp.go(`${BASE}${p}`);
    if (ready) await cdp.wait(`!!document.querySelector('[data-lt-topbar]')`);
    await sleep(350);
  };

  /* ---------------- ① 三条页面上的常驻栏 ---------------- */
  console.log('\n=== ② -1 三条黎语堂页面：栏在不在、粘不粘 ===');
  const pages = ['/liyutang/', '/liyutang/chatroom/', '/liyutang/teahouse/'];
  const bars = {};
  for (const p of pages) {
    await open(p);
    const b = await cdp.ev(BAR_STATE);
    bars[p] = b;
    info(`${p} → ${JSON.stringify({ position: b.position, top: b.top, brand: b.brandHref, overflow: b.overflow })}`);
    check(`${p} 顶上有常驻栏`, !b.none, JSON.stringify(b).slice(0, 80));
    check(`${p} 的栏是 sticky`, b.position === 'sticky', b.position);
    check(`${p} 只有一处徽记（原来那颗固定定位的没了）`, b.brandCount === 1, String(b.brandCount));
    check(`${p} 左边是 logo + 「花涧堂」、点它回主站首页`, b.brandHref === '/' && /花涧堂/.test(b.brandText) && /logo/.test(b.brandImg),
      `${b.brandHref} / ${b.brandText} / ${b.brandImg}`);
    check(`${p} 徽记还贴在左上角（老那条 announce 验收量的就是 top / left < 60）`,
      b.brandTop >= 0 && b.brandTop < 60 && b.brandLeft >= 0 && b.brandLeft < 60, `top ${b.brandTop} / left ${b.brandLeft}`);
    /*
      真滚一下：栏得还贴在顶上（position: sticky 光看 computed 不够 —— 祖先 overflow 一挡就不粘了）。
      页面不够长（滚不动）的不硬凑，记一笔；至少要有一页滚得动。
    */
    const canScroll = await cdp.ev('document.documentElement.scrollHeight - window.innerHeight > 60');
    if (canScroll) {
      await cdp.ev('window.scrollTo(0, 500)');
      await sleep(250);
      const after = await cdp.ev(BAR_STATE);
      check(`${p} 往下滚 500px 之后栏还贴在顶上（真粘住了）`, after.top === 0, `top ${after.top}`);
      await cdp.ev('window.scrollTo(0, 0)');
      await sleep(150);
      scrollTested += 1;
    } else {
      info(`${p} 一屏就装下了，滚不动 —— 这一页只验 computed 的 sticky`);
    }
  }
  check('至少有一页真滚过（不是全靠 computed 判断）', scrollTested > 0, `${scrollTested} 页`);

  /* 未登录的右边：登录入口 */
  const guestBar = bars['/liyutang/'];
  check('★ 没登录时右边是「登录」入口', guestBar.loginShown === true && guestBar.userShown === false, JSON.stringify({ login: guestBar.loginShown, user: guestBar.userShown }));
  check('登录入口指向黎语堂首页（账号区就在那一页）', guestBar.loginHref === '/liyutang/', String(guestBar.loginHref));
  check('没登录时没有用户那块（没有昵称、没有头像）', guestBar.name === '' && guestBar.faceSrc === '', JSON.stringify({ name: guestBar.name, face: guestBar.faceSrc }));

  /* ---------------- ② 登录之后：昵称 + 头像 ---------------- */
  console.log('\n=== ② -2 登录（假后端给 approved 用户）之后的右边 ===');
  await cdp.ev(`localStorage.setItem('lt_token', 'fake-token')`);
  await open('/liyutang/chatroom/');
  await cdp.wait(`(() => { const b = document.querySelector('[data-lt-topbar]'); return !!b && !b.querySelector('[data-lt-topbar-user]').hidden; })()`);
  const logged = await cdp.ev(BAR_STATE);
  info('登录后的栏：' + JSON.stringify({ user: logged.userShown, name: logged.name, face: logged.faceSrc.slice(0, 30), href: logged.userHref }));
  check('★ 登录之后右边显示**昵称**（假后端里 nick=hoshi / alias=星野 → 显示的必须是星野）',
    logged.userShown === true && logged.name === '星野', `${logged.name}`);
  check('★ 右边有头像（假后端那张 data URL 真塞进 <img> 了）', logged.faceSrc.startsWith('data:image/'), logged.faceSrc.slice(0, 40));
  check('登录之后「登录」入口就收起来了', logged.loginShown === false);
  check('常驻栏上写的是最近那个假后端的调用（LT_ME）', state.events.includes('LT_ME'));

  /* ---------------- ③ 点右边 → 用户页（自己） ---------------- */
  console.log('\n=== ② -3 点右边进用户页（自己） ===');
  await cdp.ev(`document.querySelector('[data-lt-topbar-user]').click()`);
  await cdp.wait(`!!document.querySelector('[data-lt-user-page]')`);
  await cdp.wait(`(() => { const c = document.querySelector('[data-lt-user-card]'); return !!c && !c.hidden; })()`);
  const selfUrl = await cdp.ev('location.pathname + location.search');
  info('点完之后落到：' + selfUrl);
  const self0 = await cdp.ev(PAGE_STATE);
  info('自己的资料页：' + JSON.stringify({ alias: self0.alias, at: self0.at, nick: self0.nick, since: self0.since, posts: self0.posts, edit: self0.editCount }));
  check('★ 点右边 → 进了用户页 /liyutang/u/', String(selfUrl).startsWith('/liyutang/u/'), String(selfUrl));
  /*
    ⚠ LT_ME 现在不发 id（publicUser 里没有 id 字段），所以自己这一颗只能落到"不带参数 = 看自己"。
    带 id 的那种形状（?id=…）在这一段后面单独验（/liyutang/u/?id=u-me）。
  */
  check('本人这一趟是不带参数的（不带 = 看自己；后端还没在 LT_ME 里发 id）', !String(selfUrl).includes('id='), String(selfUrl));
  check('★ 本人有编辑区（恰好一块）', self0.editCount === 1, String(self0.editCount));
  check('编辑区里有换头像的文件框 + 昵称输入框', self0.fileInputs === 1 && self0.inputCount >= 1, JSON.stringify({ file: self0.fileInputs, input: self0.inputCount }));
  check('用户名（@hoshi）和昵称（星野）**分开显示**', self0.nick === 'hoshi' && self0.alias === '星野' && self0.at === '@hoshi',
    JSON.stringify({ nick: self0.nick, alias: self0.alias, at: self0.at }));
  /*
    这段说明现在**跟着数据走**：`copy.user.lead` 填了就显示、空着就压根没这个节点。
    所以断言也照数据判（写死"一定有 / 一定没有"会在站长填上文案那天变红）。
  */
  const ruleText = String(await cdp.ev(`(document.querySelector('[data-lt-user-rule]')||{}).textContent||''`)).trim();
  const ruleMissing = (await cdp.ev(`document.querySelector('[data-lt-user-rule]') === null`)) === true;
  check(
    '★ 用户页那段说明跟着 copy.user.lead 走：填了才出现、空着就没有（代码里不再写死）',
    copyUserLead ? ruleText.includes(copyUserLead) : ruleText === '' && ruleMissing,
    copyUserLead ? `数据里填了「${copyUserLead.slice(0, 20)}…」· 页面「${ruleText.slice(0, 20)}…」` : '数据里是空的 → 节点不存在'
  );
  check('注册时间 / 发过几篇都在', /^\d{4}-\d{2}-\d{2}$/.test(String(self0.since)) && self0.posts === '3 篇', `${self0.since} / ${self0.posts}`);
  check('★ 用户页不再摆「以后会长在这里」的占位说明（要显示就直接显示真数据）',
    self0.laterShown === false && (await cdp.ev(`document.querySelectorAll('[data-lt-user-later] li').length`)) === 0);
  await shot('liyutang-user-self.png');

  /* ---------------- ④ 改昵称：页面上立刻变 ---------------- */
  console.log('\n=== ② -4 改昵称（LT_PROFILE_SET） ===');
  const NEW_ALIAS = '星野改名了';
  await cdp.ev(`(() => {
    const i = document.querySelector('[data-lt-user-edit] .ltuser__input');
    i.value = ${JSON.stringify(NEW_ALIAS)};
    i.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('[data-lt-user-edit] button')].find((b) => b.textContent.includes('保存昵称')).click();
    return true;
  })()`);
  const renamed = await cdp.wait(`(document.querySelector('[data-lt-user-alias]')||{}).textContent === ${JSON.stringify(NEW_ALIAS)}`);
  const self1 = await cdp.ev(PAGE_STATE);
  const bar1 = await cdp.ev(BAR_STATE);
  info('改完之后：' + JSON.stringify({ alias: self1.alias, alias2: self1.alias2, nick: self1.nick, msg: self1.msg, barName: bar1.name }));
  check('★ 改完昵称，页面上立刻显示新值（没刷新、没重新请求）', renamed === true && self1.alias === NEW_ALIAS, self1.alias);
  check('资料卡里那一行「昵称」也跟着变了', self1.alias2 === NEW_ALIAS, String(self1.alias2));
  check('「用户名」还是 hoshi —— 昵称改了不影响登录名', self1.nick === 'hoshi' && self1.at === '@hoshi', `${self1.nick} / ${self1.at}`);
  check('★ 同一页的常驻栏也跟着换成新昵称了', bar1.name === NEW_ALIAS, bar1.name);
  check('发上去的请求对（LT_PROFILE_SET + 令牌 + 新昵称）',
    state.aliasSets.length === 1 && state.aliasSets[0] === NEW_ALIAS, JSON.stringify(state.aliasSets));
  check('页面说了句"改好了"', /改好了/.test(String(self1.msg)), String(self1.msg));

  /* ---------------- ⑤ 换头像：真文件 → compressImage → LT_AVATAR_SET ---------------- */
  console.log('\n=== ② -5 换头像（真 PNG 走一遍压缩） ===');
  const fileNode = await cdp.send('DOM.querySelector', {
    nodeId: (await cdp.send('DOM.getDocument', { depth: 1 })).root.nodeId,
    selector: '[data-lt-user-avatar-file]',
  });
  check('编辑区里有那个文件框（喂文件要先找到它）', !!fileNode.nodeId, String(fileNode.nodeId));
  await cdp.send('DOM.setFileInputFiles', { files: [AVATAR_PNG], nodeId: fileNode.nodeId });
  /* 压图 + 上送是异步的：等假后端真的收到那一次 LT_AVATAR_SET */
  for (let i = 0; i < 60 && state.avatarSets.length === 0; i += 1) await sleep(250);
  const self2 = await cdp.ev(PAGE_STATE);
  const bar2 = await cdp.ev(BAR_STATE);
  info('上传之后：' + JSON.stringify({ sets: state.avatarSets.length, head: String(state.avatarSets[0] || '').slice(0, 34), pageFace: self2.faceSrc.slice(0, 34), barFace: bar2.faceSrc.slice(0, 34) }));
  check('★ 头像真走了 LT_AVATAR_SET（前端压完之后才发的）', state.avatarSets.length === 1, `${state.avatarSets.length} 次`);
  check('★ 发上去的是一张压过的 data URL 图片（不是原文件）',
    /^data:image\/(webp|jpeg|png);base64,/.test(String(state.avatarSets[0])) && String(state.avatarSets[0]).length < 120000,
    `${String(state.avatarSets[0]).slice(0, 24)}… ${String(state.avatarSets[0]).length} 字符`);
  check('★ 页面上的头像立刻换成新的了', self2.faceSrc === state.avatarSets[0], self2.faceSrc.slice(0, 24));
  check('★ 常驻栏那颗小头像也立刻跟着换了', bar2.faceSrc === state.avatarSets[0], bar2.faceSrc.slice(0, 24));

  /* ---------------- ⑥ 看别人：只读 ---------------- */
  console.log('\n=== ② -6 看别人（?id=…）：没有编辑控件 ===');
  await open('/liyutang/u/?id=u-other');
  await cdp.wait(`(() => { const c = document.querySelector('[data-lt-user-card]'); return !!c && !c.hidden; })()`);
  const other = await cdp.ev(PAGE_STATE);
  info('别人的资料页：' + JSON.stringify({ head: other.head, alias: other.alias, at: other.at, nick: other.nick, posts: other.posts, edit: other.editCount, inputs: other.inputCount, later: other.laterShown }));
  check('★ 看别人：编辑区元素数 = 0（不是灰着，是压根没有）', other.editCount === 0, String(other.editCount));
  check('★ 看别人：一个输入框、一个编辑按钮都没有', other.inputCount === 0 && other.buttonCount === 0, JSON.stringify({ input: other.inputCount, button: other.buttonCount }));
  check('看别人：也没有那个喂文件的框', other.fileInputs === 0, String(other.fileInputs));
  check('看别人显示的是他的昵称 + 用户名（分开显示）', other.alias === '弧光' && other.nick === 'arcarlight' && other.at === '@arcarlight',
    JSON.stringify({ alias: other.alias, nick: other.nick }));
  check('看别人的时候也说了"只能看"', /只能看/.test(String(other.msg)), String(other.msg));
  check('看别人也看得到"发过 5 篇" / 注册时间', other.posts === '5 篇' && /^\d{4}-\d{2}-\d{2}$/.test(String(other.since)), `${other.posts} / ${other.since}`);
  check('★ 看别人的时候也不再摆那三块占位说明（和本人那一趟结构一样）', other.laterShown === false);
  check('看别人时没把邮箱发过来（契约里 LT_USER_GET 摘掉 mail）',
    !/hoshi@example\.com|arc@example\.com/.test(await cdp.ev('document.body.textContent')));
  await shot('liyutang-user-other.png');

  /* 自己那种带 id 的形状也要能进编辑态（?id=u-me → me:true） */
  await open('/liyutang/u/?id=u-me');
  await cdp.wait(`document.querySelectorAll('[data-lt-user-edit]').length === 1`);
  const selfById = await cdp.ev(PAGE_STATE);
  check('★ ?id=…拿到的要是自己（后端回 me:true），编辑区照样出现', selfById.editCount === 1, String(selfById.editCount));

  /* ---------------- ⑦ 别的地方也显示新昵称 ---------------- */
  console.log('\n=== ② -7 改完昵称之后，别的页面显示的是不是新昵称 ===');
  await open('/liyutang/chatroom/');
  await cdp.wait(`/的身份在这里/.test((document.querySelector('[data-lt-chat-gate]')||{}).textContent||'')`);
  const chatGate = await cdp.ev(`(document.querySelector('[data-lt-chat-gate]')||{}).textContent||''`);
  const chatBar = await cdp.ev(BAR_STATE);
  info('聊天室页那一行：' + chatGate.trim() + ' / 栏上：' + chatBar.name);
  check('★ 聊天室页「你以 … 的身份在这里」显示的是新昵称', chatGate.includes(NEW_ALIAS) && !chatGate.includes('hoshi'), chatGate.trim());
  check('★ 聊天室页常驻栏上也是新昵称', chatBar.name === NEW_ALIAS, chatBar.name);
  /*
    消息列表里的作者名：假后端发的是「nick=hoshi + alias=新昵称」（真后端现在就是这么发的，
    见 index.js 的 publicMsg / aliasMapOf），页面认 alias —— 所以这里显示的必须是新昵称。
  */
  const msgNick = await cdp.ev(`(document.querySelector('.lyt-msg__nick')||{}).textContent||''`);
  check('★ 聊天消息里的作者名也是新昵称（nick 与 alias 同时在，页面认 alias）',
    msgNick === NEW_ALIAS, JSON.stringify(msgNick));

  await open('/liyutang/teahouse/');
  await cdp.wait(`/的身份在这块板上画/.test((document.querySelector('[data-lt-draw-gate]')||{}).textContent||'')`);
  const drawGate = await cdp.ev(`(document.querySelector('[data-lt-draw-gate]')||{}).textContent||''`);
  const drawBar = await cdp.ev(BAR_STATE);
  info('画板页那一行：' + drawGate.trim() + ' / 栏上：' + drawBar.name);
  check('★ 画板页「你以 … 的身份在这块板上画」显示的是新昵称', drawGate.includes(NEW_ALIAS) && !drawGate.includes('hoshi'), drawGate.trim());
  check('★ 画板页常驻栏上也是新昵称', drawBar.name === NEW_ALIAS, drawBar.name);
  /*
    记一笔（**没有断言**：那个文件这一轮不归我改）：画板底下「今天画过画的人」那张表。
    假后端照后端的形状发了「nick=hoshi + alias=新昵称」，量一下那张表显示的是哪个 ——
    如果显示的是 hoshi，说明显示点还在读 p.nick（liyutang-draw.ts:418/429/431）。
  */
  const faces = await cdp.ev(`[...document.querySelectorAll('.lyt-draw__face')].map((b) => b.textContent.trim())`);
  info(`（记一笔）画板「今天画过画的人」那张表现在显示：${JSON.stringify(faces)} —— 假后端发的 alias 是 ${JSON.stringify(NEW_ALIAS)}`);
  info(`（记一笔）画板引擎挂上了没有：${await cdp.ev('!!window.__ltBoard')}`);

  /* ---------------- ⑧ 401 / 1000 的区别 ---------------- */
  console.log('\n=== ② -8 code 401 与 code 1000 的行为（只有 401 才当未登录） ===');
  /* 1000：服务器那边这次没成 —— 令牌必须留着，人也不能显示成未登录 */
  state.mode.me = 'trouble';
  await open('/liyutang/u/');
  await cdp.wait(`!!document.querySelector('.ltuser__cta')`);
  const trouble = await cdp.ev(PAGE_STATE);
  const troubleBar = await cdp.ev(BAR_STATE);
  info('1000 之后：' + JSON.stringify({ token: trouble.token, login: troubleBar.loginShown, retry: troubleBar.retryShown, msg: trouble.msg }));
  check('★ code 1000：令牌**还在**（不许把人踢下线）', trouble.token === 'fake-token', String(trouble.token));
  check('★ code 1000：常驻栏没有变成「登录」入口', troubleBar.loginShown === false && troubleBar.retryShown === true,
    JSON.stringify({ login: troubleBar.loginShown, retry: troubleBar.retryShown }));
  check('★ code 1000：常驻栏给的是"读不出来 · 重试"', /重试/.test(await cdp.ev(`(document.querySelector('[data-lt-topbar-retry]')||{}).textContent||''`)));
  check('★ code 1000：用户页说明白了这次没读出来，并给重试', /这次没读出来/.test(String(trouble.msg)) && trouble.retry.includes('再试一次'),
    `${trouble.msg} / ${JSON.stringify(trouble.retry)}`);
  check('code 1000：这时候不建编辑区（连"我是谁"都还不知道）', trouble.editCount === 0, String(trouble.editCount));

  /* 服务器恢复了：点一下重试就回来了（顺带证明令牌真的还能用） */
  state.mode.me = 'ok';
  await cdp.ev(`document.querySelector('[data-lt-topbar-retry]').click()`);
  const recovered = await cdp.wait(`(() => { const b = document.querySelector('[data-lt-topbar]'); return !!b && !b.querySelector('[data-lt-topbar-user]').hidden; })()`);
  const barOk = await cdp.ev(BAR_STATE);
  check('★ 恢复之后点「重试」就回到登录状态（令牌一直有效）', recovered === true && barOk.name === NEW_ALIAS, `${recovered} / ${barOk.name}`);

  /* 401：令牌真过期 —— 这一种才删令牌、才显示成未登录 */
  state.mode.me = 'expired';
  await open('/liyutang/u/');
  await cdp.wait(`!!document.querySelector('.ltuser__cta')`);
  const expired = await cdp.ev(PAGE_STATE);
  const expiredBar = await cdp.ev(BAR_STATE);
  info('401 之后：' + JSON.stringify({ token: expired.token, login: expiredBar.loginShown, user: expiredBar.userShown, msg: expired.msg }));
  check('★ code 401：令牌被删掉了（该踢就踢）', expired.token === '', JSON.stringify(expired.token));
  check('★ code 401：常驻栏变回「登录」入口', expiredBar.loginShown === true && expiredBar.userShown === false,
    JSON.stringify({ login: expiredBar.loginShown, user: expiredBar.userShown }));
  check('★ code 401：用户页说清了是登录过期，并给去登录的路', /过期/.test(String(expired.msg)) && expired.retry.includes('去黎语堂首页登录'),
    `${expired.msg} / ${JSON.stringify(expired.retry)}`);
  state.mode.me = 'ok';

  /* 改昵称那一路上也要守同一条规矩 */
  console.log('--- 改昵称失败时的 401 / 1000 ---');
  await cdp.ev(`localStorage.setItem('lt_token', 'fake-token')`);
  await open('/liyutang/u/');
  await cdp.wait(`document.querySelectorAll('[data-lt-user-edit]').length === 1`);
  state.mode.profile = 'trouble';
  const clickSave = `(() => {
    const i = document.querySelector('[data-lt-user-edit] .ltuser__input');
    i.value = '存不上的名字';
    [...document.querySelectorAll('[data-lt-user-edit] button')].find((b) => b.textContent.includes('保存昵称')).click();
    return true;
  })()`;
  await cdp.ev(clickSave);
  const badSave = await cdp.wait(`/没改成/.test((document.querySelector('[data-lt-user-msg]')||{}).textContent||'')`);
  const afterBad = await cdp.ev(PAGE_STATE);
  check('★ 改昵称遇到 1000：报错、但令牌还在、编辑区还在', badSave === true && afterBad.token === 'fake-token' && afterBad.editCount === 1,
    JSON.stringify({ token: afterBad.token, edit: afterBad.editCount, msg: afterBad.msg }));
  state.mode.profile = 'expired';
  await cdp.ev(clickSave);
  const cleared = await cdp.wait(`localStorage.getItem('lt_token') === null`);
  const afterExpired = await cdp.ev(PAGE_STATE);
  const afterExpiredBar = await cdp.ev(BAR_STATE);
  check('★ 改昵称遇到 401：删令牌 + 页面和常驻栏都变回未登录',
    cleared === true && afterExpired.editCount === 0 && afterExpiredBar.loginShown === true && afterExpired.retry.includes('去黎语堂首页登录'),
    JSON.stringify({ token: afterExpired.token, edit: afterExpired.editCount, login: afterExpiredBar.loginShown }));
  state.mode.profile = 'ok';

  /* ---------------- ⑨ 窄屏 390×780 ---------------- */
  console.log('\n=== ② -9 窄屏 390×780：不许横向溢出，名字收起来 ===');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: false });
  await cdp.ev(`localStorage.setItem('lt_token', 'fake-token')`);
  for (const p of ['/liyutang/', '/liyutang/chatroom/', '/liyutang/teahouse/', '/liyutang/u/', '/liyutang/u/?id=u-other']) {
    await open(p);
    const b = await cdp.ev(BAR_STATE);
    const st = await cdp.ev(PAGE_STATE);
    const overflow = b.none ? st.overflow : b.overflow;
    info(`${p} → overflow=${overflow}px, 名字 display=${b.nameDisplay || '-'}, 头像 display=${b.faceDisplay || '-'}`);
    check(`${p} 窄屏不横向溢出（scrollWidth - innerWidth ≤ 1）`, overflow <= 1, `${overflow}px`);
    if (!b.none && b.userShown) {
      check(`${p} 窄屏只留头像（名字收起来了）`, b.nameDisplay === 'none' && b.faceDisplay !== 'none', `${b.nameDisplay} / ${b.faceDisplay}`);
    }
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await open('/liyutang/');
  await shot('liyutang-topbar-home.png');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: false });
  await open('/liyutang/');
  await shot('liyutang-topbar-narrow.png');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  /* ---------------- ⑩ 异常 / 404 ---------------- */
  console.log('\n=== ② -10 没异常、没 404 ===');
  /*
    ⚠ 这一条单独列出来，是因为它 2026-10-09 18:56 那次真的是红的，而**不在这两件东西这一摊里**：

      src/utils/liyutang-draw.ts:725   if (opts.reset) on(opts.reset, 'click', resetView);
      src/utils/liyutang-draw.ts:929   const resetView = () => { … };

    同一个函数体（mountBoard）里"先用后声明"，`const` 的 TDZ —— 过审用户一进画板页就抛
    `ReferenceError: Cannot access 'resetView' before initialization`，mountBoard 半路断掉，
    画板压根挂不上（那时量到的 `window.__ltBoard` 是 false，19:04 再看已经是 true：
    画板那边把声明挪到前面之后就好了）。

    画板和 teahouse 页的脚本打进同一个 bundle，所以它一抛就会算到"这一页"头上。
    这里留着这条，是因为这一页的"没有未捕获异常"必须真干净 —— 不能拿别人的错遮掉自己的。
  */
  const drawErrors = cdp.errors.filter((e) => /teahouse\.astro_astro_type_script/.test(e));
  const myErrors = cdp.errors.filter((e) => !/teahouse\.astro_astro_type_script/.test(e));
  check('★ 常驻栏 / 用户页这几处没有未捕获异常', myErrors.length === 0, myErrors.slice(0, 3).join(' | '));
  check('★ 画板页那份脚本也没有未捕获异常（它和常驻栏共用 bundle，一出事就牵连这一页）',
    drawErrors.length === 0, `${drawErrors.length} 次：${drawErrors[0] ?? ''}`);
  check('没有 4xx / 5xx 响应', cdp.bad.length === 0, cdp.bad.slice(0, 3).join(' | '));
  check('没有加载失败（自己取消的不算）', cdp.failed.length === 0, cdp.failed.slice(0, 3).join(' | '));
  check('静态服务器没被问到不存在的文件', notFound.length === 0, notFound.slice(0, 3).join(' | '));
} catch (err) {
  fail++;
  console.log('FAIL  浏览器那一段异常: ' + (err?.stack ?? err));
} finally {
  clearTimeout(watchdog);
  try {
    execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' });
  } catch {
    /* 已经退了 */
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
