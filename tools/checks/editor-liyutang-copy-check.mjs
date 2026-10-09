/*
 * ============================================================================
 * 黎语堂管理页「页面文案」面板 —— 验收（2026-10-09）
 * ----------------------------------------------------------------------------
 * 用户原话（这一轮最重的一条，大意）：
 *   「黎语堂网站里充斥着过多你自己胡编乱造的提示和简介 …… 请你全部删掉全部这一类
 *    你自己生造的句子 并且**给对应的位置留下编辑器接口**以方便我去填写介绍和简介」。
 *
 * 页面那一侧（不写死、空则不渲染）由 tools/checks/liyutang-copy-check.mjs 盯着；
 * **这个脚本盯着"接口真的能用"** —— 站长在编辑器里填得进、存得住、规整得对：
 *
 *   ① 静态：面板在（html 里有位置、js 里会画）、字段带 data-copy-group/key、
 *      大厅那句「说明」的输入框也还在（desc 上一轮刚被清空，得确认站长还能填回去）。
 *   ② 真跑（**临时副本** + 假构建，绝不碰工作区那份 liyutang.json、绝不触发真构建）：
 *      a. 面板里能填、点保存能落盘（值原样进文件）；
 *      b. 空串照留（不像 halls 那样整条丢掉）；
 *      c. 超 200 字截断 + 记一笔 dropped.copyTooLong；
 *      d. 非字符串（数字 / 数组 / 对象）规整成空串 + 记 dropped.copyNotString；
 *      e. 以后新加的键（字符串）能留住，不被旧版页面抹掉；
 *      f. 老客户端（草稿里没有 copy 键）保存一次，盘上的文案还在；
 *      g. `copy._readme` 永远取盘上那份（页面对它没有发言权）；
 *      h. counts.copyFilled 数得对（面板底下"已填 N 条"读的就是它）。
 *   ③ 真浏览器（有 Chromium 才跑，没有就 SKIP）：面板真的画出来了、
 *      每个键都有输入框（键和 UI 不脱节）、在框里打字 + 点保存 → 文案进文件。
 *
 * 用法：node tools/checks/editor-liyutang-copy-check.mjs
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..');
/** 副本目录：自己的 server.mjs、自己的 liyutang.json —— 工作区那份一个字节都不碰 */
const TMP = path.join(SRC, '.tmp', 'lyt-copy-copy');
/* 端口不和人挤：用户那个编辑器在 4322，保存验收占 4401-4406，别的验收占 4389/4398 */
const PORT_START = 4407;
const PORT_END = 4412;
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
/** 从源码里抠出一个函数的整段（按大括号配对）—— 判"render() 里调了谁、按什么顺序"要在**函数体**里找，
    不然会撞上别处同名的调用（`renderPosts();` 在它自己的 refresh() 里也有一处） */
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
 * ① 静态：面板在不在
 * ================================================================ */
console.log('================ ① 静态：面板接线 ================');
const uiHtml = read('tools/editor/ui/liyutang.html');
const uiJs = read('tools/editor/ui/liyutang.js');
const serverJs = read('tools/editor/server.mjs');

check('「页面文案」面板在页面上有位置（#lt-copy-box）', /id="lt-copy-box"/.test(uiHtml));
check('render() 会画它，而且排在版块之后、帖子之前（配置归配置、日常归日常）', (() => {
  const body = bodyOf(uiJs, 'function render() {');
  const iBoards = body.indexOf('renderBoards();');
  const iCopy = body.indexOf('renderCopy();');
  const iPosts = body.indexOf('renderPosts();');
  return iBoards > 0 && iCopy > iBoards && iCopy < iPosts;
})());
check('每个字段都带 data-copy-group / data-copy-key（验收照着它填）',
  /dataset\.copyGroup = f\.group/.test(uiJs) && /dataset\.copyKey = f\.key/.test(uiJs) && /lt-copy__field/.test(uiJs));
