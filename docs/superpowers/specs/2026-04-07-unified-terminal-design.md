# Unified Terminal UI — 双模式中控台设计文档（最终版）

## 概述

重构 claude-agent-ui 的 UI，支持用户在一个页面管理所有项目的所有会话。核心思想：**Single 就是只有 1 个面板的 Multi**，数据流完全统一。

### 核心原则

1. **一套代码，两种布局** — Single 和 Multi 渲染同一个 `ChatInterface` 组件，只是布局不同（全屏 vs 网格）
2. **每个面板完全自包含** — 自己的 WS 连接、自己的消息、自己的锁/审批状态，通过 `ChatSessionProvider` 提供
3. **组件不知道自己在哪种模式** — 只从 Context 读数据，不关心 Single 还是 Multi
4. **Provider 保持薄** — 复杂逻辑提取为可复用 hook（`useSessionMessages`、`useSessionConnection`），Provider 组合 hook
5. **侧边栏不变、服务端不变** — 改动全在客户端的数据流层

### 目标用户场景

开发者同时运行 8+ 个 Claude Code 会话（跨多个项目），需要：
- 一步找到哪个会话需要操作（审批/回复/报错）
- 快速切换上下文，不丢失其他会话进度
- 看到所有会话的整体状态和进度
- 审批/回复操作步骤最少化

---

## 架构：ChatSessionProvider

### 统一数据流

现有架构的问题：`messageStore`、`connectionStore`、`useWebSocket` 全是全局单例，只能服务一个会话。Multi 模式需要 N 个并行会话。

**重构方案**：将这三个全局单例的职责统一到 `ChatSessionProvider`（React Context），每个面板一个 Provider 实例。

### Provider 内部结构

Provider 不直接包含逻辑，而是**组合可复用 hook**：

```
ChatSessionProvider(sessionId)
  │
  ├── useSessionWebSocket(sessionId)
  │     WS 生命周期（connect / join / reconnect / disconnect）
  │     send() 发送消息
  │     onMessage 回调分发
  │
  ├── useSessionMessages(ws)
  │     messages 数组
  │     appendStreamDelta + RAF 节流
  │     flushStreamingDelta
  │     optimistic 替换
  │     assistant 消息合并
  │     loadInitial（REST API）
  │
  ├── useSessionConnection(ws)
  │     lockStatus / lockHolderId
  │     sessionStatus
  │     pendingApproval / pendingAskUser / pendingPlanApproval
  │     resolvedPlanApproval
  │     contextUsage / mcpServers / rewindPreview / subagentMessages
  │     respondToolApproval / respondAskUser / respondPlanApproval
  │     abort / claimLock / releaseLock
  │
  └── 写入 multiPanelStore（summary 状态供下拉菜单读）
```

每个 hook 可独立测试，Provider 文件保持 <100 行。

### Context 接口

```typescript
interface ChatSessionContextValue {
  // 连接
  sessionId: string
  connectionStatus: ConnectionStatus

  // 消息
  messages: AgentMessage[]
  isLoadingHistory: boolean

  // 会话状态
  sessionStatus: SessionStatus
  lockStatus: ClientLockStatus
  lockHolderId: string | null
  pendingApproval: (ToolApprovalRequest & { readonly: boolean }) | null
  pendingAskUser: (AskUserRequest & { readonly: boolean }) | null
  pendingPlanApproval: (PlanApprovalRequest & { readonly: boolean; contextUsagePercent?: number }) | null
  resolvedPlanApproval: ResolvedPlanApproval | null
  planModalOpen: boolean
  setPlanModalOpen(open: boolean): void
  contextUsage: ContextUsage | null
  mcpServers: McpServerInfo[]
  rewindPreview: RewindPreview | null
  subagentMessages: SubagentMessages | null

  // 操作
  send(prompt: string, options?: SendOptions): void
  respondToolApproval(requestId: string, decision: ToolApprovalDecision): void
  respondAskUser(requestId: string, answers: Record<string, string>): void
  respondPlanApproval(requestId: string, decision: PlanApprovalDecisionType, feedback?: string): void
  abort(): void
  claimLock(): void
  releaseLock(): void
  getContextUsage(): void
  getMcpStatus(): void
  toggleMcpServer(serverName: string, enabled: boolean): void
  reconnectMcpServer(serverName: string): void
  rewindFiles(messageId: string, dryRun?: boolean): void
  getSubagentMessages(agentId: string): void
  forkSession(atMessageId?: string): void
}
```

