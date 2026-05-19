@echo off
chcp 65001 >nul
echo ============================================
echo   SyncCanvas 分布式协作画布
echo ============================================
echo.

:: 检查端口 3000 是否被占用
netstat -ano | findstr ":3000" | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo [警告] 端口 3000 已被占用，正在清理...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
        taskkill /F /PID %%a >nul 2>&1
    )
    timeout /t 2 >nul
)

:: 启动服务器
echo [1/2] 启动 WebSocket 网关服务...
start "SyncCanvas-Server" cmd /c "cd /d %~dp0 && node server/index.js"

:: 等待服务器启动
timeout /t 3 >nul

:: 启动 cloudflared（如果已安装）
where cloudflared >nul 2>&1
if %errorlevel% equ 0 (
    echo [2/2] 启动 Cloudflare Tunnel...
    start "SyncCanvas-Tunnel" cmd /c "cloudflared tunnel --url http://localhost:3000"
) else (
    echo [提示] 未找到 cloudflared，跳过隧道启动
    echo   请手动启动: cloudflared tunnel --url http://localhost:3000
)

echo.
echo ============================================
echo   服务已启动！
echo ============================================
echo.
echo   本地访问: http://localhost:3000
echo   按任意键打开浏览器...
pause >nul
start http://localhost:3000
