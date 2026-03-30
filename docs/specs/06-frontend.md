# 06 — 前端设计

## 页面结构

```
┌──────────────────────────────────────────────────┐
│  AppLayout                                       │
│ ┌──────────┐ ┌──────────────────────────────────┐│
│ │ Sidebar   │ │ ChatInterface                    ││
│ │           │ │ ┌──────────────────────────────┐ ││
│ │ SearchBox │ │ │ ChatMessagesPane             │ ││
│ │           │ │ │ (懒加载滚动)                  │ ││
│ │ Project   │ │ │                              │ ││
│ │  Group 1  │ │ │ MessageComponent ...         │ ││
│ │   └ sess1 │ │ │                              │ ││
│ │   └ sess2 │ │ │ PermissionBanner (条件渲染)  │ ││
│ │  Group 2  │ │ │ AskUserPanel (条件渲染)      │ ││
│ │   └ sess3 │ │ │                              │ ││
│ │           │ │ │ ThinkingIndicator (加载时)    │ ││
│ │           │ │ └──────────────────────────────┘ ││
│ │           │ │ ┌──────────────────────────────┐ ││
│ │           │ │ │ StatusBar                    │ ││
│ │           │ │ │ (锁状态 · 模式 · Effort)     │ ││
│ │           │ │ └──────────────────────────────┘ ││
│ │           │ │ ┌──────────────────────────────┐ ││
│ │           │ │ │ ChatComposer                 │ ││
│ │           │ │ │ [输入框] [Send/Stop]          │ ││
│ │           │ │ └──────────────────────────────┘ ││
│ └──────────┘ └──────────────────────────────────┘│
└──────────────────────────────────────────────────┘
```

---

## 状态管理 (Zustand)

### sessionStore

```typescript
interface SessionStore {
  // 状态
  projects: ProjectInfo[]
  projectsLoading: boolean
  sessions: Map<string, SDKSessionInfo[]>  // cwd → sessions
  sessionsLoading: Map<string, boolean>
  currentSessionId: string | null
  currentProjectCwd: string | null
  searchQuery: string

  // 操作
  loadProjects(): Promise<void>
  loadProjectSessions(cwd: string): Promise<void>
  selectSession(sessionId: string, cwd: string): void
  createSession(cwd: string): void
  setSearchQuery(query: string): void
  renameSession(sessionId: string, title: string): Promise<void>
  tagSession(sessionId: string, tag: string | null): Promise<void>
}
```

### messageStore

```typescript
interface MessageStore {
  // 状态
  messages: SDKMessage[]          // 当前会话的消息（最新在后）
  totalCount: number | null       // 总消息数
  hasMore: boolean                // 是否有更早的消息
  isLoadingHistory: boolean       // 正在加载历史
  isLoadingMore: boolean          // 正在加载更多

  // 操作
  loadInitial(sessionId: string): Promise<void>    // 加载最新 50 条
  loadMore(): Promise<void>                         // 向上滚动加载更早的
  appendMessage(msg: SDKMessage): void              // 实时追加（WS 推送）
  appendStreamDelta(msg: SDKPartialAssistantMessage): void  // 流式增量
  clear(): void
}
```

**懒加载流程**：
```
1. 用户点击会话
   → sessionStore.selectSession(id)
   → messageStore.loadInitial(id)
   → GET /api/sessions/:id/messages?limit=50&offset=0
   → 渲染最新 50 条，滚动到底部

2. 用户向上滚动到顶部
   → IntersectionObserver 触发
   → messageStore.loadMore()
   → GET /api/sessions/:id/messages?limit=50&offset=50
   → 插入到消息列表顶部，保持滚动位置

3. Agent 运行中
   → WS agent-message 推送
   → messageStore.appendMessage(msg) 追加到底部
   → 自动滚动到底部（如果用户在底部附近）
```

### connectionStore

