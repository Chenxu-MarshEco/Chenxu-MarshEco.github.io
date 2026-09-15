#!/usr/bin/env node
/**
 * ============================================================
 *  本地离线可视化内容编辑器 —— 服务端
 * ============================================================
 *
 *  设计目标：
 *    · 零依赖：只用 node:* 内置模块，不需要装任何东西
 *    · 零配置：自己找到项目根目录、内容目录和站点配置
 *    · 只监听 127.0.0.1，绝不对外网暴露
 *
 *  用法：
 *    node tools/editor/server.mjs            # 启动编辑器
 *    node tools/editor/server.mjs --open     # 启动并自动打开浏览器
 *
 *  端口：从 4322 开始，被占用就依次试 4323、4324 …… 最多到 4340。
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

// ---------------------------------------------------------------
// 基本路径与常量
// ---------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** 项目根目录（tools/editor/server.mjs -> 上两级） */
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
/** 前端静态资源目录 */
const UI_DIR = path.join(__dirname, 'ui');
/** 上传图片的落盘目录：public/img/uploads */
const UPLOAD_DIR = path.join(PROJECT_ROOT, 'public', 'img', 'uploads');
/** 首页大板块 / 子版块的封面图目录：public/img/home */
const HOME_IMG_DIR = path.join(PROJECT_ROOT, 'public', 'img', 'home');

/** 请求体上限 12MB */
const MAX_BODY_BYTES = 12 * 1024 * 1024;
/** 单张图片上限 10MB */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const HOST = '127.0.0.1';
const PORT_START = 4322;
const PORT_END = 4340;

/**
 * 内容模型：必须与 src/content.config.ts 里的集合一一对应。
 * 字段顺序也照着 schema 写，生成的 frontmatter 读起来更顺眼。
 */
const TYPES = {
  posts: { id: 'posts', label: '文章', dir: 'src/content/posts' },
  notes: { id: 'notes', label: '手记', dir: 'src/content/notes' },
};
const TYPE_IDS = Object.keys(TYPES);

/** 允许上传的图片类型 */
const UPLOAD_MIME = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/svg+xml', '.svg'],
]);

/** 反过来的查表：扩展名 -> Content-Type，用于把上传的图发回去 */
const EXT_MIME = new Map(
  [...UPLOAD_MIME].map(([mime, ext]) => [ext, mime]).concat([['.jpeg', 'image/jpeg']])
);

/** 静态资源白名单（只暴露这几个文件，不做目录遍历） */
const STATIC_FILES = new Map([
  ['/', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/index.html', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
  ['/style.css', { file: 'style.css', type: 'text/css; charset=utf-8' }],
]);

/** marked 的候选位置，按顺序找第一个存在的；都没有就 404，前端自行降级 */
const MARKED_CANDIDATES = [
  'node_modules/marked/lib/marked.esm.js',
  'node_modules/marked/marked.min.js',
  'node_modules/marked/lib/marked.umd.js',
];

// ---------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------

/** 带 HTTP 状态码的错误，交给统一错误处理 */
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function sendJson(res, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function ok(res, payload = { ok: true }) {
  sendJson(res, 200, payload);
}

/** RFC3339 之类的字符串可能带毫秒；统一 YYYY-MM-DD HH:mm */
function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateParts(d) {
  return {
    date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  };
}

/** 把各种来源的日期值统一成 "YYYY-MM-DD" 或 "YYYY-MM-DD HH:mm" */
function normalizeDateValue(value) {
  if (value === undefined || value === null || value === '') return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const { date, time } = formatDateParts(value);
    return time === '00:00' ? date : `${date} ${time}`;
  }
  const raw = String(value).trim();
  if (raw === '') return '';
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?)?/.exec(raw);
  if (m) {
    const [, y, mo, d, h, mi] = m;
    if (h === undefined) return `${y}-${mo}-${d}`;
    return h === '00' && mi === '00' ? `${y}-${mo}-${d}` : `${y}-${mo}-${d} ${h}:${mi}`;
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return normalizeDateValue(parsed);
  return '';
}

/** 用于排序的时间戳，取不到就给 0（排最后） */
function dateToTime(value) {
  const s = normalizeDateValue(value);
  if (!s) return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(s);
  if (!m) return 0;
  const [, y, mo, d, h = '00', mi = '00'] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), 0, 0).getTime();
}

// ---------------------------------------------------------------
// frontmatter：极简 YAML 读写
// 只需要支持 schema 里那几种标量 + 字符串数组，所以自己写一小份，
// 免得为了跑一个编辑器去装 js-yaml。
// ---------------------------------------------------------------

/** 去掉一层引号并还原转义 */
function unquote(raw) {
  const s = raw.trim();
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return s;
}

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '') return '';
  if (s.startsWith('[')) return parseFlowArray(s);
  if (s.startsWith("'") || s.startsWith('"')) return unquote(s);
  if (s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s === 'true' || s === 'True' || s === 'TRUE') return true;
  if (s === 'false' || s === 'False' || s === 'FALSE') return false;
  if (/^[+-]?\d+$/.test(s)) return Number(s);
  if (/^[+-]?(\d+\.\d*|\.\d+)$/.test(s)) return Number(s);
  return s;
}

