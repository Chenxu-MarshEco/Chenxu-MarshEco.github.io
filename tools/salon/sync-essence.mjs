/**
 * 群精华 → 站点数据：从 NapCat 的 HTTP 接口直接拉「燃儿求开组」的精华，
 * 并进 `src/data/salon.json`（2026-11-12 加）。
 *
 *   node tools/salon/sync-essence.mjs --probe                 # 只打印接口原始返回，什么都不写
 *   node tools/salon/sync-essence.mjs --dry                   # 算一遍，报告会加什么，不写盘
 *   node tools/salon/sync-essence.mjs --month 2026-10         # 只处理 2026 年 10 月
 *   node tools/salon/sync-essence.mjs                         # 真写（默认：上个月）
 *
 * 和 tools/salon/import-more.mjs 的区别：
 *   那份吃的是「月度导出 HTML」，要人先导出再喂进来；
 *   这份直接问 NapCat 要，**每月 1 号自动跑**（Windows 计划任务），跑的是**上个月**。
 *   两者共用 merge.mjs 的去重规则（essenceKey / looksSame），所以混着用不会重复。
 *
 * 三条规矩（和 import-more 一致）：
 *   ① **只增不改**：已有的条目一个字节都不动，新条目从最大编号往后接；
 *   ② **去重**：日期 + 时刻 + 正文（去掉空白和 `- ` 项目符号）一样 = 同一条；
 *      同一时刻正文 90% 以上重合也算同一条（导出管线偶尔弄坏一两个字）；
 *   ③ **成员按名字或别名认**：认不出来才新建。
 *
 * ⚠ **按月窗口跑**（2026-11-12 改）：站长要的是「12 月 1 号传 11 月的」，
 * 不是「一直增量」。所以默认窗口 = 上个月，`--month` 可指定。某个月跑失败了，
 * 下个月不会自动补 —— 要补就手动 `--month 2026-10` 再跑一次。
 *
 * 图片**必须存**（QQ 的图片链接带 rkey，过期就没了），存成
 * `public/img/salon/<id>-<序号>.<ext>`，和站里已有的图同一个命名法。
 *
 * ⚠ **聊天截图不归发送人**（2026-11-12 改，站长提的规则）：
 * 一条精华如果是一张 QQ 聊天截图，它属于**图里说话的那几个人**，而不是截图的人。
 *   例：隰辰煦发了张「隰辰煦和虹星对话」的截图 → 属于隰辰煦 + 虹星
 *       隰辰煦发了张「只有 Raw 在说话」的截图       → 属于 Raw（不含隰辰煦）
 * 判断办法：OCR 图上的字，把**认得出的成员名/马甲**都挑出来当参与者。
 * 一个都认不出（图里是网图/游戏截图）就退回「归发送人」。
 * 图里的名字如果对不上任何成员（图片里没有 QQ 号，认不出来），
 * **不新建角色**，统一挂到 aliases.json 里指定的「未知角色」上，等站长在编辑器里认领。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { essenceKey, looksSame, eraIdFor, nextIdFrom } from './merge.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, '..', '..');
const SALON_FILE = path.join(PROJ, 'src', 'data', 'salon.json');
const IMG_DIR = path.join(PROJ, 'public', 'img', 'salon');
const ALIAS_FILE = path.join(HERE, 'aliases.json');

/* ---------------- 配置（都能用环境变量覆盖） ---------------- */
const API = (process.env.SALON_API || 'http://127.0.0.1:3003').replace(/\/+$/, '');
const API_TOKEN = process.env.SALON_API_TOKEN || '';
const GROUP_ID = Number(process.env.SALON_GROUP || 752855970);
/** 正文短于这个字数、又有图的，就当「聊天截图」，去 OCR */
const OCR_MAX_TEXT = 20;

const argv = process.argv.slice(2);
const PROBE = argv.includes('--probe');
const DRY = argv.includes('--dry') || PROBE;

