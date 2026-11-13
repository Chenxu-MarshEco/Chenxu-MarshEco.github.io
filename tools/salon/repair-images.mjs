/**
 * 补回精华里缺失的图片（2026-11-13 加）。
 *
 * 为什么需要单独一支：
 *   `sync-essence.mjs` 是**只增不改**的 —— 图没下下来的条目照样写进 salon.json，
 *   以后再跑一遍会被「站里已经有这一条了」跳过。所以**重跑永远补不回缺的图**，
 *   必须有一个「拿原始精华逐条对账、按 id 回头补」的入口。
 *
 * 对账口径：原始精华里这条有 N 张图，站里这条只有 M 张（或图文件不存在）→ 缺 N-M 张。
 *   ⚠ 2026-11-12 那 5 条里有 1 条（e0824）正文是好的、只是图没下下来，
 *   光看站里数据长得跟普通纯文字精华一模一样，**只能靠对账**才发现。
 *
 * 用法（在跑 NapCat 的那台机器上）：
 *   node tools/salon/repair-images.mjs --month 2026-10            # 只探测，报每张图每种路子拿到什么
 *   node tools/salon/repair-images.mjs --month 2026-10 --write    # 成功的落盘 + 回填 salon.json
 *   node tools/salon/repair-images.mjs --month 2026-10 --dump     # 额外打印原始条目 JSON（诊断用）
 *
 * 探测的路子（全部失败才算失败）：
 *   ① 精华数据里自带的 url
 *   ② 同一 url，appid 在 1406（群图）/ 1407（私聊图）之间互换
 *      —— QQ 图床对这两种 appid 是分开的，签错那一个的表现就是**同一条链接恒定 404**
 *   ③ 同一 url，spec=0 / spec=1 互换（原图 / 缩略图）
 *   ④ get_image（分别传 file、file_id）
 *   ⑤ get_msg 重新取消息，用里面**新的** url / file / file_id 再来一轮（message_id 字符串、数字各试一次）
 *   ⑥ 流式接口（download_image_stream / get_image_stream，有就试）
 * 每条候选再换两套请求头（浏览器 / QQ）各试一次。
 *
 * 落盘格式**只看字节**（sniffExt），不信 URL 里的扩展名 —— QQ 的下载链接根本不带扩展名，
 * 以前一律按 .jpg 存，真身是 PNG 的照片就成了「扩展名是 jpg 的 PNG」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, '..', '..');
const SALON_FILE = path.join(PROJ, 'src', 'data', 'salon.json');
const IMG_DIR = path.join(PROJ, 'public', 'img', 'salon');

const API = (process.env.SALON_API || 'http://127.0.0.1:3003').replace(/\/+$/, '');
const API_TOKEN = process.env.SALON_API_TOKEN || '';
const GROUP_ID = Number(process.env.SALON_GROUP || 752855970);

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const DUMP = argv.includes('--dump');
/** 顺手把「有图但没有文字」的条目重新 OCR 一遍（2026-11-13 加：10 月那批 OCR 全军覆没） */
const DO_OCR = argv.includes('--ocr') || argv.includes('--all');
/** 删掉图没下下来时留下的重复空条目 */
const DO_DEDUPE = argv.includes('--dedupe') || argv.includes('--all');
/**
 * 重新算归属（2026-11-13 加）。
 *
 * 站长 2026-11-12 定的规矩，一条都没变：
 *   · 一条精华如果是**聊天截图**，它属于**图里说话的那几个人**，不属于截图的人；
 *   · 图里认不出的（网图 / 游戏截图 / 生面孔）→ **不新建角色**，`memberIds` 留空，
 *     页面显示「冰室群成员」，等站长在编辑器里手改；
 *   · 一个字都认不出来的（OCR 彻底失败）→ 保持原样，别瞎改。
 *
 * 为什么现在要重算：10 月那 11 张图 OCR 全军覆没，于是全部按「发送人」归了，
 * 这正是站长 2026-11-13 指出的第三个问题。
 */
const DO_ATTR = argv.includes('--attr') || argv.includes('--all');
/**
 * 揪出「扩展名和真身对不上」的图（2026-11-13 加）。
 *
 * 10 月那批里 `e0818-1.png`、`e0809-1.png` 真身是 JPEG —— 旧代码信 URL 上的
 * `.png`，就把 JPEG 字节存成了 .png。浏览器不一定看得出来，但任何按扩展名
 * 判断类型的环节（图床 MIME、压缩、后续处理）都会被它骗过去。
 * 所以按字节改名，顺手把 salon.json 里的路径一起改掉。
 */
