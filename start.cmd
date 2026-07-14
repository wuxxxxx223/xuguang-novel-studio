@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
if errorlevel 1 (
  echo.
  echo Xuguang failed to start. Review .data\server-8790.err.log for details.
  pause
  exit /b 1
)