### 全局 store 保留的内容

Provider 管 per-session 状态。以下是**真正全局**的，保留在 store 中：

| Store | 保留内容 |
|-------|---------|
| `connectionStore` | models、accountInfo（登录账号信息、可用模型列表——不随 session 变） |
| `sessionStore` | 项目列表、会话列表、当前选中会话（导航用） |
| `settingsStore` | permissionMode、effort、theme、sidebarWidth、viewMode、returnToMulti |
| `commandStore` | 斜杠命令列表（全局共享） |
| `multiPanelStore` | 面板 sessionId 列表 + 各面板 summary 状态 |

Provider 的 WS 收到 `models`、`account-info`、`slash-commands` 消息时，写入全局 store（这些不是 per-session 的）。

### Single vs Multi：同一条路径

```tsx
// Single 模式：1 个 Provider，全屏
<ChatSessionProvider sessionId={currentSessionId}>
  <ChatInterface />
</ChatSessionProvider>

// Multi 模式：N 个 Provider，网格
{panels.map(p => (
  <ChatSessionProvider key={p.sessionId} sessionId={p.sessionId}>
    <ChatInterface compact />
  </ChatSessionProvider>
))}
```

`ChatInterface` 的 `compact` prop 只控制视觉：
- `compact=false`（默认）：Virtuoso 完整渲染、ChatComposer 完整 toolbar、完整 ApprovalPanel
- `compact=true`：限制消息数、隐藏 toolbar、精简审批按钮、跳过语法高亮

---

## 两种视图模式

### 模式一：Single — 1 个面板全屏

**侧边栏不变。** 唯一新增是 TopBar 的模式切换和后台状态菜单。

与现有功能的区别：数据流从全局 store 迁移到 `ChatSessionProvider`。但用户看到的界面和行为完全一样。

### 模式二：Multi — N 个面板网格

**侧边栏不变。** 主区域变为动态 N 面板网格，每个面板是一个 `<ChatSessionProvider>` + `<ChatInterface compact />`。

---

## TopBar 新增元素

### 模式切换按钮

`[ Single | Multi ]` 按钮组，当前模式 amber 高亮。

### 后台状态按钮 + 下拉菜单

**Single 模式下**：TopBar 带 badge 的按钮，点击展开右上角下拉菜单：
- 显示除当前会话以外的所有后台会话（数据来自 multiPanelStore）
- 按 Waiting → Running → Idle 排序
- 每条：状态点 + 标题 + 项目 + 消息 + 进度 + [+添加到面板] 或 [✓已在面板]
- 点击条目 → 切换到该会话
- badge = waiting + error 数量，无则不显示
- 再点按钮或点外面 → 关闭

**Multi 模式下**：按钮仍可用，显示未在面板中的其他会话。

### "← 返回 Multi" 按钮

从 Multi 展开面板 ↗ 进入 Single 时出现。Esc 或点击返回。

---

## 面板管理

### 面板来源

- Single 下拉菜单里点 **+** 添加
- Multi 里新建对话（最后一格的空面板入口）
- 当前 Single 聊天的会话自动在面板列表中（临时，不持久化）

### 面板列表持久化

`multiPanelStore` 存储 `panelSessionIds: string[]`，持久化到 localStorage。

### 面板布局