const DO_FIXEXT = argv.includes('--fixext') || argv.includes('--all');
/** 不连 NapCat（图已经从本机 QQ 缓存收回来了，只想在本地认字 / 算归属 / 去空壳） */
const NO_API = argv.includes('--no-api');
/**
 * OCR 用谁：`napcat`（默认，走服务器的 ocr_image）还是 `win`（Windows.Media.Ocr，本机离线）。
 * ⚠ 2026-11-13 实测：这台服务器的 NapCat `ocr_image` 是坏的，三种传法都返回空，
 *   而 Windows 自带 OCR 装上中文包就能认，所以本机收图时走 `win`。
 */
const OCR_ENGINE = (() => {
  const a = argv.find((x) => x.startsWith('--ocr-engine='));
  return a ? a.split('=')[1] : 'napcat';
})();
const MONTH = (() => {
  const at = argv.indexOf('--month');
  if (at >= 0) return argv[at + 1];
  const nowB = new Date(Date.now() + 8 * 3600 * 1000);
  const y = nowB.getUTCFullYear();
  const m = nowB.getUTCMonth() + 1;
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, '0')}`;
})();

const pad = (n) => String(n).padStart(2, '0');
const safeJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

function bjParts(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return { date: '', time: '' };
  const d = new Date((n + 8 * 3600) * 1000);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

async function call(action, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (API_TOKEN) headers.Authorization = `Bearer ${API_TOKEN}`;
  const res = await fetch(`${API}/${action}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${action} HTTP ${res.status}：${text.slice(0, 160)}`);
  try { return JSON.parse(text); } catch { throw new Error(`${action} 返回的不是 JSON：${text.slice(0, 160)}`); }
}

/** 图片格式：只看字节 */
function sniffExt(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 2 && buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp';
  return '';
}

const UA = {
  browser: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36' },
  qq: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) QQ/9.9.15.30974',
    Referer: 'https://qun.qq.com/',
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  },
};

async function probeUrl(url, uaName) {
  try {
    const res = await fetch(url, { headers: UA[uaName], redirect: 'follow' });
    const type = res.headers.get('content-type') || '';
    if (!res.ok) {
      await res.arrayBuffer().catch(() => {});
      return { ok: false, note: `HTTP ${res.status}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = sniffExt(buf);
    if (!ext) return { ok: false, note: `200 但不是图（${buf.length} 字节，${type || '无类型'}）` };
    return { ok: true, buf, ext };
  } catch (e) {
    return { ok: false, note: `请求失败：${e.message.slice(0, 60)}` };
  }
}

function variants(url) {
  const out = [{ why: '原样', url }];
  try {
    const u = new URL(url);
    const appid = u.searchParams.get('appid');
    if (appid === '1406' || appid === '1407') {
      const v = new URL(url);
      v.searchParams.set('appid', appid === '1406' ? '1407' : '1406');
      out.push({ why: `appid=${v.searchParams.get('appid')}`, url: v.toString() });
    }
    const spec = u.searchParams.get('spec');
    if (spec !== null) {
      const v = new URL(url);
      v.searchParams.set('spec', spec === '0' ? '1' : '0');
      out.push({ why: `spec=${v.searchParams.get('spec')}`, url: v.toString() });
    }
  } catch { /* 不是合法 url */ }
  return out;
}

/**
 * 让 NapCat 认图里的字。
 *
 * ⚠ 2026-11-12 的教训：只传 `{image: url}` 时 10 月那 11 张**一张都没认出来**，
 * 而且被 catch 吞掉、报告里连个字都不提，于是「有图没字」直接上线了。
 * 所以这里把几种传法都试一遍，并且**失败一定要说出来**。
 */
async function ocrImage(shapes) {
  const tried = [];
  for (const [why, body] of shapes) {
    try {
      const json = await call('ocr_image', body);
      const d = json?.data ?? {};
      const raw = d.texts ?? d.text ?? d.words ?? d.result ?? d.items ?? [];
      let text = '';
      if (Array.isArray(raw)) text = raw.map((t) => (typeof t === 'string' ? t : t?.text ?? t?.word ?? '')).filter(Boolean).join('\n');
      else text = String(raw || '');
      text = text.trim();
      if (text) return { ok: true, text, why };
      tried.push(`${why} → 返回空`);
    } catch (e) {
      tried.push(`${why} → ${e.message.slice(0, 70)}`);
    }
  }
  return { ok: false, tried };
}

/** 去中文之间的空格（Windows OCR 会把每个汉字用空格隔开，不清掉读起来是「群 主 的 小 鸡 鸡」） */
function tightenCjk(s) {
  const CJK = '\\u4e00-\\u9fff\\u3000-\\u303f\\uff00-\\uffef';
  return String(s)
    .replace(new RegExp(`([${CJK}])[ \\t]+(?=[${CJK}])`, 'g'), '$1')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

/** 用 Windows 自带 OCR 认一张本地图（依赖 tools/salon/ocr-local.ps1 + 中文 OCR 语言包） */
function ocrWin(absPath) {
  const script = path.join(HERE, 'ocr-local.ps1');
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Path', absPath],
    { encoding: 'utf8', timeout: 120000 },
  );
  const lines = String(out)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(LANG|LINES)=/.test(l) && l !== 'NO_OCR_ENGINE');
  return lines.length ? tightenCjk(lines.join('\n')) : '';
}

