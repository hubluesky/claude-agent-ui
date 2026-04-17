# Queue Input & ESC Cancel — 对齐 Claude Code 行为

## 问题

当前项目的队列输入和 ESC 取消交互与 Claude Code CLI 行为不一致：

1. **立即 forward**：运行中的消息通过 `session.send()` 立即转发给 CLI 进程，进入 CLI 内部队列后不可回收。Claude Code 是消息先在本地队列等待，turn 完成后才消费。
2. **ESC 行为**：ESC 直接 abort + 自动弹回非 forwarded 命令。Claude Code 的 ESC 是先 pop 队列（如有），再 abort（如无队列可 pop）。
3. **弹回合并**：弹回命令覆盖当前输入。Claude Code 是队列文本与当前输入用 `\n` 合并。

## 参考：Claude Code 源代码行为

### ESC 优先级链

来源：`PromptInput.tsx:1915-1961` + `useCancelRequest.ts:87-122`

```
ESC →
  1. 推测中 → 中止推测
  2. 侧边问题 → 关闭
  3. 帮助菜单 → 关闭
  4. 页脚选中 → 清除
  5. 队列有可编辑命令 → popAllCommandsFromQueue()
  6. 空输入 + 有消息 → 双击 ESC 行为
  7. (CancelRequestHandler) 运行中 → abort
  8. (CancelRequestHandler) 队列有命令 → pop
```

关键：**先 pop 队列，再 abort**。

### 队列消费流程

来源：`print.ts:2369-2404`, `useQueueProcessor.ts:28-68`, `queueProcessor.ts:52-87`

- 消息入本地 `commandQueue`（`enqueue()`，优先级 `next`）
- Query 循环在 tool call 间隙通过 `getCommandsByMaxPriority()` 消费
- Turn 完成后 `drainCommandQueue()` 循环消费剩余
- `useQueueProcessor` hook：`!isQueryActive && queue.length > 0` → `processQueueIfReady()`

### popAllEditable 合并逻辑

来源：`messageQueueManager.ts:428-484`

```typescript
const newInput = [...queuedTexts, currentInput].filter(Boolean).join('\n')
const cursorOffset = queuedTexts.join('\n').length + 1 + currentCursorOffset
```

队列文本在前，当前输入在后，`\n` 连接。

## 设计

### 核心改动：延迟 forward

**之前**：运行中用户消息 → 立即 `session.send()` → CLI 内部队列（不可回收）

**之后**：运行中用户消息 → 仅入服务器队列 → turn 完成后 dequeue → `session.send()` 执行

服务器队列是唯一数据源，所有命令在 forward 前都可被 ESC pop 回收。

### 改动清单

#### 1. 服务器 handler.ts — handleSendMessage

**当前代码** (行 544-581)：session busy 时立即 forward + 标记 `forwarded=true`

**改为**：session busy 时仅入队 + 广播用户消息（让所有客户端看到），**不调用 `session.send()`**，**不标记 `forwarded`**。

```typescript
if (sessionBusy && effectiveSessionId && !effectiveSessionId.startsWith('pending-')) {
  // 仅入队，不 forward
  const q = getOrCreateQueue(effectiveSessionId)
  q.enqueue(command)

  // 广播用户消息（所有客户端立即看到）
  wsHub.broadcast(effectiveSessionId, {
    type: 'agent-message',
    sessionId: effectiveSessionId,
    message: { type: 'user', uuid: command.id, message: { role: 'user', content: broadcastContent } },
  })
  return
}
```

#### 2. 服务器 handler.ts — session complete 回调

**当前代码** (行 444-454)：`clearForwarded()` → `processQueue()`

**改为**：直接 `processQueue()`。不再需要 `clearForwarded()`，因为没有 forwarded 命令了。

```typescript
setImmediate(() => {
  const q = sessionQueues.get(realSessionId)
  if (!q || q.isEmpty) return
  processQueue(q, {
    executeInput: (cmds) => executeCommands(connectionId, realSessionId, session, cmds),
    isSessionBusy: () => session.status !== 'idle',
  })
})
```

#### 3. 服务器 handler.ts — 新增 handlePopQueue

新增 C2S 消息 `pop-queue`，处理逻辑：

```typescript
async function handlePopQueue(connectionId: string, sessionId: string) {
  if (!lockManager.isHolder(sessionId, connectionId)) {
    wsHub.sendTo(connectionId, { type: 'error', message: 'Not lock holder', code: 'not_lock_holder' })
    return
  }

  const q = sessionQueues.get(sessionId)
  const editableCommands = q?.popAllEditable() ?? []
  if (editableCommands.length === 0) return

  // 发送弹出的命令给请求者
  wsHub.sendTo(connectionId, {
    type: 'queue-popped',
    sessionId,
    commands: editableCommands.map(cmd => ({
      id: cmd.id, value: cmd.value, mode: cmd.mode,
      priority: cmd.priority, editable: cmd.editable, addedAt: cmd.addedAt, images: cmd.images,
    })),
  })
  // queue-updated 会通过 queue 的 changed 事件自动广播
}
```

注意：这里用 `popAllEditable()` 而不是 `popAllNonForwardedEditable()`，因为延迟 forward 后不再有 forwarded 命令。

#### 4. 服务器 handler.ts — 修改 handleAbort

