# 黎语堂的云函数（腾讯云开发）

`index.js` 这一份是**跑在腾讯云开发里的那份代码的副本**，函数名 `twikoo`。
它干三件事：装 Twikoo（数据库换成外部 MongoDB）、黎语堂自己的账号与审核、用户的帖子与头像。
细节都在文件头部那几段注释里。

## 它是怎么被部署的（也就是"改了代码之后怎么办"）

这台云开发环境**没有**走 CLI / CI：代码是在控制台的在线编辑器里粘贴进去的。
所以流程永远是这三步：

1. **复制这一份。**
   ⚠ **别用 `Get-Content -Raw`** —— 在这台中文 Windows 上，Windows PowerShell 5.1 的
   `Get-Content` 默认按 **GBK** 去读 UTF-8 文件：中文会变成乱码（`绾ц氨` 那种），
   而且**更坏的是它会把紧跟在中文后面的那个 ASCII 字符吃掉**（比如字符串的收尾引号），
   于是粘进控制台就是**真的语法错误**、编辑器一片红。
   （2026-10-07 晚上就是这么坑了用户一次：那份代码 761 行，粘进去显示 684 行、74 个红点 ——
    少的 77 行就是被吞掉的那些换行。）

   用这条（显式按 UTF-8 读）：

   ```powershell
   Set-Clipboard -Value ([System.IO.File]::ReadAllText((Resolve-Path 'tools\liyutang-backend\index.js'), [System.Text.Encoding]::UTF8))
   ```

   **最省事的办法其实是不走命令行**：用 VS Code / 记事本直接打开
   `tools/liyutang-backend/index.js` → `Ctrl+A` → `Ctrl+C`（这两个程序都按 UTF-8 处理）。
   （整份是自包含的，不需要你再补别的。）

