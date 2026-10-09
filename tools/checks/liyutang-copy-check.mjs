/*
 * ============================================================================
 * 黎语堂「生造文案」守卫 + `copy` 接口接线检查（2026-10-09 建）
 * ----------------------------------------------------------------------------
 * 用户原话（这一轮最重的一条）：
 *   「当前的黎语堂网站里充斥着过多你自己胡编乱造的提示和简介 例如【滚轮在画布上缩放……】
 *    【一块大家共用的画板……】【一句一句地聊，像 QQ 那样……】这些句子可读性极差！！！
 *    对群友理解各个功能造成了极大的影响！！！！！请你全部删掉全部这一类你自己生造的句子
 *    并且给对应的位置留下编辑器接口以方便我去填写介绍和简介 并且之后制作的内容也不要出现
 *    这种你自己生造的句子！」
 *
 * 所以这个脚本管这几件事，缺一不可：
 *   ① **不许再犯**：那批被删掉的句子（以及它们的特征词）**一句都不许再出现在黎语堂页面上**——
 *      既扫 `.astro` 源码的**可见文本**，也扫构建产物 `dist/liyutang/**` 的**可见文本**。
 *      ⚠ "可见文本"包括**属性的值**：`title="…"`（鼠标悬停就看见）、`placeholder="…"`（输入框里就是它）、
 *        `description={…}` / `<meta content="…">`（搜索结果和分享卡片就是它）。
 *        2026-10-09 补的漏洞：原来把整个标签连属性一起删掉，于是"生造句子写进 title"能一路溜过去
 *        （实测：`teahouse.astro` 的 `title="滚轮（或触控板）在画布上缩放"` 当时就不在判定范围里）。
 *        `aria-label` / `alt` 仍然豁免关键词扫描（读屏文字常常又长又绕），但**那批整句也不许出现**，
 *        另外偏长的（>16 个汉字）会报 WARN。
 *   ② **接口不能脱节**：页面读的 `copy` 键、`server.mjs` 存得住的键、编辑器面板里能填的键，
 *      三处必须**完全一致**（任何一处加了键、另一处没加，站长就会遇到"填了不显示"或者"想填没处填"）。
 *   ③ **空则不渲染**：正文块必须写成 `{x.y && <p>…</p>}`、meta 描述必须写成
 *      `description={x.y || undefined}`（留空退回站点总描述）；构建产物里**不许有空壳** ——
 *      空的 `data-lt-copy` 元素、空的 `lyt-lead` / `lyt-form__hint` / `lyt-empty` / `ltuser__rule`、
 *      空的 `<meta name="description">` 都算。
 *   ④ **`copy._readme` 只是给手改 JSON 的人看的说明**：不进页面、不进面板、单独按"取盘上那份"保留。
 *
 * 为什么先剥注释再判：这一页的历史（为什么删、用户怎么骂的）必须有地方记下来，
 * 那些话只能写在注释里；要是连注释一起判，下一个人就不敢写"为什么"了 —— 那比多一句废话更糟。
 *
 * 用法：node tools/checks/liyutang-copy-check.mjs [dist目录]
 *   dist 目录不存在时，构建产物那几条报 SKIP（源码那几条照跑）。
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(SRC, 'dist'));

let pass = 0;
let fail = 0;
let skipped = 0;
let pending = 0;
let warn = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};
const skip = (name, why) => {
  skipped++;
  console.log(`SKIP  ${name}   :: ${why}`);
};
const warnLine = (name, detail) => {
  warn++;
  console.log(`WARN  ${name}   :: ${detail}`);
};
/** 别人正在改、暂时只报不判的文件（见下面 SOFT_* 的注释） */
const pendingLine = (name, detail) => {
  pending++;
  console.log(`PENDING  ${name}   :: ${detail}`);
};
const info = (s) => console.log(`      · ${s}`);
const read = (rel) => {
  const f = path.join(SRC, rel);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};

/* ================================================================
 * 清单一：删掉的句子（逐句判 —— 报告里要对着核的就是这批）
 * ================================================================ */

/**
 * 用户点名骂过、或者这一轮明确删掉的**整句**。
 * 判法：可见文本里 `includes()` 为假。空格归一化之后再比（换行 / 缩进不该让它漏过去）。
 */
