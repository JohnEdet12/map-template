@echo off
title Stop all local servers
REM Stops the GIS Design Studio servers and the Crime Dashboard service.
REM   GIS Design Studio : Vite 5173, cache server 8788, AI backend 8787
REM   Crime Dashboard   : dev_server 8085, supervisor 8086,
REM                       scheduled task "CrimeDashboard-Localhost" (disabled so it cannot restart)

echo Disabling the Crime Dashboard auto-restart task...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$t = Get-ScheduledTask -TaskName 'CrimeDashboard-Localhost' -ErrorAction SilentlyContinue;" ^
  "if ($t) { Stop-ScheduledTask -TaskName 'CrimeDashboard-Localhost' -ErrorAction SilentlyContinue; Disable-ScheduledTask -TaskName 'CrimeDashboard-Localhost' | Out-Null; Write-Host '  Task stopped and disabled.' } else { Write-Host '  Task not found - skipping.' }"

echo Stopping anything listening on ports 8086, 8085, 5173, 8788, 8787...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "foreach ($p in 8086,8085,5173,8788,8787) {" ^
  "  $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue;" ^
  "  if (-not $c) { Write-Host ('  Port ' + $p + ': nothing running'); continue }" ^
  "  foreach ($id in ($c.OwningProcess | Sort-Object -Unique)) {" ^
  "    $n = (Get-Process -Id $id -ErrorAction SilentlyContinue).ProcessName;" ^
  "    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue;" ^
  "    Write-Host ('  Port ' + $p + ': stopped ' + $n + ' (PID ' + $id + ')') } }"

echo Closing the GIS Studio server windows...
taskkill /FI "WINDOWTITLE eq GIS Studio*" /T /F >nul 2>nul

echo.
echo Done. Everything is stopped.
echo To run the studio again: double-click start-studio.bat
echo To turn the Crime Dashboard service back on: Task Scheduler ^> CrimeDashboard-Localhost ^> Enable
echo.
pause
