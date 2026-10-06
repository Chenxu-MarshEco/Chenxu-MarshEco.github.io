/*
 * ============================================================================
 * 推流安全（不互相覆盖）—— 验收
 * ----------------------------------------------------------------------------
 * 背景：站点的内容不止一个人在改 —— 另一位（SSW）会推文章，接入的机器人也会
 * 定时往里写稿（写完归到「铃忆的冰室日记」那类页面下）。2026-10-05 对着群里那段
 * 「三大纪律」检查了两个启动器，发现**推流那一环不符合**：
 *
 *   · tools/menu.mjs 和 tools/studio/studio.py 都是 add -A → commit → push，
 *     中间**没有 git pull** —— 正是群里说的「先拉后推」那一步；
 *   · 推送被拒（non-fast-forward）时给出的文案是「代理掉了 / 没登录 GitHub /
 *     缺 workflow 权限」——三句里没有一句是真正的原因；用户顺着提示怎么试都推
 *     不上去，下一步就会去搜「Git 如何强制推送」，而那正是唯一会覆盖别人的红线。
 *
 * 修法：推流整个搬到 tools/git/sync.mjs（两个启动器共用一份），流程固定成
 *   探连接 → 提交 → **先拉取（pull --rebase）** → 推送；被拒绝就再拉一次重推；
 *   撞在同一行时中止、把冲突文件列出来、把仓库恢复原状，**什么都不推**。
 * 并且用 assertNoForce() 把 -f / --force / +refspec / --mirror 直接挡掉。
 *
 * 这个脚本用**真的 git 仓库**（一个 bare 当远端 + 两份 clone）演一遍：
 *   ① 别人先推 → 我们发布：自动先拉，两边内容都在，谁的提交都没被顶掉；
 *   ② 同一文件不同行：git 自动并行合并，两份改动都留下（群里说的「情况A」）；
 *   ③ 同一行：停下来、列出文件、恢复原状、远端一动不动（「情况B」）；
 *   ④ 全程没有任何强推：源码里没有、参数被挡、远端 reflog 里没有 forced-update；
 *   ⑤ 两个启动器都真的走了这条安全通道。
 *
 * 用法：node tools/checks/git-sync-check.mjs
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import net from 'node:net';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..');
const TMP = path.join(SRC, '.tmp');
const ORIGIN = path.join(TMP, 'gitsync-origin.git');
const DST = path.join(TMP, 'gitsync-copy');     // 「我们」这一份
const OTHER = path.join(TMP, 'gitsync-ssw');    // 另一位 / 机器人那一份
const NODE = process.execPath;

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

/** 跑一条 git 命令（作用对象一律是副本 / bare 远端，绝不碰真仓库） */
function git(args, cwd = DST) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), code: r.status };
}
const gitOK = (args, cwd = DST) => {
  const r = git(args, cwd);
  if (!r.ok) throw new Error(`git ${args.join(' ')} 失败：${r.err || r.out}`);
  return r.out;
};

/* ================================================================
 * ④ 先看源码：红线有没有被踩（便宜、快、一眼定性）
 * ================================================================ */
console.log('================ ① 源码里的红线 ================');
const syncSrc = fs.readFileSync(path.join(SRC, 'tools/git/sync.mjs'), 'utf8');
const menuSrc = fs.readFileSync(path.join(SRC, 'tools/menu.mjs'), 'utf8');
const studioSrc = fs.readFileSync(path.join(SRC, 'tools/studio/studio.py'), 'utf8');
const wfSrc = fs.readFileSync(path.join(SRC, '.github/workflows/deploy.yml'), 'utf8');

