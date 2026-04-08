#!/usr/bin/env bash
# Claude Agent UI — macOS/Linux 启动脚本
set -e

if ! command -v node &> /dev/null; then
    echo "Node.js 未安装，请安装 Node.js 22+ 后重试"
    echo "下载地址: https://nodejs.org/"
    exit 1
fi

# 切换到项目根目录（scripts 的上级）
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

# 优先用 tsx 运行源码
if [ -x "node_modules/.bin/tsx" ]; then
    echo "启动 Claude Agent UI 服务器..."
    exec node_modules/.bin/tsx packages/server/src/index.ts --mode=prod
elif [ -f "packages/server/dist/index.js" ]; then
    echo "启动 Claude Agent UI 服务器..."
    exec node packages/server/dist/index.js --mode=prod
else
    echo "未找到服务器文件，请先运行: pnpm install && pnpm build"
    exit 1
fi
