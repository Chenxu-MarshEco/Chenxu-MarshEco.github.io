#!/usr/bin/env node
/*
 * ============================================================================
 * 「我是谁」—— 共享编辑器里的身份（谁在改、谁能回滚）
 * ----------------------------------------------------------------------------
 * 用户 2026-10-12 的要求（原话）：
 *   「现在来制作一个非常重要的功能：便捷共享编辑器 … 可以让我的 github 的
 *     Collaborators 使用和我同款的编辑器 和我进行共创 … 并且因为可能会有多人
 *     实时同步进行编辑 所以最好可以在编辑器里实时提醒哪个用户何时进行了推流
 *     另外仅有我的编辑器需要加一个方便快捷可视化的版本回滚功能 以保证安全」
 *
 * 这个文件只回答一个问题：**现在坐在编辑器前面的是谁**。答案要喂给两处：
 *   ① 推流动态：每个人打开编辑器都要看到「谁 · 什么时候 · 改了哪几块」，
 *      还要有头像和主页链接 —— 要的是 **GitHub 用户名**，不是提交署名；
 *   ② 版本回滚：只有站长的编辑器才长那个面板（协作者那儿不该出现能动历史的东西）。
 *
 * 身份从哪儿来（按可信度从高到低，都用得上）：
 *   ① tools/editor/.editor-identity.json —— 本机自己填的，**不进仓库**
 *      （.gitignore 里排掉了）。git config 里的名字是"提交署名"，未必等于用户名，
 *      所以要有这么一份显式的、只属于这台机器的身份。
 *   ② `gh api user` —— 装了 GitHub CLI 并且登录过，直接问出用户名（本机就是这条路）。
 *      问一次挺贵（起一个进程、走一次网络），所以答案缓存 12 小时到 .tmp/ 下。
 *   ③ git config user.name / user.email，以及 noreply 邮箱里抠出来的用户名
 *      （`1234+someone@users.noreply.github.com` 这种形状能直接还原出 someone）。
 *   三条都问不出来也不拦人：login 留空，动态里退化成显示提交署名（见 activity.mjs）。
 *
 * 「是不是站长」= 用户名和 origin 地址里的 owner 比一下（大小写不敏感）。
 * ⚠ 这不是安全边界。真正的门是 GitHub 那边的分支保护（main 不许强推、不许删分支）
 *   加上发布门卫（tools/publish/gate.mjs）。这里只是"别把不该给协作者看的面板摆出来"，
 *   所以服务端拿到这个标记后还会在 /api/versions* 那几条路由上再挡一次。
 *   login 问不出来时 **一律按不是站长**（少给权限永远比多给安全）。
 *
 * 命令行用法：
 *   node tools/git/whoami.mjs                         # 打一份给人看的
 *   node tools/git/whoami.mjs --json                  # 机读（编辑器服务读这一行）
 *   node tools/git/whoami.mjs --set --login someone --name 昵称 --email a@b.c
 *
 * 机读约定和 tools/git/sync.mjs 一致：最后多打一行 `[result] {…}`。
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { git, remoteUrl } from './sync.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
/** 本机身份（进 .gitignore，别提交） */
export const IDENTITY_FILE = path.join(ROOT, 'tools', 'editor', '.editor-identity.json');
/** gh 问出来的用户名缓存：起进程 + 走网络，12 小时内不再问第二遍 */
const CACHE_FILE = path.join(ROOT, '.tmp', 'whoami-cache.json');
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/** GitHub 用户名的形状（官方规则：字母数字和单个连字符，不能连字符开头结尾，≤39） */
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/* ---------------------------------------------------------------- 远端是谁 */

/**
 * 从 origin 地址里解出 owner / 仓库名。
 * 认 https 和 ssh 两种写法：
 *   https://github.com/Chenxu-MarshEco/Chenxu-MarshEco.github.io.git
 *   git@github.com:Chenxu-MarshEco/Chenxu-MarshEco.github.io.git
 */
export function originInfo() {
  const url = remoteUrl() || '';
  const m = /github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url);
  if (!m) return { url, host: '', owner: '', repo: '', github: false };
  return { url, host: 'github.com', owner: m[1], repo: m[2], github: true };
}

/* ---------------------------------------------------------------- 问 gh */

