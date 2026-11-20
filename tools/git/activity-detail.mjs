#!/usr/bin/env node
/*
 * ============================================================================
 * 推流动态的**详情** —— 一次提交到底改了哪几页 / 哪几个词条
 * ----------------------------------------------------------------------------
 * 站长 2026-11-20 的要求（原话）：
 *   「删掉类似：全站默认挂「花娅年代记」时间轴；涣愿终池页与文章手记页各换一套时间轴外壳
 *     这种AI描述的简介 不需要 只保留【站点源码、公告、页面 / 子版块、冰山图】这部分即可，
 *     但是这一部分需要更具体一些 尤其是页面子版块部分 鼠标移上去需要弹出卡片详细列出
 *     修改了哪些页面和子版块 冰山，精华等也是一样 鼠标移上去详细显示修改或者新增了哪些
 *     冰山精华条目等 其他可以跳转的页面也都要这样处理 鼠标移上去显示详细修改详情卡片
 *     并且鼠标继续在卡片里停留可以选择这些详细条目并且直接跳转到对应的链接」
 *
 * 所以这里做的事：**把一次提交改了哪些"条目"算出来**。
 *   · 输入：提交 sha + 它改过的文件清单（`git log --name-only` 已经给了）；
 *   · 做法：把改动前后的两份 JSON 都取出来（`git show <sha>^:file` / `git show <sha>:file`），
 *     按 id 比一遍 —— 新增 / 删除 / 改动各是哪些；
 *   · 输出：`[{ panel, items: [{ id, label, change }] }]`。
 *
 * 每个条目有两个东西：
 *   label  给人看的名字（页面名 / 词条名 / 精华摘要）
 *   sig    比对用的签名（内容哈希）—— 只比 id 的话，"给某一页加了一个块"、
 *          "今天补了几句日志"这种**id 没变、内容变了**的改动会显示成"什么都没改"。
 *
 * ⚠ 这里**只给 id 和名字，不给地址**。地址由站点那边（src/utils/activity.ts）用它自己的
 *   utils 算（版块树 → flattenBoards、公告 → announceHref、精华 → /salon/#id…）——
 *   地址规则只写在一处，这里再抄一份迟早会不一致。
 *
 * ⚠ 只读 git，不写任何东西。
 * ============================================================================
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

/**
 * 取某个提交里的某个文件（不存在 / 二进制 / 出错都返回 null）。
 *
 * ⚠ `cwd` 必须由调用方传：站点构建时这个模块会被 Vite **打包**进
 * `dist/.prerender/chunks/`，`import.meta.url` 指向打包产物 —— 算出来的根成了
 * `dist/.prerender`，`git show` 在非仓库目录里静默失败，明细整块变空
 * （2026-11-20 实测踩到；`src/utils/recent-edits.ts` 里记过同一个坑）。
 */
