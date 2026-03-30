# 01 — 架构

## 总体架构

```
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌──────────┐
│ Tauri 桌面   │ │  Web 浏览器  │ │ Tauri 手机   │ │ Ink TUI  │
│  (P2)       │ │  (P0)       │ │  (P2)       │ │  (P2)    │
└──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └────┬─────┘
       └───────────────┼───────────────┼──────────────┘
                       │ WebSocket + JSON 统一协议
               ┌───────┴────────┐
               │  Fastify 5     │
               │  ┌───────────┐ │
               │  │ WS Hub    │ │  多客户端广播/同步
               │  │ Lock Mgr  │ │  同一时间单端输入
               │  │ Session   │ │  AgentSession 抽象层
               │  │ Manager   │ │
               │  └─────┬─────┘ │
               │        │       │
               │  Agent SDK     │  V1 query() + canUseTool + Hooks
               └───────┬────────┘
                       │
            ~/.claude/projects/ (JSONL)
            SDK 原生存储，双向兼容 CLI
```

## 数据流向

```
客户端                    服务端                          SDK / 存储
───────                   ──────                          ──────────
WS connect ──────────→ handler.ts
                         │ 分配 connectionId
                         │ 加入 WSHub
                    ←──── init { connectionId }

REST GET /projects ──→ routes/sessions.ts
                         │ SDK listSessions()
                    ←──── ProjectInfo[]               ← ~/.claude/projects/

REST GET /sessions/:id/messages ──→ routes/sessions.ts
                         │ SDK getSessionMessages(limit, offset)
                    ←──── SessionMessage[]             ← <session>.jsonl

WS send-message ─────→ handler.ts
                         │ LockManager.acquire()
                         │ SessionManager.getOrCreate()
                         │ agentSession.send(prompt)
                         │   ↓
                         │ query({ prompt, resume })   → Anthropic API
                         │   for await (msg of query)
                         │     WSHub.broadcast(msg) ──→ 所有客户端
                         │
                         │ canUseTool 触发时:
                         │   WSHub.sendToHolder(req) ──→ 锁持有者
                         │   WSHub.broadcast(req, readonly) → 其他客户端
WS tool-response ────→   │   resolve promise
                         │   Agent 继续执行
                         │
                         │ onComplete:
                         │   LockManager.release()
                         │   WSHub.broadcast(complete) → 所有客户端
```

## Monorepo 项目结构

