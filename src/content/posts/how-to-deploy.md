---
title: 怎么把站点发到线上
date: 2026-09-05
summary: 从本地改完到别人能打开你的网址，中间发生了什么。
tags: [说明, 部署]
draft: false
pinned: 0
subs: [huaya-a-1]
---

这篇讲清楚整个流程，出问题的时候也好知道该看哪儿。

## 三个地方

| 位置 | 是什么 |
| --- | --- |
| 你电脑上的文件夹 | 你写东西的地方，改动都在这里 |
| GitHub 仓库 | 代码的云端备份，也是版本历史 |
| GitHub Pages | 把仓库里的代码编译成网页，挂在公网网址上 |

## 平时怎么写

平时所有操作都在**一个菜单**里。双击根目录的 `花娅陌质流.cmd`，按数字键选：

1. 按 **1**　在浏览器里写文章、传图片
2. 按 **2**　在浏览器里看效果，打开 `http://localhost:4321`
3. 按 **3**　提交并推送到 GitHub

推送之后，GitHub 会自己开始构建，大概一两分钟。构建完网址就更新了。

## 构建在哪里跑

`.github/workflows/deploy.yml` 这个文件告诉 GitHub：

- 在什么情况下触发（推送到 main 分支时）
- 用什么环境（Node 24）
- 执行什么命令（`pnpm install` 然后 `pnpm build`）
- 把哪个目录发布出去（`dist/`）

这个文件一般不用动。

## 出问题看哪里

打开仓库页面 → 顶部的 **Actions** 标签 → 点进最近一次运行。红色叉号就是失败了，展开步骤能看到完整报错。

最常见的两种失败：

- **frontmatter 字段写错**：比如日期写成了 `2026/09/05`，构建会报 schema 校验失败，按提示改就行
- **图片路径写错**：引用了 `public/` 里不存在的文件

本地先跑一次 `pnpm build` 能提前发现这些问题——本地构建通过，线上基本就不会失败。

## 如果连不上 GitHub

`花娅陌质流.cmd` 选 **3 发布上线** 时，会先试着连一下 GitHub，连不上会直接告诉你，不会等 push 到一半才报一堆看不懂的错。

国内网络直连 `github.com` 经常不通，需要开代理：

1. 打开 Clash Verge，确认「订阅」里已经导入节点
2. 打开「系统代理」开关
3. 让 git 也走代理（**只需要设置一次**，以后一直有效）：

   ```bash
   git config --global http.proxy http://127.0.0.1:7890
   git config --global https.proxy http://127.0.0.1:7890
   ```

   端口号要和 Clash Verge 里「设置 → 端口」显示的一致，常见的是 `7890` 或 `7897`。

4. 哪天不想要了，取消掉：

   ```bash
   git config --global --unset http.proxy
   git config --global --unset https.proxy
   ```

有个小细节值得知道：`github.com` 打不开的时候，`api.github.com` 和
`raw.githubusercontent.com` 往往是通的。所以「网页打不开」不等于完全连不上，
排查的时候别急着下结论。
