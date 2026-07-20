@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\dev.ps1" %*
if errorlevel 1 (
  echo.
  echo Xuguang development server stopped with an error.
  pause
  exit /b 1
)
