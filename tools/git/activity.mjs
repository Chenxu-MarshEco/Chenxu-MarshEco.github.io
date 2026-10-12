#!/usr/bin/env node
/*
 * ============================================================================
 * 推流动态 —— 「谁 · 什么时候 · 改了哪几块」
 * ----------------------------------------------------------------------------
 * 用户 2026-10-12 的要求（原话）：
 *   「可以让我的 github 的 Collaborators 使用和我同款的编辑器 和我进行共创 …
 *     并且因为可能会有多人实时同步进行编辑 所以最好可以在编辑器里实时提醒
 *     哪个用户何时进行了推流」
 *
 * 怎么实现「实时」：**不新起任何服务器**，拿 git 自己当广播。
 *   · 每次有人「发布上线」，就有一个新提交出现在 origin/main 上；
 *   · 编辑器前台时每隔一分钟 `git fetch` 一次（只更新本地的远端记录，不碰工作区，
 *     和右上角那个「拉远端 (N)」角标走同一条路，见 server.mjs 的 fetchRemoteInBackground），
 *     然后读一遍 `git log origin/main`；
 *   · 比上一次读到的多出来的提交 = 刚刚有人推流 → 弹提示条 + 顶栏亮一个数字。
 * 代价是"最多晚一分钟"（不是真的毫秒级推送）。要做成毫秒级就得有个常驻服务端做推送转发，
 * 那等于给站点再加一台要维护、要鉴权的机器 —— 为了一个提示条不值当，所以不做。
 *
 * 显示谁：提交里的 `%an / %ae` 是**署名**，未必等于 GitHub 用户名。
 * 按可信度依次补齐用户名（头像、主页链接都要用它）：
 *   ① noreply 邮箱里直接抠（`1234+someone@users.noreply.github.com`）；
 *   ② 本机身份（tools/git/whoami.mjs）；③ 下面这份缓存（问 GitHub 得到）。
 * 缓存是 `.tmp/collab-actors.json`：`邮箱 → 用户名` 累积着用，
 * **只在冒出没见过的邮箱时才联网问一次**（GitHub 那个接口匿名每小时只有 60 次，
 * 一分钟一次地轮询会当场打光，所以能不问就不问）。
 * 联网失败 / 没网 / 匿名限流：不报错，退化成只显示署名 —— 动态是"锦上添花"，
 * 它不该让编辑器里任何一件事失败。
 *
 * ⚠ 这个文件只读 git，不写任何东西（除了那份缓存），也**从不**改工作区。
 *
 * 命令行用法：
 *   node tools/git/activity.mjs                  # 最近 15 条，给人看
 *   node tools/git/activity.mjs --json           # 机读一行（编辑器服务读它）
 *   node tools/git/activity.mjs --fetch          # 先探一次远端再读
 *   node tools/git/activity.mjs --no-api         # 完全不联网（验收脚本用）
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { git, fetchRemote } from './sync.mjs';
import { me, loginFromEmail, originInfo } from './whoami.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ACTOR_CACHE = path.join(ROOT, '.tmp', 'collab-actors.json');
/** 问 GitHub 的最小间隔：失败要退避得更久（免得断网时每次轮询都白等一轮） */
const API_MIN_GAP_MS = 60 * 1000;
const API_FAIL_GAP_MS = 10 * 60 * 1000;

/* ------------------------------------------------------------------
 * 文件 → 面板名
 *
 * 「改了 src/data/iceberg.json」没人看得懂，要说成「冰山图」——
 * 这里的名字和编辑器左上角「工作台」里的那些**必须对得上**（app.js 的 WORKSPACES）。
 * 顺序有讲究：**具体的写在前面**（`src/data/chat/xxx` 要落在"聊天室存档"上，
 * 而不是被下面的 `src/data/` 兜住）。
 * ------------------------------------------------------------------ */