| 面板数 | 网格列数 |
|--------|----------|
| 1 | 1 |
| 2 | 2 |
| 3-4 | 2 |
| 5-6 | 3 |
| 7-9 | 3 |
| 10+ | 4（可滚动）|

每个面板最小 300×250px。

---

## 数据流

**服务端零改动。** 纯客户端架构：

```
ChatSessionProvider(sessionId)
  │
  ├─ mount → useSessionWebSocket 创建 WS → join session → loadInitial
  ├─ WS 收到消息 → useSessionMessages / useSessionConnection 更新内部 state
  ├─ 内部 state → 通过 Context 传给子组件
  ├─ 面板 summary (status/lastMessage/progress) → 写入 multiPanelStore
  ├─ 全局消息 (models/accountInfo/commands) → 写入全局 store
  │
  └─ 子组件通过 useChatSession() 读数据、调操作
```

### ChatInterface 的 compact prop

| 功能 | compact=false (Single) | compact=true (Multi) |
|------|----------------------|---------------------|
| 消息列表 | Virtuoso 全量 | Virtuoso limit=20 |
| 语法高亮 | 完整 rehype-highlight | 跳过 |
| Composer | 完整 toolbar（/、@、📎、modes） | 只有 input + send |
| ApprovalPanel | 完整（多选、反馈输入） | 精简（Allow/Deny） |
| StatusBar | 显示 | 精简或隐藏 |
| 面板 Header | 不显示 | 显示（状态+标题+↗+×） |

---

## 模式切换

### Single → Multi

所有面板 Provider **同时 mount**，各自创建 WS + 加载消息。Single 的 Provider unmount。

### Multi → Single

选中会话的 Provider 保持或新建。其他面板 Provider unmount。

### Multi ↗ 展开面板

**所有 Provider 保持存活（不 unmount）。** 非展开的面板用 CSS `display:none` 隐藏：
- WS 连接保持 → 持续收消息 → 状态保持最新
- 展开面板从 `compact=true` 变为 `compact=false`
- TopBar 显示 "← 返回 Multi"

### ← 返回 Multi

展开面板从 `compact=false` 变回 `compact=true`。隐藏面板恢复 `display:block`。**零 WS 重连，零 REST 加载，瞬间恢复。**

---

## 组件架构

### 新增

| 组件 | 位置 | 职责 |
|------|------|------|
| `ChatSessionProvider` | `providers/` | per-session Context：组合下面 3 个 hook |
| `useChatSession` | `providers/` | 从 Context 读数据的 hook |
| `useSessionWebSocket` | `hooks/` | per-session WS 连接生命周期 + send |
| `useSessionMessages` | `hooks/` | 消息数组 + 流式 + RAF + optimistic（从 messageStore 提取） |
| `useSessionConnection` | `hooks/` | lock/approval/status/contextUsage 等（从 connectionStore 提取） |
| `ViewModeToggle` | `components/layout/` | Single/Multi 按钮组 |
| `ReturnToMultiButton` | `components/layout/` | "← 返回 Multi" 按钮 |
| `BackgroundStatusButton` | `components/layout/` | TopBar 带 badge 按钮 |
| `BackgroundStatusDropdown` | `components/layout/` | 右上角下拉菜单 |
| `MultiPanelGrid` | `components/chat/` | N 面板网格容器 |
| `EmptyPanel` | `components/chat/` | 新建对话入口 |
| `multiPanelStore` | `stores/` | 面板列表 + summary 状态 |

### 重构

