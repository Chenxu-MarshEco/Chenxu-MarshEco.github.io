#!/usr/bin/env node
/*
 * ============================================================================
 * 版本 —— 看历史 + 可视化回滚（**只有站长的编辑器会显示这个面板**）
 * ----------------------------------------------------------------------------
 * 用户 2026-10-12 的要求（原话）：
 *   「另外仅有我的编辑器需要加一个方便快捷可视化的版本回滚功能 以保证安全」
 *
 * 为什么协作者不给：回滚是**改动所有人的内容**的操作。协作者本来就有推流权限
 * （用户在 2026-10-07 定的：collaborators 直接推、不用审），但"把别人的东西退回上一版"
 * 这种事不该顺手就能点 —— 编辑器里不摆这个面板，服务端那几条路由也会再挡一道
 * （见 server.mjs 里 requireOwner）。
 *
 * 「回滚」在这里**不是** `git reset`、更不是强推 —— 那两样会把别人的提交直接抹掉。
 * 走的是**往前加一个新提交**：
 *   · 撤销这一次：`git revert --no-commit <sha>` —— 生成一个"把它抵消掉"的提交；
 *   · 回到这一版：`git revert --no-commit <sha>..HEAD` —— 把这一版之后的都抵消掉；
 *   · 只恢复一份数据：`git checkout <sha> -- <文件>` —— 把那份文件变回那一版的样子。
 * 三种都是普通提交，所以**回滚本身也能再回滚**，谁的历史都没被改写。
 *
 * 回滚前后各有一道保险：
 *   · 动手之前：工作区还有没提交的改动就先存成一个提交（「回滚前的现场」），
 *     —— 万一回滚回错了，那一步本身也能退回来；
 *   · 动手之后：由调用方（编辑器）接着跑构建 + 发布上线（先拉后推、永不强推）。
 *
 * 命令行用法：
 *   node tools/git/versions.mjs                       # 最近这些和内容有关的版本
 *   node tools/git/versions.mjs --all                 # 连改代码的提交也列
 *   node tools/git/versions.mjs --detail <sha>        # 这一次到底改了哪些字段
 *   node tools/git/versions.mjs --rollback <sha> --mode to|commit|file [--file 路径]
 *   一律支持 --json（最后多打一行 `[result] {…}`，编辑器服务读它）。
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, pullRemote, conflictedFiles, rebaseInProgress } from './sync.mjs';
import { panelsForFiles, kindOfFiles, activityRef } from './activity.mjs';
import { diffJson } from './merge-json.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

/** 会被算进「内容版本」的种类：站长回滚的一般就是这些，代码提交不列 */
const CONTENT_KINDS = new Set(['content', 'data', 'image', 'audio', 'auto']);

/* ---------------------------------------------------------------- 读历史 */

function readNumstatCommits({ limit = 30, ref = '' } = {}) {
  const useRef = ref || activityRef();
  if (!useRef) return { ref: '', commits: [] };
  const r = git(
    ['log', '-n', String(limit), '--no-renames', '--numstat', '--format=%x1e%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s', useRef],
    { timeout: 40000 },
  );
  if (!r.ok) return { ref: useRef, commits: [] };
  const commits = [];
  for (const chunk of r.out.split('\x1e')) {
    const text = chunk.replace(/^\s+/, '');
    if (!text.trim()) continue;
    const lines = text.split('\n');
    const [sha, short, an, ae, aI, subject] = lines[0].split('\x1f');
    const files = [];
    for (const line of lines.slice(1)) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line.trim());
      if (!m) continue;
      files.push({ path: m[3], add: m[1] === '-' ? null : Number(m[1]), del: m[2] === '-' ? null : Number(m[2]) });
    }
    commits.push({
      sha, short, subject,
      title: String(subject || '').replace(/^更新内容\s*\d{4}-\d{2}-\d{2}(?:\s*\d{2}:\d{2})?\s*[：:]\s*/, '').trim() || String(subject || ''),
      author: { name: an, email: ae },
      iso: aI,
      time: Date.parse(aI) || 0,
      files,
      paths: files.map((f) => f.path),
      panels: panelsForFiles(files.map((f) => f.path)),
      kind: kindOfFiles(files.map((f) => f.path)),
    });
  }
  return { ref: useRef, commits };
}

