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
echo   正在启动本地预览...
echo   地址是 http://localhost:4321
echo   浏览器大约 4 秒后自动打开，别急着关这个窗口。
echo   想停止预览，关掉这个黑窗口，或者按 Ctrl+C。
echo.

start "" cmd /c "timeout /t 4 /nobreak >nul & start "" http://localhost:4321"

call pnpm dev

echo.
echo   预览已经停止。
pause