/** 解析 [a, b, 'c, d'] 这种流式数组 */
function parseFlowArray(s) {
  const inner = s.replace(/^\[/, '').replace(/\]$/, '');
  const out = [];
  let buf = '';
  let quote = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === ',') {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim() !== '' || out.length) out.push(buf);
  return out.map((item) => parseScalar(item)).filter((v) => v !== '' && v !== null);
}

/**
 * 只解析顶层 key，够用即可（我们的 schema 没有嵌套）。
 */
function parseYamlBlock(lines) {
  const data = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      i++;
      continue;
    }
    const m = /^([A-Za-z_][\w.-]*)[ \t]*:[ \t]*(.*)$/.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    let value = m[2];

    // key: 后面空着，可能是块状数组
    if (value.trim() === '') {
      const items = [];
      let j = i + 1;
      while (j < lines.length && /^[ \t]*-([ \t]+|$)/.test(lines[j])) {
        items.push(unquote(lines[j].replace(/^[ \t]*-[ \t]*/, '').trim()));
        j++;
      }
      if (items.length) {
        data[key] = items;
        i = j;
        continue;
      }
      data[key] = '';
      i++;
      continue;
    }

    value = value.trim();
    // 非引号包裹时，砍掉行尾注释
    if (!value.startsWith("'") && !value.startsWith('"')) {
      const hash = value.search(/[ \t]#/);
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    data[key] = parseScalar(value);
    i++;
  }
  return data;
}

/** 拆出 frontmatter 与正文 */
function parseFrontmatter(raw) {
  const text = String(raw ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
  if (!/^---[ \t]*\n/.test(text)) return { data: {}, body: text.trim() === '' ? '' : cleanBody(text) };

  const lines = text.split('\n');
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^(---|\.\.\.)[ \t]*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (end === -1) return { data: {}, body: cleanBody(text) };

  const data = parseYamlBlock(lines.slice(1, end));
  const body = cleanBody(lines.slice(end + 1).join('\n'));
  return { data, body };
}

/** 正文的规范形式：LF 换行、去掉首尾空行 */
function cleanBody(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/^\n+/, '')
    .replace(/[ \t\n]+$/, '');
}

/** 判断一个字符串写成 YAML 标量时要不要加引号 */
function needsQuote(s) {
  if (s === '') return true;
  if (/^\s|\s$/.test(s)) return true;
  if (/[\n\r\t]/.test(s)) return true;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s)) return true;
  if (/[:#] |:$/.test(s)) return true;
  if (/[,[\]{}]/.test(s)) return true;
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(s)) return true;
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return true;
  return false;
}

function yamlScalar(value) {
  const s = String(value ?? '');
  if (s.includes('\n') || s.includes('\r') || s.includes('\t')) {
    const escaped = s
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `"${escaped}"`;
  }
  if (needsQuote(s)) return `'${s.replace(/'/g, "''")}'`;
  return s;
}

/** 日期写成 2026-09-14 或 2026-09-14 20:30，直接用裸标量 */
function yamlDate(value) {
  const s = normalizeDateValue(value);
  if (!s) return yamlScalar('');
  return s;
}

function yamlArray(list) {
  const items = Array.isArray(list) ? list.map((v) => String(v)).filter((v) => v !== '') : [];
  if (!items.length) return '[]';
  const flow = `[${items.map(yamlScalar).join(', ')}]`;
  if (flow.length <= 88) return flow;
  return `\n${items.map((v) => `  - ${yamlScalar(v)}`).join('\n')}`;
}

// ---------------------------------------------------------------
// 内容目录与文件路径安全
// ---------------------------------------------------------------

function collectionDir(type) {
  return path.resolve(PROJECT_ROOT, TYPES[type].dir);
}

function assertType(type) {
  if (typeof type !== 'string' || !TYPE_IDS.includes(type)) {
    throw httpError(400, `type 只能是 ${TYPE_IDS.join(' 或 ')}`);
  }
  return type;
}

/**
 * 把请求里的 file 变成绝对路径，并做严格的安全校验。
 *
 * 规则：文件名只能是纯文件名（basename），出现 .. / 路径分隔符 / 绝对路径
 * / 盘符 / 空字节，一律 400。最后再用 path.resolve 复核一次，确保结果
 * 真的落在允许的内容目录里。
 */
function resolveContentFile(type, file) {
  assertType(type);
  if (typeof file !== 'string') throw httpError(400, 'file 必须是字符串');
  const raw = file.trim();
  if (raw === '') throw httpError(400, 'file 不能为空');

  if (raw.includes('..')) throw httpError(400, 'file 不允许包含 ..');
  if (raw.includes('/') || raw.includes('\\')) throw httpError(400, 'file 不允许包含路径分隔符');
  if (path.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) throw httpError(400, 'file 不允许是绝对路径');
  if (/[\u0000-\u001f]/.test(raw)) throw httpError(400, 'file 含非法字符');
  if (raw.length > 200) throw httpError(400, 'file 太长');

  const base = path.basename(raw);
  if (base !== raw || base === '' || base === '.' ) throw httpError(400, 'file 不是合法的文件名');
  if (!base.toLowerCase().endsWith('.md')) throw httpError(400, 'file 必须以 .md 结尾');

  const dir = collectionDir(type);
  const abs = path.resolve(dir, base);
  const rel = path.relative(dir, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw httpError(400, 'file 越出了内容目录');
  }
  return { dir, abs, base };
}

