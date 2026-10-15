/*
 * ============================================================================
 * 「近期更新」的数据来源 —— 改成**读 git 的记录**（2026-10-13）
 * ----------------------------------------------------------------------------
 * 群友的原话（站长转述）：
 *   「ssw是不是说的是类似可以直接让他读git的记录，而不是由编辑器操作自动生成」
 * 对 —— 原来那份 `src/data/recent-edits.json` 是**所有人共写的记账表**：
 * 谁在编辑器里保存一次，就往同一份文件里插一条。两个人各改各的页面，也会在同一份
 * 文件里撞车（实测：数组合得上，但顺序会乱；而且"越堆越多"的担心就是从这儿来的）。
 *
 * 现在改成：**页面名写进提交说明，构建时从 git log 读出来**。
 *   · 提交说明是 git 自己的记录 —— 每个人写自己的那一条，**结构上不可能冲突**；
 *   · 站点构建时扫最近 N 个提交，把那段读回来（顺序、去重、封顶都在这儿算）；
 *   · 老那份 recent-edits.json 留着当**种子**（只读、不再写），历史不丢；
 *   · git 不可用（比如浅克隆没历史）也不报错，退化成只有种子。
 *
 * 提交说明里那一段长这样（抬头是一个常量，写和读都用它）：
 *
 *     更新内容 2026-10-13 21:10：页面 / 子版块、导航
 *
 *     改过这些页面：
 *     - /huaya/years/newhuaya 新花娅地
 *     - /iceberg 冰山图
 *
 * ⚠ 写的地方有两处，都必须用 {@link formatPageBlock}：
 *   · 编辑器发布时（tools/editor/server.mjs 把本次会话保存过的页面拼进去）；
 *   · 命令行 / 助手发布时（tools/git/sync.mjs 的 publish 会读本地那份会话记录）。
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');

/** 提交说明里那一段的抬头：写和读都用这一个常量 */
export const PAGE_BLOCK_HEADER = '改过这些页面：';

/** 老数据文件：只当种子读，不再写它 */
export const LEGACY_FILE = path.join(ROOT, 'src', 'data', 'recent-edits.json');

/**
 * 这台机器"这次会话改过哪些页"的**本地**记录（不进仓库，见 .gitignore）。
 * 编辑器每保存一页就往这儿记一笔；发布时把它拼进提交说明、然后清掉。
 * ⚠ 放在本地而不是仓库里，正是为了不再有"大家共写同一份文件"的冲突。
 */
export const SESSION_FILE = path.join(ROOT, 'tools', 'editor', '.editor-edits.json');

/** 读本地那份会话记录（读不到就是空） */
export function readSessionPages() {
  try {
    const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    return Array.isArray(raw?.edits) ? raw.edits : [];
  } catch {
    return [];
  }
}

/** 记一页（同一页只留最新一条，最多 RECENT_MAX 条） */
export function writeSessionPage(page) {
  const href = normHref(page?.href);
  const title = String(page?.title ?? '').trim();
  if (!href.startsWith('/') || !title) return;
  const rest = readSessionPages().filter((e) => normHref(e?.href) !== href);
  const edits = [{ href, title, at: new Date().toISOString() }, ...rest].slice(0, RECENT_MAX);
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.writeFileSync(SESSION_FILE, `${JSON.stringify({ edits }, null, 2)}\n`, 'utf8');
}

/** 发布成功之后清掉（下一轮重新记） */
export function clearSessionPages() {
  try {
    fs.rmSync(SESSION_FILE, { force: true });
  } catch {
    /* 删不掉也不影响发布 */
  }
}

/** 最多留几条（和站点那边一个数） */
export const RECENT_MAX = 40;

/** 一次最多往回翻多少个提交（够用且不至于在大仓库上变慢） */
const SCAN_LIMIT = 120;

/** 地址归一化：只用来判断"同一页" */
const normHref = (v) => String(v || '').trim().replace(/\/+$/, '') || '/';

/**
 * 把「这次改过哪几页」拼成提交说明里的一段。
 * @param {{href?:string,title?:string}[]} pages
 * @returns {string} 没有可用页面时返回空串（调用方别拼一截空抬头）
 */
