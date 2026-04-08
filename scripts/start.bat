@echo off
:: Claude Agent UI — Windows 启动脚本（双击即可启动）
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Node.js 未安装，请安装 Node.js 22+ 后重试
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

cd /d "%~dp0"
if exist "server\dist\index.js" (
    node server\dist\index.js --mode=prod
) else if exist "packages\server\dist\index.js" (
    node packages\server\dist\index.js --mode=prod
) else (
    echo 未找到服务器文件，请先运行 pnpm build
    pause
    exit /b 1
)
