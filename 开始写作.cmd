@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  echo.
  echo   还没有安装依赖，请先双击「首次设置.cmd」。
  echo.
  pause
  exit /b 1
)

echo.
echo   正在启动写作编辑器，浏览器会自动打开...
echo   用完之后，直接关掉这个黑窗口就行。
echo.

call pnpm editor --open

echo.
echo   编辑器已经停止运行。
pause
