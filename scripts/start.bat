@echo off
chcp 65001 >nul 2>nul
title Claude Agent UI

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js not found. Please install Node.js 22+
    echo Download: https://nodejs.org/
    pause
    exit /b 1
)

cd /d "%~dp0\.."

if exist "packages\server\node_modules\.bin\tsx.CMD" (
    echo Starting Claude Agent UI server...
    call packages\server\node_modules\.bin\tsx.CMD packages\server\src\index.ts --mode=prod
) else if exist "node_modules\.bin\tsx.CMD" (
    echo Starting Claude Agent UI server...
    call node_modules\.bin\tsx.CMD packages\server\src\index.ts --mode=prod
) else (
    echo [ERROR] tsx not found. Run: pnpm install
    pause
    exit /b 1
)

if %ERRORLEVEL% neq 0 (
    echo.
    echo Server failed to start
    pause
)
