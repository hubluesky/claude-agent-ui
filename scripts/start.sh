#!/usr/bin/env bash
# Claude Agent UI — macOS/Linux 启动脚本
set -e

if ! command -v node &> /dev/null; then
    echo "Node.js 未安装，请安装 Node.js 22+ 后重试"
    echo "下载地址: https://nodejs.org/"
    exit 1
fi

DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$DIR/server/dist/index.js" ]; then
    exec node "$DIR/server/dist/index.js" --mode=prod
elif [ -f "$DIR/packages/server/dist/index.js" ]; then
    exec node "$DIR/packages/server/dist/index.js" --mode=prod
else
    echo "未找到服务器文件，请先运行 pnpm build"
    exit 1
fi