// ---------------------------------------------------------------
// 内容读写
// ---------------------------------------------------------------

/** 按 schema 规范化前端传来的 frontmatter */
function normalizeFrontmatter(type, raw) {
  assertType(type);
  const src = raw && typeof raw === 'object' ? raw : {};

  const fm = {
    title: String(src.title ?? '').trim(),
    date: normalizeDateValue(src.date),
  };

  if (type === 'posts') {
    const updated = normalizeDateValue(src.updated);
    if (updated) fm.updated = updated;
    const summary = String(src.summary ?? '').trim();
    if (summary) fm.summary = summary;
    fm.tags = toStringArray(src.tags);
    const cover = String(src.cover ?? '').trim();
    if (cover) fm.cover = cover;
    fm.draft = toBoolean(src.draft);
    fm.pinned = toNumber(src.pinned, 0);
  } else {
    const week = String(src.week ?? '').trim();
    if (week) fm.week = week;
    const mood = String(src.mood ?? '').trim();
    if (mood) fm.mood = mood;
    fm.tags = toStringArray(src.tags);
    fm.draft = toBoolean(src.draft);
  }

  if (!fm.title) throw httpError(400, 'title 不能为空');
  if (!fm.date) throw httpError(400, 'date 不能为空，且要写成 2026-09-14 或 2026-09-14 20:30');

  /*
    所属子版块（文章的归类关系）。
    这是个字段白名单 —— 不在这里显式保留的字段会被整个丢掉。
    早先就漏了这一个，于是编辑器里勾完保存、subs 在写文件时被扔掉，
    重开勾选框全空，网页上对应的位置也永远找不到文章。
    两种栏目都支持，所以放在分支外面。
  */
  fm.subs = toStringArray(src.subs);

  return fm;
}

function toStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter((v) => v !== '');
  }
  if (typeof value === 'string') {
    return value
      .split(/[,，]/)
      .map((v) => v.trim())
      .filter((v) => v !== '');
  }
  return [];
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = String(value ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** 把规范化后的对象写成 frontmatter 文本（不含 --- 分隔行） */
function serializeFrontmatter(type, fm) {
  const lines = [];
  lines.push(`title: ${yamlScalar(fm.title)}`);
  lines.push(`date: ${yamlDate(fm.date)}`);

  if (type === 'posts') {
    if (fm.updated) lines.push(`updated: ${yamlDate(fm.updated)}`);
    if (fm.summary) lines.push(`summary: ${yamlScalar(fm.summary)}`);
    lines.push(`tags: ${yamlArray(fm.tags)}`);
    if (fm.cover) lines.push(`cover: ${yamlScalar(fm.cover)}`);
    lines.push(`draft: ${fm.draft ? 'true' : 'false'}`);
    lines.push(`pinned: ${toNumber(fm.pinned, 0)}`);
  } else {
    if (fm.week) lines.push(`week: ${yamlScalar(fm.week)}`);
    if (fm.mood) lines.push(`mood: ${yamlScalar(fm.mood)}`);
    lines.push(`tags: ${yamlArray(fm.tags)}`);
    lines.push(`draft: ${fm.draft ? 'true' : 'false'}`);
  }

  // 所属子版块：空数组不写，免得每篇都挂一行没用的 subs: []
  if (fm.subs && fm.subs.length) {
    lines.push(`subs: ${yamlArray(fm.subs)}`);
  }

  return lines.join('\n');
}

function buildFileContent(type, frontmatter, body) {
  return `---\n${serializeFrontmatter(type, frontmatter)}\n---\n\n${cleanBody(body)}\n`;
}

/** 从 frontmatter 里推导文件名（新文章用） */
function generateFileName(type, fm) {
  let base = String(fm.title ?? '')
    .toLowerCase()
    .trim()
    .replace(/['"`]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .replace(/^-|-$/g, '');

  if (!base) {
    const t = dateToTime(fm.date) || Date.now();
    const d = new Date(t);
    base = `${type === 'notes' ? 'note' : 'post'}-${formatDateParts(d).date}-${formatDateParts(d).time.replace(':', '')}`;
  }
  return `${base}.md`;
}

/** 名字被占用时换一个，例如 hello-world-2.md */
async function suggestAlternative(dir, base) {
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  for (let i = 2; i < 200; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!(await exists(path.join(dir, candidate)))) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function listItems(type) {
  assertType(type);
  const dir = collectionDir(type);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    // 目录不存在或空目录：返回空数组，不要崩
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return [];
    throw err;
  }

  const items = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.md')) continue;
    const abs = path.join(dir, entry.name);
    try {
      const [raw, stat] = await Promise.all([fs.readFile(abs, 'utf8'), fs.stat(abs)]);
      const { data } = parseFrontmatter(raw);
      items.push({
        file: entry.name,
        slug: entry.name.replace(/\.md$/i, ''),
        title: String(data.title ?? entry.name.replace(/\.md$/i, '')),
        date: normalizeDateValue(data.date),
        tags: toStringArray(data.tags),
        draft: toBoolean(data.draft),
        summary: data.summary === undefined || data.summary === null ? '' : String(data.summary),
        mtime: stat.mtimeMs,
        _sort: dateToTime(data.date) || stat.mtimeMs,
      });
    } catch {
      // 单个文件读不动就跳过，不影响整个列表
      continue;
    }
  }

  items.sort((a, b) => {
    if (b._sort !== a._sort) return b._sort - a._sort;
    if (b.mtime !== a.mtime) return b.mtime - a.mtime;
    return a.file.localeCompare(b.file);
  });

  return items.map(({ _sort, ...rest }) => rest);
}

async function readItem(type, file) {
  const { dir, abs, base } = resolveContentFile(type, file);
  let raw;
  try {
    raw = await fs.readFile(abs, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') throw httpError(404, `找不到文件 ${base}`);
    throw err;
  }
  const { data, body } = parseFrontmatter(raw);
  const frontmatter = normalizeFrontmatterSafe(type, data);
  return { file: base, frontmatter, body, dir };
}

/** 读文件时容错：字段缺失也不报错，交给编辑器补全 */
function normalizeFrontmatterSafe(type, data) {
  const fm = {
    title: String(data.title ?? ''),
    date: normalizeDateValue(data.date),
    tags: toStringArray(data.tags),
    draft: toBoolean(data.draft),
    // 所属子版块。这个白名单和写入路径那份是两处独立的名单，
    // 改一处不够 —— 只加写入那份的话，文件里写了 subs 但读回来没有，
    // 表现就是「保存后再打开，勾选又全没了」。
    subs: toStringArray(data.subs),
  };
  if (type === 'posts') {
    fm.summary = data.summary === undefined || data.summary === null ? '' : String(data.summary);
    fm.cover = data.cover === undefined || data.cover === null ? '' : String(data.cover);
    fm.pinned = toNumber(data.pinned, 0);
    const updated = normalizeDateValue(data.updated);
    fm.updated = updated || '';
  } else {
    fm.week = data.week === undefined || data.week === null ? '' : String(data.week);
    fm.mood = data.mood === undefined || data.mood === null ? '' : String(data.mood);
  }
  return fm;
}

// ---------------------------------------------------------------
// 站点配置：从 src/site.config.ts 里轻量读取三个字段
// ---------------------------------------------------------------

const SITE_FALLBACK = { title: '本地内容编辑器', author: '', tagline: '' };

async function readSiteInfo() {
  try {
    const raw = await fs.readFile(path.join(PROJECT_ROOT, 'src', 'site.config.ts'), 'utf8');
    const pick = (key) => {
      const re = new RegExp(`(?:^|[\\s{,])${key}\\s*:\\s*(['"\`])((?:\\\\.|(?!\\1)[\\s\\S])*?)\\1`);
      const m = re.exec(raw);
      if (!m) return undefined;
      return m[2].replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    };
    return {
      title: pick('title') || SITE_FALLBACK.title,
      author: pick('author') || SITE_FALLBACK.author,
      tagline: pick('tagline') || SITE_FALLBACK.tagline,
    };
  } catch {
    return { ...SITE_FALLBACK };
  }
}

// ---------------------------------------------------------------
// 请求体读取（带 12MB 上限）
// ---------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) {
        // 已经回 413 了，剩下的继续读掉再丢，
        // 免得客户端拿到 ECONNRESET 而不是那个 413 响应
        return;
      }
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done = true;
        chunks.length = 0;
        reject(httpError(413, '请求体超过 12MB 上限'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(httpError(400, '请求体不是合法的 JSON'));
      }
    });
    req.on('error', (err) => {
      if (done) return;
      done = true;
      reject(err);
    });
  });
}

// ---------------------------------------------------------------
// 上传
// ---------------------------------------------------------------

function sanitizeUploadName(name, ext) {
  let stem = path.basename(String(name ?? 'image'));
  stem = stem.replace(/\.[^.]*$/, '');
  stem = stem
    .replace(/[^\w\u4e00-\u9fff.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 48);
  if (!stem) stem = 'image';
  const d = new Date();
  const { date, time } = formatDateParts(d);
  const stamp = `${date.replace(/-/g, '')}-${time.replace(':', '')}`;
  const rand = randomBytes(2).toString('hex');
  return `${stamp}-${rand}-${stem}${ext}`;
}

async function handleUpload(payload) {
  const name = payload?.name;
  const dataUrl = payload?.dataUrl;
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw httpError(400, 'dataUrl 必须是 base64 格式的 data URL');
  }
  const m = /^data:([a-zA-Z0-9.+/-]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!m) throw httpError(400, '只支持 base64 编码的 data URL');

  const mime = m[1].toLowerCase();
  if (!UPLOAD_MIME.has(mime)) {
    throw httpError(415, `不支持的图片类型 ${mime}，只允许 png / jpeg / gif / webp / svg`);
  }

  const buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (!buf.length) throw httpError(400, '图片内容是空的');
  if (buf.length > MAX_UPLOAD_BYTES) throw httpError(413, '单张图片不能超过 10MB');

  const filename = sanitizeUploadName(name, UPLOAD_MIME.get(mime));
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, filename), buf);

  return { ok: true, path: `/img/uploads/${filename}`, size: buf.length };
}

