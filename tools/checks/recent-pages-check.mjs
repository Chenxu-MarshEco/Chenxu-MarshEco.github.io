/*
 * ============================================================================
 * 「近期更新」改读 git 的记录 + 「拉远端」不再进死胡同（2026-10-13）
 * ----------------------------------------------------------------------------
 * 站长转述群里的两句话：
 *   「ssw是不是说的是类似可以直接让他读git的记录，而不是由编辑器操作自动生成」
 *   「update 还是需要手动处理冲突」
 *
 * ① 记账不再写共享文件：页面名写进**提交说明**，构建时从 git log 读回来
 *    （tools/git/recent-pages.mjs）。这份验收量三件事：
 *      · 那一段的"写→读"能对上（含名字里有空格、多页、没写的情况）；
 *      · 在**一次性仓库**里真造几条提交，读出来的顺序/去重/条数对；
 *      · 没有那一段的提交（比如手写的说明）不会污染结果。
 * ② 「拉远端」本来是"只许快进"：本地只要有一个没发布的提交就直接不拉 ——
 *    群里看到的「需要手动处理」就是它。现在改成把自己的提交接到远端后面（rebase），
 *    只拉不推；正在 merge/rebase 半路时明确拒绝、不乱动。
 *    这一条在**真 git 仓库**里跑（一次性 bare 远端 + 两份 clone + 拷贝一份 tools/git）。
 *
 * 用法：node tools/checks/recent-pages-check.mjs
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { formatPageBlock, parsePageBlock, recentPages, PAGE_BLOCK_HEADER } from '../git/recent-pages.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = path.join(SRC, '.tmp', 'recent-pages-test');

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

const g = (cwd, ...args) => {
  try {
    return { ok: true, out: execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (e) {
    return { ok: false, out: String(e.stdout || '').trim(), err: String(e.stderr || '').trim() };
  }
};
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const run = (cwd, args) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}\n${e.stderr || ''}`.trim() };
  }
};
const mark = (out) => {
  const line = String(out).split('\n').reverse().find((l) => l.startsWith('[result] '));
  try {
    return line ? JSON.parse(line.slice('[result] '.length)) : null;
  } catch {
    return null;
  }
};

/* ============================================================
   ① 那一段的"写 → 读"
   ============================================================ */
console.log('================ ① 提交说明里那一段 ================');
const block = formatPageBlock([
  { href: '/huaya/years/newhuaya', title: '新花娅地' },
  { href: '/huaya/years/huaxiao', title: '花 篠 桓 娅' },
  { href: '/huaya/years/newhuaya', title: '新花娅地' },
  { href: 'https://别站/x', title: '站外的不算' },
  { href: '/iceberg', title: '' },
]);
check('★ 拼出来的那一段：抬头正确、一页一行、重复的地址只留一条、站外/空名跳过',
  block.startsWith(PAGE_BLOCK_HEADER) && (block.match(/^- /gm) || []).length === 2
    && block.includes('/huaya/years/newhuaya 新花娅地') && !block.includes('别站'),
  JSON.stringify(block.split('\n').slice(0, 4)));

const round = parsePageBlock(`更新内容 2026-10-13 21:10：页面 / 子版块\n\n${block}\n\n还有别的说明`);
check('★ 从提交说明里读回来：两页都在，名字里的空格没被切坏，后面的说明不干扰',
  round.length === 2 && round[0].href === '/huaya/years/newhuaya' && round[0].title === '新花娅地'
    && round[1].title === '花 篠 桓 娅',
  JSON.stringify(round));

check('没写那一段的提交说明 → 读出来是空的（不会硬凑）',
  parsePageBlock('更新内容 2026-10-13：随手改了点东西').length === 0);
check('一页都没有时拼出来是空串（调用方不会多出一截空抬头）',
  formatPageBlock([]) === '' && formatPageBlock(undefined) === '');