const DELETED = [
  '一句一句地聊，像 QQ 那样。能发图、能翻旧账 —— 每天存档一份，左边的日子轴点一下就跳到那天。',
  '一句一句地聊，像 QQ 那样。能发图，能翻旧账 —— 每天存档一份，左边的日子轴点一下就跳到那天。',
  '一块大家共用的画板。画笔、橡皮、调色板都在，谁都能添两笔；每天存档，日历里能翻回任何一天看当时画成了什么样。',
  '滚轮在画布上缩放（1×~4×）：光标底下那一点会被钉住不动；按住空格、或者用「抓手」/鼠标中键拖动看别处。',
  '翻一翻聊天室过去说过的话。打几个字就行，多个词用空格隔开（每个词都要命中），结果按日子从新到旧排。',
  '那一天说过的话，原样留在这儿 —— 不用登录也能翻。左边那条日子轴点一下就换一天，想找某句话就去搜索历史。',
  '每天存档一张当天画完的样子。点一天，就能看那块画板当天被画成了什么样。',
  '还没有画过 —— 等这一天有人动笔、第二天存档跑过，这里就会长出那一天的画。现在去 画板 上添两笔吧。',
  '还没有版块 —— 编辑器右上角「黎语堂管理」里建一个（版块 id 就是网址里那一段，例如 notice）。',
  '用户名是注册时定下来的那个（上面带 @ 的那一串）：用来登录，不能改。昵称随时能改，论坛里别的地方显示的都是昵称。',
  '以后会长在这里',
  /* 下面这批是 2026-10-09 第二轮从 meta 描述 / 悬停提示里搬走或删掉的句子（属性里的字也算页面的字） */
  '黎语堂 —— 花涧堂自己的论坛：版块、帖子，注册一个账号让站长过审之后就能发帖。',
  '搜黎语堂聊天室的历史记录：关键词在浏览器里过滤，不用登录，搜索不花云端额度。',
  '黎语堂的用户页：看自己的资料（能改昵称和头像），也能看别人的（只读）。',
  '久昭卿茶绘：每一天的画。',
  '黎语堂里的一条帖子。',
  '在黎语堂发帖。',
  '黎语堂的聊天室。',
  '传图（压到 1600px 后内嵌）',
  '看一眼发出来长什么样',
];

/**
 * 特征词：整句可能被人改几个字重写一遍（"删了但换个说法又长出半句"），
 * 所以再拿这些**分管一句话**扫一遍 —— 它们不该出现在黎语堂任何页面的可见文本里。
 */
const KEYWORDS = [
  '像 QQ 那样',
  '一句一句地聊',
  '翻旧账',
  '每天存档一份',
  '一块大家共用的画板',
  '谁都能添两笔',
  '日历里能翻回任何一天',
  '光标底下那一点',
  '钉住不动',
  '手机没有滚轮',
  '手动存档',
  '以后会长在这里',
  '一条一条都在这儿',
];

/** 逗号后面那种"闲聊尾巴"：用户嫌啰嗦，但没点名必删 —— 报 WARN，不算失败 */
const CHATTY = ['你可以先画两笔', '你可以是第一个', '你可以先'];

/* ================================================================
 * 清单二：谁读哪一页的哪几把键（键 → 页面 → 位置）
 * ================================================================ */

/**
 * 页面文件 → 它必须读的 `copy` 键（以 `copy().组.键` 的形式写在这份源码里）。
 * 加一页 / 加一处文案时，这份表、`utils/liyutang.ts`、`server.mjs` 的 COPY_SHAPE、
 * 编辑器面板的 COPY_FIELDS 四处一起加（下面有断言盯着它们一致）。
 */
const PAGE_USES = {
  'src/pages/liyutang/index.astro': ['home.lead', 'home.note'],
  'src/pages/liyutang/chatroom.astro': ['chat.lead'],
  'src/pages/liyutang/chatroom/search.astro': ['chat.hint'],
  'src/pages/liyutang/chatroom/[day].astro': ['chat.note'],
  'src/pages/liyutang/teahouse/calendar.astro': ['calendar.lead'],
  'src/pages/liyutang/u/index.astro': ['user.lead'],
  'src/pages/liyutang/new.astro': ['new.hint', 'new.desc'],
  'src/pages/liyutang/post.astro': ['post.hint', 'post.desc'],
  /* 画板那一页归另一个改动（见 SOFT_SOURCE）——这里只登记，不硬判 */
  'src/pages/liyutang/teahouse.astro': ['board.lead', 'board.hint', 'board.note', 'board.empty'],
};

/**
 * 页面 → `<meta name="description">` / `og:description` 该读哪把键。
 *
 * 2026-10-09 第二轮：这些描述原来也是写死的人话（"黎语堂的聊天室。" 之类），
 * 搜索结果和分享卡片上就是那几个字 —— 一样归站长填。写法统一成
 * `description={c.组.键 || undefined}`：留空就交给 ForumLayout 的默认值（站点总描述），
 * 不会留一个空壳。这个表就是"哪一页描述读哪把键"的凭据（下面有断言盯着）。
 * ⚠ `teahouse.astro` 不在表里（归别人）；版块页 / 帖子页 / 那一天的画板页的描述是
 *   "版块名 + 标题 + 日期"这种**数据**拼出来的，本来就没有人写死的句子，所以也没进来。
 */
