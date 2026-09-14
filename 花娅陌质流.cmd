@echo off
rem ============================================================
rem  Personal site studio - launcher
rem
rem  This file is intentionally 100%% ASCII.
rem  cmd.exe re-reads batch files by BYTE OFFSET, so a long file
rem  full of multi-byte characters can make it resume parsing in
rem  the middle of a line. Keeping this file ASCII-only avoids
rem  that class of bug entirely; all Chinese UI lives in Node.
rem ============================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

node "tools\menu.mjs"
exit /b %errorlevel%

:nonode
echo.
echo   [x] Node.js was not found on this computer.
echo.
echo       Install the LTS version from https://nodejs.org/
echo       then double-click this file again.
echo.
pause
exit /b 1
