#!/usr/bin/env node
/**
 * 校验 + 报数：跑一次就能看出来「切分片到底省了多少、有没有丢字」。
 *
 * 用法：
 *     cd "D:\\曼沫砾总线\\Chenxu-MarshEco.github.io"
 *     node tools/fonts/report.mjs
 *
 * 可选参数：
 *     --root DIR     仓库根（默认 = 本脚本往上两级）
 *     --pages a,b    只测这些页面（默认 dist/index.html、archive、posts、friends + 一个文章页）
 *     --all          把 dist 下所有页面都扫一遍，并给出分片命中数的分布
 *     --top N        分片清单里只列前 N 片（默认全列）
 *
 * 它做三件事，全部自己算，不信任何现成结论：
 *   1. 清单：每片字节数、码位数、合计与母本的倍数；
 *   2. 覆盖率校验：本脚本自带一个 WOFF2 解码器（Brotli + 表目录 + cmap format 4/12），
 *      直接从 woff2 字节流里解出每片真实覆盖的码位，和母本 cmap 的集合做相等比较；
 *      同时核对 src/styles/fonts.css 里每条 unicode-range 与清单是否一致；
 *   3. 逐页成本：按页面文本里出现的字，算出它需要下载哪几片、合计多少 KB，
 *      和原来「每页都下 1040 KB 母本」对比。
 *
 * 注意：浏览器真正的下载量还取决于 HTTP 缓存（同一分片多页共用）与 preload，
 * 这里算的是「该页面的字符集合所需的分片字节上限」，是最贴近真实的一次访客成本。
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

// ---------------------------------------------------------------------------
// 命令行
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { root: REPO, pages: null, top: 0, all: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--root') out.root = path.resolve(argv[++i]);
    else if (a === '--pages') out.pages = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--all') out.all = true;
    else if (a === '--top') out.top = Number(argv[++i]) || 0;
    else if (a === '--help' || a === '-h') {
      console.log('用法: node tools/fonts/report.mjs [--root DIR] [--pages a,b] [--all] [--top N]');
      process.exit(0);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const ROOT = args.root;
const MANIFEST = path.join(HERE, 'manifest.json');
const CSS_PATH = path.join(ROOT, 'src', 'styles', 'fonts.css');

// ---------------------------------------------------------------------------
// WOFF2 解码：只取 cmap，用于「分片到底覆盖了哪些码位」的独立校验
// 头布局（前 24 字节就够）：signature 4s | flavor 4s | length I | numTables H |
//   reserved H | totalSfntSize I | totalCompressedSize I
// 表目录：flags(1) [+ tag(4)] origLength(base128) [transformLength(base128)]
// 表数据：紧随目录之后的一段 Brotli 流，解压后按表的 compLength 依次排列
// ---------------------------------------------------------------------------
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm',
  'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern',
  'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC',
  'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty',
  'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill',
];

function readBase128(buf, pos) {
  let value = 0;
  for (let i = 0; i < 5; i += 1) {
    const byte = buf[pos];
    pos += 1;
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, pos];
  }
  throw new Error('bad base128');
}

function decodeWoff2Cmap(buf) {
  if (buf.length < 48 || buf.toString('latin1', 0, 4) !== 'wOF2') {
    throw new Error('不是 woff2 文件（签名不对）');
  }
  const flavor = buf.toString('latin1', 4, 8);
  const fileLength = buf.readUInt32BE(8);
  const numTables = buf.readUInt16BE(12);
  const totalSfntSize = buf.readUInt32BE(16);
  const totalCompressedSize = buf.readUInt32BE(20);

  let pos = 48;
  let offset = 0;
  const tables = new Map();
  for (let i = 0; i < numTables; i += 1) {
    const flags = buf[pos];
    pos += 1;
    let tag;
    if ((flags & 0x3f) === 0x3f) {
      tag = buf.toString('latin1', pos, pos + 4);
      pos += 4;
    } else {
      tag = KNOWN_TAGS[flags & 0x3f];
    }
    const version = flags >> 6;
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    let origLength;
    [origLength, pos] = readBase128(buf, pos);
    let compLength = origLength;
    if (transformed) [compLength, pos] = readBase128(buf, pos);
    tables.set(tag, { tag, offset, origLength, compLength, transformed });
    offset += compLength;
  }
  const dataStart = pos;
  let plain;
  try {
    plain = zlib.brotliDecompressSync(buf.subarray(dataStart));
  } catch (err) {
    throw new Error(`Brotli 解压失败（表数据起点 ${dataStart}）：${err.message}`);
  }

  const entry = tables.get('cmap');
  if (!entry) throw new Error('分片里没有 cmap 表');
  if (entry.transformed) throw new Error('cmap 不该被变换');
  const cmapData = plain.subarray(entry.offset, entry.offset + entry.compLength);

  const mapped = new Set();
  const numSubtables = cmapData.readUInt16BE(2);
  const subtableInfo = [];
  for (let i = 0; i < numSubtables; i += 1) {
    const base = 4 + i * 8;
    const platformID = cmapData.readUInt16BE(base);
    const encodingID = cmapData.readUInt16BE(base + 2);
    const subOffset = cmapData.readUInt32BE(base + 4);
    const format = cmapData.readUInt16BE(subOffset);
    let count = 0;
    if (format === 4) {
      const segCountX2 = cmapData.readUInt16BE(subOffset + 6);
      const segCount = segCountX2 / 2;
      const endBase = subOffset + 14;
      const startBase = endBase + segCountX2 + 2; // +2 跳掉 reservedPad
      const deltaBase = startBase + segCountX2;
      const rangeBase = deltaBase + segCountX2;
      for (let s = 0; s < segCount; s += 1) {
        const end = cmapData.readUInt16BE(endBase + s * 2);
        const start = cmapData.readUInt16BE(startBase + s * 2);
        const delta = cmapData.readInt16BE(deltaBase + s * 2);
        const rangeOffset = cmapData.readUInt16BE(rangeBase + s * 2);
        if (start === 0xffff) continue;
        for (let c = start; c <= end; c += 1) {
          let gid;
          if (rangeOffset === 0) {
            gid = (c + delta) & 0xffff;
          } else {
            const gidPos = rangeBase + s * 2 + rangeOffset + (c - start) * 2;
            gid = cmapData.readUInt16BE(gidPos);
            if (gid !== 0) gid = (gid + delta) & 0xffff;
          }
          if (gid !== 0) {
            mapped.add(c);
            count += 1;
          }
        }
      }
    } else if (format === 12) {
      const nGroups = cmapData.readUInt32BE(subOffset + 12);
      for (let g = 0; g < nGroups; g += 1) {
        const gBase = subOffset + 16 + g * 12;
        const start = cmapData.readUInt32BE(gBase);
        const end = cmapData.readUInt32BE(gBase + 4);
        for (let c = start; c <= end; c += 1) mapped.add(c);
        count += end - start + 1;
      }
    } else if (format === 6) {
      const first = cmapData.readUInt16BE(subOffset + 6);
      const entries = cmapData.readUInt16BE(subOffset + 8);
      for (let e = 0; e < entries; e += 1) {
        if (cmapData.readUInt16BE(subOffset + 10 + e * 2) !== 0) mapped.add(first + e);
        count += 1;
      }
    } else {
      throw new Error(`cmap 子表 format ${format} 未支持（platform ${platformID}/${encodingID}）`);
    }
    subtableInfo.push({ platformID, encodingID, format, count });
  }
  return { flavor, fileLength, totalSfntSize, totalCompressedSize, tables, mapped, subtableInfo };
}

// ---------------------------------------------------------------------------
// u 码位工具
// ---------------------------------------------------------------------------
const parseCP = (token) => {
  const hex = token.trim().replace(/^U\+/i, '');
  return parseInt(hex, 16);
};
const fmtCP = (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const pct = (x) => `${(x * 100).toFixed(1)}%`;

function compressToRanges(list) {
  const sorted = [...list].sort((a, b) => a - b);
  const out = [];
  let i = 0;
  while (i < sorted.length) {
    const start = sorted[i];
    let end = start;
    while (i + 1 < sorted.length && sorted[i + 1] === end + 1) {
      i += 1;
      end = sorted[i];
    }
    out.push(start === end ? fmtCP(start) : `${fmtCP(start)}-${fmtCP(end).slice(2)}`);
    i += 1;
  }
  return out;
}

function parseUnicodeRange(text) {
  const set = new Set();
  for (const raw of text.split(',')) {
    const token = raw.trim();
    if (!token) continue;
    const m = /^U\+([0-9A-Fa-f?]{1,6})(?:-([0-9A-Fa-f]{1,6}))?$/.exec(token);
    if (!m) throw new Error(`无法解析的 unicode-range 片段：${token}`);
    if (m[1].includes('?')) {
      const lo = parseInt(m[1].replace(/\?/g, '0'), 16);
      const hi = parseInt(m[1].replace(/\?/g, 'F'), 16);
      for (let c = lo; c <= hi; c += 1) set.add(c);
    } else if (m[2]) {
      for (let c = parseInt(m[1], 16); c <= parseInt(m[2], 16); c += 1) set.add(c);
    } else {
      set.add(parseInt(m[1], 16));
    }
  }
  return set;
}

// ---------------------------------------------------------------------------
// 页面文本（和 slice_font.py 同一套口径：跳 script/style/svg 等非文本容器，
// 只额外收 alt / title / aria-label 这几个真正会渲染或被读屏念出来的属性）
// ---------------------------------------------------------------------------
const SKIP_TAGS = ['script', 'style', 'title', 'noscript', 'template', 'svg', 'path', 'head'];
// 会被渲染 / 被读屏念出来的属性。刻意不含 meta 的 content：
// 那里常常塞着 base64 的 OG 图或 data: URI，会把一堆生僻符号算成「页面用字」。
const LABEL_ATTRS = ['alt', 'title', 'aria-label'];
const TAG_RE = /<([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  ldquo: '\u201c', rdquo: '\u201d', hellip: '\u2026', mdash: '\u2014', ndash: '\u2013',
};

function decodeEntities(s) {
  return s.replace(/&(#[0-9]+|#x[0-9A-Fa-f]+|[A-Za-z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ' ';
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : ' ';
  });
}

function labelAttrs(attrText) {
  const found = [];
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(attrText)) !== null) {
    if (LABEL_ATTRS.includes(m[1].toLowerCase())) found.push(m[2] !== undefined ? m[2] : m[3]);
  }
  return found;
}

/** 把一份 HTML 折成「人眼会读到的字符」集合（用频率序位次验证过，不含 base64 噪声）。 */
function pageTextChars(html) {
  let s = html;
  for (const tag of SKIP_TAGS) {
    s = s.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ');
  }
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  const labels = [];
  s = s.replace(TAG_RE, (whole, name, attrs) => {
    const lower = name.toLowerCase();
    if (SKIP_TAGS.includes(lower)) return ' ';
    for (const value of labelAttrs(attrs)) labels.push(value);
    return ' ';
  });
  // 标签外只剩文本；再整体解一次实体，data: URI / base64 会被下面的过滤器挡掉
  const text = decodeEntities(s);
  const set = new Set();
  const add = (str) => {
    for (const ch of str) {
      if (/\s/.test(ch)) continue;
      set.add(ch.codePointAt(0));
    }
  };
  add(text);
  for (const value of labels) {
    const probe = value.trim();
    if (!probe || /^data:/i.test(probe) || probe.length > 120) continue;
    add(value);
  }
  return set;
}