const DESC_USES = {
  'src/pages/liyutang/index.astro': 'home.lead',
  'src/pages/liyutang/chatroom.astro': 'chat.lead',
  'src/pages/liyutang/chatroom/search.astro': 'chat.hint',
  'src/pages/liyutang/chatroom/[day].astro': 'chat.note',
  'src/pages/liyutang/teahouse/calendar.astro': 'calendar.lead',
  'src/pages/liyutang/u/index.astro': 'user.lead',
  'src/pages/liyutang/new.astro': 'new.desc',
  'src/pages/liyutang/post.astro': 'post.desc',
};

/**
 * 暂时只报不判的源码文件 —— **现在是空的**（2026-10-09 收尾）。
 *
 * `src/pages/liyutang/teahouse.astro` 原来归协调方收尾，那段时间名单里挂着它；
 * 现在它自己已经全绿（meta 描述接了 `copy.board.lead`、空状态接了 `copy.board.empty`、
 * 那批生造句子全清），所以名单清空 —— 画板那一页也**硬判**。
 * 以后真要临时豁免谁，往这里加，并在报告里说清为什么、什么时候撤。
 */
const SOFT_SOURCE = new Set([]);
/** 同理：构建产物里没有任何页面享受豁免（原来挂的是 `liyutang/teahouse/index.html`） */
const SOFT_DIST_PAGE = '';

/* ================================================================
 * 工具：把"代码"剥掉，只留页面上看得见的字
 * ================================================================ */

/** .astro 源码 → 可见文本：剥 frontmatter / 注释 / 表达式 / 标签（连属性一起），只留标签之间的字 */
function visibleOfAstro(source) {
  let s = source;
  /* frontmatter（--- … --- 那一段）是服务端代码，不是页面上的字 */
  s = s.replace(/^---[\s\S]*?\n---/, '\n');
  return visibleOfHtml(s);
}

/**
 * 源码 → **只把注释剥掉**（标签和属性都留着）。
 * 用来抓"写进 `description=""` / `placeholder=""` 这类属性里的生造句子"——
 * 它们不在页面正文里，但确实是那段 HTML 的一部分，构建出来就带着走。
 * ⚠ 注释必须剥：这一页的历史（用户怎么骂的、为什么删）只能写在注释里，
 *   要是连注释一起判，下一个人就不敢写"为什么"了。
 */
function stripComments(source) {
  return source
    .replace(/^---[\s\S]*?\n---/, '\n')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    /* `//` 行注释：`[^:]` 是为了不把 `https://…` 当成注释从这儿切掉 */
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

/**
 * 属性里那些"用户看得见"的值（2026-10-09 补上的一个真漏洞）。
 *
 * 原来这里把整个标签（连属性）一次删掉 —— 于是只要把生造句子写进
 * `title="…"`（鼠标悬停就弹出来）、`placeholder="…"`（输入框里就是它）、
 * 或者 `<meta name="description" content="…">`（搜索结果 / 分享卡片上就是它），
 * 就完全躲过了判定。所以现在先把这几种属性的**值**抠出来、一起算进"可见文本"：
 *   · `title` / `placeholder`：源码里直接写，构建产物里也原样；
 *   · `description`：Astro 组件的 prop（源码里长这样）；
 *   · `content`：构建产物里 `<meta name="description" content="…">` / `og:description` 走的是它。
 * `aria-label` / `alt` **仍然豁免关键词扫描**（读屏文字常常又长又绕，全判会逼着人不敢写），
 * 但下面单独断言它们**不含那批整句**。
 */
const ATTR_TEXT_RE = /\b(title|description|placeholder|content)\s*=\s*("([^"]*)"|'([^']*)')/g;

/** 抠出所有"看得见的属性值"（标签之间的字之外的第二种可见文字） */
function attrTextOf(html) {
  const out = [];
  ATTR_TEXT_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_TEXT_RE.exec(html))) out.push(m[3] ?? m[4] ?? '');
  return out;
}

/** 抠出 aria-label / alt（豁免关键词，但整句也不许出现） */
function ariaTextOf(html) {
  const out = [];
  const re = /\b(aria-label|alt)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(html))) out.push(m[3] ?? m[4] ?? '');
  return out;
}

/** HTML（含 astro 模板）→ 可见文本
 *  ⚠ 顺序要紧：**先抠属性值**（那时标签还在），再剥注释 / script / style / 标签，
 *    最后把属性值拼回末尾 —— 拼在一起之后，"生造句子写进属性里"就藏不住了。
 */
