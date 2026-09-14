@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo   首次设置：检查环境 + 安装依赖
echo   =====================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [x] 没有找到 Node.js
  echo.
  echo       请先到 https://nodejs.org/ 下载 LTS 版本安装，
  echo       一路点下一步即可，装完重新双击本文件。
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo   [ok] Node.js %%v

where pnpm >nul 2>nul
if errorlevel 1 (
  echo   [..] 没有找到 pnpm，正在安装...
  call npm install -g pnpm
  if errorlevel 1 (
    echo   [x] pnpm 安装失败，检查一下网络再重试。
    echo.
    pause
    exit /b 1
  )
)
for /f "delims=" %%v in ('pnpm -v') do echo   [ok] pnpm %%v

echo.
echo   正在安装项目依赖，第一次会慢一些，请耐心等...
echo.
call pnpm install
if errorlevel 1 (
  echo.
  echo   [x] 依赖安装失败，把上面的报错发给我看看。
  echo.
  pause
  exit /b 1
)

echo.
echo   =====================================
echo   全部就绪！
echo.
echo   以后日常只需要双击：
echo     开始写作.cmd     - 打开写作编辑器
echo     本地预览.cmd     - 在浏览器里看效果
echo     发布到线上.cmd   - 推到 GitHub 上线
echo   =====================================
echo.
pause
