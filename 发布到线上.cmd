@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [x] 没有找到 git，请先双击「首次设置.cmd」。
  echo.
  pause
  exit /b 1
)

echo.
echo   把改动发布到线上
echo   =====================================

REM 先确认能连上 GitHub。你的网络访问 github.com 需要代理，
REM Clash Verge 没开的时候这一步会失败，早点发现比等到 push 失败好。
git remote get-url origin >nul 2>nul
if not errorlevel 1 (
  echo   正在检查能否连上 GitHub...
  git ls-remote --heads origin >nul 2>nul
  if errorlevel 1 (
    echo.
    echo   [x] 连不上 GitHub。
    echo.
    echo       最常见的原因是代理没开。请：
    echo         1. 打开 Clash Verge
    echo         2. 确认「订阅」里已经导入了节点
    echo         3. 打开「系统代理」开关
    echo       然后重新双击本文件。
    echo.
    pause
    exit /b 1
  )
  echo   [ok] 连接正常
)

echo.
git add -A

echo.
echo   下面列出这次要提交的文件：
echo.
git status --short
echo.

set "msg="
set /p "msg=  这次改了什么？（直接回车用「更新内容」）: "
if "%msg%"=="" set "msg=更新内容"

echo.
git commit -m "%msg%"
if errorlevel 1 (
  echo.
  echo   没有需要提交的改动，不用发布。
  echo.
  pause
  exit /b 0
)

echo.
echo   正在推送到 GitHub...
git push
if errorlevel 1 (
  echo.
  echo   [x] 推送失败。常见原因：
  echo       - 代理掉了，重开 Clash Verge 再试
  echo       - 还没登录 GitHub
  echo       - 远程仓库地址没配置好
  echo.
  pause
  exit /b 1
)

echo.
echo   =====================================
echo   [ok] 已经推送成功！
echo   等一到两分钟，打开你的网址就能看到更新了。
echo   想确认构建结果：仓库页面顶部的 Actions 标签。
echo   =====================================
echo.
pause