const PANEL_RULES = [
  { re: /^src\/content\/posts\//i, panel: '文章', kind: 'content' },
  { re: /^src\/content\/notes\//i, panel: '手记', kind: 'content' },
  { re: /^src\/data\/chat\//i, panel: '聊天室存档', kind: 'auto' },
  { re: /^src\/data\/draw\//i, panel: '画板存档', kind: 'auto' },
  { re: /^src\/data\/home-boards\.json$/i, panel: '页面 / 子版块', kind: 'data' },
  { re: /^src\/data\/home-widgets\.json$/i, panel: '首页那几块', kind: 'data' },
  { re: /^src\/data\/layout\.json$/i, panel: '排版', kind: 'data' },
  { re: /^src\/data\/iceberg\.json$/i, panel: '冰山图', kind: 'data' },
  { re: /^src\/data\/salon\.json$/i, panel: '精华 / 成员', kind: 'data' },
  { re: /^src\/data\/liyutang\.json$/i, panel: '黎语堂管理', kind: 'data' },
  { re: /^src\/data\/navs\.json$/i, panel: '导航', kind: 'data' },
  { re: /^src\/data\/timelines\.json$/i, panel: '时间轴', kind: 'data' },
  { re: /^src\/data\/music\.json$/i, panel: '音乐', kind: 'data' },
  { re: /^src\/data\/announcements\.json$/i, panel: '公告', kind: 'data' },
  { re: /^src\/data\/site-copy\.json$/i, panel: '文案', kind: 'data' },
  { re: /^src\/data\/page-templates\.json$/i, panel: '页面模版', kind: 'data' },
  { re: /^src\/data\/recent-edits\.json$/i, panel: '近期更新', kind: 'auto' },
  { re: /^src\/data\/mianyu\.json$/i, panel: '眠鱼志', kind: 'data' },
  { re: /^src\/data\//i, panel: '站点数据', kind: 'data' },
  { re: /^public\/img\/chat\//i, panel: '聊天室图片', kind: 'auto' },
  { re: /^public\/img\/draw\//i, panel: '画板存档图', kind: 'auto' },
  { re: /^public\/img\/uploads\//i, panel: '上传的图片', kind: 'image' },
  { re: /^public\/img\//i, panel: '图片', kind: 'image' },
  { re: /^public\/audio\//i, panel: '音频', kind: 'audio' },
  { re: /^tools\/editor\//i, panel: '编辑器', kind: 'code' },
  { re: /^tools\//i, panel: '工具', kind: 'code' },
  { re: /^\.github\//i, panel: '工作流', kind: 'code' },
  { re: /^src\/(pages|layouts|components|styles|utils)\//i, panel: '站点代码', kind: 'code' },
  { re: /^src\//i, panel: '站点源码', kind: 'code' },
  { re: /^(README\.md|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|astro\.config\.mjs|tsconfig\.json)$/i, panel: '仓库配置', kind: 'code' },
  { re: /^\.[a-z]/i, panel: '仓库配置', kind: 'code' },
];

/**
 * 一份改动清单 → 面板名清单（去重、保持出现顺序）。
 * @param {string[]} files
 * @returns {string[]}
 */
export function panelsForFiles(files) {
  const out = [];
  for (const f of files || []) {
    const hit = PANEL_RULES.find((r) => r.re.test(String(f)));
    const name = hit ? hit.panel : '其它';
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** 这份改动里最"重"的种类，用来给动态列表上色（内容 > 数据 > 图片 > 自动 > 代码） */
export function kindOfFiles(files) {
  const order = ['content', 'data', 'image', 'audio', 'auto', 'code', 'other'];
  let best = 'other';
  for (const f of files || []) {
    const hit = PANEL_RULES.find((r) => r.re.test(String(f)));
    const k = hit ? hit.kind : 'other';
    if (order.indexOf(k) < order.indexOf(best)) best = k;
  }
  return best;
}

/* ---------------------------------------------------------------- 缓存 */

function readCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(ACTOR_CACHE, 'utf8'));
    return {
      at: Number(raw?.at || 0),
      failedAt: Number(raw?.failedAt || 0),
      byEmail: raw?.byEmail && typeof raw.byEmail === 'object' ? raw.byEmail : {},
      bySha: raw?.bySha && typeof raw.bySha === 'object' ? raw.bySha : {},
    };
  } catch {
    return { at: 0, failedAt: 0, byEmail: {}, bySha: {} };
  }
}

function writeCache(cache) {
  try {
    fs.mkdirSync(path.dirname(ACTOR_CACHE), { recursive: true });
    fs.writeFileSync(ACTOR_CACHE, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  } catch {
    /* 缓存写不进去不影响读动态 */
  }
}

/*
  问 GitHub 补"用户名 → 头像 / 主页"。
  走 async（编辑器服务那边本来就异步），失败一律退化成只显示署名。
*/
async function enrich(cache, { limit = 30, log = () => {} } = {}) {
  const now = Date.now();
  const gap = cache.failedAt && now - cache.failedAt < API_FAIL_GAP_MS ? API_FAIL_GAP_MS : API_MIN_GAP_MS;
  if (now - Math.max(cache.at, cache.failedAt) < gap) return cache;

  const { owner, repo, github } = originInfo();
  if (!github) return cache;

  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'huajiantang-shared-editor' };
  try {
    const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 6000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (token) headers.authorization = `Bearer ${token}`;
  } catch {
    /* 没装 gh / 没登录：匿名问（只在冒出陌生邮箱时才问，够用） */
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=${Math.min(limit, 100)}`, {
      headers,
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error('返回的不是列表');
    for (const c of list) {
      const login = String(c?.author?.login || '');
      const avatar = String(c?.author?.avatar_url || '');
      if (!login) continue;
      for (const email of [c?.commit?.author?.email, c?.commit?.committer?.email]) {
        const key = String(email || '').trim().toLowerCase();
        if (key) cache.byEmail[key] = { login, avatar };
      }
      if (c?.sha) cache.bySha[String(c.sha)] = { login, avatar };
    }
    cache.at = now;
    cache.failedAt = 0;
    log(`   动态：问了 GitHub，认下 ${list.length} 个提交的署名`);
  } catch (err) {
    cache.failedAt = now;
    log(`   动态：问 GitHub 没成（${err?.message || err}），这次只显示提交署名`);
  }
  writeCache(cache);
  return cache;
}

/* ---------------------------------------------------------------- 读 git log */

/** 本地该看哪个分支的提交：origin/main 优先（那才是"别人推上来的"） */
export function activityRef() {
  for (const ref of ['origin/main', 'origin/HEAD', 'HEAD']) {
    const r = git(['rev-parse', '--verify', '--quiet', ref], { timeout: 8000 });
    if (r.ok && r.out) return ref;
  }
  return '';
}

const FIELDS = '%H%x1f%h%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%aI%x1f%cI%x1f%s';

/**
 * 最近这些提交（含改了哪些文件）。
 * @param {{limit?:number, ref?:string}} opts
 */
export function readCommits({ limit = 15, ref = '' } = {}) {
  const useRef = ref || activityRef();
  if (!useRef) return { ref: '', head: '', commits: [] };
  const r = git(
    ['log', `-n`, String(limit), `--no-renames`, `--name-only`, `--format=%x1e${FIELDS}`, useRef],
    { timeout: 30000 },
  );
  if (!r.ok) return { ref: useRef, head: '', commits: [] };

  const headR = git(['rev-parse', useRef], { timeout: 8000 });
  const commits = [];
  for (const chunk of r.out.split('\x1e')) {
    const text = chunk.replace(/^\s+/, '');
    if (!text.trim()) continue;
    const lines = text.split('\n');
    const [sha, short, an, ae, cn, ce, aI, cI, subject] = lines[0].split('\x1f');
    const files = lines.slice(1).map((l) => l.trim()).filter(Boolean);
    commits.push({
      sha, short,
      author: { name: an, email: ae },
      committer: { name: cn, email: ce },
      iso: aI, commitIso: cI,
      time: Date.parse(aI) || 0,
      subject,
      files,
      panels: panelsForFiles(files),
      kind: kindOfFiles(files),
    });
  }
  return { ref: useRef, head: headR.ok ? headR.out : (commits[0]?.sha ?? ''), commits };
}

/* ---------------------------------------------------------------- 主入口 */

/**
 * 动态列表。**只读**：不改工作区、不改仓库。
 * @param {{limit?:number, useApi?:boolean, identity?:object, log?:Function}} opts
 */
export async function activity({ limit = 15, useApi = true, identity = null, log = () => {} } = {}) {
  const who = identity || me();
  const { ref, head, commits } = readCommits({ limit });

  const cache = readCache();
  const known = (email) => {
    const key = String(email || '').trim().toLowerCase();
    if (!key) return null;
    if (cache.byEmail[key]) return cache.byEmail[key];
    return null;
  };
  const loginFor = (email) => {
    const hit = known(email);
    if (hit?.login) return hit.login;
    return loginFromEmail(email) || '';
  };

  /*
    只在"冒出没见过的邮箱"时才联网问一次。
    同一个人反复推流（本仓库最常见的就是站长自己），第二次起一个网络请求都不用发。
  */
  if (useApi) {
    const stranger = commits.some((c) => !loginFor(c.author.email) || !loginFor(c.committer.email));
    if (stranger) await enrich(cache, { limit: Math.max(limit, 20), log });
  }

  const mineEmail = String(who?.email || '').trim().toLowerCase();
  const mineLogin = String(who?.login || '').toLowerCase();
  const out = commits.map((c) => {
    const aLogin = loginFor(c.author.email) || (cache.bySha[c.sha]?.login ?? '');
    const cLogin = loginFor(c.committer.email) || '';
    const aAvatar = cache.byEmail[String(c.author.email || '').toLowerCase()]?.avatar
      || (aLogin ? `https://github.com/${aLogin}.png?size=64` : '');
    const email = String(c.author.email || '').trim().toLowerCase();
    const mine = Boolean((mineEmail && email === mineEmail) || (mineLogin && aLogin.toLowerCase() === mineLogin));
    /*
      `%an` 是署名、`%cn` 是"最后把它落到仓库里的人"。
      pull --rebase 会把别人的提交重放一遍：署名不变、committer 换成推流的人。
      所以这两个不一样时，说明这次是**后者把前者的东西合进来推上去的**——如实说出来。
    */
    const relayed = Boolean(c.committer.email && c.author.email && c.committer.email.toLowerCase() !== c.author.email.toLowerCase());
    const subject = String(c.subject || '');
    return {
      ...c,
      title: subject.replace(/^更新内容\s*\d{4}-\d{2}-\d{2}(?:\s*\d{2}:\d{2})?\s*[：:]\s*/, '').trim() || subject,
      author: { ...c.author, login: aLogin, avatar: aAvatar, profile: aLogin ? `https://github.com/${aLogin}` : '' },
      committer: { ...c.committer, login: cLogin, profile: cLogin ? `https://github.com/${cLogin}` : '' },
      mine,
      relayed,
    };
  });

  return {
    ref,
    head,
    commits: out,
    me: { login: who?.login || '', name: who?.name || '', email: who?.email || '', owner: who?.owner ?? null },
    at: new Date().toISOString(),
  };
}

/* ---------------------------------------------------------------- 命令行 */

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const li = argv.indexOf('--limit');
  const limit = li >= 0 ? Math.max(1, Math.min(200, Number(argv[li + 1]) || 15)) : 15;

  if (argv.includes('--fetch')) {
    const f = fetchRemote({ timeout: 45000 });
    if (!asJson) console.log(f.ok ? '   已探过远端。' : `   探远端没成：${f.err}`);
  }

  activity({ limit, useApi: !argv.includes('--no-api'), log: (s) => { if (!asJson) console.log(s); } })
    .then((data) => {
      if (asJson) {
        console.log(`[result] ${JSON.stringify(data)}`);
      } else {
        console.log('');
        console.log(`  ======== 推流动态（${data.ref}）========`);
        for (const c of data.commits) {
          const who = c.author.login || c.author.name;
          const when = c.iso ? c.iso.replace('T', ' ').slice(0, 16) : '';
          console.log(`  ${when}  ${who}${c.mine ? '（你）' : ''}  ${c.panels.join('、') || '（没列改了什么）'}`);
          if (c.title) console.log(`      ${c.title}`);
          if (c.relayed) console.log(`      （由 ${c.committer.name} 合进来推上去的）`);
        }
        console.log('  ======================================');
        console.log('');
      }
      process.exitCode = 0;
    })
    .catch((err) => {
      console.error(`  读动态失败：${err?.message || err}`);
      if (asJson) console.log(`[result] ${JSON.stringify({ error: String(err?.message || err) })}`);
      process.exitCode = 1;
    });
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();