/**
 * 版本列表（新的在前）。
 * @param {{limit?:number, scope?:'data'|'all', ref?:string}} opts
 */
export function listVersions({ limit = 30, scope = 'data', ref = '' } = {}) {
  // 先多读一些（内容提交中间夹着代码提交 / 存档提交，读太少会不够数）
  const { ref: useRef, commits } = readNumstatCommits({ limit: scope === 'all' ? limit : Math.max(limit * 4, 60), ref });
  const list = [];
  for (const c of commits) {
    if (scope !== 'all' && !CONTENT_KINDS.has(c.kind)) continue;
    const add = c.files.reduce((n, f) => n + (f.add || 0), 0);
    const del = c.files.reduce((n, f) => n + (f.del || 0), 0);
    list.push({ ...c, stat: { files: c.files.length, add, del } });
    if (list.length >= limit) break;
  }
  return { ref: useRef, commits: list, total: commits.length };
}

/** 取某个提交里某份文件的内容（取不到给 null —— 比如那一版还没有这份文件） */
function fileAt(rev, file) {
  const r = git(['show', `${rev}:${file}`], { timeout: 30000 });
  return r.ok ? r.out : null;
}

function hasParent(sha) {
  const r = git(['rev-parse', '--verify', '--quiet', `${sha}^`], { timeout: 10000 });
  return r.ok && Boolean(r.out);
}

/**
 * 这一次到底改了什么 —— 给「版本」面板看的**字段级**摘要。
 * 数据文件（JSON）会算出"哪个字段从什么变成了什么"，其它文件只说增删行数。
 *
 * `maxJson`：最多深入算几份 JSON 的字段差异。一份 JSON 要起两个 git show，
 * 编辑器服务是单线程的 —— 一次提交动十几份数据时（比如整站搬迁），
 * 全算完要一两秒，面板会明显卡一下。超出的那几份退回"只看行数"。
 */
export function versionDetail(sha, { maxJson = 10 } = {}) {
  const id = String(sha || '').trim();
  if (!/^[0-9a-f]{6,40}$/i.test(id)) return { ok: false, error: '这个提交号看起来不对' };
  const meta = git(['show', '-s', '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s', id], { timeout: 20000 });
  if (!meta.ok) return { ok: false, error: `找不到这个提交：${id}` };
  const [full, short, an, ae, aI, subject] = meta.out.split('\x1f');

  const ns = git(['show', '--numstat', '--format=', id], { timeout: 40000 });
  const files = [];
  const parent = hasParent(full) ? `${full}^` : null;
  let jsonDone = 0;
  for (const line of (ns.ok ? ns.out : '').split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line.trim());
    if (!m) continue;
    const file = m[3];
    const item = {
      file,
      add: m[1] === '-' ? null : Number(m[1]),
      del: m[2] === '-' ? null : Number(m[2]),
      panel: panelsForFiles([file])[0] || '其它',
      kind: kindOfFiles([file]),
      changes: [],
      note: '',
    };
    if (/\.json$/i.test(file) && jsonDone < maxJson) {
      jsonDone++;
      const after = fileAt(full, file);
      const before = parent ? fileAt(parent, file) : null;
      if (after === null) {
        item.note = '这一版里这份数据被删掉了';
      } else {
        try {
          const a = JSON.parse(after);
          const b = before === null ? null : JSON.parse(before);
          item.changes = b === null
            ? diffJson(null, a, { limit: 40 }).map((c) => ({ ...c, path: c.path === '(根)' ? '(整份数据)' : c.path }))
            : diffJson(b, a, { limit: 40 });
          if (before === null) item.note = '这一版里这份数据是新建的';
        } catch {
          item.note = '内容不是合法的 JSON，只能看行数变化';
        }
      }
    }
    files.push(item);
  }
  return {
    ok: true,
    sha: full,
    short,
    subject,
    title: String(subject || '').replace(/^更新内容\s*\d{4}-\d{2}-\d{2}(?:\s*\d{2}:\d{2})?\s*[：:]\s*/, '').trim() || String(subject || ''),
    author: { name: an, email: ae },
    iso: aI,
    time: Date.parse(aI) || 0,
    panels: panelsForFiles(files.map((f) => f.file)),
    files,
  };
}