// ---------------------------------------------------------------
// 路由
// ---------------------------------------------------------------

async function handleApi(req, res, url) {
  const route = url.pathname;

  if (route === '/api/bootstrap' && req.method === 'GET') {
    const site = await readSiteInfo();
    return ok(res, {
      site: { title: site.title, author: site.author, tagline: site.tagline },
      types: TYPE_IDS.map((id) => ({ id, label: TYPES[id].label, dir: TYPES[id].dir })),
    });
  }

  if (route === '/api/list' && req.method === 'GET') {
    const type = assertType(url.searchParams.get('type') || 'posts');
    const items = await listItems(type);
    return sendJson(res, 200, items);
  }

  if (route === '/api/item' && req.method === 'GET') {
    const type = assertType(url.searchParams.get('type') || 'posts');
    const file = url.searchParams.get('file') || '';
    const { frontmatter, body } = await readItem(type, file);
    return ok(res, { file: path.basename(file), frontmatter, body });
  }

  if (route === '/api/save' && req.method === 'POST') {
    const payload = await readBody(req);
    const type = assertType(payload.type);
    const rawFile = typeof payload.file === 'string' ? payload.file.trim() : '';
    const frontmatter = normalizeFrontmatter(type, payload.frontmatter);
    const content = buildFileContent(type, frontmatter, payload.body);
    const dir = collectionDir(type);

    let targetBase;
    if (rawFile === '') {
      // 新文件：按 frontmatter 生成文件名
      const generated = generateFileName(type, frontmatter);
      const generatedAbs = path.resolve(dir, generated);
      if (await exists(generatedAbs)) {
        // 目标已存在，且请求里的 file（空）与生成的名字不同 —— 拒绝覆盖别人的文章
        const suggested = await suggestAlternative(dir, generated);
        return sendJson(res, 409, {
          ok: false,
          error: `已存在同名文件 ${generated}，为避免覆盖已有内容已拒绝保存`,
          conflict: generated,
          suggested,
        });
      }
      targetBase = generated;
    } else {
      targetBase = resolveContentFile(type, rawFile).base;
    }

    const { abs } = resolveContentFile(type, targetBase);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
    return ok(res, { ok: true, file: targetBase });
  }

  if (route === '/api/delete' && req.method === 'POST') {
    const payload = await readBody(req);
    const type = assertType(payload.type);
    const { abs, base } = resolveContentFile(type, payload.file ?? '');
    if (!(await exists(abs))) throw httpError(404, `找不到文件 ${base}`);
    await fs.unlink(abs);
    return ok(res, { ok: true });
  }

  if (route === '/api/upload' && req.method === 'POST') {
    const payload = await readBody(req);
    const result = await handleUpload(payload);
    return sendJson(res, 200, result);
  }

  // ---- 首页大板块的子版块 ----
  // 数据放在 src/data/home-boards.json，site.config.ts 直接 import 它。
  // 之所以不让编辑器去改 site.config.ts：那是 TypeScript 源码，
  // 用字符串替换很容易把文件弄坏，改 JSON 则安全得多。
  if (route === '/api/boards' && req.method === 'GET') {
    return sendJson(res, 200, await readBoards());
  }
  if (route === '/api/boards' && req.method === 'POST') {
    const payload = await readBody(req);
    return sendJson(res, 200, await writeBoards(payload));
  }

  // ---- 排版微调（首页元素的相对偏移与缩放）----
  if (route === '/api/layout' && req.method === 'GET') {
    return sendJson(res, 200, await readLayout());
  }
  if (route === '/api/layout' && req.method === 'POST') {
    const payload = await readBody(req);
    return sendJson(res, 200, await writeLayout(payload));
  }

  // ---- 代理预览站点 ----
  // 编辑器在 4322、站点预览在 4321，端口不同就是跨源。浏览器里
  // 直接 fetch 会被 CORS 挡掉（报错只有一句 "Failed to fetch"，
  // 很难查）。让服务端去取再原样吐回来，同源就没这个问题。
  if (route === '/api/preview' && req.method === 'GET') {
    const targetPath = url.searchParams.get('path') || '/';
    if (!targetPath.startsWith('/') || targetPath.includes('..')) {
      throw httpError(400, 'path 必须是不含 .. 的站内路径');
    }
    return sendPreview(res, targetPath);
  }

  throw httpError(404, `未知接口 ${route}`);
}