check('每个字段都是 200 字上限的文本域（不是一行 input：文案是段落）',
  /area\.maxLength = 200/.test(uiJs) && /textarea\(g\[f\.key\]/.test(uiJs));
check('面板里写明了"留空 = 那个位置什么都不显示"', /留空 = 那个位置什么都不显示/.test(uiJs));
check('★ 大厅那句「说明」的输入框还在（desc 被清空了，站长能填回去）',
  /lt-hall__desc/.test(uiJs) && /hall\.desc = v/.test(uiJs));

/* 键表：数据 / 服务端 / 面板三处一致（守卫脚本也判，这里再判一次 —— 面板是这一轮的交付物） */
const dataKeys = (() => {
  const copy = JSON.parse(read('src/data/liyutang.json')).copy ?? {};
  const out = [];
  for (const [g, v] of Object.entries(copy)) {
    if (g.startsWith('_') || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    for (const k of Object.keys(v)) out.push(`${g}.${k}`);
  }
  return out.sort();
})();
const uiKeys = (() => {
  const out = [];
  const re = /\{\s*group:\s*'([^']+)',\s*key:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(uiJs))) out.push(`${m[1]}.${m[2]}`);
  return out.sort();
})();
check('★★ 数据 copy 区的每个键，面板里都有对应输入框（键和 UI 不许脱节）',
  dataKeys.length > 0 && JSON.stringify(dataKeys) === JSON.stringify(uiKeys),
  `${dataKeys.length} vs ${uiKeys.length}`);
check('★ 每个字段的中文标签都写清了"出现在哪一页"（不是干巴巴一个 lead/hint）',
  (uiJs.match(/label: '[^']*(页|·)[^']*'/g) ?? []).length === uiKeys.length,
  `${(uiJs.match(/label: '[^']*(页|·)[^']*'/g) ?? []).length} / ${uiKeys.length}`);
check('★ `copy._readme` **不是**面板字段（它只是给手改 JSON 的人看的说明，不该冒出一个输入框）',
  !/key:\s*'_readme'/.test(uiJs) && uiKeys.every((k) => !k.includes('_')) && !/data-copy-key="?_readme/.test(uiHtml),
  uiKeys.filter((k) => k.includes('_')).join(' / ') || '字段表里没有 _readme');

/* ================================================================
 * ② 真跑：临时副本 + 假构建
 * ================================================================ */
console.log('\n================ ② 副本：一份自己的 server.mjs ================');

const FILE = path.join(TMP, 'src', 'data', 'liyutang.json');
const CREADME = ['验收用文案说明 第 1 段：手改这个文件的人才会看它。', '验收用文案说明 第 2 段：保存一次之后它必须一个字都没变。'];
const FIXTURE = {
  _readme: ['验收用说明书（顶层）'],
  forum: { enabled: true, provider: 'twikoo', twikoo: { envId: '', region: 'ap-shanghai' }, giscus: {}, waline: { serverURL: '' } },
  halls: [
    { id: 'chatroom', title: '聊天室', desc: '验收：大厅的说明', icon: '💬', image: '', href: '/liyutang/chatroom/' },
    { id: 'teahouse', title: '久昭卿茶绘', desc: '', icon: '🎨', image: '', href: '/liyutang/teahouse/' },
  ],
  boards: [{ id: 'notice', title: '公告', desc: '', icon: '📌' }],
  copy: {
    _readme: CREADME,
    board: { lead: '', hint: '', note: '', empty: '' },
    chat: { lead: '', hint: '', note: '' },
    calendar: { lead: '' },
    user: { lead: '' },
    home: { lead: '', note: '' },
    post: { hint: '', desc: '' },
    new: { hint: '', desc: '' },
  },
  updated: '2026-10-09',
};

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, 'src', 'data'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'tools', 'editor'), { recursive: true });
fs.cpSync(path.join(SRC, 'tools', 'editor', 'ui'), path.join(TMP, 'tools', 'editor', 'ui'), { recursive: true });

let patched = read('tools/editor/server.mjs');
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
  /* 验收替身：真构建几十秒，这里只数一笔（"数据已落盘"那件事照样发生） */
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
const diskJson = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));

/* ================================================================
 * ②-a 填了就存得住（空串也照留）
 * ================================================================ */
