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
 * ⚠ 只用**一次**请求，而且失败一律不抛：拿不到头像就退回「名字首字画个圆」，
 *   绝不能让一次网络抖动把整站构建搞挂。
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

/** 一次请求问 GitHub：最近这些提交分别是谁 */
async function askGithub(cwd, { limit = 30, cache }) {
  /* 仓库从 origin 的地址里取（不在仓库里、没有 origin 就不问） */
  let owner = '';
  let repo = '';
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
    if (m) {
      owner = m[1];
      repo = m[2];
    }
  } catch {
    return cache;
  }
  if (!owner || !repo) return cache;

  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'huajiantang-site-build' };
  /* 构建机上一般给了 GITHUB_TOKEN；本地就试试 gh 的登录态。都没有就匿名问 */
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

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=${Math.min(limit, 100)}`, {
    headers,
    signal: AbortSignal.timeout(9000),
  });
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

/** 最后一步：这个邮箱对应的人（用户名 / 头像 / 主页），拿不到就给空 */
export function resolveActor(email, cache) {
  const hit = actorFor(email, cache);
  const login = hit?.login || loginFromEmail(email) || '';
  if (!login) return { login: '', avatar: '', profile: '' };
  return {
    login,
    avatar: hit?.avatar || `https://github.com/${login}.png?size=64`,
    profile: `https://github.com/${login}`,
  };
}
