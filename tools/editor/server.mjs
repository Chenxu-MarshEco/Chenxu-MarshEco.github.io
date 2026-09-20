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
import { createWriteStream } from 'node:fs';
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
/** 上传音频的落盘目录：public/audio/uploads（按需创建） */
const AUDIO_DIR = path.join(PROJECT_ROOT, 'public', 'audio', 'uploads');

/** 请求体上限 12MB（只针对 JSON；音频走独立的流式分支，不受它管） */
const MAX_BODY_BYTES = 12 * 1024 * 1024;
/** 单张图片上限 10MB */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** 单首音频上限 40MB */
const MAX_AUDIO_BYTES = 40 * 1024 * 1024;

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

/**
 * 允许上传 / 试听的音频类型（扩展名 -> Content-Type）。
 *
 * 只认这几种：歌单是直接塞进 <audio src> 的，浏览器认不出来的格式
 * 传上去也放不出声，不如在门口就挡掉。
 */
const AUDIO_MIME = new Map([
  ['.mp3', 'audio/mpeg'],
  ['.m4a', 'audio/mp4'],
  ['.aac', 'audio/aac'],
  ['.ogg', 'audio/ogg'],
  ['.oga', 'audio/ogg'],
  ['.opus', 'audio/opus'],
  ['.wav', 'audio/wav'],
  ['.flac', 'audio/flac'],
]);

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

  // 封面图：文章和手记都支持（content.config.ts 里两边都有 cover），
  // 所以放在分支外面 —— 忘了放就是「编辑器里传了图、保存后没了」。
  const cover = String(src.cover ?? '').trim();
  if (cover) fm.cover = cover;

  if (type === 'posts') {
    const updated = normalizeDateValue(src.updated);
    if (updated) fm.updated = updated;
    const summary = String(src.summary ?? '').trim();
    if (summary) fm.summary = summary;
    fm.tags = toStringArray(src.tags);
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
    // 手记也能有封面（content.config.ts 里加了 cover）
    if (fm.cover) lines.push(`cover: ${yamlScalar(fm.cover)}`);
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

  const raw = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (!raw.length) throw httpError(400, '图片内容是空的');
  if (raw.length > MAX_UPLOAD_BYTES) throw httpError(413, '单张图片不能超过 10MB');

  const ext = UPLOAD_MIME.get(mime);

  /*
   * 落盘之前先压一遍（tools/images/optimize.mjs 里的 compressUpload）。
   * 以前这里是把上传的字节原样写进去的 —— 手机拍的 4MB 照片进了仓库就是 4MB，
   * 页面也就真的去下 4MB。现在：JPEG 走 mozjpeg q82、限宽 1920、按 EXIF 摆正、
   * 去掉元数据；PNG 走最高压缩级别；GIF/SVG 原样不碰（动图和矢量图不该重编码）。
   *
   * 压完顺手跑一次图片管线，这张新图立刻就有 WebP/AVIF 多尺寸和模糊占位，
   * 编辑器里马上插入引用也不会漏掉优化。压缩失败绝不让上传失败：退回原图。
   */
  let out = { buf: raw, ext, before: raw.length, after: raw.length, note: '未压缩' };
  try {
    const mod = await import('../../tools/images/optimize.mjs');
    out = await mod.compressUpload(raw, ext, mime);
  } catch (err) {
    out = { buf: raw, ext, before: raw.length, after: raw.length, note: `压缩模块没起来（${err.message}）` };
  }

  const filename = sanitizeUploadName(name, out.ext);
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, filename), out.buf);

  // 让这张新图立刻进清单（管线是增量的，只会编这一张）
  try {
    const mod = await import('../../tools/images/optimize.mjs');
    await mod.optimizeOne(`/img/uploads/${filename}`);
  } catch {
    /* 清单没更新也只是这一张暂时按原图发，不影响上传成功 */
  }

  return {
    ok: true,
    path: `/img/uploads/${filename}`,
    size: out.buf.length,
    before: out.before,
    after: out.after,
    note: out.note,
  };
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

  // ---- 音乐 / 歌单（src/data/music.json）----
  // 「音乐」面板打开时先拉这一份：曲库 + 各页歌单 + 全站可挂歌单的页面清单。
  if (route === '/api/music' && req.method === 'GET') {
    const music = await readMusic();
    return sendJson(res, 200, {
      ok: true,
      music: { tracks: music.tracks, pages: music.pages },
      pages: await musicPages(),
      limits: { maxBytes: MAX_AUDIO_BYTES },
    });
  }
  // 整份写回 + 重新构建（要出现在网站上必须走这一步）
  if (route === '/api/music' && req.method === 'POST') {
    const payload = await readBody(req);
    if (!payload?.music || typeof payload.music !== 'object') {
      throw httpError(400, '数据格式不对，需要 { music: { tracks: [...], pages: {...} } }');
    }
    const current = await readMusic();
    const validKeys = new Set((await musicPages()).map((p) => p.key));
    const clean = cleanMusic(payload.music, validKeys);
    await writeMusicFile(current.readme, clean.tracks, clean.pages);
    const built = await runBuild();
    return sendJson(res, 200, {
      ok: true,
      ms: built.ms,
      output: built.output,
      dropped: clean.dropped,
    });
  }
  /*
    上传音频：请求体是**原始二进制**（前端直接 fetch(url, {body: file})），
    所以这里绝对不能走 readBody —— 那个 12MB 上限是给 JSON 的，
    而且会把整首歌读进内存。handleAudioUpload 里是边收边写盘。
  */
  if (route === '/api/music/upload' && req.method === 'POST') {
    return await handleAudioUpload(req, res, url);
  }
  // 从曲库删一首（顺手清掉各页歌单里的引用、删文件），不重新构建
  if (route === '/api/music/remove' && req.method === 'POST') {
    const payload = await readBody(req);
    return await handleMusicRemove(res, payload);
  }

  // ---- 时间轴（独立的一份数据，见上面 TIMELINES_FILE 那段的说明）----
  if (route === '/api/timelines' && req.method === 'GET') {
    return sendJson(res, 200, await readTimelines());
  }
  if (route === '/api/timelines' && req.method === 'POST') {
    const payload = await readBody(req);
    const data = cleanTimelines(payload);
    // 先留一份备份再写，写坏了还能捞回来（和 boards 一个规矩）
    try {
      await fs.copyFile(TIMELINES_FILE, `${TIMELINES_FILE}.bak`);
    } catch {
      /* 第一次还没有这个文件，正常 */
    }
    await fs.writeFile(TIMELINES_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return sendJson(res, 200, { ok: true, timelines: data.timelines.length, dropped: data.dropped });
  }

  // ---- 排版微调（首页元素的相对偏移与缩放）----
  if (route === '/api/layout' && req.method === 'GET') {
    return sendJson(res, 200, await readLayout());
  }
  if (route === '/api/layout' && req.method === 'POST') {
    const payload = await readBody(req);
    return sendJson(res, 200, await writeLayout(payload));
  }

  // ---- 重新构建站点 ----
  // 「页面」工作台保存之后要立刻看到效果，而预览服务（4321）发的是 dist，
  // 所以得先把站点重新构建一遍。构建在本地只要一两秒，属于可以随手点的操作。
  if (route === '/api/build' && req.method === 'POST') {
    return sendJson(res, 200, await runBuild());
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

/**
 * 跑一次站点构建（astro build）。
 *
 * 为什么直接 node 那个入口，而不走 `pnpm build`：
 * pnpm 在 Windows 上是个 .cmd，要从编辑器里把它拉起来得经过 shell，
 * 参数一多就容易出转义问题；而 node_modules/astro/bin/astro.mjs 是
 * package.json 里 `build` 脚本真正执行的东西，效果完全一样，还少一层壳。
 *
 * 同时只允许一次构建：用户连点两下不该起两个进程抢 dist。
 * 后来的请求等同一个 promise，拿到同一份结果。
 */
let buildInFlight = null;

function runBuild() {
  if (buildInFlight) return buildInFlight;

  const run = (async () => {
    const entry = path.join(PROJECT_ROOT, 'node_modules', 'astro', 'bin', 'astro.mjs');
    try {
      await fs.access(entry);
    } catch {
      throw httpError(500, '找不到 astro（node_modules/astro/bin/astro.mjs），先在启动器里做一次「首次设置」');
    }

    const started = Date.now();

    /*
     * 先跑图片管线再构建 —— package.json 里的 `build` 脚本也是这个顺序。
     * 编辑器这里不能改走 `pnpm build`（Windows 上 pnpm 是个 .cmd，起它要过 shell），
     * 所以直接 import 那个模块来跑。
     * 管线是增量的：没换过的图直接跳过，通常几十毫秒；只有第一次（或换了配置）
     * 才需要几十秒重编，所以它**不算进下面 astro 的超时**。
     * 它失败也不拦构建：站点照常出，只是图片退回原图。
     */
    let imageNote = '';
    try {
      const mod = await import('../../tools/images/optimize.mjs');
      const { stats } = await mod.optimizeAll({ quiet: true });
      imageNote = `图片管线：复用 ${stats.reused} / 新编 ${stats.encoded} / 小图跳过 ${stats.skipped}`;
    } catch (err) {
      imageNote = `图片管线没跑起来（${err.message}），这次按原图发`;
    }

    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [entry, 'build'], {
        cwd: PROJECT_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let out = imageNote ? `${imageNote}\n` : '';
      const keep = (buf) => {
        out += buf.toString('utf8');
        // 只留尾巴：够看报错就行，别把整个构建日志塞进浏览器
        if (out.length > 8000) out = out.slice(-8000);
      };
      child.stdout.on('data', keep);
      child.stderr.on('data', keep);

      const timer = setTimeout(() => {
        child.kill();
        reject(httpError(500, '构建超时（180 秒），看看终端里是不是卡住了'));
      }, 180000);

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(httpError(500, `构建起不来：${err.message}`));
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve({ ok: true, ms: Date.now() - started, output: tailOf(out) });
        } else {
          reject(httpError(500, `构建失败（退出码 ${code}）：\n${tailOf(out)}`));
        }
      });
    });
  })();

  // 结束后放锁（成功失败都要放，否则一次失败就把后面的构建全堵死）。
  // 这里把 finally 之后的 promise 交给调用方，调用方 await 到的就是同一次构建的结果。
  buildInFlight = run.finally(() => {
    buildInFlight = null;
  });

  return buildInFlight;
}

