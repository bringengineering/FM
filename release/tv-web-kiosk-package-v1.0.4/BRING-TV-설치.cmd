@echo off
chcp 65001 >nul
setlocal EnableExtensions

set "SOURCE=%~dp0BRING-TV-자동실행.cmd"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LAUNCHER=%STARTUP_DIR%\BRING-TV-자동실행.cmd"
call :set_error_log
call :find_browser

if not defined BROWSER (
  call :fail "Supported browser was not found. Install Microsoft Edge or Google Chrome."
  exit /b 10
)

if not exist "%SOURCE%" (
  call :fail "The startup launcher is missing from the extracted folder."
  exit /b 20
)

if not exist "%STARTUP_DIR%" mkdir "%STARTUP_DIR%" 2>nul
if not exist "%STARTUP_DIR%" (
  call :fail "The current-user Startup folder could not be created."
  exit /b 30
)

copy /Y "%~dp0BRING-TV-자동실행.cmd" "%LAUNCHER%" >nul
if errorlevel 1 (
  call :fail "The startup launcher could not be copied."
  exit /b 40
)

if not exist "%LAUNCHER%" (
  call :fail "The copied startup launcher could not be verified."
  exit /b 41
)

start "" "%LAUNCHER%"
if errorlevel 1 (
  call :fail "The TV board could not be started after installation."
  exit /b 50
)

if exist "%ERROR_LOG%" del /F /Q "%ERROR_LOG%" >nul 2>nul
echo.
echo BRING TV installation completed.
echo The board will open automatically when this Windows user signs in.
pause
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
>"%ERROR_LOG%" echo BRING TV CMD installer failed.
>>"%ERROR_LOG%" echo Time: %DATE% %TIME%
>>"%ERROR_LOG%" echo Stage: %~1
>>"%ERROR_LOG%" echo Source: %SOURCE%
>>"%ERROR_LOG%" echo Target: %LAUNCHER%
echo.
echo Installation failed. Error log: "%ERROR_LOG%"
pause
exit /b 0