const blobCache = new Map();
function blob(sha, file, cwd = ROOT) {
  const key = `${cwd}:${sha}:${file}`;
  if (blobCache.has(key)) return blobCache.get(key);
  let out = null;
  try {
    out = execFileSync('git', ['show', `${sha}:${file}`], {
      cwd,
      encoding: 'utf8',
      timeout: 20000,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    out = null;
  }
  blobCache.set(key, out);
  return out;
}

const json = (text) => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * 一段文字的短哈希（8 位十六进制）。
 *
 * 只用来判断"这一条的内容到底动没动"，**不上页面**（label 是干净的名字）。
 */
function shortHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 一条：给人看的名字 + 比对签名 */
const entry = (label, sig) => ({ label: String(label ?? ''), sig: String(sig ?? label ?? '') });

/* ------------------------------------------------------------------
 * 每个数据文件：怎么从 JSON 里收集「id → { label, sig }」
 * ------------------------------------------------------------------ */
const collectBoards = (data) => {
  const map = new Map();
  const walk = (list) => {
    for (const n of list ?? []) {
      if (!n?.id) continue;
      const blocks = Array.isArray(n.page) ? n.page.length : 0;
      map.set(String(n.id), entry(String(n.title ?? n.id), `${n.title ?? ''}|${blocks}|${shortHash(JSON.stringify(n.page ?? []))}`));
      walk(n.children);
    }
  };
  walk(data?.boards);
  return map;
};

const collectIceberg = (data) => {
  const map = new Map();
  for (const layer of data?.layers ?? []) {
    for (const it of layer?.items ?? []) {
      if (!it?.id) continue;
      map.set(String(it.id), entry(String(it.name ?? it.id), `${it.name ?? ''}|${it.desc ?? ''}|${it.href ?? ''}`));
    }
  }
  return map;
};

const collectSalon = (data) => {
  const map = new Map();
  for (const m of data?.members ?? []) {
    if (!m?.id) continue;
    map.set(String(m.id), entry(String(m.name ?? m.id), `${m.name ?? ''}|${m.avatar ?? ''}`));
  }
  for (const e of data?.essences ?? []) {
    if (!e?.id) continue;
    const text = String(e.text ?? '').replace(/\s+/g, ' ').trim();
    const label = `${String(e.date ?? '')}${text ? ` ${text.slice(0, 18)}` : ''}`.trim() || String(e.id);
    map.set(String(e.id), entry(label, `${e.date ?? ''}|${text}|${(e.images ?? []).length}`));
  }
  return map;
};

const collectNavs = (data) => {
  const map = new Map();
  const walkItems = (list) => {
    for (const it of list ?? []) {
      if (it?.id) map.set(String(it.id), entry(String(it.text ?? it.id), `${it.text ?? ''}|${it.href ?? ''}`));
    }
  };
  for (const cat of data?.categories ?? []) {
    if (cat?.id) map.set(String(cat.id), entry(String(cat.title ?? cat.id), `${cat.title ?? ''}|${cat.link ?? ''}`));
    for (const g of cat?.groups ?? []) {
      if (g?.id) map.set(String(g.id), entry(String(g.title ?? g.id), String(g.title ?? '')));
      walkItems(g?.items);
      for (const sg of g?.subgroups ?? []) {
        if (sg?.id) map.set(String(sg.id), entry(String(sg.title ?? sg.id), String(sg.title ?? '')));
        walkItems(sg?.items);
      }
    }
  }
  return map;
};

const collectTimelines = (data) => {
  const map = new Map();
  for (const tl of data?.timelines ?? []) {
    if (tl?.id) map.set(String(tl.id), entry(String(tl.title ?? tl.id), `${tl.title ?? ''}|${(tl.points ?? []).length}`));
    for (const p of tl?.points ?? []) {
      if (!p?.id) continue;
      map.set(String(p.id), entry(`${String(p.label ?? p.id)}${p.date ? ` ${p.date}` : ''}`, `${p.label ?? ''}|${p.date ?? ''}|${p.href ?? ''}`));
    }
    for (const s of tl?.spans ?? []) {
      if (s?.id) map.set(String(s.id), entry(String(s.name ?? s.id), `${s.name ?? ''}|${s.from ?? ''}|${s.to ?? ''}`));
    }
  }
  return map;
};

const collectAnnounce = (data) => {
  const map = new Map();
  for (const it of data?.items ?? []) {
    if (!it?.id) continue;
    map.set(String(it.id), entry(String(it.title ?? it.id), `${it.title ?? ''}|${it.date ?? ''}|${it.kind ?? ''}`));
  }
  return map;
};

const collectMianyu = (data) => {
  const map = new Map();
  for (const e of data?.entries ?? []) {
    if (!e?.date) continue;
    /*
      一天只有一栏，同一天再写一次是**原地覆盖**：id（日期）不变、只有正文变了。
      所以 label 用正文开头（看得懂是哪一天写了什么），sig 用全文哈希（动一个字就变）。
      ⚠ 正文里有反引号和 Markdown 记号，卡片里要按纯文字显示 —— 反引号先去掉。
    */
    const text = String(e.text ?? '')
      .replace(/`+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    /* 卡片里一行放得下的长度：第一句（或前 42 个字），别在半句话上截断 */
    const first = (text.split(/[。：；!？]/)[0] || text).trim();
    const head = first.length > 42 ? `${first.slice(0, 42)}…` : first;
    map.set(String(e.date), entry(`${e.date}${head ? ` ${head}` : ''}`, shortHash(text)));
  }
  return map;
};

const collectWidgets = (data) => {
  const map = new Map();
  for (const [k, v] of Object.entries(data ?? {})) {
    if (k.startsWith('_')) continue;
    const title = v && typeof v === 'object' ? String(v.title ?? '') : '';
    map.set(k, entry(title ? `${k}（${title}）` : k, shortHash(JSON.stringify(v ?? null))));
  }
  return map;
};

/**
 * 文件 → 面板名 + 收集器。
 * ⚠ 顺序有讲究：具体的写在前面（和 tools/git/activity.mjs 的 PANEL_RULES 一个道理）。
 */
const RESOLVERS = [
  { re: /^src\/data\/home-boards\.json$/i, panel: '页面 / 子版块', collect: collectBoards },
  { re: /^src\/data\/iceberg\.json$/i, panel: '冰山图', collect: collectIceberg },
  { re: /^src\/data\/salon\.json$/i, panel: '精华 / 成员', collect: collectSalon },
  { re: /^src\/data\/navs\.json$/i, panel: '导航', collect: collectNavs },
  { re: /^src\/data\/timelines\.json$/i, panel: '时间轴', collect: collectTimelines },
  { re: /^src\/data\/announcements\.json$/i, panel: '公告', collect: collectAnnounce },
  { re: /^src\/data\/mianyu\.json$/i, panel: '眠鱼志', collect: collectMianyu },
  { re: /^src\/data\/home-widgets\.json$/i, panel: '首页那几块', collect: collectWidgets },
];

/** 内容文件（文章 / 手记）：文件路径本身就是那一条 */
const CONTENT = [
  { re: /^src\/content\/posts\/(.+)\.md$/i, panel: '文章', href: (m) => `/posts/${m[1]}` },
  { re: /^src\/content\/notes\/(.+)\.md$/i, panel: '手记', href: (m) => `/notes/${m[1]}` },
];

/** 两个 id→{label,sig} 的表比一遍 */
function diffMaps(before, after) {
  const items = [];
  for (const [id, now] of after) {
    const old = before.get(id);
    if (!old) items.push({ id, label: now.label, change: 'add' });
    else if (old.sig !== now.sig) items.push({ id, label: now.label, change: 'edit' });
  }
  for (const [id, old] of before) {
    if (!after.has(id)) items.push({ id, label: old.label, change: 'del' });
  }
  return items;
}

/**
 * 一次提交改了哪些条目。
 * @param {{sha:string, files:string[], cwd?:string}} commit
 *   `cwd` 是仓库根（站点构建时必须显式传 `process.cwd()`，见上面 blob 的说明）
 * @returns {{panel:string, items:{id:string,label:string,change:'add'|'edit'|'del'}[]}[]}
 */
export function detailForCommit({ sha, files, cwd = ROOT }) {
  if (!sha) return [];
  const byPanel = new Map();
  const push = (panel, items) => {
    if (!items.length) return;
    const list = byPanel.get(panel) ?? [];
    list.push(...items);
    byPanel.set(panel, list);
  };

  for (const file of files ?? []) {
    /* 内容文件：新增 / 删除 / 改动都算"这一篇动了" */
    const content = CONTENT.find((r) => r.re.test(file));
    if (content) {
      const m = content.re.exec(file);
      const href = content.href(m);
      const after = blob(sha, file, cwd);
      const before = blob(`${sha}^`, file, cwd);
      const change = !before ? 'add' : !after ? 'del' : 'edit';
      push(content.panel, [{ id: href, label: m[1], change }]);
      continue;
    }

    const hit = RESOLVERS.find((r) => r.re.test(file));
    if (!hit) continue;
    const after = json(blob(sha, file, cwd));
    const before = json(blob(`${sha}^`, file, cwd));
    /* 两份都读不出来（二进制 / 新仓库第一次提交）就跳过，别瞎猜 */
    if (!after && !before) continue;
    const items = diffMaps(before ? hit.collect(before) : new Map(), after ? hit.collect(after) : new Map());
    push(hit.panel, items);
  }

  return [...byPanel.entries()].map(([panel, items]) => ({ panel, items }));
}

/* ---------------------------------------------------------------- 命令行 */

function main() {
  const argv = process.argv.slice(2);
  const sha = argv[0] || 'HEAD';
  const files = argv.slice(1);
  const out = detailForCommit({ sha, files });
  console.log(JSON.stringify(out, null, 2));
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();
