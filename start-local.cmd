@echo off
cd /d "%~dp0"
if not exist node_modules (
  call npm ci
  if errorlevel 1 goto error
)
call npm run build
if errorlevel 1 goto error
echo.
echo Open http://127.0.0.1:3000 in your browser.
echo Close this window to stop the local server.
echo.
call npm start
:error
pause