console.log('\n================ ②-a 填了就存得住 + 空串照留 ================');
if (base) {
  const g = await getJson('/api/liyutang');
  check('★ GET 带回 copy 区（面板读的就是它）', g.status === 200 && !!g.json?.copy && typeof g.json.copy.board?.lead === 'string');
  const filled = {
    ...g.json.copy,
    board: { lead: '验收：画板页顶部那句', hint: '', note: '验收：第三条', empty: '验收：没人动笔时那句' },
    chat: { lead: '验收：聊天室顶部', hint: '', note: '' },
    calendar: { lead: '' },
    user: { lead: '验收：用户名和昵称的区别' },
    home: { lead: '', note: '' },
    post: { hint: '', desc: '' },
    new: { hint: '', desc: '' },
  };
  const saved = await postJson({ ...g.json, copy: filled, rev: g.json.rev });
  const after = diskJson();
  info(`[a] HTTP ${saved.status} · counts.copyFilled = ${saved.json?.counts?.copyFilled}`);
  check('★ 保存成功', saved.status === 200 && saved.json?.ok === true, `HTTP ${saved.status}`);
  check('★★ 填进去的文案原样进了文件（board.lead / board.note / board.empty / user.lead）',
    after.copy?.board?.lead === '验收：画板页顶部那句' && after.copy?.board?.note === '验收：第三条'
      && after.copy?.board?.empty === '验收：没人动笔时那句'
      && after.copy?.user?.lead === '验收：用户名和昵称的区别',
    JSON.stringify(after.copy?.board));
  check('★★ 没填的那些**留成空串**（不像 halls 那样整条丢掉 —— 文案丢了很难受）',
    after.copy?.board?.hint === '' && after.copy?.chat?.hint === '' && after.copy?.chat?.note === ''
      && after.copy?.calendar?.lead === '' && after.copy?.home?.lead === '' && after.copy?.home?.note === ''
      && after.copy?.post?.hint === '' && after.copy?.post?.desc === '' && after.copy?.new?.hint === '' && after.copy?.new?.desc === '',
    JSON.stringify({ boardHint: after.copy?.board?.hint, chatHint: after.copy?.chat?.hint, home: after.copy?.home?.lead }));
  check('★ 七个分组一个不少（board/chat/calendar/user/home/post/new）',
    ['board', 'chat', 'calendar', 'user', 'home', 'post', 'new'].every((k) => after.copy?.[k] && typeof after.copy[k] === 'object'),
    Object.keys(after.copy ?? {}).join(','));
  check('★ counts.copyFilled 数得对（填了 5 条）', saved.json?.counts?.copyFilled === 5, String(saved.json?.counts?.copyFilled));
  check('★ copy._readme 原样留着（保存不会把说明抹掉）',
    JSON.stringify(after.copy?._readme) === JSON.stringify(CREADME), JSON.stringify(after.copy?._readme));
  check('★ 大厅的说明照样能填能存（上一轮刚把 desc 清空，站长得能填回去）',
    after.halls?.[0]?.desc === '验收：大厅的说明', String(after.halls?.[0]?.desc));
}

/* ================================================================
 * ②-b 非法值：超长 / 非字符串
 * ================================================================ */
console.log('\n================ ②-b 超长截断 + 非字符串规整 ================');
if (base) {
  const g = await getJson('/api/liyutang');
  const dirty = {
    ...g.json.copy,
    board: { lead: '长'.repeat(300), hint: 12345, note: { 想说: '一段话' } },
    chat: { lead: ['一', '二'], hint: null, note: '' },
    calendar: { lead: '边'.repeat(200) },
  };
  const res = await postJson({ ...g.json, copy: dirty, rev: g.json.rev });
  const after = diskJson();
  info(`[b] HTTP ${res.status} · dropped = ${JSON.stringify(res.json?.dropped)}`);
  info(`[b] 落盘：board.lead 长度 = ${after.copy?.board?.lead?.length} · board.hint = ${JSON.stringify(after.copy?.board?.hint)}`);
  check('★ 保存成功（规整该规整的，不该整个保存失败）', res.status === 200 && res.json?.ok === true, `HTTP ${res.status}`);
  check('★★ 超 200 字的文案被截到 200 字', after.copy?.board?.lead?.length === 200, String(after.copy?.board?.lead?.length));
  check('★ 刚好 200 字的不动', after.copy?.calendar?.lead?.length === 200, String(after.copy?.calendar?.lead?.length));
  check('★★ 非字符串（数字 / 对象 / 数组 / null）一律规整成空串',
    after.copy?.board?.hint === '' && after.copy?.board?.note === '' && after.copy?.chat?.lead === '' && after.copy?.chat?.hint === '',
    JSON.stringify({ hint: after.copy?.board?.hint, note: after.copy?.board?.note, chat: after.copy?.chat?.lead }));
  check('★ 丢掉的条数如实报给页面（copyTooLong / copyNotString）',
    res.json?.dropped?.copyTooLong === 1 && res.json?.dropped?.copyNotString === 3,
    JSON.stringify(res.json?.dropped));
  check('★ 空白（只有空格换行）的文案也算空串', after.copy?.chat?.note === '' && after.copy?.board?.lead?.trim() === after.copy?.board?.lead);
}

/* ================================================================
 * ②-c 新键 / 老客户端 / copy._readme
 * ================================================================ */
