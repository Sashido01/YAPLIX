@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24.18+ ^(24.x^) from nodejs.org, then open YAPLIX.cmd again.
  pause
  exit /b 1
)
call npm.cmd run app -- %*
if errorlevel 1 pause
