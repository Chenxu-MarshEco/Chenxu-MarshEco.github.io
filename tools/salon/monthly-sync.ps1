# ============================================================================
# 群精华每月自动同步（2026-11-12 加）
# ----------------------------------------------------------------------------
# 服务器上每月 1 号跑一次，把**上个月**设为精华的消息搬进站里并推上 GitHub。
# 由 Windows 计划任务调用，也可以手动跑：
#
#   powershell -ExecutionPolicy Bypass -File tools\salon\monthly-sync.ps1
#   powershell -ExecutionPolicy Bypass -File tools\salon\monthly-sync.ps1 -Month 2026-10
#   powershell -ExecutionPolicy Bypass -File tools\salon\monthly-sync.ps1 -Dry
#
# 流程：拉远端 → 跑 sync-essence.mjs → 没有新东西就退出 → 提交 → 再拉一次 → 推送
# 规矩照仓库的（tools/git/sync.mjs 那套）：**永不强推**，先拉后推，撞车就停下。
#
# ⚠ 两件必须在服务器上先配好的事：
#   ① NapCat 开着 HTTP 接口（127.0.0.1:3003），token 写进 Windows 环境变量
#      `SALON_API_TOKEN`（系统级，别写进仓库）；
#   ② git 能免交互推送 —— 先手动 push 一次让凭据管理器记住，
#      或者 `git config --local credential.helper store` 配好后首次输一次。
# ============================================================================
param(
  [string]$Month = '',      # 留空 = 上个月（脚本自己算，按北京时间）
  [switch]$Dry              # 只算不写、不提交
)

# ⚠ 别改成 'Stop'（2026-11-12 踩过）：
#   PowerShell 5.1 里，`原生程序 2>&1 | ...` 遇到 $ErrorActionPreference='Stop' 时，
#   stderr 的每一行都会被当成**终止错误**，脚本当场退出。
#   而 node 的 console.warn（比如「某张图 404」）正好走 stderr —— 于是第一条警告就把
#   整个同步打断了，报告都没打出来。所以这里用 Continue，靠 $LASTEXITCODE 判成败。
$ErrorActionPreference = 'Continue'

# 中文输出：子进程 powershell.exe 默认不是 UTF-8，不设这个会全变「鈿?」乱码
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent (Split-Path -Parent $here)
Set-Location $repo

function Log($msg) { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $msg" }

# 跑一个原生命令并把输出按 UTF-8 读回来（避开 2>&1 的 ErrorRecord 坑）
# ⚠ 参数名别用 $Args —— 那是 PowerShell 的自动变量
function Invoke-Native {
  param([string]$Exe, [string[]]$ArgList)
  $tmp = Join-Path $env:TEMP ("salon-" + [guid]::NewGuid().ToString('N') + ".log")
  try {
    & $Exe @ArgList *> $tmp
    $code = $LASTEXITCODE
    if (Test-Path $tmp) {
      Get-Content $tmp -Encoding UTF8 | ForEach-Object { Write-Host ("    " + $_) }
    }
    return $code
  } finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }
}

# ---------------------------------------------------------------------------
# 0. 前置检查
# ---------------------------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Log '❌ 找不到 node'; exit 1 }

if (-not $env:SALON_API_TOKEN) {
  Log '⚠ 没有 SALON_API_TOKEN 环境变量 —— NapCat 若设了 token，这一步会 401'
}

Log "仓库：$repo"
Log "月份：$(if ($Month) { $Month } else { '（上个月，脚本自己算）' })"

# ---------------------------------------------------------------------------
# 1. 先拉一次，别在旧数据上加
# ---------------------------------------------------------------------------
Log '拉取远端…'
$code = Invoke-Native git @('-c', 'http.sslBackend=openssl', 'pull', '--rebase', '--autostash')
if ($code -ne 0) { Log '❌ 拉取失败（可能有没提交的东西，或者网络/凭据问题）'; exit 1 }

# ---------------------------------------------------------------------------
# 2. 同步
# ---------------------------------------------------------------------------
$syncArgs = @('tools/salon/sync-essence.mjs')
if ($Month) { $syncArgs += @('--month', $Month) }
if ($Dry) { $syncArgs += '--dry' }

Log '开始同步…'
$code = Invoke-Native node $syncArgs
if ($code -ne 0) { Log '❌ 同步失败'; exit 1 }

if ($Dry) { Log '（-Dry：到此为止，什么都没提交）'; exit 0 }

# ---------------------------------------------------------------------------
# 3. 有没有东西要提交
# ---------------------------------------------------------------------------
$changed = & git status --porcelain -- src/data/salon.json public/img/salon
if (-not $changed) { Log '没有新精华，不提交。'; exit 0 }

Log '这次要提交的文件：'
$changed | ForEach-Object { "    $_" }

# ---------------------------------------------------------------------------
# 4. 只加精华相关的路径（**不要 git add -A**，站长可能同时在别处改东西）
# ---------------------------------------------------------------------------
& git add -- src/data/salon.json
if (Test-Path 'src/data/salon.json.bak') { & git add -- src/data/salon.json.bak }
& git add -- public/img/salon
if ($LASTEXITCODE -ne 0) { Log '❌ git add 失败'; exit 1 }

# ---------------------------------------------------------------------------
# 5. 提交
# ---------------------------------------------------------------------------
$bjNow = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'China Standard Time')
$label = if ($Month) { $Month } else { $bjNow.AddMonths(-1).ToString('yyyy-MM') }
$commitMsg = @"
群精华自动同步：$label

由服务器每月 1 号自动跑（tools/salon/monthly-sync.ps1）。
北京时间 $($bjNow.ToString('yyyy-MM-dd HH:mm')) 执行。

改过这些页面：
- /salon 冰室精华
"@

$msgFile = Join-Path $env:TEMP 'salon-commit-msg.txt'
$commitMsg | Out-File -FilePath $msgFile -Encoding UTF8
$code = Invoke-Native git @('commit', '-F', $msgFile)
if ($code -ne 0) { Log '❌ 提交失败'; exit 1 }

# ---------------------------------------------------------------------------
# 6. 先拉后推（永不强推）
# ---------------------------------------------------------------------------
Log '再拉一次，避免撞车…'
$code = Invoke-Native git @('-c', 'http.sslBackend=openssl', 'pull', '--rebase', '--autostash')
if ($code -ne 0) { Log '❌ 拉取时冲突（已停下，什么都没推）。去仓库里看 git status。'; exit 1 }

Log '推送…'
$code = Invoke-Native git @('-c', 'http.sslBackend=openssl', 'push', 'origin', 'main')
if ($code -ne 0) { Log '❌ 推送失败（凭据或网络）。这次提交还在本地，修好后手动 push。'; exit 1 }

Log '✅ 完成。站点会在几十秒后自动构建。'
Log '   线上页面：https://chenxu-marsheco.github.io/salon/'