/** 构建日志的尾巴，去掉空行 */
function tailOf(text) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim());
  return lines.slice(-12).join('\n');
}


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
 * w / h 是明确的像素宽高，20~3000 之内才收（0 表示「跟着版式自动」）。
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
      const entry = {
        dx: Math.round(clamp(o.dx, -200, 200, 0) * 10) / 10,
        dy: Math.round(clamp(o.dy, -200, 200, 0) * 10) / 10,
        s: Math.round(clamp(o.s, 0.2, 5, 1) * 100) / 100,
      };
      // 像素宽高：不填（0）就不写这一项，等于「跟着版式自动」
      const w = Number(o.w);
      if (Number.isFinite(w) && w >= 20) entry.w = Math.round(clamp(w, 20, 3000, 0));
      const h = Number(o.h);
      if (Number.isFinite(h) && h >= 16) entry.h = Math.round(clamp(h, 16, 3000, 0));
      merged[key] = entry;
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

/* ------------------------------------------------------------------
   时间轴（独立于页面的一份数据）

   特意不塞进 home-boards.json：一条时间轴要好几个页面共用，
   混在版块树里就得靠 id 到处引用，树一改容易断。
   ------------------------------------------------------------------ */
const TIMELINES_FILE = path.join(PROJECT_ROOT, 'src', 'data', 'timelines.json');

async function readTimelines() {
  const text = await fs.readFile(TIMELINES_FILE, 'utf8');
  return JSON.parse(text);
}

/** 日期只收 yyyy-mm-dd，别的一律当没填 */
/**
 * 时间点的日期。
 *
 * 除了 `yyyy-mm-dd`，还认一个特殊值 **`today`** —— 那是「实时更新」的时间点：
 * 页面上永远显示今天，每天跟着变（构建时按构建那天算，打开页面时由脚本按
 * 访问者当天的日期重排整条轴）。所以它不算非法，得原样存下来。
 */
function cleanDate(v) {
  const s = String(v || '').trim();
  if (s === 'today') return s;
  return /^\d{4}-\d{1,2}-\d{1,2}$/.test(s) ? s : '';
}

