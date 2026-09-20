/**
 * 把「群精华 图文版」的导出 HTML 整理成站点数据。
 *
 *   node tools/salon/import.mjs "<群精华_图文版.html>"
 *
 * 产出两份东西：
 *   src/data/salon.json          成员表 / 年代 / 精华条目（页面和编辑器都读它）
 *   public/img/salon/*.jpg       把内嵌的 base64 图片抽成真文件
 *
 * ⛔ 一条都不能丢。原文件里一共 784 条，三种：
 *   · 文字       732 条  `<p><b>成员　2023-01-10 19:44</b></p>` + <blockquote>
 *   · 完美对话    45 条  `<h4>🗨️ 完美对话　2023-07-13</h4>` + 聊天截图 + OCR 转录
 *   · AI 创作      7 条  和「文字」同样的形状，只是落在 `🤖 本年代 AI 创作（N）` 小节里
 *   小节标题（`<h2>🗨️ 本年代完美对话（N）</h2>` / `<h2>🤖 本年代 AI 创作（N）</h2>`）
 *   在原文件里是**嵌在某条消息的 div 里**的，所以不能按标签所属关系判类，只能顺序扫：
 *   看到「（N）」就知道**接下来 N 条**属于这个小节。
 *   每条都算出来的「年代 × 类别」条数必须和原文件 `<p style='color:#888'>` 那行注记
 *   （文字 59 / AI 0 / 完美对话 3 之类）逐项相等 —— 脚本最后会自己核对并打 OK/✗。
 *
 * 一条精华可以有**多个成员**（用户明确要求）：
 *   完美对话那种「- **花花**（LV38 管理员 🔥）：…」的 OCR 行，一行一个发言人，
 *   全部收进 `memberIds`（顺序 = 出现顺序）。例：2023-07-19 → 花花、虹星。
 *   16 条完美对话的 OCR 只有游戏聊天/表格截图，解析不出人名 → `memberIds: []`，
 *   页面上写「冰室群成员」，编辑器里可以自己勾。
 *
 * 为什么成员是单独一张表：精华里**只存 memberId**，名字和头像渲染时现查，
 * 所以在编辑器里改名 / 换头像，他名下所有精华（含首页那条每日精华）一起变。
 *
 * ⚠ 成员 id 会**尽量保持稳定**：已经在 salon.json 里的名字沿用原来的 id
 *   （这样你之后传的头像不会因为重跑一次脚本而对不上），新名字追加在末尾。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, '..', '..');
const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith('--'));
if (!src) {
  console.error('用法：node tools/salon/import.mjs "<群精华_图文版.html>"');
  process.exit(1);
}

const OUT_JSON = path.join(PROJ, 'src', 'data', 'salon.json');
const IMG_DIR = path.join(PROJ, 'public', 'img', 'salon');
const html = fs.readFileSync(src, 'utf8');

const decode = (s) =>
  s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|blockquote)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
const tidy = (s) => s.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/* ---------- 年代（顺带把原文件的注记留一份，用来核对） ---------- */
const eraNotes = new Map();
const eras = [];
for (const m of html.matchAll(/<h1 id='(era\d)'>([^<]*)<\/h1>\s*<p style='color:#888'>([^<]*)<\/p>/g)) {
  const range = m[3].match(/(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/);
  const num = (k) => Number((new RegExp(k + '\\s*(\\d+)').exec(m[3]) ?? [])[1] ?? -1);
  eraNotes.set(m[1], { text: num('文字'), ai: num('AI'), perfect: num('完美对话') });
  eras.push({
    id: m[1],
    title: decode(m[2]).trim(),
    from: range ? range[1] : '',
    // 原文件里"至今"是用 2099-12-31 这种哨兵写的，照抄
    to: range ? range[2] : '',
    note: decode(m[3]).trim(),
  });
}

/* ---------- 逐条 ---------- */
const parts = html.split('<div class="item">');
const items = [];
let curEra = '';
/** 上一条 <h2> 小节声明的"接下来 N 条是什么类" */
let pend = { kind: '', left: 0 };

for (let i = 1; i < parts.length; i++) {
  const raw = parts[i];
  const before = parts[i - 1];

  const eraM = before.match(/<h1 id='(era\d)'>/g);
  if (eraM) curEra = eraM[eraM.length - 1].match(/'(era\d)'/)[1];

  const lastDiv = raw.lastIndexOf('</div>');
  const body = lastDiv >= 0 ? raw.slice(0, lastDiv) : raw;

  const h4m = /<h4>([\s\S]{0,80}?)<\/h4>/.exec(body);

  /* 类别：先看"上一条 h2 说接下来是什么"，h4 的完美对话优先级最高 */
  let kind;
  if (h4m) kind = 'perfect';
  else if (pend.left > 0 && pend.kind === 'ai') { kind = 'ai'; pend.left--; }
  else kind = 'text';

  /* 再看这条自己带的 h2，给**后面**的条目定类（原文件把小节标题塞在消息 div 里） */
  for (const h of body.matchAll(/<h2>([\s\S]{0,40}?)<\/h2>/g)) {
    const title = decode(h[1]);
    const n = Number((/（(\d+)）/.exec(title) ?? [])[1] ?? 0);
    if (title.includes('完美对话')) pend = { kind: 'perfect', left: n };
    else if (title.includes('AI 创作')) pend = { kind: 'ai', left: n };
  }

  /* 时刻/日期 */
  const mb = /<p><b>([^<]{1,60}?)<\/b><\/p>/.exec(body);
  const header = mb ? decode(mb[1]).trim() : '';
  let date = '';
  let time = '';
  if (h4m) {
    date = (/<h4>[^<]*?(\d{4}-\d{2}-\d{2})/.exec(h4m[1]) ?? [])[1] ?? (/<h4>[\s\S]{0,80}?(\d{4}-\d{2}-\d{2})/.exec(body) ?? [])[1] ?? '';
  } else {
    const tm = header.match(/(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/);
    date = tm ? tm[1] : '';
    time = tm && tm[2] ? tm[2] : '';
  }

  /* 成员名：完美对话从 OCR 的「- **名字**（…」行里抽；其余从 <b>名字　时间</b> 头里取 */
  const names = [];
  if (kind === 'perfect') {
    const text0 = decode(body.replace(/<h[234]>[\s\S]*?<\/h[234]>/g, ''));
    for (const line of text0.split('\n')) {
      const m = /^\s*[-•]?\s*\*\*(.{1,20}?)\*\*\s*[（(]/.exec(line);
      if (!m) continue;
      const n = m[1].trim();
      if (n && !names.includes(n)) names.push(n);
    }
  } else if (header) {
    const nm = /^(.*?)[　\s]+(\d{4}-\d{2}-\d{2}.*)$/.exec(header);
    const who = nm ? nm[1] : header;
    for (const part of who.split(/[、,，\/]+/)) {
      const t = part.trim();
      if (t && !names.includes(t)) names.push(t);
    }
  }

  /* 正文：去掉 h2/h3/h4 这些标题（它们是分节用的，不是内容） */
  const bodyNoHead = body.replace(/<h[234]>[\s\S]*?<\/h[234]>/g, '');
  const quotes = [...bodyNoHead.matchAll(/<blockquote>([\s\S]*?)<\/blockquote>/g)].map((q) => tidy(decode(q[1])));
  const paras = [...bodyNoHead.matchAll(/<p>([\s\S]*?)<\/p>/g)]
    .map((p) => tidy(decode(p[1])))
    // 这一条是「成员　时间」的头行，不是内容
    .filter((t) => t && t !== header)
    /*
      原导出文件在 AI 创作那种条目里用一个只写着 `>` 的 <p> 当引用分隔符
      （markdown 引用块的尾巴），一条能有三四十个 —— 全滤掉，
      不然正文里会拖一长串孤零零的 `>`。
    */
    .filter((t) => !/^[>＞\s]*$/.test(t));
  let text = tidy([...quotes.filter(Boolean), ...paras.filter(Boolean)].join('\n\n'));
  /* OCR 转录标记单独存一个开关，正文里不留那行（不然每条都挂一句一样的） */
  const ocr = /本条为\s*OCR\s*自动转录/.test(text);
  if (ocr) text = tidy(text.replace(/\*?（?本条为\s*OCR\s*自动转录[^\n]*/g, ''));
  if (!date) {
    console.log(`  ⚠ 第 ${i} 条没有日期，跳过（原文件里没写）: ${header || h4m?.[1] || ''}`);
    continue;
  }

  items.push({ id: '', kind, names, date, time, text, ocr, eraId: curEra, raw: body });
}

/* ---------- id + 图片（按最终顺序编号，所以要先定好顺序） ---------- */
items.sort((a, b) => `${a.date} ${a.time || '00:00'}`.localeCompare(`${b.date} ${b.time || '00:00'}`));
items.forEach((it, i) => { it.id = `e${String(i + 1).padStart(4, '0')}`; });

/* 图片重新抽一遍：id 变了，旧文件名对不上，所以整目录重建 */
fs.rmSync(IMG_DIR, { recursive: true, force: true });
fs.mkdirSync(IMG_DIR, { recursive: true });
let imgCount = 0;
let imgBytes = 0;
for (const it of items) {
  it.images = [];
  let k = 0;
  for (const im of it.raw.matchAll(/<img[^>]*src='data:image\/([a-z]+);base64,([A-Za-z0-9+/=]+)'/g)) {
    k++;
    const ext = im[1] === 'jpeg' ? 'jpg' : im[1];
    const buf = Buffer.from(im[2], 'base64');
    const name = `${it.id}-${k}.${ext}`;
    fs.writeFileSync(path.join(IMG_DIR, name), buf);
    it.images.push(`/img/salon/${name}`);
    imgCount++;
    imgBytes += buf.length;
  }
  delete it.raw;
}

/* ---------- 成员表（已有的名字沿用旧 id，新名字追加） ---------- */
const old = fs.existsSync(OUT_JSON) ? JSON.parse(fs.readFileSync(OUT_JSON, 'utf8')) : { members: [] };
const oldByName = new Map((old.members ?? []).map((m) => [String(m.name || ''), m]));
const byName = new Map();
for (const it of items) for (const n of it.names) byName.set(n, (byName.get(n) || 0) + 1);

const members = [];
const usedIds = new Set();
for (const name of [...byName.keys()].sort()) {
  const prev = oldByName.get(name);
  let id = prev && prev.id ? String(prev.id) : '';
  if (!id || usedIds.has(id)) {
    let n = members.length + 1;
    do { id = `m${String(n).padStart(2, '0')}-${crypto.createHash('sha1').update(name).digest('hex').slice(0, 4)}`; n++; } while (usedIds.has(id));
  }
  usedIds.add(id);
  members.push({ id, name, avatar: prev?.avatar ?? '' });
}
const memId = new Map(members.map((m) => [m.name, m.id]));

/* ---------- 核对：年代 × 类别 必须和原文件注记逐项相等 ---------- */
const perEra = new Map();
for (const it of items) {
  const cur = perEra.get(it.eraId) ?? { text: 0, ai: 0, perfect: 0 };
  cur[it.kind]++;
  perEra.set(it.eraId, cur);
}
let mismatch = 0;
console.log('\n年代 × 类别（算出 / 原文件注记）：');
for (const era of eras) {
  const s = perEra.get(era.id) ?? { text: 0, ai: 0, perfect: 0 };
  const n = eraNotes.get(era.id) ?? { text: -1, ai: -1, perfect: -1 };
  const ok = s.text === n.text && s.ai === n.ai && s.perfect === n.perfect;
  if (!ok) mismatch++;
  console.log(`  ${ok ? 'OK ' : '✗  '} ${era.id}  文字 ${s.text}/${n.text}   AI ${s.ai}/${n.ai}   完美对话 ${s.perfect}/${n.perfect}`);
}

const data = {
  _readme: [
    '冰室精华（群精华）数据：成员表 + 年代 + 精华条目。由 tools/salon/import.mjs 从导出 HTML 生成。',
    '一条精华 = 成员(memberIds) + 时间(date/time) + 内容(text/images)。**一条可以有多个成员。**',
    'members 是成员表：改这里的 name/avatar，所有引用它的精华（含首页随机展示）都会跟着变 —— 精华里只存 memberId。',
    'eras 是五个年代（时间轴上的"段"）；精华用 eraId 指回年代，时间轴上的"点"由精华的日期生成。',
    'kind 是数据来源的类别：text 文字 / perfect 完美对话 / ai AI 创作。站点页面**不按它分组**，只是留着方便编辑器筛选。',
    'ocr: true 表示这条的正文是截图 OCR 自动转录（尚未人工校对）。',
    'timelineId：冰室精华页左边那条时间轴用站点里的哪一条（编辑器「精华」面板里选）。**原样渲染，不改一个字。**',
    'images 里是 public/img/salon/ 下的站内路径；编辑器里新增精华可以直接上传图片。',
  ],
  title: '冰室群精华',
  /*
    用原文件里那句「截至 2026年09月15日」当 updated —— 它说的是**数据截止到哪天**，
    比"跑脚本那天"有意义得多（页面上写的就是「共 N 条 · 截至 …」）。
  */
  updated: (() => {
    const m = html.match(/截至\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (!m) return new Date().toISOString().slice(0, 10);
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  })(),
  note: '由群精华导出文件整理：文字 / 完美对话 / AI 创作三类都在，一条没丢。',
  /*
    左边那条时间轴放哪一条：编辑器里选的，存的就是站点 timelines.json 里的一个 id。
    重跑导入脚本时**必须原样带过来**，不然用户选完的轴会被这次重跑抹掉。
  */
  timelineId: String(old.timelineId || ''),
  eras,
  members,
  essences: items.map((it) => ({
    id: it.id,
    memberIds: it.names.map((n) => memId.get(n)).filter(Boolean),
    kind: it.kind,
    date: it.date,
    time: it.time,
    text: it.text,
    ...(it.ocr ? { ocr: true } : {}),
    images: it.images,
    eraId: it.eraId,
  })),
};

fs.writeFileSync(OUT_JSON, JSON.stringify(data, null, 2) + '\n', 'utf8');

const multi = data.essences.filter((e) => e.memberIds.length > 1).length;
const none = data.essences.filter((e) => !e.memberIds.length).length;
console.log(`\n精华 ${items.length} 条（文字 ${perEra.size ? [...perEra.values()].reduce((a, b) => a + b.text, 0) : 0} / 完美对话 ${data.essences.filter((e) => e.kind === 'perfect').length} / AI 创作 ${data.essences.filter((e) => e.kind === 'ai').length}）`);
console.log(`多成员的精华 ${multi} 条；没有解析出成员的 ${none} 条（完美对话里 OCR 只认得出游戏聊天/表格的那种）`);
console.log(`图片 ${imgCount} 张 ${(imgBytes / 1048576).toFixed(1)} MB`);
console.log(`成员 ${members.length} 人：${members.map((m) => `${m.name}(${byName.get(m.name)})`).join(' ')}`);
console.log(`年代：${eras.map((e) => `${e.id} ${e.from}~${e.to}`).join(' | ')}`);
console.log(`日期范围：${items[0]?.date} ~ ${items[items.length - 1]?.date}`);
console.log(`写出：${OUT_JSON}`);
if (mismatch) {
  console.log(`\n✗ 有 ${mismatch} 个年代的条数和原文件注记对不上 —— 分类逻辑要修，先别用这份数据。`);
  process.exit(2);
}
console.log('\n✓ 逐年代表情条数与原文件注记逐项相等（文字 732 / AI 创作 7 / 完美对话 45 = 784）。');
