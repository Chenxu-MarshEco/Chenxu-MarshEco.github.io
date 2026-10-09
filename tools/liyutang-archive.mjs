/*
 * ============================================================================
 * 聊天室「每日存档」—— 把云端某一天的话搬进仓库（2026-10-09）
 * ----------------------------------------------------------------------------
 * 用户原话：「每天保存一次聊天记录 …… 保存的聊天记录最好可以不调用腾讯云的额度
 * 例如保存在本地仓库？但是需要所有用户都能搜索」。
 *
 * 分工是这样的（想清楚再改）：
 *   · **当天**的话住在云端的 lt_chat 里（活的，谁都能看见刚发的）；
 *   · **过完这一天**，由这个脚本把它搬进仓库 —— 文字写成 `src/data/chat/<日>.json`，
 *     图片解出来写成 `public/img/chat/<日>/<消息 id>.webp`，头像按内容去重写进
 *     `public/img/chat/avatars/<哈希>.webp`；最后更新 `src/data/chat/index.json`（有哪些天）。
 *   · 搬完（`--prune`）回头把云端那些 base64 抹掉，只留一条静态路径 —— 数据库不再长大。
 *   · 于是"翻旧账 + 搜索"全是**静态文件**，一个字节都不碰腾讯云的额度。
 *
 * 图片为什么不用再压一遍：消息里的图**本来**就是页面压过的 1000px WebP（data URL），
 * 这里只是把它 base64 解回二进制写盘 —— 不解码、不重编码，所以也不需要 sharp 之类的依赖。
 *
 * 用法（在仓库根目录）：
 *   node tools/liyutang-archive.mjs --day 2026-10-08                # 只搬那一天的
 *   node tools/liyutang-archive.mjs --day 2026-10-08 --prune        # 搬完顺手抹云端图片
 *   node tools/liyutang-archive.mjs --yesterday                     # 搬"北京时间的昨天"（定时任务用这个）
 *   node tools/liyutang-archive.mjs --day 2026-10-08 --dry          # 只看会写什么，不动文件
 * 站长密码：`--password xxx` 或环境变量 `LT_ADMIN_PASSWORD`（GitHub Action 里用 secret）。
 * 写到哪儿：默认就是本仓库；`--root <目录>` 可以换个地方写（验收脚本拿它写进临时目录，
 *          不往真仓库里塞假数据）。
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
/* 画板的几何/渲染和浏览器里那份是同一个模块（这也是"存档长得和当时一样"的保证） */
import { BOARD_H, BOARD_W, checkStroke, paintersOf, strokesToSvg } from '../src/utils/liyutang-strokes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
/** 归档落在哪儿 */
export const CHAT_DIR = path.join(ROOT, 'src', 'data', 'chat');
export const INDEX_FILE = path.join(CHAT_DIR, 'index.json');
export const IMG_DIR = path.join(ROOT, 'public', 'img', 'chat');

/**
 * 「北京时间的昨天」—— 定时任务默认搬前一天。
 *
 * 为什么按 +8 切：用户说的"每天保存一次"是按他自己的自然日算的，
 * 云函数里存 `day` 用的也是同一套（见 tools/liyutang-backend/index.js 的 dayKey），
 * 两边必须是同一个规矩，否则存档会切错一天。
 * @param {number} [now] 毫秒时间戳
 * @returns {string} yyyy-mm-dd
 */
export function yesterdayInBeijing(now = Date.now()) {
  return new Date(now + 8 * 3600 * 1000 - 86400 * 1000).toISOString().slice(0, 10);
}

/** 内容哈希（前 8 位）—— 头像去重的键 */
const hash8 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8);

/**
 * 把一个 data URL 拆成 { mime, ext, buf }。
 * @param {string} dataUrl data:image/xxx;base64,....
 * @returns {{ext: string, buf: Buffer}|null} 拆不出来就 null
 */
export function decodeDataUrl(dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || ''));
  if (!m) return null;
  const kind = m[1].toLowerCase();
  const ext = kind === 'jpeg' ? 'jpg' : kind;
  try {
    return { ext, buf: Buffer.from(m[2], 'base64') };
  } catch {
    return null;
  }
}