```typescript
interface ConnectionStore {
  // 状态
  connectionId: string | null
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
  lockStatus: 'idle' | 'locked_self' | 'locked_other'
  lockHolderId: string | null
  sessionStatus: 'idle' | 'running' | 'awaiting_approval' | 'awaiting_user_input'

  // 待处理审批
  pendingApproval: ToolApprovalRequest | null
  pendingAskUser: AskUserRequest | null

  // 操作
  connect(serverUrl: string): void
  disconnect(): void
  setLockStatus(status: LockStatus): void
  setSessionStatus(status: SessionStatus): void
  setPendingApproval(req: ToolApprovalRequest | null): void
  setPendingAskUser(req: AskUserRequest | null): void
}
```

### settingsStore

```typescript
interface SettingsStore {
  permissionMode: PermissionMode   // 默认 'default'
  effort: EffortLevel              // 默认 'high'
  thinkingMode: string             // 'adaptive' 等
  sidebarWidth: number
  theme: 'dark'                    // 暂时只有暗色

  setPermissionMode(mode: PermissionMode): void
  setEffort(effort: EffortLevel): void
  setThinkingMode(mode: string): void
  setSidebarWidth(width: number): void
  load(): Promise<void>            // 从 REST API 加载
  save(): Promise<void>            // 保存到 REST API
}
```

---

## Hooks

### useWebSocket

```typescript
function useWebSocket() {
  const connectionStore = useConnectionStore()
  const messageStore = useMessageStore()
  const sessionStore = useSessionStore()

  // WS 连接实例
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number>()

  // 连接
  function connect(serverUrl: string) {
    const ws = new WebSocket(`${serverUrl.replace('http', 'ws')}/ws`)

    ws.onopen = () => {
      connectionStore.setConnectionStatus('connected')
      // 如果有 currentSessionId，重新 join
      if (sessionStore.currentSessionId) {
        ws.send(JSON.stringify({ type: 'join-session', sessionId: sessionStore.currentSessionId }))
      }
    }

    ws.onmessage = (event) => {
      const msg: S2CMessage = JSON.parse(event.data)
      handleMessage(msg)
    }

    ws.onclose = () => {
      connectionStore.setConnectionStatus('reconnecting')
      // 自动重连（指数退避：1s, 2s, 4s, 8s, max 30s）
      scheduleReconnect()
    }
  }

  // 消息处理
  function handleMessage(msg: S2CMessage) {
    switch (msg.type) {
      case 'init':
        connectionStore.setConnectionId(msg.connectionId)
        break

      case 'session-state':
        connectionStore.setLockStatus(
          msg.lockStatus === 'idle' ? 'idle'
            : msg.isLockHolder ? 'locked_self'
            : 'locked_other'
        )
        connectionStore.setSessionStatus(msg.sessionStatus)
        break

      case 'agent-message':
        if (msg.message.type === 'stream_event') {
          messageStore.appendStreamDelta(msg.message)
        } else {
          messageStore.appendMessage(msg.message)
        }
        break

      case 'tool-approval-request':
        connectionStore.setPendingApproval(msg.readonly ? null : msg)
        // readonly 时也要渲染只读审批展示
        if (msg.readonly) {
          messageStore.appendMessage({
            type: 'tool-approval-display', ...msg
          })
        }
        break

      case 'tool-approval-resolved':
        connectionStore.setPendingApproval(null)
        break

      case 'ask-user-request':
        connectionStore.setPendingAskUser(msg.readonly ? null : msg)
        break

      case 'ask-user-resolved':
        connectionStore.setPendingAskUser(null)
        break

      case 'lock-status':
        connectionStore.setLockStatus(
          msg.status === 'idle' ? 'idle'
            : msg.holderId === connectionStore.connectionId ? 'locked_self'
            : 'locked_other'
        )
        break

      case 'session-state-change':
        connectionStore.setSessionStatus(msg.state)
        break

      case 'session-complete':
      case 'session-aborted':
        connectionStore.setSessionStatus('idle')
        connectionStore.setLockStatus('idle')
        connectionStore.setPendingApproval(null)
        connectionStore.setPendingAskUser(null)
        break

      case 'error':
        // toast 通知
        break
    }
  }

  // 发送方法
  function sendMessage(prompt: string, options?: SendOptions) {
    wsRef.current?.send(JSON.stringify({
      type: 'send-message',
      sessionId: sessionStore.currentSessionId,
      prompt,
      options,
    }))
  }

  function respondToolApproval(requestId: string, decision: ToolApprovalDecision) {
    wsRef.current?.send(JSON.stringify({
      type: 'tool-approval-response', requestId, decision
    }))
  }

  function respondAskUser(requestId: string, answers: Record<string, string>) {
    wsRef.current?.send(JSON.stringify({
      type: 'ask-user-response', requestId, answers
    }))
  }

  function abort() {
    wsRef.current?.send(JSON.stringify({
      type: 'abort', sessionId: sessionStore.currentSessionId
    }))
  }

  function joinSession(sessionId: string) {
    wsRef.current?.send(JSON.stringify({ type: 'join-session', sessionId }))
  }

  return { connect, sendMessage, respondToolApproval, respondAskUser, abort, joinSession }
}
```