function visibleOfHtml(html) {
  let s = html;
  const attrs = attrTextOf(s);
  /* 注释 */
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');
  /* <script> / <style> 里的东西不是"看得见的字"（脚本里的状态文案另有规矩：短、只讲事实） */
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  /* 标签（连属性）：地址之类不算字（真正算字的属性上面已经抠走了） */
  s = s.replace(/<[^>]*>/g, ' ');
  /* 表达式 `{…}` 里是代码；但里头的字符串字面量可能正是我们要抓的（比如 JS 里写死的文案），
     所以**不整段删**，只把花括号本身去掉，让字符串露出来给人判 */
  s = s.replace(/[{}]/g, ' ');
  return `${s.replace(/\s+/g, ' ').trim()} ${attrs.join(' ')}`.replace(/\s+/g, ' ').trim();
}

/** 找某段文字出现在哪些行（报告里要说清"哪一行还留着"） */
function locate(text, needle) {
  const hits = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (line.includes(needle)) hits.push(`${i + 1}: ${line.trim().slice(0, 90)}`);
  });
  return hits;
}

/* ================================================================
 * ① 静态：接口都接上了没有
 * ================================================================ */
console.log('================ ① 静态：copy 接口三处对齐 ================');

const utils = read('src/utils/liyutang.ts');
const server = read('tools/editor/server.mjs');
const uiJs = read('tools/editor/ui/liyutang.js');
const uiHtml = read('tools/editor/ui/liyutang.html');

check('utils/liyutang.ts 里有 SiteCopy + copy()', /export interface SiteCopy/.test(utils) && /export function copy\(\): SiteCopy/.test(utils));

