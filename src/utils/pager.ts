/**
 * 列表一页几条 —— 全站就这一个数（用户 2026-10-12 定的「全部一页 37 条」）。
 *
 * 谁在用：文章 `/posts/`、手记 `/notes/`、助手日志（眠鱼志）列表，
 * 以及它们身上那个 `<Pager>` 组件（页码数量必须和这个数一致，否则
 * 「标签写第 5 页、点进去只到第 4 页」这种错会很难查）。
 *
 * ⚠ `PAGER_SIZE` 这个构建期环境变量**只给验收用**：
 * 站上的列表现在都还没超过 37 条，翻页条按设计根本不出现 ——
 * 那 `tools/checks/pager-check.mjs` 就没东西可量。构建时把它调小
 * （`PAGER_SIZE=4` → 构建到 `.tmp/pager-dist`），就能在**真实页面**上
 * 把翻页整个走一遍：数字、上下页、输入框跳页、?page=N、年份分组。
 * 不设就是 37，线上永远是 37。
 */
const fromEnv = Number(process.env.PAGER_SIZE);

export const PAGE_SIZE = Number.isFinite(fromEnv) && fromEnv >= 1 ? Math.floor(fromEnv) : 37;
