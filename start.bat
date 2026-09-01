@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing locked dependencies...
  call npm ci
  if errorlevel 1 (pause & exit /b 1)
)
echo Validating MTG AI Trainer v3 data...
call npm run check-db
if errorlevel 1 (pause & exit /b 1)
echo Starting MTG AI Trainer v3...
call npm run dev
pause
