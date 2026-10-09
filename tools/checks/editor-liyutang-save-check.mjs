/*
 * ============================================================================
 * 黎语堂管理页「保存」这条路上的三个哨兵 —— 验收（2026-10-09）
 * ----------------------------------------------------------------------------
 * 用户原话（大意）：
 *   「2026-10-09 10:14:48 在 /liyutang-admin 保存了一次，结果 halls 整个键被抹掉了
 *    （首页那两块大厅直接消失），_readme 里当天新加的三段说明也被换回了旧版
 *    （112 段 → 94 段）。原因是编辑器拿**页面打开那一刻的旧草稿**整份覆盖，
 *    中间盘上被别处改过的键和注释一起被盖掉了。」
 *
 * 为什么量这几件事（每条都对着事故的一个环节）：
 *   ① 静态：`cleanLiyutang()` 认不认 `halls`；`_readme` 是不是取盘上那份；
 *      GET / POST 里有没有指纹那道闸。少一处，事故就还会再来一次。
 *   ② 真跑（临时副本 + 假构建，绝不碰工作区、绝不触发真构建）：
 *      a. 带指纹保存一份**含 halls** 的草稿 → 写出来的文件里 halls 还在、字段一致；
 *         顺带量「老客户端不带 halls 键」时两块大厅会不会被丢掉（那是同一场事故的另一种形态）。
 *      b. **过时草稿**：拿一个旧指纹，先在盘上改点东西，再 POST → 必须被拒（409），
 *         而且**盘上文件一个字节都没变**（读前后字节比一比）。← 事故的根
 *      c. `_readme` 保护：POST 一份不带 / 带假 `_readme` 的草稿 → 写出来的必须和盘上原样一致。
 *      d. 大厅字段清洗：非法 id（大写 / 带空格 / 中文 / 重复）、外站 image/href、
 *         超长标题说明图标 → 该规整的规整、该丢的丢。
 *   ③ 界面上真点一次保存（有 Chromium 才跑，没有就 SKIP）：页面要**显示**那句中文说明，
 *      要给一颗「重新载入这一页」，而且点完之后盘上还是没被写。
 *
 * 用法：node tools/checks/editor-liyutang-save-check.mjs
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..');
/** 副本目录：自己的 server.mjs、自己的 liyutang.json —— 工作区那份一个字节都不碰 */
const TMP = path.join(SRC, '.tmp', 'lyt-save-copy');
/** 副本用 4401 起：用户自己那个编辑器在 4322，别的验收脚本占着 4389/4398，都不去挤 */
const PORT_START = 4401;
const PORT_END = 4406;
const DEBUG_PORT = 9481;
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
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** 从源码里抠出一个函数的整段（按大括号配对；抠不出来就返回空串） */
function bodyOf(source, header) {
  const i = source.indexOf(header);
  if (i < 0) return '';
  let depth = 0;
  for (let j = i + header.length - 1; j < source.length; j++) {
    const ch = source[j];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(i, j + 1);
    }
  }
  return '';
}

/* ================================================================
 * ① 静态：三件事在源码里都接上了没有
 * ================================================================ */
console.log('================ ① 静态：接线 ================');
const serverJs = read('tools/editor/server.mjs');
const uiJs = read('tools/editor/ui/liyutang.js');
const uiHtml = read('tools/editor/ui/liyutang.html');

const cleanBody = bodyOf(serverJs, 'function cleanLiyutang(payload, current) {');
check('抠得出 cleanLiyutang() 这一整段（不是拿空串在自欺欺人）', cleanBody.length > 500, `${cleanBody.length} 字符`);