移除 pop 逻辑，纯 abort：

```typescript
async function handleAbort(connectionId: string, sessionId: string) {
  if (!lockManager.isHolder(sessionId, connectionId)) {
    wsHub.sendTo(connectionId, { type: 'error', message: 'Not lock holder', code: 'not_lock_holder' })
    return
  }

  const session = sessionManager.getActive(sessionId)
  if (session) await session.abort()

  wsHub.broadcast(sessionId, { type: 'session-aborted', sessionId })
}
```

不再弹出命令，不再 `clearForwarded()`。abort 就是纯粹的中止运行。

#### 5. shared/protocol.ts — 新增消息类型

```typescript
// C2S
interface C2S_PopQueue {
  type: 'pop-queue'
  sessionId: string
}

// S2C
interface S2C_QueuePopped {
  type: 'queue-popped'
  sessionId: string
  commands: QueueItemWire[]
}
```

#### 6. 前端 ChatInterface.tsx — ESC 处理

改为两阶段 ESC：

```typescript
const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return
  if (ctx.planModalOpen) return
  if (searchOpen || helpOpen) return

  const tag = (document.activeElement as HTMLElement)?.tagName
  if (tag === 'INPUT') return

  // 阶段 1：队列有可编辑命令 → pop（不 abort）
  const queue = ctx.queue ?? []
  const hasEditable = queue.some(item => item.editable)
  if (hasEditable) {
    e.preventDefault()
    ctx.popQueue()  // 新方法
    return
  }

  // 阶段 2：运行中 → abort（无队列可 pop）
  if (ctx.sessionStatus === 'running') {
    e.preventDefault()
    ctx.abort()
  }
}
```

#### 7. 前端 WebSocketManager.ts

**新增方法**：

```typescript
popQueue(sessionId: string): void {
  this.send({ type: 'pop-queue', sessionId })
}
```

**新增处理器**：

```typescript
private handleQueuePopped(msg: S2C_QueuePopped): void {
  const { sessionId, commands } = msg
  store().setPoppedCommands(sessionId, commands)
}
```

**修改 handleSessionAborted**：移除 popBackCommands 逻辑。

```typescript
private handleSessionAborted(msg: any): void {
  const sessionId = msg.sessionId
  store().setSessionStatus(sessionId, 'idle')
  store().setApproval(sessionId, null)
  store().setAskUser(sessionId, null)
  store().setPlanApproval(sessionId, null)
  store().setPlanModalOpen(sessionId, false)
  store().setQueue(sessionId, [])
  store().clearStreaming(sessionId)
}
```

#### 8. 前端 sessionContainerStore.ts

重命名 `popBackCommands` → `poppedCommands`（语义更清晰），触发源从 `session-aborted` 改为 `queue-popped`。

#### 9. 前端 ChatComposer.tsx — 合并逻辑

监听 `poppedCommands`，合并方式对齐 Claude Code：

```typescript
useEffect(() => {
  const popped = container?.poppedCommands
  if (!popped || popped.length === 0) return

  const poppedTexts = popped.map(cmd => cmd.value)
  const merged = [...poppedTexts, text].filter(Boolean).join('\n')
  setText(merged)

  // 清除 poppedCommands
  store.setPoppedCommands(sessionId, null)
}, [container?.poppedCommands])
```

### 可移除的代码

延迟 forward 后，以下概念不再需要：

| 概念 | 位置 | 原因 |
|------|------|------|
| `forwarded` 标志 | `QueuedCommand.forwarded` | 不再有 forwarded 命令 |
| `popAllNonForwardedEditable()` | `MessageQueueManager` | 改用 `popAllEditable()`（所有命令都未 forward） |
| `clearForwarded()` | `MessageQueueManager` | 无 forwarded 命令需清理 |
| `session-aborted.queuedCommands` | handler.ts → WebSocketManager | abort 不再携带弹回命令 |
| `popBackCommands` | sessionContainerStore | 重命名为 `poppedCommands`，触发源改变 |

### 多端同步行为

| 事件 | Lock holder | 其他客户端 |
|------|------------|-----------|
| 发送消息（running 时） | 入队 + 看到用户消息 | 看到用户消息 + queue-updated |
| ESC pop queue | 收到 queue-popped → 合并到输入框 | queue-updated（队列减少） |
| ESC abort | 收到 session-aborted | 收到 session-aborted |
| Turn 完成 | 队列自动 dequeue → 执行下一条 | 看到新 turn 开始 |

### 交互时序

```
场景 1：发消息 → 等待完成 → 自动执行
  用户发消息 (running) → 服务器入队 → 广播 user-message + queue-updated
  AI turn 完成 → 服务器 dequeue → session.send() → 新 turn 开始

场景 2：发消息 → ESC pop → 编辑 → 重新发送
  用户发消息 (running) → 服务器入队
  用户按 ESC → pop-queue → 服务器 popAllEditable() → queue-popped
  客户端合并到输入框 → 用户编辑 → 重新发送

场景 3：无队列 → ESC abort
  用户按 ESC (running, 队列空) → abort → session.abort() → session-aborted

场景 4：发消息 → ESC pop → ESC abort
  用户发消息 → 入队
  第一下 ESC → pop 队列 → 命令回到输入框
  第二下 ESC → abort (队列已空)
```
