#!/usr/bin/env node
/**
 * 安全推流 —— 「先拉后推、永不强推」这一套，两个启动器共用同一份实现。
 *
 * 为什么要有这个文件（2026-10-05）：
 * 站点的内容不止一个人改。另一位（SSW）会往仓库里推文章，接入的机器人也会定时
 * 往里写稿子（写完归到「铃忆的冰室日记」那类页面下）。大家一起改同一个仓库时，
 * 唯一会把别人的东西抹掉的操作就是**强制推送**（`git push -f`）。
 *
 * 当时的两个启动器（tools/menu.mjs / tools/studio/studio.py）都是
 * 「add -A → commit → push」，中间**没有拉取**。别人先推了的话，我们这边
 * 必然被拒绝；而报错文案写的是「代理掉了 / 没登录 GitHub / 缺 workflow 权限」——
 * 三句里没有一句是真正的原因（远端有你没有的提交）。用户照着这个提示怎么试都
 * 推不上去，下一步就会去搜「Git 如何强制推送」——那正好是唯一会覆盖别人的红线。
 *
 * 所以这里把流程固定成（和群友说的一模一样）：
 *   1. 先探一下能不能连上 GitHub（连不上就别推到一半才炸）
 *   2. 把本地改动提交
 *   3. **先拉取**（`git pull --rebase --autostash`）—— 不同文件 / 同一文件不同行
 *      由 git 自己并行合并，谁的改动都不会丢
 *   4. 万一撞在同一行：停下来、把冲突文件列出来、把仓库恢复原状，**不推送**
 *   5. 最后才推；被拒绝也**不是**灾难 —— 那是 git 在保护对方的提交，
 *      我们再拉一次重推一遍就好
 *
 * 「永远不用 -f」不是靠自觉，是靠下面 assertNoForce() 把强推参数直接挡掉，
 * 验收脚本（tools/checks/git-sync-check.mjs）每次都会量这条。
 *
 * 命令行用法（studio.py 就是调这个，两边逻辑同一份）：
 *   node tools/git/sync.mjs status                     # 只看状态（不联网）
 *   node tools/git/sync.mjs sync                       # 开始干活前先拉一下
 *   node tools/git/sync.mjs pull                       # 只快进拉取（编辑器那个按钮用）
 *   node tools/git/sync.mjs publish --message "说明"   # 提交 + 先拉 + 推送
 *   （加 --json 会多打一行 `[result] {…}`，给编辑器服务读机读结果）
 *
 * 退出码：0 成功 / 2 拉取时冲突或本地改动挡住（已中止，什么都没推）/ 3 推送被拒
 *        或本地还有没发布的提交 / 4 连不上 GitHub / 5 没有远端 / 1 其它错误
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const CODES = {
  ok: 0,
  nothing: 0,
  error: 1,
  conflict: 2,
  blocked: 2,
  rejected: 3,
  ahead: 3,
  offline: 4,
  noremote: 5,
  nogit: 5,
};

/*
  ⚠ 强推黑名单。`+` 开头的 refspec（`git push origin +main`）也是强推，
  `--mirror` 一样会把远端抹成和本地一模一样，所以一并挡掉。
*/
const FORCE_FLAGS = new Set(['-f', '--force', '--force-with-lease', '--mirror', '--delete']);

export function assertNoForce(args) {
  const list = (args || []).map((a) => String(a));
  for (const a of list) {
    if (FORCE_FLAGS.has(a)) throw new Error(`安全推流永远不允许 ${a}`);
    if (a.startsWith('+')) throw new Error(`安全推流永远不允许强推 refspec（${a}）`);
  }
  return true;
}

/*
  ⚠ 代理是死的、网络其实是通的 —— 本机最常见的失败就是这个（2026-10-06 修）。

  这个仓库的 git config 里写着 `http.proxy = http://127.0.0.1:7890`。Clash 一关，
  git 就会一直去敲那个没人接的端口，报一句
    fatal: unable to access '…': Failed to connect to github.com:443 over proxy 127.0.0.1
  于是「拉远端」看起来像是连不上 GitHub —— 可这时候**直连往往是好的**（实测直接
  fetch 一次就下来了）。用户要的是「能拉到东西」，不是「先去把代理打开」。

  所以：第一次撞上这种错，就临时摘掉代理重试一次，并在本进程里记住。
  用 `-c http.proxy=`（空字符串 = 这次调用不算代理），**不动用户的 git config**。
*/
let proxyDisabled = false;

