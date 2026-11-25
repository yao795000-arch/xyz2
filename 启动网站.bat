@echo off
chcp 65001 >nul
cd /d "%~dp0"
title SOMNA - local server

set "NODE="
where node >nul 2>nul && set "NODE=node"
if not defined NODE (
  for /d %%D in ("%USERPROFILE%\.dsh\dsh-runtimes\*") do (
    if exist "%%D\dependencies\node\bin\node.exe" set "NODE=%%D\dependencies\node\bin\node.exe"
  )
)
if not defined NODE (
  echo.
  echo   Node.js was not found on this machine.
  echo   Install it from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo   SOMNA - starting local server
echo   ------------------------------------------------
echo   Keep this window open while you browse the site.
echo   Phones / tablets: same Wi-Fi, use the WLAN address below.
echo   Press Ctrl+C to stop.
echo.
"%NODE%" "%~dp0tools\serve.mjs"
echo.
echo   Server stopped.
pause
