#!/usr/bin/env bash
# 组装分发目录
set -e

echo "=== 构建所有包 ==="
pnpm build

echo "=== 组装分发目录 ==="
rm -rf release
mkdir -p release/server release/web

# 复制 server 构建产物
cp -r packages/server/dist/* release/server/
mkdir -p release/server/node_modules

# 安装 server 生产依赖
cp packages/server/package.json release/server/
cd release/server
npm install --omit=dev 2>/dev/null || echo "npm install 跳过（可手动安装）"
rm -f package.json package-lock.json
cd ../..

# 复制 web 构建产物
cp -r packages/web/dist/* release/web/

# 复制启动脚本
cp scripts/start.bat release/
cp scripts/start.sh release/
chmod +x release/start.sh

echo "=== 完成 ==="
echo "分发目录: release/"
ls -la release/