2. 打开 [腾讯云开发控制台](https://console.cloud.tencent.com/tcb) → 环境 `liyutang-…` →
   **云函数** → `twikoo` → **函数代码** → 把编辑器里的内容**全选删掉**，粘贴新的一份 → **保存**。
   （一定要先全选删掉再粘：两份代码并存 = 文件里出现两个 `exports.main`，必报错。）

   **粘完先自己确认三件事**，再去部署：
   - `Ctrl+F` 搜 **`LT_POST_CREATE`** —— 搜得到才是新代码（老代码里没有这个事件）；
   - 随便看一行中文注释，**是正常中文**（不是 `绾ц氨` 那种乱码）；
   - 编辑器底部的行数拉到最底应该是 **761 行**（老那份是 420 行）。**行数少了就是又被编码坑了。**

3. 保存（`Ctrl+S`）之后，点右上角那颗蓝色的 **部署** —— `Ctrl+S` 只是存进工作区，
   **点「部署」才真正生效**。等它从"部署中"变回绿色的 **正常**（十几秒），然后跑一次自检：

   ```
   编辑器 → 右上角「黎语堂管理」→ 评论系统 → 「自检连通」
   ```

   它会先问 `GET_FUNC_VERSION`（函数活没活），再问 `GET_CONFIG`（数据库通没通）。
   两条都绿就说明这一份代码已经在线上跑着了。

   部署前**先把控制台里那份旧代码 `Ctrl+A` `Ctrl+C` 存到记事本里**当底 —— 万一新版有问题，
   粘回去再部署一次就能退回原样（这个函数没有"版本回滚"按钮的直觉入口，留个底最省事）。

## 这份代码依赖什么（控制台那边本来就装好了，别删）

| 依赖 | 干什么 | 为什么是这个版本 |
| --- | --- | --- |
| `twikoo-func` | Twikoo 的云函数外壳（`toTkRequest` / `fromTkResponse`） | 和前端 `public/vendor/twikoo/`（2.0.12）配套 |
| `@twikoojs/common` | Twikoo 的本体：评论、配置、管理面板 | 同上（`twikoo-func` 会带上它） |
| `mongodb` | 外部数据库驱动 | **7.x 要求 Node ≥ 20.19**，所以运行环境必须是 Node 20.19（24.11 装不上依赖、18.15 版本不够） |

环境变量（云函数 → 配置 → 环境变量）：`MONGODB_URI`（必填）、`MONGODB_DB_NAME`（可选，默认 `twikoo`）、
`LT_SECRET`（可选；不填就用连接串派生一个签名密钥 —— 换了连接串会让所有人重新登录）。

## 聊天室的「每日存档」需要两样东西（2026-10-09 起）

聊天室当天的话、画板当天的笔划都住在云端（`lt_chat` / `lt_draw`）；**过完那一天**由
`.github/workflows/daily-archive.yml`（每天**北京时间 04:00**）把那天搬进仓库 ——
这一段完全不经过浏览器，靠的是云函数里这几个**站长事件**：

| 事件 | 干什么 | 谁在调 |
| --- | --- | --- |
| `LT_ADMIN_CHAT_DAY` | 取出某一天的全部消息（**含图片 base64**） | `tools/liyutang-archive.mjs` |
| `LT_ADMIN_CHAT_PRUNE` | 存好之后把云端那些 base64 抹掉，只留静态路径 `/img/chat/<日>/<id>.webp`（带 `expect` 对账闸门） | 同上（`--prune-only`） |
| `LT_ADMIN_CHAT_CLEAR_IMAGE` | 把"图已经没了"的那几条的 `image` 置空，别再显示碎图（2026-10-09 事故的收尾用） | 同上（`--prune-only`） |
| `LT_ADMIN_DRAW_DAY` | 取出某一天画板上的全部笔划，**分页**：带 `after` / `afterId` / `limit`，按 `(createdAt, id)` 游标 + 2MB 字节预算分批，返回 `{count, total, strokes, next}` | 同上 |
| `LT_ADMIN_DRAW_CLEAR` | 搬进仓库之后把云端那天的笔划**删掉**（带 `expect` 对账闸门：条数对不上就拒清） | 同上（`--prune-only`） |

⚠ `LT_ADMIN_DRAW_DAY` 为什么必须分页：2026-10-09 那天笔划多到响应体超过**腾讯云 6MB 上限**，
云函数抛 `FUNCTIONS_INVOCATION_FAILED`，存档整个失败；而它排在聊天室之后，于是那一次运行
**连提交都没走到**（聊天室的 5 张图 base64 已经被抹了 ⇒ 那 5 张图从此丢失）。
现在工作流的顺序是**搬 → 提交推送 → 再清云端**，清理那一步只在"搬没报错 + 有东西提交"时才跑。

它们都走**站长密码**那道闸门（`adminCheck`），页面上没有任何入口能调到。要跑通它，得先在 GitHub 仓库里配好：

1. **Settings → Secrets and variables → Actions → New repository secret**：
   名字 `LT_ADMIN_PASSWORD`，值就是你在评论区小齿轮里设的**站长密码原文**。
2. 那个工作流自己是 `permissions: contents: write`（全仓唯一一处写权限，只给它）——
   它提交时走的是站里统一的 `tools/git/sync.mjs publish`（先拉后推、永不强推），
   推上去之后由既有的部署工作流发布，而**发布门卫只放行存档那几个路径**
   （`src/data/chat|draw/<日期>.json`、两边的 `index.json`、`public/img/chat/**`、`public/img/draw/<日期>.svg`，
   见 `tools/publish/gate.mjs`）。

补档（比如某天忘了存、或者想手动试一次）：Actions → 「每日存档（聊天室 + 画板）」→ **Run workflow**，
`day` 填 `2026-10-09` 这种日期；本地也可以直接跑（**两段式**，顺序别合回去）：

```powershell
$env:LT_ADMIN_PASSWORD = '你的站长密码'
node tools/liyutang-archive.mjs --day 2026-10-09              # ① 只搬，云端一个字节都不动
# …这里应该 git 提交推送，确认存档真的进了仓库…
node tools/liyutang-archive.mjs --day 2026-10-09 --prune-only  # ② 提交成功了再清云端
```

⚠ 清理是**不可逆**的（云端那份删了就没了，MongoDB 免费档没有备份），所以它自带两道保险：
仓库里必须有那天的存档文件、条数还要跟云端剩的对得上；任何一条不满足就什么都不清。
本地图省事也可以一趟跑完（`--prune`），但**工作流不许用**那个写法 —— 10-09 丢图就是那么来的。

## 本地怎么验这份代码（不用连云）

`tools/checks/liyutang-users-check.mjs` 和 `tools/checks/liyutang-posts-check.mjs`
会把**整份 `index.js`** 装进一个内存里的真 MongoDB 跑一遍（注册 / 审核 / 发帖 / 头像 / 评论门槛…）；
`tools/checks/liyutang-chat-check.mjs` 同样跑聊天室那三个事件。
它们需要 `mongodb-memory-server`，装在仓库外面（`%TEMP%\huajiantang-twikoofn`），没装就跳过那一段
——**不会**在你机器上下载 780MB 的 mongod。

存档那条流水线不用连云也能验：`node tools/checks/liyutang-archive-check.mjs`
（喂假消息给存档函数，看它写出什么；再起一个假云函数，把命令行整条跑一遍）。

## 自动部署（2026-10-09 起，不用再复制粘贴了）

以前改这个函数是：复制这一份 → 控制台全选删掉 → 粘上去 → 保存 → 部署。
现在：**推送这几个文件，GitHub Actions 自动把代码更新上去**。

| 件 | 干什么 |
| --- | --- |
| `.github/workflows/deploy-function.yml` | 当 `tools/liyutang-backend/{index.js,package.json,deploy.mjs}` 有改动被推送时触发（也能在 Actions 里手动点一下） |
| `tools/liyutang-backend/deploy.mjs` | 打包成 zip → TC3 签名 → 调云开发 `UpdateFunctionCode` → **部署完自己用公开网关验一遍**新事件认不认 |
| 仓库 Secrets | `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY`（CAM 子用户的密钥） |

为什么要一个子用户密钥：云 API 得有个身份。**请给它最小权限** —— 一条自定义策略，
只允许 `tcb:UpdateFunctionCode`（这个接口只更新代码，不碰环境变量、触发器、函数配置）。
密钥只进仓库 Secrets，不进代码、不进日志。

脚本里有个容易忽略但很要紧的参数：**`InstallDependency: "TRUE"`**（在线依赖安装）。
我们只传 `index.js` + `package.json`、不传 `node_modules`，靠它让云上按 package.json 把
`twikoo-func` / `mongodb` 装回来 —— 不然覆盖代码会把依赖一起冲掉，函数直接起不来。

本地想手动部署：`node tools/liyutang-backend/deploy.mjs`（密钥可以放环境变量，
或放 `%USERPROFILE%\.huajiantang\tcb-key.json` 然后加 `--local`）；`--dry` 只打包不部署。
验收：`node tools/checks/liyutang-deploy-check.mjs`（打包往返 + 签名 + **拿假密钥真调一次线上 API**，
确认整条请求链是通的）。

### 2026-10-09 晚上这一批

| 事件 | 干什么 | 备注 |
| --- | --- | --- |
| `LT_PROFILE_SET` | 改**昵称**（`alias`，2~20 字） | 用户名 `nick` 改不了（那是登录用的）；昵称随时能改 |
| `LT_PREFS_SET` | 存画板的个人偏好：调色盘收藏 + **画笔/橡皮各自粗细** + 上次的颜色/工具 | 只收认识的字段（最多 24 个颜色，粗细夹到 1~64） |
| `LT_USER_GET` | 看某个人的公开资料（用户页用） | `{id}` 或 `{uk}`；**看别人不发邮箱**；自己看自己会带 `me: true` |
| `LT_DRAW_MOVE` | 整体平移一根线条（只给自己画的） | 逐点夹回画板；返回的 `stroke.updatedAt` 是新的同步游标 |

两处**约定改动**（都跟"掉登录"这个线上事故有关）：

1. **错误码**：`code: 401` = 令牌无效/过期（页面**只有看到 401 才准删令牌**）；
   其它非 0（例如 1000）一律当"这一次没成"，页面保留登录状态并自动重试。
   以前所有错误都是 1000，和"云函数冷启动连不上数据库"撞码 —— 结果网络抖一下就被
   当成登录过期、把令牌删了（群友反馈的"刷新/换页面掉登录"就是这个）。
2. **昵称贯通**：`publicMsg` / `publicPost` / `publicStroke` 都会带 `alias`（没有就是用户名）；
   而且聊天/帖子/笔划的列表在**读的时候**按 `userId` 批量换成**当前**昵称 ——
   所以他改了名，以前说过的话、发过的贴、画过的笔划也都显示新昵称。
   `LT_DRAW_LIST` 的增量游标从 `createdAt` 改成 **`updatedAt`**，
   这样被拖动过的线条别的客户端也能收到。
