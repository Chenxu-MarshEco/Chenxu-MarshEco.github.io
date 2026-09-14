# 本地内容编辑器

一个跑在自己电脑上的可视化内容编辑器，用来写 `src/content/posts`（文章）和
`src/content/notes`（手记）。不用登录、不用联网、不用装任何依赖，本质就是
一个很小的本地网页。

## 启动

```bash
pnpm editor          # 等于 node tools/editor/server.mjs
pnpm post            # 等于 node tools/editor/server.mjs --open=new-post，顺手新建一篇
```

或者直接：

```bash
node tools/editor/server.mjs          # 启动，手动打开终端里打印的网址
node tools/editor/server.mjs --open   # 启动后自动打开系统默认浏览器
```

启动后终端会打印完整地址，形如 `http://127.0.0.1:4322/`。

服务只监听 `127.0.0.1`，外网访问不到。端口从 4322 开始，被占用就依次试
4323、4324……直到 4340；实在都被占了会直接报错退出。

## 界面

三栏布局：

- **左栏**：文章 / 手记两个标签页；搜索框（按标题和标签实时过滤）；文档列表
  （标题、日期、草稿标记、标签）。鼠标悬在列表项上会出现删除按钮，删除会二次确认。
  底部是「＋ 新建」。
- **中栏**：frontmatter 表单 + Markdown 正文。标题、日期（可选到分钟）、标签
  （回车或逗号变成 chip）、摘要、封面（可上传本地图片）、草稿开关、置顶（文章）；
  周次、心情（手记）。正文上面是一排 Markdown 工具按钮。
- **右栏**：Markdown 实时预览，输入停止 200ms 后刷新。

其他细节：

- `Ctrl+S` / `Cmd+S` 保存，右上角也有保存按钮，成功后会弹一个小提示。
- 有未保存的修改时，浏览器标题前面会出现 `●`，关页面会提示。
- 表单一变就把草稿写进 `localStorage`；重新打开同一篇时会问要不要恢复。
- 主题跟随系统，也可以在右上角手动切成 浅色 / 深色 / 自动（记在 localStorage）。
- 完全离线：不加载任何外部字体、图片或 CDN。

## 依赖说明

服务端是零依赖的，只用 Node 内置模块（`node:http` / `node:fs/promises` /
`node:path` / `node:url` / `node:crypto` / `node:child_process`），Node 20 以上都能跑。

Markdown 预览用的是项目里的 `marked`（如果装了的话）。装了就用，没装也不会报错——
预览区会显示「未安装 marked，预览不可用」，编辑和保存一切照常。想要预览就：

```bash
pnpm add -D marked
```

## 文件与接口

- 文章目录：`src/content/posts/*.md`，对应集合 `posts`
- 手记目录：`src/content/notes/*.md`，对应集合 `notes`
- 上传的图片：`public/img/uploads/`，页面里引用 `/img/uploads/xxx.png`

接口都返回 JSON：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/bootstrap` | 站点信息 + 内容类型列表 |
| GET | `/api/list?type=posts` | 该类型的文件列表，按日期倒序 |
| GET | `/api/item?type=posts&file=x.md` | 单个文件的 frontmatter 与正文 |
| POST | `/api/save` | `{ type, file, frontmatter, body }`，`file` 为空则按标题生成文件名 |
| POST | `/api/delete` | `{ type, file }` |
| POST | `/api/upload` | `{ name, dataUrl }`，返回 `/img/uploads/...` |
| GET | `/vendor/marked.js` | 转发 `node_modules/marked/lib/marked.esm.js`，没装则 404 |

## 安全边界

虽然只是本地工具，该拦的还是拦：

- `type` 只接受 `posts` / `notes`；`file` 只接受纯文件名（`basename`），出现
  `..`、路径分隔符、绝对路径、控制字符一律 400；解析出的绝对路径必须落在对应内容目录内。
- 保存新文件时如果按标题生成的文件名已存在，返回 **409**，不会静默覆盖已有文章，
  同时给出一个可用的替代文件名（`xxx-2.md`）由前端确认。已有文章（`file` 指向的
  就是它自己）照常可以覆盖保存。
- 上传只接受 `image/png`、`image/jpeg`、`image/gif`、`image/webp`、`image/svg+xml`，
  单张上限 10MB；请求体上限 12MB，超了返回 413。
- 静态资源是白名单映射，不做目录遍历。

## 目录结构

```
tools/editor/
├── server.mjs      # HTTP 服务端：API + 静态资源 + 端口探测（零依赖）
├── ui/
│   ├── index.html  # 三栏界面结构
│   ├── app.js      # 前端逻辑（无构建步骤，浏览器直接跑 ES 模块）
│   └── style.css   # 样式，颜色集中在 CSS 变量里
└── README.md
```

改完 `ui/` 里的东西，刷新浏览器即可生效（服务端对这些文件禁用了缓存）。
改 `server.mjs` 需要 `Ctrl+C` 后重新启动。
