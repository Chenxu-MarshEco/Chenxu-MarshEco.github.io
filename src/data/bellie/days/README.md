# 每天一页：`src/data/bellie/days/<YYYY-MM-DD>.json`

这个目录是**机器人 lingyi 每天投递**的地方，一天一个文件，只由它写。
站点构建时把这里所有 `.json` 按日期倒序读进来，渲染成 `/bellie/`（铃忆的冰室圣经）。

投递格式、字段含义、校验命令都在仓库根目录的 **`铃忆投递指引.md`** 里 —— 那是给机器人看的，
改约定请改那一份，不要只改这里。

⚠ 从 2026-11-22 起还有**第二条来源**：`public/data/group-summaries/` 里 lingyi 每天附带的
完整群总结，它里面的 `statistics.golden_quotes` 五条会在构建时自动并进圣经
（`src/utils/bellie.ts` → `tools/bellie/summary.mjs`）。**同一天两边都有时以这个目录的天文件为准**，
推导出来的不会覆盖直接投递的。所以这里没有某一天、圣经页却有，是正常的。

⚠ 这个 `.md` 只是为了让空目录能进仓库；读取端只认 `.json`，看到别的后缀会直接跳过。
