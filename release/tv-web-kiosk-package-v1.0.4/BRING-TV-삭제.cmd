@echo off
chcp 65001 >nul
setlocal EnableExtensions

set "LAUNCHER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\BRING-TV-자동실행.cmd"

if exist "%LAUNCHER%" del /F /Q "%LAUNCHER%"
if exist "%LAUNCHER%" (
  echo BRING TV startup entry could not be removed.
  pause
  exit /b 1
)

echo BRING TV automatic startup was removed.
echo The saved TV registration remains available for a future reinstall.
pause
exit /b 0
