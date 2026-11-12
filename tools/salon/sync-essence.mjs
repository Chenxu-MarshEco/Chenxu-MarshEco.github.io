/**
 * 群精华 → 站点数据：从 NapCat 的 HTTP 接口直接拉「燃儿求开组」的精华，
 * **增量**并进 `src/data/salon.json`（2026-11-12 加）。
 *
 *   node tools/salon/sync-essence.mjs --probe     # 只打印接口原始返回，什么都不写
 *   node tools/salon/sync-essence.mjs --dry       # 算一遍，报告会加什么，不写盘
 *   node tools/salon/sync-essence.mjs             # 真写（salon.json + 图片）
 *
 * 和 tools/salon/import-more.mjs 的区别：
 *   那份吃的是「月度导出 HTML」，要人先导出再喂进来；
 *   这份直接问 NapCat 要，**每月 1 号自动跑**（Windows 计划任务）。
 *   两者共用 merge.mjs 的去重规则（essenceKey / looksSame），所以混着用不会重复。
 *
 * 三条规矩（和 import-more 一致）：
 *   ① **只增不改**：已有的 806 条一个字节都不动，新条目从 e0807 往后接；
 *   ② **去重**：日期 + 时刻 + 正文（去掉空白和 `- ` 项目符号）一样 = 同一条；
 *      同一时刻正文 90% 以上重合也算同一条（导出管线偶尔弄坏一两个字）；
 *   ③ **成员按名字或别名认**：认不出来就新建一个空头像成员，回头在编辑器里补。
 *
 * 增量而不是「按上个月切」：精华是**事后**设的（10 月 5 号可能把 9 月 20 号的话设成精华），
 * 按自然月切会永远漏掉这种；而且某次跑失败，下个月会自动补上，不会丢一个月。
 *
 * 图片**必须存**（QQ 的图片链接带 rkey，过期就没了），存成
 * `public/img/salon/<id>-<序号>.<ext>`，和站里已有的 297 张同一个命名法。
 *
 * 聊天截图类（有图、正文很短）会调 NapCat 的 `/ocr_image` 把字抠出来当正文，
 * 并打上 `ocr: true`（站里已有 19 条是这么来的）。
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
/** 只收这一天（含）之后的精华 —— 站里 2026-09-30 及以前已经有了 */
const SINCE = process.env.SALON_SINCE || '2026-10-01';
/** 正文短于这个字数、又有图的，就当「聊天截图」，去 OCR */
const OCR_MAX_TEXT = 20;

const argv = process.argv.slice(2);
const PROBE = argv.includes('--probe');
const DRY = argv.includes('--dry') || PROBE;

/* ---------------- 小工具 ---------------- */
const pad = (n) => String(n).padStart(2, '0');

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
    else if (t === 'image') images.push({ url: String(d.url || d.file || ''), file: String(d.file || '') });
    else if (t === 'at') text += `@${d.qq ?? ''} `;
    else if (t === 'face' || t === 'mface') text += '[表情]';
    else if (t === 'reply') { /* 引用不落正文 */ }
    else if (t === 'file') text += `[文件 ${d.name || d.file || ''}]`;
  }
  return { text: text.replace(/\s+$/g, '').trim(), images };
}

/**
 * 剥掉群名片上的装饰：emoji、符号、空白。
 * 真实数据里 sender_nick 长这样：「🏗隰辰煦🏗」「👆ミスタ」「亚卡莱特」
 * 站里成员叫「隰辰煦」，所以不剥就一个都对不上。
 */
function cleanNick(s) {
  return String(s ?? '')
    /* emoji 与各种符号（含变体选择符、零宽连接符） */
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, '')
    /* 装饰用的框线、箭头、几何符号、中英文括号 */
    .replace(/[◆◇■□▲△▼▽★☆♦♠♣♥♪♫※→←↑↓↔⇒⇔]/g, '')
    .replace(/[【】\[\]（）()「」『』]/g, '')
    .replace(/\s+/g, '')
    .trim();
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

/** 下载一张图，返回 { buf, ext } */
async function download(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = String(res.headers.get('content-type') || '').toLowerCase();
  let ext = 'jpg';
  if (ct.includes('png')) ext = 'png';
  else if (ct.includes('gif')) ext = 'gif';
  else if (ct.includes('webp')) ext = 'webp';
  else {
    const m = /\.(jpe?g|png|gif|webp|bmp)(?:\?|$)/i.exec(url);
    if (m) ext = m[1].toLowerCase().replace('jpeg', 'jpg');
  }
  return { buf, ext };
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
  console.log(`接口 ${API}  群 ${GROUP_ID}  起始 ${SINCE}`);
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
  for (const m of file.members) {
    if (m?.name) byAlias.set(String(m.name), m);
    for (const a of Array.isArray(m?.aliases) ? m.aliases : []) byAlias.set(String(a), m);
  }
  /* nick 区只补站里没有的（站里以 salon.json 为准） */
  for (const [nick, name] of Object.entries(nickMap)) {
    if (!byAlias.has(nick) && byAlias.has(name)) byAlias.set(nick, byAlias.get(name));
  }
  const usedMemberIds = new Set(file.members.map((m) => String(m.id || '')));
  const newMembers = [];
  const unknown = new Map(); // QQ号 → 群名片，报告用
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

  /* ---- 逐条 ---- */
  for (const r of raw) {
    const it = normalize(r);
    if (!it.date) { skipped.push({ ...it, why: '没有时间戳' }); continue; }
    if (it.date < SINCE) { skipped.push({ ...it, why: `早于 ${SINCE}` }); continue; }

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
    for (let k = 0; k < it.images.length; k++) {
      const im = it.images[k];
      if (!im.url) continue;
      try {
        const { buf, ext } = await download(im.url);
        const name = `${id}-${k + 1}.${ext}`;
        images.push(`/img/salon/${name}`);
        if (!DRY) {
          fs.mkdirSync(IMG_DIR, { recursive: true });
          fs.writeFileSync(path.join(IMG_DIR, name), buf);
        }
        imgWritten++;
        imgBytes += buf.length;
      } catch (err) {
        console.warn(`  ⚠ ${id} 第 ${k + 1} 张图下载失败：${err.message}`);
      }
    }

    /* 聊天截图：有图、正文很短 → OCR 抠字 */
    let finalText = it.text;
    let isOcr = false;
    if (images.length && normText(it.text).length < OCR_MAX_TEXT && it.images[0]?.url) {
      const got = await ocr(it.images[0].url);
      if (got.trim()) {
        finalText = got.trim();
        isOcr = true;
      }
    }

    /* 成员：先查 QQ 号对照表，再按群名片/马甲认 */
    if (skipMap[it.senderId]) { skipped.push({ ...it, why: `skip 名单：${skipMap[it.senderId]}` }); continue; }
    const name = qqMap[it.senderId] || it.senderNick;
    if (!name) { unknown.set(it.senderId || '(空)', it.senderNick || '(空)'); continue; }
    if (!qqMap[it.senderId] && !byAlias.has(name)) unknown.set(it.senderId, it.senderNick);

    const entry = {
      id,
      memberIds: [memberOf(name).id],
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
  console.log(`图片：写入 ${imgWritten} 张，${(imgBytes / 1048576).toFixed(1)} MB`);
  console.log(`新成员：${newMembers.length ? newMembers.map((m) => m.name).join('、') : '（没有新的）'}`);
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
