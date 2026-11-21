#!/usr/bin/env node
/*
 * ============================================================================
 * 提交署名 → GitHub 用户名 / 头像
 * ----------------------------------------------------------------------------
 * 站长 2026-11-20 的原话：
 *   「可以看到编辑器推流里的推流者都是能看到github头像的 网站里却没有 把头像也接上」
 *
 * 编辑器那边（tools/git/activity.mjs 的 enrich）是问一次 GitHub 的 commits 接口，
 * 把「邮箱 → 用户名 / 头像」记进 `.tmp/collab-actors.json`。这里**读同一份缓存**，
 * 所以本地构建时编辑器已经问过的那批人一个请求都不用再发；
 * 缓存里没有的（换台机器、CI 上全新 checkout）才去问一次，问到了照样写回同一份缓存。
 *
 * 「谁推的」有两套对应关系，缺一不可（2026-11-21 补的第二套）：
 *   ① **邮箱 → 用户名**：问 commits 接口。它只认「这个邮箱在 GitHub 上绑定了账号」的提交，
 *      拿不到绑定的那几位（Shema_Sunf / EtherARM / Memori_Monita）就永远只有署名和首字圆圈。
 *   ② **署名 → 用户名**：问 contributors 接口（一次请求，这个仓库所有贡献者 + 头像）。
 *      git 的 `user.name` 几乎就是他们的 GitHub 用户名（`Shema_Sunf` ↔ `Shema-Sunf`），
 *      所以按「去掉 _ - 空格、转小写」比一遍就能认回来。
 *   ① 认不出时才走 ②；② 也认不出才退回首字圆圈。
 *
 * ⚠ 只用**两次**请求（commits 一次、contributors 一次），而且失败一律不抛：
 *   拿不到头像就退回「名字首字画个圆」，绝不能让一次网络抖动把整站构建搞挂。
 * ⚠ `cwd` 一律由调用方显式传：站点构建时这个模块会被 Vite 打包进
 *   `dist/.prerender/chunks/`，`import.meta.url` 算出来的根是错的（2026-10-13 踩过）。
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 和编辑器共用的缓存文件（编辑器写、这里读；这里问到新的也会写回去） */
export const cacheFile = (cwd = process.cwd()) => path.join(cwd, '.tmp', 'collab-actors.json');
/**
 * 贡献者名单的缓存（**只归这里用**，见下面 ensureContributors）。
 * 单独一个文件是因为编辑器那边（tools/git/activity.mjs）写回缓存时只写它认识的那几个键，
 * 塞进同一份会被它顺手洗掉。
 */
export const contribFile = (cwd = process.cwd()) => path.join(cwd, '.tmp', 'collab-contributors.json');
/** 贡献者名单多久问一次：它变得很慢（多一个人 / 换一次头像），本地构建没必要每次重问 */
const CONTRIB_TTL_MS = 12 * 60 * 60 * 1000;

const emptyCache = () => ({ at: 0, failedAt: 0, byEmail: {}, bySha: {} });

/** 读缓存（读不到就当成空） */
export function readActorCache(cwd = process.cwd()) {
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(cwd), 'utf8'));
    return {
      at: Number(raw?.at || 0),
      failedAt: Number(raw?.failedAt || 0),
      byEmail: raw?.byEmail && typeof raw.byEmail === 'object' ? raw.byEmail : {},
      bySha: raw?.bySha && typeof raw.bySha === 'object' ? raw.bySha : {},
    };
  } catch {
    return emptyCache();
  }
}

