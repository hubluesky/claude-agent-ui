# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

claude-agent-ui — 基于 Claude Agent SDK 的多终端实时同步 Agent UI。一端输入，所有连接终端实时看到输出。直接调用 Agent SDK（非 CLI 包装），会话数据存储在 SDK 的 JSONL 文件中，与 Claude Code CLI 双向兼容。

## Commands

```bash
pnpm install          # 安装依赖
pnpm dev              # 同时启动 server (3456) + web (5173)
pnpm build            # 构建所有包 (shared → server → web)
pnpm lint             # 全包 TypeScript 类型检查

# 单包操作
pnpm --filter @claude-agent-ui/server dev
pnpm --filter @claude-agent-ui/web dev
pnpm --filter @claude-agent-ui/shared build
```

No test framework is configured yet.

## Architecture

pnpm workspace monorepo + Turborepo，三个包：

### packages/shared
TypeScript 类型库，被 server 和 web 共同依赖。
- `protocol.ts` — WebSocket 消息类型（C2S_* 客户端→服务器，S2C_* 服务器→客户端），discriminated union
- `messages.ts` — AgentMessage 类型（映射 SDK 事件：assistant, user, result, tool_progress, stream_event 等）
- `constants.ts` — PermissionMode, EffortLevel, LockStatus, 工具分类与颜色

### packages/server
Fastify 5 + @fastify/websocket，核心模块：
- `agent/` — SessionManager 管理所有 agent 会话，V1QuerySession 封装 SDK query() 调用。canUseTool hook 拦截工具请求做审批
- `ws/` — WSHub 按 session 广播消息，LockManager 实现单写者并发控制（同一时间仅一个客户端可输入），handler 处理连接路由
- `routes/` — REST 端点（health, sessions CRUD, settings）
- `db/` — SQLite (better-sqlite3 + Drizzle ORM)，仅存用户设置和 UI 状态

### packages/web
React 19 + Vite 6 + TailwindCSS 4，关键模块：
- `stores/` — Zustand stores：sessionStore, messageStore, connectionStore, settingsStore
- `hooks/useWebSocket.ts` — WebSocket 生命周期管理（单例模式）
- `components/chat/` — ChatInterface, ChatMessagesPane, ChatComposer, MessageComponent, PermissionBanner, AskUserPanel
- `components/layout/` — AppLayout（侧边栏 + 主区域）
- `lib/api.ts` — REST 客户端

## Key Patterns

- **WebSocket 协议**：自定义 C2S/S2C 消息类型，按 session 广播（非全局）
- **锁机制**：LockManager 保证单写者语义，锁持有者收到可写审批请求，其他客户端为只读
- **Agent 会话**：V1QuerySession 调用 SDK query()，通过 canUseTool hook 拦截工具请求，支持 resume（resumeSessionId）
- **审批超时**：工具审批和 AskUserQuestion 响应超时 5 分钟
- **Vite 代理**：dev 模式下 /api 和 /ws 代理到 localhost:3456

## Tech Stack

| Layer | Tech |
|-------|------|
| Agent SDK | @anthropic-ai/claude-agent-sdk (V1 query API) |
| Backend | Fastify 5, @fastify/websocket, better-sqlite3 + Drizzle ORM |
| Frontend | React 19, Vite 6, TailwindCSS 4, Zustand 5 |
| Language | TypeScript 5.7 (strict mode, ES2022 target) |
| Runtime | Node.js 22+ |

## Environment

- Server 默认端口 3456（`PORT` 环境变量可覆盖）
- SQLite 数据库默认路径 `~/.claude-agent-ui/settings.db`（`DB_PATH` 可覆盖）
- 无 .env 文件，配置通过环境变量或 `packages/server/src/config.ts` 默认值
