# 个人站点

一个静态个人网站：文章 + 手记 + 标签 + 归档 + 关于 + 友链。
用 [Astro](https://astro.build) 构建，托管在 GitHub Pages 上，**完全免费，没有服务器，没有数据库**。

所有内容都是仓库里的 Markdown 文件——你写的每一个字都在自己手里。

---

## 一、日常怎么用

装好之后，你平时只需要双击根目录下的**一个**文件：

**`花娅陌质流.cmd`**

双击后会弹出一个蒸汽波风格的小窗口，用鼠标点就行：

```
   花娅陌质流
   ──────────────────────────────────────────────────────

   依赖 ● 已就绪     备份 ● 已连接

   ──────────────────────────────────────────────────────

     ┌──────────────┐   ┌──────────────┐
     │   写 文 章    │   │   看 效 果    │
     │ 打开编辑器…   │   │ 在浏览器里…   │
     └──────────────┘   └──────────────┘
     ┌──────────────┐   ┌──────────────┐
     │   发布上线    │   │   首次设置    │
     │ 提交并推送…   │   │ 检查环境…     │
     └──────────────┘   └──────────────┘
```

**写文章**　打开可视化编辑器，在浏览器里写文章、传图片（`http://localhost:4322`）。
**看效果**　在浏览器里看站点真实效果（`http://localhost:4321`）。
**发布上线**　提交并推送到 GitHub，一两分钟后线上更新。
**首次设置**　**只跑一次**。检查环境、安装依赖。

窗口顶部两盏小灯显示当前状态：依赖装没装、有没有连上 GitHub。
没装依赖就点前三个，它会提醒你先做首次设置。

按钮点下去之后会切到一个日志页，命令的输出实时显示在那里，
左上角「返回」回主界面，右上角「停止」可以中断（比如关掉预览服务）。
按 `Esc` 也能退出。

> 第一次用之前，需要先装 **Node.js LTS**（<https://nodejs.org/>）、
> **Git**（<https://git-scm.com/>）和 **Python 3**（<https://www.python.org/downloads/>，
> 安装时**必须勾上 `tcl/tk and IDLE`**，否则画不出窗口）。都是一路点「下一步」。
> 装完再双击 `花娅陌质流.cmd`，点「首次设置」。

如果你更喜欢命令行，对应的命令是：

```bash
pnpm install      # 安装依赖
pnpm editor       # 打开编辑器
pnpm dev          # 本地预览
pnpm build        # 手动构建到 dist/
pnpm preview      # 预览构建结果
```

窗口里的每个动作也能单独从命令行跑（万一图形界面起不来）：

```bash
node tools/menu.mjs setup      # 等同于「首次设置」
node tools/menu.mjs publish    # 等同于「发布上线」
```

> 界面是用 Python 自带 tkinter 手绘的（`tools/studio/studio.py`），
> 不依赖任何第三方库。配色取自一张参考图，逐带采样得到。

---

## 二、目录结构

```
.
├── 花娅陌质流.cmd            ← 双击这个，所有操作都在里面
├── src/
│   ├── site.config.ts        ← 【常改】站点名、签名、导航、友链、联系方式
│   ├── styles/
│   │   ├── tokens.css        ← 【常改】颜色、字体、圆角、留白 —— 美术全在这
│   │   └── global.css        ← 全站样式（一般不用动）
│   ├── content/
│   │   ├── posts/            ← 文章（Markdown）
│   │   └── notes/            ← 手记（Markdown）
│   ├── content.config.ts     ← 内容字段定义（加字段时改这里）
│   ├── layouts/BaseLayout.astro
│   ├── components/           ← 页头、页脚、文章条目、目录
│   ├── utils/                ← 取内容、排日期、拼链接的小工具
│   └── pages/                ← 每个文件对应一个网址
├── public/                   ← 静态资源，原样复制到线上
│   ├── favicon.svg           ← 浏览器标签页小图标
│   ├── og-default.svg        ← 分享到社交平台的预览图（建议换成 1200×630 的 PNG）
│   └── img/uploads/          ← 编辑器上传的图片会存在这里
├── tools/studio/studio.py    ← 那个蒸汽波风格的窗口（Python + tkinter）
├── tools/editor/             ← 配套的本地编辑器（Node，零依赖）
├── tools/menu.mjs            ← 命令行版的菜单，图形界面起不来时的备胎
├── .github/workflows/deploy.yml  ← 自动部署配置
├── astro.config.mjs          ← 站点地址、构建方式
└── pnpm-workspace.yaml       ← 包管理器设置
```

---

## 三、改美术：只改一个文件

打开 `src/styles/tokens.css`，里面全是变量，含义都有中文注释。改完保存，本地预览会立刻刷新。

最常改的几个：

```css
--c-accent: #b4532a;   /* 强调色，整站唯一的彩色 */
--c-bg: #fbfaf8;       /* 页面底色 */
--c-text: #1f1d1a;     /* 正文颜色 */
--font-display: ...;   /* 标题字体 */
--w-prose: 42rem;      /* 正文宽度，写小说可以调窄一点 */
--r-md: 8px;           /* 圆角，想要方块感就改成 0 */
--shadow-md: ...;      /* 阴影，想要完全扁平就改成 none */
```

暗色主题在同一个文件下方的 `:root[data-theme='dark']` 区块里。

**暗色不是靠系统设置切换的**，而是靠 `<html>` 上的 `data-theme` 属性——右上角那个按钮可以在
「自动 → 亮色 → 暗色」之间循环，选完记在浏览器本地。所以：

- 想改暗色配色：改 `:root[data-theme='dark']` 里那些值，别去改媒体查询
- 只想要亮色：删掉整个 `:root[data-theme='dark']` 区块，再删掉页头的主题按钮

### 改颜色时的两个坑

**1. `--c-text-faint` 不能随便调亮。** 它是全站最弱的文字（日期、栏目标题、页脚版权），
需要同时满足在 `--c-bg` 和 `--c-bg-sunken` 两种底色上都达到 WCAG AA 的 4.5:1。
当前值在两种底色上都是 4.6:1，已经贴着下限了。调亮一点就会不达标。

**2. 代码高亮同时配了两套主题。** 见 `astro.config.mjs` 里的 `shikiConfig`：

```js
themes: {
  light: 'github-light-default',
  dark: 'github-dark-default',
}
```

只配一套的话，在另一种主题下 token 颜色会和代码块背景撞在一起——浅色的字配浅色的底，
几乎看不见。这是构建期发现不了的，必须真的渲染出来才知道。

配色规则写在 `global.css` 的「代码高亮双主题取色」那段，按 `data-theme` 选用
shiki 输出的 `--shiki-light` / `--shiki-dark` 变量。如果换了主题名，那段里针对
注释色的那条规则（`--shiki-light:#6e7781`）可能就失效了，需要重新核对对比度。

想放自己的字体：把字体文件丢进 `public/fonts/`，然后在 `global.css` 顶上加一段 `@font-face`。

### 首页背景的动效在哪改

首页那片蒸汽波背景是**分层**的，每层各自动。样式都在 `src/pages/index.astro`
的 `<style>` 里，塔吊单独在 `src/components/HomeCranes.astro`：

| 层 | 在动什么 | 想调就找 |
| --- | --- | --- |
| 天空 | 色带缓慢上下流动、染色慢慢明灭 | `@keyframes sky-flow` / `sky-tint` |
| 落日 | 条纹微微上下游移、辉光呼吸、整体缓缓浮动 | `sun-stripes` / `sun-halo` / `sun-float` |
| 扫描线 | 按一个条纹周期往下滚（CRT） | `scan-roll` |
| 塔吊 | 三台各自缓慢回转横臂 | `crane-slew`；快慢改每台的 `--dur` |
| 水面 | 倒影被切成横向条带左右错动、碎金闪、岸线明灭 | `reflect-chop` / `glitter-a` `glitter-b` / `shore-glow` |
| 天际线 | 页面滚动时整片轻微上移（CSS 滚动驱动，无 JS） | `.vapor__horizon` 那段 `is:inline` 样式 |

改的时候有两条约定，破了会很难受：

1. **动效只碰 `transform` 和 `opacity`。** 这两个属性走合成层，不重绘画面。
   换成动 `background-position`、`filter`、`width` 这类，整屏就会每帧重画。
2. **「减少动效」偏好下所有背景动画会整体停掉**（`prefers-reduced-motion`）。
   新加的动画请一并放进 `index.astro` 末尾那段 `@media (prefers-reduced-motion: reduce)`，
   组件里的放在组件自己的 `<style>` 里 —— Astro 的作用域选择器跨不进组件内部。

塔吊的站位不是随手摆的：它按「两张板块卡片之间那道缝」量出来，
而缝的位置取决于 `src/data/layout.json` 里 `home.boards` 的偏移。
在编辑器里挪过板块之后，跑一次本机的核对脚本
（`_setup/home-motion-check.mjs`，不在仓库里）会打印每台塔吊的可见高度和横臂朝向。

### 大板块页的版式（一块块的面板）

大板块页（比如「花娅陌域」）把**子版块**排成一块块的框：

- **有下级的** → 一个面板：标题 + 里面可独立滚动的条目清单。条目多了在框内滚，
  不会把整页撑长（右侧有一根能拖的滚动条，鼠标滚轮也能滚）。
- **没有下级的** → 一整张封面大卡，整块可点，直接进它自己的页面。

版式按子版块个数切换：**够 4 个**才排成设计稿那三列（左列上下两块、中间和右边各一块跨两行，
列宽比 2.44 : 1 : 1，三列底边齐平）；不到 4 个就走普通自适应网格 ——
甬城晴雨只有一个子版块，硬套三列会留出一大片空白。窄屏（< 46rem）三列塌成一列。

框的排版微调走编辑器「排版」模式（选「大板块页」→「哪个板块」挑到那一页，再拖框）。
子树本身（谁在谁下面、叫什么、地址是什么）在 `src/data/home-boards.json`，
用编辑器的「板块」按钮图形化编辑，不用手改 JSON。

---

## 四、改站点信息

打开 `src/site.config.ts`：

- `title` / `tagline` / `description` —— 站点名、签名、简介
- `nav` —— 顶部导航栏。不想要的栏目删掉那一行就行
- `aboutIntro` —— 关于页的自我介绍
- `contacts` / `socials` —— 联系方式和社交链接
- `friends` —— 友链
- `homePostCount` —— 首页显示几篇最近文章
- `showToc` —— 文章页要不要右侧目录

---

## 五、写内容

### 用编辑器（推荐）

双击 `花娅陌质流.cmd`，点 **写文章**，浏览器会打开 `http://localhost:4322`。
左边选栏目和文档，中间写，右边实时预览。

### 怎么往文章里插图片

三种方式，挑顺手的用：

| 怎么做 | 结果 |
| --- | --- |
| **直接拖**一张图到正文区 | 自动上传，在光标处插入图片 |
| 截图后按 **`Ctrl+V`** | 自动上传，以时间戳命名（不会一堆 `image.png` 撞名） |
| 点工具栏的 **🖼** | 打开文件选择器，选完自动上传并插入 |

三种都会把文件存到 `public/img/uploads/`，并在正文里写好 `![说明](/img/uploads/文件名.png)`。

工具栏上还有个 **「网址」** 按钮，用于插入已经在网上的图片，或者站内已有的图片路径
（比如 `/img/a.png`）。

> 单张图片不能超过 10MB，先压一下再传。支持 png / jpeg / gif / webp / svg。

### 手写文件

在 `src/content/posts/` 下新建 `随便什么名字.md`，文件名就是网址。
开头必须有 frontmatter：

```yaml
---
title: 标题            # 必填
date: 2026-09-14       # 必填，也可以写 "2026-09-14 20:30"
tags: [标签一, 标签二]   # 可选
summary: 列表页的摘要    # 可选，不写自动从正文截
cover: /img/uploads/a.png # 可选，封面图
draft: false           # 可选，true = 草稿，不发布
pinned: 0              # 可选，大于 0 会置顶
subs: [huaya-a-1]      # 可选，归到哪个子版块（填 home-boards.json 里的 id）
---
```

手记（`src/content/notes/`）的字段稍有不同，多了 `week`（周次）和 `mood`（心情），
没有 `summary` / `cover` / `pinned`；`subs` 一样有，所以手记顶部也有那条来路。

**`subs` 决定这篇文章归在哪个版块下**，填了之后它会出现在那个版块页的
「这里的文章」里；同时文章顶部会自动出现一条来路面包屑
（`花娅陌域 › 陌质流记忆库 › 测试性流质酶 › 这篇文章`），
点其中任意一级就能跳过去 —— 不用再靠浏览器后退键。
一篇文章可以同时填多个 id，那样顶部会有多条来路，一行一条。
填的 id 在 `home-boards.json` 里不存在时会被忽略（只会少一条面包屑，不会报错）。

版块页之间也一样：每层左上角的「返回」回的是**上一级**（并写出上一级的名字），
只有顶层大板块才回首页。

**字段写错了构建会直接报错**，不会悄悄写坏——这是故意的。

---

## 六、部署

仓库推送到 GitHub 后，`.github/workflows/deploy.yml` 会自动构建并发布到 GitHub Pages。
**第一次**需要在仓库里手动开一下：

> 仓库页面 → **Settings** → 左侧 **Pages** → Build and deployment → Source 选 **GitHub Actions**

之后每次 `git push` 到 `main` 分支都会自动重新部署。构建进度在仓库顶部的 **Actions** 标签里看。

站点地址：仓库名叫 `<你的用户名>.github.io` 时是 `https://<你的用户名>.github.io/`。
如果改用别的仓库名（比如 `blog`），需要把 `astro.config.mjs` 里的 `base` 改成 `'/blog'`。

### 关于 RSS 和 sitemap

- RSS：`/rss.xml`
- 站点地图：`/sitemap.xml`（可以提交给 [Google Search Console](https://search.google.com/search-console)）

---

## 七、常见问题

**构建报错说某个字段不对**
按提示改 frontmatter。最常见的是日期格式，或者 `tags` 忘了写方括号。

**图片不显示**
路径要从 `public/` 开始算。`public/img/a.png` 对应的写法是 `/img/a.png`。

**推送失败**
先看是哪种。`花娅陌质流.cmd` 选 **3 发布上线** 时，会先试连 GitHub，连不上会直接提示，不会等 push 到一半才报错。

- **连不上 GitHub**：国内网络直连经常不通，需要开代理。开好 Clash Verge 的「系统代理」后，
  再让 git 也走代理（只需设置一次）：
  ```bash
  git config --global http.proxy http://127.0.0.1:7890
  git config --global https.proxy http://127.0.0.1:7890
  ```
  端口要和 Clash Verge 里「设置 → 端口」一致。取消用 `--unset` 换成同样的键名。
- **提示没登录**：跑一次 `gh auth login` 重新授权。
- **提示 `without workflow scope`**：`gh` 授权时默认不给 `workflow` 权限，而推送
  `.github/workflows/` 下的文件需要它（GitHub 防止代码偷偷改你的 CI）。补权限：
  ```bash
  gh auth refresh -h github.com -s workflow
  ```
  在浏览器里确认后再推。这个设置一次就够了。
- **提示 rejected / non-fast-forward**：远端有本地没有的提交，先 `git pull --rebase` 再推。

> 小提示：`github.com` 打不开时，`api.github.com` 和 `raw.githubusercontent.com` 往往是通的。
> 「网页打不开」不等于完全连不上。

> 另一个提示：走代理访问时偶发 `EOF` 之类的瞬时中断很常见。遇到一次失败**先重试**，
> 不一定是真的坏了——本项目的部署脚本就内置了自动重试。

**想换整体风格，但不想大改 CSS**
主要改 `tokens.css` 里的颜色和字体就够了。想换版式再动 `global.css` 里的【组件样式】区块。

**想删掉「手记」这个栏目**
1. 删掉整个 `src/content/notes/` 目录
2. `src/pages/` 下删掉 `notes/` 目录
3. `src/site.config.ts` 的 `nav` 里删掉手记那一行
4. `src/content.config.ts` 里删掉 `notes` 集合的定义和导出

<details>
<summary>站点本身是怎么实现的（想改代码时看）</summary>

- **构建**：Astro 静态生成，输出纯 HTML/CSS，几乎没有 JS。
- **内容**：Astro Content Collections + `glob()` loader，schema 用 Zod 校验。
- **样式**：原生 CSS + CSS 自定义属性，没有引入任何 CSS 框架。
- **前端脚本**：只有两处——① 页头里一小段内联脚本，在页面绘制前把主题定下来（避免闪白）；
  ② 文章页目录的滚动高亮（IntersectionObserver）。除此之外没有客户端 JS。
- **代码高亮**：构建期用 shiki 生成，亮色/暗色两套配色同时输出，切换主题不需要 JS 参与。
- **站点图标 / og 图**：手写的 SVG。
- **编辑器**：零依赖的 Node HTTP 服务（`tools/editor/server.mjs`），只监听 `127.0.0.1`。

</details>
