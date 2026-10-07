/*
 * ============================================================================
 * 「这一次推送，能不能直接发布」的门卫
 * ----------------------------------------------------------------------------
 * 用户 2026-10-06 的要求（原话）：
 *   「SSW的机器人每天都需要推送文章 让它推送到铃忆的冰室日记的文章无需同意也能推送
 *    但是删改其他页面需要同意」
 *
 * 背景：另一位（SSWTLZZ69）的机器人**每天**往 main 推一篇「铃忆的冰室日记」的手记，
 * 它是自动的，走 PR 会被卡住（GitHub 的分支保护只能按"人"放行，不能按"改了哪些文件"放行）。
 * 所以批准这件事挪到**发布这一步**来做：推送照旧推得上来，但**没被允许的改动不会上线**。
 *
 * 判定规则（按顺序，命中就允许）：
 *   ① 是「Run workflow」手动触发的  → 允许（站长自己点的，这就是"同意"）
 *   ② 推送的人就是仓库所属者        → 允许（你自己的推送 / 启动器「发布上线」）
 *   ③ 推送的人在**免审名单 / 协作者**里 → 允许（用户 2026-10-07 的要求：
 *      「直接改为 github 上我的 collaborators 可以直接推流 无需我的审核吧」——
 *      机器人偶尔要改日记标题之类的元信息，那些文件不在"日常放行名单"里，原来会被拦下）
 *   ④ 这一次改的文件**全在放行名单里** → 允许（机器人的日常日记）
 *   ⑤ 其它情况                      → **拦住**：这次不构建、不发布，
 *      并把"越界的文件"打在日志里（Actions 里那次运行会失败并给你发通知）
 *
 * 免审名单（按"人"放行）在 tools/publish/trusted.json —— 加人只改那个文件，不用改代码。
 *
 * 按文件放行的名单（就这三条，都在下面 ALLOW 里）：
 *   · src/content/notes/**.md          日记正文（手记）
 *   · public/img/uploads/日期-*.图片    日记配图（机器人/编辑器上传的名字都以 8 位日期开头）
 *   · src/data/recent-edits.json       「最近编辑过哪几页」那张表，编辑器保存时自动写的
 *
 * 拦住之后怎么发：你去 Actions →「部署到 GitHub Pages」→ **Run workflow**（选 main）。
 * 那就是规则①，等于你审过之后按了发布。
 *
 * ⚠ 为什么不用分支保护来做这件事：GitHub 的分支保护 / ruleset 的"例外名单"只能按
 *   角色、团队、App、部署密钥放行，**不能按路径**放行 —— 想"日记不用审、别的要审"，
 *   只能在发布这一步做。代价是：越界的推送**进得了仓库**（但在你点发布之前上不了线）。
 *   如果要连"推都推不进来"，得让机器人的推送换成一个专属的部署密钥/GitHub App，
 *   再把它加进 ruleset 的例外名单 —— 那要改机器人那边的凭据，等你要的时候再说。
 *
 * 用法（Actions 里，环境变量由 workflow 喂）：
 *   node tools/publish/gate.mjs
 * 本地自测（不联网）：
 *   node tools/publish/gate.mjs --actor SSWTLZZ69 --event push --files "a.md\nb.md" [--json]
 *   node tools/publish/gate.mjs --actor yourname --event push --files-file list.txt
 * 出口码：0 = 允许发布；1 = 拦住（原因打在 stdout / 运行摘要上）
 * ============================================================================
 */
import fs from 'node:fs';

/**
 * 免审名单（按"人"放行）：这些 GitHub 账号推什么都会直接发布。
 * 名单在 tools/publish/trusted.json；读不到就当空名单（不影响其它规则）。
 */
const TRUSTED = (() => {
  try {
    const raw = JSON.parse(fs.readFileSync(new URL('./trusted.json', import.meta.url), 'utf8'));
    const list = Array.isArray(raw?.autoPublish) ? raw.autoPublish : [];
    return list.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
})();

/** 允许"不经同意就上线"的路径。命中任意一条即放行 */
const ALLOW = [
  { why: '日记正文（手记）', re: /^src\/content\/notes\/.+\.md$/i },
  { why: '日记配图（上传的图，名字以 8 位日期开头）', re: /^public\/img\/uploads\/\d{8}-[^/]+\.(jpe?g|png|webp|gif|avif)$/i },
  { why: '「最近编辑过哪几页」那张表（编辑器保存时自动写的）', re: /^src\/data\/recent-edits\.json$/i },
];

/* ---------------------------------------------------------------- 参数 */

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] ?? '' : '';
};
const has = (name) => argv.includes(`--${name}`);