/** 这条报错像不像「被代理挡住了」（连不上代理端口，而不是 GitHub 本身不通） */
export function isProxyTrouble(text) {
  const e = String(text || '');
  return /over proxy/i.test(e)
    || (/proxy/i.test(e) && /(failed to connect|could not connect|connection refused|refused|timed out)/i.test(e));
}

/** 值不值得摘掉代理再试一次：代理死掉、以及各种网络层报错都算 */
function worthDirectRetry(text) {
  if (isProxyTrouble(text)) return true;
  return /could not resolve host|unable to access|connection (timed out|refused|reset)|failed to connect|network is unreachable|operation timed out|empty reply from server/i.test(String(text || ''));
}

/** 现在走的是哪条路：跟着 git config（默认）/ 已经改成直连 */
export function routeInfo() {
  return { direct: proxyDisabled };
}

function gitPrefix() {
  const p = ['-c', 'core.quotepath=false', '--no-pager'];
  if (proxyDisabled) p.push('-c', 'http.proxy=', '-c', 'https.proxy=');
  return p;
}

function gitOnce(prefix, args, { cwd, timeout, input }) {
  try {
    const out = execFileSync('git', [...prefix, ...args], {
      cwd,
      timeout,
      encoding: 'utf8',
      input: input ?? undefined,
      stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      /*
        GIT_TERMINAL_PROMPT=0：凭据不对时**立刻失败**，不要在后台永远等着
        一个没人能回答的密码提示（pythonw 拉起来的窗口里尤其看不见它）。
        图形化的凭据管理器（GCM）不受这个影响，该弹的窗口还是会弹。
      */
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return { ok: true, out: String(out).replace(/\s+$/, ''), err: '' };
  } catch (err) {
    const e = String(err.stderr ?? '') || String(err.message ?? err);
    return { ok: false, out: String(err.stdout ?? '').replace(/\s+$/, ''), err: e.trim() };
  }
}

/** 跑一条 git 命令，输出抓成字符串（**不抛异常**，把结果交给调用方判断） */
export function git(args, { cwd = ROOT, timeout = 30000, input = null } = {}) {
  const first = gitOnce(gitPrefix(), args, { cwd, timeout, input });
  if (first.ok || proxyDisabled || !worthDirectRetry(first.err)) return first;

  // 只重试一次；成了就把「直连」记下来，后面每条命令都直接走直连
  proxyDisabled = true;
  const second = gitOnce(gitPrefix(), args, { cwd, timeout, input });
  return second.ok ? { ...second, direct: true } : second;
}

// ---------------------------------------------------------------- 状态

export function hasGit() {
  return git(['--version'], { timeout: 8000 }).ok;
}

export function remoteUrl() {
  const r = git(['remote', 'get-url', 'origin'], { timeout: 8000 });
  return r.ok && r.out ? r.out : null;
}

export function branch() {
  const r = git(['rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 8000 });
  return r.ok && r.out && r.out !== 'HEAD' ? r.out : null;
}

export function upstream() {
  const r = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { timeout: 8000 });
  return r.ok && r.out ? r.out : null;
}

export function dirty() {
  const r = git(['status', '--porcelain'], { timeout: 15000 });
  return r.ok ? r.out.trim().length > 0 : false;
}

/**
 * 本地和远端各差几个提交。
 * `git rev-list --left-right --count @{u}...HEAD` 的输出是 `落后\t领先`。
 * ⚠ 只有在 fetch 过之后这个数才准 —— 想拿最新的，先调 fetchRemote()。
 */
export function counts() {
  const up = upstream();
  if (!up) return { ok: false, upstream: null, behind: 0, ahead: 0 };
  const r = git(['rev-list', '--left-right', '--count', `${up}...HEAD`], { timeout: 15000 });
  if (!r.ok) return { ok: false, upstream: up, behind: 0, ahead: 0 };
  const [behind, ahead] = r.out.split(/\s+/).map((n) => Number.parseInt(n, 10) || 0);
  return { ok: true, upstream: up, behind, ahead };
}

export function fetchRemote({ timeout = 60000 } = {}) {
  const r = git(['fetch', '--quiet', 'origin'], { timeout });
  return r.ok ? { ok: true } : { ok: false, err: r.err };
}

// ---------------------------------------------------------------- 拉取

/** rebase 卡在冲突里时，把「哪几个文件撞了」列出来 */
export function conflictedFiles() {
  const r = git(['diff', '--name-only', '--diff-filter=U'], { timeout: 15000 });
  return r.ok ? r.out.split('\n').map((s) => s.trim()).filter(Boolean) : [];
}

export function rebaseInProgress() {
  return existsSync(path.join(ROOT, '.git', 'rebase-merge'))
    || existsSync(path.join(ROOT, '.git', 'rebase-apply'));
}

/**
 * 先拉后推的那一步：`git pull --rebase --autostash`。
 *
 * 用 rebase 而不是默认的 merge：本地提交会被「接在」对方提交后面，历史是一条直线，
 * 不会每拉一次就多出一个没人看得懂的合并提交。
 * `--autostash` 让工作区还有没提交的改动时也能拉（改动会临时收起来、拉完自动放回）。
 *
 * ⚠ 撞在同一行时 git 会停下来插冲突标记。这时候**绝不能**硬着头皮推：
 * 我们先把冲突文件名记下来，然后 `git rebase --abort` 把仓库恢复成拉取之前的样子
 * （本地提交、未提交的改动、autostash 里的东西原封不动地回来），再由上层告诉用户
 * 是哪几个文件撞了 —— 谁的内容都没丢，只是需要人来决定怎么合。
 */
export function pullRebase({ log = () => {}, timeout = 120000 } = {}) {
  log('   正在先拉取远端的改动…');
  const r = git(['pull', '--rebase', '--autostash'], { timeout });
  if (r.ok) {
    if (/up to date|已经是最新|最新/.test(r.out)) log('   远端没有新东西，本地已经是最新。');
    else log('   拉取完成（不同文件 / 不同行的改动由 git 自动合在一起了）。');
    return { ok: true };
  }

  const files = conflictedFiles();
  const inRebase = rebaseInProgress();
  if (inRebase) {
    const abort = git(['rebase', '--abort'], { timeout: 60000 });
    log(abort.ok
      ? '   已经把这个合并动作安全撤回了（你本地的提交和改动都还在）。'
      : `   撤回时出了点问题：${abort.err.slice(0, 200)}`);
  }
  return { ok: false, conflict: inRebase || files.length > 0, files, err: r.err };
}

// ---------------------------------------------------------------- 推送

/** 认一认推送失败到底是哪一种 —— 报错文案要对得上真正的原因 */
export function classifyPush(err) {
  const e = String(err || '');
  if (/non-fast-forward|fetch first|remote contains work|\[rejected\]/i.test(e)) return 'rejected';
  if (/could not resolve host|unable to access|connection (timed out|refused|reset)|Failed to connect|proxy/i.test(e)) return 'offline';
  if (/Authentication failed|could not read Username|Permission denied|403|401/i.test(e)) return 'auth';
  if (/no upstream branch|has no upstream/i.test(e)) return 'no-upstream';
  return 'other';
}

export function push({ log = () => {}, timeout = 180000, setUpstream = false } = {}) {
  const br = branch();
  const args = setUpstream && br ? ['push', '-u', 'origin', br] : ['push'];
  // 这里就是那条红线：参数在真正执行前先过一遍黑名单
  assertNoForce(args);
  const r = git(args, { timeout });
  if (r.ok) return { ok: true, out: r.out };
  return { ok: false, kind: classifyPush(r.err), err: r.err, out: r.out };
}

// ---------------------------------------------------------------- 组合流程

function commitAll(message, log) {
  const add = git(['add', '-A'], { timeout: 120000 });
  if (!add.ok) return { ok: false, err: add.err };

  const changed = git(['status', '--short'], { timeout: 30000 });
  const list = changed.ok ? changed.out : '';
  if (!list.trim()) return { ok: true, nothing: true };

  log('   这次要提交的文件：');
  for (const l of list.split('\n')) log(`     ${l}`);

  const c = git(['commit', '-F', '-'], { timeout: 120000, input: `${message}\n` });
  if (!c.ok) return { ok: false, err: c.err };
  const first = (c.out.split('\n').find((l) => /file|文件/.test(l)) ?? '').trim();
  log(first ? `   已提交  ${first}` : '   已提交。');
  return { ok: true };
}

/** 能不能连上远端 —— 别等推到一半才报错 */
export function probeRemote({ timeout = 40000 } = {}) {
  const r = git(['ls-remote', '--heads', 'origin'], { timeout });
  return r.ok ? { ok: true } : { ok: false, err: r.err };
}

/**
 * 发布上线：提交 + 先拉 + 推送。全流程只在这里，两个启动器都调它。
 *
 * 返回 { code, ... }，code 见文件头的退出码表；`log(text)` 每走一步都被叫一次，
 * 命令行版直接打印，图形启动器把它streaming到日志区。
 */
export function publish({ message, log = () => {} } = {}) {
  if (!hasGit()) return { code: 'nogit' };
  const remote = remoteUrl();
  if (!remote) return { code: 'noremote' };
  const up = upstream();

  log('   正在检查能否连上 GitHub…');
  const probe = probeRemote();
  if (!probe.ok) return { code: 'offline', err: probe.err };
  log('   连接正常。');

  const committed = commitAll(String(message || '更新内容'), log);
  if (!committed.ok) return { code: 'error', err: committed.err };
  if (committed.nothing) {
    /*
      ⚠ 工作区干净 ≠ 没东西要发（2026-10-05 修）。
      冲突中止之后、或者你自己在命令行里 commit 过之后，本地会有**已经提交但还没推
      出去**的提交。以前这里直接回一句「没有任何改动，不用发布」就结束了 ——
      那次发布其实什么都没干，而用户以为自己发出去了。
      所以再看一眼「本地领先远端几个提交」：领先就继续走拉取 + 推送。
    */
    fetchRemote();
    const c = counts();
    if (!c.ok || (c.ahead === 0 && c.behind === 0)) return { code: 'nothing' };
    log(`   没有新写的改动，但本地还有 ${c.ahead} 个提交没推出去，继续。`);
  }

  /*
    第一次拉取：本地已经有提交了，工作区是干净的。
    这一步就是群友说的「先拉后推」，也是以前两个启动器漏掉的那一步。
  */
  if (up) {
    const pull = pullRebase({ log });
    if (!pull.ok) return { code: 'conflict', files: pull.files, err: pull.err };
  } else {
    log('   本地分支还没和远端关联过，这次会顺便关联上。');
  }

  log('   正在推送到 GitHub…');
  let res = push({ log, setUpstream: !up });

  if (!res.ok && res.kind === 'rejected') {
    /*
      被拒绝 ≠ 出事。它是 git 在说「远端还有你没见过的提交，我不让你覆盖」。
      再拉一次、把对方的提交接到本地提交前面，然后重推一遍。
    */
    log('');
    log('   推送被拒了 —— 这是好事：说明远端的别人刚推了东西，git 在拦着不让覆盖。');
    log('   现在再拉一次，把对方的内容合进来再推。');
    const pull2 = pullRebase({ log });
    if (!pull2.ok) return { code: 'conflict', files: pull2.files, err: pull2.err, retried: true };
    log('   再推一次…');
    res = push({ log, setUpstream: false });
    if (res.ok) return { code: 'ok', merged: true };
  }

  if (res.ok) return { code: 'ok' };
  if (res.kind === 'offline') return { code: 'offline', err: res.err };
  if (res.kind === 'no-upstream') {
    /* 分支还没关联过（第一次推）：关联上再推一次，这不是失败 */
    const retry = push({ log, setUpstream: true });
    if (retry.ok) return { code: 'ok' };
    return { code: 'rejected', kind: retry.kind, err: retry.err };
  }
  return { code: 'rejected', kind: res.kind, err: res.err };
}

/**
 * 开始干活前先拉一下（群友那句「每次开始做东西的时候都拉取一下」）。
 *
 * 远端有新东西时：
 *   · 工作区干净 → 直接快进拉下来，本地就是最新的
 *   · 工作区还有没发布的改动 → **不擅自拉**（避免在自己没提交的改动上做 rebase），
 *     提示先「发布上线」——发布那条路会先拉再推，一样安全
 * 冲突时中止并返回文件清单，什么都不改。
 */
export function sync({ log = () => {}, quiet = false } = {}) {
  if (!hasGit()) return { code: 'nogit' };
  if (!remoteUrl()) return { code: 'noremote' };
  if (!upstream()) return { code: 'ok', fresh: true };

  const f = fetchRemote();
  if (!f.ok) return { code: 'offline', err: f.err };

  const c = counts();
  if (!c.ok || c.behind === 0) {
    if (!quiet) log(`   本地已经是最新的${c.ahead ? `（本地还有 ${c.ahead} 个提交没发出去）` : ''}。`);
    return { code: 'ok', behind: 0, ahead: c.ahead };
  }

  if (dirty()) {
    log(`   远端有 ${c.behind} 个新提交，但你本地还有没发布的改动，先不擅自合并。`);
    log('   写完之后选「发布上线」，那一步会先拉取再推送，不会覆盖别人。');
    return { code: 'ok', skipped: true, behind: c.behind };
  }

  log(`   远端有 ${c.behind} 个新提交，正在拉下来…`);
  const pull = pullRebase({ log });
  if (!pull.ok) return { code: 'conflict', files: pull.files, err: pull.err };
  return { code: 'ok', pulled: c.behind };
}

/**
 * 编辑器里那个「拉远端」按钮走的这条（2026-10-05 加）。
 *
 * 和 sync() 的区别在**工作区通常是脏的**：你在编辑器里保存过东西，那些改动还没提交。
 * 这时候如果用 rebase + autostash，撞上同一行会在工作区里留下冲突标记 ——
 * 对着一整屏编辑器内容手动清 `<<<<<<<` 太难受了。所以这里只做**快进**：
 *
 *   · `git pull --ff-only` 不产生合并提交，也不会留冲突标记；
 *   · 万一远端动的那几个文件正好你本地也改过还没提交，git 会**拒绝**，
 *     并且一个字节都不动（`Your local changes … would be overwritten`）——
 *     这正是我们要的：拦下来，让人先去「发布上线」把改动提交上去；
 *   · 本地有没推出去的提交时这里也不 rebase（同样交给「发布上线」，那条路
 *     提交完再拉，撞车了有完整的"列文件 + 恢复原状"处理）。
 *
 * 返回 code：ok（含 uptodate / pulled 两个数）/ ahead / blocked / offline /
 *           noremote / nogit / error
 */
export function pullRemote({ log = () => {} } = {}) {
  if (!hasGit()) return { code: 'nogit' };
  if (!remoteUrl()) return { code: 'noremote' };
  if (!upstream()) return { code: 'ok', fresh: true, pulled: 0 };

  const f = fetchRemote();
  if (!f.ok) return { code: 'offline', err: f.err };

  const c = counts();
  if (!c.ok) return { code: 'error', err: '读不出本地和远端的差距' };
  if (c.behind === 0) {
    log('   远端没有新东西，本地已经是最新的。');
    return { code: 'ok', uptodate: true, pulled: 0, behind: 0, ahead: c.ahead };
  }
  if (c.ahead > 0) {
    log(`   远端有 ${c.behind} 个提交，你本地还有 ${c.ahead} 个没发布。`);
    return { code: 'ahead', behind: c.behind, ahead: c.ahead };
  }

  log(`   远端有 ${c.behind} 个提交，正在快进拉取…`);
  const r = git(['pull', '--ff-only'], { timeout: 120000 });
  if (r.ok) {
    log('   拉取完成。');
    return { code: 'ok', pulled: c.behind, behind: c.behind };
  }
  const files = blockedFiles(r.err);
  return {
    code: files.length ? 'blocked' : 'error',
    behind: c.behind,
    files,
    err: r.err,
  };
}

/**
 * `git pull` 被本地改动挡住时，stderr 里会把这些文件列出来：
 *   error: Your local changes to the following files would be overwritten by merge:
 *           src/content/posts/hello.md
 *   Please commit your changes or stash them before you merge.
 * 把这些文件名摘出来告诉用户「是这几份挡住了」。
 */
function blockedFiles(err) {
  const lines = String(err || '').split('\n');
  const at = lines.findIndex((l) => /would be overwritten/i.test(l));
  if (at < 0) return [];
  const out = [];
  for (let i = at + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || /^(Please|Aborting|error:|fatal:)/i.test(t)) break;
    out.push(t);
  }
  return out;
}

/**
 * 菜单/状态栏用：不联网，只读本地记录。
 * `light: true` 时跳过分支名 / 工作区那些**菜单用不到**的字段 —— 画一次菜单
 * 就要起好几个 git 子进程，Windows 上一个二三十毫秒，能省则省。
 */
export function status({ light = false } = {}) {
  const remote = remoteUrl();
  const c = counts();
  return {
    git: light ? null : hasGit(),
    remote,
    branch: light ? null : branch(),
    upstream: c.upstream,
    behind: c.behind,
    ahead: c.ahead,
    dirty: light ? null : dirty(),
  };
}

// ---------------------------------------------------------------- 命令行

function usage() {
  return [
    '用法：',
    '  node tools/git/sync.mjs status                    看状态（不联网）',
    '  node tools/git/sync.mjs fetch                     只探一次远端（更新「差几个提交」）',
    '  node tools/git/sync.mjs sync                      开始干活前先拉一下',
    '  node tools/git/sync.mjs pull                      只快进拉取（编辑器那个按钮用）',
    '  node tools/git/sync.mjs publish --message "说明"  提交 + 先拉 + 推送',
    '',
    '加 --json 会在最后多打一行 `[result] {…}`（给编辑器服务读的机读结果）。',
  ].join('\n');
}

/** 把一次结果翻译成给人看的话（命令行和图形启动器共用） */
export function explain(res = {}) {
  const base = explainBase(res);
  /*
    代理是死的、直连成功时，顺口说一句 —— 否则用户会以为「必须开着 Clash 才能拉」，
    下次代理又关着的时候就不敢点这个按钮了。
  */
  if (res.direct && res.code === 'ok') {
    return `${base}\n   （这次代理没通，是自动改用直连拉到的，不用为了拉取去开 Clash。）`;
  }
  return base;
}

function explainBase(res = {}) {
  const { code, kind, files = [], err } = res;
  const list = files.map((f) => `     ${f}`).join('\n');
  switch (code) {
    case 'ok':
      if (res.uptodate) return '远端没有新东西，本地已经是最新的。';
      if (res.pulled > 0) return `已拉取 ${res.pulled} 个提交 —— 别人的新内容已经在本机了。`;
      return res.merged
        ? '推送成功！别人刚推的内容已经合进来了，谁的东西都没丢。'
        : '推送成功！';
    case 'ahead':
      return `本地还有 ${res.ahead} 个提交没发布，这时候直接拉容易把没提交的改动搅乱。\n`
        + '   先点一次「发布上线」——它会把改动提交上去、先拉取、再推送，一条路走完。';
    case 'blocked':
      return `远端有 ${res.behind} 个提交，但其中动了你本地也改过、还没发布的这几份文件：\n`
        + (list ? `${list}\n` : '')
        + '   为了不覆盖你的改动，这次**一个字节都没拉**，你本地的东西完好。\n'
        + '   先点「发布上线」把它们提交上去 —— 发布会自动先拉取再推送。';
    case 'nothing':
      return '没有任何改动，不用发布。';
    case 'offline':
      return '连不上 GitHub —— 代理和直连都试过了。\n'
        + '   1. 开着 Clash Verge 的话，看看「系统代理」开关是不是打开的、节点还能不能用；\n'
        + '   2. 代理没开也没关系：发现代理连不上时程序会自动改用直连重试一次，\n'
        + '      所以报到这一句，一般是网络本身也不通了（先用浏览器随便打开个网页看看）；\n'
        + '   然后重试。';
    case 'noremote':
      return '这个仓库还没连到 GitHub（没有 origin），请先做「首次设置」。';
    case 'nogit':
      return '没有找到 git，没办法发布。';
    case 'conflict':
      return '拉取的时候撞上了：你和别人改了同一个文件的同一处。\n'
        + (list ? `   撞在一起的文件：\n${list}\n` : '')
        + '   为了不覆盖对方的内容，这次没有推送，仓库也已经恢复成拉取之前的样子 ——\n'
        + '   你本地的改动一个都没丢，对方的提交也原封不动。\n'
        + '   这种情况需要人来决定怎么合：把上面这几个文件发给另一位（或我），\n'
        + '   挑一个版本、或者两边的内容拼在一起，然后再发布一次。';
    case 'rejected':
      if (kind === 'auth') {
        return '推送被拒：GitHub 那边的登录失效了。\n'
          + '   在这个文件夹里跑一次 gh auth login（或 gh auth refresh -s workflow）再试。';
      }
      if (kind === 'offline') {
        return '推送时连不上 GitHub（多半是代理掉了，重开 Clash Verge 再试）。';
      }
      return '推送还是被拒了：远端在这期间又有了新提交。\n'
        + '   ⚠ 绝对不要去搜「Git 强制推送」—— 那会把对方刚推上去的文章直接抹掉。\n'
        + '   稍等一下再点一次「发布上线」通常就好了（每次发布都会先拉取）。';
    default:
      return `发布失败：\n   ${String(err || '').split('\n').slice(0, 6).join('\n   ')}`;
  }
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const quiet = argv.includes('--quiet');
  const asJson = argv.includes('--json');
  const mi = argv.indexOf('--message');
  const message = mi >= 0 ? argv[mi + 1] : '更新内容';
  const say = (t = '') => { if (!quiet) console.log(t); };
  /*
    机读结果：编辑器服务是拿子进程调这个脚本的（fetch 慢起来几秒，不能同步跑在
    服务进程里），它要的是结构化的 code / files。所以约定在日志之后多打一行
    `[result] {…}` —— 日志照旧给人看，机器只取最后那一行。
  */
  const mark = (obj) => {
    if (!asJson) return;
    // 机读结果带上「这次是不是直连成功的」，编辑器拿它给用户一句解释
    const payload = proxyDisabled && obj && typeof obj === 'object' ? { ...obj, direct: true } : obj;
    console.log(`[result] ${JSON.stringify(payload)}`);
  };

  /*
    ⚠ 这里一律用 process.exitCode，不用 process.exit()：
    图形启动器（studio.py）是用管道接这个命令的输出的，而 stdout 接到管道时
    写入是异步的 —— `process.exit()` 会直接掐掉还没刷出去的字节（Node 自己的文档里
    就写着这条）。本机 Windows 上实测没见它丢过（管道写入是同步的），但这是有代价
    为零的保险：设 exitCode 让进程自然退出，输出一定完整。
  */
  if (cmd === 'status') {
    const st = status();
    if (asJson) mark(st);
    else console.log(JSON.stringify(st, null, 2));
    process.exitCode = 0;
    return;
  }

  if (cmd === 'fetch') {
    /*
      只探一次远端（2026-10-06 加）。编辑器服务在后台定时跑它，用来把「拉远端 (N)」
      那个角标上的数字刷新 —— 只更新本地的远端记录，不碰工作区一个字节。
    */
    if (!remoteUrl()) {
      mark({ code: 'noremote' });
      process.exitCode = CODES.noremote;
      return;
    }
    const f = fetchRemote();
    if (!f.ok) {
      say(explain({ code: 'offline', err: f.err, direct: proxyDisabled }));
      mark({ code: 'offline', err: f.err });
      process.exitCode = CODES.offline;
      return;
    }
    const c = counts();
    say(`   远端差 ${c.behind} 个提交，本地领先 ${c.ahead} 个。`);
    mark({ code: 'ok', behind: c.behind, ahead: c.ahead });
    process.exitCode = 0;
    return;
  }

  if (cmd === 'pull') {
    const r = pullRemote({ log: say });
    say('');
    say(explain(r));
    mark(r);
    process.exitCode = CODES[r.code] ?? 1;
    return;
  }

  if (cmd === 'sync') {
    const r = sync({ log: say, quiet });
    if (r.code !== 'ok') say(explain(r));
    mark(r);
    /* 没有远端时「同步」本来就没意义，不算失败（发布那边才需要拦） */
    process.exitCode = r.code === 'noremote' ? 0 : (CODES[r.code] ?? 1);
    return;
  }

  if (cmd === 'publish') {
    const r = publish({ message, log: say });
    say('');
    say(explain(r));
    mark(r);
    process.exitCode = CODES[r.code] ?? 1;
    return;
  }

  console.log(usage());
  process.exitCode = 1;
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();