### useMessages

```typescript
function useMessages(sessionId: string | null) {
  const messageStore = useMessageStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  // 首次加载
  useEffect(() => {
    if (sessionId) {
      messageStore.loadInitial(sessionId)
    } else {
      messageStore.clear()
    }
  }, [sessionId])

  // 向上滚动加载更多
  const topSentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!topSentinelRef.current) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && messageStore.hasMore && !messageStore.isLoadingMore) {
        const scrollContainer = scrollRef.current
        const prevScrollHeight = scrollContainer?.scrollHeight ?? 0
        messageStore.loadMore().then(() => {
          // 保持滚动位置
          if (scrollContainer) {
            const newScrollHeight = scrollContainer.scrollHeight
            scrollContainer.scrollTop = newScrollHeight - prevScrollHeight
          }
        })
      }
    })
    observer.observe(topSentinelRef.current)
    return () => observer.disconnect()
  }, [messageStore.hasMore])

  return { scrollRef, topSentinelRef, messages: messageStore.messages }
}
```

---

## 组件详细设计

### MessageComponent — SDK 消息到 UI 的映射

```
SDKMessage.type → UI 渲染策略
──────────────────────────────
'assistant'
  → message.content 逐块渲染：
    - text → Markdown 渲染（左对齐，Claude logo）
    - thinking → 可折叠 <details>（默认收起）
    - tool_use → ToolRenderer 分发
    - tool_result → ToolRenderer 结果区

'user' / 'user_replay'
  → 用户气泡（右对齐，琥珀色）
  → images[] → 图片网格

'stream_event'
  → content_block_delta:
    - text_delta → 追加到当前 text 块
    - thinking_delta → 追加到当前 thinking 块
    - input_json_delta → 追加到当前 tool_use 块
  → content_block_start → 新建块
  → content_block_stop → 标记块完成

'result'
  → success: 不单独渲染（最后一个 assistant message 已包含内容）
  → error_*: 红色错误框显示 errors[]

'system' subtype='init'
  → 不渲染（内部使用）

'system' subtype='status'
  → compacting 时显示 "正在压缩上下文..." 提示

'system' subtype='session_state_changed'
  → 更新 connectionStore（不渲染）

'system' subtype='task_started'
  → SubagentContainer 开始
'system' subtype='task_progress'
  → SubagentContainer 更新进度
'system' subtype='task_notification'
  → SubagentContainer 完成/失败

'system' subtype='api_retry'
  → 内联提示 "API 重试中 (attempt X/Y)..."

'tool_progress'
  → 工具进度条/计时器

'rate_limit_event'
  → toast 警告
```

### ToolRenderer — 工具分类渲染

```
toolName → 分类 → 渲染组件
────────────────────────────
Edit, Write, ApplyPatch   → 'edit'   → CollapsibleDisplay + DiffViewer
Grep, Glob                → 'search' → OneLineDisplay（文件列表）
Bash                      → 'bash'   → OneLineDisplay（命令 + 输出）
Read                      → 'read'   → OneLineDisplay（文件路径）
TodoWrite, TodoRead       → 'todo'   → OneLineDisplay
TaskCreate/Update/List/Get → 'task'  → CollapsibleDisplay
Agent                     → 'agent'  → SubagentContainer
AskUserQuestion           → 'question' → AskUserQuestionPanel
WebSearch, WebFetch       → 'web'    → CollapsibleDisplay
其他 / mcp__*             → 'default' → CollapsibleDisplay

颜色方案（左边框）：
  edit:   #d97706 (琥珀)
  search: #059669 (绿)
  bash:   #059669 (绿)
  read:   #6b7280 (灰)
  todo:   #8b5cf6 (紫)
  task:   #8b5cf6 (紫)
  agent:  #a855f7 (紫)
  question: #d97706 (琥珀)
  web:    #0ea5e9 (蓝)
  default: #6b7280 (灰)
```

