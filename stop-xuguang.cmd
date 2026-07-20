@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\stop.ps1" %*
if errorlevel 1 (
  echo.
  echo Xuguang could not stop cleanly. Review the error above.
  pause
  exit /b 1
)