/**
 * 「难以考据」那个时间点的位置（`at`）。
 *
 * 0 = 最早、1 = 最晚，是这条轴上的比例，最多留 4 位小数。
 * 数字一律夹进 0~1；**不是数字**（`'abc'`、空串、没填）给 0.5 ——
 * 位置写坏了也只是站错地方，不该把这个点整个丢掉。
 *
 * 只有 `kind: 'fuzzy'` 的点才有这一项，别的点写上来也会被丢掉
 * （它们的位置由 `date` 决定，多一个 at 只会让数据有两套真相）。
 */
function cleanAt(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 0.5;
  return Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000;
}

/**
 * 这条时间轴的**默认比例尺**：一刻度代表多少天（`tickDays`）。
 *
 * 页面上那根滑块的量程就是 1 天/格 ~ 365 天/格，所以这里只收 1~365 的
 * 有限数字，存之前收到两位小数。
 *
 * **非法值一律丢掉**（`'abc'` / `0` / `-3` / `999` / `null`），
 * 而不是夹到端点 —— 夹端点会让人以为「填错了也还能用」，
 * 实际上他填的那个值根本不是他要的。丢掉就等于没填，回到默认比例尺。
 * 返回 `null` 表示「这一项不该写进数据」。
 */
function cleanTickDays(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 1 || n > 365) return null;
  return Math.round(n * 100) / 100;
}

/**
 * 时间轴清洗。
 *
 * 时间点和时间段都得活着才有意义：
 *   · 时间点：名字必须有；日期**除了难以考据那种**也必须有
 *     （没日期排不进轴 —— 但 `kind: 'fuzzy'` 的点本来就没有日期，
 *     位置由编辑器拖出来的 `at` 定，这种点必须留下）
 *   · 时间段：两端必须都指向**存在的时间点**，否则整段丢掉
 *     （指向一个已经被删掉的点，那段时间就是悬空的）。
 *     难考据的点也算「存在的时间点」，可以当端点
 */
