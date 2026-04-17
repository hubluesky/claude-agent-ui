# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

claude-agent-ui — 基于 Claude Agent SDK 的多终端实时同步 Agent UI。一端输入，所有连接终端实时看到输出。直接调用 Agent SDK（非 CLI 包装），会话数据存储在 SDK 的 JSONL 文件中，与 Claude Code CLI 双向兼容。可作为桌面应用运行（systray + auto-launch），也可嵌入外部页面（embed widget）。

## Commands

```bash
pnpm install          # 安装依赖
pnpm dev              # 同时启动 server (4000) + web (5173)
pnpm build            # 构建所有包 (shared → server → web)
pnpm lint             # 全包 TypeScript 类型检查

# 单包操作
pnpm --filter @claude-agent-ui/server dev    # tsx watch src/index.ts
pnpm --filter @claude-agent-ui/server start  # node dist/index.js (生产模式)
pnpm --filter @claude-agent-ui/web dev       # vite dev (5173)
pnpm --filter @claude-agent-ui/web build     # vite build (产出 dist/ + embed.js)
pnpm --filter @claude-agent-ui/web preview   # vite preview
pnpm --filter @claude-agent-ui/shared build  # tsc
```

No test framework is configured yet.

## Architecture

pnpm workspace monorepo + Turborepo，三个包：

### packages/shared

TypeScript 类型库，零运行时依赖，被 server 和 web 共同依赖。

- `protocol.ts` — WebSocket 消息类型（C2S_* 客户端→服务器，S2C_* 服务器→客户端），discriminated union
- `messages.ts` — AgentMessage 类型（映射 SDK 事件：assistant, user, result, tool_progress, stream_event, prompt_suggestion, auth_status, rate_limit_event 等）
- `session.ts` — ProjectInfo, SessionSummary, SendOptions, SessionResult
- `tools.ts` — ToolApprovalRequest/Decision, AskUserQuestion/Request/Response, PlanApproval 类型
- `constants.ts` — PermissionMode, EffortLevel, SessionStatus, LockStatus, TOOL_CATEGORIES, 工具分类与颜色
- `management.ts` — ServerStatus, ConnectionInfo, SdkVersionInfo, LogEntry, AdminStatus
- `sdk-features.ts` — SDK 功能检测

### packages/server

Fastify 5 + @fastify/websocket，核心模块：

#### agent/

- **SessionManager** (`manager.ts`) — 管理所有 agent 会话。`listProjects()` 按 cwd 聚合会话（30s 缓存），`createSession(cwd)` / `resumeSession(sessionId)` 创建/恢复会话，`getCommands()` 合并 SDK 命令 + 文件系统 skills
- **V1QuerySession** (`v1-session.ts`) — 封装 SDK query() 调用。`canUseTool` hook 拦截工具请求做审批（按 permissionMode 分流：default 模式自动放行只读工具，其余需用户批准）。`warmUp()` 非阻塞后台初始化（MCP、模型、上下文）。支持图片多模态输入、会话恢复（resumeSessionId）、权限模式切换
- **skills.ts** — `scanSkills()` 扫描已启用插件的 skill

#### ws/

- **WSHub** (`hub.ts`) — 按 session 的发布-订阅模型。消息缓冲（每 session 500 条，30 分钟 TTL），序列号（`_seq`）用于断线重连 gap 检测。流式快照（stream snapshot）用于重连时恢复部分内容块。心跳：30s 间隔，120s 超时（容忍后台标签页节流）。`joinWithSync()` / `subscribeWithSync()` 重放缺失消息
- **LockManager** (`lock.ts`) — 单写者并发控制。锁持有者可发送消息和审批，其他客户端只读。断线宽限期 60s（自动释放），空闲超时 60s（自动释放）
- **handler** (`handler.ts`) — C2S 消息路由：join-session, send-message, tool-approval-response, ask-user-response, abort, set-mode, reconnect, release-lock, claim-lock, fork-session, get-context-usage, get-mcp-status, toggle-mcp-server, reconnect-mcp-server, rewind-files, get-subagent-messages, pong。服务器重启后从会话历史恢复 pending 请求（AskUserQuestion、ExitPlanMode）

#### routes/