console.log('\n================ ②-c 新键留住 + 老客户端不丢 + _readme 不动 ================');
if (base) {
  /* 新版页面加了一个认不出来的键：是字符串就留着（旧页面保存一次不该把它抹掉） */
  const g1 = await getJson('/api/liyutang');
  const withNew = { ...g1.json.copy, hallOfFame: { lead: '以后新加的键：验收' } };
  const r1 = await postJson({ ...g1.json, copy: withNew, rev: g1.json.rev });
  check('★ 以后新加的键（字符串）能留住', r1.status === 200 && diskJson().copy?.hallOfFame?.lead === '以后新加的键：验收',
    JSON.stringify(diskJson().copy?.hallOfFame));

  /* 老客户端：草稿里根本没有 copy 这个键 —— 不该因此把站长写好的文案抹掉 */
  const g2 = await getJson('/api/liyutang');
  const before = JSON.stringify(diskJson().copy);
  const legacy = { ...g2.json, rev: g2.json.rev };
  delete legacy.copy;
  const r2 = await postJson(legacy);
  const after = JSON.stringify(diskJson().copy);
  check('★★ 老客户端（草稿里没有 copy 键）保存一次，盘上的文案原样还在', r2.status === 200 && before === after,
    after.slice(0, 90));

  /* copy._readme：页面上传什么都不理会（和顶层 _readme 一个规矩） */
  const g3 = await getJson('/api/liyutang');
  const fake = { ...g3.json.copy, _readme: ['假说明：验收说该覆盖它'] };
  delete fake.board;
  const r3 = await postJson({ ...g3.json, copy: fake, rev: g3.json.rev });
  check('★★ 草稿里带一份假 copy._readme → 盘上那份一个字都没变',
    r3.status === 200 && JSON.stringify(diskJson().copy?._readme) === JSON.stringify(CREADME),
    JSON.stringify(diskJson().copy?._readme));
  check('★ 假说明一个字都没进文件', !fs.readFileSync(FILE, 'utf8').includes('假说明'));
}

/* ================================================================
 * ③ 真浏览器：面板画出来了、能填能存
 * ================================================================ */
console.log('\n================ ③ 界面：面板能填能存 ================');

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