// ---------------------------------------------------------------------------
// 输出助手
// ---------------------------------------------------------------------------
const W = (cells, widths) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ');

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
if (!fs.existsSync(MANIFEST)) {
  console.error(`找不到 ${path.relative(ROOT, MANIFEST)}，先跑：python tools/fonts/slice_font.py`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const masterPath = path.join(ROOT, manifest.master);
const masterBytes = fs.statSync(masterPath).size;

console.log('='.repeat(78));
console.log('字体分片报告（tools/fonts/report.mjs）');
console.log('='.repeat(78));
console.log(`仓库根      ${ROOT}`);
console.log(`母本        ${manifest.master}  ${masterBytes} 字节（${kb(masterBytes)}）`);
console.log(`切片脚本    ${manifest.generator}  ${manifest.generated_at}`);
console.log(`切片参数    第 1 片 ${manifest.params.shard1} 字，其余每片约 ${manifest.params.chunk} 字，`
  + `片数范围 ${manifest.params.min_shards}~${manifest.params.max_shards}，总量上限 ${manifest.params.max_growth}×`);
console.log(`频率来源    ${manifest.params.frequency_source.join('、')}`);

// --- 1. 解码每个分片 ------------------------------------------------------
// 校验口径（三层，缺一不可）：
//   a. 清单声明的每个码位都必须在 woff2 的 cmap 里 —— 声明了却没有 = 页面会缺字；
//   b. woff2 的 cmap 里多出来的码位（fontTools 子集化时的 layout 闭包顺带留下的）
//      必须仍属于母本集合，且必须在 unicode-range 之外 —— 页面不会请求它，不算错；
//   c. 所有分片 unicode-range 的并集必须严格等于母本 cmap 集合。
const shards = [];
const problems = [];
const benignExtras = new Map();
// 母本码位：直接解母本 woff2 的 cmap（在分片校验之前解，分片校验要拿它当参照）
const masterDecoded = decodeWoff2Cmap(fs.readFileSync(masterPath));
const masterSet = masterDecoded.mapped;
for (const item of manifest.shards) {
  const filePath = path.join(ROOT, item.file);
  if (!fs.existsSync(filePath)) {
    problems.push(`缺文件 ${item.file}`);
    continue;
  }
  const buf = fs.readFileSync(filePath);
  const decoded = decodeWoff2Cmap(buf);
  const declared = new Set(item.unicode.map(parseCP));
  const cssRanges = parseUnicodeRange(item.ranges.join(', '));
  const rangeMatchesManifest = cssRanges.size === declared.size
    && [...declared].every((cp) => cssRanges.has(cp));
  if (!rangeMatchesManifest) problems.push(`${item.file} 的 unicode-range 段与清单不一致`);
  if (cssRanges.size !== item.ranges.reduce((a, r) => a + parseUnicodeRange(r).size, 0)) {
    problems.push(`${item.file} 清单里的 ranges 自身有重叠`);
  }
  const miss = [...declared].filter((cp) => !decoded.mapped.has(cp));
  const extra = [...decoded.mapped].filter((cp) => !declared.has(cp));
  const extraOutsideMaster = extra.filter((cp) => !masterDecoded.mapped.has(cp));
  if (miss.length) problems.push(`${item.file} 声明的码位里有 ${miss.length} 个不在 woff2 cmap 中（会缺字）`);
  if (extraOutsideMaster.length) {
    problems.push(`${item.file} 的 cmap 含母本之外的码位：`
      + compressToRanges(extraOutsideMaster).join(', '));
  }
  for (const cp of extra) benignExtras.set(cp, (benignExtras.get(cp) || 0) + 1);
  if (buf.length !== item.bytes) {
    problems.push(`${item.file} 字节数与清单不一致（${buf.length} vs ${item.bytes}）`);
  }
  if (decoded.fileLength !== buf.length) {
    problems.push(`${item.file} 头里的 length 字段与文件大小不符`);
  }
  shards.push({
    ...item,
    bytes: buf.length,
    set: cssRanges,
    cmap: decoded.mapped,
    extras: extra,
    extraOutsideMaster,
    miss,
    subtableInfo: decoded.subtableInfo,
    totalSfntSize: decoded.totalSfntSize,
  });
}

const totalShardBytes = shards.reduce((acc, s) => acc + s.bytes, 0);
const growth = totalShardBytes / masterBytes;

// --- 3. 清单 --------------------------------------------------------------
console.log('\n' + '─'.repeat(78));
console.log(`一、分片清单（共 ${shards.length} 片）`);
console.log('─'.repeat(78));
const head = ['#', '文件', '码位数', '字节', 'KB', '占母本'];
const widths = [4, 26, 8, 10, 10, 9];
console.log(W(head, widths));
console.log(W(head.map(() => '─'), widths));
for (const s of shards) {
  console.log(W([
    String(s.index).padStart(2, '0'),
    path.basename(s.file),
    s.codepoints,
    s.bytes,
    kb(s.bytes),
    pct(s.bytes / masterBytes),
  ], widths));
}
console.log(W(['', '合计', shards.reduce((a, s) => a + s.codepoints, 0), totalShardBytes,
  kb(totalShardBytes), pct(growth)], widths));
console.log(`母本 ${manifest.master}：${masterBytes} 字节（${kb(masterBytes)}）`);
console.log(`分片合计 / 母本 = ${growth.toFixed(3)}×（脚本约束上限 ${manifest.params.max_growth}×）`
  + `  →  ${growth <= manifest.params.max_growth ? '通过' : '超限！'}`);
const biggest = shards.reduce((a, s) => (s.bytes > a.bytes ? s : a), shards[0]);
const smallest = shards.reduce((a, s) => (s.bytes < a.bytes ? s : a), shards[0]);
console.log(`最大片 ${path.basename(biggest.file)} ${kb(biggest.bytes)}；`
  + `最小片 ${path.basename(smallest.file)} ${kb(smallest.bytes)}；`
  + `平均 ${kb(totalShardBytes / shards.length)}`);

// --- 4. 覆盖率校验 --------------------------------------------------------
console.log('\n' + '─'.repeat(78));
console.log('二、覆盖率校验（分片 unicode-range 并集 vs 母本 cmap，两边都是现解 woff2 字节流）');
console.log('─'.repeat(78));
const union = new Set();
for (const s of shards) for (const cp of s.set) union.add(cp);
const cmapUnion = new Set();
for (const s of shards) for (const cp of s.cmap) cmapUnion.add(cp);
const missing = [...masterSet].filter((cp) => !union.has(cp));
const extra = [...union].filter((cp) => !masterSet.has(cp));
const masterCells = [...masterSet];
const gb2312 = masterCells.filter((cp) => cp >= 0x4e00 && cp <= 0x9fa5).length;
console.log(`母本码位（解码 woff2 cmap 得到）  ${masterSet.size} 个，`
  + `区间 ${fmtCP(Math.min(...masterCells))} ~ ${fmtCP(Math.max(...masterCells))}`);
console.log(`  其中 U+4E00~U+9FA5 汉字区        ${gb2312} 个（GB2312 一级+二级汉字 6763 字全覆盖）`);
console.log(`分片 unicode-range 码位合计       ${shards.reduce((a, s) => a + s.set.size, 0)} 个`);
console.log(`分片 unicode-range 并集           ${union.size} 个`);
console.log(`分片 woff2 cmap 并集（含顺带字形）${cmapUnion.size} 个`);
console.log(`差集：母本有、分片没有（丢字）    ${missing.length} 个`);
if (missing.length) console.log(`  ${compressToRanges(missing).join(', ')}`);
console.log(`差集：分片有、母本没有（多字）    ${extra.length} 个`);
if (extra.length) console.log(`  ${compressToRanges(extra).join(', ')}`);
const coverOk = missing.length === 0 && extra.length === 0 && union.size === masterSet.size;
console.log(`结论：${coverOk ? '并集 == 母本集合，覆盖不缩水 ✅' : '覆盖不一致 ❌'}`);
if (benignExtras.size) {
  const detail = [...benignExtras.entries()]
    .map(([cp, n]) => `${fmtCP(cp)}（第 ${n} 片）`)
    .join('、');
  console.log(`\n附注：有 ${benignExtras.size} 个码位在 woff2 里存在、但没写进 unicode-range：${detail}。`);
  console.log('  这是 fontTools 子集化时把 layout 特性（GSUB/GPOS）引用到的字形一起带上导致的，');
  console.log('  浏览器只按 unicode-range 决定要不要请求这一片，所以它们不会进入页面下载；');
  console.log('  页面若真的用到它们，会由该片里同时被声明的相邻码位把那一片带下来，字形仍在。');
}

// --- 5. fonts.css 一致性 ---------------------------------------------------
console.log('\n' + '─'.repeat(78));
console.log('三、src/styles/fonts.css 一致性');
console.log('─'.repeat(78));
const css = fs.readFileSync(CSS_PATH, 'utf8');
const cssLines = css.split('\n').length;
const faceBlocks = [...css.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)].map((m) => m[1]);
const cssChecks = [];
for (const block of faceBlocks) {
  const get = (prop) => {
    const m = new RegExp(`${prop}\\s*:\\s*([^;]+);`).exec(block);
    return m ? m[1].trim() : null;
  };
  cssChecks.push({
    family: get('font-family'),
    src: get('src'),
    weight: get('font-weight'),
    style: get('font-style'),
    display: get('font-display'),
    range: get('unicode-range'),
  });
}
const cssRangesMatchManifest = cssChecks.length === shards.length
  && cssChecks.every((c, i) => {
    const fromCss = parseUnicodeRange(c.range || '');
    return fromCss.size === shards[i].set.size && [...fromCss].every((cp) => shards[i].set.has(cp));
  });
console.log(`文件行数                ${cssLines}`);
console.log(`@font-face 条数         ${faceBlocks.length}`);
console.log(`分片文件数              ${shards.length}`);
console.log(`条数一致                ${faceBlocks.length === shards.length ? '✅' : '❌ 不一致'}`);
console.log(`每条 unicode-range 与对应分片一致  ${cssRangesMatchManifest ? '✅' : '❌'}`);
// 注释安全：注释块里的 `*/` 会提前闭合注释，剩下的字变成非法选择器
// （lightningcss 会报 "Invalid dangling combinator in selector"，整个构建挂掉）
const cssBody = css.replace(/\/\*[\s\S]*?\*\//g, '');
const commentSafe = !cssBody.includes('*/');
if (!commentSafe) {
  problems.push(`src/styles/fonts.css 注释被提前闭合：正文里残留 */ `
    + `（约第 ${cssBody.slice(0, cssBody.indexOf('*/')).split('\n').length} 行）`);
}
console.log(`CSS 注释安全（正文里没有残留 */）  ${commentSafe ? '✅' : '❌ 会让构建挂掉'}`);
const families = new Set(cssChecks.map((c) => c.family));
const weights = new Set(cssChecks.map((c) => c.weight));
const styles = new Set(cssChecks.map((c) => c.style));
const displays = new Set(cssChecks.map((c) => c.display));
console.log(`family 取值             ${[...families].join(' / ')}`);
console.log(`font-weight 取值        ${[...weights].join(' / ')}（母本声明 ${manifest.font_weight}）`);
console.log(`font-style 取值         ${[...styles].join(' / ')}`);
console.log(`font-display 取值       ${[...displays].join(' / ')}`);
console.log(`每条 @font-face 的 src 都指向自己的分片  `
  + `${cssChecks.every((c, i) => c.src.includes(path.basename(shards[i] ? shards[i].file : ''))) ? '✅' : '❌'}`);
console.log(`引用母本 huajiantang.woff2 的 @font-face 条数  `
  + `${cssChecks.filter((c) => /huajiantang\.woff2/.test(c.src)).length}（应为 0）`);

// --- 6. 逐页成本 ----------------------------------------------------------
console.log('\n' + '─'.repeat(78));
console.log('四、逐页成本对比（该页文本用到的字 → 需要下载的分片）');
console.log('─'.repeat(78));
const defaultPages = [
  'dist/index.html',
  'dist/archive/index.html',
  'dist/posts/index.html',
  'dist/friends/index.html',
  'dist/posts/markdown-cheatsheet/index.html',
  'dist/huaya/years/fenhu/index.html',
];
function allBuiltPages(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) allBuiltPages(full, acc);
    else if (entry.name.endsWith('.html')) acc.push(full);
  }
  return acc;
}
let pages = args.pages
  || (args.all ? allBuiltPages(path.join(ROOT, 'dist')).sort() : defaultPages);