- `health.ts` — GET /api/health
- `sessions.ts` — GET /api/projects, GET /api/sessions, GET /api/sessions/:id, GET /api/sessions/:id/messages, POST /api/sessions, POST /api/sessions/:id/rename
- `settings.ts` — GET/PUT /api/settings（SQLite 存储，DB 不可用时禁用）
- `commands.ts` — GET /api/commands
- `files.ts` — 文件上传/下载
- `browse.ts` — GET /api/browse（目录列表，尊重 .gitignore）
- `management.ts` — 服务器控制（状态、日志、重启、配置、SDK 更新）
- `admin.ts` — 认证（登录、密码重置）

#### db/

SQLite (better-sqlite3 + Drizzle ORM)，仅存用户设置和 UI 状态。Drizzle schema 定义 `userSettings` 和 `uiState` 两张表（key-value JSON 存储）。better-sqlite3 原生模块编译失败时优雅降级（设置 API 禁用）。

#### 其他服务端模块

- `auth.ts` — AuthManager：bcrypt 密码哈希 + JWT 鉴权（12h 过期），持久化到 `~/.claude-agent-ui/admin-auth.json`
- `config.ts` — 配置加载：支持 env 覆盖、CLI `--mode` 参数、持久化配置文件
- `log-collector.ts` — 日志收集器（内存缓冲 + SSE 订阅）
- `server-manager.ts` — 服务器状态查询（连接数、锁信息、运行时间）
- `sdk-updater.ts` — SDK 更新器（分步更新 + SSE 进度推送）
- `tray.ts` — 系统托盘菜单（打开 UI、管理面板、重启、重置密码、退出）
- `index.ts` — 主入口，Fastify 初始化、插件注册、SPA fallback、托盘创建

### packages/web

React 19 + Vite 6 + TailwindCSS 4，关键模块：

#### Stores（Zustand 5）

- **sessionStore** — 项目列表、会话列表（按 cwd）、当前选中的 session/project、composer 草稿自动保存，30s 缓存
- **sessionContainerStore** — 每 session 容器状态（消息、状态、锁、模型等）
- **settingsStore** — 权限模式、effort、思考模式、预算、主题(dark/light)、视图模式(single/multi)，同步到 localStorage + 服务器
- **commandStore** — 斜杠命令缓存
- **serverStore** — 服务器状态、日志
- **multiPanelStore** — 多面板模式状态
- **embedStore** — 嵌入小部件状态
- **adminStore** — 管理面板状态

#### 核心模块

- **lib/WebSocketManager.ts**（单例）— 单连接多 session 订阅。指数退避重连（1s→30s max）。页面可见性感知：后台暂停心跳、前台快速重连。`joinSession()` / `subscribeSession()` / `unsubscribeSession()`。S2C 消息按 sessionId 路由到 sessionContainerStore。connectionId 持久化到 localStorage
- **lib/api.ts** — REST 客户端：项目/会话 CRUD、消息获取、文件上传、目录浏览、服务器管理、SDK 更新
- **hooks/useContainer.ts** — 返回每 session 的 ChatSessionProvider 上下文
- **hooks/useClaimLock.ts** — 锁获取包装
- **hooks/useKeyboardShortcuts.ts** — Cmd/Ctrl+Enter 发送，Esc 中止

#### 组件结构

- `components/chat/` — ChatInterface, ChatMessagesPane, ChatComposer, MessageComponent, PermissionBanner, AskUserPanel, ToolApprovalPanel, ModelSelector, ContextPanel, McpPanel
- `components/layout/` — AppLayout（响应式移动端/桌面端）, HistoryPanel（会话历史侧边栏）
- `components/settings/` — 主题、权限、预算控制
- `components/admin/` — 认证、服务器管理、日志
- `components/embed/` — 独立嵌入小部件

#### 构建产物

- `dist/index.html` — 主 SPA
- `dist/embed.js` — 独立嵌入小部件（`ClaudeEmbedAPI` 全局导出）
- `dist/assets/*.js` — code-split bundles

## 核心原则：与 Claude Code CLI 行为一致

本项目的所有交互机制必须与 Claude Code CLI 源代码的行为**完全一致**。不做简化、不做"差不多"的近似实现。实现前必须读 CLI 源代码确认真实行为，而不是凭猜测。CLI 源代码位于 `E:\projects\claude-code`。

