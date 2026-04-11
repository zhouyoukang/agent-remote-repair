@echo off
title Agent Remote Repair · Public Service
echo ============================================
echo   Agent Remote Repair Hub
echo   Configure frpc.toml for your public URL
echo ============================================
echo.

:: Start remote-agent WebSocket hub (port 3002)
echo [1/3] Starting remote-agent hub...
start /B cmd /c "cd /d %~dp0remote-agent && node server.js"

:: Wait for server startup
timeout /t 3 /nobreak >nul

:: Start PS Agent Relay (port 9910)
echo [2/3] Starting PS Agent Relay...
start /B cmd /c "cd /d %~dp0ps-agent && python ps_agent_server.py"

:: Start FRP tunnel (optional — only if frpc.toml exists)
if exist "%~dp0frpc.toml" (
    echo [3/3] Starting FRP tunnel...
    start /B frpc.exe -c %~dp0frpc.toml
) else (
    echo [3/3] Skipped FRP tunnel (frpc.toml not found, copy frpc.example.toml to frpc.toml)
)

echo.
echo ============================================
echo   Services started!
echo   Local:  http://localhost:3002 (remote-agent)
echo           http://localhost:9910 (ps-agent relay)
echo   FRP:    Configure frpc.toml for public access
echo ============================================
echo.
echo Press any key to close this window (services continue in background)
pause >nul