/**
 * 存档的**纯函数**部分：给一批消息，写文件 + 更新索引。
 *
 * 单独抽出来是为了能验收 —— 检查脚本直接喂一批假消息进来，看它写出什么，
 * 不用连线上、也不用站长密码（见 tools/checks/liyutang-archive-check.mjs）。
 *
 * @param {object} opts 参数
 * @param {string} opts.day 哪一天（yyyy-mm-dd）
 * @param {Array<object>} opts.messages 云函数给的那批消息
 * @param {string} [opts.root] 仓库根目录（默认本文件所在的仓库）
 * @param {number} [opts.now] 现在的时间戳（写进 archivedAt，测试时给固定值）
 * @param {boolean} [opts.dry] 只算不写
 * @returns {{day: string, messages: number, kept: number, images: number, avatars: number, bytes: number, json: object}} 概要
 */
export function writeArchive({ day, messages, root = ROOT, now = Date.now(), dry = false }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) throw new Error('day 要是 yyyy-mm-dd：' + day);
  const chatDir = path.join(root, 'src', 'data', 'chat');
  const imgDir = path.join(root, 'public', 'img', 'chat');
  const dayImgDir = path.join(imgDir, day);
  const avImgDir = path.join(imgDir, 'avatars');
  if (!dry) {
    fs.mkdirSync(chatDir, { recursive: true });
    fs.mkdirSync(dayImgDir, { recursive: true });
    fs.mkdirSync(avImgDir, { recursive: true });
  }

  /** 头像按内容去重：同一张脸在仓库里只存一份 */
  const avatars = new Map();
  let images = 0;
  const out = [];

  for (const m of Array.isArray(messages) ? messages : []) {
    /* 撤回掉的不进存档 —— 存档是"当时留下的东西"，不能因为撤回就少一段历史？ */
    /* 这里选择**存下来但标记 deleted**：历史要完整，页面上会显示"（撤回了）" */
    const row = {
      id: String(m.id || ''),
      nick: String(m.nick || ''),
      text: String(m.text || ''),
      createdAt: Number(m.createdAt) || 0,
      deleted: !!m.deleted,
    };

    /* 头像：data URL → /img/chat/avatars/<hash>.<ext> */
    const av = decodeDataUrl(m.avatar);
    if (av) {
      const name = `av-${hash8(m.avatar)}.${av.ext}`;
      if (!avatars.has(name)) {
        avatars.set(name, av);
        if (!dry) fs.writeFileSync(path.join(avImgDir, name), av.buf);
      }
      row.avatar = `/img/chat/avatars/${name}`;
    } else {
      row.avatar = '';
    }

    /* 图片：data URL → /img/chat/<日>/<消息 id>.<ext> */
    const img = decodeDataUrl(m.image);
    if (img) {
      const name = `${row.id}.${img.ext}`;
      if (!dry) fs.writeFileSync(path.join(dayImgDir, name), img.buf);
      row.image = `/img/chat/${day}/${name}`;
      images += 1;
    } else {
      /* 已经被抹过一次的（第二次跑）会是一条静态路径，原样留着 */
      row.image = /^\/img\/chat\//.test(String(m.image || '')) ? String(m.image) : '';
    }
    out.push(row);
  }

  /* 存档正文：按时间正序，一个字都不改（用户的语气是历史的一部分） */
  out.sort((a, b) => a.createdAt - b.createdAt);
  const json = {
    _readme: [
      '聊天室某一天的存档（2026-10-09 起）。',
      '',
      '这一份是**机器写的**：tools/liyutang-archive.mjs 每天把云端那天的话搬下来，',
      '图片解成 public/img/chat/<日>/ 下的 WebP，头像按内容去重放进 public/img/chat/avatars/。',
      '搬完云端只留静态路径（LT_ADMIN_CHAT_PRUNE），所以翻旧账和搜索都不碰云端额度。',
      '',
      '⚠ 别手改这个文件：下一次存档会覆盖它（要改的是页面，不是数据）。',
      '消息里的 text / nick 是当时的原文，页面渲染要当纯文本（textContent），不要拼 HTML。',
    ],
    day,
    archivedAt: new Date(now).toISOString(),
    count: out.length,
    images,
    messages: out,
  };

  const body = JSON.stringify(json, null, 2) + '\n';
  if (!dry) fs.writeFileSync(path.join(chatDir, `${day}.json`), body, 'utf8');

  /* 索引：有哪些天、每天多少条/几张图/都有谁 —— 侧栏的时间轴和搜索页都读它 */
  let index = { _readme: [], days: [] };
  const indexFile = path.join(chatDir, 'index.json');
  if (fs.existsSync(indexFile)) {
    try {
      const cur = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
      if (cur && Array.isArray(cur.days)) index = cur;
    } catch {
      /* 索引坏了就重建（下面会覆盖） */
    }
  }
  index._readme = [
    '聊天室的存档索引：有哪些天、每天多少条、几张图、都有谁说话（2026-10-09 起，机器写的）。',
    '',
    '读它的地方：聊天室侧栏那条「日子」时间轴、历史搜索页、以及 /liyutang/chatroom/<日>/ 那几页。',
    '⚠ 别手改：下一次存档会覆盖（一天一条，按日期倒序）。',
  ];
  const entry = {
    day,
    count: out.length,
    images,
    users: [...new Set(out.map((r) => r.nick).filter(Boolean))],
  };
  index.days = [entry, ...(index.days ?? []).filter((d) => d && d.day !== day)].sort((a, b) =>
    String(b.day).localeCompare(String(a.day))
  );
  if (!dry) fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n', 'utf8');

  return {
    day,
    messages: out.length,
    kept: out.filter((r) => !r.deleted).length,
    images,
    avatars: avatars.size,
    bytes: Buffer.byteLength(body),
    json,
  };
}

