/**
 * 首页「曼沫砾总线」右半边那块**近期更新**（= 推流动态）。
 *
 * 站长 2026-11-20 的要求（原话）：
 *   「另外对曼沫砾总线卡片进行修改 内部分为左右两个小版块 左边是公告事项 放公告
 *     右边是近期更新 罗列板块适配板块高度条数的近期更新动态 更新动态格式直接参考
 *     编辑器里的推流动态 和编辑器里那个一模一样就好了 可以把编辑器里记录的所有
 *     推流动态都搬过去并且后续推流动态也在那里显示」
 *
 * 所以这里读的就是**编辑器「协作」面板里那份推流动态**（tools/git/activity.mjs），
 * 一个字段都不另造：谁 · 什么时候 · 改了哪几块。区别只有两处，都是站长点名要的：
 *   ① 那句提交说明（`title`）**不显示** —— 那是 AI 写的简介，他不要；
 *   ② 「改了哪几块」要**更具体**：鼠标移上去弹出卡片，列出这次到底改了哪些页面 /
 *      子版块 / 冰山词条 / 精华条目，卡片里每一条都能点、直接跳到那个位置。
 *      明细由 tools/git/activity-detail.mjs 按 id 比出来（新增 / 改动 / 删除）。
 *
 * ⚠ 构建期读 git，所以**只在构建时**跑（静态站，构建产物里就是那一刻的动态）。
 *   站点每次发布都会重新构建，所以"后续推流动态也在那里显示"是成立的。
 */
import { readCommits } from '../../tools/git/activity.mjs';
import { detailForCommit } from '../../tools/git/activity-detail.mjs';
import { ensureActors, resolveActor } from '../../tools/git/avatar-map.mjs';
import site from '../site.config';
import { flattenBoards, type BoardNode } from './boards';
import { announceHref, announceList } from './announce';
import { salonEssences } from './salon';
import { navCategories } from './navs';
import { timelines } from './timelines';
import { withBase } from './url';

/** 一条明细：改了什么、叫什么、点它去哪 */
export interface ActivityItem {
  /** 稳定 id（同一个提交里唯一），给卡片里的行用 */
  key: string;
  /** 新增 / 改动 / 删除 */
  change: 'add' | 'edit' | 'del';
  /** 显示的名字（页面名 / 词条名 / 精华摘要） */
  label: string;
  /** 点它去哪；空串 = 这一条没有能跳的地方（比如被删掉的） */
  href: string;
}

/** 一块：面板名 + 它下面那些明细 */
export interface ActivityPanel {
  panel: string;
  items: ActivityItem[];
}

export interface ActivityEntry {
  sha: string;
  short: string;
  /** 谁推的（GitHub 用户名优先，退化成提交署名） */
  who: string;
  /** 头像（拿不到就是空串，页面上画名字首字） */
  avatar: string;
  /** 主页（有用户名才有） */
  profile: string;
  /** 提交时间（ISO） */
  iso: string;
  /** 毫秒时间戳，排序用 */
  time: number;
  /** 是不是站长自己推的（编辑器里"自己的推流淡一点"，这里也照做） */
  mine: boolean;
  /** 面板名清单（「站点源码、公告、页面 / 子版块、冰山图」这一行） */
  panels: string[];
  /** 明细（鼠标移上去那张卡片里的内容） */
  detail: ActivityPanel[];
  /** 一共改了多少条明细 */
  count: number;
}

/* ------------------------------------------------------------------
 * 明细里的 id → 站内地址
 *
 * 地址规则**只写在这一处**，而且全部复用站点自己的工具函数：
 * 版块树用 flattenBoards（和首页大板块卡同一个推导），公告用 announceHref，
 * 精华 / 冰山 / 时间轴 / 导航都是页内锚点（页面上那些元素本来就带 id）。
 * ------------------------------------------------------------------ */
const flat = flattenBoards(site.homeBoards as BoardNode[]);
const boardUrl = new Map(flat.filter((f) => !f.external).map((f) => [String(f.node.id), f.url]));
const announceUrl = new Map(announceList().map((a) => [a.id, announceHref(a)]));
const essenceUrl = new Map(salonEssences.map((e) => [e.id, `/salon/#${e.id}`]));
const navUrl = new Map<string, string>();
for (const cat of navCategories) {
  navUrl.set(cat.id, `/huaya/character/xichenxu#${cat.id}`);
  for (const g of cat.groups ?? []) {
    navUrl.set(g.id, `/huaya/character/xichenxu#${g.id}`);
    for (const it of g.items ?? []) if (it.href) navUrl.set(it.id, it.href);
    for (const sg of g.subgroups ?? []) {
      navUrl.set(sg.id, `/huaya/character/xichenxu#${sg.id}`);
      for (const it of sg.items ?? []) if (it.href) navUrl.set(it.id, it.href);
    }
  }
}
const timelineUrl = new Map<string, string>();
for (const tl of timelines) {
  timelineUrl.set(tl.id, '/salon/');
  for (const p of tl.points ?? []) if (p.href) timelineUrl.set(p.id, p.href);
}

/** 面板名 → 这一块明细里的 id 该跳去哪 */
const hrefOf = (panel: string, id: string): string => {
  if (panel === '页面 / 子版块') return boardUrl.get(id) ?? '';
  if (panel === '公告') return announceUrl.get(id) ?? '';
  if (panel === '精华 / 成员') return essenceUrl.get(id) ?? '';
  if (panel === '冰山图') return `/iceberg/#${id}`;
  if (panel === '导航') return navUrl.get(id) ?? '';
  if (panel === '时间轴') return timelineUrl.get(id) ?? '';
  if (panel === '文章' || panel === '手记') return id;
  if (panel === '眠鱼志') return `/logs/${id}/`;
  return '';
};