/* ============================================================
   ② 一次性仓库里真造几条提交，读出来的顺序/去重
   ============================================================ */
console.log('\n================ ② 从 git 记录里读 ================');
fs.rmSync(TMP, { recursive: true, force: true });
const repo = path.join(TMP, 'repo');
fs.mkdirSync(repo, { recursive: true });
g(repo, 'init', '--initial-branch=main');
g(repo, 'config', 'user.email', 'a@x');
g(repo, 'config', 'user.name', '甲');
const commit = (subject, pages, at) => {
  write(path.join(repo, `${subject}.txt`), `${subject}\n`);
  g(repo, 'add', '-A');
  const msg = pages?.length ? `${subject}\n\n${formatPageBlock(pages)}` : subject;
  const env = at ? { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } : process.env;
  try {
    execFileSync('git', ['commit', '-m', msg], { cwd: repo, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
};
commit('第一次：改了编年史', [{ href: '/huaya/years/newhuaya', title: '新花娅地' }], '2026-10-13T01:00:00+08:00');
commit('第二次：改了冰山图', [{ href: '/iceberg', title: '冰山图' }, { href: '/huaya/years/huaxiao', title: '花篠桓娅' }], '2026-10-13T02:00:00+08:00');
commit('第三次：手写的说明，没有那一段', null, '2026-10-13T03:00:00+08:00');
commit('第四次：又改了编年史', [{ href: '/huaya/years/newhuaya', title: '新花娅地' }], '2026-10-13T04:00:00+08:00');

const got = recentPages({ cwd: repo, legacyFile: path.join(TMP, '不存在.json') });
info(`读出来 ${got.length} 条：${got.map((e) => `${e.title}@${e.at.slice(11, 16)}`).join('  ')}`);
check('★ 三条带页面的提交都读到了，而且同一页只留最新的一条（4 条提交 → 3 条记录）',
  got.length === 3 && got.every((e) => e.from === 'git'), `${got.length} 条`);
check('★ 按时间倒序：最新的在最前（编年史 04:00 → 冰山图 02:00 → 花篠桓娅 …）',
  got[0].title === '新花娅地' && got[0].at.includes('T04:00') && got[1].title === '冰山图' && got[2].title === '花篠桓娅',
  got.map((e) => `${e.title}@${e.at.slice(11, 16)}`).join(' → '));
check('每条都带署名和短 sha（点得进版本面板那一步用得着）',
  got.every((e) => e.who && /^[0-9a-f]{7,8}$/.test(e.sha)), JSON.stringify(got[0]));
check('没写那一段的提交（第三次）不会凭空多出一条记录',
  !got.some((e) => e.title.includes('手写')) && got.length === 3);

/* ============================================================
   ③ 「拉远端」：本地有没发布的提交时不再进死胡同
   ============================================================ */
console.log('\n================ ③ 拉远端（真仓库）================');
const origin = path.join(TMP, 'origin.git');
g(TMP, 'init', '--bare', '--initial-branch=main', origin);
const clone = (name) => {
  const dir = path.join(TMP, name);
  g(TMP, 'clone', origin, dir);
  g(dir, 'config', 'user.email', `${name}@x`);
  g(dir, 'config', 'user.name', name);
  /* 把 tools/git 拷进去 —— sync.mjs 只依赖同目录的 merge-json / recent-pages，自足 */
  fs.cpSync(path.join(SRC, 'tools', 'git'), path.join(dir, 'tools', 'git'), { recursive: true });
  return dir;
};
const A = clone('A');
const B = clone('B');
const CLI = (dir, ...args) => run(dir, [path.join(dir, 'tools', 'git', 'sync.mjs'), ...args]);

write(path.join(A, 'a.txt'), 'a\n');
g(A, 'add', '-A'); g(A, 'commit', '-m', 'A：起个底'); g(A, 'push', '-u', 'origin', 'main');
g(B, 'pull', '--ff-only');

/* B 本地写一笔（**没发布**），接着 A 又推一笔 */
write(path.join(B, 'b.txt'), 'b\n');
g(B, 'add', '-A'); g(B, 'commit', '-m', 'B：本地还没发布的一笔');
write(path.join(A, 'a2.txt'), 'a2\n');
g(A, 'add', '-A'); g(A, 'commit', '-m', 'A：又推了一笔'); g(A, 'push');

const before = g(B, 'rev-list', '--count', 'origin/main..HEAD').out;
const r1 = CLI(B, 'pull', '--json');
const j1 = mark(r1.out);
info(`B 拉远端：code=${j1?.code ?? '（没输出）'} ${JSON.stringify(j1 ?? {})}`);
check('★ 本地有没发布的提交时，拉远端**能拉**（把自己的接到远端后面），不再是"需要手动处理"',
  r1.code === 0 && j1?.code === 'ok' && j1.rebased === true && Number(j1.moved) >= 1,
  `exit=${r1.code} ${JSON.stringify(j1)}`);
check('拉完之后本地不再落后（behind 归零）、自己那一笔还在',
  g(B, 'rev-list', '--left-right', '--count', 'main...origin/main').out.endsWith('0')
    && g(B, 'log', '--oneline').out.includes('B：本地还没发布的一笔'),
  `原来自有 ${before} 笔；${g(B, 'log', '--oneline').out.split('\n').length} 条提交`);
check('只拉不推：B 那笔仍然没在远端上（要发不发由「发布上线」决定）',
  !g(B, 'log', '--oneline', 'origin/main').out.includes('B：本地还没发布的一笔'));

/* 正在 merge 半路（群的猜测：他 merge branch 了）：明确拒绝、不碰仓库 */
write(path.join(B, '.git', 'MERGE_HEAD'), g(B, 'rev-parse', 'HEAD').out);
write(path.join(A, 'a3.txt'), 'a3\n');
g(A, 'add', '-A'); g(A, 'commit', '-m', 'A：第三笔'); g(A, 'push');
const r2 = CLI(B, 'pull', '--json');
const j2 = mark(r2.out);
info(`B 在半路 merge 时拉：code=${j2?.code} what=${j2?.what}`);
check('★ 仓库停在一个没做完的 merge 里：拉远端明确说清、**一个字节都不动**',
  j2?.code === 'busy' && j2.what === 'merge' && fs.existsSync(path.join(B, '.git', 'MERGE_HEAD')),
  JSON.stringify(j2));
fs.rmSync(path.join(B, '.git', 'MERGE_HEAD'), { force: true });

const r3 = CLI(B, 'pull', '--json');
const j3 = mark(r3.out);
check('收拾干净之后再拉：正常拉下来（rebase 那条路照旧能用）',
  j3?.code === 'ok' && g(B, 'rev-list', '--left-right', '--count', 'main...origin/main').out.endsWith('0'),
  JSON.stringify(j3));

/* 命令行发布时，本机那份"改过哪几页"会被搬进提交说明 */
console.log('\n---- 发布时把本机记录搬进提交说明 ----');
fs.mkdirSync(path.join(B, 'tools', 'editor'), { recursive: true });
write(path.join(B, 'tools', 'editor', '.editor-edits.json'),
  `${JSON.stringify({ edits: [{ href: '/huaya/years/newhuaya', title: '新花娅地', at: '2026-10-13T05:00:00.000Z' }] }, null, 2)}\n`);
/* ⚠ 不要先手动 commit：要让**发布**去提交 —— 那一段是它拼进提交说明的 */
write(path.join(B, 'b2.txt'), 'b2\n');
const r4 = CLI(B, 'publish', '--json', '--message', '更新内容 测试：发布一下');
const j4 = mark(r4.out);
const lastMsg = g(B, 'log', '-1', '--format=%B').out;
info(`发布：code=${j4?.code}；提交说明里有没有那一段：${lastMsg.includes(PAGE_BLOCK_HEADER)}`);
check('★ 命令行发布也会把「改过哪几页」写进提交说明（编辑器不用管这件事）',
  j4?.code === 'ok' && lastMsg.includes(PAGE_BLOCK_HEADER) && lastMsg.includes('/huaya/years/newhuaya 新花娅地'),
  JSON.stringify(lastMsg.split('\n').slice(0, 6)));
check('发布成功后本机那份记录被清掉（下一轮重新记，不会重复写进新提交）',
  !fs.existsSync(path.join(B, 'tools', 'editor', '.editor-edits.json')));
/* 那一段确实进了 git 记录 —— 站点构建读的就是它 */
const derived = recentPages({ cwd: B, legacyFile: path.join(TMP, '不存在.json') });
check('★ 站点那边从这份 git 记录里就能读出"新花娅地"（不用任何共享数据文件）',
  derived.some((e) => e.href === '/huaya/years/newhuaya' && e.from === 'git'),
  JSON.stringify(derived.slice(0, 2)));

/* ---- 重叠：远端动的正是我手上改过还没提交的那一份 → 拒绝（绝不能留下冲突标记）---- */
console.log('\n---- 重叠时拒绝（autostash 会留下冲突标记，所以不能硬拉）----');
write(path.join(B, 'b3.txt'), 'b3\n');
g(B, 'add', '-A'); g(B, 'commit', '-m', 'B：又攒了一笔没发布的');
write(path.join(B, 'shared.txt'), 'B 手上还没提交的改动\n');
/* ⚠ A 得先把自己拉到最新（B 刚推过），否则 A 的 push 会被拒 —— 那是测试自己的坑 */
g(A, 'pull', '--rebase', '--autostash');
write(path.join(A, 'shared.txt'), 'A 推上来的版本\n');
g(A, 'add', '-A'); g(A, 'commit', '-m', 'A：改 shared.txt'); g(A, 'push');

const r5 = CLI(B, 'pull', '--json');
const j5 = mark(r5.out);
info(`重叠时拉：code=${j5?.code} files=${JSON.stringify(j5?.files)}`);
check('★ 远端动的正是我手上改过、还没提交的那一份 → 拒绝，并点名是哪一份',
  j5?.code === 'blocked' && (j5.files || []).includes('shared.txt'), JSON.stringify(j5));
check('★ 拒绝之后工作区里**没有**冲突标记，我手上那份改动一个字没动',
  fs.readFileSync(path.join(B, 'shared.txt'), 'utf8').includes('B 手上还没提交的改动')
    && !fs.readFileSync(path.join(B, 'shared.txt'), 'utf8').includes('<<<<<<<'),
  JSON.stringify(fs.readFileSync(path.join(B, 'shared.txt'), 'utf8')));

/* 把手上那份提交之后再拉：两边真的改了**同一处**（而且不是 JSON、结构合并帮不上）——
   这时候就该拦下、原样还原：提交还在、工作区干净、一个冲突标记都不留 */
g(B, 'add', '-A'); g(B, 'commit', '-m', 'B：把自己那份提交了');
const r6 = CLI(B, 'pull', '--json');
const j6 = mark(r6.out);
const sharedB = fs.readFileSync(path.join(B, 'shared.txt'), 'utf8');
check('★ 两边真改了同一处（非 JSON）→ 拦下并原样还原：自己的提交还在、工作区没有冲突标记',
  j6?.code === 'blocked' && g(B, 'log', '--oneline').out.includes('B：把自己那份提交了')
    && sharedB.includes('B 手上还没提交的改动') && !sharedB.includes('<<<<<<<'),
  JSON.stringify({ code: j6?.code, files: j6?.files }));

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n================ 结果 ================');
console.log(`PASS ${pass}   FAIL ${fail}`);
if (fail > 0) process.exit(1);