export function formatPageBlock(pages) {
  const seen = new Set();
  const lines = [];
  for (const p of pages ?? []) {
    const href = normHref(p?.href);
    const title = String(p?.title ?? '').trim();
    if (!href.startsWith('/') || !title) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    /* 一行一页：`- 地址 名字`（地址里不会有空格，名字可以有） */
    lines.push(`- ${href} ${title}`);
  }
  if (!lines.length) return '';
  return `${PAGE_BLOCK_HEADER}\n${lines.join('\n')}`;
}

/**
 * 从一条提交说明里把那一段读回来。
 * 抬头之后、第一个空行之前，所有以 `- ` 开头的行都算。
 * @param {string} message
 * @returns {{href:string,title:string}[]}
 */
export function parsePageBlock(message) {
  const lines = String(message ?? '').split('\n');
  const at = lines.findIndex((l) => l.trim() === PAGE_BLOCK_HEADER);
  if (at < 0) return [];
  const out = [];
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) {
      if (out.length) break;
      continue;
    }
    if (!line.startsWith('- ')) break;
    const rest = line.slice(2).trim();
    const sp = rest.indexOf(' ');
    const href = normHref(sp < 0 ? rest : rest.slice(0, sp));
    const title = sp < 0 ? '' : rest.slice(sp + 1).trim();
    if (href.startsWith('/') && title) out.push({ href, title });
  }
  return out;
}

/** 跑一条 git 命令；失败就返回空串（构建不该因为读不到历史而挂掉） */
function git(args, cwd = ROOT) {
  try {
    return execFileSync('git', args, { windowsHide: true, cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8 * 1024 * 1024 }).trim();
  } catch {
    return '';
  }
}

/**
 * 从 git 记录里推「最近改过哪些页」。
 * @param {{limit?:number, ref?:string, cwd?:string, scan?:number, legacyFile?:string}} [opts]
 *   `cwd` / `scan` / `legacyFile` 是给验收用的（在一次性仓库里量，不碰真仓库）
 * @returns {{href:string,title:string,at:string,time:number,who:string,sha:string,from:'git'|'seed'}[]}
 */
export function recentPages({
  limit = RECENT_MAX,
  ref = 'HEAD',
  cwd = ROOT,
  scan = SCAN_LIMIT,
  legacyFile = LEGACY_FILE,
} = {}) {
  const out = [];
  const raw = git(['log', `-n`, String(scan), `--format=%x1e%H%x1f%aI%x1f%an%x1f%B`, ref], cwd);
  for (const record of raw.split('\x1e')) {
    const text = record.replace(/^\s+/, '');
    if (!text) continue;
    const [sha, at, who, ...bodyParts] = text.split('\x1f');
    const body = bodyParts.join('\x1f');
    for (const p of parsePageBlock(body)) {
      out.push({
        href: p.href,
        title: p.title,
        at: String(at || ''),
        time: Date.parse(String(at || '')) || 0,
        who: String(who || ''),
        sha: String(sha || '').slice(0, 8),
        from: 'git',
      });
    }
  }

  /* 老那份文件当种子：只补 git 里没有的页面（同一个 href 谁新用谁） */
  try {
    const legacy = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
    for (const e of legacy?.edits ?? []) {
      const href = normHref(e?.href);
      const title = String(e?.title ?? '').trim();
      if (!href.startsWith('/') || !title) continue;
      out.push({
        href,
        title,
        at: String(e?.at ?? ''),
        time: Date.parse(String(e?.at ?? '')) || 0,
        who: '',
        sha: '',
        from: 'seed',
      });
    }
  } catch {
    /* 没有种子文件也正常 */
  }

  /* 同一页只留最新的一条，然后按时间倒序、封顶 */
  const best = new Map();
  for (const e of out) {
    const seen = best.get(e.href);
    if (!seen || e.time > seen.time) best.set(e.href, e);
  }
  return [...best.values()].sort((a, b) => b.time - a.time).slice(0, Math.max(1, limit));
}