/** 站内地址补 base（外链原样） */
const link = (href: string): string =>
  !href ? '' : /^https?:/i.test(href) ? href : withBase(href);

/**
 * 首页那一块要显示几条。
 *
 * ⚠ 站长 2026-11-20 的原话（第二次强调）：
 *   「板块高度千万不能变！！尽可能罗列是说尽可能好看地把板块填满而不是撑爆！！
 *     和之前的公告一样最多显示铺满板块的几条其他点进新页面看就可以了！！！！」
 *
 * 所以这里**只给正好铺满卡片的那几条**（右栏可用高度 ≈ 157px，一条 ≈ 38px → 4 条），
 * 多出来的不往首页塞 —— 卡片高度是首页那一屏严格对齐的一部分，一条都不能撑。
 * 想往前翻就去编辑器「协作」面板（那里是 20 条）。
 */
const LIMIT = 5;

let cache: ActivityEntry[] | null = null;
/** 整份（`/feed/` 那页用，不带明细）也缓存一份，别在两次调用里各算一遍 */
let fullCache: ActivityEntry[] | null = null;

/**
 * 算一批动态。
 * @param limit       读多少条提交（`Infinity` = 全部）
 * @param withDetails 要不要算「具体改了哪几条」（首页那 4 条要，整页列表不要 ——
 *                    317 条每条都去 diff 一遍要四十多秒，那一页也用不上）
 */
async function build(limit: number, withDetails: boolean): Promise<ActivityEntry[]> {
  let data: { commits?: Record<string, unknown>[] } | null = null;
  try {
    data = readCommits({ limit: Number.isFinite(limit) ? limit : 100000 });
  } catch {
    data = null;
  }
  /*
    署名 → GitHub 用户名 / 头像（一次请求，失败就退化）。
    问的是最近 30 条，但结果按**邮箱**存，所以同一个人很久以前的提交也一起认出来了。
  */
  let actors = { byEmail: {} } as Awaited<ReturnType<typeof ensureActors>>;
  try {
    const emails = (data?.commits ?? [])
      .map((c) => String((c.author as { email?: string } | undefined)?.email ?? ''))
      .filter(Boolean);
    actors = await ensureActors({ emails, limit: 30, cwd: process.cwd() });
  } catch {
    /* 拿不到头像不影响列表本身 */
  }

  const out: ActivityEntry[] = [];
  for (const c of data?.commits ?? []) {
    const sha = String(c.sha ?? '');
    if (!sha) continue;
    const files = Array.isArray(c.files) ? (c.files as string[]) : [];
    const detail: ActivityPanel[] = [];
    if (withDetails) {
      try {
        /* ⚠ cwd 显式传：构建时这个模块被 Vite 打包，import.meta.url 算出来的根是错的 */
        for (const p of detailForCommit({ sha, files, cwd: process.cwd() })) {
          const items = p.items
            .map((it, i) => ({
              key: `${sha}-${p.panel}-${i}`,
              change: it.change,
              label: it.label,
              href: link(hrefOf(p.panel, it.id)),
            }))
            /* 明细太多就截断：卡片里放不下，也没人看得完 */
            .slice(0, 24);
          if (items.length) detail.push({ panel: p.panel, items });
        }
      } catch {
        /* 明细算不出来不影响这一条动态本身 */
      }
    }
    const author = (c.author ?? {}) as { name?: string; email?: string };
    const committer = (c.committer ?? {}) as { name?: string };
    /* 头像 / 用户名：和编辑器里那一条一样，拿不到就用署名 + 首字圆圈 */
    const actor = resolveActor(String(author.email ?? ''), actors);
    out.push({
      sha,
      short: String(c.short ?? sha.slice(0, 7)),
      who: String(actor.login || author.name || committer.name || '（没署名）'),
      avatar: actor.avatar,
      profile: actor.profile,
      iso: String(c.iso ?? ''),
      time: Number(c.time ?? 0),
      mine: false,
      panels: Array.isArray(c.panels) ? (c.panels as string[]) : [],
      detail,
      count: detail.reduce((a, p) => a + p.items.length, 0),
    });
  }
  return out;
}

/**
 * 首页那块近期更新（构建期算一次，页面里直接用）。
 *
 * `await`：头像要问一次 GitHub（见 tools/git/avatar-map.mjs）。
 * 本地构建时编辑器已经问过的那些人直接从 `.tmp/collab-actors.json` 拿，
 * 一个请求都不发；问不到就退回"名字首字画个圆"，不会让构建失败。
 */
export async function recentActivity(limit = LIMIT): Promise<ActivityEntry[]> {
  if (!cache) cache = await build(LIMIT, true);
  return cache.slice(0, limit);
}

/**
 * 全部推流动态（`/feed/` 那一页）。
 *
 * 站长 2026-11-20：「加个推流动态按钮可以跳转到一个页面可以查看所有推流动态
 * 并且进去的都可以一直储存在那里 就像日志一样」——
 * 所以这里**不封顶**：git 里有多少条提交就列多少条，一条都不会因为时间久了消失。
 */
export async function allActivity(): Promise<ActivityEntry[]> {
  if (!fullCache) fullCache = await build(Number.POSITIVE_INFINITY, false);
  return fullCache;
}
