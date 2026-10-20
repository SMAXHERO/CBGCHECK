@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title CBG Panel Launcher

echo.
echo   ============================================
echo     CBG Panel - Launcher
echo   ============================================
echo.
echo   Starts the local query service used by the web panel.
echo   Data comes from THIS computer, not from a remote server.
echo   Step-by-step guide: docs/getting-started.md
echo.

rem ---------- Check Node.js ----------
where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Node.js not found.
  echo.
  echo   Please install Node.js LTS first:
  echo       https://nodejs.org/en
  echo   Then close this window and run this file again.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do set NODEVER=%%v
echo   [OK] Node.js !NODEVER!

rem ---------- Check Python (module 3: soul report kernel) ----------
where python >nul 2>nul
if errorlevel 1 (
  echo   [!]  Python not found - module 3 "Soul Report" will be unavailable.
  echo        Install Python 3.9+ from https://www.python.org/downloads/
  echo        then run:  pip install requests
) else (
  for /f "delims=" %%v in ('python --version 2^>^&1') do set PYVER=%%v
  python -c "import requests" >nul 2>nul
  if errorlevel 1 (
    echo   [!]  Python !PYVER! found, but "requests" is missing.
    echo        Module 3 uses it:  pip install requests
  ) else (
    echo   [OK] Python !PYVER! ^(module 3 ready^)
  )
)

rem ---------- Is the service already running? ----------
set ALREADY=0
powershell -NoProfile -Command "try{(Invoke-WebRequest -Uri 'http://127.0.0.1:8791/api/health' -UseBasicParsing -TimeoutSec 2)|Out-Null;exit 0}catch{exit 1}" >nul 2>nul
if not errorlevel 1 set ALREADY=1

rem ---------- Port occupied but service not answering? ----------
if "!ALREADY!"=="0" (
  powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8791 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>nul
  if not errorlevel 1 (
    echo.
    echo   [X] Port 8791 is occupied, but /api/health does not answer.
    echo       Close the program using 8791, or start with another port:
    echo         node tools\cbg\scraper-service\server.mjs --port 8792
    echo.
    pause
    exit /b 1
  )
)

if "!ALREADY!"=="1" (
  echo   [i]  Service is already running - not starting a second one.
) else (
  echo   [OK] Starting the query service, please wait...
  start "cbg-scraper-service" /min cmd /c "node tools\cbg\scraper-service\server.mjs --port 8791 --cdp-port 9334 1>> tools\cbg\scraper-service\server.out.log 2>> tools\cbg\scraper-service\server.err.log"
)

echo.
echo   ----------------------------------------------
echo   In the browser window that just opened:
echo     1. Log in to the site (once only, stays valid)
echo     2. Complete the slider check if asked
echo   Keep that window open - do not close it.
echo   ----------------------------------------------
echo.

rem ---------- Wait until the service answers, up to about 40s ----------
if "!ALREADY!"=="0" (
  set READY=0
  for /l %%i in (1,1,40) do (
    if "!READY!"=="0" (
      powershell -NoProfile -Command "try{(Invoke-WebRequest -Uri 'http://127.0.0.1:8791/api/health' -UseBasicParsing -TimeoutSec 2)|Out-Null;exit 0}catch{exit 1}" >nul 2>nul
      if not errorlevel 1 (
        set READY=1
      ) else (
        <nul set /p "=."
        timeout /t 1 /nobreak >nul
      )
    )
  )
  echo.
  if "!READY!"=="1" (
    echo   [OK] Service is ready.
  ) else (
    echo   [!]  Service did not come up in time. Last log lines:
    echo.
    if exist tools\cbg\scraper-service\server.err.log (
      echo   ---- server.err.log ----
      powershell -NoProfile -Command "Get-Content 'tools\cbg\scraper-service\server.err.log' -Tail 15"
    )
    if exist tools\cbg\scraper-service\server.out.log (
      echo   ---- server.out.log ----
      powershell -NoProfile -Command "Get-Content 'tools\cbg\scraper-service\server.out.log' -Tail 10"
    )
    echo.
    echo   Common causes: port 8791 in use, Edge/Chrome not found, Python/requests missing.
    echo   Module 3 only: node tools\cbg\scraper-service\server.mjs --no-browser
    echo.
    pause
  )
) else (
  start "" "https://yys.cbg.163.com/"
)

echo.
echo   ----------------------------------------------
echo   Now open one of these addresses in your browser:
echo.
echo     Public UI  - click ALLOW when the browser asks
echo       https://smaxhero.github.io/CBGCHECK/
echo.
echo     Local UI   - needs npm install first
echo       http://127.0.0.1:5173
echo   ----------------------------------------------
echo.

start "" "https://smaxhero.github.io/CBGCHECK/"

echo   The public UI has been opened for you.
echo   If the browser asks about local network access, click ALLOW.
echo.
echo   To stop the service: close the minimised cbg-scraper-service
echo   window, or press Ctrl+C inside it.
echo.
pause