## Key Patterns

- **WebSocket 协议**：自定义 C2S/S2C 消息类型，按 session 发布-订阅（非全局广播）
- **消息缓冲与重连**：WSHub 每 session 缓冲 500 条消息（30min TTL），带序列号（`_seq`）。重连时 gap 检测 + 消息重放 + 流式快照恢复
- **锁机制**：LockManager 保证单写者语义。锁持有者收到可写审批请求，其他客户端为只读。断线宽限 60s，空闲超时 60s
- **Agent 会话**：V1QuerySession 调用 SDK query()，通过 canUseTool hook 拦截工具请求。default 模式自动放行只读工具，其余需用户审批。支持 resume（resumeSessionId）
- **Container-per-session**：前端架构以 sessionContainerStore 为单位管理每个会话的完整状态（消息、锁、流式内容等），取代早期的全局 messageStore
- **Pending 请求恢复**：服务器重启后从会话历史检测未完成的 AskUserQuestion / ExitPlanMode 请求，重新投递给客户端
- **Vite 代理**：dev 模式下 /api 和 /ws 代理到 localhost:4000
- **优雅降级**：better-sqlite3 编译失败时自动跳过，设置 API 禁用但核心功能正常

## SDK Integration

直接调用 `@anthropic-ai/claude-agent-sdk` V1 API：

- **会话管理**：`query()`, `listSessions()`, `getSessionInfo()`, `getSessionMessages()`, `forkSession()`, `getSubagentMessages()`, `renameSession()`, `tagSession()`
- **工具审批 Hook**：`canUseTool(toolName, input, options)` → `Promise<{ behavior, updatedInput, message }>`，allow 路径必须包含 `updatedInput`
- **query() 选项**：`cwd`, `resume`, `maxTurns`, `effort`, `thinking`(adaptive/enabled/disabled), `permissionMode`, `includePartialMessages`, `enableFileCheckpointing`, `agentProgressSummaries`, `maxBudgetUsd`
- **SDK 事件**：system/init, assistant, user, result, tool_progress, stream_event, prompt_suggestion, auth_status, rate_limit_event

## Tech Stack

| Layer | Tech |
|-------|------|
| Agent SDK | @anthropic-ai/claude-agent-sdk ^0.2.97 (V1 query API) |
| Backend | Fastify 5, @fastify/websocket, @fastify/cors, @fastify/cookie, @fastify/static |
| Database | better-sqlite3 + Drizzle ORM (optional, graceful degradation) |
| Auth | bcryptjs + jsonwebtoken (JWT 12h expiry) |
| Frontend | React 19, Vite 6, TailwindCSS 4, Zustand 5 |
| Markdown | react-markdown + rehype-highlight + remark-gfm |
| Desktop | systray2 (托盘), auto-launch (开机自启), open (打开浏览器) |
| Language | TypeScript 5.7 (strict mode, ES2022 target, bundler resolution) |
| Runtime | Node.js 22+ |
| Build | Turborepo (dev: persistent no-cache, build: ^build dependency chain) |
| Package Manager | pnpm 10.30+ (workspace monorepo) |

## Environment

- Server 默认端口 4000（`PORT` 环境变量可覆盖）
- Web dev server 端口 5173（Vite 默认，`/api` 和 `/ws` 代理到 4000）
- 无 .env 文件，配置通过环境变量或 `packages/server/src/config.ts` 默认值
- 持久化目录 `~/.claude-agent-ui/`：
  - `settings.db` — SQLite 数据库（用户设置 + UI 状态）
  - `server-config.json` — 服务器配置（端口、模式）
  - `admin-auth.json` — 管理员密码哈希 + JWT secret
- 读取 Claude CLI 认证：`~/.claude/settings.json`（ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL）
- 环境变量覆盖：`PORT`, `HOST`, `DB_PATH`, `NODE_ENV`, `STATIC_DIR`
- 模式检测：`--mode=auto`（从持久化配置）、`--mode=dev/prod`（CLI 覆盖）、默认 prod
- 生产模式下自动检测 sibling `web/dist/index.html` 作为静态文件目录