async function fetchAll() {
  const out = [];
  const seen = new Set();
  for (let page = 0; page < 50; page++) {
    let json;
    try {
      json = await call('get_essence_msg_list', page === 0 ? { group_id: GROUP_ID } : { group_id: GROUP_ID, page });
    } catch (e) { if (page === 0) throw e; break; }
    const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.data?.msg_list) ? json.data.msg_list : [];
    if (!list.length) break;
    let fresh = 0;
    for (const it of list) {
      const k = `${it?.msg_seq ?? ''}|${it?.message_id ?? ''}|${it?.sender_id ?? ''}`;
      if (seen.has(k)) continue;
      seen.add(k); out.push(it); fresh++;
    }
    if (!fresh) break;
  }
  return out;
}

function imagesOf(raw) {
  const segs = typeof raw?.content === 'string' ? safeJson(raw.content) : raw?.content;
  const out = [];
  if (!Array.isArray(segs)) return out;
  for (const s of segs) {
    if (s?.type !== 'image') continue;
    const d = s.data ?? {};
    out.push({ url: String(d.url || ''), file: String(d.file || ''), fileId: String(d.file_id || d.fileId || '') });
  }
  return out;
}

const existsImg = (u) => fs.existsSync(path.join(PROJ, 'public', String(u).replace(/^\//, '').replace(/\//g, path.sep)));

/* ---------------- 归属用的名义表 ---------------- */

/** 和 sync-essence.mjs 同一套白名单清洗（emoji / 不可见填充符一律剥掉） */
function cleanNick(s) {
  return String(s ?? '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .replace(/[\u{115F}\u{1160}\u{3164}\u{FFA0}]/gu, '')
    .trim();
}

/** 名字 / 别名 / aliases.json 的马甲 → 成员 */
function buildAliasMap(data) {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(path.join(HERE, 'aliases.json'), 'utf8')); } catch { /* 没有就算了 */ }
  const members = Array.isArray(data.members) ? data.members : [];
  const byAlias = new Map();
  const put = (k, m) => {
    if (!k) return;
    byAlias.set(String(k), m);
    const c = cleanNick(k);
    if (c && !byAlias.has(c)) byAlias.set(c, m);
  };
  for (const m of members) {
    if (m?.name) put(m.name, m);
    for (const a of Array.isArray(m?.aliases) ? m.aliases : []) put(a, m);
  }
  for (const [nick, name] of Object.entries(file.nick ?? {})) {
    const target = members.find((m) => m.name === name || (Array.isArray(m?.aliases) ? m.aliases : []).includes(name));
    if (target) put(nick, target);
  }
  return { byAlias, members };
}

/**
 * 从 OCR 文本里挑出「说话的人」：把认得出的成员名/马甲扫一遍，出现过的就算。
 * 长名字先匹配（免得「亚卡莱特」被短别名抢走），命中后从待搜文本里抹掉。
 */
function pickSpeakers(text, byAlias) {
  const raw = String(text || '');
  if (!raw.trim()) return { members: [], unknown: [] };
  const keys = [...byAlias.keys()].filter((k) => k.length >= 2).sort((a, b) => b.length - a.length);
  const hit = new Map();
  let rest = raw;
  for (const k of keys) {
    if (!rest.includes(k)) continue;
    const m = byAlias.get(k);
    if (!m) continue;
    if (!hit.has(m.id)) hit.set(m.id, m);
    rest = rest.split(k).join('\u0000');
  }
  const unknown = [];
  for (const line of raw.split('\n').map((s) => s.trim()).filter(Boolean)) {
    const mm = /^([^\s：:]{2,12})[：:]/.exec(line);
    if (mm && !byAlias.has(mm[1])) unknown.push(mm[1]);
  }
  return { members: [...hit.values()], unknown: [...new Set(unknown)] };
}

/**
 * 这段 OCR 文本看着像不像**QQ/游戏聊天截图**（2026-11-13 加）。
 *
 * 为什么需要：站长定的规矩有两条分支——
 *   · 聊天截图 → 归**图里说话的人**，认不出就留空当「未知」等他手改；
 *   · 网图 / 游戏截图 / AI 画 → **归发送人**。
 * 只看「认不认得出人名」分不开这两类：`e0818` 是张豆包 AI 插画，OCR 只认出水印「豆包」，
 * 按老逻辑会被当成「聊天截图但全是生面孔」，把归属清空 —— 其实它就该归发送人。
 *
 * 判据（宽松一点，宁可判成聊天图）：出现 `<昵称>`、出现时刻、或者多行里有多行带「名字：」。
 */
function looksLikeChatScreen(text) {
  const raw = String(text || '');
  const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return false;
  if (/<\s*[A-Za-z0-9_\u4e00-\u9fff]+\s*>/.test(raw)) return true;
  const named = lines.filter((l) => /^[^\s：:]{1,14}[：:]/.test(l)).length;
  if (named >= 2) return true;
  /*
    ⚠ **别拿「出现时刻」当聊天证据**（2026-11-13 站长指出）：
    `e0808` 是「加好友通知卡片」——「今天」+ 头像 + 昵称 + `00:49 带着北阴酆都大帝…`，
    长得跟聊天很像，其实不是聊天，该归发送人（桑芙）。它一共只有 3 行。
    真正的聊天截图通常有好几行消息，所以用行数兜底就行了。
  */
  return lines.length >= 4;
}

/* ---------------- 主流程 ---------------- */
const data = JSON.parse(fs.readFileSync(SALON_FILE, 'utf8'));
const entries = data.essences.filter((e) => String(e.date || '').startsWith(MONTH));
if (!entries.length) {
  console.log(`${MONTH} 在站里没有条目，没什么可修的。`);
  process.exit(0);
}
console.log(`月份 ${MONTH}  接口 ${NO_API ? '（--no-api 不连）' : API}  群 ${GROUP_ID}  站里条目 ${entries.length}`);

/*
  「不许碰别的月份」基线（2026-11-13 加，站长要求立成硬规矩）：
  这支工具只该修 `--month` 说的那个月，其它月份（上个月、上上个月…）必须原样不动。
  写盘前逐个比对，发现别的月份被改/被删就拒绝写盘。
*/
const outsideSnap = new Map(
  data.essences
    .filter((e) => !String(e.date || '').startsWith(MONTH))
    .map((e) => [String(e.id), JSON.stringify(e)]),
);

let raw = [];
if (!NO_API) {
  raw = await fetchAll();
  console.log(`接口返回 ${raw.length} 条精华`);
  if (!raw.length) {
    /*
      ⚠ 一条都没返回时**绝对不能说「缺图 0」然后收工**（2026-11-13 踩到）：
      那次 NapCat 掉线（它自己的日志里写着「账号状态变更为离线」），
      接口给回空列表，脚本却报告「对账结果：缺图 0 条」，看着像全好。
    */
    console.log('');
    console.log('⚠ 接口一条精华都没返回 —— 多半是 NapCat 掉线或没同步到这个群。');
    console.log('  先确认 NapCat 在线（get_login_info / get_group_list 里有这个群），再重跑；这次不写盘。');
    process.exit(2);
  }
} else {
  console.log('（--no-api：不连 NapCat，只做本机能做的——本地图 OCR / 归属 / 去空壳 / 扩展名纠偏）');
}

const rawByWhen = new Map();
for (const r of raw) {
  const p = bjParts(r.operator_time);
  if (!p.date.startsWith(MONTH)) continue;
  const k = `${p.date}|${p.time}`;
  const arr = rawByWhen.get(k) ?? [];
  arr.push(r);
  rawByWhen.set(k, arr);
}
const entriesByWhen = new Map();
for (const e of entries) {
  const k = `${e.date}|${e.time || ''}`;
  const arr = entriesByWhen.get(k) ?? [];
  arr.push(e);
  entriesByWhen.set(k, arr);
}

/* ---- 对账：原始图数 vs 站里图数（或图文件其实不在盘上） ---- */
const repairList = [];
const complete = [];
for (const [k, raws] of rawByWhen) {
  const want = Math.max(...raws.map((r) => imagesOf(r).length), 0);
  if (!want) continue;
  const list = entriesByWhen.get(k) ?? [];
  if (!list.length) continue;                       /* 这条没进站（早于窗口/被 skip），跳过 */
  /* 同一时刻有两条（旧 bug 留下的重复）时，优先挑**图片多的那条**，其次挑有正文的 */
  const pick = [...list].sort((a, b) => (b.images ?? []).length - (a.images ?? []).length || String(b.text || '').length - String(a.text || '').length)[0];
  const have = Array.isArray(pick.images) ? pick.images : [];
  const gone = have.filter((u) => !existsImg(u));
  if (have.length >= want && !gone.length) { complete.push(pick.id); continue; }
  repairList.push({ entry: pick, want, have, gone, raws });
}

if (!NO_API) {
  console.log('');
  console.log(`对账结果：完整 ${complete.length} 条，**缺图 ${repairList.length} 条**`);
}
for (const r of repairList) {
  console.log(`   ${r.entry.id}  ${r.entry.date} ${r.entry.time || ''}  应 ${r.want} 张 / 实 ${r.have.length} 张${r.gone.length ? `（其中 ${r.gone.length} 个文件不在盘上）` : ''}  正文=${JSON.stringify(String(r.entry.text || '').slice(0, 20))}`);
}

/* 顺带报一下重复空壳 */
const shells = [];
for (const [k, raws] of rawByWhen) {
  const list = entriesByWhen.get(k) ?? [];
  if (list.length < 2) continue;
  const want = Math.max(...raws.map((r) => imagesOf(r).length), 0);
  const emptyOnes = list.filter((e) => !(e.images ?? []).length && !String(e.text || '').trim());
  if (emptyOnes.length && want) shells.push({ key: k, empty: emptyOnes, keep: list.filter((e) => !emptyOnes.includes(e)) });
}
if (shells.length) {
  console.log('');
  console.log(`重复空壳：${shells.length} 组（真图补回来之后，这些空条目要删掉）`);
  for (const s of shells) console.log(`   ${s.key} → 删 ${s.empty.map((e) => e.id).join(', ')}`);
}

if (repairList.length) {
  console.log('');
  console.log('===== 开始探测缺的图 =====');
}

let fixed = 0;
let failed = 0;

for (const job of repairList) {
  const e = job.entry;
  console.log('');
  console.log(`---- ${e.id}  ${e.date} ${e.time || '--:--'}  应 ${job.want} 张 / 实 ${job.have.length} 张`);

  /* 这条原始精华的图段（多条原始消息同刻时合并） */
  const ims = job.raws.flatMap((r) => imagesOf(r));
  if (DUMP) {
    console.log('   原始条目：');
    console.log(JSON.stringify(job.raws[0], null, 2).slice(0, 2000));
  }

  for (let idx = 0; idx < ims.length; idx++) {
    const im = ims[idx];
    const existing = job.have[idx];
    if (existing && existsImg(existing)) {
      console.log(`   第 ${idx + 1} 张：已在盘上（${existing}），跳过`);
      continue;
    }
    if (!im.url && !im.file && !im.fileId) {
      console.log(`   第 ${idx + 1} 张：原始数据里没有 url / file，没法取`);
      failed++;
      continue;
    }

    const attempts = [];
    const cands = [];
    for (const v of variants(im.url)) cands.push({ why: `原始 url/${v.why}`, url: v.url });

    /* get_image */
    for (const argName of ['file', 'file_id']) {
      const val = argName === 'file' ? im.file : im.fileId;
      if (!val) continue;
      try {
        const json = await call('get_image', { [argName]: val });
        const d = json?.data ?? {};
        const u = String(d.url ?? '');
        const f = String(d.file ?? '');
        const b64 = String(d.base64 ?? '');
        if (b64 && b64.length > 100) {
          const buf = Buffer.from(b64.replace(/^data:[^,]+,/, ''), 'base64');
          const ext = sniffExt(buf);
          attempts.push(ext
            ? { why: `get_image(${argName}) base64`, ok: true, buf, ext }
            : { why: `get_image(${argName}) base64`, ok: false, note: '给了 base64 但不是图片' });
        }
        if (/^https?:/i.test(u)) for (const v of variants(u)) cands.push({ why: `get_image(${argName}) url/${v.why}`, url: v.url });
        if (f && !/^https?:/i.test(f) && fs.existsSync(f)) {
          const buf = fs.readFileSync(f);
          const ext = sniffExt(buf);
          if (ext) attempts.push({ why: `get_image(${argName}) 本地文件`, ok: true, buf, ext });
        }
        if (!u && !f && !b64) attempts.push({ why: `get_image(${argName})`, ok: false, note: `没给 url/file（${JSON.stringify(d).slice(0, 90)}）` });
      } catch (err) {
        attempts.push({ why: `get_image(${argName})`, ok: false, note: err.message.slice(0, 110) });
      }
    }

    /* get_msg */
    const mid = job.raws[0].message_id;
    if (mid) {
      for (const asString of [true, false]) {
        try {
          const json = await call('get_msg', { message_id: asString ? String(mid) : Number(mid) });
          const segs = json?.data?.message ?? json?.data?.content ?? [];
          const list = Array.isArray(segs) ? segs : [];
          const got = [];
          for (const s of list) {
            if (s?.type !== 'image') continue;
            const d = s.data ?? {};
            if (d.url) for (const v of variants(String(d.url))) got.push({ why: `get_msg(${asString ? 'str' : 'num'})/${v.why}`, url: v.url });
            if (d.file && /^[A-Za-z]:[\\/]/.test(String(d.file)) && fs.existsSync(String(d.file))) {
              const buf = fs.readFileSync(String(d.file));
              const ext = sniffExt(buf);
              if (ext) attempts.push({ why: `get_msg(${asString ? 'str' : 'num'}) 本地文件`, ok: true, buf, ext });
            }
          }
          if (!got.length && !attempts.some((a) => a.ok)) attempts.push({ why: `get_msg(${asString ? 'str' : 'num'})`, ok: false, note: `没有图片段（${list.length} 段）` });
          cands.push(...got);
        } catch (err) {
          attempts.push({ why: `get_msg(${asString ? 'str' : 'num'})`, ok: false, note: err.message.slice(0, 100) });
        }
      }
    }

    /* 流式接口 */
    for (const action of ['download_image_stream', 'get_image_stream']) {
      if (!im.file && !im.fileId) break;
      try {
        const json = await call(action, { file: im.file, file_id: im.fileId });
        attempts.push({ why: action, ok: false, note: `有响应，但没按图片处理（${JSON.stringify(json).slice(0, 80)}）` });
      } catch (err) {
        attempts.push({ why: action, ok: false, note: err.message.slice(0, 90) });
      }
    }

    let hit = attempts.find((a) => a.ok);
    const seenUrls = new Set();
    if (!hit) {
      for (const c of cands) {
        if (seenUrls.has(c.url)) continue;
        seenUrls.add(c.url);
        for (const uaName of ['browser', 'qq']) {
          const r = await probeUrl(c.url, uaName);
          attempts.push(r.ok
            ? { why: `${c.why} [${uaName}]`, ok: true, buf: r.buf, ext: r.ext, url: c.url }
            : { why: `${c.why} [${uaName}]`, ok: false, note: r.note });
          if (r.ok) { hit = attempts[attempts.length - 1]; break; }
        }
        if (hit) break;
      }
    }

    for (const a of attempts) {
      console.log(`     ${a.ok ? '✅' : '❌'} 第 ${idx + 1} 张 ${a.why}${a.ok ? ` → ${a.ext} ${a.buf.length} 字节` : ` → ${a.note}`}`);
    }

    if (!hit) {
      console.log(`     ✗ 第 ${idx + 1} 张：所有路子都没取到`);
      failed++;
      continue;
    }

    const name = `${e.id}-${idx + 1}.${hit.ext}`;
    console.log(`     → 存成 ${name}`);
    if (WRITE) {
      fs.mkdirSync(IMG_DIR, { recursive: true });
      fs.writeFileSync(path.join(IMG_DIR, name), hit.buf);
      e.images = Array.isArray(e.images) ? e.images : [];
      e.images[idx] = `/img/salon/${name}`;
      e.images = e.images.filter(Boolean);
    }
    fixed++;
  }
}

console.log('');
if (repairList.length) console.log(`===== 补图：${fixed} 张成功 / ${failed} 张失败 =====`);

/** 落盘前的原始条数（下面删空壳会改 data.essences，报告里要能看到「删了几条」） */
const entriesBefore = data.essences.length;

let changed = false;
let ocrDone = 0;
let ocrFail = 0;
const ocrFailedList = [];

/* ---------------- OCR：有图但没有文字的条目，就地补文字 ---------------- */
if (DO_OCR) {
  /* 已经有 OCR 文本的不再重认（以前每跑一次就把上一轮的正文当「说明」再拼一遍，越跑越长） */
  const need = entries.filter((e) => (e.images ?? []).length && (!String(e.text || '').trim() || (!e.ocr && String(e.text || '').trim().length < 20)));
  console.log('');
  console.log(`===== OCR：有图但没文字（或文字太少）的条目 ${need.length} 条 =====`);
  for (const e of need) {
    const rel = e.images[0];
    const abs = path.join(PROJ, 'public', String(rel).replace(/^\//, '').replace(/\//g, path.sep));
    if (!fs.existsSync(abs)) {
      console.log(`   ✗ ${e.id} ${e.date} 图不在盘上（${rel}），跳过 OCR`);
      ocrFail++;
      ocrFailedList.push(`${e.id}（图不在盘上）`);
      continue;
    }
    const buf = fs.readFileSync(abs);
    const shapes = [
      ['本地路径', { image: abs }],
      ['file:// 形式', { image: `file:///${abs.replace(/\\/g, '/')}` }],
      ['base64', { image: `base64://${buf.toString('base64')}` }],
      ['原始 url 形状', { image: String(e.ocrSource || '') }],
    ].filter(([, b]) => b.image);

    let got;
    if (OCR_ENGINE === 'win') {
      const t = ocrWin(abs);
      got = t ? { ok: true, text: t, why: 'Windows OCR' } : { ok: false, tried: ['Windows OCR → 一个字都没认出'] };
    } else {
      got = await ocrImage(shapes);
    }
    if (got.ok) {
      /*
        正文形状跟**往期 perfect 条目**一致：每行一条、行首 `- `（站点按列表渲染）。
        条目原来就有短正文的（比如 e0824 那句「ssw，你在那里干什么呢？」），
        把它放在第一段保留，别被 OCR 冲掉。
      */
      const caption = e.ocr ? '' : String(e.text || '').trim();
      const ocrLines = got.text.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => (s.startsWith('- ') ? s : `- ${s}`));
      e.text = (caption && caption.length >= 2 ? `${caption}\n\n${ocrLines.join('\n')}` : ocrLines.join('\n'));
      e.ocr = true;
      e.kind = 'perfect';
      changed = true;
      ocrDone++;
      const firstLine = ocrLines[0] || '';
      console.log(`   ✅ ${e.id} ${e.date} ${e.time || ''}  用「${got.why}」认出 ${got.text.length} 字：${firstLine.slice(0, 40)}`);
    } else {
      ocrFail++;
      ocrFailedList.push(e.id);
      console.log(`   ✗ ${e.id} ${e.date} ${e.time || ''}  四种传法都失败：`);
      for (const t of got.tried) console.log(`        ${t}`);
    }
  }
  console.log(`   OCR 结果：成功 ${ocrDone} 条 / 失败 ${ocrFail} 条`);
}

/* ---------------- 归属：聊天截图归图里说话的人 ---------------- */
let attrChanged = 0;
if (DO_ATTR) {
  const { byAlias } = buildAliasMap(data);
  const imgEntries = entries.filter((e) => (e.images ?? []).length);
  console.log('');
  console.log(`===== 归属：有图的条目 ${imgEntries.length} 条（归图里说话的人，不归截图的人） =====`);
  for (const e of imgEntries) {
    const text = String(e.text || '');
    const got = pickSpeakers(text, byAlias);
    const before = JSON.stringify(e.memberIds ?? []);
    /*
      ⚠ 只能改**真拿到 OCR 文字**的那些（2026-11-13 踩到）：
      10 月 e0820 的正文是「？？？」三个字，不是 OCR 出来的；
      按原逻辑会被当成「认不出人」把归属清空 —— 明明什么都没认出来，却把
      已经填好的成员删了。现在没 OCR 文本就一律不动。
    */
    if (!e.ocr) {
      console.log(`   · ${e.id} ${e.date} ${e.time || ''}  没有 OCR 文本，保持 ${before}`);
      continue;
    }
    if (!text.trim()) {
      /* 标了 ocr 却是空文本 —— 也不动，别瞎猜 */
      console.log(`   · ${e.id} ${e.date} ${e.time || ''}  OCR 文本为空，保持 ${before}`);
      continue;
    }
    const chat = looksLikeChatScreen(text);
    /*
      「图里贴的是**群外人**的 QQ」→ 这条归**发送人**（2026-11-13 站长定）。
      场景：群友截图吐槽某个群外人的言论，图里印着对方的 QQ 号。
      那个人不是群成员，把精华归给他是错的。认法：文本里出现 `QQ 1234567890` 这种。
    */
    const outsiderQQ = /QQ[^\d]{0,4}\d{5,12}/i.test(text);
    let why;
    if (got.members.length) {
      e.memberIds = got.members.map((m) => m.id);
      why = got.members.map((m) => m.name).join('、');
    } else if (outsiderQQ) {
      why = '图里是群外人的号 → 保持发送人';
    } else if (chat) {
      /* 聊天截图但图里全是生面孔 → 未知，memberIds 留空（页面显示「冰室群成员」），等站长手改 */
      e.memberIds = [];
      why = '未知（等手改）';
    } else {
      /* 不是聊天图（网图 / AI 画 / 游戏截图）→ 按老规矩归发送人，不动 */
      why = '不像聊天截图 → 保持发送人';
    }
    e.kind = 'perfect';
    e.ocr = true;
    const after = JSON.stringify(e.memberIds ?? []);
    if (after !== before) { attrChanged++; changed = true; }
    const extra = !got.members.length && got.unknown.length ? `  图里出现的名字：${got.unknown.slice(0, 4).join('、')}` : '';
    console.log(`   ${after === before ? '·' : '→'} ${e.id} ${e.date} ${e.time || ''}  ${before} → ${after}  【${why}】${extra}`);
  }
  console.log(`   归属变动 ${attrChanged} 条${attrChanged ? '' : '（没有要改的）'}`);

  /*
    最后把**手工指定**的覆盖上去（tools/salon/attribution-fixes.json）。
    没有这一步，重跑一次就把站长手改的归属冲掉了（2026-11-13 踩到）。
  */
  let fixes = {};
  try { fixes = JSON.parse(fs.readFileSync(path.join(HERE, 'attribution-fixes.json'), 'utf8')); } catch { /* 没有就算了 */ }
  let fixedN = 0;
  for (const [id, ids] of Object.entries(fixes)) {
    if (id.startsWith('_') || !Array.isArray(ids)) continue;
    const e = entries.find((x) => x.id === id);
    if (!e) continue;
    const before = JSON.stringify(e.memberIds ?? []);
    const after = JSON.stringify(ids);
    if (before === after) continue;
    e.memberIds = ids.slice();
    changed = true;
    fixedN++;
    console.log(`   ✎ ${id} 按 attribution-fixes.json 覆盖：${before} → ${after}`);
  }
  if (fixedN) console.log(`   手工指定覆盖 ${fixedN} 条`);
}

/* ---------------- 扩展名纠偏：按字节改回真身格式 ---------------- */
let renamed = [];
if (DO_FIXEXT) {
  console.log('');
  console.log('===== 扩展名纠偏（按字节判真身） =====');
  for (const e of entries) {
    const list = Array.isArray(e.images) ? e.images : [];
    for (let i = 0; i < list.length; i++) {
      const rel = list[i];
      const abs = path.join(PROJ, 'public', String(rel).replace(/^\//, '').replace(/\//g, path.sep));
      if (!fs.existsSync(abs)) continue;
      const real = sniffExt(fs.readFileSync(abs));
      if (!real) {
        console.log(`   ⚠ ${e.id} ${path.basename(abs)} 不是任何已知图片格式`);
        continue;
      }
      const cur = (path.extname(abs).slice(1) || '').toLowerCase().replace('jpeg', 'jpg');
      if (cur === real) continue;
      const target = abs.replace(/\.[^.\\/]+$/, '') + `.${real}`;
      const targetRel = rel.replace(/\.[^.\\/]+$/, '') + `.${real}`;
      console.log(`   ${e.id}  ${path.basename(abs)}（真身 ${real}）→ ${path.basename(target)}`);
      if (WRITE) {
        if (fs.existsSync(target)) {
          console.log(`      ⚠ ${path.basename(target)} 已存在，跳过改名`);
          continue;
        }
        fs.renameSync(abs, target);
        list[i] = targetRel;
        e.images = list;
        renamed.push(`${e.id}/${path.basename(target)}`);
        changed = true;
      } else {
        renamed.push(`${e.id}/${path.basename(target)}`);
      }
    }
  }
  if (!renamed.length) console.log('   （没有对不上的）');
}

/* ---------------- 去重：删掉图没下下来时留下的空壳 ---------------- */
let dropped = [];
if (DO_DEDUPE) {
  /*
    ⚠ 这里必须**重新**按当前状态算一遍，不能用上面那份 `shells`：
    首次跑的时候两个同刻条目都还是「无图无字」，分不清谁是空壳；
    等图补回来了，才看得出来「有图的那条留、没图的删」。
  */
  const byTime = new Map();
  for (const e of entries) {
    const k = `${e.date}|${e.time || ''}`;
    const arr = byTime.get(k) ?? [];
    arr.push(e);
    byTime.set(k, arr);
  }
  const drop = new Set();
  for (const arr of byTime.values()) {
    if (arr.length < 2) continue;
    const withImg = arr.filter((e) => (e.images ?? []).length);
    if (!withImg.length) continue;                       /* 一条都没图的时刻不动它 */
    for (const e of arr) {
      if ((e.images ?? []).length) continue;             /* 有图的留 */
      if (String(e.text || '').trim()) continue;         /* 有正文的是正经条目，别删 */
      drop.add(e.id);
    }
  }
  if (drop.size) {
    data.essences = data.essences.filter((e) => !drop.has(e.id));
    dropped = [...drop];
    changed = true;
    console.log('');
    console.log(`去重：删掉空壳条目 ${dropped.length} 条 → ${dropped.join(', ')}`);
  }
}

/* ---------------- 落盘 ---------------- */
console.log('');
if (!WRITE) {
  console.log('（没有 --write，什么都没写。确认上面的探测结果后再加 --write）');
} else if (!changed && !fixed) {
  console.log('没有改动，不写盘。');
} else {
  /* 「不许碰别的月份」硬校验（见上面 outsideSnap 的注释） */
  const touchedOther = [];
  for (const e of data.essences) {
    const k = String(e.id);
    if (!outsideSnap.has(k)) continue;
    if (outsideSnap.get(k) !== JSON.stringify(e)) touchedOther.push(k);
  }
  const lostOther = [...outsideSnap.keys()].filter((k) => !data.essences.some((e) => String(e.id) === k));
  if (touchedOther.length || lostOther.length) {
    console.error('');
    console.error(`❌ 保护性中止：这次会动到 ${MONTH} 以外月份的条目，所以什么都没写。`);
    if (touchedOther.length) console.error(`   被改动的：${touchedOther.slice(0, 8).join(', ')}`);
    if (lostOther.length) console.error(`   被删掉的：${lostOther.slice(0, 8).join(', ')}`);
    console.error('   这支工具只许修 --month 指定的那个月（站长 2026-11-13 的规矩）。');
    process.exit(4);
  }
  const before = entriesBefore;
  try { fs.copyFileSync(SALON_FILE, `${SALON_FILE}.bak`); } catch { /* 首次无备份 */ }
  fs.writeFileSync(SALON_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`已写入 src/data/salon.json（精华 ${before} → ${data.essences.length}${dropped.length ? `，删空壳 ${dropped.length} 条` : ''}，补图 ${fixed} 张，OCR ${ocrDone} 条）`);
  console.log(`其他月份 ${outsideSnap.size} 条逐个比对，全部原样未动`);
}
if (ocrFailedList.length) console.log(`⚠ OCR 仍失败的条目：${ocrFailedList.join('、')}`);
