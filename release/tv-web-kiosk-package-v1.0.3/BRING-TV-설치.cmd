@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install-bring-tv-web-kiosk.ps1"
if errorlevel 1 (
  echo.
  echo BRING TV installation failed. Please check the message above.
  pause
  exit /b 1
)
echo.
echo BRING TV installation completed.
pause

