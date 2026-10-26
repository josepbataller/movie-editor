@echo off
rem Launches the CURRENT build of Movie Editor (same target as the desktop shortcut).
rem After changing code run "npm run build" so dist/ is up to date.
cd /d "%~dp0"
if not exist "dist-electron\main.js" (
  echo Building the app for the first time...
  call npm run build || (pause & exit /b 1)
)
start "" /b node_modules\electron\dist\electron.exe "%~dp0." %*
