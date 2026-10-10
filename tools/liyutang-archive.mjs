/*
 * ============================================================================
 * 聊天室「每日存档」—— 把云端某一天的话搬进仓库（2026-10-09）
 * ----------------------------------------------------------------------------
 * 用户原话：「每天保存一次聊天记录 …… 保存的聊天记录最好可以不调用腾讯云的额度
 * 例如保存在本地仓库？但是需要所有用户都能搜索」。
 *
 * 分工是这样的（想清楚再改）：
 *   · **当天**的话/画住在云端（lt_chat / lt_draw 里，活的，谁都能看见刚发的）；
 *   · **过完这一天**，由这个脚本把它搬进仓库 —— 文字写成 `src/data/chat/<日>.json`，
 *     图片解出来写成 `public/img/chat/<日>/<消息 id>.webp`，头像按内容去重写进
 *     `public/img/chat/avatars/<哈希>.webp`；画板写成 `src/data/draw/<日>.json`
 *     + `public/img/draw/<日>.svg`；最后更新两边的 `index.json`（有哪些天）。
 *   · 于是"翻旧账 + 搜索 + 翻日历"全是**静态文件**，一个字节都不碰腾讯云的额度。
 *
 * ⚠ 2026-10-10 改成**两段式**（顺序就是安全本身，别合回去）：
 *   ① 搬（默认行为，**绝不动云端**）；② 提交推送成功之后，再跑 `--prune-only` 清云端。
 *   原来是一趟跑完（搬完立刻抹 base64 / 删笔划），2026-10-09 那次画板取数失败（6MB 上限）
 *   → 脚本 exit 1 → 提交那一步没执行 → **云端图片已经抹了、仓库里却没有**，5 张图就这样没了。
 *   现在清理自带对账闸门（文件必须在盘上 + 条数要跟云端剩的对得上），失败就什么都不清。
 *   另外两边**互不拖累**：聊天室失败不影响画板那份落盘，反之亦然（都试完再报错）。
 *
 * 图片为什么不用再压一遍：消息里的图**本来**就是页面压过的 1000px WebP（data URL），
 * 这里只是把它 base64 解回二进制写盘 —— 不解码、不重编码，所以也不需要 sharp 之类的依赖。
 *
 * 用法（在仓库根目录）：
 *   node tools/liyutang-archive.mjs --day 2026-10-08                     # 只搬那一天的（不动云端）
 *   node tools/liyutang-archive.mjs --yesterday                          # 搬"北京时间的昨天"（定时任务用）
 *   node tools/liyutang-archive.mjs --day 2026-10-08 --prune-only        # 提交之后再清云端
 *   node tools/liyutang-archive.mjs --day 2026-10-08 --prune             # 本地图省事：搬完顺手清（有闸门）
 *   node tools/liyutang-archive.mjs --day 2026-10-08 --dry               # 只看会写什么，不动文件
 *   node tools/liyutang-archive.mjs --day 2026-10-08 --only chat|draw    # 只搬一边
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
  /*
    和后端 dayKey 用的是同一个"切天点"：**北京时间凌晨 4 点**（2026-10-09 用户要求）——
    所以这里的偏移是 +4h（不是 +8h）。这样 04:00 跑的时候，"昨天"正好是
    "昨天 04:00 → 今天 04:00"那个窗口，一天不多一天不少。
  */
  return new Date(now + 4 * 3600 * 1000 - 86400 * 1000).toISOString().slice(0, 10);
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
  /** 云端只剩路径、而仓库里没有那个文件的图（2026-10-09 事故留下的那种） */
  const lostImages = [];
  let images = 0;
  const out = [];

  for (const m of Array.isArray(messages) ? messages : []) {
    /* 撤回掉的不进存档 —— 存档是"当时留下的东西"，不能因为撤回就少一段历史？ */
    /* 这里选择**存下来但标记 deleted**：历史要完整，页面上会显示"（撤回了）" */
    const row = {
      id: String(m.id || ''),
      nick: String(m.nick || ''),
      /* 昵称：存档当时的显示名（以后改了昵称，历史存档仍是当时的叫法 —— 那就是「当时的原话」） */
      alias: String(m.alias || m.nick || ''),
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
      /*
        已经被抹过一次的（第二次跑）会是一条静态路径。先看看那个文件**在不在仓库里** ——
        2026-10-09 那次事故正是"云端抹了、文件没提交"，于是这里会是一条指向空气的路径、页面上就是碎图。
        这种记进 lostImages（像素救不回来了），并把这一条的图片置空，别让页面显示碎图。
      */
      const p = String(m.image || '');
      if (/^\/img\/chat\//.test(p)) {
        const onDisk = fs.existsSync(path.join(root, 'public', p.replace(/^\//, '')));
        if (onDisk) {
          row.image = p;
        } else {
          row.image = '';
          lostImages.push(row.id);
        }
      } else {
        row.image = '';
      }
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
      ...(lostImages.length
        ? [`⚠ 这天有 ${lostImages.length} 张图在云端只剩一条路径、仓库里却没有那个文件（2026-10-09 那次"先抹后提交"的事故），那些消息的 image 是空串。`]
        : []),
      '',
      '⚠ 别手改这个文件：下一次存档会覆盖它（要改的是页面，不是数据）。',
      '消息里的 text / nick 是当时的原文，页面渲染要当纯文本（textContent），不要拼 HTML。',
      '（紧凑 JSON、不缩进：一天的话可能很长，缩进纯属白占地方；要看舒服点就 `jq . <文件>`。）',
    ],
    day,
    archivedAt: new Date(now).toISOString(),
    count: out.length,
    images,
    /* 这些消息的图在云端只剩一条路径、仓库里却没有文件（2026-10-09 事故）；清理那一趟拿它把云端置空 */
    lostImages,
    messages: out,
  };

  /* 紧凑写（和画板存档一个规矩）：这一天的话可能很长，缩进纯属白占地方；索引仍旧缩进 */
  const body = JSON.stringify(json) + '\n';
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
    /* 索引里的「都有谁」用昵称（页面直接用，不用再查一次后端） */
    users: [...new Set(out.map((r) => r.alias || r.nick).filter(Boolean))],
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
    lostImages,
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

  /* 只留画得出来的那几笔（脏数据不进存档），删掉的也不进 —— 所以要如实记下"云端本来有几笔" */
  const rawTotal = Array.isArray(strokes) ? strokes.length : 0;
  let skippedDeleted = 0;
  let skippedDirty = 0;
  const rows = [];
  /*
    ⚠⚠ 2026-10-10：**每笔不再存一份头像**。
    实测（10-09 那天，1224 笔）：文件 6.24MB 里有 **5.61MB 是头像** —— 1224 笔各带一份
    同一个人的头像 data URL，而那天总共只有 **6 张不同的脸**。去掉之后 6.24MB → 0.78MB。
    头像按人存一份放在 `people` 里（6 张 → 几十 KB），要查谁画的用 `uk` 对上去就行。
  */
  const avatarByUk = new Map();
  for (const s of Array.isArray(strokes) ? strokes : []) {
    if (!s || s.deleted || !s.uk) continue;
    const av = String(s.avatar || '');
    if (av && !avatarByUk.has(String(s.uk))) avatarByUk.set(String(s.uk), av);
  }
  for (const s of Array.isArray(strokes) ? strokes : []) {
    if (!s) {
      skippedDirty += 1;
      continue;
    }
    if (s.deleted) {
      skippedDeleted += 1;
      continue;
    }
    const got = checkStroke(s, { w: BOARD_W, h: BOARD_H });
    if (!got.ok) {
      skippedDirty += 1;
      continue;
    }
    rows.push({
      id: String(s.id || ''),
      uk: String(s.uk || ''),
      nick: String(s.nick || ''),
      tool: got.stroke.tool,
      color: got.stroke.color,
      size: got.stroke.size,
      points: got.stroke.points,
      createdAt: Number(s.createdAt) || 0,
    });
  }
  rows.sort((a, b) => a.createdAt - b.createdAt);

  const people = paintersOf(rows, { w: BOARD_W, h: BOARD_H }).map((p) => ({
    uk: p.key,
    nick: p.nick,
    /* 头像按人一份（不是按笔）—— 这是把文件从 6MB 压到 0.8MB 的那一刀 */
    avatar: avatarByUk.get(String(p.key)) || '',
    count: p.count,
  }));
  const svg = strokesToSvg(rows, { w: BOARD_W, h: BOARD_H });
  const json = {
    _readme: [
      '久昭卿茶绘某一天的存档（2026-10-09 起）。',
      '',
      '这一份是**机器写的**：tools/liyutang-archive.mjs 每天把云端那天画的笔划搬下来，',
      '同一批笔划还渲染成 public/img/draw/<日>.svg（日历和日页直接内联它）。',
      '笔划是矢量的：{ id, uk, nick, tool, color, size, points: [[x, y], …], createdAt }，',
      `坐标是画板自己的坐标系（${BOARD_W}×${BOARD_H}，屏幕无关），精确到 0.1 画板像素。`,
      '',
      '**这一份是紧凑 JSON（不缩进）**：一天几千笔，缩进能把文件撑大两成多。要看就 `jq` 一下。',
      '**头像不在笔划上**：每笔存一份头像会让文件涨到十倍（2026-10-10 实测：6.24MB 里 5.61MB 是头像，',
      '而那天只有 6 张不同的脸），所以头像按人存在 `people` 里，用 uk 对。',
      '',
      `count = 这里真正留下的笔数；cloudTotal = 云端那天的原始条数（${rawTotal}）。`,
      `两者不等是**故意**的：撤掉的（${skippedDeleted} 笔）和画不出来的脏数据（${skippedDirty} 笔）都不进存档。`,
      '清理云端时拿 cloudTotal 对账 —— 别拿 count 去比，那不是同一个数。',
      '',
      '⚠ 别手改这个文件：下一次存档会覆盖它（要改的是页面，不是数据）。',
    ],
    day,
    archivedAt: new Date(now).toISOString(),
    count: rows.length,
    cloudTotal: rawTotal,
    skipped: { deleted: skippedDeleted, dirty: skippedDirty },
    people,
    strokes: rows,
  };

  /* 紧凑写（不缩进）：一天几千笔时缩进要多占两成多；索引文件仍旧缩进（它小、而且每天都有 diff） */
  const body = JSON.stringify(json) + '\n';
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
    '`people` 是那天动过笔的人（uk / 昵称 / 头像 / 几笔）—— 日页那张"这天动过笔的人"就靠它，',
    '所以构建**不需要**去读每天的 <日>.json（那些文件很大，一天几 MB；eager 读进来会把构建拖垮）。',
    '⚠ 别手改：下一次存档会覆盖（一天一条，按日期倒序）。',
  ];
  const entry = {
    day,
    count: rows.length,
    painters: people.length,
    users: people.map((p) => p.nick),
    /* 日页要的人表（原来只在 <日>.json 里，构建就得把每天的存档全读进来） */
    people,
  };
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

/**
 * 取某一天的全部笔划（**分页**取）。
 *
 * 为什么必须分页 —— 2026-10-10 04:17 的真事：一天的笔划一次性返回，响应体超过腾讯云 6MB 上限，
 * 云函数抛 `FUNCTIONS_INVOCATION_FAILED`，存档整个失败；而它排在聊天室之后，于是"聊天室已经搬好、
 * 云端图片也抹了"的那次运行**连提交都没走到**（文件只活在 runner 上）。用户第二天看到的就是
 * "昨天的画和聊天都没保存"。
 *
 * 现在：云函数按 `(createdAt, id)` 游标 + 字节预算分批给，这里循环取到 `next === null`，
 * 并且**拿 total 对账** —— 取到的条数跟云端说的总数不一样就抛错，绝不让"半份存档"落盘。
 *
 * @returns {Promise<{strokes: any[], total: number, pages: number}>}
 */
async function fetchDrawDay(api, day, password) {
  const all = [];
  let after = 0;
  let afterId = '';
  let total = null;
  let page = 0;
  for (;;) {
    page += 1;
    if (page > 500) throw new Error('分页超过 500 批还没取完 —— 不正常，停下来看看');
    const got = await callFnRetry(
      api,
      { event: 'LT_ADMIN_DRAW_DAY', password, day, after, afterId, limit: 500 },
      `取画板那天（第 ${page} 批）`
    );
    if (got.code !== 0) throw new Error('取那天的笔划失败：' + String(got.message ?? ''));
    /*
      ⚠ 向后兼容：盘上的脚本和线上的云函数不是一起更新的（脚本改了、函数还没部署上去的时候）。
      老版本函数一次把整天给回来，响应里**没有 total / next** —— 要是硬按分页理解，
      `total` 会变成 undefined → 被当成"这天 0 笔" → 静默不写文件，这是最糟的失败方式（比报错还坏）。
      所以这里显式认一次老协议：警告 + 当成"一批就是全部"，然后接着按 count 对账。
    */
    if (got.total === undefined || got.next === undefined) {
      const all2 = Array.isArray(got.strokes) ? got.strokes : [];
      console.log('     [画板] ⚠ 线上云函数还是老版本（响应里没有 total / next）—— 暂按"一次给全部"处理。');
      console.log('     [画板]   这天要是笔划太多，会再现 2026-10-09 那次 6MB 失败；把云函数部署上去就好了。');
      return { strokes: all2, total: all2.length, pages: 1 };
    }
    total = Number(got.total) || 0;
    const batch = Array.isArray(got.strokes) ? got.strokes : [];
    all.push(...batch);
    if (page === 1) console.log(`     [画板] 云端有 ${total} 笔（分页取，一批最多 500 笔）`);
    if (!batch.length || !got.next) break;
    if (got.next.ts === after && String(got.next.id) === afterId) throw new Error('游标没有前进 —— 云端分页出问题了');
    after = got.next.ts;
    afterId = String(got.next.id);
    console.log(`     [画板] 第 ${page} 批 ${batch.length} 笔（累计 ${all.length}/${total}）`);
  }
  if (total !== null && all.length !== total) {
    throw new Error(`笔数对不上：云端说这天有 ${total} 笔、实际取到 ${all.length} 笔 —— 不当成"取完了"`);
  }
  return { strokes: all, total: total ?? all.length, pages: page };
}

/**
 * 清云端那一天的副本（聊天室抹 base64、画板删笔划）。
 *
 * ⚠ 这是**唯一不可逆**的一步：云端那一份删了就没了（MongoDB 免费档没有备份）。
 * 所以它自带两道保险，任何一条不满足就什么都不清：
 *   ① 仓库里必须先有那天的存档文件（`src/data/chat|draw/<日>.json`）；
 *   ② 文件里数出来的条数要跟云端剩的对得上 —— 这个数会当作 `expect` 发给云函数，
 *      由服务端再挡一次（见 index.js 里 LT_ADMIN_CHAT_PRUNE / LT_ADMIN_DRAW_CLEAR 的闸门）。
 *
 * 2026-10-10 的顺序改动：工作流现在是"**先搬 → 提交推送 → 再清**"。
 * 原来是一趟跑完（搬完立刻清），10-09 那次就是"图清掉了、提交那一步没走到"，
 * 5 张聊天图从此只剩一条指向空气的路径。
 *
 * @returns {Promise<string[]>} 没做成的事（空数组 = 都清了）
 */
async function pruneCloud(api, day, password, only, root) {
  const chatFile = path.join(root, 'src', 'data', 'chat', `${day}.json`);
  const drawFile = path.join(root, 'src', 'data', 'draw', `${day}.json`);
  const problems = [];

  if (only !== 'draw') {
    if (!fs.existsSync(chatFile)) {
      console.log('     [聊天室] 仓库里没有那天的存档，不抹（没什么可抹的）');
    } else {
      const j = JSON.parse(fs.readFileSync(chatFile, 'utf8'));
      const n = (j.messages || []).filter((m) => /^\/img\/chat\//.test(String(m.image || ''))).length;
      const p = await callFnRetry(api, { event: 'LT_ADMIN_CHAT_PRUNE', password, day, expect: n }, '抹云端图片');
      console.log(p.code === 0 ? `     [聊天室] 云端抹掉 ${p.pruned} 张图（只留静态路径）` : `     [聊天室] 没抹：${p.message}`);
      if (p.code !== 0) problems.push('聊天室清理：' + String(p.message ?? ''));
      /* 存档里记着"哪些图只剩路径、仓库里却没有文件"（2026-10-09 事故留下的）：
         像素救不回来了，但可以把云端那几条置空，别让人在聊天室里看到碎图。 */
      const lost = Array.isArray(j.lostImages) ? j.lostImages.filter(Boolean) : [];
      if (lost.length) {
        const fx = await callFnRetry(api, { event: 'LT_ADMIN_CHAT_CLEAR_IMAGE', password, day, ids: lost }, '清碎图引用');
        console.log(fx.code === 0 ? `     [聊天室] 顺带把 ${fx.cleared} 条"图已经没了"的消息置空（不再显示碎图）` : `     [聊天室] 碎图引用没抹成：${fx.message}`);
      }
    }
  }

  if (only !== 'chat') {
    if (!fs.existsSync(drawFile)) {
      console.log('     [画板] 仓库里没有那天的存档，不清（没什么可清的）');
    } else {
      const j = JSON.parse(fs.readFileSync(drawFile, 'utf8'));
      /*
        ⚠ 对账要拿 **cloudTotal**（云端那天的原始条数），不能拿 count（存档里留下的笔数）：
        撤掉的笔和脏数据本来就不进存档，2026-10-09 那天是 1476 条里留下 1224 笔 ——
        拿 count 去比会永远对不上，云端那份就永远清不掉。
        老存档里没有 cloudTotal 的话，宁可不清（重跑一次"搬"那一趟就有了）。
      */
      const n = Number(j.cloudTotal);
      if (!Number.isFinite(n)) {
        console.log('     [画板] 存档里没有 cloudTotal（老格式），这次不清 —— 重跑一次搬那一趟再来');
        problems.push('画板清理：存档缺 cloudTotal');
      } else {
        const c = await callFnRetry(api, { event: 'LT_ADMIN_DRAW_CLEAR', password, day, expect: n }, '清云端笔划');
        console.log(c.code === 0 ? `     [画板] 云端删掉 ${c.cleared} 笔（仓库里已经是完整记录了）` : `     [画板] 没清：${c.message}`);
        if (c.code !== 0) problems.push('画板清理：' + String(c.message ?? ''));
      }
    }
  }

  return problems;
}

/**
 * 取某一天的聊天记录（**分页**取）。
 *
 * 和 `fetchDrawDay` 是同一套协议、同一个理由：一张图最大 ~533KB 的 data URL，一天里十几张图，
 * 一次性返回就会撞上腾讯云 6MB 上限（画板 2026-10-09 已经真栽过一次）。所以这里也按
 * `(createdAt, id)` 游标 + 2MB 字节预算分批取，并拿 `total` 对账。
 *
 * 顺便：**旧版云函数**（响应里没有 total / next）要显式认得出来 —— 硬按分页理解的话
 * `total` 会变成 undefined → 被当成"这天 0 条" → 静默不写文件，那是最糟的失败方式。
 *
 * @returns {Promise<{messages: any[], total: number, pages: number}>}
 */
async function fetchChatDay(api, day, password) {
  const all = [];
  let after = 0;
  let afterId = '';
  let total = null;
  let page = 0;
  for (;;) {
    page += 1;
    if (page > 500) throw new Error('分页超过 500 批还没取完 —— 不正常，停下来看看');
    const got = await callFnRetry(
      api,
      { event: 'LT_ADMIN_CHAT_DAY', password, day, after, afterId, limit: 200 },
      `取聊天室那天（第 ${page} 批）`
    );
    if (got.code !== 0) throw new Error('取那天的消息失败：' + String(got.message ?? ''));
    if (got.total === undefined || got.next === undefined) {
      const all2 = Array.isArray(got.messages) ? got.messages : [];
      console.log('     [聊天室] ⚠ 线上云函数还是老版本（响应里没有 total / next）—— 暂按"一次给全部"处理。');
      console.log('     [聊天室]   这天要是图很多，会撞上 6MB 上限；把云函数部署上去就好了。');
      return { messages: all2, total: all2.length, pages: 1 };
    }
    total = Number(got.total) || 0;
    const batch = Array.isArray(got.messages) ? got.messages : [];
    all.push(...batch);
    if (page === 1) console.log(`     [聊天室] 云端有 ${total} 条（分页取，一批最多 200 条）`);
    if (!batch.length || !got.next) break;
    if (got.next.ts === after && String(got.next.id) === afterId) throw new Error('游标没有前进 —— 云端分页出问题了');
    after = got.next.ts;
    afterId = String(got.next.id);
    console.log(`     [聊天室] 第 ${page} 批 ${batch.length} 条（累计 ${all.length}/${total}）`);
  }
  if (total !== null && all.length !== total) {
    throw new Error(`条数对不上：云端说这天有 ${total} 条、实际取到 ${all.length} 条 —— 不当成"取完了"`);
  }
  return { messages: all, total: total ?? all.length, pages: page };
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
  /*
    --prune-only：**只清理云端，不搬**。
    这一步是给工作流在"提交推送成功之后"再跑的（2026-10-10 改成这个顺序，理由见文件头上那段），
    所以它自带两道保险：① 仓库里必须先有那天的存档文件；② 文件里数出来的条数要跟云端剩的对得上
    （喂给云函数的 expect 闸门）。任何一条不满足就什么都不清 —— 云端那一份是唯一的一份。
  */
  const pruneOnly = flag('prune-only');

  /*
    ⚠ 收工一律用 `process.exitCode`，**不要 `process.exit()`**：
    2026-10-10 实测，跟着 `fetch` 后面直接 `process.exit()` 在 Windows 上会把进程炸掉 ——
      Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94
    退出码变成 3221226505，工作流看到一个莫名其妙的码，而且那一趟到底成没成都说不清。
    设 exitCode 让事件循环自己排空（undici 的长连接最多多留几秒），退出码是真话。
  */
  const bail = (code) => {
    process.exitCode = code;
  };

  if (!day) {
    console.error('用法：node tools/liyutang-archive.mjs --day 2026-10-08 [--dry]');
    console.error('      node tools/liyutang-archive.mjs --yesterday          # 北京时间的昨天（定时任务用）');
    console.error('      node tools/liyutang-archive.mjs --day 2026-10-08 --prune-only   # 提交之后再清云端');
    bail(2);
  } else if (!api) {
    console.error('没找到云函数地址（src/data/liyutang.json → forum.twikoo.envId）');
    bail(2);
  } else if (!password) {
    console.error('要给站长密码：--password xxx 或环境变量 LT_ADMIN_PASSWORD');
    bail(2);
  } else if (pruneOnly) {
    /* ============================================================== 只清理（提交之后那一步） */
    console.log(`=== 清理云端 ${day}（存档已经在仓库里了才清）===`);
    const problems = await pruneCloud(api, day, password, only, root);
    if (problems.length) {
      console.error('\n清理没做完：\n  · ' + problems.join('\n  · '));
      bail(1);
    } else {
      console.log('清理完成。');
    }
  } else {
    await archiveDay({ api, day, password, only, dry, prune, root, bail });
  }
}

/**
 * 搬这一趟（写文件，**绝不动云端**）。
 *
 * ⚠ 两边**互不拖累**（2026-10-10 改）：以前是一边失败就 process.exit(1)，
 * 结果"聊天室搬好了、画板那一枪失败"（10-09 那天正是如此）时整次运行立刻退出，
 * 聊天室那份已经写好的文件也白写了 —— 用户第二天看到"昨天的聊天和画都没保存"。
 * 现在两边各自 try/catch，都试过之后再把失败汇总报出来（退出码还是 1，工作流照样红）。
 */
async function archiveDay({ api, day, password, only, dry, prune, root, bail }) {
  console.log(`=== 存档 ${day}${dry ? '（dry：只看会写什么）' : ''} ===`);
  const problems = [];

  /* ---------------- 聊天室 ---------------- */
  if (only !== 'draw') {
    try {
      const { messages, total, pages } = await fetchChatDay(api, day, password);
      console.log(`     [聊天室] 云端有 ${total} 条（其中 ${messages.filter((m) => m.image).length} 条带图）`);
      if (!total) {
        console.log('     [聊天室] 这一天没人说话，不写文件（免得仓库里多一个空档）');
      } else {
        const sum = writeArchive({ day, messages, dry, root });
        console.log(
          `     [聊天室] 写好了：${sum.messages} 条 / ${sum.images} 张图 / ${sum.avatars} 个头像 / ${Math.round(sum.bytes / 1024)}KB` +
            `（其中 ${sum.kept} 条没撤回）${pages > 1 ? `（分 ${pages} 批取回）` : ''}`
        );
        if (sum.lostImages?.length) {
          /* 这里**只报告、不动云端**：搬这一趟严格只读，动云端只发生在"提交之后"的清理那一趟。 */
          console.log(`     [聊天室] ⚠ 有 ${sum.lostImages.length} 条消息的图在仓库里找不到文件（云端只剩路径）：${sum.lostImages.join(' ')}`);
          console.log('     [聊天室]   这些图救不回来了（base64 已被抹掉）；清理那一趟会把云端这几条置空，免得页面上是碎图。');
        }
      }
    } catch (err) {
      problems.push('聊天室：' + String(err?.message ?? err));
      console.error('     [聊天室] 失败：' + String(err?.message ?? err));
    }
  }

  /* ---------------- 画板 ---------------- */
  if (only !== 'chat') {
    try {
      const { strokes, total, pages } = await fetchDrawDay(api, day, password);
      if (!total) {
        console.log('     [画板] 这一天没人画，不写文件');
      } else {
        const sum = writeDrawArchive({ day, strokes, dry, root });
        console.log(
          `     [画板] 写好了：${sum.strokes} 笔 / ${sum.painters} 个人 / ${Math.round(sum.bytes / 1024)}KB` +
            ` + 一张 SVG（${Math.round(Buffer.byteLength(sum.svg) / 1024)}KB）` +
            `${pages > 1 ? `（分 ${pages} 批取回）` : ''}`
        );
      }
    } catch (err) {
      problems.push('画板：' + String(err?.message ?? err));
      console.error('     [画板] 失败：' + String(err?.message ?? err));
    }
  }

  if (problems.length) {
    console.error('\n这次没搬完（云端那一份没动，安全）：\n  · ' + problems.join('\n  · '));
    console.error('修好之后重跑同一条命令即可 —— 已经写好的那一半不会重复写，也不会丢。');
    bail(1);
    return;
  }
  /*
    --prune：本地图省事的"一趟跑完"（搬完顺手清云端）。
    ⚠ 工作流**不用**这个开关：那边是"搬 → 提交推送 → 再跑 --prune-only"两步，
      因为"清掉了但没提交成功"正是 2026-10-09 丢 5 张图的成因。
      这里留着它只是为了本地手工补档方便，保险（expect 对账 + 文件必须在盘上）跟 --prune-only 一模一样。
  */
  if (prune && !dry) {
    console.log('\n--prune：顺手清云端（本地一趟跑完的用法；工作流走的是"先提交、后清理"）。');
    const left = await pruneCloud(api, day, password, only, root);
    if (left.length) {
      console.error('\n清理没做完：\n  · ' + left.join('\n  · '));
      bail(1);
    }
  } else if (!dry) {
    console.log('\n搬完了。云端那份先留着 —— 等这次改动提交推送成功，再跑 --prune-only 去清。');
  }
}