const repo = String(process.env.GITHUB_REPOSITORY || '').trim();
const actor = String(flag('actor') || process.env.GITHUB_ACTOR || '').trim();
const event = String(flag('event') || process.env.GITHUB_EVENT_NAME || 'push').trim();
const before = String(flag('before') || process.env.PUSH_BEFORE || '').trim();
const after = String(flag('after') || process.env.PUSH_AFTER || '').trim();
const token = String(process.env.GITHUB_TOKEN || '').trim();
/** 仓库所属者：`owner/repo` 里的 owner —— 和推送人比一下就知道是不是站长自己 */
const owner = repo.includes('/') ? repo.split('/')[0] : '';
const json = has('json');

/* ---------------------------------------------------------------- 改动清单 */

/**
 * 这一次推送改了哪些文件。
 * 三条来源，按顺序：
 *   1. --files "a\nb"      本地自测直接给
 *   2. --files-file 路径    本地自测给一个文件清单
 *   3. compare API          Actions 里的正路（不下载任何东西，一次请求就够）
 *
 * ⚠ 一律返回 `{ files }` 或 `{ error }` 两种形状之一 —— 原来给 `--files` 那条
 * 直接返回了数组，调用处按 `{files}` 取，`decide(undefined)` 当场炸（第一次跑就踩了）。
 * ⚠ 判断"有没有给 --files"要用**参数在不在**，不能用值是不是空串：
 *   空清单（所有改动都被 git 忽略那种）是合法输入，值就是空串。
 */
async function changedFiles() {
  const readList = (raw) => String(raw ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  const inlineAt = argv.indexOf('--files');
  if (inlineAt >= 0) return { files: readList(argv[inlineAt + 1]) };
  const fileAt = argv.indexOf('--files-file');
  if (fileAt >= 0) {
    try {
      return { files: readList(fs.readFileSync(argv[fileAt + 1] ?? '', 'utf8')) };
    } catch (err) {
      return { error: `读不了清单文件：${err?.message || err}` };
    }
  }

  if (!repo) return { error: '没有 GITHUB_REPOSITORY，不知道是哪个仓库' };
  if (!before || !after) return { error: '没有这次推送的前后 SHA（PUSH_BEFORE / PUSH_AFTER）' };
  if (/^0+$/.test(before)) return { error: '这次的 before 是全 0（新分支或强推），拿不到"改了哪些文件"' };
  if (!token) return { error: '没有 GITHUB_TOKEN，查不了这次改了哪些文件' };

  const url = `https://api.github.com/repos/${repo}/compare/${before}...${after}`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'huajiantang-publish-gate',
      },
    });
  } catch (err) {
    return { error: `请求 GitHub 失败：${err?.message || err}` };
  }
  if (!res.ok) return { error: `GitHub 返回 HTTP ${res.status}（${url}）` };
  const data = await res.json();
  const files = (data.files ?? []).map((f) => String(f.filename || '')).filter(Boolean);
  /*
    compare API 最多给 300 个文件。真到那个量级就说不清"还有没有别的"，
    宁可拦住让人看一眼 —— 这种规模的推送本来也不该是机器人干的。
  */
  if (files.length >= 300) return { error: `这次改动有 ${files.length}+ 个文件（超过接口上限），说不清都有哪些` };
  return { files };
}

/* ---------------------------------------------------------------- 判定 */

function decide(files) {
  const ok = [];
  const bad = [];
  for (const f of files) {
    const hit = ALLOW.find((a) => a.re.test(f));
    if (hit) ok.push({ file: f, why: hit.why });
    else bad.push(f);
  }
  if (bad.length === 0) {
    return { allow: true, reason: `改的 ${files.length} 个文件全在放行名单里（机器人的日常日记）`, ok, bad };
  }
  return {
    allow: false,
    reason: `有 ${bad.length} 个文件不在放行名单里，需要站长确认之后手动发布`,
    ok,
    bad,
  };
}

/**
 * 问一次 GitHub：这个账号是不是本仓库的协作者（有 Write 权限的人）。
 * 尽力而为：没 token、接口不通、权限不够 —— 都只是"查不出来"，不会因此拦住谁
 * （免审名单那条规则照样兜底）。
 * @param {string} login 推送人
 * @returns {Promise<{known:boolean, hit?:boolean, why:string}>} 查询结果
 */
