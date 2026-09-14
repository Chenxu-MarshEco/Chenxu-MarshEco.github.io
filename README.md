# 个人站点

一个静态个人网站：文章 + 手记 + 标签 + 归档 + 关于 + 友链。
用 [Astro](https://astro.build) 构建，托管在 GitHub Pages 上，**完全免费，没有服务器，没有数据库**。

所有内容都是仓库里的 Markdown 文件——你写的每一个字都在自己手里。

---

## 一、日常怎么用

装好之后，你平时只需要双击根目录下的这几个文件：

| 双击这个 | 会发生什么 |
| --- | --- |
| `首次设置.cmd` | **只跑一次**。检查环境、安装依赖 |
| `开始写作.cmd` | 打开可视化编辑器，在浏览器里写文章、传图片 |
| `本地预览.cmd` | 在浏览器里看站点真实效果（`http://localhost:4321`） |
| `发布到线上.cmd` | 把改动提交并推送到 GitHub，一两分钟后线上更新 |

> 第一次用之前，需要先装 **Node.js LTS**（<https://nodejs.org/>）和 **Git**（<https://git-scm.com/>），
> 都是一路点「下一步」。装完再双击「首次设置.cmd」。

如果你更喜欢命令行，对应的命令是：

```bash
pnpm install      # 安装依赖
pnpm editor       # 打开编辑器
pnpm dev          # 本地预览
pnpm build        # 手动构建到 dist/
pnpm preview      # 预览构建结果
```

---

## 二、目录结构

```
.
├── 首次设置.cmd / 开始写作.cmd / 本地预览.cmd / 发布到线上.cmd
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
├── tools/editor/             ← 配套的本地编辑器
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

双击 `开始写作.cmd`，浏览器会打开 `http://localhost:4322`。
左边选栏目和文档，中间写，右边实时预览。图片直接拖进去会自动上传。

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
---
```

手记（`src/content/notes/`）的字段稍有不同，多了 `week`（周次）和 `mood`（心情），
没有 `summary` / `cover` / `pinned`。

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
先看是哪种。`发布到线上.cmd` 在推送前会先试连 GitHub，连不上会直接提示，不会等 push 到一半才报错。

- **连不上 GitHub**：国内网络直连经常不通，需要开代理。开好 Clash Verge 的「系统代理」后，
  再让 git 也走代理（只需设置一次）：
  ```bash
  git config --global http.proxy http://127.0.0.1:7890
  git config --global https.proxy http://127.0.0.1:7890
  ```
  端口要和 Clash Verge 里「设置 → 端口」一致。取消用 `--unset` 换成同样的键名。
- **提示没登录**：跑一次 `gh auth login` 重新授权。
- **提示 rejected / non-fast-forward**：远端有本地没有的提交，先 `git pull --rebase` 再推。

> 小提示：`github.com` 打不开时，`api.github.com` 和 `raw.githubusercontent.com` 往往是通的。
> 「网页打不开」不等于完全连不上。

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
