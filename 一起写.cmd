@echo off
rem ============================================================
rem  Shared editor launcher - for collaborators (2026-10-12)
rem
rem  Double-click this file and the local editor opens in the
rem  browser: http://127.0.0.1:4322  (it is ???'s own editor,
rem  the very same one the site owner uses.)
rem
rem  This file is intentionally 100%% ASCII. cmd.exe re-reads
rem  batch files by BYTE OFFSET, so a file full of multi-byte
rem  characters can make it resume parsing in the middle of a
rem  line. Every line of Chinese UI lives in Node instead
rem  (tools/editor/server.mjs prints its own banner).
rem ============================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode
where git >nul 2>nul
if errorlevel 1 goto nogit

rem ---- Node is here: start the editor and open the browser.
rem      This window IS the editor's console: press Ctrl+C to stop.
node "tools\editor\server.mjs" --open
exit /b %errorlevel%

:nogit
echo.
echo   [x] Git was not found on PATH.
echo.
echo       Install it from https://git-scm.com/downloads and run this file again.
echo.
pause
exit /b 1

:nonode
echo.
echo   [x] Node.js was not found on PATH.
echo.
echo       Install the LTS version from https://nodejs.org/ and run this file again.
echo.
pause
exit /b 1