/**
 * 画板那一天的存档：**纯函数**，和聊天室那个一样，单独抽出来好验收。
 *
 * 写三样东西：
 *   · `src/data/draw/<日>.json` —— 那天的笔划（矢量，谁画的、什么工具、什么颜色、点集）；
 *   · `public/img/draw/<日>.svg` —— 同一批笔划渲染成的一张图（日历/日页直接内联它，
 *     不用在服务器上跑画布；几何用的是 src/utils/liyutang-strokes.mjs，和浏览器里那份同一套）；
 *   · `src/data/draw/index.json` —— 有哪些天、每天多少笔、几个人画的。
 *
 * @param {object} opts 参数
 * @param {string} opts.day 哪一天（yyyy-mm-dd）
 * @param {Array<object>} opts.strokes 云函数给的那批笔划
 * @param {string} [opts.root] 仓库根目录
 * @param {number} [opts.now] 现在的时间戳（写进 archivedAt）
 * @param {boolean} [opts.dry] 只算不写
 * @returns {{day: string, strokes: number, painters: number, bytes: number, svg: string, json: object}} 概要
 */
export function writeDrawArchive({ day, strokes, root = ROOT, now = Date.now(), dry = false }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) throw new Error('day 要是 yyyy-mm-dd：' + day);
  const drawDir = path.join(root, 'src', 'data', 'draw');
  const imgDir = path.join(root, 'public', 'img', 'draw');
  if (!dry) {
    fs.mkdirSync(drawDir, { recursive: true });
    fs.mkdirSync(imgDir, { recursive: true });
  }

  /* 只留画得出来的那几笔（脏数据不进存档），删掉的也不进 */
  const rows = [];
  for (const s of Array.isArray(strokes) ? strokes : []) {
    if (!s || s.deleted) continue;
    const got = checkStroke(s, { w: BOARD_W, h: BOARD_H });
    if (!got.ok) continue;
    rows.push({
      id: String(s.id || ''),
      uk: String(s.uk || ''),
      nick: String(s.nick || ''),
      avatar: String(s.avatar || ''),
      tool: got.stroke.tool,
      color: got.stroke.color,
      size: got.stroke.size,
      points: got.stroke.points,
      createdAt: Number(s.createdAt) || 0,
    });
  }
  rows.sort((a, b) => a.createdAt - b.createdAt);

  const people = paintersOf(rows, { w: BOARD_W, h: BOARD_H });
  const svg = strokesToSvg(rows, { w: BOARD_W, h: BOARD_H });
  const json = {
    _readme: [
      '久昭卿茶绘某一天的存档（2026-10-09 起）。',
      '',
      '这一份是**机器写的**：tools/liyutang-archive.mjs 每天把云端那天画的笔划搬下来，',
      '同一批笔划还渲染成 public/img/draw/<日>.svg（日历和日页直接内联它）。',
      '笔划是矢量的：{ tool: pen|eraser, color: #rrggbb, size, points: [[x, y], …] }，',
      '坐标是画板自己的坐标系（2400×1500，和屏幕无关）。',
      '',
      '⚠ 别手改这个文件：下一次存档会覆盖它（要改的是页面，不是数据）。',
    ],
    day,
    archivedAt: new Date(now).toISOString(),
    count: rows.length,
    painters: people.map((p) => ({ uk: p.key, nick: p.nick, count: p.count })),
    strokes: rows,
  };

  const body = JSON.stringify(json, null, 2) + '\n';
  if (!dry) {
    fs.writeFileSync(path.join(drawDir, `${day}.json`), body, 'utf8');
    fs.writeFileSync(path.join(imgDir, `${day}.svg`), svg, 'utf8');
  }

  /* 索引：有哪些天（新的在前） */
  const indexFile = path.join(drawDir, 'index.json');
  let index = { _readme: [], days: [] };
  if (fs.existsSync(indexFile)) {
    try {
      const cur = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
      if (cur && Array.isArray(cur.days)) index = cur;
    } catch {
      /* 坏了就重建 */
    }
  }
  index._readme = [
    '画板的存档索引：有哪些天、每天多少笔、几个人画的（2026-10-09 起，机器写的）。',
    '',
    '读它的地方：/liyutang/teahouse/calendar/（日历）、/liyutang/teahouse/<日>/（那一天的板）。',
    '⚠ 别手改：下一次存档会覆盖（一天一条，按日期倒序）。',
  ];
  const entry = { day, count: rows.length, painters: people.length, users: people.map((p) => p.nick) };
  index.days = [entry, ...(index.days ?? []).filter((d) => d && d.day !== day)].sort((a, b) =>
    String(b.day).localeCompare(String(a.day))
  );
  if (!dry) fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n', 'utf8');

  return { day, strokes: rows.length, painters: people.length, bytes: Buffer.byteLength(body), svg, json };
}