function writeActorCache(cache, cwd = process.cwd()) {
  try {
    fs.mkdirSync(path.dirname(cacheFile(cwd)), { recursive: true });
    fs.writeFileSync(cacheFile(cwd), `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  } catch {
    /* 写不进去不影响构建 */
  }
}

/** 从 noreply 邮箱里抠用户名：`1234+someone@users.noreply.github.com` */
export function loginFromEmail(email) {
  const m = /^(?:\d+\+)?([A-Za-z0-9-]{1,39})@users\.noreply\.github\.com$/i.exec(String(email || '').trim());
  return m ? m[1] : '';
}

/** 这个邮箱在缓存里认出来的人（没有就是 null） */
export function actorFor(email, cache) {
  const key = String(email || '').trim().toLowerCase();
  if (!key) return null;
  const hit = cache?.byEmail?.[key];
  return hit && hit.login ? hit : null;
}

/**
 * 一个名字的比对形状：去掉 `_` `-` 空格、转小写。
 * 为什么要这样比：git 的署名和 GitHub 用户名常常只差一个分隔符
 * （`Shema_Sunf` ↔ `Shema-Sunf`、`Memori_Monita` ↔ `MemoriMonita`），
 * 直接比字符串一个都对不上，头像就永远是首字圆圈。
 */
export const nameKey = (name) => String(name || '').toLowerCase().replace(/[\s_-]+/g, '');

/** origin 地址 → 仓库（不在仓库里 / 不是 GitHub 就给空） */
function repoOf(cwd) {
  try {
    const url = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd,
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    /*
      ⚠ 仓库名里有**点**（`Chenxu-MarshEco.github.io`）。第一版正则写成
        `([^/.]+)` —— 点被当成分隔符，仓库名截成 `Chenxu-MarshEco`，
        请求直接 404，头像永远是空的（2026-11-20 实测踩到）。
      所以先把 `.git` 尾巴去掉，再取最后两段。
    */
    const clean = url.replace(/\.git$/i, '').replace(/\/+$/, '');
    const m = /github\.com[:/]([^/]+)\/([^/]+)$/i.exec(clean);
    return m ? { owner: m[1], repo: m[2] } : null;
  } catch {
    return null;
  }
}

/** GitHub 的请求头：构建机给了 GITHUB_TOKEN；本地就试试 gh 的登录态；都没有就匿名 */
function headersOf() {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'huajiantang-site-build' };
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  if (token) headers.authorization = `Bearer ${token}`;
  else {
    try {
      const t = execFileSync('gh', ['auth', 'token'], {
        windowsHide: true,
        encoding: 'utf8',
        timeout: 6000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (t) headers.authorization = `Bearer ${t}`;
    } catch {
      /* 没装 gh：匿名问 */
    }
  }
  return headers;
}

/** 一次请求问 GitHub：最近这些提交分别是谁 */
async function askGithub(cwd, { limit = 30, cache }) {
  const repo = repoOf(cwd);
  if (!repo) return cache;

  const res = await fetch(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}/commits?per_page=${Math.min(limit, 100)}`,
    {
      headers: headersOf(),
      signal: AbortSignal.timeout(9000),
    }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list)) throw new Error('返回的不是列表');

  const next = { ...cache, byEmail: { ...cache.byEmail }, bySha: { ...cache.bySha } };
  for (const c of list) {
    const login = String(c?.author?.login || '');
    if (!login) continue;
    const avatar = String(c?.author?.avatar_url || '') || `https://github.com/${login}.png?size=64`;
    for (const email of [c?.commit?.author?.email, c?.commit?.committer?.email]) {
      const key = String(email || '').trim().toLowerCase();
      if (key) next.byEmail[key] = { login, avatar };
    }
    if (c?.sha) next.bySha[String(c.sha)] = { login, avatar };
  }
  next.at = Date.now();
  next.failedAt = 0;
  writeActorCache(next, cwd);
  return next;
}

/* ---------------------------------------------------------------- 贡献者名单 */

const emptyContrib = () => ({ at: 0, failedAt: 0, byName: {} });

/** 读贡献者名单（读不到就当成空） */
export function readContrib(cwd = process.cwd()) {
  try {
    const raw = JSON.parse(fs.readFileSync(contribFile(cwd), 'utf8'));
    return {
      at: Number(raw?.at || 0),
      failedAt: Number(raw?.failedAt || 0),
      byName: raw?.byName && typeof raw.byName === 'object' ? raw.byName : {},
    };
  } catch {
    return emptyContrib();
  }
}

function writeContrib(contrib, cwd = process.cwd()) {
  try {
    fs.mkdirSync(path.dirname(contribFile(cwd)), { recursive: true });
    fs.writeFileSync(contribFile(cwd), `${JSON.stringify(contrib, null, 2)}\n`, 'utf8');
  } catch {
    /* 写不进去不影响构建 */
  }
}

