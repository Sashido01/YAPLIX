@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1" %*
set "YAPLIX_EXIT=%ERRORLEVEL%"
if not "%YAPLIX_EXIT%"=="0" pause
exit /b %YAPLIX_EXIT%
