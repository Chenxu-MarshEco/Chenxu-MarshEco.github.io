/*
 * ============================================================================
 * 发布门卫的验收（2026-10-06）
 * ----------------------------------------------------------------------------
 * 用户的要求：「SSW的机器人每天都需要推送文章 让它推送到铃忆的冰室日记的文章
 * 无需同意也能推送 但是删改其他页面需要同意」。
 * 规则落在两处：
 *   · tools/publish/gate.mjs                —— 判定逻辑 + 按文件放行的 ALLOW 数组
 *   · tools/publish/trusted.json            —— 免审名单（按人放行：协作者推什么都直接发布）
 *   · .github/workflows/deploy.yml 的 gate job —— 把这次推送的上下文喂给它，
 *     放行才构建、才发布
 * 这支脚本量两件事：
 *   ① **工作流本身**：YAML 能不能解析、gate job 有没有接上、build/deploy 是不是
 *      真的挂在 gate 后面、有没有"只发 main"的闸、有没有混进 TAB
 *   ② **判定逻辑**：真跑那个脚本，把**机器人历史上真实推过的每一次**都过一遍
 *      （从 git log 里现取，不是写死的样例），再试一遍各种越界情况
 *
 * 用法：node tools/checks/publish-gate-check.mjs
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const WORKFLOW = '.github/workflows/deploy.yml';
const GATE = 'tools/publish/gate.mjs';
const REPO = 'Chenxu-MarshEco/Chenxu-MarshEco.github.io';

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

/* ============================================================================
   ① 工作流：语法 + 接线
   ============================================================================ */
console.log('=== ① 工作流（.github/workflows/deploy.yml）===');
const yml = fs.readFileSync(WORKFLOW, 'utf8');

/* js-yaml 只躺在 pnpm 的仓库目录里，没有顶层软链 —— 找到哪个就用哪个，找不到就跳过这条 */
const yamlLoader = (() => {
  const pnpmDir = path.resolve('node_modules', '.pnpm');
  if (!fs.existsSync(pnpmDir)) return null;
  const hit = fs
    .readdirSync(pnpmDir)
    .filter((d) => d.startsWith('js-yaml@'))
    .map((d) => path.resolve(pnpmDir, d, 'node_modules', 'js-yaml'))
    .find((p) => fs.existsSync(path.join(p, 'package.json')));
  if (!hit) return null;
  try {
    /* ⚠ 必须是**绝对路径**：require 拿到相对路径会当成包名去 node_modules 里找，永远找不到 */
    return createRequire(path.resolve('x.js'))(hit);
  } catch {
    return null;
  }
})();

let doc = null;
if (yamlLoader) {
  try {
    doc = yamlLoader.load(yml);
    check('工作流的 YAML 能被解析（语法没错）', !!doc && typeof doc === 'object');
  } catch (err) {
    check('工作流的 YAML 能被解析（语法没错）', false, String(err.message).split('\n')[0]);
  }
} else {
  info('没找到 js-yaml（pnpm 目录里也没有），跳过 YAML 解析那一条，只做结构检查');
}
check('文件里没有 TAB（YAML 里混 TAB 必崩）', !/\t/.test(yml));
check('触发器是「推到 main」+「可以手动点」', /push:\s*\n\s*branches:\s*\[main\]/.test(yml) && /workflow_dispatch:/.test(yml));

const jobs = doc?.jobs ?? null;
if (jobs) {
  check('有一个叫 gate 的 job', !!jobs.gate, Object.keys(jobs).join(' / '));
  const gateRuns = (jobs.gate?.steps ?? []).map((s) => String(s.run ?? '')).join('\n');
  check('gate 里真的跑了那个判定脚本', gateRuns.includes(GATE), gateRuns.trim().split('\n').pop());
  const env = (jobs.gate?.steps ?? []).find((s) => String(s.run ?? '').includes(GATE))?.env ?? {};
  const need = ['GITHUB_TOKEN', 'GITHUB_REPOSITORY', 'GITHUB_ACTOR', 'GITHUB_EVENT_NAME', 'PUSH_BEFORE', 'PUSH_AFTER'];
  check(
    '判定需要的六样上下文都喂进去了',
    need.every((k) => k in env),
    need.filter((k) => !(k in env)).join(' / ') || need.join(' / ')
  );
  check('build 挂在 gate 后面（拦住就不构建）', jobs.build?.needs === 'gate', String(jobs.build?.needs));
  check('deploy 挂在 build 后面', jobs.deploy?.needs === 'build', String(jobs.deploy?.needs));
  const mainOnly = (j) => String(j?.if ?? '').includes("github.ref == 'refs/heads/main'");
  check('build 只认 main（别的分支手动跑一次不会发布）', mainOnly(jobs.build), String(jobs.build?.if));
  check('deploy 也只认 main', mainOnly(jobs.deploy), String(jobs.deploy?.if));
  check('deploy 仍然要 Pages 的那几项权限', /pages:\s*write/.test(yml) && /id-token:\s*write/.test(yml));
} else {
  info('（YAML 没解析出来，跳过 gate / needs / if 那几条结构检查）');
}