/**
 * 这个仓库的**全部贡献者**（用户名 + 头像），一次请求。
 *
 * 为什么非要有它：问 commits 拿到的 `author` 只是「这个邮箱在 GitHub 上认到了账号」那些提交；
 * 提交邮箱没绑定的协作者，那边返回的 `author` 是 null —— 于是他们永远只有署名和首字圆圈
 * （站长 2026-11-21：「头像抓取依然不全 没有抓到 Shema_Sunf EtherARM Memori_Monita 等人」）。
 * contributors 这条接口不看邮箱，直接给全部有提交的人，按名字比一遍就全都认回来了。
 */
export async function ensureContributors({ cwd = process.cwd(), force = false } = {}) {
  let contrib = readContrib(cwd);
  if (!force && contrib.at && Date.now() - contrib.at < CONTRIB_TTL_MS && Object.keys(contrib.byName).length) {
    return contrib;
  }
  /* 刚失败过就别再试（Actions 上断网时不该每次构建都白等一轮） */
  if (!force && contrib.failedAt && Date.now() - contrib.failedAt < 10 * 60 * 1000) return contrib;
  const repo = repoOf(cwd);
  if (!repo) return contrib;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/contributors?per_page=100`, {
      headers: headersOf(),
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error('返回的不是列表');
    const byName = { ...contrib.byName };
    for (const u of list) {
      const login = String(u?.login || '');
      if (!login) continue;
      byName[nameKey(login)] = {
        login,
        avatar: String(u?.avatar_url || '') || `https://github.com/${login}.png?size=64`,
      };
    }
    contrib = { at: Date.now(), failedAt: 0, byName };
  } catch (err) {
    if (process.env.DEBUG_AVATAR) console.error('[avatar/contrib]', err && err.stack ? err.stack : err);
    contrib = { ...contrib, failedAt: Date.now() };
  }
  writeContrib(contrib, cwd);
  return contrib;
}

/**
 * 让这份缓存覆盖这些提交：缺谁就去问一次（最多一次，失败就算了）。
 * @param {{emails:string[], limit?:number, cwd?:string}} opts
 */
export async function ensureActors({ emails = [], limit = 30, cwd = process.cwd() }) {
  let cache = readActorCache(cwd);
  const missing = emails.some((e) => !actorFor(e, cache) && !loginFromEmail(e));
  if (!missing) return cache;
  /* 刚失败过就别再试，省得每次构建都卡 9 秒 */
  if (cache.failedAt && Date.now() - cache.failedAt < 10 * 60 * 1000) return cache;
  try {
    cache = await askGithub(cwd, { limit, cache });
  } catch (err) {
    if (process.env.DEBUG_AVATAR) console.error('[avatar]', err && err.stack ? err.stack : err);
    cache = { ...cache, failedAt: Date.now() };
    writeActorCache(cache, cwd);
  }
  return cache;
}

/**
 * 最后一步：这个人是谁（用户名 / 头像 / 主页），拿不到就给空。
 *
 * 三种来源按可信度排：noreply 邮箱 → commits 缓存（邮箱绑定）→ 贡献者名单（按署名比）。
 * `name` 就是 git 的署名（`%an`）：只有第三种用它，前两种都靠邮箱。
 */
export function resolveActor(email, cache, name = '', contrib = null) {
  const fromEmail = loginFromEmail(email);
  if (fromEmail) return { login: fromEmail, avatar: `https://github.com/${fromEmail}.png?size=64`, profile: `https://github.com/${fromEmail}` };
  const hit = actorFor(email, cache);
  if (hit) {
    return {
      login: hit.login,
      avatar: hit.avatar || `https://github.com/${hit.login}.png?size=64`,
      profile: `https://github.com/${hit.login}`,
    };
  }
  const byName = contrib?.byName?.[nameKey(name)];
  if (byName?.login) {
    return {
      login: byName.login,
      avatar: byName.avatar || `https://github.com/${byName.login}.png?size=64`,
      profile: `https://github.com/${byName.login}`,
    };
  }
  return { login: '', avatar: '', profile: '' };
}
