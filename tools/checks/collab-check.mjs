/*
 * ============================================================================
 * 便捷共享编辑器 —— 验收
 * ----------------------------------------------------------------------------
 * 用户 2026-10-12 的要求（原话）：
 *   「现在来制作一个非常重要的功能：便捷共享编辑器 … 可以让我的 github 的
 *     Collaborators 使用和我同款的编辑器 和我进行共创 请你帮我想一下用什么方法
 *     最方便且安全 和跟铃忆机器人的联动一样 需要先拉取远端再推流以保证安全
 *     并且因为可能会有多人实时同步进行编辑 所以最好可以在编辑器里实时提醒哪个
 *     用户何时进行了推流 另外仅有我的编辑器需要加一个方便快捷可视化的版本回滚功能
 *     以保证安全」
 *
 * 这个脚本按四条来量：
 *   ① 源码里的红线：没有强推 / 没有硬重置；两个新面板、六个新接口都在
 *   ② **真 git 仓库**（一个 bare 当远端 + 两份 clone 当两个人）：
 *        谁是谁（站长 / 协作者）、推流动态读得出来、两个人各改各的条目能自动合、
 *        真撞同一处会被拦下且**谁的东西都没丢**、版本列表 / 字段级差异 / 三种回滚
 *   ③ 真编辑器（起一个跑真仓库的服务）：身份 / 动态 / 版本接口；「不是站长」时版本接口 403；
 *        数据面板的指纹（rev）对不上时 409、force 才写得进去
 *   ④ 真浏览器（无头 Chrome）：顶栏按钮、两个面板画得出来、站长看得见「版本」、
 *        协作者**看不见**「版本」、全程没有 JS 异常
 *
 * ⚠ 这个脚本会碰真仓库里的两样东西，跑完一定还原（finally 里）：
 *      · tools/editor/.editor-identity.json（本机身份，本来就是不进仓库的）
 *      · src/data/iceberg.json（只为了造一次"盘上那份被人改过"，改完立刻还原）
 *   别的文件一个都不动；真仓库的远端**一次都不推**（发布流程在 ② 的临时 bare 上验）。
 *
 * 用法：node tools/checks/collab-check.mjs
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = path.join(SRC, '.tmp', 'collab-test');
const ORIGIN = path.join(TMP, 'origin.git');
const A = path.join(TMP, 'A');          // 站长
const B = path.join(TMP, 'B');          // 协作者
const SERVER = path.join(SRC, 'tools', 'editor', 'server.mjs');
const APPJS = path.join(SRC, 'tools', 'editor', 'ui', 'app.js');
const INDEX = path.join(SRC, 'tools', 'editor', 'ui', 'index.html');
const IDENTITY = path.join(SRC, 'tools', 'editor', '.editor-identity.json');
const ICEBERG = path.join(SRC, 'src', 'data', 'iceberg.json');
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const PORT = 4337;
const DEBUG_PORT = 9415;
const EDITOR = `http://127.0.0.1:${PORT}`;
const GIT_TOOLS = ['whoami.mjs', 'activity.mjs', 'merge-json.mjs', 'versions.mjs', 'sync.mjs'];
const NODE = process.execPath;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);
const read = (f) => fs.readFileSync(f, 'utf8');

/* ============================================================ ① 源码红线 */

console.log('=== ① 源码：红线 + 面板 / 接口都在 ===');
const serverSrc = read(SERVER);
const appSrc = read(APPJS);
const indexSrc = read(INDEX);

for (const f of GIT_TOOLS) {
  check(`新工具在：tools/git/${f}`, fs.existsSync(path.join(SRC, 'tools', 'git', f)));
}