function cleanTimelines(payload) {
  if (!payload || !Array.isArray(payload.timelines)) {
    throw httpError(400, '数据格式不对，需要 { timelines: [...] }');
  }

  const usedTl = new Set();
  const timelines = [];
  /*
    被丢掉的东西要记账。
    丢本身是设计好的（没日期的点排不进轴、端点没了的段是悬空的），
    但**不能悄悄丢** —— 编辑器那边会把这个数字报给用户，
    免得出现「点一下保存它就没了」这种对着空列表发愣的情况。
  */
  const dropped = { timelines: 0, points: 0, spans: 0 };

  payload.timelines.forEach((raw, ti) => {
    if (!raw || typeof raw !== 'object') {
      dropped.timelines++;
      return;
    }
    const title = String(raw.title || '').trim();
    if (!title) {
      dropped.timelines++;
      return;
    }

    let id = String(raw.id || '').trim();
    if (!id || usedTl.has(id)) id = `tl-${Date.now().toString(36)}-${ti + 1}`;
    usedTl.add(id);

    /*
      默认比例尺（一刻度多少天）。**合法才写** —— 老数据没这一项，
      过一遍编辑器不能凭空多出个字段来（不然整个文件全是 diff）。
      位置放在 rightName 后面，和契约里那份示例一致。
    */
    const tickDays = cleanTickDays(raw.tickDays);
    const tl = {
      id,
      title,
      leftName: String(raw.leftName || '').trim() || '左侧',
      rightName: String(raw.rightName || '').trim() || '右侧',
      ...(tickDays === null ? {} : { tickDays }),
      points: [],
      spans: [],
    };

    const usedP = new Set();
    const rawPoints = Array.isArray(raw.points) ? raw.points : [];
    rawPoints.forEach((pt, pi) => {
      if (!pt || typeof pt !== 'object') { dropped.points++; return; }
      const label = String(pt.label || '').trim();
      /*
        类型：时刻（moment）/ 事件（event）/ 难以考据（fuzzy）。
        只认这三个值，别的（包括老数据里根本没这一项）都当 moment。
      */
      const kind =
        pt.kind === 'event' ? 'event' : pt.kind === 'fuzzy' ? 'fuzzy' : pt.kind === 'moment' ? 'moment' : '';
      const fuzzy = kind === 'fuzzy';
      /*
        难考据的点**没有日期**（写了也丢掉）：它的位置在 `at` 里，
        由编辑器里拖着塔吊定下来。别的点照旧必须有日期。
      */
      const date = fuzzy ? '' : cleanDate(pt.date);
      if (!label || (!fuzzy && !date)) { dropped.points++; return; }
      let pid = String(pt.id || '').trim();
      if (!pid || usedP.has(pid)) pid = `${id}-p${pi + 1}`;
      usedP.add(pid);
      const point = { id: pid, side: pt.side === 'right' ? 'right' : 'left' };
      /*
        字段顺序也是照老数据来的：id / side / date / label / kind / href。
        老数据过一遍编辑器要能**逐字节原样写回**，不然用户一存盘
        整个 timelines.json 全是无意义的顺序变化。
      */
      if (fuzzy) {
        point.kind = 'fuzzy';
        point.at = cleanAt(pt.at);
        point.label = label;
      } else {
        point.date = date;
        point.label = label;
        // 时刻（moment）/ 事件（event）。老数据没这一项，渲染时按「时刻」算，
        // 所以认不出来就不写这个字段，不去污染数据。
        if (kind) point.kind = kind;
      }
      // 点一下跳去哪：和地图图钉同一套链接规则（javascript: / data: 一律丢掉）
      const href = cleanLink(pt.href);
      if (href) point.href = href;
      tl.points.push(point);
    });

    const ids = new Set(tl.points.map((p) => p.id));
    const usedS = new Set();
    const rawSpans = Array.isArray(raw.spans) ? raw.spans : [];
    rawSpans.forEach((sp, si) => {
      if (!sp || typeof sp !== 'object') { dropped.spans++; return; }
      const name = String(sp.name || '').trim();
      if (!name) { dropped.spans++; return; }
      const from = String(sp.from || '').trim();
      const to = String(sp.to || '').trim();
      if (!ids.has(from) || !ids.has(to) || from === to) { dropped.spans++; return; }
      let sid = String(sp.id || '').trim();
      if (!sid || usedS.has(sid)) sid = `${id}-s${si + 1}`;
      usedS.add(sid);
      const span = { id: sid, name, from, to };
      // 挂哪一侧：left / right / both，认不出来就不写（渲染时按起点那侧算）
      if (sp.side === 'left' || sp.side === 'right' || sp.side === 'both') span.side = sp.side;
      const shref = cleanLink(sp.href);
      if (shref) span.href = shref;
      tl.spans.push(span);
    });

    timelines.push(tl);
  });

  return { timelines, dropped };
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
 * 只认这几种块，每种按字段白名单收 —— 编辑器传上来的东西不一定干净，
 * 而这个数组会被渲染到页面上（文字还会走 Markdown 渲染），
 * 与其相信前端，不如在这里收一遍。
 *
 * 块 id 必须留着：排版模式的锚点是 pg-<id>，id 一变，之前调好的位置就丢了。
 * 缺 id 或者撞了才补一个。
 */
const BLOCK_WIDTHS = new Set(['full', 'wide', 'half', 'third']);
const CARD_SHAPES = new Set(['wide', 'square', 'tall']);
const CARD_SIZES = new Set(['l', 'm', 's']);

/** 卡片比例/大小：不认识的值一律不要，留空表示「跟整块默认」 */
function cleanCardShape(v) {
  return CARD_SHAPES.has(v) ? v : undefined;
}
function cleanCardSize(v) {
  return CARD_SIZES.has(v) ? v : undefined;
}

/** 卡片的像素宽高：20~2400 之内的整数才收，其它当没填 */
function cleanCardPx(v, max = 2400) {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  const r = Math.round(n);
  if (r < 20 || r > max) return undefined;
  return r;
}

/**
 * 链接版块的目标地址。
 *
 * 这是个会被渲染成 <a href> 的东西，所以必须收一遍：
 * 只留 http(s) / mailto / tel / 站内 /路径 / #锚点，
 * javascript: 和 data: 这类一律丢掉（不然就是一条能执行脚本的链接）。
 * 用户只写了 example.com 这种，帮他补上 https://。
 */
function cleanLink(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return undefined;
  if (s.startsWith('/') || s.startsWith('#')) return s;
  if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+([/?#][^\s]*)?$/.test(s)) return `https://${s}`;
  return undefined;
}

/**
 * 划分线的颜色。
 *
 * 只认 `#rrggbb`（`#abc` 这种三位简写补全成六位，统一大小写）。
 * 这个值最后会写进 SVG 的 style / stroke，等于半个代码注入口子，
 * 所以格式不对就整条丢掉 —— 渲染端有默认橙色兜底，不会画出隐形线。
 */
function cleanHexColor(raw) {
  const s = String(raw ?? '').trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
  if (full) return s.toLowerCase();
  return undefined;
}

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

    /*
      所有块都从这一个出口出去，于是「认领的时间点/时间段」只需要在这里
      收一次 —— cleanBlocks 里十种块各有各的早期 return，挨个补容易漏。
    */
    const pushBlock = (block) => {
      if (!block) return;
      const tp = String(b.timePoint || '').trim();
      if (tp) block.timePoint = tp;
      const ts = String(b.timeSpan || '').trim();
      if (ts) block.timeSpan = ts;
      out.push(block);
    };

    if (type === 'text') {
      const text = String(b.text ?? '');
      if (text.trim()) pushBlock({ id, type, text });
      return;
    }

    if (type === 'image') {
      const src = String(b.src || '').trim();
      if (!src) return;
      const block = { id, type, src };
      const alt = String(b.alt || '').trim();
      if (alt) block.alt = alt;
      block.width = BLOCK_WIDTHS.has(b.width) ? b.width : 'wide';
      pushBlock(block);
      return;
    }

    if (type === 'link') {
      const text = String(b.text || '').trim();
      const href = String(b.href || '').trim();
      if (!text || !href) return;
      pushBlock({ id, type, text, href });
      return;
    }

    if (type === 'divider') {
      // 分隔线本身没内容，中间那句话可选
      const block = { id, type };
      const text = String(b.text || '').trim();
      if (text) block.text = text;
      pushBlock(block);
      return;
    }

    if (type === 'columns') {
      const left = String(b.left ?? '');
      const right = String(b.right ?? '');
      // 两边都空就没有存在的意义
      if (!left.trim() && !right.trim()) return;
      pushBlock({ id, type, left, right });
      return;
    }

    if (type === 'video') {
      const src = String(b.src || '').trim();
      if (!src) return;
      const block = { id, type, src };
      const caption = String(b.caption || '').trim();
      if (caption) block.caption = caption;
      pushBlock(block);
      return;
    }

    if (type === 'posts') {
      const block = { id, type };
      const text = String(b.text || '').trim();
      if (text) block.text = text;
      pushBlock(block);
      return;
    }

    if (type === 'toc') {
      // 目录块自己不写内容（标题是从别处的「## 小标题」收集来的），
      // 只有「目录」这两个字本身可以改，所以 text 可选
      const block = { id, type };
      const text = String(b.text || '').trim();
      if (text) block.text = text;
      pushBlock(block);
      return;
    }

    if (type === 'map') {
      /*
        地图是「分页」结构：每一页各有自己的图、图钉、划分线和简介。
        坐标全按 0~100 的百分比收，越界的夹回来；小数点留两位就够，
        省得 JSON 里拖一长串浮点尾巴。
      */
      const pct = (v) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return null;
        return Math.round(Math.min(100, Math.max(0, n)) * 100) / 100;
      };

      let rawPages = Array.isArray(b.pages) ? b.pages : [];
      /*
        兼容最早那版「只有一页」的写法：块上直接挂 src + markers（纷湖那张图
        就是这么存下来的）。把它当成一页收，存回去就自动变成新的分页结构了，
        用户不用重新做一遍。
      */
      if (!rawPages.length && String(b.src || '').trim()) rawPages = [b];
      const usedPage = new Set();
      const pages = [];

      rawPages.forEach((pg, pi) => {
        if (!pg || typeof pg !== 'object') return;
        const src = String(pg.src || '').trim();
        // 没选图的页直接不要：一页空白摆在那儿只会让人以为坏了
        if (!src) return;

        let pid = String(pg.id || '').trim();
        if (!pid || usedPage.has(pid)) pid = `${id}-p${pi + 1}`;
        usedPage.add(pid);

        const page = { id: pid, src, markers: [], lines: [] };
        const alt = String(pg.alt || '').trim();
        if (alt) page.alt = alt;
        const text = String(pg.text || '').trim();
        if (text) page.text = text;

        // ---- 图钉 ----
        const usedM = new Set();
        const rawMarkers = Array.isArray(pg.markers) ? pg.markers : [];
        rawMarkers.forEach((m, mi) => {
          if (!m || typeof m !== 'object') return;
          const title = String(m.title || '').trim();
          // 没名字的图钉鼠标移上去什么都不显示、点也不知道去哪，留着只是碍事
          if (!title) return;
          const x = pct(m.x);
          const y = pct(m.y);
          if (x === null || y === null) return;

          let mid = String(m.id || '').trim();
          if (!mid || usedM.has(mid)) mid = `${pid}-m${mi + 1}`;
          usedM.add(mid);

          const marker = { id: mid, kind: m.kind === 'region' ? 'region' : 'building', x, y, title };
          const href = cleanLink(m.href);
          if (href) marker.href = href;
          page.markers.push(marker);
        });

        // ---- 区域划分线 ----
        const usedL = new Set();
        const rawLines = Array.isArray(pg.lines) ? pg.lines : [];
        rawLines.forEach((ln, li) => {
          if (!ln || typeof ln !== 'object') return;
          const x1 = pct(ln.x1);
          const y1 = pct(ln.y1);
          const x2 = pct(ln.x2);
          const y2 = pct(ln.y2);
          if (x1 === null || y1 === null || x2 === null || y2 === null) return;
          // 起终点几乎重合的当误触，别留一根看不见的线在那儿
          if (Math.abs(x2 - x1) < 0.5 && Math.abs(y2 - y1) < 0.5) return;

          let lid = String(ln.id || '').trim();
          if (!lid || usedL.has(lid)) lid = `${pid}-l${li + 1}`;
          usedL.add(lid);

          const line = { id: lid, x1, y1, x2, y2 };
          /*
            颜色是这条线自己的，只认 #rrggbb（三位简写补全成六位）。
            它是直接进 SVG 样式 / style 属性的，所以必须在这里卡死格式：
            认不出来就直接不写这个字段，渲染时回落到默认橙色，
            绝不能把用户传的任意字符串原样存下来。
          */
          const lc = cleanHexColor(ln.color);
          if (lc) line.color = lc;
          page.lines.push(line);
        });

        pages.push(page);
      });

      // 一页都没留下（一张图都没选）就等于这个块是空的
      if (!pages.length) return;
      pushBlock({ id, type, pages });
      return;
    }

    if (type === 'children') {
      pushBlock({
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
  // 副标题：面板标题旁边那行小字。以前这里只认顶层大板块的副标题（writeBoards 里），
  // 子版块的副标题一保存就被丢掉 —— 编辑器里能填、填完却没了，属于静默丢数据。
  const subtitle = String(raw.subtitle || '').trim();
  if (subtitle) out.subtitle = subtitle;
  const href = String(raw.href || '').trim();
  if (href) out.href = href;
  const image = String(raw.image || '').trim();
  if (image) out.image = image;
  // 版式字段：目前只有 'region'（三列分区）。编辑器界面上没有开关，
  // 但必须原样带过去 —— 不认识的字段会被这里丢掉，用户一保存版式就没了。
  const layout = String(raw.layout || '').trim();
  if (layout) out.layout = layout;
  // 页面内容（介绍文字 / 图片 / 链接 / 分隔线 / 两栏 / 视频 / 文章 / 子页面块）
  const page = cleanBlocks(raw.page, id);
  if (page.length) out.page = page;

  // 这一项作为「子页面卡」出现时的比例和大小（空 = 跟「子页面」块的默认值）
  const cardShape = cleanCardShape(raw.cardShape);
  if (cardShape) out.cardShape = cardShape;
  const cardSize = cleanCardSize(raw.cardSize);
  if (cardSize) out.cardSize = cardSize;
  // 卡片的像素宽高：填了就盖过上面的档位
  const cardW = cleanCardPx(raw.cardW);
  if (cardW) out.cardW = cardW;
  const cardH = cleanCardPx(raw.cardH);
  if (cardH) out.cardH = cardH;

  // 链接版块：填了就点它直接跳走，不再有自己的页面
  const link = cleanLink(raw.link);
  if (link) out.link = link;

  /*
    时间轴：这一页用哪条轴、以及这一页自己认领哪个时间点/时间段。
    不认识的字段会被这里丢掉，所以必须显式带过去 —— 不然编辑器里
    选好了时间轴，一保存就没了。
  */
  const timeline = String(raw.timeline || '').trim();
  if (timeline) out.timeline = timeline;
  const timePoint = String(raw.timePoint || '').trim();
  if (timePoint) out.timePoint = timePoint;
  const timeSpan = String(raw.timeSpan || '').trim();
  if (timeSpan) out.timeSpan = timeSpan;

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
    /*
      独立页面：不挂在任何板块下的顶层节点。
      页面照旧生成（地址还是按 id 推的 /<id>，href 可以覆盖），但它**不被
      任何列表收录** —— 首页那两张卡片、右上角目录树、任何页面的子版块列表、
      sitemap 全都没有它，只能靠别处挂的链接点进来。

      只有 `true` 才写这个字段：老数据（没这一项）过一遍编辑器逐字节不变。
      其它处理和不带它的顶层节点一模一样，不去硬塞 children 之类的东西。
    */
    if (b.standalone === true) out.standalone = true;
    // 顶层大板块也可以手写地址（甬城晴雨就是 /yongshen 而不是按 id 推的 /yongcheng）
    const href = String(b.href || '').trim();
    if (href) out.href = href;
    // 版式字段同理：'region' = 三列分区（花娅陌域在用），编辑器不显示但要原样保留
    const layout = String(b.layout || '').trim();
    if (layout) out.layout = layout;
    const timeline = String(b.timeline || '').trim();
    if (timeline) out.timeline = timeline;
    const bTp = String(b.timePoint || '').trim();
    if (bTp) out.timePoint = bTp;
    const bTs = String(b.timeSpan || '').trim();
    if (bTs) out.timeSpan = bTs;
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

/* ------------------------------------------------------------------
   音乐 / 歌单

   数据放在 src/data/music.json：tracks 是曲库，pages 按「页面 key」
   引用曲库里的 id。规则见那个文件里的 _readme。

   页面 key 必须和 src/utils/music.ts 算出来的**一模一样** ——
   站点那边按 key 取歌单，编辑器这边按同一套 key 写回去，
   两边对不上就是「配了不响」。所以板块地址那段是照抄
   src/utils/boards.ts 里的 segmentOf() + flattenBoards() 的 walk。
   ------------------------------------------------------------------ */

/** 歌单数据文件 */
const MUSIC_FILE = path.join(PROJECT_ROOT, 'src', 'data', 'music.json');

/** 通用歌单的伪页面 key（所有页面兜底用，不对应某个真实地址） */
const MUSIC_ALL_KEY = '*';

/** 站点里的定长列表页（和 src/utils/music.ts 的 LIST_PAGES 一一对应） */
const MUSIC_LIST_PAGES = [
  { name: 'posts', label: '文章列表', href: '/posts/' },
  { name: 'notes', label: '手记列表', href: '/notes/' },
  { name: 'archive', label: '归档', href: '/archive/' },
  { name: 'tags', label: '标签', href: '/tags/' },
  { name: 'friends', label: '友链', href: '/friends/' },
  { name: 'about', label: '关于', href: '/about/' },
];

/**
 * music.json 的原版说明。
 *
 * 正常情况是「读回来再写回去」，但文件被人删了、或者写坏了读不动时，
 * 兜底也得有一份 —— 否则一次保存就把这份说明永久弄丢了。
 */
const MUSIC_README = [
  '每个网页一个歌单。这个文件由编辑器「音乐」面板写入，也可以手改（手改完要重新构建）。',
  '',
  'tracks 是曲库：id 唯一；src 是音频地址（public/audio/uploads/ 下的文件，写站内路径 /audio/uploads/xxx.mp3）；title 是显示名。',
  'pages 按页面 key 引用曲库里的 id：',
  '  home                                          首页',
  '  list:posts / list:notes / list:archive        文章、手记、归档列表页',
  '  list:tags / list:friends / list:about         标签页（/tags/<标签> 也用 list:tags）、友链、关于',
  '  board:<板块地址去掉首尾斜杠>                    大板块树里的页面，例如 board:yongcheng、board:yongcheng-a',
  '  entry:posts:<文件名> / entry:notes:<文件名>     文章 / 手记详情页，例如 entry:posts:hello-world',
  '  *                                             所有页面通用歌单：某个页面自己没有歌单时就用它',
  '',
  'first 是「进入这一页一定第一首播」的那首；null = 没选定（进入这一页随机挑一首）。',
  'list 是这一页的歌单；播放时随机轮播，不按这个顺序走。first 不在 list 里也会被当成歌单第一首加进去。',
];

/**
 * 地址归一化：去掉查询串 / 锚点 / 末尾斜杠。
 * 照抄 src/utils/music.ts 的 normalizePath（那边还要去 base，这里站点 base 是 `/`）。
 */
function normalizeMusicPath(value) {
  let p = String(value ?? '/').trim();
  const q = p.search(/[?#]/);
  if (q >= 0) p = p.slice(0, q);
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/+$/, '');
  return p || '/';
}

/** 链接版块的目标地址合不合法（和 boards.ts 的 SAFE_LINK 同一套规则） */
const SAFE_LINK = /^(https?:\/\/|mailto:|tel:|\/|#)/i;
function isBoardLink(value) {
  return typeof value === 'string' && SAFE_LINK.test(value.trim());
}

/** 去重后的地址段：nodeId 去掉 parentId 前缀 -> a-1 这类短段（照抄 boards.ts） */
function boardSegment(nodeId, parentId) {
  if (parentId && nodeId.startsWith(`${parentId}-`)) {
    const rest = nodeId.slice(parentId.length + 1);
    if (rest) return rest;
  }
  return nodeId;
}

/**
 * 展平版块树，只留下「真正有页面」的节点（先序）。
 *
 * 链接版块点了直接跳外站，站里没有它的页面，不能挂歌单；
 * 它是叶子，也不再往下走（和 flattenBoards 的 external 分支一致）。
 */
function flatBoardPages(boards) {
  const out = [];
  const walk = (node, parentId, parentUrl, depth) => {
    if (!node || typeof node !== 'object') return;
    const id = String(node.id ?? '').trim();
    const title = String(node.title ?? '').trim();
    const link = typeof node.link === 'string' ? node.link.trim() : '';
    if (isBoardLink(link)) return;
    const href = String(node.href ?? '').trim();
    const url = href || (depth === 0 ? `/${boardSegment(id, parentId)}` : `${parentUrl}/${boardSegment(id, parentId)}`);
    out.push({ url, title: title || url });
    for (const child of Array.isArray(node.children) ? node.children : []) {
      walk(child, id, url, depth + 1);
    }
  };
  for (const board of Array.isArray(boards) ? boards : []) walk(board, null, '', 0);
  return out;
}

/**
 * 全站可挂歌单的页面清单。
 * 顺序：通用 → 首页 → 六个列表页 → 板块页（先序）→ 文章 → 手记。
 * 文章 / 手记的标题直接用 listItems() 那份（不重新解析 frontmatter）。
 */
async function musicPages() {
  const out = [
    { key: MUSIC_ALL_KEY, label: '所有页面（通用歌单）', href: '', kind: 'all' },
    { key: 'home', label: '首页', href: '/', kind: 'home' },
  ];
  for (const p of MUSIC_LIST_PAGES) {
    out.push({ key: `list:${p.name}`, label: p.label, href: p.href, kind: 'list' });
  }

  let boards = [];
  try {
    const data = await readBoards();
    boards = Array.isArray(data?.boards) ? data.boards : [];
  } catch {
    // 读不到版块树就当没有板块页 —— 不能让整个音乐面板打不开
  }
  const seenBoard = new Set();
  for (const f of flatBoardPages(boards)) {
    const key = `board:${normalizeMusicPath(f.url).replace(/^\//, '')}`;
    // 两个节点写出同一个地址时会算出同一个 key，留先出现的那个（站点那边也是后者覆盖前者）
    if (seenBoard.has(key)) continue;
    seenBoard.add(key);
    out.push({ key, label: f.title, href: f.url, kind: 'board' });
  }

  const [posts, notes] = await Promise.all([listItems('posts'), listItems('notes')]);
  for (const it of posts) {
    out.push({ key: `entry:posts:${it.slug}`, label: it.title, href: `/posts/${it.slug}/`, kind: 'entry' });
  }
  for (const it of notes) {
    out.push({ key: `entry:notes:${it.slug}`, label: it.title, href: `/notes/${it.slug}/`, kind: 'entry' });
  }
  return out;
}

/** 读歌单。读不到 / 文件坏了都返回空结构，不让面板整个打不开 */
async function readMusic() {
  try {
    const raw = JSON.parse(await fs.readFile(MUSIC_FILE, 'utf8'));
    const tracks = Array.isArray(raw?.tracks) ? raw.tracks : [];
    const pages =
      raw && typeof raw.pages === 'object' && !Array.isArray(raw.pages) ? raw.pages : {};
    return { readme: raw?._readme ?? MUSIC_README, tracks, pages };
  } catch {
    return { readme: MUSIC_README, tracks: [], pages: {} };
  }
}

/** `/audio/uploads/xxx.mp3` -> `xxx.mp3`；不是这个前缀 / 名字不干净就返回空串 */
function audioNameOf(src) {
  const s = String(src ?? '').trim();
  const prefix = '/audio/uploads/';
  if (!s.startsWith(prefix)) return '';
  const name = s.slice(prefix.length);
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return '';
  if (!AUDIO_MIME.has(path.extname(name).toLowerCase())) return '';
  return name;
}

/** 曲目地址必须是 public/audio/uploads 下的站内文件（不许 http、不许 ..） */
function cleanAudioSrc(raw) {
  const name = audioNameOf(raw);
  return name ? `/audio/uploads/${name}` : '';
}

/**
 * 歌单清洗。
 *
 * 曲库：id / title / src 缺一个就丢掉，id 撞了也只留先出现的。
 * 页面：只认合法 key；list 里的 id 必须能在曲库里找到（找不到就丢，并记账），
 * first 找不到就置 null；list 去重；first 不在 list 里就补到开头
 * （站点那边也这么兜，编辑器跟上，免得「选了第一首却没进歌单」）；
 * 空条目整个删掉，文件才干净。
 */
function cleanMusic(payload, validKeys) {
  const dropped = { tracks: 0, pages: 0, list: 0, first: 0 };

  const tracks = [];
  const byId = new Set();
  for (const raw of Array.isArray(payload?.tracks) ? payload.tracks : []) {
    if (!raw || typeof raw !== 'object') {
      dropped.tracks++;
      continue;
    }
    const id = String(raw.id ?? '').trim();
    const title = String(raw.title ?? '').trim();
    const src = cleanAudioSrc(raw.src);
    if (!id || !title || !src || byId.has(id)) {
      dropped.tracks++;
      continue;
    }
    byId.add(id);
    const track = { id, title, src };
    const bytes = Number(raw.bytes);
    if (Number.isFinite(bytes) && bytes > 0) track.bytes = Math.round(bytes);
    const addedAt = String(raw.addedAt ?? '').trim();
    if (addedAt) track.addedAt = addedAt;
    tracks.push(track);
  }

  const rawPages =
    payload?.pages && typeof payload.pages === 'object' && !Array.isArray(payload.pages)
      ? payload.pages
      : {};
  const pages = {};
  for (const [key, value] of Object.entries(rawPages)) {
    if (!validKeys.has(key)) {
      dropped.pages++;
      continue;
    }
    const src = value && typeof value === 'object' ? value : {};
    const list = [];
    for (const rawId of Array.isArray(src.list) ? src.list : []) {
      const id = String(rawId ?? '').trim();
      if (!byId.has(id)) {
        dropped.list++;
        continue;
      }
      if (!list.includes(id)) list.push(id);
    }
    let first = String(src.first ?? '').trim();
    if (first && !byId.has(first)) {
      first = '';
      dropped.first++;
    }
    if (first && !list.includes(first)) list.unshift(first);
    // 既没有歌单也没有第一首：这个条目没有意义，删掉
    if (!list.length && !first) continue;
    pages[key] = { first: first || null, list };
  }

  return { tracks, pages, dropped };
}

/** 写回歌单文件（先留一份备份，写坏了还能捞回来 —— 和 boards / timelines 一个规矩） */
async function writeMusicFile(readme, tracks, pages) {
  try {
    await fs.copyFile(MUSIC_FILE, `${MUSIC_FILE}.bak`);
  } catch {
    /* 第一次还没有这个文件，正常 */
  }
  const out = { _readme: readme ?? MUSIC_README, tracks, pages };
  await fs.writeFile(MUSIC_FILE, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  return out;
}

/**
 * 音频上传的落盘文件名：
 * `<yyyyMMdd-HHmm>-<4位随机>-<清洗过的原名>.<扩展名>`
 * （时间前缀是为了在文件夹里按上传顺序排，随机段避免同名撞车）
 */
function sanitizeAudioName(name, ext) {
  let stem = path.basename(String(name ?? 'audio'));
  stem = stem.replace(/\.[^.]*$/, '');
  stem = stem
    .replace(/[^\w\u4e00-\u9fff.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 48);
  if (!stem) stem = 'audio';
  const d = new Date();
  const { date, time } = formatDateParts(d);
  const stamp = `${date.replace(/-/g, '')}-${time.replace(':', '')}`;
  const rand = randomBytes(2).toString('hex');
  return `${stamp}-${rand}-${stem}${ext}`;
}

/**
 * 把请求体当原始二进制流边收边写盘，顺手卡上限。
 *
 * 不用 readBody：那个是给 JSON 的，12MB 上限会直接把音频拦掉，
 * 而且整段读进内存也没必要。超限时中止、把半个文件删掉，
 * 免得 uploads 目录里留下一个永远播不出来的残片。
 */
function receiveAudio(req, abs) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let done = false;
    const out = createWriteStream(abs);

    const fail = (err) => {
      if (done) return;
      done = true;
      req.unpipe(out);
      out.destroy();
      fs.unlink(abs).catch(() => {
        /* 本来就没写出来也无所谓 */
      });
      reject(err);
    };

    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_AUDIO_BYTES) {
        // 剩下的请求体继续读掉再丢，免得客户端拿到 ECONNRESET 而不是那个 413
        req.resume();
        fail(httpError(413, `单首音频不能超过 ${MAX_AUDIO_BYTES / 1024 / 1024}MB`));
      }
    });
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => {
      if (done) return;
      done = true;
      if (!size) {
        fs.unlink(abs).catch(() => {});
        reject(httpError(400, '音频内容是空的'));
        return;
      }
      resolve(size);
    });
    req.pipe(out);
  });
}

/**
 * 上传一首音频。
 *
 * 落盘之后**不重新构建** —— 一次传十首，每首都构建一遍是白等。
 * 文件和数据文件当场就写好了，什么时候让网站看到由「保存并重新构建」决定。
 */
async function handleAudioUpload(req, res, url) {
  const rawName = url.searchParams.get('name') || '';
  const key = String(url.searchParams.get('key') || '');
  const ext = path.extname(path.basename(rawName)).toLowerCase();
  if (!AUDIO_MIME.has(ext)) {
    // 请求体读掉再丢，免得客户端拿到 ECONNRESET 而不是这个 400
    req.resume();
    throw httpError(
      400,
      `只支持 ${[...AUDIO_MIME.keys()].map((e) => e.slice(1)).join(' / ')} 这些音频格式，收到的是 ${ext || '（没扩展名）'}`
    );
  }

  const declared = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declared) && declared > MAX_AUDIO_BYTES) {
    req.resume();
    throw httpError(413, `单首音频不能超过 ${MAX_AUDIO_BYTES / 1024 / 1024}MB`);
  }

  const filename = sanitizeAudioName(rawName, ext);
  await fs.mkdir(AUDIO_DIR, { recursive: true });
  const abs = path.join(AUDIO_DIR, filename);
  const bytes = await receiveAudio(req, abs);

  /*
    压缩：落地后立刻转成 128kbps（逻辑在 tools/audio/optimize.mjs）。
    原盘 320kbps 一首 8MB，压完约 3MB —— 手机上这一下差得很明显；
    已经压过的（≤150kbps）会自动跳过，不会二次损伤音质。
    压缩失败不影响上传：压不动就原样留着，只是体积大一点。
  */
  let compression = null;
  try {
    const { compressAudio } = await import('../../tools/audio/optimize.mjs');
    compression = await compressAudio(abs);
  } catch (err) {
    compression = {
      ok: false,
      skipped: true,
      reason: `压缩失败（原样保存）：${err.message}`,
      before: bytes,
      after: bytes
    };
  }
  // 注意：这里的 fs 是 node:fs/promises，没有 existsSync —— 压缩后重新取一次大小
  let finalBytes = bytes;
  try {
    finalBytes = (await fs.stat(abs)).size;
  } catch {
    finalBytes = bytes;
  }

  const current = await readMusic();
  const validKeys = new Set((await musicPages()).map((p) => p.key));
  // 先按同一套规则把盘上那份洗干净，再往后追加 —— 手改坏了的条目顺手收掉
  const clean = cleanMusic({ tracks: current.tracks, pages: current.pages }, validKeys);

  const id = `tr_${Date.now()}-${randomBytes(2).toString('hex')}`;
  const title = path.basename(rawName).replace(/\.[^.]*$/, '').trim().slice(0, 120) || filename;
  const track = {
    id,
    title,
    src: `/audio/uploads/${filename}`,
    bytes: finalBytes,
    addedAt: new Date().toISOString()
  };
  clean.tracks.push(track);

  // key 为空或不是合法页面：只进曲库，不进任何歌单（之后在面板里手动加）
  if (key && validKeys.has(key)) {
    const page = clean.pages[key] ?? { first: null, list: [] };
    if (!page.list.includes(id)) page.list.push(id);
    clean.pages[key] = page;
  }

  await writeMusicFile(current.readme, clean.tracks, clean.pages);
  return sendJson(res, 200, {
    ok: true,
    track,
    compression,
    music: { tracks: clean.tracks, pages: clean.pages },
    pages: await musicPages(),
  });
}

