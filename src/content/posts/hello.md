---
title: 从这一篇开始
date: 2026-09-14
summary: 这是一篇示例文章。它同时也是这个站点的使用说明，读完可以删掉。
tags: [说明, 开始]
draft: false
pinned: 1
---

欢迎来到你自己的站点。**这篇是示例内容，你随时可以删掉它**——在编辑器里点左上角列表中的删除按钮，或者直接删掉 `src/content/posts/` 下的这个文件。

## 文章存在哪里

每一篇文章就是 `src/content/posts/` 目录下的一个 Markdown 文件。文件名决定网址：

| 文件 | 网址 |
| --- | --- |
| `posts/hello.md` | `/posts/hello/` |
| `posts/2026/my-day.md` | `/posts/2026/my-day/` |

手记放在 `src/content/notes/`，规则一样，网址是 `/notes/xxx/`。

## 开头的这一段是什么

两个 `---` 之间的部分叫 frontmatter，用来填元信息：

```yaml
---
title: 文章标题        # 必填
date: 2026-09-14       # 必填
tags: [随便, 写写]      # 可选
summary: 列表页显示的摘要  # 可选，不写就自动截取正文开头
cover: /img/uploads/a.png # 可选，封面图
draft: false           # 可选，true 表示草稿，不会发布
pinned: 0              # 可选，大于 0 会置顶
---
```

> 用编辑器的话不需要记这些，表单里都有对应输入框。
> 手写的话，字段名写错了构建会直接报错提醒你，不会悄悄出错。

## 正文能写什么

普通 Markdown 都支持：**加粗**、*斜体*、`行内代码`、[链接](https://astro.build)、列表、表格、引用、代码块、图片。还有删除线 ~~像这样~~。

行内公式和脚注之类的扩展没有默认开启，需要的话改 `astro.config.mjs`。

## 接下来做什么

1. 打开 `src/site.config.ts`，把站点名、签名、自我介绍换成你自己的
2. 打开 `src/styles/tokens.css`，改颜色和字体——整个站点的美术都在这个文件里
3. 把 `public/og-default.svg` 换掉（分享到社交平台时的预览图）
4. 删掉这篇示例文章，开始写真正的东西