/* ============================================================================
   ② 判定逻辑：真跑脚本
   ============================================================================ */
console.log('\n=== ② 判定逻辑（真跑 tools/publish/gate.mjs）===');

function runGate({ actor, event, files, before, after, token = '' }) {
  const args = [GATE];
  if (actor !== undefined) args.push('--actor', actor);
  if (event) args.push('--event', event);
  /* ⚠ 用 "参数在不在" 判断，别用值真不真：空清单是合法输入（值就是空字符串） */
  if (files !== undefined) args.push('--files', Array.isArray(files) ? files.join('\n') : files);
  if (before !== undefined) args.push('--before', before);
  if (after !== undefined) args.push('--after', after);
  args.push('--json');
  const r = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: token, GITHUB_ACTOR: '', GITHUB_EVENT_NAME: '' },
  });
  const m = /\[result\] (.*)/.exec(r.stdout ?? '');
  return { code: r.status, result: m ? JSON.parse(m[1]) : null, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/* ---- 2a. 机器人历史上真的推过的每一次，都必须放行 ---- */
const botLog = spawnSync('git', ['log', '--author=SSWTLZZ69', '--format=%H|%s', '-30'], { encoding: 'utf8' });
const commits = (botLog.stdout ?? '')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => {
    const i = l.indexOf('|');
    return { sha: l.slice(0, i), subject: l.slice(i + 1) };
  });