/**
 * 从曲库删掉一首：同时从所有页面的歌单里摘掉、first 指向它时置 null。
 * 同一首的音频文件只有没有别的曲目在用时才删（src 可能被两条记录共用）。
 * 和上传一样，这里**不重新构建**。
 */
async function handleMusicRemove(res, payload) {
  const id = String(payload?.id ?? '').trim();
  if (!id) throw httpError(400, 'id 不能为空');

  const current = await readMusic();
  const target = current.tracks.find((t) => t && String(t.id) === id);
  if (!target) throw httpError(404, `曲库里没有 ${id}`);

  const pagesIn = {};
  for (const [key, value] of Object.entries(current.pages)) {
    const src = value && typeof value === 'object' ? value : {};
    const list = (Array.isArray(src.list) ? src.list : [])
      .map((v) => String(v))
      .filter((v) => v !== id);
    const first = String(src.first ?? '') === id ? null : src.first ?? null;
    pagesIn[key] = { first, list };
  }

  const validKeys = new Set((await musicPages()).map((p) => p.key));
  const remaining = current.tracks.filter((t) => t !== target);
  const clean = cleanMusic({ tracks: remaining, pages: pagesIn }, validKeys);

  const src = cleanAudioSrc(target.src);
  if (payload?.deleteFile !== false && src && !clean.tracks.some((t) => t.src === src)) {
    const name = audioNameOf(src);
    if (name) {
      try {
        await fs.unlink(path.join(AUDIO_DIR, name));
      } catch {
        /* 文件本来就不在了，也算删干净了 */
      }
    }
  }

  await writeMusicFile(current.readme, clean.tracks, clean.pages);
  return sendJson(res, 200, { ok: true, music: { tracks: clean.tracks, pages: clean.pages } });
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

/**
 * 把 public/audio/uploads 下的音频发给浏览器。
 *
 * 试听要用它：面板里的 <audio> 就指向 /audio/uploads/xxx.mp3。
 * 和图片一样是「白名单子目录 + 纯文件名」，挡掉 ../ 和更深的路径，
 * 扩展名也只放行音频那几种。
 */
async function serveAudio(res, pathname) {
  const rest = pathname.slice('/audio/'.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return false;
  if (rest.slice(0, slash) !== 'uploads') return false;

  const name = rest.slice(slash + 1);
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return false;
  const type = AUDIO_MIME.get(path.extname(name).toLowerCase());
  if (!type) return false;

  try {
    const buf = await fs.readFile(path.join(AUDIO_DIR, name));
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': buf.length,
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'none',
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

  /*
    上传的音频同样得发回去 —— 音乐面板里的试听播放器指向
    /audio/uploads/xxx.mp3，不暴露这个前缀的话点「▶」永远是 404。
  */
  if (pathname.startsWith('/audio/')) {
    if (await serveAudio(res, pathname)) return;
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
    '   音频目录： public/audio/uploads',
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