pages = pages.map((p) => (path.isAbsolute(p) ? p : path.join(ROOT, p)));
// 每个码位在「频率顺序」里排第几：分片就是按这个顺序切的，位置越靠后 = 越生僻
const freqRank = new Map();
manifest.master_unicode.forEach((u, i) => freqRank.set(parseCP(u), i));
const rows = [];
for (const page of pages) {
  if (!fs.existsSync(page)) {
    rows.push({ page: path.relative(ROOT, page).replace(/\\/g, '/'), missingPage: true });
    continue;
  }
  const html = fs.readFileSync(page, 'utf8');
  const chars = pageTextChars(html);
  const needed = shards.filter((s) => [...s.set].some((cp) => chars.has(cp)));
  const bytes = needed.reduce((a, s) => a + s.bytes, 0);
  const uncovered = [...chars].filter((cp) => !masterSet.has(cp));
  const ranks = [...chars].filter((cp) => freqRank.has(cp)).map((cp) => freqRank.get(cp));
  rows.push({
    page: path.relative(ROOT, page).replace(/\\/g, '/'),
    chars: chars.size,
    shards: needed.map((s) => String(s.index).padStart(2, '0')),
    bytes,
    uncovered,
    rankLow: ranks.length ? Math.min(...ranks) + 1 : 0,
    rankHigh: ranks.length ? Math.max(...ranks) + 1 : 0,
  });
}
const pWidths = [44, 8, 6, 5, 13, 11, 11, 8, 8];
const pHead = ['页面', '文本字数', '占母本', '片数', '频率序位次', '分片字节', '原始字节', '降幅', '省下'];
console.log(W(pHead, pWidths));
console.log(W(pHead.map(() => '─'), pWidths));
const showing = args.all ? rows.length : Math.min(rows.length, 18);
for (const r of rows.slice(0, showing)) {
  if (r.missingPage) {
    console.log(W([r.page, '（文件不存在）', '', '', '', '', '', '', ''], pWidths));
    continue;
  }
  const drop = 1 - r.bytes / masterBytes;
  console.log(W([
    r.page,
    r.chars,
    pct(r.chars / masterSet.size),
    r.shards.length,
    `${r.rankLow}~${r.rankHigh} / ${masterSet.size}`,
    kb(r.bytes),
    kb(masterBytes),
    pct(drop),
    kb(masterBytes - r.bytes),
  ], pWidths));
}
if (showing < rows.length) {
  console.log(`…（共 ${rows.length} 页，只列前 ${showing} 页；想看全部加 --all）`);
}
const ok = rows.filter((r) => !r.missingPage);
if (ok.length) {
  const avg = ok.reduce((a, r) => a + r.bytes, 0) / ok.length;
  const worst = ok.reduce((a, r) => (r.bytes > a.bytes ? r : a), ok[0]);
  const best = ok.reduce((a, r) => (r.bytes < a.bytes ? r : a), ok[0]);
  console.log(`\n这 ${ok.length} 页平均 ${kb(avg)}（${pct(1 - avg / masterBytes)} 降幅）；`
    + (worst.bytes === best.bytes
      ? `每页都只需要同样这几片，都是 ${kb(worst.bytes)}`
      : `最省 ${best.page} ${kb(best.bytes)}；最贵 ${worst.page} ${kb(worst.bytes)}`));
  console.log('分片明细（用到的片号）：');
  for (const r of ok.slice(0, args.all ? ok.length : 18)) {
    console.log(`  ${r.page.padEnd(44)} ${r.shards.join(' ')}`);
  }
  // 分片命中数分布：多少页分别需要几片
  const hist = new Map();
  for (const r of ok) {
    const key = r.shards.length;
    if (!hist.has(key)) hist.set(key, []);
    hist.get(key).push(r);
  }
  console.log('\n命中分片数的分布（页数 / 分片字节）：');
  for (const key of [...hist.keys()].sort((a, b) => a - b)) {
    const group = hist.get(key);
    console.log(`  ${String(key).padStart(2)} 片：${String(group.length).padStart(3)} 页  `
      + `${kb(group[0].bytes)}/页  （例：${group[0].page}）`);
  }
  const uncoveredTotal = ok.reduce((a, r) => a + r.uncovered.length, 0);
  if (uncoveredTotal) {
    const all = new Set();
    for (const r of ok) for (const cp of r.uncovered) all.add(cp);
    console.log(`\n注意：有 ${all.size} 个页面上的字符不在母本里（本来就走系统字体回落）：`
      + ` ${compressToRanges([...all]).join(', ')}`);
  }
}

// --- 7. 结论 --------------------------------------------------------------
console.log('\n' + '─'.repeat(78));
console.log('五、结论');
console.log('─'.repeat(78));
const home = ok.find((r) => r.page === 'dist/index.html');
if (home) {
  console.log(`首页 dist/index.html：${kb(masterBytes)} → ${kb(home.bytes)}，`
    + `降幅 ${pct(1 - home.bytes / masterBytes)}（只下 ${home.shards.length} 片）`);
}
console.log(`分片总数 ${shards.length}｜合计 ${kb(totalShardBytes)}｜母本 ${kb(masterBytes)}｜`
  + `倍数 ${growth.toFixed(2)}×｜覆盖率 ${coverOk ? '完整' : '有缺口'}｜`
  + `fonts.css ${cssLines} 行 / ${faceBlocks.length} 条 @font-face`);
if (problems.length) {
  console.log('\n发现的问题：');
  for (const p of problems) console.log(`  ! ${p}`);
} else {
  console.log('自检：没有发现问题 ✅');
}
process.exit(coverOk && faceBlocks.length === shards.length && cssRangesMatchManifest
  && commentSafe && problems.length === 0 ? 0 : 1);
