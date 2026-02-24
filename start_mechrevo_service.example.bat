@echo off
title 机械革命14+ 诊断中枢 · 公网服务
echo ============================================
echo   机械革命14+ 诊断中枢
echo   公网地址: http://your-server:53000
echo   手机浏览器直接访问即可
echo ============================================
echo.

:: 启动静态文件服务器 (端口 3001)
echo [1/2] 启动诊断中枢静态服务器...
start /B cmd /c "cd /d %~dp0web && npx http-server out -p 3001 -c-1 --cors -s"

:: 等待服务器启动
timeout /t 3 /nobreak >nul

:: 启动 FRP 隧道
echo [2/2] 启动 FRP 公网隧道...
start /B frpc.exe -c %~dp0frpc_mechrevo.toml

echo.
echo ============================================
echo   服务已启动!
echo   本地: http://localhost:3001
echo   公网: http://your-server:53000
echo ============================================
echo.
echo 按任意键关闭此窗口（服务将继续在后台运行）
pause >nul