/** 跑一条命令，把它说的话抓回来（问不出来就 null，不抛） */
function tryCli(cmd, args, timeout = 8000) {
  try {
    const out = execFileSync(cmd, args, {
      cwd: ROOT,
      timeout,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return String(out).trim() || null;
  } catch {
    return null;
  }
}

/**
 * 问一次 GitHub「现在登录的是谁」。
 * 缓存过的先看缓存（12 小时）—— 编辑器每次打开都要问身份，不能每次都起 gh。
 * 失败也缓存（缓存里记 ok:false）：没登录就是没登录，重试一百遍也不会变。
 */
export function detectGithubLogin({ force = false } = {}) {
  const cache = readJson(CACHE_FILE);
  if (!force && cache && Date.now() - Number(cache.at || 0) < CACHE_TTL_MS) {
    return cache.login || '';
  }
  // gh 没装 / 没登录时 gh api 会失败，这里就返回 null，交给 git config 那条路
  const login = tryCli('gh', ['api', 'user', '--jq', '.login']);
  writeJson(CACHE_FILE, { at: Date.now(), login: login && LOGIN_RE.test(login) ? login : '' });
  return login && LOGIN_RE.test(login) ? login : '';
}

/* ---------------------------------------------------------------- 身份 */

/** 从 noreply 邮箱里抠用户名：`1234+someone@users.noreply.github.com` */
export function loginFromEmail(email) {
  const m = /^(?:\d+\+)?([A-Za-z0-9-]{1,39})@users\.noreply\.github\.com$/i.exec(String(email || '').trim());
  return m ? m[1] : '';
}

function gitConfig(key) {
  const r = git(['config', '--get', key], { timeout: 8000 });
  return r.ok && r.out ? r.out : '';
}

/**
 * 现在是谁。三处来源合并成一份，每个字段各自标一下是从哪儿来的 ——
 * 界面上要如实说「这是你自己填的 / 这是从 git 配置读的 / 这是 gh 说的」。
 */
export function me({ refresh = false } = {}) {
  const origin = originInfo();
  const saved = readJson(IDENTITY_FILE) || {};
  const gName = gitConfig('user.name');
  const gEmail = gitConfig('user.email');
  const gUser = gitConfig('github.user');

  const fromFile = (v) => String(v ?? '').trim();
  let login = fromFile(saved.login);
  let loginFrom = login ? 'identity' : '';
  if (!login) {
    login = detectGithubLogin({ force: refresh });
    loginFrom = login ? 'gh' : '';
  }
  if (!login) {
    login = LOGIN_RE.test(gUser) ? gUser : '';
    loginFrom = login ? 'git config' : '';
  }
  if (!login) {
    login = loginFromEmail(gEmail);
    loginFrom = login ? 'noreply 邮箱' : '';
  }

  const name = fromFile(saved.name) || gName || login || '（未署名）';
  const email = fromFile(saved.email) || gEmail || (login ? `${login}@users.noreply.github.com` : '');

  const ownerLogin = origin.owner;
  /*
    「是不是站长」：
      ① 本机身份文件里**明确写过** owner（true/false）→ 以它为准。
         为什么要有这一条：origin 不一定是 GitHub 地址（本地克隆、镜像、自己搭的 git 服务…），
         那时候从地址里根本认不出仓库所属者 —— 与其一口咬定"你不是站长"，
         不如让这台机器自己声明（编辑器「协作」面板里有一个勾）。
      ② 问出了用户名、地址里也有 owner → 两边比一下（大小写不敏感）。
      ③ 缺一个就 **不知道**（null），不是 false —— 界面上要能说清"为什么不知道"，
         而不是显示成"你是协作者"（第一次在本地克隆上跑就是这么误报的）。
  */
  let owner = null;
  let ownerSource = '';
  if (typeof saved.owner === 'boolean') {
    owner = saved.owner;
    ownerSource = 'identity';
  } else if (login && ownerLogin) {
    owner = login.toLowerCase() === ownerLogin.toLowerCase();
    ownerSource = 'remote';
  }

  return {
    login,
    name,
    email,
    avatar: login ? `https://github.com/${login}.png?size=64` : '',
    profile: login ? `https://github.com/${login}` : '',
    owner,
    ownerSource,
    ownerLogin,
    origin,
    source: { login: loginFrom, name: fromFile(saved.name) ? 'identity' : (gName ? 'git config' : ''), email: fromFile(saved.email) ? 'identity' : (gEmail ? 'git config' : '') },
    identityFile: IDENTITY_FILE,
  };
}

/** 把身份写进本机那份文件（不碰 git config，也不进仓库） */
export function saveIdentity(patch = {}) {
  const cur = readJson(IDENTITY_FILE) || {};
  const next = { ...cur };
  if (patch.login !== undefined) {
    const login = String(patch.login ?? '').trim();
    if (login && !LOGIN_RE.test(login)) throw new Error(`不像 GitHub 用户名：${login}（只允许字母数字和单个连字符）`);
    next.login = login;
  }
  if (patch.name !== undefined) next.name = String(patch.name ?? '').trim().slice(0, 60);
  if (patch.email !== undefined) {
    const email = String(patch.email ?? '').trim();
    if (email && (!email.includes('@') || /\s/.test(email) || email.length > 120)) throw new Error(`邮箱不像邮箱：${email}`);
    next.email = email;
  }
  /*
    `owner`：手动声明"这台机器就是站长"。
    只在"从 origin 认不出仓库所属者"时才需要它（本地克隆 / 镜像 / 自己搭的 git 服务），
    传 null 表示撤销声明（回到自动判断）。
  */
  if (patch.owner !== undefined) {
    if (patch.owner === null) delete next.owner;
    else next.owner = patch.owner === true;
  }
  next._readme = [
    '本机身份：共享编辑器用它显示「你是谁」（推流动态里的名字和头像），',
    '也用它判断这台机器是不是站长本人（只有站长会看到「版本」回滚面板）。',
    '⚠ 这个文件故意不进仓库（.gitignore 里排掉了）：每台机器填自己的。',
    '想改：编辑器 →「协作」面板 → 我是谁；或者 node tools/git/whoami.mjs --set --login 你的用户名',
    'owner: true/false 是手写的"这台机器就是站长"（只有 origin 认不出仓库所属者时才需要）。',
  ];
  writeJson(IDENTITY_FILE, next);
  return me({ refresh: true });
}

/* ---------------------------------------------------------------- 命令行 */

function usage() {
  return [
    '用法：',
    '  node tools/git/whoami.mjs                                 看现在是谁',
    '  node tools/git/whoami.mjs --json                          机读一行（编辑器服务用）',
    '  node tools/git/whoami.mjs --set --login someone --name 昵称  写进本机身份文件',
    '  node tools/git/whoami.mjs --set --owner                   声明「这台机器就是站长」（撤销：--no-owner）',
    '',
    '身份文件：tools/editor/.editor-identity.json（不进仓库）',
  ].join('\n');
}

function ownerText(info) {
  if (info.owner === true) return info.ownerSource === 'identity' ? '是（本机自己声明的）' : '是';
  if (info.owner === false) return '不是';
  if (!info.login) return '不知道（还没填用户名）';
  if (!info.origin.owner) return '不知道（origin 不是 GitHub 地址，认不出仓库所属者）';
  return '不知道';
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const flag = (n) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? (argv[i + 1] ?? '') : undefined;
  };
  const mark = (obj) => { if (asJson) console.log(`[result] ${JSON.stringify(obj)}`); };

  if (argv.includes('--set')) {
    try {
      const patch = { login: flag('login'), name: flag('name'), email: flag('email') };
      if (argv.includes('--owner')) patch.owner = true;
      if (argv.includes('--no-owner')) patch.owner = null;
      const info = saveIdentity(patch);
      if (!asJson) {
        console.log(`\n  身份已写到 ${IDENTITY_FILE}`);
        console.log(`  用户名：${info.login || '（空）'}    名字：${info.name}`);
        console.log(`  站长：${ownerText(info)}\n`);
      }
      mark(info);
      process.exitCode = 0;
    } catch (err) {
      console.error(`  ${err?.message || err}`);
      mark({ error: String(err?.message || err) });
      process.exitCode = 1;
    }
    return;
  }

  const info = me({ refresh: argv.includes('--refresh') });
  if (asJson) {
    mark(info);
  } else {
    console.log('');
    console.log('  ======== 我是谁 ========');
    console.log(`  用户名：${info.login || '（没问出来 —— 在编辑器「协作」面板里填一下）'}`);
    console.log(`  名字：  ${info.name}`);
    console.log(`  邮箱：  ${info.email || '（空）'}`);
    console.log(`  远端：  ${info.origin.owner ? `${info.origin.owner}/${info.origin.repo}` : '（origin 不是 GitHub 地址）'}`);
    console.log(`  站长：  ${ownerText(info)}`);
    console.log(`  身份文件：${IDENTITY_FILE}`);
    console.log('  ========================');
    console.log('');
  }
  process.exitCode = info.origin.github ? 0 : 1;
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();

export { usage };
