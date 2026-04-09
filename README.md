# Claude Agent UI

基于 [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-agent-sdk) 的多终端实时同步 Agent UI。

一端输入，所有连接终端实时看到输出。直接调用 Agent SDK（非 CLI 包装），会话数据存储在 SDK 的 JSONL 文件中，与 Claude Code CLI 双向兼容。

## 特性

- **多终端实时同步** — 多个浏览器窗口/设备连接同一会话，实时同步消息流
- **原生 SDK 集成** — 直接调用 `@anthropic-ai/claude-agent-sdk` V1 query API，非 CLI 进程包装
- **工具审批机制** — 通过 `canUseTool` hook 拦截工具请求，支持逐条审批或自动放行
- **单写者并发控制** — LockManager 保证同一时间仅一个客户端可输入，其他客户端为只读观察者
- **会话持久化** — 会话数据存储在 SDK 原生 JSONL 文件中，可与 Claude Code CLI 互通
- **流式输出** — 实时流式展示 assistant 回复、thinking 过程、工具调用进度
- **Markdown 渲染** — 支持 GFM、代码高亮、图片预览
- **系统托盘** — 支持最小化到系统托盘后台运行

## 技术栈

| 层级 | 技术 |
|------|------|
| Agent SDK | `@anthropic-ai/claude-agent-sdk` (V1 query API) |
| 后端 | Fastify 5, @fastify/websocket, better-sqlite3 + Drizzle ORM |
| 前端 | React 19, Vite 6, TailwindCSS 4, Zustand 5 |
| 语言 | TypeScript 5.7 (strict mode, ES2022 target) |
| 运行时 | Node.js 22+ |
| 包管理 | pnpm 10 + Turborepo |

## 快速开始

### 前置要求

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 10+
- 有效的 Anthropic API Key（通过 `ANTHROPIC_API_KEY` 环境变量或 Claude Code CLI 已有配置）

### 安装

```bash
git clone https://github.com/anthropics/claude-agent-ui.git
cd claude-agent-ui
pnpm install
```

### 开发模式

```bash
pnpm dev
```

同时启动：
- **Server** — `http://localhost:4000`（API + WebSocket）
- **Web** — `http://localhost:5173`（Vite dev server，自动代理 `/api` 和 `/ws` 到 4000）

### 生产构建

```bash
pnpm build
```

构建顺序：`shared` → `server` → `web`（由 Turborepo 自动编排依赖）。

构建完成后启动：

```bash
pnpm --filter @claude-agent-ui/server start
```

Server 会自动检测并托管 `packages/web/dist` 静态文件。

## 项目结构

```
claude-agent-ui/
├── packages/
│   ├── shared/          # 共享类型库
│   │   └── src/
│   │       ├── protocol.ts    # WebSocket C2S/S2C 消息类型
│   │       ├── messages.ts    # AgentMessage 类型定义
│   │       └── constants.ts   # 枚举常量（权限模式、工具分类等）
│   │
│   ├── server/          # 后端服务
│   │   └── src/
│   │       ├── agent/         # SessionManager + V1QuerySession
│   │       ├── ws/            # WSHub 广播 + LockManager 并发控制
│   │       ├── routes/        # REST API（health, sessions, settings）
│   │       ├── db/            # SQLite + Drizzle ORM
│   │       ├── config.ts      # 应用配置
│   │       └── tray.ts        # 系统托盘
│   │
│   └── web/             # 前端应用
│       └── src/
│           ├── components/
│           │   ├── chat/      # 聊天界面核心组件
│           │   ├── layout/    # 布局（侧边栏 + 主区域）
│           │   ├── sidebar/   # 会话列表侧边栏
│           │   ├── settings/  # 设置面板
│           │   └── admin/     # 管理面板
│           ├── stores/        # Zustand 状态管理
│           ├── hooks/         # React hooks（WebSocket 等）
│           └── lib/           # API 客户端等工具
│
├── docs/                # 项目文档
├── turbo.json           # Turborepo 配置
├── pnpm-workspace.yaml  # pnpm workspace 配置
└── tsconfig.base.json   # 共享 TypeScript 配置
```

## 常用命令

```bash
# 开发
pnpm dev                    # 启动所有包的 dev 模式
pnpm --filter @claude-agent-ui/server dev   # 仅启动 server
pnpm --filter @claude-agent-ui/web dev      # 仅启动 web

# 构建
pnpm build                  # 构建所有包

# 类型检查
pnpm lint                   # 全包 TypeScript 类型检查
```

## 配置

通过环境变量配置，无需 `.env` 文件：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `4000` | Server 监听端口 |
| `HOST` | `0.0.0.0` | Server 监听地址 |
| `DB_PATH` | `~/.claude-agent-ui/settings.db` | SQLite 数据库路径 |
| `STATIC_DIR` | 自动检测 | 前端静态文件目录 |

持久化配置存储在 `~/.claude-agent-ui/server-config.json`。

## 架构概览

```
浏览器 A ──┐                          ┌── Claude Agent SDK
浏览器 B ──┤  WebSocket (C2S/S2C)     │   (V1 query API)
浏览器 C ──┼────────────────────┤ Server ├──────────────────┤ Anthropic API
           │                    │        │
           │  REST (/api/*)     │        └── SQLite (settings)
           └────────────────────┘
```

- **WebSocket 协议** — 自定义 C2S（客户端→服务器）/ S2C（服务器→客户端）消息类型，按 session 广播
- **锁机制** — LockManager 保证单写者语义，锁持有者可发送消息和审批工具请求，其他客户端只读
- **Agent 会话** — V1QuerySession 封装 SDK `query()` 调用，通过 `canUseTool` hook 拦截工具请求实现审批流
- **会话恢复** — 支持 `resumeSessionId` 恢复已有会话，数据从 SDK 的 JSONL 文件加载

## License

MIT
