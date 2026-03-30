# 00 — 项目总览

## 项目信息

- **名称**：claude-agent-ui
- **路径**：`E:\projects\claude-agent-ui`（全新项目）
- **定位**：基于 Claude Agent SDK 的多终端实时同步 Agent UI
- **核心价值**：一端输入，所有终端实时同步；读取电脑中所有项目和对话，懒加载

## 与旧项目关系

- UI 设计参考 `E:\projects\claudecodeui\cocos-chat-embed`
- 架构从零重建：旧项目包装 CLI 进程，新项目直接用 Agent SDK

## 需求优先级

### P0 — 重中之重

| # | 功能 | 描述 |
|---|------|------|
| 1 | **一端输入，多端同步** | 一个终端发消息，所有连接的终端实时看到输入和输出 |
| 2 | **读取所有项目和会话** | SDK `listSessions()` 枚举电脑中所有项目和对话 |
| 3 | **会话懒加载** | 列表只加载元数据，点进去才加载消息，消息分页 |

### P1 — 基础交互

| # | 功能 | 描述 |
|---|------|------|
| 4 | 对话 | 发消息、流式接收（文本、thinking、工具调用、工具结果） |
| 5 | 工具审批 | Agent 需要权限时前端弹审批 UI |
| 6 | 单端输入锁 | 同一时间只有一个终端能输入 |
| 7 | 中途打断 | abort |

### P2 — 后续迭代

| # | 功能 |
|---|------|
| 8 | 会话 resume/fork |
| 9 | AskUserQuestion HTML Preview |
| 10 | File Checkpointing（回滚 Agent 文件修改） |
| 11 | Streaming Input（Agent 工作中途追加消息） |
| 12 | Tauri 2.0 桌面端 |
| 13 | Tauri 2.0 Mobile |
| 14 | Ink TUI（终端瘦客户端） |

## 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 运行时 | Node.js 22+ | Agent SDK 官方支持 |
| Agent 核心 | `@anthropic-ai/claude-agent-sdk` v0.2.87+ | V1 query() + AgentSession 抽象层 |
| HTTP 框架 | Fastify 5 | 比 Express 快 2x |
| WebSocket | `@fastify/websocket` | 多客户端实时广播 |
| 数据库 | better-sqlite3 + Drizzle ORM | 仅用户设置（会话用 SDK 原生 JSONL） |
| Web 前端 | React 19 + Vite + TailwindCSS v4 + Zustand | |
| 桌面端 (P2) | Tauri 2.0 | |
| 移动端 (P2) | Tauri 2.0 Mobile | |
| TUI (P2) | Ink | React 语法写终端 UI |
| Monorepo | pnpm workspace + turborepo | |

## 认证

- 服务端全局 `ANTHROPIC_API_KEY` 环境变量
- 支持 Bedrock (`CLAUDE_CODE_USE_BEDROCK=1`)、Vertex AI (`CLAUDE_CODE_USE_VERTEX=1`)、Azure (`CLAUDE_CODE_USE_FOUNDRY=1`)
- Web UI 无需额外认证（本地 localhost）
- 后续远程访问可加 JWT

## 边界与约束

- V1 stable API，AgentSession 抽象层隔离 V2 迁移
- 会话存储完全依赖 SDK 原生 JSONL，不自建
- 单机部署，不考虑分布式
- 不做：CLI 终端仿真、代码编辑器、文件浏览器