### PermissionBanner — 工具审批 UI

```
触发条件：connectionStore.pendingApproval !== null

布局：
┌─────────────────────────────────────────┐
│ ⚠ Claude wants to [displayName]         │
│ [title]                                  │
│ ┌─────────────────────────────────────┐ │
│ │ Tool: [toolName]                     │ │
│ │ Input: [formatted toolInput]         │ │
│ │ (可折叠)                              │ │
│ └─────────────────────────────────────┘ │
│                                          │
│ [Allow] [Always Allow] [Deny]            │
│                                          │
│ suggestions 渲染为 "Grant [rule]" 按钮   │
└─────────────────────────────────────────┘

锁非持有者看到的 readonly 版本：
┌─────────────────────────────────────────┐
│ ⏳ Waiting for operator to respond...    │
│ [展示同样的工具信息，但无按钮]             │
└─────────────────────────────────────────┘

按钮行为：
- Allow → respondToolApproval(requestId, { behavior: 'allow', updatedInput: toolInput })
- Always Allow → respondToolApproval(requestId, {
    behavior: 'allow',
    updatedInput: toolInput,
    updatedPermissions: suggestions  // 使用 SDK 建议的规则
  })
- Deny → respondToolApproval(requestId, { behavior: 'deny', message: 'User denied' })
```

### ChatComposer — 输入区

```
状态依赖：
  lockStatus === 'locked_other' → 禁用输入，placeholder: "🔒 会话已被占用"
  lockStatus === 'locked_self' && sessionStatus === 'running' → 显示 Stop 按钮
  lockStatus === 'idle' → 正常输入

布局：
┌──────────────────────────────────────┐
│ [自动扩展 textarea]        [Send ▶]  │
│                             或       │
│                            [Stop ■]  │
└──────────────────────────────────────┘

Send 按钮：
  disabled: 无文本 || lockStatus === 'locked_other'
  点击 / Enter: sendMessage(prompt)
  Ctrl+Enter: 换行

Stop 按钮：
  显示条件: lockStatus === 'locked_self' && sessionStatus === 'running'
  点击: abort()
```

### StatusBar

```
布局：
┌──────────────────────────────────────┐
│ ● [状态文字]  │  ⚡ [Mode] │ [Effort]│
└──────────────────────────────────────┘

状态指示器：
  idle: 🟢 绿点 "空闲"
  running: 🟠 橙点 "运行中"
  awaiting_approval: 🟡 黄点 "等待审批"
  awaiting_user_input: 🟡 黄点 "等待输入"
  locked_other: 🔒 红锁 "已占用"

Mode 按钮：
  点击 → 弹出 ModesPopup
  禁用条件: lockStatus === 'locked_other'

Effort 显示：
  三点滑块 (low · medium · max)
```

---

## 暗色主题配色

```css
/* 旧项目配色方案延续 */
--bg-primary: #2b2a27;
--bg-secondary: #242320;
--bg-tertiary: #1e1d1a;
--border: #3d3b37;
--border-hover: #4a4743;
--text-primary: #e5e2db;
--text-secondary: #a8a29e;
--text-muted: #7c7872;
--accent: #d97706;        /* 琥珀/橙 */
--accent-hover: #b45309;
--error: #f87171;
--success: #a3e635;
--info: #0ea5e9;

/* 消息气泡 */
--user-bubble: rgba(217, 119, 6, 0.15);
--assistant-bg: transparent;

/* 工具左边框 */
--tool-edit: #d97706;
--tool-search: #059669;
--tool-bash: #059669;
--tool-task: #8b5cf6;
--tool-agent: #a855f7;
--tool-web: #0ea5e9;
--tool-default: #6b7280;
```
