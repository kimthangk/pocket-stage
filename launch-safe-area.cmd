@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install Node.js and ensure node is available on PATH.
  pause
  exit /b 1
)
if "%PORT%"=="" set "PORT=4173"
node safe-area-launcher.cjs
if errorlevel 1 (
  echo Pocket Stage safe-area preview stopped with an error.
  pause
)