| 组件 | 变化 |
|------|------|
| `ChatInterface` | 新增 `compact` prop。从 `useChatSession()` 读数据 |
| `ChatMessagesPane` | 从 `useChatSession().messages` 读。新增 `limit` prop |
| `ChatComposer` | 从 `useChatSession()` 读/调。新增 `minimal` prop |
| `ApprovalPanel` | 从 `useChatSession()` 读。新增 `compact` prop |
| `ConnectionBanner` | 从 `useChatSession().connectionStatus` 读 |
| `StatusBar` | 从 `useChatSession()` 读 |
| `messageStore` | **逻辑提取到 `useSessionMessages` hook**。store 精简为可选缓存层 |
| `connectionStore` | **per-session 逻辑提取到 `useSessionConnection` hook**。store 只保留 models/accountInfo |
| `useWebSocket` | **逻辑提取到 `useSessionWebSocket` hook**。全局单例废弃 |
| `settingsStore` | 新增 viewMode、returnToMulti |
| `TopBar` | 集成新按钮组件 |

### 不变

| 组件 | 原因 |
|------|------|
| **整个 packages/server** | 服务端零改动 |
| **shared/protocol.ts** | 零改动 |
| `AppLayout` | 侧边栏不变 |
| `SessionList` / `ProjectCard` / `SessionCard` | 项目树不变 |
| `MessageComponent` | 只接收 props，不读 store（已是正确设计） |
| `MarkdownRenderer` | 纯展示组件 |

---

## 实现范围

### Phase 1：提取 hook + 创建 Provider（渐进式，不破坏现有功能）

**Step 1a：提取 hook，Provider 代理到全局 store**
1. 创建 `useSessionWebSocket(sessionId)` hook，提取自 `useWebSocket`
2. 创建 `useSessionMessages(ws)` hook，提取自 `messageStore`
3. 创建 `useSessionConnection(ws)` hook，提取自 `connectionStore`
4. 创建 `ChatSessionProvider` + `useChatSession`，内部调用这 3 个 hook
5. 同时，Provider **仍然写入全局 store**（兼容层），组件仍从全局 store 读
6. 在 Single 模式包裹 `<ChatSessionProvider>`，验证行为完全不变

**Step 1b：逐个组件切换数据源**
7. `ChatInterface` → `useChatSession()`
8. `ChatMessagesPane` → `useChatSession().messages`
9. `ChatComposer` → `useChatSession().send`
10. `ApprovalPanel` → `useChatSession()` 读 pending
11. `ConnectionBanner` → `useChatSession().connectionStatus`
12. `StatusBar` → `useChatSession()`
13. 每切一个组件，验证 Single 模式行为不变

**Step 1c：清理全局 store**
14. 移除 Provider 对全局 store 的写入（兼容层）
15. 精简 `messageStore`（移除 per-session 逻辑，保留可选缓存）
16. 精简 `connectionStore`（只保留 models/accountInfo）
17. 删除旧 `useWebSocket` 全局单例

### Phase 2：compact 模式

18. `ChatInterface` 新增 `compact` prop
19. `MessageComponent` compact 时跳过语法高亮
20. `ChatComposer` minimal 时隐藏 toolbar
21. `ApprovalPanel` compact 时精简
22. `ChatMessagesPane` limit prop

### Phase 3：Multi 模式 UI

23. `settingsStore` 新增 viewMode、returnToMulti
24. `multiPanelStore`
25. `ViewModeToggle` + `ReturnToMultiButton`
26. `MultiPanelGrid` + `EmptyPanel`
27. 面板 Header（状态+标题+↗+×）
28. ↗ 展开/返回：CSS display:none 保持所有 Provider 存活

### Phase 4：后台状态菜单

29. `BackgroundStatusButton` + `BackgroundStatusDropdown`
30. 面板状态写入 multiPanelStore → badge 更新

### Phase 5：打磨

31. 面板拖拽排序
32. 移动端适配（Multi 降级为 Single）
33. 键盘快捷键

---

## 不做的事情

- 不改侧边栏
- 不改服务端
- 不改 protocol.ts
- 不创建重复组件（MiniMessageList / MiniComposer 等）
- 不做自动弹出/关闭面板
- 不做看板/Dashboard
- 不做 Workspace 面板
- 不做声音/桌面通知