/* ---- ①-a 读取器不给默认文案（缺字段一律空串，代码里不许有兜底句子） ---- */
const copyBody = (() => {
  const i = utils.indexOf('export function copy(): SiteCopy {');
  if (i < 0) return '';
  let depth = 0;
  for (let j = i + 'export function copy(): SiteCopy {'.length - 1; j < utils.length; j++) {
    if (utils[j] === '{') depth++;
    else if (utils[j] === '}') {
      depth--;
      if (depth === 0) return utils.slice(i, j + 1);
    }
  }
  return '';
})();
check('抠得出 copy() 这一整段（不是拿空串在自欺欺人）', copyBody.length > 200, `${copyBody.length} 字符`);
check(
  '★★ copy() 的**代码里一个中文字都没有** —— 它不可能给出任何兜底文案（缺字段只能是空串）',
  copyBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/[\u4e00-\u9fff]/g, '').length ===
    copyBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').length,
  '剥掉注释后不含 CJK'
);
check(
  '★ copy() 走 copyGroup() 洗字段（值一律 trim 成字符串）',
  /function copyGroup\(/.test(utils) && /out\[k\] = str\(src\[k\]\)/.test(utils)
);

/* ---- ①-b 每个页面都读 copy()，而且**条件渲染**（空则不渲染） ---- */
for (const [file, keys] of Object.entries(PAGE_USES)) {
  const text = read(file);
  if (!text) {
    check(`${file} 在（读得到源码）`, false, '读不到这个文件');
    continue;
  }
  const soft = SOFT_SOURCE.has(file);
  const miss = [];
  const unguarded = [];
  for (const key of keys) {
    const [group, name] = key.split('.');
    /*
      页面里把它读出来的两种写法都算：
        · `copy().组.键`（或者 `const c = copy()` 之后 `c.组.键`）；
        · 先把分组取出来再拆（画板那一页就是 `const cp = copy().board;` 然后解构出 lead/hint/note）——
          所以"分组出现过 + 键名作为一个词出现过"也算读了，不然这里会误报"没读"。
    */
    const used =
      new RegExp(`\\.${group}\\.${name}\\b`).test(text) ||
      (new RegExp(`\\.${group}\\b`).test(text) && new RegExp(`\\b${name}\\b`).test(text));
    if (!used) miss.push(key);
    /*
      两个位置两种"空则不显示"的写法，各自判各自的：
        · 页面正文里那一块：`{x.y && <p>…</p>}`（留空就整块不渲染；写成 `{x.y}` 就是"空壳也渲染"，不许）；
        · meta 描述（DESC_USES 里那几把键）：`description={x.y || undefined}`（留空退回站点总描述）。
    */
    const isDesc = DESC_USES[file] === key;
    const guarded = isDesc
      ? new RegExp(`description=\\{[^}]*\\.${group}\\.${name}\\s*\\|\\|\\s*undefined[^}]*\\}`).test(text)
      : new RegExp(`[\\w$.]*${name}\\s*&&`).test(text) || new RegExp(`\\b${name}\\b[^\\n]*&&`).test(text);
    if (!guarded) unguarded.push(key);
  }
  const detail = [
    miss.length ? `没读：${miss.join(' / ')}` : '',
    unguarded.length ? `没有条件渲染（空则会留空壳）：${unguarded.join(' / ')}` : '',
  ]
    .filter(Boolean)
    .join('；');
  if (soft && detail) pendingLine(`${file} 读了 ${keys.join(' / ')} 而且空则不渲染`, detail);
  else check(`${file} 读了 ${keys.join(' / ')} 而且空则不渲染`, detail === '', detail);
}

check(
  '★ 没有"没填就顶上"的兜底写法（`copy().x.y || \'中文…\'` / `?? \'中文…\'`）',
  !/\.(lead|hint|note|desc|empty)\s*(\|\||\?\?)\s*['"`][^'"`]*[\u4e00-\u9fff]/.test(
    Object.keys(PAGE_USES).map((f) => read(f)).join('\n')
  )
);

/* ---- ①-b′ meta 描述也归站长写（不写死、留空退回站点总描述） ---- */
for (const [file, key] of Object.entries(DESC_USES)) {
  const text = read(file);
  const [group, name] = key.split('.');
  /* 写法必须是 `description={c.组.键 || undefined}`：留空 → ForumLayout 的默认值（站点总描述） */
  const fromCopy = new RegExp(`description=\\{[^}]*\\.${group}\\.${name}\\s*\\|\\|\\s*undefined[^}]*\\}`).test(text);
  const hardcoded = /description="[^"]*[\u4e00-\u9fff][^"]*"/.test(text);
  check(
    `${file} 的 meta 描述读 copy.${key}（留空退回站点总描述）`,
    fromCopy && !hardcoded,
    fromCopy ? '' : '没写成 description={…||undefined}（或者是写死的中文）'
  );
}

/* ---- ①-c 键表三处一致：数据 / 服务端 / 编辑器面板 ---- */
const dataCopy = (() => {
  try {
    return JSON.parse(read('src/data/liyutang.json')).copy ?? {};
  } catch {
    return {};
  }
})();
const dataKeys = [];
for (const [group, gval] of Object.entries(dataCopy)) {
  if (group.startsWith('_')) continue;
  if (!gval || typeof gval !== 'object' || Array.isArray(gval)) continue;
  for (const key of Object.keys(gval)) dataKeys.push(`${group}.${key}`);
}
dataKeys.sort();

const serverKeys = (() => {
  const i = server.indexOf('const COPY_SHAPE = {');
  if (i < 0) return [];
  const body = server.slice(i, server.indexOf('};', i));
  const out = [];
  const re = /(\w+):\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(body))) {
    for (const k of m[2].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean)) {
      out.push(`${m[1]}.${k}`);
    }
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

info(`数据里的键（${dataKeys.length}）：${dataKeys.join(' / ')}`);
info(`server.mjs COPY_SHAPE（${serverKeys.length}）：${serverKeys.join(' / ')}`);
info(`编辑器面板 COPY_FIELDS（${uiKeys.length}）：${uiKeys.join(' / ')}`);
check(
  '★★ 数据 copy 区的键 = server.mjs 的 COPY_SHAPE（保存时留得住，空串不丢）',
  dataKeys.length > 0 && JSON.stringify(dataKeys) === JSON.stringify(serverKeys),
  `${dataKeys.length} vs ${serverKeys.length}`
);
check(
  '★★ 数据 copy 区的键 = 编辑器面板的字段（每个键都有输入框，键和 UI 不许脱节）',
  dataKeys.length > 0 && JSON.stringify(dataKeys) === JSON.stringify(uiKeys),
  `${dataKeys.length} vs ${uiKeys.length}`
);
check(
  '★ 每个键在 utils/liyutang.ts 的 SiteCopy 里也有（站点读得到）',
  (() => {
    const body = utils.slice(utils.indexOf('export interface SiteCopy'), utils.indexOf('export interface SiteCopy') + 800);
    return [...dataKeys, ...serverKeys].every((k) => new RegExp(`\\b${k.split('.')[1]}\\b`).test(body));
  })()
);
check(
  '★ 面板那块在页面上真有位置（`#lt-copy-box` 在 html 和 js 里都有），而且 render() 会画它',
  /id="lt-copy-box"/.test(uiHtml) && /\$\('lt-copy-box'\)/.test(uiJs) && /renderCopy\(\)/.test(uiJs)
);
check(
  '★ 每个字段都带 data-copy-group / data-copy-key（验收脚本照着它填）',
  /dataset\.copyGroup/.test(uiJs) && /dataset\.copyKey/.test(uiJs) && /lt-copy__field/.test(uiJs)
);
check(
  '★ 服务端对 copy 是"空串照留"（不掉整条），值只收字符串且封顶 200 字',
  /COPY_MAX = 200/.test(server) && /dropped\.copyTooLong\+\+/.test(server) && /dropped\.copyNotString\+\+/.test(server)
    && /out\[key\] = s\.slice\(0, COPY_MAX\)/.test(server)
);
check(
  '★ `copy._readme` 和顶层 `_readme` 一个规矩：永远取盘上那份',
  /if \(current\.copy && Array\.isArray\(current\.copy\._readme\)\) file\.copy\._readme = current\.copy\._readme;/.test(server)
);
check(
  '★ 老客户端（草稿里没有 copy 键）保存一次不会把文案抹掉（退回盘上那份）',
  /payload\.copy && typeof payload\.copy === 'object'/.test(server) && /current\.copy && typeof current\.copy === 'object'/.test(server)
);

/* ---- ①-d `copy._readme` 只是"给手改 JSON 的人看的说明"：不进面板、也不进页面 ---- */
check(
  '★ copy() 不碰 _readme（站点只读那几组键，说明不会被渲染到页面上）',
  !/_readme/.test(copyBody)
);
check(
  '★ 编辑器面板里没有 _readme 字段（它不是一个可填的文案；字段表就是下面那些键）',
  !/key:\s*'_readme'/.test(uiJs) && uiKeys.every((k) => !k.includes('_')) && !/data-copy-key="?_readme/.test(uiHtml)
);
check(
  '★ 服务端的 COPY_SHAPE 里没有 _readme（它单独按"永远取盘上那份"保留，不参与字段清洗）',
  (() => {
    /* 先把 COPY_SHAPE 那一整段抠出来再判 —— 直接拿正则跨段匹配会吃到后面 copy 处理里那些 `_readme` */
    const i = server.indexOf('const COPY_SHAPE = {');
    if (i < 0) return false;
    const j = server.indexOf('};', i);
    if (j < 0) return false;
    const block = server.slice(i, j);
    return block.includes('board') && !block.includes('_readme');
  })()
);

/* ================================================================
 * ② 源码：那些句子一句都不许剩
 * ================================================================ */
console.log('\n================ ② 源码：黎语堂页面里不许有这些句子 ================');

const SOURCE_FILES = [
  ...Object.keys(PAGE_USES),
  'src/components/LiyutangChatRail.astro',
  'src/components/LiyutangAccount.astro',
  'src/components/LiyutangTopBar.astro',
];

const sourceText = new Map();
for (const f of SOURCE_FILES) {
  const raw = read(f);
  if (!raw) {
    check(`读得到 ${f}`, false, '文件不在');
    continue;
  }
  /* 可见文本（剥注释 / 标签 / 脚本，**含 title/description/placeholder/content 的值**）
     + **只剥注释**的源码（再兜一道）+ 原文（报告里要指出行号） */
  sourceText.set(f, {
    visible: visibleOfAstro(raw),
    noComments: stripComments(raw),
    aria: [...ariaTextOf(raw)],
    raw,
  });
}

/* aria-label / alt：豁免关键词扫描，但那批**整句**也不许出现（读屏用户听到的就是它们） */
{
  const hard = [];
  const soft = [];
  const longOnes = [];
  for (const [f, t] of sourceText) {
    for (const v of t.aria) {
      const flat = v.replace(/\s+/g, ' ').trim();
      if (!flat) continue;
      /* 又长又像"一段说明"的 aria 也报一声（WARN）：读屏文字该短 */
      if ([...flat].filter((c) => /[\u4e00-\u9fff]/.test(c)).length > 16) longOnes.push(`${f}：「${flat}」`);
      for (const sentence of DELETED) {
        if (!flat.includes(sentence.replace(/\s+/g, ' '))) continue;
        (SOFT_SOURCE.has(f) ? soft : hard).push(`${f}：「${flat.slice(0, 60)}」`);
      }
    }
  }
  if (hard.length) {
    fail++;
    console.log(`FAIL  aria-label / alt 里出现了那批整句   :: ${hard.join(' | ')}`);
  } else if (soft.length) {
    pending++;
    console.log(`PENDING  aria-label / alt 里出现了那批整句（在别人的文件里）   :: ${soft.join(' | ')}`);
  } else {
    pass++;
    console.log('PASS  ★ aria-label / alt 里没有那批整句（豁免关键词扫，但整句也不许有）');
  }
  for (const l of longOnes) warnLine('aria-label / alt 偏长（读屏文字该短）', l);
}

/* 逐句：先按"整句"判（这是报告里要对着核的那批） */
let sentenceHit = 0;
for (const sentence of DELETED) {
  const hits = [];
  for (const [f, t] of sourceText) {
    const flat = t.visible.replace(/\s+/g, ' ');
    if (flat.includes(sentence.replace(/\s+/g, ' '))) {
      if (SOFT_SOURCE.has(f)) hits.push(`${f}（别人的文件，只报不判）`);
      else hits.push(f);
    }
  }
  const hard = hits.filter((h) => !h.includes('别人的文件'));
  if (hard.length) sentenceHit++;
  console.log(
    `${hard.length ? 'FAIL' : hits.length ? 'PENDING' : 'PASS'}  源码里没有：${sentence.slice(0, 42)}${sentence.length > 42 ? '…' : ''}` +
      (hits.length ? `   :: ${hits.join(' / ')}` : '')
  );
  if (hard.length) fail++;
  else if (hits.length) pending++;
  else pass++;
}
info(`整句比对：${DELETED.length} 句，命中 ${sentenceHit} 句（要求 0）`);

/* 特征词：整句可能被改写，所以再扫一遍关键词（注释不算 —— 见 stripComments 那段） */
for (const kw of KEYWORDS) {
  const hard = [];
  const soft = [];
  for (const [f, t] of sourceText) {
    if (!t.noComments.includes(kw)) continue;
    (SOFT_SOURCE.has(f) ? soft : hard).push(...locate(t.raw, kw).map((l) => `${f}:${l}`));
  }
  if (hard.length) {
    fail++;
    console.log(`FAIL  源码特征词「${kw}」还在   :: ${hard.join(' | ')}`);
  } else if (soft.length) {
    pending++;
    console.log(`PENDING  源码特征词「${kw}」只在别人的文件里   :: ${soft.join(' | ')}`);
  } else {
    pass++;
  }
}

/* 闲聊尾巴：报 WARN，不算失败 */
for (const kw of CHATTY) {
  const hits = [];
  for (const [f, t] of sourceText) if (t.visible.includes(kw)) hits.push(...locate(t.raw, kw).map((l) => `${f}:${l}`));
  if (hits.length) warnLine(`闲聊尾巴「${kw}」（能删就删）`, hits.join(' | '));
}

/* ================================================================
 * ③ 构建产物：dist/liyutang 的可见文本里也不许有
 * ================================================================ */
console.log('\n================ ③ 构建产物：dist/liyutang 里也不许有 ================');

const distDir = path.join(ROOT, 'liyutang');
if (!fs.existsSync(distDir)) {
  skip('构建产物那一整段（源码已扫过）', `找不到 ${distDir}（先跑一次构建）`);
} else {
  const pages = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === '_astro') continue;
        walk(p);
      } else if (e.name.endsWith('.html')) {
        pages.push(path.relative(ROOT, p).split(path.sep).join('/'));
      }
    }
  };
  walk(distDir);
  pages.sort();
  info(`构建产物里的黎语堂页面：${pages.length} 个`);

  const htmls = new Map();
  const distAria = new Map();
  const distRaw = new Map();
  for (const rel of pages) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    distRaw.set(rel, html);
    htmls.set(rel, visibleOfHtml(html));
    distAria.set(rel, [...ariaTextOf(html)]);
  }

  /*
    空的文案元素：这一条**不依赖 data-lt-copy 锚点**（画板那一页的文案块就没有锚点），
    直接看那几种"装文案的容器"——`lyt-lead` / `lyt-form__hint` / `lyt-empty` / `ltuser__rule`
    ——有没有渲染出来却是空的（空串 = 整块不渲染，不许留空壳）。
  */
  const emptyBoxes = [];
  for (const [rel, html] of distRaw) {
    const re = /<(p|span)([^>]*class="(?:[^"]*lyt-(?:lead|form__hint|empty)|[^"]*ltuser__rule)[^"]*"[^>]*)>/g;
    let m;
    while ((m = re.exec(html))) {
      const [tagText, tag] = m;
      /*
        脚本自己会填的那些**不算空壳**：它们身上带 `data-lt-*`（挑节点的记号）或者 `hidden`
        （等脚本决定显示）—— 例如发帖页那行"正文 N KB / 4096 KB 上限"、帖子页那个错误框。
        这里要抓的是"本来该由文案填、结果空着"的那种。
      */
      if (/data-lt-|hidden|aria-live/.test(tagText)) continue;
      const close = html.indexOf(`</${tag}>`, m.index + tagText.length);
      if (close < 0) continue;
      const inner = html.slice(m.index + tagText.length, close).replace(/<[^>]*>/g, '').replace(/\s+/g, '');
      if (!inner) emptyBoxes.push(`${rel}（${tagText.slice(0, 60)}）`);
    }
  }
  check(
    '★★ 构建产物里没有"空壳"文案容器（lyt-lead / lyt-form__hint / lyt-empty / ltuser__rule 空的都不许）',
    emptyBoxes.length === 0,
    emptyBoxes.slice(0, 4).join(' | ')
  );

  /* aria-label / alt：整句也不许有（构建产物这一侧同样判） */
  {
    const hard = [];
    const soft = [];
    for (const [rel, vals] of distAria) {
      for (const v of vals) {
        const flat = v.replace(/\s+/g, ' ').trim();
        if (!flat) continue;
        for (const sentence of DELETED) {
          if (!flat.includes(sentence.replace(/\s+/g, ' '))) continue;
          (rel === SOFT_DIST_PAGE ? soft : hard).push(`${rel}：「${flat.slice(0, 50)}」`);
        }
      }
    }
    if (hard.length) {
      fail++;
      console.log(`FAIL  dist 的 aria-label / alt 里出现了那批整句   :: ${hard.join(' | ')}`);
    } else if (soft.length) {
      pending++;
      console.log(`PENDING  dist 的 aria-label / alt 里有那批整句（画板那页）   :: ${soft.join(' | ')}`);
    } else {
      pass++;
      console.log('PASS  ★ dist 的 aria-label / alt 里没有那批整句');
    }
  }

  /* meta 描述也不能留空壳：`copy.*.desc` 空 → 必须退回站点总描述，而不是 content="" */
  const emptyDesc = [];
  const noDesc = [];
  for (const rel of pages) {
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const m = /<meta name="description" content="([^"]*)"/.exec(html);
    if (!m) noDesc.push(rel);
    else if (!m[1].trim()) emptyDesc.push(rel);
  }
  check(
    '★★ 每一页都有非空的 meta 描述（copy 里没填 → 退回站点总描述，不留空壳）',
    emptyDesc.length === 0 && noDesc.length === 0,
    [...emptyDesc, ...noDesc].join(' / ')
  );

  for (const sentence of DELETED) {
    const needle = sentence.replace(/\s+/g, ' ');
    const hits = [];
    for (const [rel, text] of htmls) {
      if (!text.includes(needle)) continue;
      if (rel === SOFT_DIST_PAGE) hits.push(`${rel}（画板那页归别人，只报不判）`);
      else hits.push(rel);
    }
    const hard = hits.filter((h) => !h.includes('只报不判'));
    console.log(
      `${hard.length ? 'FAIL' : hits.length ? 'PENDING' : 'PASS'}  dist 里没有：${sentence.slice(0, 42)}${sentence.length > 42 ? '…' : ''}` +
        (hits.length ? `   :: ${hits.join(' / ')}` : '')
    );
    if (hard.length) fail++;
    else if (hits.length) pending++;
    else pass++;
  }

  for (const kw of KEYWORDS) {
    const hard = [];
    const soft = [];
    for (const [rel, text] of htmls) {
      if (!text.includes(kw)) continue;
      (rel === SOFT_DIST_PAGE ? soft : hard).push(rel);
    }
    if (hard.length) {
      fail++;
      console.log(`FAIL  dist 特征词「${kw}」还在   :: ${hard.join(' / ')}`);
    } else if (soft.length) {
      pending++;
      console.log(`PENDING  dist 特征词「${kw}」只在画板那页   :: ${soft.join(' / ')}`);
    } else {
      pass++;
    }
  }

  /* 空则不渲染：构建产物里不许出现"空的 copy 元素"（空串必须整块消失，不能留空壳） */
  const emptyAnchors = [];
  for (const [rel, text] of htmls) {
    const re = /data-lt-copy="[^"]*"[^>]*>([\s\S]{0,400}?)</g;
    let m;
    while ((m = re.exec(text))) {
      const inner = m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, '');
      if (!inner) emptyAnchors.push(`${rel}（${m[0].slice(0, 60)}）`);
    }
  }
  check(
    '★★ 构建产物里**没有空的** copy 元素（空串 = 整块不渲染，不留空壳）',
    emptyAnchors.length === 0,
    emptyAnchors.slice(0, 4).join(' | ')
  );

  /* 反过来：源码里的条件渲染不能只是"写着好看"—— 身上带 data-lt-copy 的元素，内容必须非空 */
  const anchors = [...htmls.values()].join(' ').match(/data-lt-copy="[^"]*"/g) ?? [];
  info(`构建产物里的 copy 锚点：${anchors.length} 个（${[...new Set(anchors)].join(' / ') || '一个都没有 = 文案全空'}）`);

  /* `copy._readme` 是给手改 JSON 的人看的说明 —— 它**不该**出现在任何页面上 */
  const readmeLine = String((dataCopy._readme ?? [])[0] ?? '').trim();
  if (!readmeLine) {
    skip('copy._readme 的说明没被渲染到页面上', '数据里没有 copy._readme');
  } else {
    const hits = [...htmls].filter(([, t]) => t.includes(readmeLine.slice(0, 16))).map(([r]) => r);
    check('★★ copy._readme 的说明文字没有出现在任何黎语堂页面上', hits.length === 0, hits.join(' / ') || `找的是「${readmeLine.slice(0, 16)}…」`);
  }
}

/* ================================================================
 * 收摊
 * ================================================================ */
console.log(`\n==== ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}${pending ? `, ${pending} pending（别人的文件）` : ''}${warn ? `, ${warn} warn（闲聊尾巴）` : ''} ====`);
if (pending) {
  console.log(
    '⚠ pending = 豁免名单（SOFT_SOURCE / SOFT_DIST_PAGE）里的文件还留着问题；' +
      '名单现在是空的 —— 真加了谁，记得在报告里写清为什么、什么时候撤。'
  );
}
process.exit(fail ? 1 : 0);
