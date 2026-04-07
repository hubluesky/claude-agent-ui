# Unified Terminal UI — 双模式中控台设计文档（最终版）

## 概述

重构 claude-agent-ui 的 UI，支持用户在一个页面管理所有项目的所有会话。核心思想：**Single 就是只有 1 个面板的 Multi**，数据流完全统一。

### 核心原则

1. **一套代码，两种布局** — Single 和 Multi 渲染同一个 `ChatInterface` 组件，只是布局不同（全屏 vs 网格）
2. **每个面板完全自包含** — 自己的 WS 连接、自己的消息、自己的锁/审批状态，通过 `ChatSessionProvider` 提供
3. **组件不知道自己在哪种模式** — 只从 Context 读数据，不关心 Single 还是 Multi
4. **侧边栏不变、服务端不变** — 改动全在客户端的数据流层

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

```
ChatSessionProvider(sessionId)
  ├── WS 连接（connect → join → 收消息）
  ├── messages 状态（追加、流式、替换）
  ├── connection 状态（lockStatus、pendingApproval、sessionStatus...）
  └── actions（send、respondApproval、abort、claimLock...）
```

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
  pendingApproval: ToolApprovalRequest | null
  pendingAskUser: AskUserRequest | null
  pendingPlanApproval: PlanApprovalRequest | null
  
  // 操作
  send(prompt: string, options?: SendOptions): void
  respondToolApproval(requestId: string, decision: ToolApprovalDecision): void
  respondAskUser(requestId: string, answers: Record<string, string>): void
  respondPlanApproval(requestId: string, decision: PlanApprovalDecisionType, feedback?: string): void
  abort(): void
  claimLock(): void
  releaseLock(): void
}
```

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
  ├─ mount → 创建 WebSocket → join session
  ├─ WS 收到消息 → 更新 Provider 内部 state
  ├─ Provider state → 通过 Context 传给子组件
  ├─ 面板状态 (status/lastMessage/progress) → 写入 multiPanelStore
  ├─ unmount → WebSocket disconnect
  │
  └─ 子组件通过 useChatSession() 读数据、调操作
```

### 全局 store 变化

| Store | 变化 |
|-------|------|
| `messageStore` | **废弃大部分逻辑**。消息状态移入 ChatSessionProvider。仅保留消息缓存（可选优化） |
| `connectionStore` | **废弃 per-session 状态**。lockStatus/pendingApproval 等移入 Provider。保留 connectionId、models、accountInfo 等真正全局的状态 |
| `useWebSocket` | **重构为 per-provider 实例**。不再是全局单例。每个 Provider 创建自己的 WS |
| `sessionStore` | 不变 |
| `settingsStore` | 新增 viewMode、returnToMulti |
| `multiPanelStore` | 新建。面板列表 + 各面板的 summary 状态（供下拉菜单显示） |

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

1. 当前 ChatSessionProvider unmount → WS 断开
2. 渲染 MultiPanelGrid → 每个面板 mount 各自的 ChatSessionProvider → 各自 WS 连接
3. 消息通过 REST API loadInitial 加载

### Multi → Single

1. 各面板 ChatSessionProvider unmount → WS 断开
2. 渲染单个 ChatSessionProvider → WS 连接当前选中会话
3. 消息通过 REST API loadInitial 加载

### Multi ↗ 展开面板

1. 该面板 Provider 保持（不 unmount，避免 WS 断开重连）
2. 其他面板 unmount
3. 展开的面板切换为 `compact=false` 全屏渲染
4. TopBar 显示 "← 返回 Multi"

### ← 返回 Multi

1. 全屏面板切换为 `compact=true`
2. 其他面板重新 mount（各自新建 WS）

---

## 组件架构

### 新增

| 组件 | 位置 | 职责 |
|------|------|------|
| `ChatSessionProvider` | `providers/` | per-session Context：WS + 消息 + 连接状态 + 操作 |
| `useChatSession` | `providers/` | 从 Context 读数据的 hook |
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
| `ChatInterface` | 新增 `compact` prop。内部从 `useChatSession()` 读数据替代直接读全局 store |
| `ChatMessagesPane` | 从 `useChatSession().messages` 读数据。新增 `limit` prop |
| `ChatComposer` | 从 `useChatSession().send` 调发送。新增 `minimal` prop 隐藏 toolbar |
| `ApprovalPanel` | 从 `useChatSession()` 读 pending 状态。新增 `compact` prop |
| `ConnectionBanner` | 从 `useChatSession().connectionStatus` 读 |
| `StatusBar` | 从 `useChatSession()` 读 |
| `useWebSocket` | 不再是全局单例。逻辑拆入 ChatSessionProvider 内部 |
| `messageStore` | 精简：移除 per-session 消息逻辑，保留可选缓存 |
| `connectionStore` | 精简：移除 per-session 状态（lock/approval），保留全局状态（connectionId/models/accountInfo） |
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

### Phase 1：ChatSessionProvider（核心重构）

1. 创建 `ChatSessionProvider` + `useChatSession` + Context 接口定义
2. 将 `useWebSocket` 的连接/消息处理逻辑迁入 Provider
3. 将 `messageStore` 的消息状态迁入 Provider
4. 将 `connectionStore` 的 per-session 状态迁入 Provider
5. `ChatInterface` 改为从 `useChatSession()` 读数据
6. `ChatMessagesPane` / `ChatComposer` / `ApprovalPanel` / `ConnectionBanner` / `StatusBar` 改为从 `useChatSession()` 读数据
7. Single 模式包裹 `<ChatSessionProvider>`，验证行为与重构前完全一致

### Phase 2：compact 模式

8. `ChatInterface` 新增 `compact` prop
9. `MessageComponent` compact 时跳过语法高亮
10. `ChatComposer` minimal 时隐藏 toolbar
11. `ApprovalPanel` compact 时精简
12. `ChatMessagesPane` limit prop

### Phase 3：Multi 模式 UI

13. `settingsStore` 新增 viewMode、returnToMulti
14. `multiPanelStore`
15. `ViewModeToggle` + `ReturnToMultiButton`
16. `MultiPanelGrid` + `EmptyPanel`
17. 面板 Header（状态+标题+↗+×）

### Phase 4：后台状态菜单

18. `BackgroundStatusButton` + `BackgroundStatusDropdown`
19. 面板状态写入 multiPanelStore → badge 更新

### Phase 5：打磨

20. 模式切换 WS 连接优化（↗ 展开时保持 Provider 不 unmount）
21. 面板拖拽排序
22. 移动端适配
23. 键盘快捷键

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
