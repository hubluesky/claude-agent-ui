# 04 — WebSocket 协议

## 连接

```
ws://localhost:3456/ws
```

连接建立后，服务端立即发送 `init` 消息。

---

## 客户端 → 服务端 (C2S)

### join-session — 加入会话

```typescript
{
  type: 'join-session'
  sessionId: string       // 要加入的会话 ID
}
```

**触发时机**：用户在侧栏点击某个会话
**服务端行为**：加入 WSHub 订阅，返回 session-state
**注意**：不加载历史消息，前端通过 REST API 懒加载

### send-message — 发送消息

```typescript
{
  type: 'send-message'
  sessionId: string       // 目标会话（可以是现有 ID 或 null 表示新建）
  prompt: string          // 用户输入
  options?: {
    cwd?: string          // 新建会话时必填
    images?: { data: string; mediaType: string }[]
    thinkingMode?: 'adaptive' | 'enabled' | 'disabled'
    effort?: 'low' | 'medium' | 'high' | 'max'
  }
}
```

**触发时机**：用户按 Send
**服务端行为**：获取锁 → 创建/恢复 AgentSession → send() → 流式广播
**失败条件**：会话被其他客户端锁定 → 返回 error

### tool-approval-response — 工具审批响应

```typescript
{
  type: 'tool-approval-response'
  requestId: string       // 匹配 tool-approval-request 的 requestId
  decision: {
    behavior: 'allow'
    updatedInput?: Record<string, unknown>
    updatedPermissions?: PermissionUpdate[]
  } | {
    behavior: 'deny'
    message: string
  }
}
```

**触发时机**：用户点击 Allow / Always Allow / Deny
**服务端行为**：resolve canUseTool Promise → Agent 继续
**约束**：只有锁持有者可以发送

### ask-user-response — 澄清问题响应

```typescript
{
  type: 'ask-user-response'
  requestId: string
  answers: Record<string, string>   // question text → selected label(s)
}
```

**触发时机**：用户在 AskUserQuestion 面板中选择选项
**多选**：多个 label 用 ", " 连接
**自由输入**：用户自定义文字直接作为 value
**约束**：只有锁持有者可以发送

### abort — 中止 Agent

```typescript
{
  type: 'abort'
  sessionId: string
}
```

**触发时机**：用户点击 Stop 按钮
**服务端行为**：agentSession.abort() → 释放锁 → 广播
**约束**：只有锁持有者可以发送

### set-mode — 切换权限模式

```typescript
{
  type: 'set-mode'
  sessionId: string
  mode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk'
}
```

**触发时机**：用户在 ModesPopup 中切换
**约束**：只有锁持有者可以发送（或会话 idle 时任何人可以）

### set-effort — 切换思考力度

```typescript
{
  type: 'set-effort'
  sessionId: string
  effort: 'low' | 'medium' | 'high' | 'max'
}
```

### reconnect — 断线重连关联

```typescript
{
  type: 'reconnect'
  previousConnectionId: string  // 断线前的 connectionId（前端存 localStorage）
}
```

**触发时机**：WS 重连成功后，init 消息之后立即发送
**服务端行为**：lockManager.onReconnect(previousConnectionId) → 取消宽限期，将锁持有者映射到新 connectionId
**前端实现**：localStorage 存 `claude-agent-ui-connection-id`，重连后发送

### leave-session — 离开会话

```typescript
{
  type: 'leave-session'
}
```

**触发时机**：用户切换到另一个会话或关闭页面

---

## 服务端 → 客户端 (S2C)

### init — 连接初始化

```typescript
{
  type: 'init'
  connectionId: string    // 分配给此连接的唯一 ID
}
```

**发送时机**：WS 连接建立后立即发送

### session-state — 会话状态快照

```typescript
{
  type: 'session-state'
  sessionId: string
  sessionStatus: 'idle' | 'running' | 'awaiting_approval' | 'awaiting_user_input'
  lockStatus: 'idle' | 'locked'
  lockHolderId?: string   // 锁持有者的 connectionId
  isLockHolder: boolean   // 当前连接是否是锁持有者
}
```

**发送时机**：客户端 join-session 后立即发送

### agent-message — Agent 消息流

```typescript
{
  type: 'agent-message'
  sessionId: string
  message: SDKMessage     // 直接转发 SDK 输出，所有消息类型
}
```

**发送时机**：query() for-await 循环中每个消息
**覆盖所有 SDK 消息类型**：assistant、stream_event、system（init/status/task_*）、tool_progress 等
**发送给**：该 session 的所有订阅客户端

### tool-approval-request — 工具审批请求