/* ---------------- 小工具（先声明，下面 resolveMonth 要用） ---------------- */
const pad = (n) => String(n).padStart(2, '0');

/**
 * 跑哪个月。三种来源，优先级从高到低：
 *   ① `--month 2026-10`     手动指定
 *   ② `SALON_MONTH` 环境变量  计划任务里用（每月 1 号跑时它等于上个月）
 *   ③ 都不给 → **上个月**（按北京时间算）
 * 窗口是 [当月 1 号, 当月最后一天]，两头都含。
 */
function resolveMonth() {
  const at = argv.indexOf('--month');
  const raw = at >= 0 ? argv[at + 1] : process.env.SALON_MONTH || '';
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    const [y, m] = raw.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // 下个月第 0 天 = 本月最后一天
    return { label: raw, from: `${raw}-01`, to: `${raw}-${pad(last)}` };
  }
  /* 默认上个月（北京时间：把「现在」往后挪 8 小时再取 UTC 的年月） */
  const nowB = new Date(Date.now() + 8 * 3600 * 1000);
  const y = nowB.getUTCFullYear();
  const m = nowB.getUTCMonth() + 1; // 1..12
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const label = `${py}-${pad(pm)}`;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return { label, from: `${label}-01`, to: `${label}-${pad(last)}` };
}
const MONTH = resolveMonth();
/* SALON_SINCE 仍可单独覆盖起点（补历史时用），默认就是本月 1 号 */
const SINCE = process.env.SALON_SINCE || MONTH.from;
const UNTIL = process.env.SALON_UNTIL || MONTH.to;
/** 图里认不出的名字挂到哪 —— 默认留空，即 memberIds: []（站里已有 16 条是这个状态，页面显示「冰室群成员」，编辑器里可以手动认领） */
const UNKNOWN_NAME = process.env.SALON_UNKNOWN || '';

