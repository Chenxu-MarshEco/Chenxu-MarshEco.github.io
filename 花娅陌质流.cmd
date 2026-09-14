@echo off
rem ============================================================
rem  Personal site studio - launcher
rem
rem  This file is intentionally 100%% ASCII.
rem  cmd.exe re-reads batch files by BYTE OFFSET, so a long file
rem  full of multi-byte characters can make it resume parsing in
rem  the middle of a line. Keeping this ASCII-only avoids that
rem  whole class of bug; all Chinese UI lives in Python or Node.
rem
rem  Prefers the Python window. Falls back to the Node console
rem  menu when Python is not installed.
rem ============================================================
setlocal
cd /d "%~dp0"

rem ---- look for a real Python (the Microsoft Store stub is a
rem      0-byte alias that does not count, so check real paths) ----
set "PY="
if exist "%LOCALAPPDATA%\Programs\Python\Python313\pythonw.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python313\pythonw.exe"
if defined PY goto gui
if exist "%LOCALAPPDATA%\Programs\Python\Python312\pythonw.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python312\pythonw.exe"
if defined PY goto gui
if exist "%LOCALAPPDATA%\Programs\Python\Python311\pythonw.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python311\pythonw.exe"
if defined PY goto gui

rem ---- anything else on PATH (pythonw = windowless launcher) ----
for %%I in (pythonw.exe) do if not "%%~$PATH:I"=="" set "PY=%%~$PATH:I"
if defined PY goto gui
goto console

:gui
rem pythonw.exe has no console, so no black window flashes up
start "" "%PY%" "tools\studio\studio.py"
exit /b 0

:console
where node >nul 2>nul
if errorlevel 1 goto nonode
node "tools\menu.mjs"
exit /b %errorlevel%

:nonode
echo.
echo   [x] Neither Python nor Node.js was found.
echo.
echo       Install Python from https://www.python.org/downloads/
echo       and tick "tcl/tk and IDLE" during setup, then run again.
echo.
pause
exit /b 1