async function isCollaborator(login) {
  if (!token || !repo || !login) return { known: false, why: '没有 token 或仓库名，跳过这一步' };
  try {
    const r = await fetch(
      `https://api.github.com/repos/${repo}/collaborators?per_page=100&affiliation=all`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'huajiantang-publish-gate',
        },
        signal: AbortSignal.timeout(9000),
      }
    );
    if (!r.ok) return { known: false, why: `协作者接口回了 HTTP ${r.status}` };
    const list = await r.json();
    if (!Array.isArray(list)) return { known: false, why: '协作者接口返回的不是列表' };
    const hit = list.some((u) => String(u?.login ?? '').toLowerCase() === login.toLowerCase());
    return {
      known: true,
      hit,
      why: hit ? '在仓库协作者名单里' : `不在协作者名单里（名单里 ${list.length} 人）`,
    };
  } catch (err) {
    return { known: false, why: String(err?.message ?? err) };
  }
}

const lines = [];
const say = (s = '') => {
  lines.push(s);
  console.log(s);
};

let decision;
let filesInfo;
if (event === 'workflow_dispatch') {
  decision = { allow: true, reason: '这次是「Run workflow」手动点的 —— 等于站长本人同意发布', ok: [], bad: [] };
} else if (owner && actor && actor.toLowerCase() === owner.toLowerCase()) {
  decision = { allow: true, reason: `推送的人就是仓库所属者（${actor}），自己的推送直接发布`, ok: [], bad: [] };
} else if (TRUSTED.includes(actor.toLowerCase())) {
  decision = {
    allow: true,
    reason: `推送的人（${actor}）在免审名单里（tools/publish/trusted.json）—— 协作者的推送直接发布`,
    ok: [],
    bad: [],
  };
} else {
  /* 不在名单里，再问一次 GitHub：他是不是本仓库的协作者 */
  const collab = await isCollaborator(actor);
  if (collab.known && collab.hit) {
    decision = {
      allow: true,
      reason: `推送的人（${actor}）是仓库协作者（${collab.why}）—— 协作者的推送直接发布`,
      ok: [],
      bad: [],
    };
  } else {
    filesInfo = await changedFiles();
    if (filesInfo.error) {
      decision = {
        allow: false,
        reason: `拿不到"这次改了哪些文件"：${filesInfo.error}（协作者那一步：${collab.why}）`,
        ok: [],
        bad: [],
      };
    } else {
      decision = decide(filesInfo.files);
      if (!collab.known) decision.reason += `（协作者那一步没查成：${collab.why}）`;
    }
  }
}

say('');
say('======== 发布门卫 ========');
say(`仓库：${repo || '(未知)'}    推送人：${actor || '(未知)'}    事件：${event}`);
say(`前后 SHA：${before || '(无)'} → ${after || '(无)'}`);
if (filesInfo?.files) say(`这次改动 ${filesInfo.files.length} 个文件`);
say('');
for (const l of decision.ok.slice(0, 40)) say(`  放行  ${l.file}   （${l.why}）`);
if (decision.ok.length > 40) say(`  放行  ……另外还有 ${decision.ok.length - 40} 个`);
if (decision.bad.length) {
  say('');
  say('  以下改动**没有**被放行，需要你确认：');
  for (const f of decision.bad.slice(0, 40)) say(`    ⛔ ${f}`);
  if (decision.bad.length > 40) say(`    ⛔ ……另外还有 ${decision.bad.length - 40} 个`);
}
say('');
say(`结论：${decision.allow ? '✅ 允许发布' : '⛔ 拦住，这次不构建也不发布'}`);
say(`理由：${decision.reason}`);
if (!decision.allow) {
  say('');
  say('要发布这次的改动：审一遍上面的文件 → Actions →「部署到 GitHub Pages」→ Run workflow（选 main）。');
  say('规则写在 tools/publish/gate.mjs 的头上：');
    say('  · 免审名单（按人）→ tools/publish/trusted.json');
    say('  · 按文件放行的名单 → tools/publish/gate.mjs 里的 ALLOW 数组');
}
say('==========================');

/* 运行摘要（Actions 页面上那一大块），没有就不写 */
if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n## 发布门卫\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);
  } catch {
    /* 摘要写不进去不影响判定 */
  }
}

if (json) {
  console.log('\n[result] ' + JSON.stringify({ allow: decision.allow, reason: decision.reason, ok: decision.ok, bad: decision.bad }));
}
process.exit(decision.allow ? 0 : 1);
