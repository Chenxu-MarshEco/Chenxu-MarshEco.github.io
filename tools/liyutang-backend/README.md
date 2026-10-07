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

## 本地怎么验这份代码（不用连云）

`tools/checks/liyutang-users-check.mjs` 和 `tools/checks/liyutang-posts-check.mjs`
会把**整份 `index.js`** 装进一个内存里的真 MongoDB 跑一遍（注册 / 审核 / 发帖 / 头像 / 评论门槛…）。
它们需要 `mongodb-memory-server`，装在仓库外面（`%TEMP%\huajiantang-twikoofn`），没装就跳过那一段
——**不会**在你机器上下载 780MB 的 mongod。
