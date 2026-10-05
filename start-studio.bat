@echo off
REM GIS Design Studio - one-click launcher
REM Starts the geodata cache server (:8788) and the Vite dev server (:5173).
REM Vite opens http://localhost:5173 in your browser automatically.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies - first run only...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Starting geodata cache server on http://localhost:8788 ...
start "GIS Studio - cache server :8788" cmd /k "cd /d ""%~dp0"" && node server/cache-server.mjs"

echo Starting studio on http://localhost:5173 ...
start "GIS Studio - Vite :5173" cmd /k "cd /d ""%~dp0"" && npm run dev"

echo.
echo Both servers are starting in their own windows.
echo Close those windows (or press Ctrl+C in them) to stop the servers.
timeout /t 5 >nul
