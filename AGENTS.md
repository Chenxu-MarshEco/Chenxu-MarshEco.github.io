# 给在这个仓库里干活的助手（含协作者那边的 AI）

> 这份文件会被 DSH 之类的工具当成"工作区指令"读进上下文。
> 改动这个仓库之前请先看完，尤其是**更新日志**那一段。

## 一、动手之前

- **改数据文件之前先拉远端、改完用 `node tools/git/sync.mjs publish` 发布**
  （探连接 → 提交 → **先 `pull --rebase`** → 推送）。**永不强推**：那会把别人的东西抹掉。
- 站长可能正开着本地编辑器改 `src/data/*.json`。**不要 `git add -A`**，
  只提交你明确改过的那几个路径。
- 编辑器认的几份数据（`home-boards.json` / `navs.json` / `iceberg.json` …）都有
  「过时草稿」保护，别绕过它去直接覆盖。

## 二、每轮对话的收尾：更新日志（硬要求）

**只要这一轮动过仓库里的文件**，收尾前必须往 `src/data/mianyu.json` 追加**当天**的日志：

```bash
node tools/memory/append-log.mjs 2026.10.12 .tmp/log.txt --dry   # 先看
node tools/memory/append-log.mjs 2026.10.12 .tmp/log.txt         # 真写
node tools/checks/log-freshness.mjs                              # 自检
```

### 每天第一次对话：先查前一天的日志字数

```bash
node tools/memory/log-length.mjs --yesterday
```

上限 **1000 字**（目标 ≤ 600）。退出码 1 就是前一天写太长了，按它给的步骤压缩：
保留事实（改了什么 / 为什么 / 怎么验的），砍掉铺陈；**同一天再写一次 = 原地覆盖那一栏**，
不会多出一条。压完再跑一次确认，然后才去干别的活。

（`log-freshness.mjs` 也接了这条：今天 / 前一天超上限就会红，更早的日子只提示不拦发布。）

- **一天只有一栏**：同一天再写一次 = 就地覆盖，别留三条同一天的。
- 唯一位置是 `src/data/mianyu.json`。**不要**写进 `home-boards.json` 的「更新日志」页
  —— 编辑器一保存就覆盖（2026-09-28 出过这个事故）。
- 日期用点号（`2026.10.12`），正文说人话：改了什么、为什么、怎么验的。

## 三、改完怎么验

```bash
node node_modules/astro/bin/astro.mjs build      # 这个环境里 pnpm 用不了，直接掉 astro
node tools/checks/<相关的那个>.mjs                # 验收脚本：真浏览器 + 真服务端
```

- 验收脚本一律打印 `PASS n / FAIL n`，**别只看 exit code 就宣布通过**。
- 浏览器路径不用写死：`tools/checks/lib/chrome.mjs` 会自己找
  （要指定就设环境变量 `DSH_CHROME`）。
- `/logs/<日期>/` 是助手日志的单日页，正文在那儿；列表页在 `/huaya/memory/mianyu`。

## 四、站上的几个"看着奇怪其实是故意的"

- `src/data/mianyu.json`（眠鱼志）和 `src/data/recent-edits.json`（近期更新）
  **故意不放进 `home-boards.json`**：助手写的和编辑器写的必须分家。
  ⚠ 其中 `recent-edits.json` **2026-10-13 起不再被写**，只当历史种子读 ——
  「近期更新」改成**读 git 的记录**（见下一条）。
- **「近期更新」的数据来源 = 提交说明**（2026-10-13 改）：页面名写在提交说明里那一段
  （抬头 `改过这些页面：`，格式 `- /页面地址 页面名` 一行一页），站点构建时从 `git log` 读回
  （`tools/git/recent-pages.mjs` / `src/utils/recent-edits.ts`）。
  于是**各人写各人的提交说明，结构上不可能冲突** —— 这是群友那句「直接读 git 的记录，
  而不是由编辑器自动生成」的落地。
  · 编辑器保存时只记在**本机** `tools/editor/.editor-edits.json`（不进仓库）；
  · 发布时自动拼进提交说明（编辑器 / 启动器 / 命令行 `publish` 都会），成功后清掉；
  · **手动写提交说明的时候也要带上那一段**（否则你改的页面不会出现在「近期更新」里）：
    ```
    更新内容 2026-10-13：改了什么

    改过这些页面：
    - /huaya/years/newhuaya 新花娅地
    ```
- 列表页的翻页是**客户端**的（`src/components/Pager.astro`）：条目整份在 HTML 里，
  只把不在本页的 `hidden` 掉，页码放 `?page=N`。一页条数在 `src/utils/pager.ts`（37）。
- 「拉远端」**不是只做快进**：本地有没发布的提交时会**接到远端后面**（rebase，只拉不推）；
  远端动的正是你手上改过还没提交的那几份时会**拒绝**（免得工作区里留冲突标记）；
  正停在一个没做完的 merge / rebase 里时会拒绝并让你先收尾。别把它改回"只许快进"。
