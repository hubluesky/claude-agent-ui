#!/usr/bin/env bash
# Claude Agent UI startup script (Windows Git Bash / macOS / Linux)
# Server auto-manages vite dev server in dev mode.
set -e

if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js not found. Please install Node.js 22+"
    echo "Download: https://nodejs.org/"
    exit 1
fi

# Project root (parent of scripts/)
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

# Find tsx
TSX_BIN=""
if [ -f "packages/server/node_modules/.bin/tsx" ]; then
    TSX_BIN="packages/server/node_modules/.bin/tsx"
elif [ -f "node_modules/.bin/tsx" ]; then
    TSX_BIN="node_modules/.bin/tsx"
fi

# Dev mode if source code exists, otherwise production
if [ -d "packages/web/src" ] && [ -n "$TSX_BIN" ]; then
    echo "Starting Claude Agent UI (dev mode, tsx watch)..."
    exec "$TSX_BIN" watch packages/server/src/index.ts --mode=dev
elif [ -n "$TSX_BIN" ]; then
    echo "Starting Claude Agent UI (production mode)..."
    exec "$TSX_BIN" packages/server/src/index.ts --mode=auto
elif [ -f "packages/server/dist/index.js" ]; then
    echo "Starting Claude Agent UI (production mode)..."
    exec node packages/server/dist/index.js --mode=auto
else
    echo "[ERROR] No server files found. Run: pnpm install && pnpm build"
    exit 1
fi