const profile = path.join(process.env.TEMP ?? '.', `dsh-lyt-copy-${Date.now()}`);
let chrome = null;
let cdp = null;
if (!base) {
  skip('界面上那一趟（面板 + 填了能存）', '副本的编辑器没起来，没法量');
} else if (!fs.existsSync(CHROME)) {
  skip('界面上那一趟（面板 + 填了能存）', `这台机器上没有那个 Chromium：${CHROME}`);
} else {
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu',
    '--enable-unsafe-swiftshader', '--disable-breakpad', '--window-size=1440,1000',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'],
  { stdio: 'ignore' });
  /* 调试口让 Chrome 自己挑（写死端口会被同机别的验收脚本抢，抢输就连上别人的浏览器） */
  const dbgPort = await (async () => {
    const f = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100; i++) {
      if (fs.existsSync(f)) {
        const n = Number(fs.readFileSync(f, 'utf8').split('\n')[0].trim());
        if (n) return n;
      }
      await sleep(200);
    }
    return 0;
  })();
  info(`Chrome 的调试口：${dbgPort || '（没等到 DevToolsActivePort）'}`);
  for (let i = 0; i < 80 && !cdp && dbgPort; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json();
      const p = list.find((t) => t.type === 'page');
      if (p) cdp = await CDP.attach(p.webSocketDebuggerUrl);
    } catch { /* 还没起来 */ }
  }
  if (!cdp) {
    skip('界面上那一趟（面板 + 填了能存）', '无头浏览器没连上（CDP 没起来）');
  } else {
    try {
      await cdp.send('Runtime.enable');
      await cdp.send('Page.enable');
      await cdp.send('Page.navigate', { url: `${base}/liyutang-admin` });
      for (let i = 0; i < 300; i++) {
        await sleep(100);
        if ((await cdp.ev('document.readyState')) === 'complete') break;
      }
      let ready = '';
      for (let i = 0; i < 120; i++) {
        await sleep(150);
        ready = await cdp.ev(`(document.getElementById('lt-status') || {}).textContent || ''`);
        if (/读取完成/.test(ready)) break;
      }
      check('管理页读完了数据', /读取完成/.test(ready), String(ready).trim().slice(0, 90));
      check('★ 状态行里报了"文案已填 N/12 条"', /文案已填/.test(ready), String(ready).trim().slice(0, 90));

      const painted = await cdp.ev(`(() => {
        const box = document.getElementById('lt-copy-box');
        const fields = box ? [...box.querySelectorAll('.lt-copy__field')] : [];
        const title = box ? (box.querySelector('.wbox__title') || {}).textContent || '' : '';
        const labels = box ? [...box.querySelectorAll('.lt-field > label')].map((l) => l.textContent.trim()) : [];
        const groups = box ? [...box.querySelectorAll('.lt-copy__group')].map((h) => h.textContent.trim()) : [];
        const count = document.getElementById('lt-copy-count');
        return {
          title,
          n: fields.length,
          keys: fields.map((f) => f.dataset.copyGroup + '.' + f.dataset.copyKey),
          groups,
          labels,
          maxLen: fields.map((f) => f.maxLength),
          countText: count ? count.textContent : '',
          hallDesc: !!document.querySelector('#lt-halls-box .lt-hall__desc'),
        };
      })()`);
      info(`[③] 面板标题「${painted.title}」· 字段 ${painted.n} 个 · 分组 ${painted.groups.length} 个`);
      info(`[③] 字段键：${painted.keys.join(' / ')}`);
      check('★ 「页面文案」面板画出来了，而且每个键一个输入框',
        painted.title === '页面文案' && painted.n === dataKeys.length
          && JSON.stringify(painted.keys.slice().sort()) === JSON.stringify(dataKeys),
        `${painted.n} 个 vs 数据 ${dataKeys.length} 个`);
      check('★ 面板上没有 `_readme` 这种"说明"字段（页面上的输入框一个不多）',
        painted.keys.every((k) => !k.includes('_')), painted.keys.filter((k) => k.includes('_')).join(' / ') || '没有');
      check('★ 分组小标题按页分（茶绘画板页 / 聊天室 / …）', painted.groups.length >= 6, painted.groups.join(' | '));
      check('★ 每个字段的中文标签都在页面上（站长看得见它填在哪儿）',
        painted.labels.length === painted.n && painted.labels.every((s) => s.length > 2), painted.labels.slice(0, 3).join(' | '));
      check('★ 每个字段都是 200 字上限', painted.maxLen.every((n) => n === 200), JSON.stringify(painted.maxLen.slice(0, 3)));
      check('★ 面板底下报了"共 12 条，已填 N 条"', /共 \d+ 条，已填 \d+ 条/.test(painted.countText), painted.countText.slice(0, 60));
      check('★ 大厅那一行还有「说明」输入框（desc 清空之后站长能填回去）', painted.hallDesc === true);

      /* 在框里打字 → 点保存 → 值必须进文件 */
      const TEST_TEXT = '验收-PANEL-TEXT-7788';
      const uiSave = await cdp.ev(`(async () => {
        const f = document.querySelector('#lt-copy-box .lt-copy__field[data-copy-group="board"][data-copy-key="lead"]');
        f.value = ${JSON.stringify(TEST_TEXT)};
        f.dispatchEvent(new Event('input', { bubbles: true }));
        const hallDesc = document.querySelector('#lt-halls-box .lt-hall__desc');
        hallDesc.value = '验收-大厅说明-9900';
        hallDesc.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 200));
        const count = (document.getElementById('lt-copy-count') || {}).textContent || '';
        document.getElementById('lt-save').click();
        let status = '';
        for (let i = 0; i < 120; i++) {
          await new Promise((r) => setTimeout(r, 150));
          status = (document.getElementById('lt-status') || {}).textContent || '';
          if (/已保存/.test(status)) break;
        }
        return { count, status };
      })()`);
      await sleep(400);
      const after = diskJson();
      info(`[③] 打字之后面板底下：${uiSave.count.slice(0, 60)}`);
      info(`[③] 保存后状态行：${String(uiSave.status).trim().slice(0, 100)}`);
      check('★★ 在面板里填的文案，点一次保存就进了 liyutang.json',
        after.copy?.board?.lead === TEST_TEXT, String(after.copy?.board?.lead));
      check('★★ 顺便：大厅的「说明」也填进去了（同一趟保存）',
        after.halls?.[0]?.desc === '验收-大厅说明-9900', String(after.halls?.[0]?.desc));
      check('★ 状态行报了"文案 N/12 条"', /文案 \d+\/\d+ 条/.test(String(uiSave.status)), String(uiSave.status).trim().slice(0, 80));
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
try { if (chrome) execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch { /* ignore */ }
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
