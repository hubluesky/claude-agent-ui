# 08 — 开发阶段规划

## Phase 1 — 核心骨架 (P0)

目标：**一端输入，多端实时同步。懒加载项目和会话列表。**

### Step 1.1 — Monorepo 初始化

```
- pnpm init + pnpm-workspace.yaml
- turborepo (turbo.json)
- tsconfig.base.json (strict, paths)
- packages/shared: 空包，导出类型
- packages/server: 空 Fastify 入口
- packages/web: Vite + React 19 + Tailwind v4 空项目
- ESLint + Prettier 配置
- .gitignore
```

**验收**：`pnpm dev` 能同时启动 server (3456) 和 web (5173)

### Step 1.2 — shared 类型定义

```
- packages/shared/src/protocol.ts: 所有 C2S / S2C 消息类型
- packages/shared/src/messages.ts: AgentMessage 映射
- packages/shared/src/session.ts: AgentSession 接口、ProjectInfo、SessionInfo
- packages/shared/src/tools.ts: ToolApprovalRequest/Decision、AskUserRequest/Response
- packages/shared/src/constants.ts: PermissionMode、EffortLevel、ToolCategory
```

**验收**：server 和 web 都能 import shared 类型，tsc 编译通过

### Step 1.3 — Server: Fastify + WebSocket 基础

```
- index.ts: Fastify 创建、插件注册
- config.ts: 环境变量读取
- ws/registry.ts: 连接注册表
- ws/hub.ts: WSHub（register、join、broadcast、sendTo）
- ws/handler.ts: WS 消息路由骨架
- routes/health.ts: GET /api/health
```

**验收**：WS 连接能建立，收到 init，join-session 能加入，broadcast 能发给多客户端

### Step 1.4 — Server: LockManager

```
- ws/lock.ts: 完整实现
  - acquire / release
  - onDisconnect / onReconnect + 10s 宽限期
  - 状态查询
- 集成到 handler.ts: send-message 前 acquire，complete 后 release
- 广播 lock-status
```

**验收**：开两个 WS 客户端，A 发消息锁住后 B 无法发消息，A 完成后 B 恢复

### Step 1.5 — Server: AgentSession + V1QuerySession

```
- agent/session.ts: AgentSession 接口（从 shared import）
- agent/v1-session.ts: V1QuerySession 实现
  - send() → SDK query() + resume
  - for await 循环 → emit('message')
  - canUseTool → emit('tool-approval') / emit('ask-user')
  - abort() → interrupt + abortController
  - 状态管理: idle → running → awaiting_* → idle
  - resolveToolApproval / resolveAskUser
```

**验收**：调用 send("What files are here?") → 收到流式消息 → 最终 result success

### Step 1.6 — Server: SessionManager + REST API

```
- agent/manager.ts: SessionManager
  - listProjects()（SDK listSessions → 聚合）
  - listProjectSessions(cwd, { limit, offset })
  - getSessionMessages(id, { limit, offset })
  - getSessionInfo(id)
  - createSession / resumeSession / getActive
- routes/sessions.ts:
  - GET /api/projects
  - GET /api/sessions
  - GET /api/sessions/:id
  - GET /api/sessions/:id/messages
```

**验收**：REST API 返回电脑中所有项目和会话，消息分页正确

### Step 1.7 — Server: 完整 WS handler 集成

```
- handler.ts 完整实现：
  - join-session → Hub.join + 发 session-state
  - send-message → Lock.acquire → AgentSession.send → broadcast
  - tool-approval-response → resolveToolApproval → broadcast resolved
  - ask-user-response → resolveAskUser → broadcast resolved
  - abort → session.abort → Lock.release → broadcast
  - set-mode / set-effort → session.setPermissionMode
  - leave-session → Hub.leave
  - WS close → Lock.onDisconnect + Hub.unregister
```

**验收**：完整 WS 闭环可用

### Step 1.8 — Web: 项目/会话侧栏

```
- stores/sessionStore.ts
- hooks/useSessionList.ts
- components/sidebar/SessionList.tsx
- components/sidebar/ProjectGroup.tsx
- components/sidebar/SearchBox.tsx
- lib/api.ts: REST 客户端封装
```

**验收**：侧栏显示所有项目，点击展开会话列表，搜索可过滤

### Step 1.9 — Web: 聊天界面 + 消息渲染

```
- stores/messageStore.ts（含懒加载逻辑）
- stores/connectionStore.ts
- hooks/useWebSocket.ts
- hooks/useMessages.ts（IntersectionObserver 懒加载）
- lib/ws-client.ts
- components/chat/ChatInterface.tsx
- components/chat/ChatMessagesPane.tsx（懒加载滚动）
- components/chat/ChatComposer.tsx（输入 + Send/Stop）
- components/chat/MessageComponent.tsx（基础：text、user、thinking）
- components/chat/ThinkingIndicator.tsx
- components/layout/AppLayout.tsx
```

**验收**：可以发消息、看到流式回复、向上滚动加载历史

### Step 1.10 — Web: 多端同步验证

```
- 打开两个浏览器标签页
- 标签页 A 发消息，标签页 B 实时看到输入和输出
- 锁状态正确：A 锁定时 B 不可输入
- A 完成后 B 恢复可输入
- 断线重连：A 断线 → Agent 继续 → B 看到输出 → A 重连恢复
```

**验收**：P0 核心功能完整可用

---

## Phase 2 — 完整交互 (P1)

### Step 2.1 — 工具审批 UI

```
- components/chat/PermissionBanner.tsx
  - 可交互版（锁持有者）
  - 只读版（其他客户端）
  - 工具输入格式化展示（可折叠）
  - Allow / Always Allow / Deny 按钮
  - suggestions 渲染
- hooks/useToolApproval.ts
```

### Step 2.2 — AskUserQuestion UI

```
- components/tools/AskUserQuestionPanel.tsx
  - 问题文本 + 选项卡片
  - 单选 / 多选支持
  - "Other" 自由输入
  - 键盘快捷键 (1-9, Enter, Esc)
  - HTML preview 渲染（P2 中可延后）
```

### Step 2.3 — 模式和思考控制

```
- components/chat/StatusBar.tsx
  - 锁状态指示器
  - Mode 按钮
  - Effort 滑块
- components/chat/ModesPopup.tsx
  - default / acceptEdits / plan / bypassPermissions
- components/chat/ThinkingSelector.tsx
  - Standard / Think / Think Hard / Think Harder / Ultrathink
```

### Step 2.4 — 工具渲染器全套

```
- components/tools/ToolRenderer.tsx（分发）
- components/tools/OneLineDisplay.tsx（Bash、Read、Grep、Glob）
- components/tools/CollapsibleDisplay.tsx（复杂工具）
- components/tools/SubagentContainer.tsx（Agent 工具）
- components/tools/ToolDiffViewer.tsx（Edit、Write diff）
- MessageComponent.tsx 完善：所有 SDK 消息类型渲染
```

### Step 2.5 — 错误处理和边缘场景

```
- WS 断线自动重连（指数退避）
- API 错误 toast 通知
- Agent 错误结果展示（error_max_turns 等）
- rate_limit_event 处理
- api_retry 提示
```

---

## Phase 3 — 跨平台 (P2)

### Step 3.1 — Tauri 2.0 桌面端
### Step 3.2 — Tauri 2.0 Mobile
### Step 3.3 — Ink TUI
### Step 3.4 — Session fork / rename / tag UI
### Step 3.5 — File Checkpointing（rewindFiles）
### Step 3.6 — Streaming Input（中途追加消息）
### Step 3.7 — V2 Session API 迁移（当 V2 稳定后）