/** unix 秒 → 北京时间的 { date: 'YYYY-MM-DD', time: 'HH:MM' } */
function bjParts(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return { date: '', time: '' };
  const d = new Date((n + 8 * 3600) * 1000);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

/** 调 NapCat 的 HTTP 接口 */
async function call(action, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (API_TOKEN) headers.Authorization = `Bearer ${API_TOKEN}`;
  const res = await fetch(`${API}/${action}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${action} 返回 HTTP ${res.status}`);
  const json = await res.json();
  if (json?.status === 'failed' || (json?.retcode && json.retcode !== 0)) {
    throw new Error(`${action} 失败：${json?.message || json?.wording || JSON.stringify(json).slice(0, 200)}`);
  }
  return json;
}

/** 把一条精华的 msg_content 拆成「正文 + 图片」 */
function parseContent(content) {
  let segs = content;
  if (typeof segs === 'string') {
    try { segs = JSON.parse(segs); } catch { return { text: segs.trim(), images: [] }; }
  }
  if (!Array.isArray(segs)) return { text: '', images: [] };
  let text = '';
  const images = [];
  for (const s of segs) {
    const t = s?.type;
    const d = s?.data ?? {};
    if (t === 'text') text += d.text ?? '';
    else if (t === 'image') images.push({
      url: String(d.url || ''),
      file: String(d.file || ''),
      fileId: String(d.file_id || d.fileId || ''),
    });
    else if (t === 'at') text += `@${d.qq ?? ''} `;
    else if (t === 'face' || t === 'mface') text += '[表情]';
    else if (t === 'reply') { /* 引用不落正文 */ }
    else if (t === 'file') text += `[文件 ${d.name || d.file || ''}]`;
  }
  return { text: text.replace(/\s+$/g, '').trim(), images };
}

/**
 * 群名片 → 只保留「真正是字」的字符。
 *
 * 真实数据里的样子（2026-11-12 实测）：
 *   「🏗隰辰煦🏗」            → 隰辰煦（emoji 框）
 *   「👆ミスタ」               → ミスタ
 *   「亚卡莱特ᅠ⁧呃呜喵⁧‭」      → 亚卡莱特呃呜喵
 *
 * 最后那条最坑：QQ 允许在群名片里塞 U+115F/U+1160（朝鲜文填充符，渲染成空白）、
 * U+2067（双向隔离符）这类不可见字符。**列黑名单永远列不全** ——
 * 第一次我只剥了 emoji 和 `\p{Cf}`，服务器上跑出来仍然认得不对。
 *
 * 所以改成**白名单**：只留「字母 + 数字」（`\p{L}` `\p{N}`），其余一律丢掉。
 * 但那两个朝鲜文填充符恰好属于 `\p{L}`（Lo），得再单独点名去掉 —— 它们渲染成空白，
 * 却会参与字符串比较。
 */
function cleanNick(s) {
  return String(s ?? '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    /* 朝鲜文填充符：类别是「字母」，但看起来就是空白，必须点掉 */
    .replace(/[\u{115F}\u{1160}\u{3164}\u{FFA0}]/gu, '')
    .trim();
}

/**
 * 群名片 → 站里的成员名。
 * 先精确匹配（名字或别名），匹配不上就试「前缀」：
 * 比如「亚卡莱特呃呜喵」以别名「亚卡莱特」开头 → 认成虹星。
 * 前缀至少 2 个字才认（1 个字太容易误伤），取**最长**的那个命中。
 */
function matchName(nick, byAlias) {
  const n = cleanNick(nick);
  if (!n) return null;
  if (byAlias.has(n)) return byAlias.get(n);
  /* 不要求「以别名开头」——名片上可能前后都挂了装饰，只要**包含**就算命中，取最长的 */
  let best = null;
  let bestLen = 0;
  for (const [alias, member] of byAlias) {
    if (alias.length < 2) continue;
    if (n.includes(alias) && alias.length > bestLen) {
      best = member;
      bestLen = alias.length;
    }
  }
  return best;
}

/**
 * 从一张聊天截图的 OCR 文本里，挑出**说话的人**（2026-11-12 加）。
 *
 * 站长订的规则：一条精华如果是 QQ 聊天截图，它属于**图里说话的那几个人**，
 * 不属于截图的人。例：
 *   · 隰辰煦发「隰辰煦和虹星对话」的截图 → 隰辰煦 + 虹星
 *   · 隰辰煦发「只有 Raw 在说话」的截图   → 只有 Raw（不含隰辰煦）
 *
 * 怎么挑：QQ 聊天截图里，每条消息上面会有一行「名字 + 头衔/LV」。
 * OCR 出来的文本里就是这些名字。我们把**认得出的成员名/马甲**都扫一遍，
 * 出现过的就算参与者。认得出用什么认：优先用 aliases 的 nick 区（马甲），
 * 其次用成员名本身。
 *
 * 认不出来的名字（图里没 QQ 号，真没法确定是谁）不新建角色，
 * 统一记到 `unknown` 里，由调用方挂到「未知角色」上。
 *
 * @returns {{ members: object[], unknown: string[] }}
 */
function pickSpeakers(ocrText, byAlias) {
  const text = String(ocrText || '');
  if (!text.trim()) return { members: [], unknown: [] };

  /* 把所有「能找到的名字 / 马甲」按长度从长到短排，先匹配长的
     （避免「亚卡莱特」先被短的「虹星」什么的抢走） */
  const keys = [...byAlias.keys()].filter((k) => k.length >= 2).sort((a, b) => b.length - a.length);
  const hit = new Map(); // memberId → member
  const unknown = [];
  let rest = text;

  for (const k of keys) {
    if (!rest.includes(k)) continue;
    const m = byAlias.get(k);
    if (!m) continue;
    hit.set(m.id, m);
    /* 把这个名字从待搜文本里抹掉，免得短名字重复命中 */
    rest = rest.split(k).join('\u0000');
  }

  /*
    剩下的「像是说话人但认不出」的行：QQ 聊天截图里通常是
    「名字」单独一行，或「名字：内容」。这里只做**报告**用，
    不据此拆名字（OCR 太容易把正文切碎，硬拆会造出一堆假人）。
  */
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  for (const line of lines) {
    const m = /^([^\s：:]{2,12})[：:]/.exec(line);
    if (m && !byAlias.has(m[1])) unknown.push(m[1]);
  }

  return { members: [...hit.values()], unknown: [...new Set(unknown)] };
}

/**
 * 一条原始精华 → 站里的形状（还没定 id / memberIds / eraId）。
 *
 * 真实返回（2026-11-12 实测）：
 *   msg_seq / msg_random / sender_id / sender_nick / operator_id / operator_nick
 *   message_id / operator_time / content
 *
 * **时间就用 `operator_time`（设为精华的时间）** —— 站长 2026-11-12 明确：
 * 「我们网站上存的精华时间就是被设为精华的时间，不需要考据发出消息的时间」。
 * 所以不用再调 get_msg 去追原始发送时间，少一次请求、也少一个失败点。
 */
function normalize(raw) {
  const { text, images } = parseContent(raw?.content ?? raw?.msg_content ?? raw?.message);
  const { date, time } = bjParts(raw?.operator_time);
  return {
    date,
    time,
    text,
    images,
    senderId: String(raw?.sender_id ?? raw?.sender_uin ?? raw?.user_id ?? ''),
    senderNick: cleanNick(raw?.sender_nick ?? raw?.sender_name ?? raw?.nickname ?? ''),
    rawNick: String(raw?.sender_nick ?? ''),
    messageId: String(raw?.message_id ?? ''),
    msgSeq: String(raw?.msg_seq ?? ''),
  };
}

/** 拉全部精华（QQ 后来给这个接口加了 page 参数，所以分页取到空为止） */
async function fetchAll() {
  const out = [];
  const seen = new Set();
  for (let page = 0; page < 50; page++) {
    let json;
    try {
      json = await call('get_essence_msg_list', page === 0 ? { group_id: GROUP_ID } : { group_id: GROUP_ID, page });
    } catch (err) {
      if (page === 0) throw err;
      break; // 不支持分页就到此为止
    }
    const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.data?.msg_list) ? json.data.msg_list : [];
    if (!list.length) break;
    let fresh = 0;
    for (const it of list) {
      /* 去重键用真实字段：msg_seq + message_id（实测返回里没有 sender_time） */
      const k = `${it?.msg_seq ?? ''}|${it?.message_id ?? ''}|${it?.sender_id ?? ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(it);
      fresh++;
    }
    if (!fresh) break; // 这一页全是重复的 = 接口不认 page，停
  }
  return out;
}

/**
 * 下载一张图，返回 { buf, ext, url }。
 *
 * QQ 的图片 url 里带 `rkey`，**旧消息的 rkey 会过期** —— 2026-11-12 实测
 * 32 条里 5 张直接 404。所以下载失败时按顺序试三条兜底路线：
 *   ① 用 `get_image`（传 file / file_id）让 NapCat 重签一次；
 *   ② 还是没有，就用 `get_msg` 把那条消息重新取一遍，从 fresh content 里找新 url；
 *   ③ 都不成就报错（外层会记 needsReview，让你手工看一眼）。
 */
async function download(im, messageId) {
  const tryFetch = async (url) => {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };

  const candidates = [];
  if (im.url) candidates.push(im.url);
  /** 诊断：把每一步拿到了什么记下来，失败时一并报出去 */
  const diag = [];

  /* ① get_image 重签 */
  try {
    const args = {};
    if (im.file) args.file = im.file;
    if (im.fileId) args.file_id = im.fileId;
    if (Object.keys(args).length) {
      const json = await call('get_image', args);
      const u = String(json?.data?.url ?? '');
      if (/^https?:/i.test(u)) candidates.push(u);
      else diag.push(`get_image 没给 url（返回 ${JSON.stringify(json?.data ?? json).slice(0, 120)}）`);
    } else {
      diag.push('这条没 file / file_id，跳过 get_image');
    }
  } catch (e) {
    diag.push(`get_image 报错：${e.message.slice(0, 80)}`);
  }

  /* ② get_msg 重新取那条消息，从最新 content 里找图 */
  if (messageId) {
    try {
      const json = await call('get_msg', { message_id: Number(messageId) });
      const segs = json?.data?.message ?? json?.data?.content ?? [];
      let got = 0;
      if (Array.isArray(segs)) {
        for (const s of segs) {
          if (s?.type !== 'image') continue;
          const u = String(s?.data?.url ?? '');
          if (/^https?:/i.test(u)) { candidates.push(u); got++; }
        }
      }
      if (!got) diag.push(`get_msg 里没找到图片段（${Array.isArray(segs) ? `只有 ${segs.length} 段` : '没有 message 字段'}）`);
    } catch (e) {
      diag.push(`get_msg 报错：${e.message.slice(0, 80)}`);
    }
  } else {
    diag.push('这条没有 message_id，跳过 get_msg');
  }

  let lastErr = null;
  for (const url of candidates) {
    if (!url) continue;
    try {
      const buf = await tryFetch(url);
      let ext = 'jpg';
      const m = /\.(jpe?g|png|gif|webp|bmp)(?:\?|$)/i.exec(url);
      if (m) ext = m[1].toLowerCase().replace('jpeg', 'jpg');
      return { buf, ext, url };
    } catch (e) {
      lastErr = e;
    }
  }
  const detail = diag.length ? `；${diag.join('；')}` : '';
  throw new Error(`${lastErr ? lastErr.message : '没有可用的图片链接'}${detail}`);
}

/** 让 NapCat 认图里的字（仅 Windows 端支持；失败就当没有） */
async function ocr(url) {
  try {
    const json = await call('ocr_image', { image: url });
    const d = json?.data ?? {};
    const texts = d.texts ?? d.text ?? d.words ?? [];
    if (Array.isArray(texts)) return texts.map((t) => (typeof t === 'string' ? t : t?.text ?? '')).filter(Boolean).join('\n');
    return String(texts || '');
  } catch {
    return '';
  }
}

/* ---------------- 主流程 ---------------- */
async function main() {
  console.log(`接口 ${API}  群 ${GROUP_ID}  窗口 ${SINCE} ~ ${UNTIL}（${MONTH.label}）`);
  const raw = await fetchAll();
  console.log(`接口返回 ${raw.length} 条精华`);

  if (PROBE) {
    console.log('\n===== 原始返回（前 2 条）=====');
    console.log(JSON.stringify(raw.slice(0, 2), null, 2));
    console.log('\n===== 归一化之后（前 5 条）=====');
    console.log(JSON.stringify(raw.slice(0, 5).map(normalize), null, 2));
    return;
  }

  const data = JSON.parse(fs.readFileSync(SALON_FILE, 'utf8'));
  const file = {
    ...data,
    eras: Array.isArray(data.eras) ? data.eras : [],
    members: (Array.isArray(data.members) ? data.members : []).map((m) => ({ ...m })),
    essences: (Array.isArray(data.essences) ? data.essences : []).map((e) => ({ ...e })),
  };

  /* ---- 成员：QQ号 → 名字（aliases.json 的 qq 区），马甲 → 名字（nick 区 + 站里已有的 aliases） ---- */
  let aliasFile = {};
  try { aliasFile = JSON.parse(fs.readFileSync(ALIAS_FILE, 'utf8')); } catch { /* 没有就空着 */ }
  /* 兼容老格式（顶层直接是 QQ号→名字） */
  const qqMap = aliasFile.qq ?? (Object.keys(aliasFile).some((k) => /^\d+$/.test(k)) ? aliasFile : {});
  const nickMap = aliasFile.nick ?? {};
  const skipMap = aliasFile.skip ?? {};
  const byAlias = new Map();
  const put = (key, member) => {
    if (!key) return;
    byAlias.set(String(key), member);
    /* 同时放一份「洗干净」的键：名片和别名都可能带装饰/不可见字符 */
    const c = cleanNick(key);
    if (c && !byAlias.has(c)) byAlias.set(c, member);
  };
  for (const m of file.members) {
    if (m?.name) put(m.name, m);
    for (const a of Array.isArray(m?.aliases) ? m.aliases : []) put(a, m);
  }
  /* nick 区只补站里没有的（站里以 salon.json 为准） */
  for (const [nick, name] of Object.entries(nickMap)) {
    const target = byAlias.get(name) ?? byAlias.get(cleanNick(name));
    if (target) put(nick, target);
  }
  const usedMemberIds = new Set(file.members.map((m) => String(m.id || '')));
  const newMembers = [];
  const unknown = new Map(); // QQ号 → 群名片，报告用
  const unknownPinned = []; // 图里认不出人、memberIds 留空的条目
  const needsReview = []; // 图片没下下来的条目（归属可能不准）
  let chatScoped = 0; // 按「图里说话的人」归属的条数
  const memberOf = (name) => {
    const hit = byAlias.get(name);
    if (hit) return hit;
    let n = 1;
    let id = '';
    do { id = `m${String(usedMemberIds.size + n).padStart(2, '0')}-${Math.random().toString(16).slice(2, 6)}`; n++; } while (usedMemberIds.has(id));
    const m = { id, name, avatar: '' };
    usedMemberIds.add(id);
    file.members.push(m);
    byAlias.set(name, m);
    newMembers.push(m);
    return m;
  };

  /* ---- 去重表 ---- */
  const seen = new Set(file.essences.map(essenceKey));
  const byWhen = new Map();
  const normText = (s) => String(s ?? '').split('\n').map((l) => l.replace(/^\s*[-–—]\s*/, '')).join('').replace(/\s+/g, '');
  for (const e of file.essences) {
    const k = `${e.date}|${e.time || ''}`;
    const arr = byWhen.get(k) ?? [];
    arr.push({ text: normText(e.text) });
    byWhen.set(k, arr);
  }

  let nextNum = nextIdFrom(file.essences);
  const usedIds = new Set(file.essences.map((e) => String(e.id || '')));
  const added = [];
  const skipped = [];
  let imgWritten = 0;
  let imgBytes = 0;
  let imgFailed = 0;

  /* ---- 逐条 ---- */
  for (const r of raw) {
    const it = normalize(r);
    if (!it.date) { skipped.push({ ...it, why: '没有时间戳' }); continue; }
    if (it.date < SINCE) { skipped.push({ ...it, why: `早于 ${SINCE}` }); continue; }
    if (it.date > UNTIL) { skipped.push({ ...it, why: `晚于 ${UNTIL}` }); continue; }

    const key = essenceKey(it);
    const text = normText(it.text);
    let why = '';
    if (seen.has(key)) why = '站里已经有这一条了';
    else if (text) {
      for (const cand of byWhen.get(`${it.date}|${it.time || ''}`) ?? []) {
        if (looksSame(cand.text, text)) { why = '站里已经有这一条了（正文只差几个字）'; break; }
      }
    }
    if (why) { skipped.push({ ...it, why }); continue; }

    /* id */
    let id = '';
    while (nextNum < 100000) {
      const cand = `e${String(nextNum).padStart(4, '0')}`;
      nextNum++;
      if (!usedIds.has(cand)) { id = cand; break; }
    }
    if (!id) id = `e-${Date.now().toString(36)}`;
    usedIds.add(id);

    /* 图片 */
    const images = [];
    /** 第一张图下载成功后拿到的「可用链接」，后面 OCR 用它（原 url 可能已过期） */
    let firstUsableUrl = '';
    for (let k = 0; k < it.images.length; k++) {
      const im = it.images[k];
      if (!im.url && !im.file && !im.fileId) continue;
      try {
        /* 把 message_id 传进去：url 过期时要用它去问 NapCat 重新取（群友确认：必须过 NapCat） */
        const got = await download(im, it.messageId);
        if (!firstUsableUrl) firstUsableUrl = got.url || im.url;
        const name = `${id}-${k + 1}.${got.ext}`;
        images.push(`/img/salon/${name}`);
        if (!DRY) {
          fs.mkdirSync(IMG_DIR, { recursive: true });
          fs.writeFileSync(path.join(IMG_DIR, name), got.buf);
        }
        imgWritten++;
        imgBytes += got.buf.length;
      } catch (err) {
        console.warn(`  ⚠ ${id} 第 ${k + 1} 张图下载失败：${err.message}`);
        imgFailed++;
        if (!needsReview.some((x) => x.id === id)) needsReview.push({ id, why: `第 ${k + 1} 张图没下下来（${err.message.slice(0, 60)}），归属可能不准` });
      }
    }

    /*
      聊天截图：有图就 OCR —— 不只是为了抠字，更是为了认出**图里说话的人**。
      ⚠ 用「下载成功后拿到的可用链接」，不要用原始 url：原始 url 的 rkey 可能已过期，
      拿它去 OCR 会直接失败，于是「图里认不出人」，整条就被误判成普通图片归了发送人。
    */
    let finalText = it.text;
    let isOcr = false;
    let ocrText = '';
    const ocrTarget = firstUsableUrl || it.images[0]?.url || '';
    if (images.length && ocrTarget) {
      const got = await ocr(ocrTarget);
      ocrText = got.trim();
      if (ocrText && normText(it.text).length < OCR_MAX_TEXT) {
        finalText = ocrText;
        isOcr = true;
      }
    }

    /* ---- 归属：聊天截图归「图里说话的人」，其余归发送人 ---- */
    if (skipMap[it.senderId]) { skipped.push({ ...it, why: `skip 名单：${skipMap[it.senderId]}` }); continue; }

    /* 图里认得出的参与者 */
    const speakers = images.length ? pickSpeakers(ocrText, byAlias) : { members: [], unknown: [] };

    /** 这一条最终挂到哪些成员上 */
    let memberIdList = [];
    if (images.length && speakers.members.length) {
      /* 有图、且图里认出了人 → 按图里的人归属（**不含发送人**，除非他本人就在图里） */
      memberIdList = speakers.members.map((m) => m.id);
      chatScoped++;
    } else if (images.length && ocrText) {
      /*
        有图、有字、但一个成员都没认出来 —— 多半是聊天截图里全是生面孔/马甲。
        **不新建角色**：memberIds 留空，页面显示「冰室群成员」，
        站长在编辑器里手动认领（站里已有 16 条就是这个状态）。
        设了 SALON_UNKNOWN 才会挂到指定成员上。
      */
      memberIdList = UNKNOWN_NAME ? [memberOf(UNKNOWN_NAME).id] : [];
      unknownPinned.push({ id, names: speakers.unknown.slice(0, 4) });
      chatScoped++;
    } else {
      /* 没图，或者是张网图/游戏截图（OCR 也认不出人）→ 按老规矩归发送人 */
      const qqName = qqMap[it.senderId];
      const hitMember = qqName ? byAlias.get(qqName) : matchName(it.senderNick, byAlias);
      /*
        ⚠ 只有「真的不知道是谁」才报 unknown。
        aliases.json 的 qq 区已经写了名字、但站里还没这个成员（比如 `铃忆`），
        属于「知道是谁、只是要新建」，不算认不出来 —— 否则报告里会又出现
        「新成员：铃忆」又出现「3821785356 认不出来」，自相矛盾。
      */
      if (!hitMember && !qqName) unknown.set(it.senderId || '(空)', it.senderNick || '(空)');
      const name = qqName || hitMember?.name || it.senderNick;
      if (!name) continue;
      memberIdList = [memberOf(name).id];
    }
    if (!memberIdList.length && !images.length) continue;

    const entry = {
      id,
      memberIds: memberIdList,
      kind: isOcr ? 'perfect' : 'text',
      date: it.date,
      time: it.time || '',
      text: finalText || '',
      ...(isOcr ? { ocr: true } : {}),
      images,
      eraId: eraIdFor(it.date, file.eras),
    };
    file.essences.push(entry);
    seen.add(key);
    const wk = `${entry.date}|${entry.time || ''}`;
    const arr = byWhen.get(wk) ?? [];
    arr.push({ text: normText(entry.text) });
    byWhen.set(wk, arr);
    added.push(entry);
  }

  /* ---- 排序 + updated ---- */
  file.essences.sort((a, b) =>
    `${a.date} ${a.time || '00:00'}`.localeCompare(`${b.date} ${b.time || '00:00'}`) || String(a.id).localeCompare(String(b.id)));
  const maxDate = file.essences.reduce((acc, e) => (e.date > acc ? e.date : acc), String(file.updated || ''));
  if (maxDate !== String(file.updated || '')) file.updated = maxDate;

  /* ---- 报告 ---- */
  console.log('');
  console.log(`新增 ${added.length} 条${added.length ? `（${added[0].id}…${added[added.length - 1].id}）` : ''}`);
  console.log(`跳过 ${skipped.length} 条`);
  const byWhy = new Map();
  for (const s of skipped) byWhy.set(s.why, (byWhy.get(s.why) ?? 0) + 1);
  for (const [why, n] of byWhy) console.log(`   · ${why}：${n} 条`);
  console.log(`图片：${DRY ? '会写入' : '写入'} ${imgWritten} 张，${(imgBytes / 1048576).toFixed(1)} MB${imgFailed ? `，**失败 ${imgFailed} 张**（url 过期且换新链接也没成，条目还是加进去了，图缺着）` : ''}`);
  console.log(`新成员：${newMembers.length ? newMembers.map((m) => m.name).join('、') : '（没有新的）'}`);
  if (chatScoped) console.log(`按「图里说话的人」归属：${chatScoped} 条（这些**不含**截图的人，除非他本人也在图里）`);
  if (unknownPinned.length) {
    console.log('');
    console.log(`⚠ 聊天截图但图里一个成员都没认出来 → memberIds 留空（页面显示「冰室群成员」），等你在编辑器里认领：`);
    for (const u of unknownPinned) console.log(`   ${u.id}${u.names.length ? `  （图里出现的名字：${u.names.join('、')}）` : ''}`);
  }
  if (needsReview.length) {
    console.log('');
    console.log('⚠ 这些条目的图没下下来（rkey 过期且换链接也失败），**归属可能不准**，建议手工看一眼：');
    for (const u of needsReview) console.log(`   ${u.id}  ${u.why}`);
  }
  if (unknown.size) {
    console.log('');
    console.log('⚠ 这些 QQ 号认不出来（回头补进 tools/salon/aliases.json）：');
    for (const [qq, nick] of unknown) console.log(`   ${qq}  →  ${nick}`);
  }
  console.log(`总数：精华 ${data.essences?.length ?? 0} → ${file.essences.length}，成员 ${data.members?.length ?? 0} → ${file.members.length}`);
  if (file.updated !== data.updated) console.log(`数据截止：${data.updated || '(空)'} → ${file.updated}`);

  if (DRY) { console.log('\n（--dry：什么都没写）'); return; }
  if (!added.length) { console.log('\n没有新东西，不写盘。'); return; }

  try { fs.copyFileSync(SALON_FILE, `${SALON_FILE}.bak`); } catch { /* 第一次没备份，正常 */ }
  fs.writeFileSync(SALON_FILE, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  console.log(`\n已写入 ${path.relative(PROJ, SALON_FILE)}`);
}

main().catch((err) => {
  console.error(`同步失败：${err?.message || err}`);
  process.exit(1);
});