info(`git 历史里机器人（SSWTLZZ69）一共 ${commits.length} 次推送`);
check('历史里找得到机器人的推送（不然这段验收是空的）', commits.length > 0, `${commits.length} 次`);
let allReal = true;
for (const c of commits) {
  const show = spawnSync('git', ['show', '--name-only', '--format=', c.sha], { encoding: 'utf8' });
  const files = (show.stdout ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  const r = runGate({ actor: 'SSWTLZZ69', event: 'push', files, before: 'aaaa', after: 'bbbb' });
  const ok = r.code === 0 && r.result?.allow === true;
  if (!ok) allReal = false;
  check(
    `机器人的真实一次推送放行：${c.subject.slice(0, 26)}`,
    ok,
    `${files.length} 个文件 → ${r.result?.allow ? '允许' : '拦住：' + (r.result?.bad ?? []).join(' ')}`
  );
}

/* ---- 2b. 各种越界 / 边界 ---- */
const cases = [
  {
    name: '机器人只改日记正文（手记）→ 放行',
    args: { actor: 'SSWTLZZ69', event: 'push', files: ['src/content/notes/2026-10-06-something.md'] },
    allow: true,
  },
  {
    name: '机器人删掉一条手记 → 放行（删也是日记自己的事）',
    args: { actor: 'SSWTLZZ69', event: 'push', files: ['src/content/notes/2026-10-04-ningbo.md'] },
    allow: true,
  },
  {
    name: '机器人传日记配图（日期开头的图）→ 放行',
    args: { actor: 'SSWTLZZ69', event: 'push', files: ['public/img/uploads/20261006-01nikki-new.jpg'] },
    allow: true,
  },
  {
    name: '机器人顺手更新「最近编辑」那张表 → 放行（编辑器保存时自动写的）',
    args: { actor: 'SSWTLZZ69', event: 'push', files: ['src/data/recent-edits.json'] },
    allow: true,
  },
  {
    name: '一个谁都不是的账号碰首页版块数据（home-boards.json）→ **拦住**',
    args: { actor: 'random-guest', event: 'push', files: ['src/data/home-boards.json'] },
    allow: false,
    badIncludes: 'src/data/home-boards.json',
  },
  {
    name: '一个谁都不是的账号改了别的页面（index.astro）→ **拦住**',
    args: { actor: 'random-guest', event: 'push', files: ['src/pages/index.astro'] },
    allow: false,
    badIncludes: 'src/pages/index.astro',
  },
  {
    name: '一个谁都不是的账号改了文章（posts，不是日记手记）→ **拦住**',
    args: { actor: 'random-guest', event: 'push', files: ['src/content/posts/x.md'] },
    allow: false,
  },
  {
    name: '一个谁都不是的账号动了发布工作流自己 → **拦住**（改规则也得先过你）',
    args: { actor: 'random-guest', event: 'push', files: ['.github/workflows/deploy.yml'] },
    allow: false,
  },
  {
    name: '一个谁都不是的账号换掉了名字不带日期的图（logo.png）→ **拦住**',
    args: { actor: 'random-guest', event: 'push', files: ['public/img/uploads/logo.png'] },
    allow: false,
  },
  {
    name: '一个谁都不是的账号：日记 + 越界混在同一次推送里 → **拦住**（整次都要审）',
    args: {
      actor: 'random-guest',
      event: 'push',
      files: ['src/content/notes/2026-10-06-a.md', 'src/data/salon.json'],
    },
    allow: false,
    badIncludes: 'src/data/salon.json',
  },
  {
    name: '★ 免审名单里的人（机器人）改首页版块数据 → **放行**（用户 2026-10-07 的要求：协作者直接推流）',
    args: { actor: 'SSWTLZZ69', event: 'push', files: ['src/data/home-boards.json'] },
    allow: true,
    reasonIncludes: '免审名单',
  },
  {
    name: '★ 免审名单里的人改了日记标题所在的文件（原来被拦的就是这种）→ **放行**',
    args: { actor: 'sswtlzz69', event: 'push', files: ['src/content/notes/2026-10-06-a.md', 'src/data/salon.json'] },
    allow: true,
    reasonIncludes: '免审名单',
  },
  {
    name: '★ 免审名单的人连发布工作流都能改（名单里是全权 —— 这条用例就是提醒这个代价）',
    args: { actor: 'SSWTLZZ69', event: 'push', files: ['.github/workflows/deploy.yml'] },
    allow: true,
    reasonIncludes: '免审名单',
  },
  {
    name: '不在名单、协作者又查不出来时，拦住理由里会写明「协作者那一步没查成」',
    args: { actor: 'random-guest', event: 'push', files: ['src/pages/index.astro'] },
    allow: false,
    reasonIncludes: '协作者那一步没查成',
  },
  {
    name: '你自己推任何东西 → 放行（启动器「发布上线」照旧一点就发）',
    args: { actor: 'Chenxu-MarshEco', event: 'push', files: ['src/data/home-boards.json', 'src/pages/index.astro'] },
    allow: true,
  },
  {
    name: '手动点「Run workflow」→ 放行（这就是"审过之后按发布"）',
    args: { event: 'workflow_dispatch', actor: 'Chenxu-MarshEco', files: ['src/data/home-boards.json'] },
    allow: true,
  },
  {
    name: '不认识的人改首页 → **拦住**（本地测不出协作者身份就按文件名单判；线上会先问 GitHub「他是不是协作者」）',
    args: { actor: 'somebodyelse', event: 'push', files: ['src/pages/index.astro'] },
    allow: false,
  },
  {
    name: '一次推送里没有任何文件（空提交）→ 放行',
    args: { actor: 'SSWTLZZ69', event: 'push', files: [] },
    allow: true,
  },
  {
    name: '拿不到改动清单（没有 token、没有前后 SHA）→ **拦住**（宁可拦住也不瞎发）',
    args: { actor: 'random-guest', event: 'push' },
    allow: false,
    reasonIncludes: '拿不到',
  },
  {
    name: '强推 / 新分支（before 是全 0）→ **拦住**',
    args: { actor: 'random-guest', event: 'push', before: '0000000000000000000000000000000000000000', after: 'abc' },
    allow: false,
    reasonIncludes: '全 0',
  },
];

for (const c of cases) {
  const r = runGate(c.args);
  const ok =
    r.code === (c.allow ? 0 : 1) &&
    r.result?.allow === c.allow &&
    (!c.badIncludes || (r.result?.bad ?? []).includes(c.badIncludes)) &&
    (!c.reasonIncludes || String(r.result?.reason ?? '').includes(c.reasonIncludes));
  check(c.name, ok, `exit=${r.code} ${r.result?.reason ?? '(没有 result)'}`);
}

/* ---- 2c. 拦住的时候，日志里要写清楚"怎么才能发" ---- */
const denyOut = runGate({ actor: 'random-guest', event: 'push', files: ['src/pages/index.astro'] });
check(
  '拦住时日志里写清了越界的文件和「怎么才能发」',
  denyOut.out.includes('src/pages/index.astro') && /Run workflow/.test(denyOut.out) && /ALLOW/.test(denyOut.out),
  ''
);
/* 免审名单是文件驱动的：断言那个文件真的被读到了 */
const trusted = JSON.parse(fs.readFileSync('tools/publish/trusted.json', 'utf8'));
check(
  '免审名单文件（tools/publish/trusted.json）里确实有机器人，而且是数组',
  Array.isArray(trusted.autoPublish) && trusted.autoPublish.some((x) => String(x).toLowerCase() === 'sswtlzz69'),
  JSON.stringify(trusted.autoPublish)
);

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
