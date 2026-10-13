/**
 * 「近期更新」—— 数据来源改成**读 git 的记录**（2026-10-13）。
 *
 * 以前：编辑器每次保存都往 `src/data/recent-edits.json` 里插一条。那是**所有人共写的
 * 同一份文件** —— 两个人各改各的页面也会在同一份文件里撞车，而且会越堆越多。
 * （站长转述群友的原话：「类似可以直接让他读git的记录，而不是由编辑器操作自动生成」）
 *
 * 现在：**页面名写进提交说明**（编辑器 / 启动器 / 命令行发布都写，见
 * `tools/git/recent-pages.mjs`），这里在构建时从 `git log` 把它读回来。
 * 各人写各人的提交说明 → 结构上不可能冲突。
 *
 * · 老那份 `recent-edits.json` 留着当**种子**（只读、不再写），历史不丢；
 * · 读不到 git（比如浅克隆没历史）也不报错，退化成只有种子；
 * · 排序 / 去重 / 封顶都在 `recent-pages.mjs` 里（一处实现，站点和编辑器共用）。
 */
import path from 'node:path';
import { recentPages, RECENT_MAX } from '../../tools/git/recent-pages.mjs';

/**
 * ⚠ 路径必须**显式传**，不能让 tools/git/recent-pages.mjs 自己按 `import.meta.url` 算：
 * 站点构建时那个模块是被 Vite **打包**进 `dist/.prerender/chunks/` 的，`import.meta.url`
 * 指向打包产物 —— 算出来的项目根成了 `dist/.prerender`，于是 `git log` 在非仓库目录里
 * 静默失败、"近期更新"整块变空（2026-10-13 实测踩到）。
 * Astro 构建 / dev 的工作目录就是项目根，直接用 `process.cwd()`。
 */
const PROJECT_ROOT = process.cwd();
const LEGACY = path.join(PROJECT_ROOT, 'src', 'data', 'recent-edits.json');

export interface RecentPageEdit {
  href: string;
  title: string;
  at: string;
  /** 毫秒时间戳；`at` 认不出来时是 0（排到最后） */
  time: number;
  /** 谁推的（提交署名；来自 git，种子里的没有） */
  who: string;
  /** 短 sha（种子里的没有） */
  sha: string;
  /** 这条是从 git 记录里读出来的，还是老数据文件里的种子 */
  from: 'git' | 'seed';
}

/** 最多留几条 —— 和写入端（tools/git/recent-pages.mjs 的 RECENT_MAX）一个数 */
export { RECENT_MAX };

/** 最近的页面改动：**按时间倒序**、同一页只留最新一条、最多 limit 条 */
export function recentPageEdits(limit = RECENT_MAX): RecentPageEdit[] {
  try {
    return recentPages({ limit, cwd: PROJECT_ROOT, legacyFile: LEGACY }) as RecentPageEdit[];
  } catch {
    /* git 读不到（没有 git / 浅克隆 / 权限）：退化成"只有种子"，不报错 */
    return recentPages({ limit, cwd: PROJECT_ROOT, legacyFile: LEGACY, scan: 0 }) as RecentPageEdit[];
  }
}