/**
 * 找站长密码：命令行优先，其次环境变量。
 * @param {string[]} argv
 * @returns {string}
 */
function pickPassword(argv) {
  const i = argv.indexOf('--password');
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return String(process.env.LT_ADMIN_PASSWORD || '');
}

/** 从 src/data/liyutang.json 里读云函数地址（不填就报错，不猜） */
function pickApi() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'liyutang.json'), 'utf8'));
    return String(cfg?.forum?.twikoo?.envId || '');
  } catch {
    return '';
  }
}

/** 调云函数（HTTP 网关那条路） */
async function callFn(api, body) {
  const res = await fetch(api, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`云函数返回的不是 JSON（HTTP ${res.status}）：${text.slice(0, 160)}`);
  }
}

/**
 * 调云函数，**遇到"冷启动那一枪"自动重试**。
 *
 * 为什么非要有这一层：2026-10-09 实测过 —— 云函数闲一阵之后第一枪要先跟 MongoDB Atlas
 * 建 TLS 连接，偶尔会回 `Socket 'secureConnect' timed out`（那一下的 code 不是 0）。
 * 对用户来说就是"点一下坏了、再点一下好了"；但**这个存档脚本每天只跑一次**，
 * 那一枪要是撞上冷启动，这一天就白存了（而且在 Actions 里只显示"失败"）。
 * 所以这里：看着像瞬时错就等一会儿重试，最多 3 次。
 * @param {string} api 云函数地址
 * @param {object} body 请求体
 * @param {string} what 出错时好认的说明
 * @returns {Promise<object>} 云函数返回体
 */
