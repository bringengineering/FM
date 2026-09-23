@echo off
chcp 65001 >nul
setlocal EnableExtensions

set "TV_URL=https://bring-crm-ai-gateway.bringengineering1008.workers.dev/tv"
set "PROFILE_DIR=%LOCALAPPDATA%\BRING-TV\BrowserProfile"
call :set_error_log
call :find_browser

if not defined BROWSER (
  call :fail "Supported browser was not found. Install Microsoft Edge or Google Chrome."
  exit /b 10
)

if not exist "%PROFILE_DIR%" mkdir "%PROFILE_DIR%" 2>nul
if not exist "%PROFILE_DIR%" (
  call :fail "The dedicated browser profile folder could not be created."
  exit /b 20
)

start "" "%BROWSER%" --kiosk --no-first-run --disable-session-crashed-bubble --user-data-dir="%PROFILE_DIR%" "%TV_URL%"
if errorlevel 1 (
  call :fail "The browser could not open the TV board."
  exit /b 30
)

if exist "%ERROR_LOG%" del /F /Q "%ERROR_LOG%" >nul 2>nul
exit /b 0

:find_browser
set "BROWSER="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
exit /b 0

:set_error_log
set "ERROR_LOG=%USERPROFILE%\Desktop\BRING-TV-CMD-설치-오류.txt"
if exist "%USERPROFILE%\Desktop" exit /b 0
if defined OneDrive if exist "%OneDrive%\Desktop" set "ERROR_LOG=%OneDrive%\Desktop\BRING-TV-CMD-설치-오류.txt"
if defined OneDrive if exist "%OneDrive%\Desktop" exit /b 0
set "ERROR_LOG=%TEMP%\BRING-TV-CMD-설치-오류.txt"
exit /b 0

:fail
>"%ERROR_LOG%" echo BRING TV startup failed.
>>"%ERROR_LOG%" echo Time: %DATE% %TIME%
>>"%ERROR_LOG%" echo Stage: %~1
>>"%ERROR_LOG%" echo URL: %TV_URL%
echo BRING TV startup failed. Error log: "%ERROR_LOG%"
exit /b 0