/*
  ⚠ 只扫**真会执行的那些 git 调用**：`git([...])` / `git('...')` 里的字面量。
  注释里写「绝不 push -f」是讲解，不是执行（sync.mjs 的黑名单本身也写着这些字面）。
*/
const FORCE = [/(^|\s)-f$/, /^--force/, /^--force-with-lease$/, /^--mirror$/, /^\+/, /^--hard$/];
let unsafe = [];
for (const file of [...GIT_TOOLS.map((f) => `tools/git/${f}`), 'tools/editor/server.mjs']) {
  const src = read(path.join(SRC, file));
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;                  // 注释行不算
    for (const m of line.matchAll(/\bgit\(\s*\[([^\]]*)\]/g)) {
      const args = m[1].split(',').map((s) => s.trim().replace(/^['"`]|['"`]$/g, ''));
      for (const a of args) if (FORCE.some((re) => re.test(a))) unsafe.push(`${file}:${i + 1} ${a}`);
    }
    if (/\breset\s+--hard\b/.test(line) && !/^\s*(\*|\/\/)/.test(line)) unsafe.push(`${file}:${i + 1} reset --hard`);
    if (/\bclean\s+-[a-z]*f/.test(line) && !/^\s*(\*|\/\/)/.test(line)) unsafe.push(`${file}:${i + 1} clean -f`);
  });
}
check('★ 新代码里没有强推 / 硬重置 / 清工作区', unsafe.length === 0, unsafe.join(' | ') || '干净');

const ROUTES = ['/api/collab/me', '/api/git/activity', '/api/git/publish', '/api/versions', '/api/versions/detail', '/api/versions/rollback'];
const missingRoute = ROUTES.filter((r) => !serverSrc.includes(`route === '${r}'`));
check('★ 六个新接口都在服务端', missingRoute.length === 0, missingRoute.join(', ') || '都在');
check('★ 版本那三条接口都过 requireOwner()（不是站长直接 403）',
  (serverSrc.match(/requireOwner\(\)/g) || []).length >= 3 && /throw httpError\(403/.test(serverSrc));
check('★ 「版本」面板标了 ownerOnly，别人的工作台里不会出现',
  /id: 'versions'[\s\S]{0,80}ownerOnly: true/.test(appSrc) && /workspaceVisible/.test(appSrc));
check('★ 顶栏有「发布上线」和「动态」两颗按钮',
  indexSrc.includes('id="btn-publish"') && indexSrc.includes('id="btn-activity"'));
check('★ 发布上线走的是 sync.mjs publish（先拉后推那份实现）',
  /runGitCli\('publish'/.test(serverSrc));
check('★ 推流动态是读 git 记录来的，没有另起服务器',
  !/createServer/.test(read(path.join(SRC, 'tools', 'git', 'activity.mjs'))));
check('★ 三路 JSON 合并用的是语义合并（不是按行抄）',
  /mergeJson3/.test(read(path.join(SRC, 'tools', 'git', 'sync.mjs'))) && /idKeyed/.test(read(path.join(SRC, 'tools', 'git', 'merge-json.mjs'))));

/* ---- 协作者的上手入口：一键脚本 + 文档 ---- */
const cmdPath = path.join(SRC, '一起写.cmd');
check('★ 根目录有给协作者的一键启动脚本（一起写.cmd）', fs.existsSync(cmdPath));
if (fs.existsSync(cmdPath)) {
  const bytes = fs.readFileSync(cmdPath);
  const ascii = [...bytes].every((b) => b < 128);
  const crlf = bytes.includes(Buffer.from('\r\n'));
  check('★ 那个 .cmd 是纯 ASCII + CRLF（cmd.exe 按字节偏移读，中文会移位）', ascii && crlf, `ascii=${ascii} crlf=${crlf}`);
  check('★ 它真的去起编辑器（node tools\\editor\\server.mjs --open）',
    /node "tools\\editor\\server\.mjs" --open/.test(bytes.toString('utf8')));
}
const editorReadme = read(path.join(SRC, 'tools', 'editor', 'README.md'));
check('★ 编辑器文档里有「共享编辑器」这一节和协作者上手四步',
  /## 共享编辑器/.test(editorReadme) && /一起写\.cmd/.test(editorReadme) && /发布上线/.test(editorReadme));

/*
  给协作者**本人**看的那份教程（根目录 花涧堂共创编写教程.md）。
  量两件事：几个关键动作讲没讲到；里面的按钮名字和真界面对不对得上 ——
  文档最容易烂的地方就是"界面上那颗按钮早改名了，文档还写着老名字"。
  （这份文件最早叫「协作者怎么写页面.md」，2026-10-12 站长自己改成了现在这个名字。）
*/
const tutorialPath = path.join(SRC, '花涧堂共创编写教程.md');
check('★ 有一份给协作者本人看的教程（花涧堂共创编写教程.md）', fs.existsSync(tutorialPath));
if (fs.existsSync(tutorialPath)) {
  const t = read(tutorialPath);
  const steps = ['一起写.cmd', '拉远端', '保存并重新构建', '发布上线', '动态'];
  const miss = steps.filter((k) => !t.includes(k));
  check('★ 教程讲到那几个关键动作（启动 / 拉远端 / 保存并重新构建 / 发布上线 / 动态）',
    miss.length === 0, miss.join('、') || '都在');
  check('★ 教程里写清了「保存 ≠ 上线」（最多人搞错的那一步）', /保存\s*≠\s*上线/.test(t));
  /* 真界面里确实有这几个工作台（教程是按它们指路的） */
  const named = ['「页面」', '「协作」', '「独立页面」', '「子版块」'];
  check('★ 教程指的入口和编辑器真界面一致（页面 / 协作 / 独立页面 / 子版块）',
    named.every((n) => t.includes(n)) && named.slice(0, 2).every((n) => appSrc.includes(`label: '${n.replace(/[「」]/g, '')}'`)),
    named.filter((n) => !t.includes(n)).join('、') || '都在');
  /*
    页面工作台那排「＋ 文字 / ＋ 图片 / …」按钮的真来源是 app.js 里的 adders 表
    （不是 panelBtn，panelBtn 那批是别的工作台的按钮）—— 教程里那张表要把它全覆盖到。
  */
  const addersSrc = /const adders = \[([\s\S]*?)\n  \];/.exec(appSrc)?.[1] ?? '';
  const blockBtns = [...addersSrc.matchAll(/^\s*\['[a-z]+', '([^']+)'/gm)].map((m) => m[1]);
  const notInTutorial = blockBtns.filter((b) => !t.includes(`＋ ${b}`));
  check('★ 教程那张"内容块按钮表"覆盖了页面工作台上所有「＋ …」按钮',
    blockBtns.length >= 10 && notInTutorial.length === 0,
    `界面 ${blockBtns.length} 个（${blockBtns.join('、')}），教程缺：${notInTutorial.join('、') || '无'}`);
}

/* ============================================================ ② 真 git 仓库 */

console.log('\n===== ② 一个 bare 远端 + 站长 A / 协作者 B（真 git）=====');

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), code: r.status };
}
const git = (args, cwd) => run('git', args, cwd);
const must = (args, cwd) => {
  const r = git(args, cwd);
  if (!r.ok) throw new Error(`git ${args.join(' ')} 失败（${cwd}）：${r.err || r.out}`);
  return r.out;
};
/** 跑 tools/git 下的脚本，把 `[result] {…}` 读回来 */
const tool = (cwd, script, args = []) => {
  const r = run(NODE, [path.join('tools', 'git', script), ...args, '--json'], cwd);
  const marker = [...`${r.out}\n${r.err}`.split('\n')].reverse().find((l) => l.startsWith('[result] '));
  return { result: marker ? JSON.parse(marker.slice(9)) : null, out: `${r.out}\n${r.err}`, code: r.code };
};

const readJson = (p) => JSON.parse(read(p));
const writeJson = (p, v) => fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`, 'utf8');
const ICE = (dir) => path.join(dir, 'src', 'data', 'iceberg.json');

function setupRepos() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  must(['init', '--bare', '-b', 'main', ORIGIN], TMP);
  fs.mkdirSync(A, { recursive: true });
  must(['init', '-b', 'main'], A);
  must(['config', 'user.name', 'Chenxu-MarshEco'], A);
  must(['config', 'user.email', '1398894932@qq.com'], A);
  fs.mkdirSync(path.join(A, 'tools', 'git'), { recursive: true });
  for (const f of GIT_TOOLS) fs.copyFileSync(path.join(SRC, 'tools', 'git', f), path.join(A, 'tools', 'git', f));
  fs.mkdirSync(path.join(A, 'src', 'data'), { recursive: true });
  fs.mkdirSync(path.join(A, 'tools', 'editor'), { recursive: true });
  writeJson(ICE(A), {
    _readme: ['冰山图的数据'],
    updated: '2026-10-01',
    items: [
      { id: 'e1', title: '第一条', tags: ['甲'] },
      { id: 'e2', title: '第二条', tags: ['乙'] },
    ],
  });
  writeJson(path.join(A, 'src', 'data', 'site-copy.json'), { _readme: ['文案'], site: { tagline: '签名' } });
  must(['add', '-A'], A);
  must(['commit', '-m', '基线'], A);
  must(['remote', 'add', 'origin', ORIGIN], A);
  must(['push', '-u', 'origin', 'main'], A);

  must(['clone', ORIGIN, B], TMP);
  must(['config', 'user.name', 'SSWTLZZ69'], B);
  must(['config', 'user.email', '12345+SSWTLZZ69@users.noreply.github.com'], B);
}

const publish = (cwd, message) => {
  const r = run(NODE, ['tools/git/sync.mjs', 'publish', '--message', message, '--json'], cwd);
  const marker = [...`${r.out}\n${r.err}`.split('\n')].reverse().find((l) => l.startsWith('[result] '));
  return { result: marker ? JSON.parse(marker.slice(9)) : null, out: `${r.out}\n${r.err}` };
};

setupRepos();
check('临时仓库造好了（bare + 两份 clone）', fs.existsSync(path.join(A, '.git')) && fs.existsSync(path.join(B, '.git')));

/* ---- 谁是谁：把 origin 换成 github 形状（不联网，只看解析和比对） ---- */
must(['remote', 'set-url', 'origin', 'https://github.com/Chenxu-MarshEco/Chenxu-MarshEco.github.io.git'], A);
writeJson(path.join(A, 'tools', 'editor', '.editor-identity.json'), { login: 'Chenxu-MarshEco', name: '阿煦' });
const meA = tool(A, 'whoami.mjs').result;
check('★ 站长这台机器认得自己是站长', meA?.owner === true && meA.login === 'Chenxu-MarshEco', JSON.stringify({ owner: meA?.owner, login: meA?.login }));
writeJson(path.join(A, 'tools', 'editor', '.editor-identity.json'), { login: 'SSWTLZZ69', name: 'SSW' });
const meB = tool(A, 'whoami.mjs').result;
check('★ 协作者那台机器认得自己不是站长（owner=false）', meB?.owner === false, JSON.stringify({ owner: meB?.owner }));
fs.rmSync(path.join(A, 'tools', 'editor', '.editor-identity.json'), { force: true });
fs.writeFileSync(path.join(A, 'tools', 'editor', '.editor-identity.json'), '{}\n', 'utf8');
/*
  身份文件里没用户名时，whoami 会去问 `gh api user`（本机装着 gh）—— 那会把"没填用户名"
  测成"就是站长"。所以先把那份缓存写成"谁都问不出来"，模拟一台没装 gh 的机器。
*/
fs.mkdirSync(path.join(A, '.tmp'), { recursive: true });
fs.writeFileSync(path.join(A, '.tmp', 'whoami-cache.json'), `${JSON.stringify({ at: Date.now(), login: '' }, null, 2)}\n`, 'utf8');
const meGhost = tool(A, 'whoami.mjs').result;
check('★ 没填用户名时 owner 是"不知道"，不是"是"（少给权限永远安全）',
  meGhost?.owner === null || meGhost?.owner === false, JSON.stringify({ owner: meGhost?.owner, login: meGhost?.login }));
fs.rmSync(path.join(A, 'tools', 'editor', '.editor-identity.json'), { force: true });
fs.rmSync(path.join(A, '.tmp'), { recursive: true, force: true });
must(['remote', 'set-url', 'origin', ORIGIN], A);

/*
  origin 不是 GitHub 地址（本地克隆 / 镜像 / 自己搭的 git 服务）时，认不出仓库所属者。
  这时候**不能**一口咬定"你不是站长"（第一版在本地克隆上就是那么误报的），应该说"不知道"，
  并且给站长留一条出路：在本机身份文件里自己声明一句（编辑器「协作」面板里那个勾）。
*/
const ghostId = path.join(A, 'tools', 'editor', '.editor-identity.json');
writeJson(ghostId, { login: 'Chenxu-MarshEco', name: '阿煦' });
const meLocal = tool(A, 'whoami.mjs').result;
check('★ origin 不是 GitHub 地址时，owner 是"不知道"，不是"你不是站长"',
  meLocal?.owner === null && meLocal?.ownerSource === '', JSON.stringify({ owner: meLocal?.owner, src: meLocal?.ownerSource }));
writeJson(ghostId, { login: 'Chenxu-MarshEco', name: '阿煦', owner: true });
const meDecl = tool(A, 'whoami.mjs').result;
check('★ 本机可以自己声明"这台机器就是站长"（认不出所属者时的出路）',
  meDecl?.owner === true && meDecl?.ownerSource === 'identity', JSON.stringify({ owner: meDecl?.owner, src: meDecl?.ownerSource }));
fs.rmSync(ghostId, { force: true });

/* ---- 推流动态：A 推完，B 那边看得见 ---- */
const a1 = readJson(ICE(A));
a1.items[0].title = '第一条（A 改的）';
a1.updated = '2026-10-12';
writeJson(ICE(A), a1);
const pubA = publish(A, '阿煦改冰山');
check('A 推流成功', pubA.result?.code === 'ok', JSON.stringify(pubA.result));

const actB = tool(B, 'activity.mjs', ['--limit', '5', '--no-api']).result;
const top = actB?.commits?.[0];
check('★ B 那边读得到"谁 · 什么时候 · 推了什么"', Boolean(top), JSON.stringify(actB?.commits?.map((c) => c.short) || []));
check('★ 认得出是哪一版（提交号 / 时间 / 署名）',
  top?.short?.length === 7 && Boolean(top.iso) && top.author?.name === 'Chenxu-MarshEco', JSON.stringify({ short: top?.short, who: top?.author?.name }));
check('★ 说得出"改了哪几块"（文件 → 面板名）', (top?.panels || []).includes('冰山图'), JSON.stringify(top?.panels));

/* ---- 各改各的条目：按 JSON 结构自动合 ---- */
const b1 = readJson(ICE(B));
b1.items[1].title = '第二条（SSW 改的）';
b1.items.push({ id: 'e3', title: 'SSW 加的第三条', tags: [] });
writeJson(ICE(B), b1);
const pubB = publish(B, 'SSW 改冰山');
check('★ B 也推得上去（先拉后推）', pubB.result?.code === 'ok', JSON.stringify(pubB.result));
must(['pull', '--ff-only'], A);
const merged = readJson(ICE(A));
check('★ 两个人各改各的条目：两边的内容都在，谁都没被盖掉',
  merged.items[0].title.includes('A 改的') && merged.items[1].title.includes('SSW 改的') && merged.items.some((x) => x.id === 'e3'),
  JSON.stringify(merged.items.map((x) => x.title)));
check('★ 协作者那一条动态：从 noreply 邮箱还原出了用户名（头像是拿它拼的）',
  tool(B, 'activity.mjs', ['--limit', '5', '--no-api']).result?.commits?.find((c) => c.author.name === 'SSWTLZZ69')?.author?.login === 'SSWTLZZ69');

/* ---- 真撞同一处：拦下、谁都不丢、远端不动 ---- */
const a2 = readJson(ICE(A));
a2.items[0].title = 'A 的版本';
writeJson(ICE(A), a2);
publish(A, 'A 再改第一条');
/* ⚠ 要在 A 推完之后再记远端的样子：这一条量的就是"B 那次被拦下，一个字节都没上去" */
const remoteBefore = must(['ls-remote', 'origin', 'refs/heads/main'], B);
const b2 = readJson(ICE(B));
b2.items[0].title = 'B 的版本';
writeJson(ICE(B), b2);
const pubB2 = publish(B, 'B 改同一处');
check('★ 真撞到同一个字段时被拦下（不硬着头皮合）', pubB2.result?.code === 'conflict', JSON.stringify({ code: pubB2.result?.code }));
check('★ 拦下时说得清是哪一份的哪个字段',
  /items\[id:e1\]/.test(JSON.stringify(pubB2.result?.jsonBlocked || [])), JSON.stringify(pubB2.result?.jsonBlocked?.[0]?.why || ''));
check('★ 远端一个字节都没动（一次都没推上去）', must(['ls-remote', 'origin', 'refs/heads/main'], B) === remoteBefore);
check('★ B 本地那个提交还在（没被 rebase --abort 弄丢）', readJson(ICE(B)).items[0].title === 'B 的版本');
check('★ 没有卡在合并中间', !fs.existsSync(path.join(B, '.git', 'rebase-merge')) && !fs.existsSync(path.join(B, '.git', 'rebase-apply')));
/* 把 B 那次没推上去的提交丢掉（一次性临时仓库，reset --hard 只影响它），再和远端对齐 */
must(['reset', '--hard', 'HEAD~1'], B);
must(['pull', '--ff-only'], B);

/* ---- 版本：列表 / 字段级差异 ---- */
const tipA = must(['rev-parse', 'HEAD'], B);        // A 的第二次改动（items[0] = "A 的版本"）
const tipB = must(['rev-parse', 'HEAD~1'], B);      // B 那一次（items[1] + 新加的 e3）
const vers = tool(B, 'versions.mjs', ['--limit', '5']).result;
check('★ 版本列表读得出来（新的在前，带面板名和增删行数）',
  (vers?.commits?.length || 0) >= 3 && typeof vers.commits[0].stat?.add === 'number',
  JSON.stringify((vers?.commits || []).map((c) => c.short)));
const detail = tool(B, 'versions.mjs', ['--detail', tipB]).result;
const icebergDiff = (detail?.files || []).find((f) => f.file === 'src/data/iceberg.json');
check('★ 字段级差异：说得出"哪个字段从什么变成什么"',
  Boolean(icebergDiff?.changes?.length) && icebergDiff.changes.some((c) => /items\[id:e[23]\]/.test(c.path)),
  JSON.stringify((icebergDiff?.changes || []).slice(0, 3).map((c) => `${c.path}: ${c.before}→${c.after}`)));
check('★ 差异里给的是人话（不是 diff 的 +++---）', !JSON.stringify(icebergDiff?.changes || []).includes('@@'));

/* ---- 版本：三种回滚（每种都真的动到内容，再推上去回到干净状态）---- */
const countBefore = Number(must(['rev-list', '--count', 'HEAD'], B));

const rTo = tool(B, 'versions.mjs', ['--rollback', tipB, '--mode', 'to']).result;
check('★ 「恢复到这一版」：这一版之后的改动被抵消掉',
  rTo?.ok === true && readJson(ICE(B)).items[0].title === '第一条（A 改的）',
  JSON.stringify({ ok: rTo?.ok, title: readJson(ICE(B)).items[0].title, error: rTo?.error }));
check('★ 回滚之后还能照常推流上线', publish(B, '回滚到 B 那一版').result?.code === 'ok');

const rFile = tool(B, 'versions.mjs', ['--rollback', tipA, '--mode', 'file', '--file', 'src/data/iceberg.json']).result;
check('★ 「只恢复这一份数据」：那一份回到指定那一版的样子',
  rFile?.ok === true && readJson(ICE(B)).items[0].title === 'A 的版本',
  JSON.stringify({ ok: rFile?.ok, title: readJson(ICE(B)).items[0].title, error: rFile?.error }));
check('★ 恢复之后也能照常推流上线', publish(B, '只恢复冰山那一份').result?.code === 'ok');

const rCommit = tool(B, 'versions.mjs', ['--rollback', tipB, '--mode', 'commit']).result;
const afterCommit = readJson(ICE(B));
check('★ 「撤销这一次」：只抵消那一次（B 加的条目没了，别人的改动还在）',
  rCommit?.ok === true && afterCommit.items.length === 2 && afterCommit.items[1].title === '第二条',
  JSON.stringify({ ok: rCommit?.ok, items: afterCommit.items.map((x) => x.title), error: rCommit?.error }));
check('★ 撤销之后照样推得上去', publish(B, '撤销 B 那一次').result?.code === 'ok');

check('★ 回滚是**往前加提交**，不是改写历史（老提交还在，提交数只增不减）',
  Number(must(['rev-list', '--count', 'HEAD'], B)) > countBefore
  && git(['merge-base', '--is-ancestor', tipB, 'HEAD'], B).ok,
  `${countBefore} → ${must(['rev-list', '--count', 'HEAD'], B)}`);
check('★ 回滚的代码里没有强推 / 硬重置（自带红线）',
  !/reset\s+--hard/.test(read(path.join(SRC, 'tools', 'git', 'versions.mjs'))));

/* ---- 全程没有强推 ---- */
const reflog = must(['reflog', 'show', '--all'], ORIGIN);
check('★ 远端 reflog 里没有 forced-update（全程没强推过）', !/forced-update/.test(reflog), reflog.split('\n').length + ' 行');

/* ============================================================ ③ 真编辑器 + ④ 真浏览器 */

console.log('\n===== ③ 真编辑器（接口）=====');
const identityBackup = fs.existsSync(IDENTITY) ? read(IDENTITY) : null;
const icebergBackup = read(ICEBERG);
/*
  「近期更新」也要备份：下面那一发 force 保存会真的写盘，并顺手往这张表里记一笔「冰山图」。
  跑完一起还原，不然验收自己就成了噪声（第一次跑就是这么留下一处 diff 的）。
*/
const recentFile = path.join(SRC, 'src', 'data', 'recent-edits.json');
const recentBackup = fs.existsSync(recentFile) ? read(recentFile) : null;
let editor = null;
let chrome = null;
let profile = '';

const api = (p, body) =>
  new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request(
      `${EDITOR}${p}`,
      { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            /* 非 JSON */
          }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });

try {
  editor = spawn(NODE, [SERVER, '--port', String(PORT)], { cwd: SRC, stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 60 && !up; i += 1) {
    await sleep(400);
    try {
      up = (await api('/api/collab/me')).status === 200;
    } catch {
      /* 还没起来 */
    }
  }
  if (!up) throw new Error(`编辑器 ${PORT} 没起来`);
  info(`编辑器起来了（${EDITOR}）`);

  const me = await api('/api/collab/me');
  check('★ /api/collab/me：这台机器是谁 + 是不是站长 + 有没有构建环境',
    me.status === 200 && typeof me.json?.me?.login === 'string' && typeof me.json.rollback === 'boolean' && typeof me.json.buildEnv === 'boolean',
    JSON.stringify({ login: me.json?.me?.login, owner: me.json?.me?.owner, rollback: me.json?.rollback }));

  /*
    「冷机器」那条路（2026-10-12 修的一个真 bug）：
    服务端原来会在请求里同步起 `gh api user` 问用户名 —— gh 慢起来好几秒，而编辑器服务是
    **单线程**的，那一会儿保存 / 预览 / 上传全堵在后面（连验收脚本都跟着红：
    页面还没初始化完，脚本派的 input 事件根本没接上）。
    现在改成**绝不在请求里起 gh**：先用本机身份文件 / 缓存 / git config 回话，
    同时在后台起一个 CLI 子进程把缓存捂热，页面过两三秒自己再问一次。
    这条量两件事：冷的那一次**很快**（没去问 gh）、过几秒用户名真的到位了。
  */
  const idCacheFile = path.join(SRC, '.tmp', 'whoami-cache.json');
  const idCacheSaved = fs.existsSync(idCacheFile) ? read(idCacheFile) : null;
  const collabIdSaved = fs.existsSync(IDENTITY) ? read(IDENTITY) : null;
  try {
    fs.rmSync(idCacheFile, { force: true });
    fs.rmSync(IDENTITY, { force: true });   // 身份文件里没有 login，才会走到"问 gh"那一步
    const t0 = Date.now();
    const cold = await api('/api/collab/me');
    const ms = Date.now() - t0;
    check('★ 冷机器上第一次问身份不卡（服务端绝不在请求里起 gh）',
      cold.status === 200 && ms < 900, `${ms} ms`);
    let warmed = '';
    for (let i = 0; i < 14 && !warmed; i += 1) {
      await sleep(500);
      const r = await api('/api/collab/me');
      if (r.json?.me?.login) warmed = r.json.me.login;
    }
    check('★ 后台那次 CLI 把用户名捂热了（过几秒就有身份了，界面不用刷新）',
      Boolean(warmed), warmed || '（没等到，可能这台机器没登录 gh）');
  } finally {
    if (idCacheSaved === null) fs.rmSync(idCacheFile, { force: true });
    else fs.writeFileSync(idCacheFile, idCacheSaved, 'utf8');
    if (collabIdSaved === null) fs.rmSync(IDENTITY, { force: true });
    else fs.writeFileSync(IDENTITY, collabIdSaved, 'utf8');
  }

  const act = await api('/api/git/activity?limit=5');
  check('★ /api/git/activity：读得到最近谁推了什么',
    act.status === 200 && Array.isArray(act.json?.commits) && act.json.commits.length > 0 && Array.isArray(act.json.commits[0].panels),
    JSON.stringify({ n: act.json?.commits?.length, first: act.json?.commits?.[0]?.short }));

  const vs = await api('/api/versions?limit=5');
  check('★ /api/versions：站长读得到版本列表', vs.status === 200 && (vs.json?.commits?.length || 0) > 0, JSON.stringify(vs.json?.error || vs.json?.commits?.length));

  /* ---- 换成"协作者"这台机器：版本接口必须 403 ---- */
  fs.writeFileSync(IDENTITY, `${JSON.stringify({ login: 'SSWTLZZ69', name: 'SSW' }, null, 2)}\n`, 'utf8');
  /* whoami 里登录名有 12 小时缓存，所以直接把缓存也写成 SSWTLZZ69，免得它又去问 gh */
  const cacheFile = path.join(SRC, '.tmp', 'whoami-cache.json');
  const cacheBackup = fs.existsSync(cacheFile) ? read(cacheFile) : null;
  fs.writeFileSync(cacheFile, `${JSON.stringify({ at: Date.now(), login: 'SSWTLZZ69' }, null, 2)}\n`, 'utf8');
  try {
    const vsB = await api('/api/versions?limit=5');
    check('★ 协作者的编辑器读版本接口 → 403（只有站长能用回滚）',
      vsB.status === 403 && /只有站长/.test(String(vsB.json?.error || '')), JSON.stringify({ status: vsB.status, error: vsB.json?.error }));
    const rbB = await api('/api/versions/rollback', { sha: 'HEAD', mode: 'to' });
    check('★ 协作者连回滚接口也调不动（403）', rbB.status === 403, JSON.stringify({ status: rbB.status }));
    const meB2 = await api('/api/collab/me');
    check('★ 协作者那台机器 rollback=false（界面上不会长出那个面板）', meB2.json?.rollback === false, JSON.stringify({ rollback: meB2.json?.rollback }));
  } finally {
    if (identityBackup === null) fs.rmSync(IDENTITY, { force: true });
    else fs.writeFileSync(IDENTITY, identityBackup, 'utf8');
    if (cacheBackup === null) fs.rmSync(cacheFile, { force: true });
    else fs.writeFileSync(cacheFile, cacheBackup, 'utf8');
  }

  /* ---- 数据面板的指纹（rev）：对不上 409，force 才写得进去 ---- */
  const got = await api('/api/iceberg');
  const rev = got.json?.rev;
  check('★ 读数据时带回了指纹（rev）', typeof rev === 'string' && rev.length >= 8, String(rev));
  const payload = { ...got.json };
  delete payload.rev;
  /* 造一次"盘上那份被人改过"：改 updated，马上还原 */
  const changed = JSON.parse(icebergBackup);
  changed.updated = '2099-01-01';
  fs.writeFileSync(ICEBERG, `${JSON.stringify(changed, null, 2)}\n`, 'utf8');
  try {
    const stale = await api('/api/iceberg', { ...payload, rev });
    check('★ 别人改过之后，拿旧指纹保存被拦下（409 + stale）',
      stale.status === 409 && stale.json?.stale === true, JSON.stringify({ status: stale.status, stale: stale.json?.stale }));
    const forced = await api('/api/iceberg', { ...payload, rev, force: true });
    check('★ 明确选「用我这份覆盖」才写得进去（force）', forced.status === 200, JSON.stringify({ status: forced.status }));
  } finally {
    fs.writeFileSync(ICEBERG, icebergBackup, 'utf8');
    if (recentBackup === null) fs.rmSync(recentFile, { force: true });
    else fs.writeFileSync(recentFile, recentBackup, 'utf8');
  }
  check('★ 造完那一份"被别人改过"之后，真仓库的数据一个字节都没变',
    read(ICEBERG) === icebergBackup);

  console.log('\n===== ④ 真浏览器：两个面板 + 协作者看不到「版本」=====');
  profile = path.join(process.env.TEMP ?? '.', `dsh-collab-${Date.now()}`);
  chrome = spawn(
    CHROME,
    ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--mute-audio', '--disable-breakpad',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
    { stdio: 'ignore' },
  );
  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {
      /* 等 */
    }
  }
  if (!target) throw new Error('无头 Chrome 没起来');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
  });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
    if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails?.text).slice(0, 140));
    if (m.method === 'Page.javascriptDialogOpening') ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
  });
  const send = (method, params = {}) => {
    const n = ++id;
    ws.send(JSON.stringify({ id: n, method, params }));
    return new Promise((resolve, reject) => pending.set(n, { resolve, reject }));
  };
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} :: ${String(expr).slice(0, 80)}`);
    return r.result.value;
  };
  const loadPage = async () => {
    await send('Page.navigate', { url: `${EDITOR}/` });
    for (let i = 0; i < 150; i += 1) {
      await sleep(120);
      try {
        if ((await ev('document.readyState')) === 'complete') break;
      } catch {
        /* 还在导航 */
      }
    }
    await sleep(2000);
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await loadPage();

  check('★ 顶栏画出了「发布上线」和「动态」两颗按钮',
    await ev(`Boolean(document.querySelector('#btn-publish') && document.querySelector('#btn-activity'))`));
  const menu = await ev(`(() => { document.querySelector('#btn-hub').click(); return JSON.stringify([...document.querySelectorAll('#hub-menu-list button')].map(b => b.dataset.ws)); })()`);
  check('★ 站长的工作台里有「协作」和「版本」', menu.includes('"collab"') && menu.includes('"versions"'), menu);

  const opened = await ev(`(() => {
      const b = document.querySelector('#hub-menu-list button[data-ws="collab"]');
      if (!b) return '没有协作入口';
      b.click();
      return 'ok';
    })()`);
  await sleep(2500);
  check('★ 能打开「协作」面板', opened === 'ok', String(opened));
  const collab = await ev(`(() => {
      const host = document.querySelector('#collab-editor');
      if (!host) return null;
      return JSON.stringify({
        boxes: [...host.querySelectorAll('.wbox__title')].map((x) => x.textContent),
        feed: host.querySelectorAll('.feed__item').length,
        fields: [...host.querySelectorAll('[data-collab-field]')].map((x) => x.dataset.collabField),
        who: (host.querySelector('.who__text strong') || {}).textContent || '',
        status: (host.querySelector('.wpanel__status') || {}).textContent || '',
      });
    })()`);
  const C = collab ? JSON.parse(collab) : null;
  check('★ 协作面板四块都在：我是谁 / 推流动态 / 发布上线 / 这台机器',
    (C?.boxes || []).join(',') === '我是谁,推流动态,发布上线,这台机器', JSON.stringify(C?.boxes));
  check('★ 推流动态列出来了（≥3 条）', (C?.feed || 0) >= 3, `feed=${C?.feed}`);
  check('★ 身份输入框都在（用户名 / 显示名 / 邮箱 + 「这台机器就是站长」那个勾）',
    (C?.fields || []).join(',') === 'login,name,email,owner', JSON.stringify(C?.fields));
  check('★ 面板上写清了"你是站长"', /站长/.test(C?.status || ''), C?.status);

  const vopened = await ev(`(() => {
      document.querySelector('#btn-hub').click();
      const b = document.querySelector('#hub-menu-list button[data-ws="versions"]');
      if (!b) return '没有版本入口';
      b.click();
      return 'ok';
    })()`);
  await sleep(3500);
  check('★ 站长能打开「版本」面板', vopened === 'ok', String(vopened));
  const ver = await ev(`(() => {
      const host = document.querySelector('#versions-editor');
      if (!host) return null;
      return JSON.stringify({
        boxes: [...host.querySelectorAll('.wbox__title')].map((x) => x.textContent),
        list: host.querySelectorAll('.vlist__item').length,
        picked: host.querySelectorAll('.vlist__item.is-picked').length,
        diffs: host.querySelectorAll('.vdiff').length,
        buttons: [...host.querySelectorAll('.wpanel__bar .btn')].map((b) => b.textContent),
      });
    })()`);
  const V = ver ? JSON.parse(ver) : null;
  check('★ 版本面板：选一版 + 这一版改了什么', (V?.boxes || []).join(',') === '选一版,这一版改了什么', JSON.stringify(V?.boxes));
  check('★ 版本列表列出来了（≥5 版）', (V?.list || 0) >= 5, `list=${V?.list}`);
  check('★ 默认选中最新一版，右边把这一版改了什么画出来了', (V?.picked || 0) === 1 && (V?.diffs || 0) >= 1, `picked=${V?.picked} diffs=${V?.diffs}`);
  check('★ 三种回滚的按钮都在（恢复到这一版 / 撤销这一次 / 只恢复选中的那份数据）',
    ['恢复到这一版', '撤销这一次', '只恢复选中的那份数据'].every((t) => (V?.buttons || []).includes(t)), JSON.stringify(V?.buttons));

  /* ---- 换成协作者的身份再看一眼：工作台里不该有「版本」 ---- */
  fs.writeFileSync(IDENTITY, `${JSON.stringify({ login: 'SSWTLZZ69', name: 'SSW' }, null, 2)}\n`, 'utf8');
  const cacheFile2 = path.join(SRC, '.tmp', 'whoami-cache.json');
  const cacheBackup2 = fs.existsSync(cacheFile2) ? read(cacheFile2) : null;
  fs.writeFileSync(cacheFile2, `${JSON.stringify({ at: Date.now(), login: 'SSWTLZZ69' }, null, 2)}\n`, 'utf8');
  try {
    await loadPage();
    const menu2 = await ev(`(() => { document.querySelector('#btn-hub').click(); return JSON.stringify([...document.querySelectorAll('#hub-menu-list button')].map(b => b.dataset.ws)); })()`);
    check('★ 协作者的工作台里**没有**「版本」这一项', !menu2.includes('"versions"'), menu2);
    check('★ 但「协作」面板照样有（推流动态人人都有）', menu2.includes('"collab"'), menu2);
  } finally {
    if (identityBackup === null) fs.rmSync(IDENTITY, { force: true });
    else fs.writeFileSync(IDENTITY, identityBackup, 'utf8');
    if (cacheBackup2 === null) fs.rmSync(cacheFile2, { force: true });
    else fs.writeFileSync(cacheFile2, cacheBackup2, 'utf8');
  }

  check('★ 全程没有 JS 异常', errors.length === 0, errors.join(' | ') || '干净');
} finally {
  try { chrome?.kill(); } catch { /* 忽略 */ }
  try { editor?.kill(); } catch { /* 忽略 */ }
  /* 真仓库的两样东西一定还原（身份文件 / 冰山数据） */
  if (identityBackup === null) fs.rmSync(IDENTITY, { force: true });
  else { try { fs.writeFileSync(IDENTITY, identityBackup, 'utf8'); } catch { /* 忽略 */ } }
  fs.writeFileSync(ICEBERG, icebergBackup, 'utf8');
  if (recentBackup === null) fs.rmSync(recentFile, { force: true });
  else { try { fs.writeFileSync(recentFile, recentBackup, 'utf8'); } catch { /* 忽略 */ } }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome 还占着就下次再说 */ }
}

console.log(`\n${pass} pass / ${fail} fail`);
process.exitCode = fail ? 1 : 0;