/* ---------------------------------------------------------------- 回滚 */

/** 现在工作区干净吗（回滚前要看一眼） */
function status() {
  const r = git(['status', '--porcelain'], { timeout: 20000 });
  return r.ok ? r.out.split('\n').map((s) => s.trim()).filter(Boolean) : [];
}

function commitAllSafe(message, log) {
  const add = git(['add', '-A'], { timeout: 120000 });
  if (!add.ok) return { ok: false, err: add.err };
  /*
    ⚠ 提交说明走 stdin（`-F -`）而不是 `-m 中文`：这条路上要过 Windows 的命令行参数，
    中文说明用参数传偶尔会变成乱码，stdin 送过去一个字节都不会变形（sync.mjs 里同理）。
  */
  const c = git(['commit', '-F', '-'], { timeout: 120000, input: `${message}\n` });
  if (!c.ok) {
    if (/nothing to commit|无文件要提交|nothing added/i.test(`${c.out}${c.err}`)) return { ok: true, nothing: true };
    return { ok: false, err: c.err || c.out };
  }
  log(`   先把现在的样子存了一份：${message}`);
  return { ok: true };
}

/**
 * 回滚。
 * @param {{sha:string, mode?:'to'|'commit'|'file', file?:string, log?:Function, stashDirty?:boolean}} opts
 * @returns {{ok:boolean, changed?:string[], message?:string, error?:string}}
 */
export function rollback({ sha, mode = 'to', file = '', log = () => {}, stashDirty = true } = {}) {
  const id = String(sha || '').trim();
  if (!/^[0-9a-f]{6,40}$/i.test(id)) return { ok: false, error: '这个提交号看起来不对' };
  if (rebaseInProgress()) return { ok: false, error: '仓库正卡在一次合并里，先在编辑器里点一次「发布上线」把它走完，再回滚' };
  if (conflictedFiles().length) return { ok: false, error: '还有没解决的冲突文件，先处理掉再回滚' };

  const exists = git(['rev-parse', '--verify', '--quiet', `${id}^{commit}`], { timeout: 10000 });
  if (!exists.ok) return { ok: false, error: `找不到这个提交：${id}` };
  const full = exists.out;

  /*
    回滚前先把现场存下来（有没提交的改动时）。
    这样"回滚错了"也能原路退回来 —— 它自己也变成了历史里的一个版本。
  */
  const dirty = status();
  if (dirty.length) {
    if (!stashDirty) return { ok: false, error: `还有 ${dirty.length} 份文件没提交，先「发布上线」再回滚` };
    const saved = commitAllSafe(`回滚前的现场（北京时间 ${beijingNow()}）`, log);
    if (!saved.ok) return { ok: false, error: `存现场没成功：${saved.err}` };
  }

  /* 本地得先和远端对齐：revert 只能作用于本地的历史 */
  const pull = pullRemote({ log });
  if (pull.code === 'ahead' || pull.code === 'blocked') {
    return { ok: false, error: '本地还有没发布的提交（或远端动过你改过的文件）—— 先点一次「发布上线」，再回滚' };
  }
  if (pull.code !== 'ok') {
    return { ok: false, error: `回滚前没能和远端对齐（${pull.code}）：${pull.err || ''}`.trim() };
  }

  let out = '';
  if (mode === 'file') {
    const target = String(file || '').trim().replace(/\\/g, '/');
    if (!target || target.includes('..')) return { ok: false, error: '要恢复哪一份文件？' };
    /* 只允许恢复**仓库里已经有的**那份文件（防止拼出仓库外的路径） */
    const known = git(['ls-tree', '-r', '--name-only', full], { timeout: 40000 });
    const list = known.ok ? known.out.split('\n').map((s) => s.trim()) : [];
    if (!list.includes(target)) return { ok: false, error: `这一版里没有这份文件：${target}` };
    const r = git(['checkout', full, '--', target], { timeout: 60000 });
    out = r.err || r.out;
    if (!r.ok) return { ok: false, error: `恢复没成功：${out.slice(0, 300)}` };
    log(`   已经把 ${target} 恢复成 ${full.slice(0, 7)} 那一版的样子。`);
  } else {
    const args = ['revert', '--no-commit'];
    if (mode === 'to') args.push(`${full}..HEAD`);
    else args.push(full);
    const r = git(args, { timeout: 180000 });
    out = `${r.out}\n${r.err}`;
    if (!r.ok) {
      /*
        撞车（比如这一版之后有人又改过同一处）就整个撤回：
        宁可什么都没做，也不要留下半份回滚。
      */
      const seq = fs.existsSync(path.join(ROOT, '.git', 'sequencer')) || fs.existsSync(path.join(ROOT, '.git', 'REVERT_HEAD'));
      if (seq) git(['revert', '--abort'], { timeout: 60000 });
      return { ok: false, error: `这一步撤不掉（多半是这一版之后又有人改了同一处数据）：\n${out.slice(-400)}` };
    }
    log(mode === 'to'
      ? `   已经把内容恢复到 ${full.slice(0, 7)} 那一版（之后那些改动都抵消掉了，历史本身没被改写）。`
      : `   已经抵消掉 ${full.slice(0, 7)} 这一次的改动。`);
  }

  const changed = git(['diff', '--name-only', '--cached'], { timeout: 20000 });
  const list = changed.ok ? changed.out.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  return { ok: true, changed: list, panels: panelsForFiles(list), message: mode === 'file' ? `已恢复 ${file}` : '已回滚' };
}