```typescript
{
  type: 'tool-approval-request'
  requestId: string
  toolName: string
  toolInput: Record<string, unknown>
  toolUseID: string
  title?: string              // "Claude wants to read foo.txt"
  displayName?: string        // "Read file"
  description?: string
  suggestions?: PermissionUpdate[]
  agentID?: string            // 子 Agent 时存在
  readonly: boolean           // true = 只读展示（非锁持有者），false = 可交互
}
```

**发送时机**：canUseTool 被调用（非 AskUserQuestion）
**锁持有者**：`readonly: false`，可以点击 Allow/Deny
**其他客户端**：`readonly: true`，只能看到请求内容

### tool-approval-resolved — 审批结果

```typescript
{
  type: 'tool-approval-resolved'
  requestId: string
  decision: { behavior: 'allow' | 'deny'; message?: string }
}
```

**发送时机**：锁持有者提交审批决策后
**发送给**：除锁持有者外的其他客户端（他们需要知道结果以更新 UI）

### ask-user-request — 澄清问题请求

```typescript
{
  type: 'ask-user-request'
  requestId: string
  questions: {
    question: string          // 完整问题文本
    header: string            // 短标签（最多 12 字符）
    options: {
      label: string           // 选项显示文本
      description: string     // 选项说明
      preview?: string        // HTML/Markdown 预览（toolConfig.askUserQuestion.previewFormat 设置时）
    }[]
    multiSelect: boolean      // true 允许多选
  }[]
  readonly: boolean           // 同 tool-approval-request
}
```

### ask-user-resolved — 问题回答结果

```typescript
{
  type: 'ask-user-resolved'
  requestId: string
  answers: Record<string, string>
}
```

### lock-status — 锁状态变更

```typescript
{
  type: 'lock-status'
  sessionId: string
  status: 'idle' | 'locked'
  holderId?: string           // locked 时存在
}
```

**发送时机**：锁获取、释放、宽限期超时

### session-state-change — 会话状态变更

```typescript
{
  type: 'session-state-change'
  sessionId: string
  state: 'idle' | 'running' | 'awaiting_approval' | 'awaiting_user_input'
}
```

**发送时机**：AgentSession 状态转换时

### session-complete — 会话完成

```typescript
{
  type: 'session-complete'
  sessionId: string
  result: {
    subtype: 'success' | 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd'
    result?: string           // success 时的文本结果
    errors?: string[]         // error 时的错误列表
    duration_ms: number
    total_cost_usd: number
    num_turns: number
    usage: { input_tokens: number; output_tokens: number }
  }
}
```

### session-aborted — 会话中止

```typescript
{
  type: 'session-aborted'
  sessionId: string
}
```

### error — 错误

```typescript
{
  type: 'error'
  message: string
  code?: 'session_locked' | 'session_not_found' | 'not_lock_holder' | 'internal'
}
```

---

## 消息流时序图

### 正常对话流

```
Client A (锁持有者)     Server              Client B (观看者)
────────────────────    ──────              ─────────────────
send-message ──────→
                        acquire lock
                        query({ prompt, resume })
                   ←──── lock-status(locked)  ──→ lock-status(locked)
                   ←──── agent-message(init)  ──→ agent-message(init)
                   ←──── agent-message(stream) ──→ agent-message(stream)
                   ←──── agent-message(stream) ──→ agent-message(stream)
                   ←──── agent-message(result) ──→ agent-message(result)
                   ←──── session-complete      ──→ session-complete
                   ←──── lock-status(idle)     ──→ lock-status(idle)
```

### 工具审批流

```
Client A (锁持有者)     Server              Client B (观看者)
────────────────────    ──────              ─────────────────
                   ←──── tool-approval-req     ──→ tool-approval-req
                         (readonly: false)          (readonly: true)
                         [Agent 暂停]
tool-approval-resp ──→
                         resolve canUseTool
                   ←──── tool-approval-resolved ─→ tool-approval-resolved
                         [Agent 继续]
                   ←──── agent-message(...)     ──→ agent-message(...)
```

### 中途中止流

```
Client A (锁持有者)     Server              Client B (观看者)
────────────────────    ──────              ─────────────────
abort ─────────────→
                        session.abort()
                        release lock
                   ←──── session-aborted       ──→ session-aborted
                   ←──── lock-status(idle)     ──→ lock-status(idle)
```

### 断线重连流

```
Client A (锁持有者)     Server              Client B (观看者)
────────────────────    ──────              ─────────────────
[断线]
                        lockManager.onDisconnect(A)
                        → 启动 10s 宽限期
                                                ─→ (无变化，Agent 继续运行)
[10s 内重连]
WS connect ────────→
                        lockManager.onReconnect(A)
                        → 取消宽限期
join-session ──────→
                   ←──── session-state(running, locked, isHolder: true)

--- 或 ---

[10s 超时未重连]
                        lockManager.release()
                        session.abort() (可选)
                                                ─→ lock-status(idle)
```