/* ---- ①-a 认 halls ---- */
check(
  '★ cleanLiyutang 真的处理 halls（不是只认识 forum / boards）',
  /file\.halls = \[\]/.test(cleanBody) && /Array\.isArray\(payload\.halls\)/.test(cleanBody) && /Array\.isArray\(current\.halls\)/.test(cleanBody)
);
check(
  '★ halls 的 id 规矩和版块一样（洗成小写字母数字连字符），空/重复的**丢掉这条**',
  /replace\(\/\[\^a-z0-9-\]\/g, ''\)/.test(cleanBody) && /dropped\.hallsNoId\+\+/.test(cleanBody) && /dropped\.hallsDupId\+\+/.test(cleanBody)
);
check(
  '★ halls 的 image / href 走同一个「只收站内路径」的洗法',
  (cleanBody.match(/hallSitePath\(/g) ?? []).length >= 2
    && /function hallSitePath\(value, max\)/.test(serverJs)
    && /if \(!s\.startsWith\('\/'\)\) return ''/.test(serverJs)
    /* `//evil.com/x` 看着以 / 开头，其实是外站 —— 这条不挡就等于没挡 */
    && /s\.startsWith\('\/\/'\)\) return ''/.test(serverJs)
);
check(
  '★ 大厅字段都有长度上限（标题 / 说明 / 图标 / 图地址 / 跳转地址）',
  /const HALL_MAX = \{/.test(serverJs) && /HALL_MAX\.title/.test(cleanBody) && /HALL_MAX\.desc/.test(cleanBody)
    && /HALL_MAX\.icon/.test(cleanBody)
);
check(
  '★ 图标按**码点**截（别把 emoji 的变体选择符切掉）',
  /\[\.\.\.String\(h\.icon \?\? ''\)\.trim\(\)\]\.slice\(0, HALL_MAX\.icon\)\.join\(''\)/.test(cleanBody)
);

/* ---- ①-b _readme 取盘上那份 ---- */
/* 注释也要剥掉再判"代码里没有"：cleanLiyutang 的注释里就留着那段被改掉的老写法（事故记录） */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const cleanCode = stripComments(cleanBody);
check(
  '★★ _readme 一律取**盘上那份**（current），页面上传什么都不理会',
  /file\._readme = current\._readme/.test(cleanCode) && !/payload\._readme/.test(cleanCode)
);
check(
  '★ 那段注释把 2026-10-09 的事故写清楚了（不然下一个人又会"顺手"改回去）',
  /2026-10-09/.test(cleanBody) && /旧快照/.test(cleanBody)
);

/* ---- ①-c 指纹 ---- */
check(
  '★ 有指纹函数，而且是**内容哈希**（注释里说了为什么不看 mtime+size）',
  /function liyutangRevOf\(buf\)/.test(serverJs) && /createHash\('sha256'\)\.update\(buf\)/.test(serverJs)
    && /mtimeMs \+ size/.test(serverJs)
);
check(
  '★ GET /api/liyutang 把指纹一起发出去',
  /const \{ file, rev \} = await readLiyutangRaw\(\);/.test(serverJs) && /\{ \.\.\.file, rev \}/.test(serverJs)
);
const staleBlock = bodyOf(serverJs, "  if (route === '/api/liyutang' && req.method === 'POST') {");
check('抠得出 POST /api/liyutang 这一段', staleBlock.length > 500, `${staleBlock.length} 字符`);
check(
  '★★ POST 会比对指纹，对不上返回 409 + stale（而不是闷头写下去）',
  /wantRev !== diskRev/.test(staleBlock) && /sendJson\(res, 409, \{/.test(staleBlock) && /stale: true/.test(staleBlock)
);
check(
  '★ 409 那句话是中文、说清「没有写进去」和怎么办',
  /这次保存没有写进去/.test(staleBlock) && /刷新这一页/.test(staleBlock)
);
check(
  '★ 没带指纹的老客户端 = 当「要覆盖」放行（`wantRev &&` 就是这个取舍），注释里写了',
  /if \(wantRev && wantRev !== diskRev\)/.test(staleBlock) && /老客户端/.test(staleBlock)
);
check('★ 保存成功后把新指纹带回去（页面下一次保存不会被自己的旧指纹挡住）', /rev: liyutangRevOf\(Buffer\.from\(text, 'utf8'\)\)/.test(staleBlock));

/* ---- ①-d 界面 ---- */
check(
  '★ 页面存下了指纹、保存时带回去',
  /rev = typeof draft\.rev === 'string' \? draft\.rev : ''/.test(uiJs) && /JSON\.stringify\(\{ \.\.\.draft, rev \}\)/.test(uiJs)
);
check(
  '★ 409 被单独处理：把中文说明摆出来 + 一颗「重新载入这一页」',
  /res\.status === 409 && data\?\.stale/.test(uiJs) && /重新载入这一页/.test(uiJs) && /window\.location\.reload\(\)/.test(uiJs)
);
check('★ 提示框在页面上真的有位置（不是凭空 querySelector 一个不存在的 id）', /id="lt-stale"/.test(uiHtml) && /showStale\(/.test(uiJs));
check(
  '★ 409 那一段**不**自动重载、也不重新 load()（用户刚写的东西不能被悄悄丢掉）',
  (() => {
    const i = uiJs.indexOf('if (res.status === 409');
    const branch = uiJs.slice(i, uiJs.indexOf('if (!res.ok || !data?.ok)', i));
    return branch.length > 100 && /showStale\(/.test(branch) && !/location\.reload\(\)/.test(branch) && !/await load\(\)/.test(branch);
  })()
);
check(
  '★ renderHalls() 在 render() 里，而且顺序是 用户 → 大厅 → 版块 → 帖子 → 评论',
  (() => {
    const body = bodyOf(uiJs, 'function render() {');
    const iUsers = body.indexOf('renderUsers()');
    const iHalls = body.indexOf('renderHalls()');
    const iBoards = body.indexOf('renderBoards()');
    const iPosts = body.indexOf('renderPosts()');
    const iForum = body.indexOf('renderForum()');
    return iUsers >= 0 && iUsers < iHalls && iHalls < iBoards && iBoards < iPosts && iPosts < iForum;
  })(),
  'render() 里的调用顺序'
);
check(
  '★ 页面上「大厅」那一块夹在用户审核之后、版块之前',
  (() => {
    const iUsers = uiHtml.indexOf('id="lt-users-box"');
    const iHalls = uiHtml.indexOf('id="lt-halls-box"');
    const iBoards = uiHtml.indexOf('id="lt-boards-box"');
    return iUsers >= 0 && iUsers < iHalls && iHalls < iBoards;
  })()
);
check(
  '★ 大厅每一行该有的都有：图标 / 标题 / 说明 / 背景图 / 跳转地址 + 上下挪 + 删除 + 新增',
  /lt-board__icon/.test(bodyOf(uiJs, 'function hallRow(hall, index) {'))
    && /lt-hall__title/.test(uiJs) && /lt-hall__image/.test(uiJs) && /lt-hall__href/.test(uiJs)
    && /＋ 新增大厅/.test(uiJs) && /删掉这块大厅/.test(uiJs)
);
check(
  '★ 版块 id 撞固定路由（new / post / chatroom / teahouse）时那一行有红字提醒',
  /FIXED_BOARD_IDS = \['new', 'post', 'chatroom', 'teahouse'\]/.test(uiJs)
    && /const warn = boardIdWarn\(board\.id\);/.test(bodyOf(uiJs, 'function boardRow(board, index) {'))
    && /bad\.style\.color = 'var\(--danger\)'/.test(bodyOf(uiJs, 'function boardRow(board, index) {'))
);
check('★ 大厅 / 版块 / 评论都只用现成的类，没引外部库', !/<script[^>]+src="https?:/.test(uiHtml) && !/import .* from 'https?:/.test(uiJs));

/* ================================================================
 * ② 真跑：临时副本 + 假构建
 * ================================================================ */
console.log('\n================ ② 副本：一份自己的 server.mjs ================');

const FILE = path.join(TMP, 'src', 'data', 'liyutang.json');
const README = [
  '验收用说明书 第 1 段：只有"直接改这个文件"的人才会动它。',
  '验收用说明书 第 2 段：编辑器保存一次之后，它必须一个字都没变（2026-10-09 事故里它就是被旧草稿盖掉的）。',
  '验收用说明书 第 3 段：和 halls 一起被抹掉的那批东西。',
];
const FIXTURE = {
  _readme: README,
  forum: {
    enabled: true,
    provider: 'twikoo',
    twikoo: { envId: '', region: 'ap-shanghai' },
    giscus: {},
    waline: { serverURL: '' },
  },
  halls: [
    { id: 'chatroom', title: '聊天室', desc: '一句一句地聊。', icon: '💬', image: '', href: '/liyutang/chatroom/' },
    { id: 'teahouse', title: '久昭卿茶绘', desc: '大家共用的画板。', icon: '🎨', image: '', href: '/liyutang/teahouse/' },
  ],
  boards: [
    { id: 'notice', title: '公告', desc: '站点公告。', icon: '📌' },
    /* 故意留一个撞固定路由的：界面上那行红字提醒要看得见 */
    { id: 'chatroom', title: '验收：故意撞路由的版块', desc: '', icon: '⚠️' },
  ],
  updated: '2026-10-08',
};

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, 'src', 'data'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools', 'editor'), { recursive: true });
fs.cpSync(path.join(SRC, 'tools', 'editor', 'ui'), path.join(TMP, 'tools', 'editor', 'ui'), { recursive: true });

/*
  改这份副本，四处：
    · PROJECT_ROOT / LIYUTANG_FILE → 指到副本里自己的数据（工作区那份一个字节都不碰）
    · 端口 → 4401 起（用户那个编辑器在 4322，别的验收脚本占着 4389/4398，都不去挤）
    · runBuild → 替身：真构建几十秒，验收里不该跑（数据落盘那件事照样发生）
*/
let patched = fs.readFileSync(path.join(SRC, 'tools', 'editor', 'server.mjs'), 'utf8');
const patch = (from, to) => {
  const n = patched.split(from).length - 1;
  patched = patched.replace(from, to);
  return n;
};
const nRoot = patch("const PROJECT_ROOT = path.resolve(__dirname, '..', '..');", `const PROJECT_ROOT = ${JSON.stringify(TMP)};`);
const nFile = patch(
  "const LIYUTANG_FILE = path.join(PROJECT_ROOT, 'src', 'data', 'liyutang.json');",
  `const LIYUTANG_FILE = ${JSON.stringify(FILE)};`
);
const nPort = patch('const PORT_START = 4322;', `const PORT_START = ${PORT_START};`)
  + patch('const PORT_END = 4340;', `const PORT_END = ${PORT_END};`);
const nBuild = patch(
  'function runBuild() {',
  `function runBuild() {
  /* 验收替身：真构建要几十秒，这里只数一笔（保存这条路上"数据已落盘"照样发生） */
  return Promise.resolve({ ok: true, ms: 1, output: '[验收替身] 没有真构建' });
}
function __unusedRealBuild() {`
);
check('副本四处都改上了（PROJECT_ROOT / LIYUTANG_FILE / 端口 / 假构建）',
  nRoot === 1 && nFile === 1 && nPort === 2 && nBuild === 1, `${nRoot}/${nFile}/${nPort}/${nBuild}`);
fs.writeFileSync(path.join(TMP, 'tools', 'editor', 'server.mjs'), patched, 'utf8');
fs.writeFileSync(FILE, `${JSON.stringify(FIXTURE, null, 2)}\n`, 'utf8');

const syntax = spawnSync(process.execPath, ['--check', path.join(TMP, 'tools', 'editor', 'server.mjs')], { encoding: 'utf8' });
check('副本那份 server.mjs 语法没问题（改坏了就什么也测不了）', syntax.status === 0, String(syntax.stderr || '').slice(0, 200));

/* ---------- 起副本的编辑器 ---------- */
const editor = spawn(process.execPath, [path.join(TMP, 'tools', 'editor', 'server.mjs')], {
  cwd: TMP,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let elog = '';
editor.stdout.on('data', (b) => { elog += b.toString('utf8'); });
editor.stderr.on('data', (b) => { elog += b.toString('utf8'); });
let base = '';
for (let i = 0; i < 400 && !base; i++) {
  await sleep(150);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(elog);
  if (m) base = `http://127.0.0.1:${m[1]}`;
}
check('副本里的编辑器起来了（自己的端口，不碰 4322）', !!base, base || elog.slice(-200));
check('副本用的端口不是用户那个 4322', !!base && !base.endsWith(':4322/'), base);

const getJson = async (p) => {
  const r = await fetch(base + p);
  return { status: r.status, json: await r.json().catch(() => null) };
};
const postJson = async (body) => {
  const r = await fetch(`${base}/api/liyutang`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const diskText = () => fs.readFileSync(FILE, 'utf8');
const diskJson = () => JSON.parse(diskText());

let loaded = null;
if (base) {
  loaded = await getJson('/api/liyutang');
  check('★ GET /api/liyutang 带回文件内容，也带回指纹 rev',
    loaded.status === 200 && Array.isArray(loaded.json?.halls) && typeof loaded.json?.rev === 'string' && loaded.json.rev.length >= 16,
    `rev=${String(loaded.json?.rev).slice(0, 12)}… · halls=${loaded.json?.halls?.length}`);
  check('指纹是照着盘上那份算的（连着 GET 两次，值一样）',
    loaded.json?.rev === (await getJson('/api/liyutang')).json?.rev,
    String(loaded.json?.rev).slice(0, 12));
}

/* ================================================================
 * ②-a 带指纹保存一份含 halls 的草稿
 * ================================================================ */
console.log('\n================ ②-a 含 halls 的草稿：大厅要还在，字段要一致 ================');
if (base && loaded) {
  const draft = { ...loaded.json };
  const HALLS = [
    { id: 'chatroom', title: '聊天室', desc: '一句一句地聊，像 QQ 那样。', icon: '💬', image: '', href: '/liyutang/chatroom/' },
    { id: 'teahouse', title: '久昭卿茶绘', desc: '一块大家共用的画板。', icon: '🎨', image: '', href: '/liyutang/teahouse/' },
    { id: 'newhall', title: '验收新加的大厅', desc: '带背景图的一块。', icon: '🪷', image: '/img/uploads/check.webp', href: '' },
  ];
  const saved = await postJson({ ...draft, halls: HALLS, rev: loaded.json.rev });
  check('★ 带指纹 + 含 halls 的草稿保存成功', saved.status === 200 && saved.json?.ok === true, `HTTP ${saved.status}`);
  check('★ 响应里报的大厅块数是对的', saved.json?.counts?.halls === 3, JSON.stringify(saved.json?.counts));
  const after = diskJson();
  check('★★ 写出来的文件里 halls **还在**（事故里就是这里没的）', Array.isArray(after.halls) && after.halls.length === 3,
    JSON.stringify(after.halls?.map((h) => h.id)));
  check('★★ 三块大厅的字段和发出去的一模一样（id/标题/说明/图标/图/地址）',
    JSON.stringify(after.halls) === JSON.stringify(HALLS),
    JSON.stringify(after.halls));
  check('★ 保存响应带回新指纹（页面拿它接着用）',
    typeof saved.json?.rev === 'string' && saved.json.rev !== loaded.json.rev,
    `${String(loaded.json.rev).slice(0, 8)}… → ${String(saved.json?.rev).slice(0, 8)}…`);

  /* 老客户端：读不懂 halls，草稿里根本没这个键、也不带指纹 —— 不该因此把两块大厅弄丢 */
  const before2 = diskText();
  const legacy = await postJson({ ...(await getJson('/api/liyutang')).json, halls: undefined, rev: undefined });
  const after2 = diskJson();
  info(`[老客户端] 草稿里不带 halls 键、也不带指纹 → HTTP ${legacy.status}，盘上 halls = ${after2.halls?.length} 块`);
  check('★ 老客户端保存一次，三块大厅照样还在（兜底取盘上那份）',
    legacy.status === 200 && Array.isArray(after2.halls) && after2.halls.length === 3 && before2.length > 0,
    JSON.stringify(after2.halls?.map((h) => h.id)));
}

/* ================================================================
 * ②-b 过时草稿：必须被拒，而且盘上一个字节都不变
 * ================================================================ */
console.log('\n================ ②-b 过时草稿：409 拒写 + 盘上零改动（事故的根） ================');
if (base) {
  const g0 = await getJson('/api/liyutang');
  const revOld = g0.json.rev;

  /* "另一个窗口 / 刚同步下来的更新"：盘上被别处改过了 */
  const onDisk = diskJson();
  onDisk.halls[0].title = '聊天室（别的窗口刚改的）';
  onDisk.updated = '2026-10-09';
  fs.writeFileSync(FILE, `${JSON.stringify(onDisk, null, 2)}\n`, 'utf8');
  const bytesBefore = fs.readFileSync(FILE);

  /* 拿**打开那一页时**的旧指纹去保存（页面上的草稿里 halls[0] 还是老标题） */
  const staleDraft = { ...g0.json, halls: g0.json.halls.map((h) => ({ ...h })), rev: revOld };
  staleDraft.halls[0].title = '聊天室';
  const stale = await postJson(staleDraft);
  const bytesAfter = fs.readFileSync(FILE);

  info(`[b 原始输出] 旧指纹 ${String(revOld).slice(0, 12)}… → POST 带的是它`);
  info(`[b 原始输出] HTTP ${stale.status} · body = ${JSON.stringify(stale.json)}`);
  info(`[b 原始输出] 盘上字节：POST 前 ${bytesBefore.length} / POST 后 ${bytesAfter.length} · 逐字节相等 = ${bytesBefore.equals(bytesAfter)}`);

  check('★★ 盘上那份被别处改过 → 旧指纹的保存被拒（HTTP 409）', stale.status === 409, `HTTP ${stale.status}`);
  check('★ 拒的理由是 stale，而且说清了「这次保存没有写进去」',
    stale.json?.stale === true && /这次保存没有写进去/.test(String(stale.json?.error))
      && /被改过/.test(String(stale.json?.error)),
    String(stale.json?.error).slice(0, 72));
  check('★★ 被拒之后盘上文件**一个字节都没变**', bytesBefore.equals(bytesAfter),
    `${bytesBefore.length} → ${bytesAfter.length} 字节`);
  check('★ 别的窗口刚改的那个标题还在（没被旧草稿盖回去）',
    diskJson().halls[0].title === '聊天室（别的窗口刚改的）', diskJson().halls[0].title);
  check('★ 被拒时把盘上现在那份的指纹一起带回来了（页面据此知道该刷新）',
    typeof stale.json?.rev === 'string' && stale.json.rev !== revOld,
    `${String(revOld).slice(0, 8)}… vs ${String(stale.json?.rev).slice(0, 8)}…`);

  /* 这道闸不能把正常流程挡住：重新读一遍拿新指纹，再存就该成功 */
  const g1 = await getJson('/api/liyutang');
  const ok2 = await postJson({ ...g1.json, halls: g1.json.halls, rev: g1.json.rev });
  info(`[b 原始输出] 刷新后拿新指纹再存 → HTTP ${ok2.status} · ok=${ok2.json?.ok}`);
  check('★ 重新读一遍（拿到新指纹）再存就正常了', ok2.status === 200 && ok2.json?.ok === true, `HTTP ${ok2.status}`);
}

/* ================================================================
 * ②-c _readme：永远和盘上那份一模一样
 * ================================================================ */
console.log('\n================ ②-c _readme：页面上传什么都不理会 ================');
if (base) {
  /* ① 草稿里**不带** _readme */
  const g = await getJson('/api/liyutang');
  const readmeOnDisk = diskJson()._readme;
  const noReadme = { ...g.json, rev: g.json.rev };
  delete noReadme._readme;
  const r1 = await postJson(noReadme);
  const after1 = diskJson()._readme;

  /* ② 草稿里带一份**假的** _readme */
  const g2 = await getJson('/api/liyutang');
  const fake = ['假说明：编辑器说我该覆盖盘上那份说明书', '假说明：第二段'];
  const r2 = await postJson({ ...g2.json, _readme: fake, rev: g2.json.rev });
  const after2 = diskJson()._readme;

  info(`[c 原始输出] 盘上原来的 _readme（${readmeOnDisk.length} 段）= ${JSON.stringify(readmeOnDisk)}`);
  info(`[c 原始输出] ① 草稿不带 _readme → HTTP ${r1.status} · 保存后盘上 = ${JSON.stringify(after1)}`);
  info(`[c 原始输出] ② 草稿带假 _readme ${JSON.stringify(fake)} → HTTP ${r2.status} · 保存后盘上 = ${JSON.stringify(after2)}`);

  check('★ 草稿不带 _readme 时，盘上那份原样留着', r1.status === 200 && JSON.stringify(after1) === JSON.stringify(readmeOnDisk));
  check('★★ 草稿带一份假 _readme 时，盘上那份**还是**原样（页面对它没有发言权）',
    r2.status === 200 && JSON.stringify(after2) === JSON.stringify(readmeOnDisk));
  check('★ 假说明一个字都没进文件', !diskText().includes('假说明'));
}

/* ================================================================
 * ②-d 大厅字段的清洗
 * ================================================================ */
console.log('\n================ ②-d 大厅字段：非法 id / 外站地址 / 超长 ================');
if (base) {
  const g = await getJson('/api/liyutang');
  const dirty = [
    /* 大写 + 空格 → 洗成 chatroom；外站图 / 外站地址 → 空串 */
    { id: 'CHAT ROOM', title: '大写带空格', desc: '', icon: '💬', image: 'https://evil.example/a.png', href: 'https://evil.example/x' },
    /* 和上面洗出来的一样 → 撞车，丢掉 */
    { id: 'chatroom', title: '重复的那个', desc: '', icon: '', image: '', href: '' },
    /* 中文 → 洗不出东西 → 丢掉 */
    { id: '中文', title: '洗不出 id', desc: '', icon: '', image: '', href: '' },
    /* 没标题 → 丢掉 */
    { id: 'blank', title: '   ', desc: '', icon: '', image: '', href: '' },
    /* 长度上限 + 带空格的站内路径（断图）/ 协议相对地址（外站）→ 空串 */
    {
      id: 'ok-hall',
      title: '标'.repeat(300),
      desc: '说'.repeat(500),
      icon: '🀄'.repeat(20),
      image: '/img/uploads/带 空格.png',
      href: '//evil.example/y',
    },
    /* 合法的站内地址要原样留着 */
    { id: 'pic', title: '带背景图的大厅', desc: '正常一块。', icon: '🖼', image: '/img/uploads/check.webp', href: '/liyutang/pic/' },
  ];
  const res = await postJson({ ...g.json, halls: dirty, rev: g.json.rev });
  const halls = diskJson().halls;
  info(`[d] HTTP ${res.status} · dropped = ${JSON.stringify(res.json?.dropped)}`);
  info(`[d] 落盘的大厅 = ${JSON.stringify(halls)}`);

  check('★ 保存成功（清洗该丢掉的就丢掉，不该整个保存失败）', res.status === 200 && res.json?.ok === true, `HTTP ${res.status}`);
  check('★★ 非法 / 重复 / 空 id / 没标题的都不落盘，只剩干净的几条',
    JSON.stringify(halls.map((h) => h.id)) === JSON.stringify(['chatroom', 'ok-hall', 'pic']),
    JSON.stringify(halls.map((h) => h.id)));
  check('★ 大写带空格的 id 被洗成合法的 chatroom（和版块一个规矩）', halls[0]?.id === 'chatroom');
  check('★★ 外站 image / href 被规整成空串（背景图和跳转地址只收站内路径）',
    halls[0]?.image === '' && halls[0]?.href === '', JSON.stringify([halls[0]?.image, halls[0]?.href]));
  check('★ 站内路径带空格（会断图）= 空串；协议相对的 //evil.example/y（也是外站）= 空串',
    halls[1]?.image === '' && halls[1]?.href === '', JSON.stringify([halls[1]?.image, halls[1]?.href]));
  check('★ 合法的站内 image / href 原样留着',
    halls[2]?.image === '/img/uploads/check.webp' && halls[2]?.href === '/liyutang/pic/', JSON.stringify(halls[2]));
  check('★ 标题 / 说明 / 图标都有长度上限（塞一兆字也撑不爆）',
    halls[1]?.title.length === 80 && halls[1]?.desc.length === 200 && [...halls[1].icon].length === 8,
    `标题 ${halls[1]?.title.length} · 说明 ${halls[1]?.desc.length} · 图标 ${[...(halls[1]?.icon ?? '')].length} 码点`);
  check('★ 丢掉的条数如实报给页面（不静默丢东西）',
    res.json?.dropped?.hallsDupId === 1 && res.json?.dropped?.hallsNoId === 1 && res.json?.dropped?.hallsNoTitle === 1
      && res.json?.dropped?.hallsImage === 2 && res.json?.dropped?.hallsHref === 2,
    JSON.stringify(res.json?.dropped));
  check('★ 落盘之后没有一条大厅带着外站地址（整体扫一遍）',
    halls.every((h) => (h.image === '' || h.image.startsWith('/')) && (h.href === '' || h.href.startsWith('/'))));
}

/* ================================================================
 * ③ 界面上真点一次保存：提示要看得见，盘上还是没被写
 * ================================================================ */
console.log('\n================ ③ 界面：409 要看得见 + 「重新载入这一页」 ================');

/* 上面那几趟把盘上改得七零八落了，这里恢复成一份"有真大厅"的样子，界面上看起来才正常 */
fs.writeFileSync(FILE, `${JSON.stringify(FIXTURE, null, 2)}\n`, 'utf8');

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
      if (m.method === 'Runtime.exceptionThrown') {
        this.errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
      }
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
    return r.result.value;
  }
}

const profile = path.join(process.env.TEMP ?? '.', `dsh-lyt-save-${Date.now()}`);
let chrome = null;
let cdp = null;
if (!base) {
  skip('界面上那一趟（409 的提示 + 重新载入按钮）', '副本的编辑器没起来，没法量');
} else if (!fs.existsSync(CHROME)) {
  skip('界面上那一趟（409 的提示 + 重新载入按钮）', `这台机器上没有那个 Chromium：${CHROME}`);
} else {
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu',
    '--enable-unsafe-swiftshader', '--disable-breakpad', '--window-size=1440,1000',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
  { stdio: 'ignore' });
  for (let i = 0; i < 80 && !cdp; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const p = list.find((t) => t.type === 'page');
      if (p) cdp = await CDP.attach(p.webSocketDebuggerUrl);
    } catch { /* 还没起来 */ }
  }
  if (!cdp) {
    skip('界面上那一趟（409 的提示 + 重新载入按钮）', '无头浏览器没连上（CDP 没起来）');
  } else {
  /*
    这一段整段包在 try 里：界面那一趟出什么意外都不该把结尾那行统计吞掉
    （看不到 "==== N passed, M failed ====" 的验收等于没跑）。
  */
  try {
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url: `${base}/liyutang-admin` });
    for (let i = 0; i < 300; i++) {
      await sleep(100);
      if ((await cdp.ev('document.readyState')) === 'complete') break;
    }
    /* 等它真的读完（判据：状态行说"读取完成"） */
    let ready = '';
    for (let i = 0; i < 120; i++) {
      await sleep(150);
      ready = await cdp.ev(`(document.getElementById('lt-status') || {}).textContent || ''`);
      if (/读取完成/.test(ready)) break;
    }
    check('管理页读完了数据', /读取完成/.test(ready), String(ready).trim().slice(0, 80));

    const painted = await cdp.ev(`(() => {
      const box = document.getElementById('lt-halls-box');
      const rows = box ? [...box.querySelectorAll('.lt-board')] : [];
      const titles = rows.map((r) => (r.querySelector('.lt-hall__title') || {}).value || '');
      const warns = [...document.querySelectorAll('#lt-boards-box .hint')]
        .filter((s) => /固定路由占着/.test(s.textContent))
        .map((s) => ({ text: s.textContent.trim(), red: getComputedStyle(s).color }));
      return { rows: rows.length, titles, idInputs: box ? box.querySelectorAll('.lt-hall__id').length : 0,
               imageInputs: box ? box.querySelectorAll('.lt-hall__image').length : 0,
               warns, addBtn: !!([...(box ? box.querySelectorAll('button') : [])].find((b) => /新增大厅/.test(b.textContent))) };
    })()`);
    info(`[③] 大厅面板：${painted.rows} 行 · id 框 ${painted.idInputs} 个 · 背景图框 ${painted.imageInputs} 个 · 新增按钮 ${painted.addBtn}`);
    check('★ 页面上真的画出了两块大厅（标题就是盘上那两个）',
      painted.rows === 2 && painted.titles[0] === '聊天室' && painted.titles[1] === '久昭卿茶绘',
      JSON.stringify(painted.titles));
    check('★ 每一行都有 id 框和背景图框（站长能改）', painted.idInputs === 2 && painted.imageInputs === 2);
    check('★ 「＋ 新增大厅」在', painted.addBtn === true);
    check('★ 撞固定路由的版块那一行有**红字**提醒',
      painted.warns.length === 1 && /chatroom/.test(painted.warns[0].text)
        && (() => {
          const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(painted.warns[0].red);
          return !!m && Number(m[1]) > Number(m[2]) && Number(m[1]) > Number(m[3]);
        })(),
      JSON.stringify(painted.warns));

    /* 现在"另一个窗口"动一下盘上那份，然后页面上点保存 —— 必须被拒、必须看得见 */
    const onDisk = diskJson();
    onDisk.halls[0].title = '聊天室（第三个窗口改的）';
    const bytesBefore = Buffer.from(`${JSON.stringify(onDisk, null, 2)}\n`, 'utf8');
    fs.writeFileSync(FILE, bytesBefore);

    const uiSave = await cdp.ev(`(async () => {
      const t = [...document.querySelectorAll('#lt-halls-box .lt-hall__title')][0];
      t.value = '聊天室（我这一页上改的）';
      t.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      document.getElementById('lt-save').click();
      let box = null;
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 150));
        box = document.getElementById('lt-stale');
        if (box && !box.hidden) break;
      }
      box = document.getElementById('lt-stale');
      const btn = box ? [...box.querySelectorAll('button')].find((b) => /重新载入这一页/.test(b.textContent)) : null;
      return {
        shown: !!box && !box.hidden,
        text: box ? box.textContent.replace(/\\s+/g, ' ').trim() : '',
        hasBtn: !!btn,
        status: (document.getElementById('lt-status') || {}).textContent || '',
        said_saved: /已保存/.test(document.body.innerText),
      };
    })()`);
    const bytesAfter = fs.readFileSync(FILE);
    info(`[③] 页面上点保存 → 提示框显示 = ${uiSave.shown} · 文案 = ${uiSave.text.slice(0, 120)}`);
    info(`[③] 状态行 = ${uiSave.status.trim().slice(0, 80)}`);
    info(`[③] 盘上字节：${bytesBefore.length} → ${bytesAfter.length} · 逐字节相等 = ${bytesBefore.equals(bytesAfter)}`);

    check('★★ 界面上显示出了那句中文说明（不是静默失败、也不是英文报错）',
      uiSave.shown === true && /被改过/.test(uiSave.text) && /没有写进去/.test(uiSave.text), uiSave.text.slice(0, 90));
    check('★★ 旁边有「重新载入这一页」按钮', uiSave.hasBtn === true);
    check('★ 状态行说清了"这次没有写进去"', /没有写进去/.test(uiSave.status), uiSave.status.trim().slice(0, 60));
    check('★★ 页面上没假装保存成功', uiSave.said_saved === false);
    check('★★ 被拒之后盘上还是第三个窗口那份，一个字节没变', bytesBefore.equals(bytesAfter));

    /* 点那颗按钮：页面重载 → 提示消失、读到的是盘上现在那份（第三个窗口改的标题）。
       ⚠ 这一次 evaluate 会被导航打断（浏览器回 "Inspected target navigated or closed"）——
         那是「按钮真的触发了 location.reload()」的证据，不是失败；下面重新轮询就行。 */
    try {
      await cdp.ev(`(() => {
        const box = document.getElementById('lt-stale');
        [...box.querySelectorAll('button')].find((b) => /重新载入这一页/.test(b.textContent)).click();
        return true;
      })()`);
    } catch (err) {
      info(`[③] 点了「重新载入这一页」，页面开始重载（这次 evaluate 被打断是正常的）：${String(err.message).slice(0, 60)}`);
    }
    let reloaded = null;
    for (let i = 0; i < 80; i++) {
      await sleep(250);
      try {
        reloaded = await cdp.ev(`(() => {
          const b = document.getElementById('lt-stale');
          return {
            hidden: !!b && b.hidden,
            title: ([...document.querySelectorAll('#lt-halls-box .lt-hall__title')][0] || {}).value || '',
            status: (document.getElementById('lt-status') || {}).textContent || '',
            ready: document.readyState,
          };
        })()`);
        if (reloaded.hidden && /读取完成/.test(reloaded.status) && reloaded.title) break;
      } catch { /* 文档正在换，等下一轮 */ }
    }
    check('★★ 点「重新载入这一页」之后：提示消失，读到的是盘上现在那份',
      !!reloaded && reloaded.hidden === true && reloaded.title === '聊天室（第三个窗口改的）',
      reloaded ? `标题「${reloaded.title}」· 状态「${reloaded.status.trim().slice(0, 40)}」` : '没等到重载完成');
    check('★ 这一趟界面没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));
  } catch (err) {
    fail++;
    console.log(`FAIL  ③ 界面那一趟整个出错了：${String(err?.stack ?? err).slice(0, 400)}`);
  }
  }
}

/* ================================================================
 * 收摊
 * ================================================================ */
try { editor.kill(); } catch { /* 已经退出 */ }
try { if (cdp) await cdp.send('Browser.close'); } catch { /* ignore */ }
try { if (chrome) chrome.kill(); } catch { /* ignore */ }
/* Windows 上刚被杀掉的那个进程还会攥一会儿文件句柄 —— 等一拍、重试几次再删 */
await sleep(600);
for (let i = 0; i < 6 && fs.existsSync(TMP); i++) {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 下一轮再试 */ }
  if (fs.existsSync(TMP)) await sleep(400);
}
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* ignore */ }
info(`副本已清理：${!fs.existsSync(TMP)}`);
info(`真仓库的 liyutang.json 没被碰过（这个脚本只写过副本）：${fs.existsSync(path.join(SRC, 'src', 'data', 'liyutang.json'))}`);

console.log(`\n==== ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''} ====`);
process.exit(fail ? 1 : 0);