/** 北京时间（这个仓库里所有给人看的时间都用它） */
function beijingNow() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** 自己量自己：这份文件里有没有出现过"会把别人抹掉"的操作（验收脚本也量一遍） */

/* ---------------------------------------------------------------- 命令行 */

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const flag = (n) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? (argv[i + 1] ?? '') : '';
  };
  const mark = (o) => { if (asJson) console.log(`[result] ${JSON.stringify(o)}`); };
  const say = (s = '') => { if (!asJson) console.log(s); };

  const detailOf = flag('detail');
  const rollbackOf = flag('rollback');

  if (detailOf) {
    const d = versionDetail(detailOf);
    if (!asJson) {
      if (!d.ok) say(`  ${d.error}`);
      else {
        say('');
        say(`  ${d.short}  ${d.iso?.replace('T', ' ').slice(0, 16)}  ${d.author.name}  ${d.title}`);
        for (const f of d.files) {
          say(`   · ${f.file}（${f.panel}）  +${f.add ?? '—'} / -${f.del ?? '—'}${f.note ? `  ${f.note}` : ''}`);
          for (const c of f.changes.slice(0, 12)) say(`       ${c.path}：${c.before} → ${c.after}`);
        }
        say('');
      }
    }
    mark(d);
    process.exitCode = d.ok ? 0 : 1;
    return;
  }

  if (rollbackOf) {
    const mode = flag('mode') || 'to';
    const r = rollback({ sha: rollbackOf, mode, file: flag('file'), log: say });
    if (!asJson) say(r.ok ? `\n  ${r.message}：${(r.changed || []).join('、') || '（没有文件变化）'}\n` : `\n  ✗ ${r.error}\n`);
    mark(r);
    process.exitCode = r.ok ? 0 : 1;
    return;
  }

  const li = argv.indexOf('--limit');
  const { ref, commits } = listVersions({
    limit: li >= 0 ? Math.max(1, Math.min(200, Number(argv[li + 1]) || 30)) : 30,
    scope: argv.includes('--all') ? 'all' : 'data',
  });
  if (!asJson) {
    say('');
    say(`  ======== 版本（${ref}）========`);
    for (const c of commits) {
      const when = c.iso ? c.iso.replace('T', ' ').slice(0, 16) : '';
      say(`  ${c.short}  ${when}  ${c.author.name}  ${c.panels.join('、') || '（没列）'}  +${c.stat.add}/-${c.stat.del}`);
      if (c.title) say(`      ${c.title}`);
    }
    say('  ==============================');
    say('');
  }
  mark({ ref, commits });
  process.exitCode = 0;
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();