/**
 * 本地站点预览服务的候选地址。
 *
 * 必须给两个：`astro dev` 默认只绑 localhost，在 Windows 上优先解析成
 * IPv6 的 ::1，127.0.0.1 是连不上的；而 `astro preview --host 127.0.0.1`
 * 又只绑 IPv4。只写一个的话，总有一种启动方式会连不上，
 * 表现就是编辑器里「排版」报「先打开看效果」—— 明明预览是开着的。
 */
const PREVIEW_ORIGINS = ['http://127.0.0.1:4321', 'http://localhost:4321'];

async function sendPreview(res, targetPath) {
  let lastErr = null;
  for (const origin of PREVIEW_ORIGINS) {
    try {
      const r = await fetch(origin + targetPath, { redirect: 'follow' });
      const text = await r.text();
      res.writeHead(r.status, {
        'Content-Type': r.headers.get('content-type') || 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(text);
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw httpError(
    502,
    '连不上本地预览服务（4321）。先在启动器里点「看效果」把它起起来。'
  );
}

/** 排版微调数据文件 */
const LAYOUT_FILE = path.join(PROJECT_ROOT, 'src', 'data', 'layout.json');

const LAYOUT_README =
  '编辑器「排版」模式存下来的微调值，按页面类型分组。dx/dy 是相对自身尺寸的百分比，' +
  's 是缩放倍数。全部为 0/1 时等于原始版式。可以手改，也可以让编辑器改。';

const PAGE_KEYS = ['home', 'board', 'post', 'list'];

async function readLayout() {
  return JSON.parse(await fs.readFile(LAYOUT_FILE, 'utf8'));
}

/**
 * 写回排版微调。
 *
 * 按页面类型分组（home / board / post / list），每组的键是元素锚点名。
 * 夹一下取值范围：偏移限制在 ±200%，缩放限制在 0.2~5 倍 ——
 * 没有这道闸，一次误拖就能把元素甩到屏幕外，而且很难找回来。
 */
async function writeLayout(payload) {
  if (!payload || typeof payload !== 'object' || !payload.pages) {
    throw httpError(400, '数据格式不对，需要 { pages: { home: {...}, ... } }');
  }

  const clamp = (v, lo, hi, dflt) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(hi, Math.max(lo, n));
  };

  // 先读现有的，再合并。不能直接替换 —— 一次只提交一个页面时，
  // 其他页面的微调会被整个抹掉（早先就踩过这个坑）。
  let prev = {};
  try {
    prev = (await readLayout()).pages || {};
  } catch {
    prev = {};
  }

  const pages = { ...prev };
  for (const [page, group] of Object.entries(payload.pages)) {
    if (!PAGE_KEYS.includes(page)) continue;
    if (!group || typeof group !== 'object') continue;

    const merged = { ...(pages[page] || {}) };
    for (const [key, v] of Object.entries(group)) {
      const o = v && typeof v === 'object' ? v : {};
      merged[key] = {
        dx: Math.round(clamp(o.dx, -200, 200, 0) * 10) / 10,
        dy: Math.round(clamp(o.dy, -200, 200, 0) * 10) / 10,
        s: Math.round(clamp(o.s, 0.2, 5, 1) * 100) / 100,
      };
    }
    pages[page] = merged;
  }

  try {
    await fs.copyFile(LAYOUT_FILE, `${LAYOUT_FILE}.bak`);
  } catch {
    /* 第一次写还没有原文件 */
  }

  const out = { _readme: LAYOUT_README, pages };
  await fs.writeFile(LAYOUT_FILE, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  return { ok: true, ...out };
}

/** 首页大板块数据文件 */
const BOARDS_FILE = path.join(PROJECT_ROOT, 'src', 'data', 'home-boards.json');

async function readBoards() {
  const text = await fs.readFile(BOARDS_FILE, 'utf8');
  return JSON.parse(text);
}

/**
 * 递归清理一个节点。
 *
 * 关键：必须保住 id。id 是「文章归类到节点」的唯一依据
 * （文章 frontmatter 里存 subs: [id]），丢了就等于把归类关系全切断。
 * 早先重建对象时只写了 label 和 href，用户每次动一下子版块 id 就被抹掉 ——
 * 归类勾选框变空就是这么来的。
 *
 * 新增节点没有 id 就补一个。不用标题当 id：名字一改归类关系就断。
 */
/**
 * 页面内容块的清洗。
 *
 * 只认这四种块，每种按字段白名单收 —— 编辑器传上来的东西不一定干净，
 * 而这个数组会被渲染到页面上（文字还会走 Markdown 渲染），
 * 与其相信前端，不如在这里收一遍。
 *
 * 块 id 必须留着：排版模式的锚点是 pg-<id>，id 一变，之前调好的位置就丢了。
 * 缺 id 或者撞了才补一个。
 */
const BLOCK_WIDTHS = new Set(['full', 'wide', 'half', 'third']);
const CARD_SHAPES = new Set(['wide', 'square', 'tall']);
const CARD_SIZES = new Set(['l', 'm', 's']);

function cleanBlocks(raw, ownerId) {
  if (!Array.isArray(raw)) return [];

  const used = new Set();
  const out = [];

  raw.forEach((b, i) => {
    if (!b || typeof b !== 'object') return;
    const type = String(b.type || '');

    let id = String(b.id || '').trim();
    if (!id || used.has(id)) {
      id = `${ownerId}-p${i + 1}`;
      let n = 1;
      while (used.has(id)) id = `${ownerId}-p${i + 1}-${n++}`;
    }
    used.add(id);

    if (type === 'text') {
      const text = String(b.text ?? '');
      if (text.trim()) out.push({ id, type, text });
      return;
    }

    if (type === 'image') {
      const src = String(b.src || '').trim();
      if (!src) return;
      const block = { id, type, src };
      const alt = String(b.alt || '').trim();
      if (alt) block.alt = alt;
      block.width = BLOCK_WIDTHS.has(b.width) ? b.width : 'wide';
      out.push(block);
      return;
    }

    if (type === 'link') {
      const text = String(b.text || '').trim();
      const href = String(b.href || '').trim();
      if (!text || !href) return;
      out.push({ id, type, text, href });
      return;
    }

    if (type === 'children') {
      out.push({
        id,
        type,
        shape: CARD_SHAPES.has(b.shape) ? b.shape : 'wide',
        size: CARD_SIZES.has(b.size) ? b.size : 'l',
      });
    }
  });

  return out;
}

function cleanNode(raw, parentId, used) {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title || raw.label || '').trim();
  if (!title) return null;

  let id = String(raw.id || '').trim();
  if (!id || used.has(id)) {
    let n = 1;
    while (used.has(`${parentId}-${n}`)) n += 1;
    id = `${parentId}-${n}`;
  }
  used.add(id);

  const out = { id, title };
  const href = String(raw.href || '').trim();
  if (href) out.href = href;
  const image = String(raw.image || '').trim();
  if (image) out.image = image;
  // 版式字段：目前只有 'region'（三列分区）。编辑器界面上没有开关，
  // 但必须原样带过去 —— 不认识的字段会被这里丢掉，用户一保存版式就没了。
  const layout = String(raw.layout || '').trim();
  if (layout) out.layout = layout;
  // 页面内容（介绍文字 / 图片 / 链接 / 子页面块）
  const page = cleanBlocks(raw.page, id);
  if (page.length) out.page = page;

  const kids = Array.isArray(raw.children) ? raw.children : [];
  const children = kids.map((k) => cleanNode(k, id, used)).filter(Boolean);
  if (children.length) out.children = children;

  return out;
}

async function writeBoards(payload) {
  if (!payload || !Array.isArray(payload.boards)) {
    throw httpError(400, '数据格式不对，需要 { boards: [...] }');
  }

  const boards = payload.boards.map((b) => {
    const boardId = String(b.id || '').trim();
    const used = new Set();
    const kids = Array.isArray(b.children) ? b.children : [];
    const children = kids.map((k) => cleanNode(k, boardId, used)).filter(Boolean);

    const out = {
      id: boardId,
      title: String(b.title || '').trim(),
      subtitle: String(b.subtitle || '').trim(),
      image: String(b.image || '').trim(),
    };
    // 顶层大板块也可以手写地址（甬城晴雨就是 /yongshen 而不是按 id 推的 /yongcheng）
    const href = String(b.href || '').trim();
    if (href) out.href = href;
    // 版式字段同理：'region' = 三列分区（花娅陌域在用），编辑器不显示但要原样保留
    const layout = String(b.layout || '').trim();
    if (layout) out.layout = layout;
    // 顶层大板块也能自己写页面内容
    const page = cleanBlocks(b.page, boardId);
    if (page.length) out.page = page;
    if (children.length) out.children = children;
    return out;
  });

  if (boards.some((b) => !b.id || !b.title)) {
    throw httpError(400, '每个大板块都必须有 id 和 title');
  }

  // 先留一份备份，万一写坏了还能捞回来
  try {
    await fs.copyFile(BOARDS_FILE, `${BOARDS_FILE}.bak`);
  } catch {
    /* 第一次写还没有原文件，忽略 */
  }

  await fs.writeFile(BOARDS_FILE, `${JSON.stringify({ boards }, null, 2)}\n`, 'utf8');
  return { ok: true, boards };
}

/**
 * public/img 下这几个子目录对编辑器可见。
 * uploads 是上传落盘的地方；home 是首页大板块/子版块的封面图，
 * 编辑器里的封面缩略图要用到，不暴露的话缩略图全是 404。
 */
const IMG_DIRS = new Map([
  ['uploads', UPLOAD_DIR],
  ['home', HOME_IMG_DIR],
]);

/**
 * 把 public/img/<子目录> 下的图片发给浏览器。
 * 只接受「白名单子目录 + 纯文件名」：挡掉 ../ 和更深的路径，
 * 避免路径穿越读到仓库里别的东西。
 */
async function serveImage(res, pathname) {
  const rest = pathname.slice('/img/'.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return false;

  const dir = IMG_DIRS.get(rest.slice(0, slash));
  const name = rest.slice(slash + 1);
  if (!dir || !name || name.includes('/') || name.includes('\\') || name.includes('..')) {
    return false;
  }
  const type = EXT_MIME.get(path.extname(name).toLowerCase());
  if (!type) return false;

  try {
    const buf = await fs.readFile(path.join(dir, name));
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': buf.length,
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  } catch {
    return false; // 文件不存在就落到后面的 404
  }
  return true;
}

async function serveStatic(res, pathname) {
  const entry = STATIC_FILES.get(pathname);
  if (!entry) return false;
  const abs = path.join(UI_DIR, entry.file);
  try {
    const buf = await fs.readFile(abs);
    res.writeHead(200, {
      'Content-Type': entry.type,
      'Content-Length': buf.length,
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  } catch {
    sendText(res, 500, '找不到前端资源，请确认 tools/editor/ui 目录完整');
  }
  return true;
}

async function serveMarked(res) {
  for (const rel of MARKED_CANDIDATES) {
    const abs = path.join(PROJECT_ROOT, rel);
    try {
      const buf = await fs.readFile(abs);
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Content-Length': buf.length,
        'Cache-Control': 'no-store',
      });
      res.end(buf);
      return;
    } catch {
      continue;
    }
  }
  sendJson(res, 404, {
    ok: false,
    error: '未找到 node_modules/marked，Markdown 预览不可用（编辑器其他功能正常）',
  });
}

async function handle(req, res) {
  const url = new URL(req.url || '/', `http://${HOST}`);
  const pathname = decodeURIComponent(url.pathname);

  /*
    把上传目录里的图片发回给浏览器。
    之前只服务了前端那几个固定文件，上传目录压根没暴露，
    于是封面和正文里引用的图在编辑器里全是 404 ——
    文件明明在磁盘上，预览却显示不出来。
  */
  if (pathname.startsWith('/img/')) {
    if (await serveImage(res, pathname)) return;
  }

  if (pathname.startsWith('/api/')) {
    await handleApi(req, res, url);
    return;
  }

  if (pathname === '/vendor/marked.js') {
    await serveMarked(res);
    return;
  }

  if (pathname === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (await serveStatic(res, pathname)) return;
  }

  sendText(res, 404, '未找到该地址');
}

// ---------------------------------------------------------------
// 启动
// ---------------------------------------------------------------

function listenOnce(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      // 通过 cmd 的 start 打开默认浏览器；第一个 "" 是窗口标题占位
      const child = spawn('cmd', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
        windowsVerbatimArguments: false,
      });
      child.unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
    return true;
  } catch {
    return false;
  }
}

function banner(url, extraQuery) {
  const lines = [
    '',
    '  ┌──────────────────────────────────────────────────────────┐',
    '  │  本地内容编辑器  ·  Content Editor                       │',
    '  └──────────────────────────────────────────────────────────┘',
    '',
    `   ▶ 编辑器地址： ${url}${extraQuery}`,
    '',
    '   文章目录： src/content/posts',
    '   手记目录： src/content/notes',
    '   图片目录： public/img/uploads',
    '',
    '   保存快捷键： Ctrl+S / Cmd+S      停止服务： Ctrl+C',
    '',
  ];
  return lines.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const openArg = argv.find((a) => a === '--open' || a.startsWith('--open='));
  const wantOpen = Boolean(openArg);
  const openMode = openArg && openArg.includes('=') ? openArg.split('=')[1] : '';

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      const status = Number.isInteger(err?.status) ? err.status : 500;
      const message = err?.message || '服务器内部错误';
      if (res.headersSent) {
        try {
          res.end();
        } catch {
          /* 忽略 */
        }
        return;
      }
      if (status >= 500) console.error('  [错误]', err);
      sendJson(res, status, { ok: false, error: message });
    });
  });

  server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  let lastError = null;
  for (let port = PORT_START; port <= PORT_END; port++) {
    try {
      await listenOnce(server, port);
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      if (err && err.code === 'EADDRINUSE') {
        console.log(`  端口 ${port} 已被占用，换下一个……`);
        continue;
      }
      throw err;
    }
  }

  if (lastError) {
    console.error(`\n  启动失败：${PORT_START}-${PORT_END} 之间的端口都被占用了。`);
    console.error('  请关掉占用端口的程序后重试。\n');
    process.exit(1);
  }

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : PORT_START;
  const url = `http://${HOST}:${port}/`;

  let query = '';
  if (openMode === 'new-post' || openMode === 'new') query = '?new=posts';
  else if (openMode === 'new-note') query = '?new=notes';

  console.log(banner(url, query));

  if (!(await exists(UI_DIR))) {
    console.warn('  [警告] 找不到 tools/editor/ui 目录，页面可能无法打开。\n');
  }

  if (wantOpen) {
    const done = openBrowser(url + query);
    console.log(done ? '   已尝试打开系统默认浏览器。\n' : '   [警告] 自动打开浏览器失败，请手动访问上面的地址。\n');
  }

  const shutdown = () => {
    console.log('\n  正在关闭编辑器服务……');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('\n  启动失败：', err?.message || err, '\n');
  process.exit(1);
});