```
claude-agent-ui/
├── packages/
│   ├── shared/                  # TS 类型、协议、消息格式
│   │   ├── src/
│   │   │   ├── protocol.ts      # WS 消息协议（C2S / S2C 全部类型）
│   │   │   ├── messages.ts      # AgentMessage 类型（映射 SDK SDKMessage）
│   │   │   ├── session.ts       # AgentSession 接口、SessionInfo、ProjectInfo
│   │   │   ├── tools.ts         # 工具审批请求/响应类型
│   │   │   └── constants.ts     # PermissionMode、EffortLevel、工具分类
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── server/                  # 后端服务
│   │   ├── src/
│   │   │   ├── index.ts         # Fastify 入口、插件注册、静态文件
│   │   │   ├── config.ts        # 环境变量、端口、路径配置
│   │   │   ├── agent/
│   │   │   │   ├── session.ts   # AgentSession 接口（import from shared）
│   │   │   │   ├── v1-session.ts # V1QuerySession 实现
│   │   │   │   └── manager.ts   # SessionManager
│   │   │   ├── ws/
│   │   │   │   ├── hub.ts       # WSHub 广播/订阅
│   │   │   │   ├── lock.ts      # LockManager
│   │   │   │   ├── handler.ts   # WS 连接 → 消息路由
│   │   │   │   └── registry.ts  # 连接注册表（connectionId → ws, sessionId）
│   │   │   ├── routes/
│   │   │   │   ├── sessions.ts  # GET /projects, /sessions, /sessions/:id/messages
│   │   │   │   └── health.ts    # GET /health
│   │   │   └── db/
│   │   │       ├── schema.ts    # Drizzle: userSettings, uiState
│   │   │       └── index.ts     # SQLite 初始化
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── web/                     # Web 前端 (P0)
│   │   ├── src/
│   │   │   ├── main.tsx         # React 入口
│   │   │   ├── App.tsx          # 路由、布局
│   │   │   ├── components/
│   │   │   │   ├── layout/
│   │   │   │   │   └── AppLayout.tsx      # 侧栏 + 主区域布局
│   │   │   │   ├── sidebar/
│   │   │   │   │   ├── SessionList.tsx    # 项目/会话列表
│   │   │   │   │   ├── ProjectGroup.tsx   # 项目分组
│   │   │   │   │   └── SearchBox.tsx      # 搜索
│   │   │   │   ├── chat/
│   │   │   │   │   ├── ChatInterface.tsx        # 聊天主容器
│   │   │   │   │   ├── ChatMessagesPane.tsx     # 消息列表（懒加载滚动）
│   │   │   │   │   ├── ChatComposer.tsx         # 输入区
│   │   │   │   │   ├── MessageComponent.tsx     # 单条消息渲染
│   │   │   │   │   ├── PermissionBanner.tsx     # 工具审批横幅
│   │   │   │   │   ├── AskUserPanel.tsx         # 澄清问题面板
│   │   │   │   │   ├── StatusBar.tsx            # 锁状态 + 模式
│   │   │   │   │   ├── ModesPopup.tsx           # 模式/Effort 选择
│   │   │   │   │   ├── ThinkingSelector.tsx     # Thinking 模式选择
│   │   │   │   │   └── ThinkingIndicator.tsx    # 加载动画
│   │   │   │   └── tools/
│   │   │   │       ├── ToolRenderer.tsx          # 工具分发渲染
│   │   │   │       ├── OneLineDisplay.tsx        # 单行工具
│   │   │   │       ├── CollapsibleDisplay.tsx    # 可折叠工具
│   │   │   │       ├── SubagentContainer.tsx     # 子 Agent
│   │   │   │       ├── ToolDiffViewer.tsx        # Diff 视图
│   │   │   │       └── AskUserQuestionPanel.tsx  # 问题选项
│   │   │   ├── hooks/
│   │   │   │   ├── useWebSocket.ts        # WS 连接管理
│   │   │   │   ├── useSessionList.ts      # 项目/会话列表加载
│   │   │   │   ├── useMessages.ts         # 消息懒加载 + 实时追加
│   │   │   │   ├── useLock.ts             # 锁状态
│   │   │   │   └── useToolApproval.ts     # 审批请求管理
│   │   │   ├── stores/
│   │   │   │   ├── sessionStore.ts        # 项目列表、当前会话
│   │   │   │   ├── messageStore.ts        # 消息列表、懒加载状态
│   │   │   │   ├── connectionStore.ts     # WS 连接、锁状态
│   │   │   │   └── settingsStore.ts       # 用户偏好
│   │   │   └── lib/
│   │   │       ├── api.ts                 # REST API 客户端
│   │   │       └── ws-client.ts           # WebSocket 客户端封装
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.ts
│   │   └── package.json
│   │
│   ├── desktop/                 # Tauri 桌面壳 (P2)
│   │   ├── src-tauri/
│   │   └── package.json
│   ├── mobile/                  # Tauri Mobile 壳 (P2)
│   └── tui/                     # Ink TUI (P2)
│       ├── src/
│       │   ├── index.tsx        # Ink 入口
│       │   ├── App.tsx          # TUI 主界面
│       │   ├── components/
│       │   │   ├── MessageList.tsx
│       │   │   ├── Input.tsx
│       │   │   └── StatusLine.tsx
│       │   └── lib/
│       │       └── ws-client.ts # 复用 shared WS 协议
│       └── package.json
│
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
└── package.json
```

## 模块依赖关系

```
shared ←── server
shared ←── web
shared ←── tui
web    ←── desktop (Tauri 内嵌)
web    ←── mobile  (Tauri 内嵌)
```

所有客户端（web/desktop/mobile/tui）只依赖 `shared` 包的类型定义和 WS 协议，不直接依赖 `server`。通过 WebSocket + REST 通信。