async function callFnRetry(api, body, what) {
  const TRANSIENT = /secureConnect|Socket|timed out|timeout|ECONNRESET|ETIMEDOUT|服务暂时不可用/i;
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    last = await callFn(api, body);
    if (last?.code === 0) return last;
    const msg = String(last?.message ?? '');
    if (!TRANSIENT.test(msg) || attempt === 3) return last;
    console.log(`     [重试] ${what} 第 ${attempt} 枪撞上冷启动：${msg.slice(0, 60)}… 等 5 秒再来`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  return last;
}

/* ------------------------------------------------------------------ 命令行部分 */
/* 只有"直接运行这个文件"时才走这里；被 import 时（检查脚本）什么都不做 */

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (name) => argv.includes(`--${name}`);
  const val = (name, dflt = '') => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
  };
  const day = flag('yesterday') ? yesterdayInBeijing() : val('day');
  const dry = flag('dry');
  const prune = flag('prune');
  const api = val('api') || pickApi();
  const password = pickPassword(argv);
  /* --only chat|draw：只搬一边（默认两边都搬） */
  const only = val('only');
  /* --root：写到别的目录（验收脚本用临时目录，避免往真仓库里塞假数据） */
  const root = val('root') || ROOT;

  if (!day) {
    console.error('用法：node tools/liyutang-archive.mjs --day 2026-10-08 [--prune] [--dry]');
    console.error('      node tools/liyutang-archive.mjs --yesterday        # 北京时间的昨天（定时任务用）');
    process.exit(2);
  }
  if (!api) {
    console.error('没找到云函数地址（src/data/liyutang.json → forum.twikoo.envId）');
    process.exit(2);
  }
  if (!password) {
    console.error('要给站长密码：--password xxx 或环境变量 LT_ADMIN_PASSWORD');
    process.exit(2);
  }

  console.log(`=== 存档 ${day}${dry ? '（dry：只看会写什么）' : ''} ===`);

  /* ---------------- 聊天室 ---------------- */
  if (only !== 'draw') {
    const got = await callFnRetry(api, { event: 'LT_ADMIN_CHAT_DAY', password, day }, '取聊天室那天');
    if (got.code !== 0) {
      console.error('取那天的消息失败：' + String(got.message ?? ''));
      process.exit(1);
    }
    console.log(`     [聊天室] 云端有 ${got.count} 条（其中 ${got.messages.filter((m) => m.image).length} 条带图）`);
    if (!got.count) {
      console.log('     [聊天室] 这一天没人说话，不写文件（免得仓库里多一个空档）');
    } else {
      const sum = writeArchive({ day, messages: got.messages, dry, root });
      console.log(
        `     [聊天室] 写好了：${sum.messages} 条 / ${sum.images} 张图 / ${sum.avatars} 个头像 / ${Math.round(sum.bytes / 1024)}KB` +
          `（其中 ${sum.kept} 条没撤回）`
      );
      if (prune && !dry) {
        const p = await callFnRetry(api, { event: 'LT_ADMIN_CHAT_PRUNE', password, day }, '抹云端图片');
        console.log(p.code === 0 ? `     [聊天室] 云端抹掉 ${p.pruned} 张图（只留静态路径）` : '     [聊天室] 抹图失败：' + String(p.message ?? ''));
      } else if (prune) {
        console.log('     [聊天室] （dry 就不抹云端了）');
      }
    }
  }

  /* ---------------- 画板 ---------------- */
  if (only !== 'chat') {
    const got = await callFnRetry(api, { event: 'LT_ADMIN_DRAW_DAY', password, day }, '取画板那天');
    if (got.code !== 0) {
      console.error('取那天的笔划失败：' + String(got.message ?? ''));
      process.exit(1);
    }
    console.log(`     [画板] 云端有 ${got.count} 笔`);
    if (!got.count) {
      console.log('     [画板] 这一天没人画，不写文件');
    } else {
      const sum = writeDrawArchive({ day, strokes: got.strokes, dry, root });
      console.log(
        `     [画板] 写好了：${sum.strokes} 笔 / ${sum.painters} 个人 / ${Math.round(sum.bytes / 1024)}KB` +
          ` + 一张 SVG（${Math.round(Buffer.byteLength(sum.svg) / 1024)}KB）`
      );
      if (prune && !dry) {
        /* 画板和聊天室不一样：笔划在仓库里就是完整记录，云端那份搬完就删（省数据库） */
        const c = await callFnRetry(api, { event: 'LT_ADMIN_DRAW_CLEAR', password, day }, '清云端笔划');
        console.log(c.code === 0 ? `     [画板] 云端删掉 ${c.cleared} 笔（仓库里已经是完整记录了）` : '     [画板] 清云端失败：' + String(c.message ?? ''));
      } else if (prune) {
        console.log('     [画板] （dry 就不清云端了）');
      }
    }
  }
}
