@echo off
title F.R.I.D.A.Y. System Launcher
color 0B

echo.
echo  ============================================
echo   F.R.I.D.A.Y. SYSTEM STARTUP SEQUENCE
echo  ============================================
echo.

:: ── Step 1: Start LiveKit Server ──
echo  [1/3] Starting LiveKit Server on port 7880...
start "LiveKit Server" /min cmd /c "cd /d "%~dp0livekit" && livekit-server.exe --dev --config livekit-dev.yaml"
timeout /t 2 /nobreak >nul

:: Verify LiveKit is up
:check_livekit
powershell -NoProfile -Command "try { $null = Invoke-WebRequest -Uri 'http://localhost:7880' -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel% neq 0 (
    echo    Waiting for LiveKit...
    timeout /t 1 /nobreak >nul
    goto check_livekit
)
echo    LiveKit Server: ONLINE

:: ── Step 2: Start Backend (auto-starts voice agent) ──
echo  [2/3] Starting F.R.I.D.A.Y. Backend on port 8000...
echo         (Voice agent auto-starts with backend)
start "FRIDAY Backend" /min cmd /c "cd /d "%~dp0backend" && venv\Scripts\python.exe -m uvicorn server:app --host 0.0.0.0 --port 8000"
timeout /t 3 /nobreak >nul

:: Verify Backend is up
:check_backend
powershell -NoProfile -Command "try { $null = Invoke-RestMethod -Uri 'http://localhost:8000/api/status' -TimeoutSec 2 -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel% neq 0 (
    echo    Waiting for Backend...
    timeout /t 1 /nobreak >nul
    goto check_backend
)
echo    Backend Server: ONLINE
echo    Voice Agent:    AUTO-STARTED

:: ── Step 3: Start Frontend ──
echo  [3/3] Starting Frontend on port 8080...
start "FRIDAY Frontend" /min cmd /c "cd /d "%~dp0frontend" && npm run dev"
timeout /t 3 /nobreak >nul

:: Verify Frontend is up
:check_frontend
powershell -NoProfile -Command "try { $null = Invoke-WebRequest -Uri 'http://localhost:8080' -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel% neq 0 (
    echo    Waiting for Frontend...
    timeout /t 1 /nobreak >nul
    goto check_frontend
)
echo    Frontend:       ONLINE

echo.
echo  ============================================
echo   F.R.I.D.A.Y. SYSTEM ONLINE
echo  ============================================
echo.
echo   Open:  http://localhost:8080
echo.
echo   Services:
echo     LiveKit    ws://localhost:7880
echo     Backend    http://localhost:8000
echo     Frontend   http://localhost:8080
echo     Voice      Auto-managed by backend
echo.
echo   Configure LLM/Keys in SETTINGS tab
echo   Just speak - Friday is always listening
echo.
echo  Press any key to SHUTDOWN all services...
pause >nul

:: Cleanup
echo.
echo  Shutting down F.R.I.D.A.Y. systems...
taskkill /fi "WINDOWTITLE eq LiveKit Server" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq FRIDAY Backend" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq FRIDAY Frontend" /f >nul 2>&1
:: Kill any orphaned Python agent processes (by cmdline and by port 8081)
powershell -NoProfile -Command "Get-Process python* -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*agent.agent*' } | Stop-Process -Force -ErrorAction SilentlyContinue" >nul 2>&1
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1
echo  All systems offline.