const FORCE_PATTERNS = [
  /push[^\n]{0,40}['"\s]-f\b/,
  /push[^\n]{0,40}--force(\s|['"]|$)/,
  /--force-with-lease/,
  /reset\s+--hard/,
  /clean\s+-[a-z]*f/,
  /checkout\s+--\s+\./,
];

/*
  扫的是**真正会执行的那几行**，不是整份文件：
  · 注释里一定会出现「git push -f」这种字样（那是在讲「别这么干」）；
  · sync.mjs 是唯一允许出现这些字面的地方 —— 它的黑名单本身就写着 -f / --force，
    那是拦人的名单，不是要执行的参数，所以按行放行带 FORCE_FLAGS 的那一行。
*/
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const stripPy = (s) => s.replace(/'''[\s\S]*?'''/g, '').replace(/"""[\s\S]*?"""/g, '')
  .replace(/^\s*#.*$/gm, '');

for (const [name, src, allow] of [
  ['tools/menu.mjs', stripJs(menuSrc), null],
  ['tools/studio/studio.py', stripPy(studioSrc), null],
  ['.github/workflows/deploy.yml', wfSrc, null],
  ['tools/git/sync.mjs', stripJs(syncSrc).split('\n').filter((l) => !/FORCE_FLAGS/.test(l)).join('\n'), 'FORCE_FLAGS'],
]) {
  const hits = FORCE_PATTERNS.filter((re) => re.test(src));
  check(`★ ${name} 的可执行代码里没有强推 / 硬重置这类会把别人抹掉的操作`, hits.length === 0,
    hits.length ? `命中 ${hits.map(String).join(' , ')}` : '0 处');
}
check('★ sync.mjs 把强推参数集中成了一份黑名单（assertNoForce 拦的就是它）',
  /const FORCE_FLAGS = new Set\(/.test(syncSrc) && /export function assertNoForce/.test(syncSrc));
check('★ 部署走 actions/deploy-pages（由仓库内容驱动构建），没有往 gh-pages 强推的步骤',
  /actions\/deploy-pages/.test(wfSrc) && !/git\s+push/.test(wfSrc));

/* ================================================================
 * 准备三个仓库：bare 远端 + 我们 + 另一位
 * ================================================================ */
console.log('\n================ 准备仓库（三个都是 .tmp 里的副本） ================');
for (const p of [ORIGIN, DST, OTHER]) fs.rmSync(p, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

fs.mkdirSync(DST, { recursive: true });
for (const item of ['src', 'tools', 'package.json', 'astro.config.mjs', 'tsconfig.json',
  '.gitignore', '.gitattributes']) {
  const from = path.join(SRC, item);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(DST, item), { recursive: true });
}
// node_modules 用 junction 接过去：publish 里 requireDeps 只检查它在不在
try {
  execFileSync('cmd', ['/c', 'mklink', '/J', path.join(DST, 'node_modules'),
    path.join(SRC, 'node_modules')], { stdio: 'ignore' });
} catch { /* 已经有了就算了 */ }

gitOK(['init', '-b', 'main'], DST);
for (const cwd of [DST]) {
  gitOK(['config', 'user.email', 'check@local'], cwd);
  gitOK(['config', 'user.name', '验收脚本'], cwd);
}
gitOK(['add', '-A'], DST);
gitOK(['commit', '-m', '初始状态'], DST);
gitOK(['init', '--bare', '-b', 'main', ORIGIN], TMP);
gitOK(['remote', 'add', 'origin', ORIGIN], DST);
gitOK(['push', '-u', 'origin', 'main'], DST);

gitOK(['clone', ORIGIN, OTHER], TMP);
gitOK(['config', 'user.email', 'ssw@local'], OTHER);
gitOK(['config', 'user.name', '另一位'], OTHER);
info(`我们：${DST}`);
info(`另一位：${OTHER}`);

/* 挑一篇现成的文章当「同一个文件」的战场 */
const postsDir = path.join(DST, 'src/content/posts');
const SHARED = fs.readdirSync(postsDir).filter((f) => f.endsWith('.md')).sort()[0];
const sharedAbs = path.join(postsDir, SHARED);
const sharedRaw = () => fs.readFileSync(sharedAbs, 'utf8');
check('副本里能挑到一篇现成文章（后面的「同一文件」用它来演）', Boolean(SHARED), SHARED);

/** 改「同一行」用：frontmatter 的 title 那一行 */
function setTitle(dir, file, title) {
  const abs = path.join(dir, 'src/content/posts', file);
  const out = fs.readFileSync(abs, 'utf8')
    .replace(/^title:.*$/m, `title: ${title}`);
  fs.writeFileSync(abs, out);
  return out;
}
/** 改「另一行」用：正文最后一行 */
function appendBodyLine(dir, file, line) {
  const abs = path.join(dir, 'src/content/posts', file);
  fs.writeFileSync(abs, `${fs.readFileSync(abs, 'utf8').replace(/\s*$/, '')}\n${line}\n`);
}

/** 在副本里跑真正的发布（就是用户在启动器里点「发布上线」走的那条命令） */
function runPublish(cwd, message) {
  const r = spawnSync(NODE, [path.join(cwd, 'tools/git/sync.mjs'), 'publish', '--message', message],
    { cwd, encoding: 'utf8', timeout: 120000 });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
function runSync(cwd) {
  const r = spawnSync(NODE, [path.join(cwd, 'tools/git/sync.mjs'), 'sync'],
    { cwd, encoding: 'utf8', timeout: 120000 });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
/**
 * 在「另一位」那份里推一次提交（模拟机器人 / SSW 的推送）。
 *
 * ⚠ 它也必须守同一条纪律：**先拉后推**（群里那句「每次开始做东西的时候都拉取一下」）。
 * 不拉就推的话 git 会直接拒绝（`! [rejected] main -> main (fetch first)`）——
 * 这个脚本第一版就是这么挂的，正好说明机器人那边也得这么用。
 * `--autostash`：机器人是先改好文章再推的，工作区里还留着没提交的改动。
 */
function otherPush(message) {
  gitOK(['pull', '--rebase', '--autostash', '--quiet', 'origin', 'main'], OTHER);
  gitOK(['add', '-A'], OTHER);
  gitOK(['commit', '-m', message], OTHER);
  gitOK(['push', 'origin', 'main'], OTHER);
  return gitOK(['rev-parse', 'HEAD'], OTHER);
}

/* ================================================================
 * ① 别人先推了，我们随后发布 —— 必须自动先拉，谁都不丢
 * ================================================================ */
console.log('\n================ ② 别人先推，我们再发布 ================');
const baseCount = Number(gitOK(['rev-list', '--count', 'HEAD'], ORIGIN));

// 机器人：新加一篇文章（正是那个场景：往铃忆的冰室日记那种页面下挂文章）
const robotPost = 'src/content/posts/robot-note.md';
fs.writeFileSync(path.join(OTHER, robotPost), [
  '---',
  `title: 机器人推上来的一篇`,
  'date: 2026-10-05',
  'tags: [机器人]',
  'subs: []',
  '---',
  '',
  '这是「另一位 / 机器人」推上来的正文。',
  '',
].join('\n'));
// 同一篇现成文章：机器人改了 title 那一行（和我们后面改的正文最后一行是两个位置）
setTitle(OTHER, SHARED, '机器人改过的标题');
const robotSha = otherPush('机器人：新增一篇文章');

// 我们这边也改了东西，而且就在同一篇现成文章的**另一行**
fs.writeFileSync(path.join(DST, 'src/content/posts/our-note.md'), [
  '---',
  'title: 我这边新写的一篇',
  'date: 2026-10-05',
  'tags: [本地]',
  'subs: []',
  '---',
  '',
  '这是我这边写的正文。',
  '',
].join('\n'));
appendBodyLine(DST, SHARED, '这一行是我这边加的（和机器人改的标题不是同一行）。');

const pubA = runPublish(DST, '验收：本地改动');
check('★ 别人先推过之后，我们这次发布**成功**（以前必然被拒且提示还是错的）',
  pubA.code === 0, `退出码 ${pubA.code}`);
check('★ 发布过程里真的**先拉取**了（群里的「先拉后推」那一步）',
  /先拉取|拉取完成|拉取/.test(pubA.out), (pubA.out.match(/.*拉取.*/) || [''])[0].trim());
check('★ 没有出现「强制推送」之类的动作', !/-f\b|--force/.test(pubA.out));

const originFiles = gitOK(['ls-tree', '-r', '--name-only', 'main'], ORIGIN).split('\n');
check('★ 机器人那篇文章在远端**还在**（没被我们覆盖）', originFiles.includes(robotPost), robotPost);
check('★ 我们新写的文章也推上去了', originFiles.includes('src/content/posts/our-note.md'));
check('★ 机器人的那次提交仍然是远端 main 的祖先（历史没有被改写）',
  git(['merge-base', '--is-ancestor', robotSha, 'main'], ORIGIN).ok);
check('★ 两边提交都在：远端比最初多了 2 个提交（机器人 1 + 我们 1）',
  Number(gitOK(['rev-list', '--count', 'HEAD'], ORIGIN)) === baseCount + 2,
  `${baseCount} → ${gitOK(['rev-list', '--count', 'HEAD'], ORIGIN)}`);

// 同一文件不同行：两份改动都在（群里说的「情况A」）
const merged = gitOK(['show', `main:${robotPost}`], ORIGIN); // 只为确认远端可读
check('★ 同一文件不同行的改动**自动并行合并**了：机器人改的标题在、我加的那行也在',
  /机器人改过的标题/.test(gitOK(['show', `main:src/content/posts/${SHARED}`], ORIGIN))
  && /这一行是我这边加的/.test(gitOK(['show', `main:src/content/posts/${SHARED}`], ORIGIN)),
  `${SHARED}（远端读回来 ${merged.length > 0 ? '正常' : '异常'}）`);
check('★ 我们本地和远端已经一致（发布完不留「落后」状态）',
  (() => {
    const r = git(['rev-list', '--left-right', '--count', 'origin/main...HEAD'], DST);
    return r.ok && r.out.split(/\s+/).every((n) => Number(n) === 0);
  })());

/* ================================================================
 * ③ 开工前先拉一下（群里那句「每次开始做东西的时候都拉取一下」）
 * ================================================================ */
console.log('\n================ ③ 开工前先拉一下 ================');
let dirtyWarnOk = false;
setTitle(OTHER, SHARED, '机器人又改了一次标题');
otherPush('机器人：再推一次，试试开工前的自动拉取');
const beforeSync = Number(gitOK(['rev-list', '--count', 'HEAD'], DST));
const syncRun = runSync(DST);
const afterSync = Number(gitOK(['rev-list', '--count', 'HEAD'], DST));
check('★ 远端有新东西时，「开工前先拉一下」真的把它拉了进来',
  syncRun.code === 0 && afterSync > beforeSync,
  `${beforeSync} → ${afterSync} 个提交`);
check('★ 拉完本地没有残留的合并/rebase 状态，工作区也是干净的',
  !fs.existsSync(path.join(DST, '.git/rebase-merge'))
  && !fs.existsSync(path.join(DST, '.git/rebase-apply'))
  && git(['status', '--porcelain'], DST).out.trim() === '');
check('★ 本地有没发布的改动时**不擅自合并**（只提示，避免在自己没提交的改动上做 rebase）',
  (() => {
    // 远端再往前走一格，同时本地留一个没提交的改动
    setTitle(OTHER, SHARED, '机器人第三次改标题');
    otherPush('机器人：第三次推送');
    const scratch = path.join(DST, 'src/content/posts/dirty-scratch.md');
    fs.writeFileSync(scratch, '---\ntitle: 本地没发布的改动\ndate: 2026-10-05\n---\n\n草稿\n');
    const r = runSync(DST);
    fs.rmSync(scratch, { force: true });
    dirtyWarnOk = r.code === 0 && /先不擅自合并|先「发布上线」/.test(r.out);
    return dirtyWarnOk;
  })());
info(`（本地没发布的改动时同步的处理：${dirtyWarnOk ? '只提示、不擅自合并' : '没按预期提示'}）`);

// 收拾干净：本地改动撤掉之后再同步一次，这回应该真的把远端那个提交拉下来
const syncClean = runSync(DST);
check('★ 本地干净之后再同步，就把刚才没拉的那个提交拉下来了',
  syncClean.code === 0 && Number(gitOK(['rev-list', '--count', 'HEAD'], DST)) === afterSync + 1,
  `${afterSync} → ${gitOK(['rev-list', '--count', 'HEAD'], DST)} 个提交`);

/* ================================================================
 * ④ 同一行撞车 —— 必须停下来、保住双方、什么都不推
 * ================================================================ */
console.log('\n================ ④ 同一行撞车 ================');
// 两位都同步到最新，再各自改**同一行**
gitOK(['pull', '--rebase', '--quiet', 'origin', 'main'], OTHER);
const beforeOther = gitOK(['rev-parse', 'HEAD'], ORIGIN);
const beforeBehind = git(['status', '--short'], DST).out;

setTitle(OTHER, SHARED, '机器人抢先改的标题');
const robotSha2 = otherPush('机器人：把标题改成另一个说法');

setTitle(DST, SHARED, '我这边也要改标题');
gitOK(['add', '-A'], DST);
gitOK(['commit', '-m', '验收：我也改标题'], DST);
const myOriginal = fs.readFileSync(path.join(postsDir, SHARED), 'utf8');

const pubB = runPublish(DST, '验收：同一行撞车');
check('★ 撞在同一行时，发布**停下来**（退出码 2 = 冲突，不是「推失败」）',
  pubB.code === 2, `退出码 ${pubB.code}`);
check('★ 提示里说清了是哪几个文件撞了',
  pubB.out.includes(SHARED), (pubB.out.match(/撞在一起的文件[\s\S]{0,200}/) || [''])[0].replace(/\n/g, ' ').trim());
check('★ 明确告诉用户**没有推送**、也没丢东西',
  /没有推送/.test(pubB.out) && /一个都没丢/.test(pubB.out));
check('★ 没有把 rebase 卡在半路（仓库回到能继续用的状态）',
  !fs.existsSync(path.join(DST, '.git/rebase-merge'))
  && !fs.existsSync(path.join(DST, '.git/rebase-apply')));
check('★ 我本地的提交和改动原封不动（冲突不吞本地内容）',
  fs.readFileSync(path.join(postsDir, SHARED), 'utf8') === myOriginal
  && /验收：同一行撞车|我也改标题/.test(gitOK(['log', '--format=%s', '-3'], DST)));
check('★ 远端一动不动：还是机器人的那次提交，什么都没被我们推上去',
  gitOK(['rev-parse', 'HEAD'], ORIGIN) === robotSha2,
  `${beforeOther.slice(0, 7)} → ${robotSha2.slice(0, 7)}`);
check('★ 机器人改后的标题在远端完好（没被我们的版本顶掉）',
  /机器人抢先改的标题/.test(gitOK(['show', `main:src/content/posts/${SHARED}`], ORIGIN)));
check('★ 撞车之后本地那份文件里**没有**留下冲突标记（恢复得很干净）',
  !/^<<<<<<<|^>>>>>>>/m.test(fs.readFileSync(path.join(postsDir, SHARED), 'utf8')));
info(`（发布前本地未提交改动：${beforeBehind ? '有' : '无'}）`);

/* ================================================================
 * ④ 强推防线：源码 + 运行时 + 远端记录
 * ================================================================ */
console.log('\n================ ④ 强推防线 ================');
const mod = await import(pathToFileURL(path.join(SRC, 'tools/git/sync.mjs')).href);
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
check('★ assertNoForce 挡掉 -f', throws(() => mod.assertNoForce(['push', '-f'])));
check('★ assertNoForce 挡掉 --force / --force-with-lease',
  throws(() => mod.assertNoForce(['push', '--force']))
  && throws(() => mod.assertNoForce(['push', '--force-with-lease'])));
check('★ assertNoForce 挡掉强推 refspec（+main）和 --mirror',
  throws(() => mod.assertNoForce(['push', 'origin', '+main']))
  && throws(() => mod.assertNoForce(['push', '--mirror'])));
check('★ 正常推送参数能通过（这道闸不会把正常流程也挡了）',
  mod.assertNoForce(['push']) === true
  && mod.assertNoForce(['push', '-u', 'origin', 'main']) === true);
check('★ 远端 main 的 reflog 里**没有** forced-update（从头到尾没人强推过）',
  !/forced-update/.test(git(['reflog', 'show', 'main'], ORIGIN).out));

/* ================================================================
 * ⑤ 两个启动器都真的走了这条通道 + status/sync 子命令
 * ================================================================ */
console.log('\n================ ⑤ 启动器接线 ================');
check('★ 控制台菜单（menu.mjs）的发布走 sync.mjs，不再自己 add/commit/push',
  /from '\.\/git\/sync\.mjs'/.test(menuSrc) && /safePublish\(/.test(menuSrc)
  && !/execFileSync\('git', \['add', '-A'\]/.test(menuSrc));
check('★ 控制台菜单在「写文章」之前会先同步一次',
  /async function doWrite\(\)[\s\S]{0,900}?syncRemote\(/.test(menuSrc));
check('★ 图形启动器（studio.py）把发布交给同一个 sync.mjs',
  /sync\.mjs'?\)?[^\n]*publish/.test(studioSrc) && /'--message', message/.test(studioSrc));
check('★ 图形启动器在「写文章 / 看效果」之前也会先同步一次',
  /def launch\(self, key\):[\s\S]{0,700}?syncRemote|def launch\(self, key\):[\s\S]{0,700}?'sync'/.test(studioSrc)
  && /'sync\.mjs'\), 'sync'\]|'sync\.mjs'\], 'sync'/.test(studioSrc.replace(/\n\s+/g, ' ')));

const st = spawnSync(NODE, [path.join(SRC, 'tools/git/sync.mjs'), 'status'],
  { cwd: SRC, encoding: 'utf8' });
let stJson = null;
try { stJson = JSON.parse(st.stdout); } catch { /* 下面会判 */ }
check('★ status 子命令能给出机器可读的状态（菜单/状态栏读它）',
  st.status === 0 && stJson && typeof stJson.behind === 'number'
  && typeof stJson.ahead === 'number' && 'remote' in stJson,
  st.status === 0 ? '' : `退出码 ${st.status}`);
check('★ status 的输出用**管道**读也是完整的字节（图形启动器就是这么读它的输出的）',
  (st.stdout || '').trim().length > 0, `${(st.stdout || '').length} 字节`);

/* ================================================================
 * ⑥ 代理是死的、网络其实是通的 —— 必须自己改直连（2026-10-06 修的那次）
 *
 * 现场：仓库 git config 里写着 http.proxy=127.0.0.1:7890，Clash 一关，
 * 所有远端操作都报「Failed to connect to github.com:443 over proxy」——
 * 于是「拉远端」看起来像连不上 GitHub，其实直连是好的（真仓库就是靠这条
 * 自动回退把机器人那 3 个提交拉下来的）。
 *
 * 这里全程不联网：远端用一个**真的没人监听**的本地端口（http 协议才会走代理），
 * 于是「有没有摘掉代理」可以从报错文本里看出来 —— 提到 proxy 就是还在走代理。
 * ================================================================ */
console.log('\n================ ⑥ 代理连不上时自动改直连 ================');
check('★ 源码里那一步是「只摘掉这一次调用的代理」（-c http.proxy=），不动用户的 git config',
  /'http\.proxy='/.test(syncSrc) && /'https\.proxy='/.test(syncSrc)
  && /export function isProxyTrouble/.test(syncSrc));
check('★ 只有「像代理挡住」的失败才重试（不是所有失败都闷头再来一次）',
  /worthDirectRetry\(first\.err\)/.test(syncSrc) && /function worthDirectRetry/.test(syncSrc));

check('★ 判定「像不像代理问题」：代理的连接失败算，别的一概不算',
  mod.isProxyTrouble("fatal: unable to access 'x': Failed to connect to github.com:443 over proxy 127.0.0.1 after 2050 ms: Could not connect to server") === true
  && mod.isProxyTrouble('fatal: not a git repository (or any of the parent directories): .git') === false
  && mod.isProxyTrouble("fatal: could not read Username for 'https://github.com': terminal prompts disabled") === false);

{
  // 一个真的没人监听的本地端口，当作「http 远端」；再让代理指向同样没人听的 9 端口
  const probeSrv = net.createServer();
  await new Promise((r) => probeSrv.listen(0, '127.0.0.1', r));
  const closedPort = probeSrv.address().port;
  await new Promise((r) => probeSrv.close(r));

  const PROXY_DIR = path.join(TMP, 'gitsync-proxy');
  fs.rmSync(PROXY_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROXY_DIR, { recursive: true });
  gitOK(['init', '-b', 'main'], PROXY_DIR);
  gitOK(['config', 'http.proxy', 'http://127.0.0.1:9'], PROXY_DIR);
  gitOK(['remote', 'add', 'origin', `http://127.0.0.1:${closedPort}/o.git`], PROXY_DIR);

  // 先证明这份配置真的会撞代理（裸 git 走一遍）
  const plainRun = spawnSync('git', ['ls-remote', '--heads', 'origin'],
    { cwd: PROXY_DIR, encoding: 'utf8', timeout: 60000 });
  check('（前提）裸 git 在这份配置下确实报「over proxy」',
    plainRun.status !== 0 && /over proxy/i.test(String(plainRun.stderr || '')),
    String(plainRun.stderr || '').split('\n').filter(Boolean)[0]?.slice(0, 80));

  const viaModule1 = mod.git(['ls-remote', '--heads', 'origin'], { cwd: PROXY_DIR, timeout: 60000 });
  check('★★ 走我们的实现：同一条命令会自动摘掉代理重试（报错里换成了直连目标，不再提代理）',
    /proxy/i.test(viaModule1.err) === false && mod.routeInfo().direct === true,
    String(viaModule1.err).split('\n').filter(Boolean)[0]?.slice(0, 80));

  const viaModule2 = mod.git(['ls-remote', '--heads', 'origin'], { cwd: PROXY_DIR, timeout: 60000 });
  check('★ 记住之后：后面每条命令第一次就直连（不再白等一次代理超时）',
    /proxy/i.test(viaModule2.err) === false,
    String(viaModule2.err).split('\n').filter(Boolean)[0]?.slice(0, 80));

  fs.rmSync(PROXY_DIR, { recursive: true, force: true });
}

{
  // 编辑器服务定时探头用的就是这条子命令：机读结果里要有 behind，前端靠它亮角标
  const f = spawnSync(NODE, [path.join(DST, 'tools/git/sync.mjs'), 'fetch', '--quiet', '--json'],
    { cwd: DST, encoding: 'utf8', timeout: 60000 });
  const line = String(f.stdout || '').split('\n').reverse().find((l) => l.startsWith('[result] '));
  let parsed = null;
  try { parsed = JSON.parse(String(line).slice('[result] '.length)); } catch { parsed = null; }
  check('★ fetch 子命令给出机读结果（编辑器每 5 分钟探头就是跑它）',
    f.status === 0 && parsed?.code === 'ok' && typeof parsed?.behind === 'number',
    `exit=${f.status} ${JSON.stringify(parsed)}`);
}

/* ================================================================ */
/* 收摊：先摘掉 node_modules 那个 junction（rmSync 会顺着它删掉真依赖！）再删副本 */
try {
  const j = path.join(DST, 'node_modules');
  if (fs.existsSync(j)) execFileSync('cmd', ['/c', 'rmdir', j], { stdio: 'ignore' });
  for (const p of [DST, OTHER, ORIGIN]) fs.rmSync(p, { recursive: true, force: true });
  console.log(`副本已清理: ${!fs.existsSync(DST) && !fs.existsSync(OTHER) && !fs.existsSync(ORIGIN)}`);
} catch (err) {
  console.log('副本没删干净（不影响结论）：', String(err.message ?? err).slice(0, 120));
}

console.log('\n================ 结果 ================');
console.log(`PASS ${pass}   FAIL ${fail}`);
if (fail > 0) process.exit(1);
