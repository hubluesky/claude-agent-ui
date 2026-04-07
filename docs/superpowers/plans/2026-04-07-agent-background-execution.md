# Agent 后台执行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent 在服务端后台持续运行，不依赖客户端在线；客户端断开期间的消息缓冲后重连补发；审批响应不再绑定锁持有者。

**Architecture:** WSHub 新增 session 级消息缓冲区和应用层心跳；handler 移除审批响应的锁检查；客户端增加心跳响应、visibilitychange 检测和 lastSeq 追踪。

**Tech Stack:** TypeScript, WebSocket, Zustand

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/shared/src/protocol.ts` | Modify | 新增 ping/pong/stream-snapshot 消息类型，join-session 增加 lastSeq |
| `packages/server/src/ws/hub.ts` | Modify | 新增消息缓冲区、心跳定时器、缓冲广播方法 |
| `packages/server/src/ws/handler.ts` | Modify | 移除审批锁检查、集成缓冲广播、心跳消息处理 |
| `packages/web/src/hooks/useWebSocket.ts` | Modify | 心跳响应、visibilitychange、lastSeq 追踪 |
| `packages/web/src/stores/connectionStore.ts` | Modify | 新增 lastSeq 状态 |

---

### Task 1: Protocol 类型扩展

**Files:**
- Modify: `packages/shared/src/protocol.ts`

- [ ] **Step 1: 添加 ping/pong 和 stream-snapshot 类型**

在 `protocol.ts` 的 S2C 区域末尾（`S2C_Error` 之前）添加：

```typescript
// ---- Heartbeat ----

export interface S2C_Ping {
  type: 'ping'
}

// ---- Stream Snapshot (for reconnection) ----

export interface S2C_StreamSnapshot {
  type: 'stream-snapshot'
  sessionId: string
  messageId: string
  blocks: { index: number; type: 'text' | 'thinking'; content: string }[]
}
```

在 C2S 区域（`C2S_GetSubagentMessages` 之后）添加：

```typescript
// ---- Heartbeat ----

export interface C2S_Pong {
  type: 'pong'
}
```

- [ ] **Step 2: 修改 C2S_JoinSession 增加 lastSeq**

```typescript
export interface C2S_JoinSession {
  type: 'join-session'
  sessionId: string
  lastSeq?: number  // 客户端已收到的最大序号，用于断线补发
}
```

- [ ] **Step 3: 更新 union 类型**

在 `C2SMessage` union 中添加 `C2S_Pong`：

```typescript
export type C2SMessage =
  | C2S_JoinSession
  | C2S_SendMessage
  // ... existing ...
  | C2S_GetSubagentMessages
  | C2S_Pong
```

在 `S2CMessage` union 中添加 `S2C_Ping` 和 `S2C_StreamSnapshot`：

```typescript
export type S2CMessage =
  | S2C_Init
  // ... existing ...
  | S2C_SubagentMessages
  | S2C_Ping
  | S2C_StreamSnapshot
  | S2C_Error
```

- [ ] **Step 4: 构建 shared 包验证类型正确**

Run: `pnpm --filter @claude-agent-ui/shared build`
Expected: 编译成功

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/protocol.ts
git commit -m "feat: add ping/pong, stream-snapshot protocol types and lastSeq to join-session"
```

---

### Task 2: WSHub 消息缓冲 + 心跳

**Files:**
- Modify: `packages/server/src/ws/hub.ts`

- [ ] **Step 1: 添加缓冲区类型和常量**

在文件顶部 `ClientInfo` 接口之后添加：

```typescript
const MAX_BUFFER_SIZE = 500
const BUFFER_TTL_MS = 30 * 60 * 1000  // 30 minutes
const HEARTBEAT_INTERVAL_MS = 30_000   // 30 seconds
const HEARTBEAT_TIMEOUT_MS = 60_000    // 60 seconds — terminate if no pong

interface BufferedMessage {
  seq: number
  message: S2CMessage
  timestamp: number
}

interface StreamBlock {
  type: 'text' | 'thinking'
  content: string
}

interface SessionBuffer {
  messages: BufferedMessage[]
  nextSeq: number
  /** Accumulated stream content per block index, cleared on assistant final message */
  activeStream: Map<number, StreamBlock> | null
  activeStreamMessageId: string | null
}
```

- [ ] **Step 2: 扩展 ClientInfo 添加心跳状态**

修改 `ClientInfo` 接口：

```typescript
export interface ClientInfo {
  ws: WebSocket
  connectionId: string
  sessionId: string | null
  joinedAt: number
  alive: boolean            // heartbeat: set false before ping, true on pong
  lastPongAt: number        // timestamp of last pong received
}
```

更新 `register` 方法中的初始化：

```typescript
register(ws: WebSocket): string {
  const connectionId = randomUUID()
  this.clients.set(connectionId, {
    ws,
    connectionId,
    sessionId: null,
    joinedAt: Date.now(),
    alive: true,
    lastPongAt: Date.now(),
  })
  return connectionId
}
```

- [ ] **Step 3: 添加缓冲区 Map 和心跳定时器**

在 `WSHub` 类中添加私有字段：

```typescript
export class WSHub {
  private clients = new Map<string, ClientInfo>()
  private sessionSubscribers = new Map<string, Set<string>>()
  private sessionBuffers = new Map<string, SessionBuffer>()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private onDeadConnection: ((connectionId: string) => void) | null = null
```

- [ ] **Step 4: 添加缓冲相关方法**

在 `WSHub` 类末尾（`replaceWs` 之后）添加：

```typescript
  /** Set callback for when heartbeat detects a dead connection */
  setOnDeadConnection(cb: (connectionId: string) => void): void {
    this.onDeadConnection = cb
  }

  /** Record a pong from a client */
  recordPong(connectionId: string): void {
    const client = this.clients.get(connectionId)
    if (client) {
      client.alive = true
      client.lastPongAt = Date.now()
    }
  }

  /** Get or create a session buffer */
  private getOrCreateBuffer(sessionId: string): SessionBuffer {
    let buf = this.sessionBuffers.get(sessionId)
    if (!buf) {
      buf = { messages: [], nextSeq: 1, activeStream: null, activeStreamMessageId: null }
      this.sessionBuffers.set(sessionId, buf)
    }
    return buf
  }

  /** Buffer a message for a session and return the assigned seq */
  private bufferMessage(sessionId: string, msg: S2CMessage): number {
    const buf = this.getOrCreateBuffer(sessionId)
    const seq = buf.nextSeq++
    buf.messages.push({ seq, message: msg, timestamp: Date.now() })
    // Evict oldest if over limit
    while (buf.messages.length > MAX_BUFFER_SIZE) {
      buf.messages.shift()
    }
    return seq
  }

  /** Update the active stream snapshot for a session */
  updateStreamSnapshot(sessionId: string, messageId: string, blockIndex: number, blockType: 'text' | 'thinking', delta: string): void {
    const buf = this.getOrCreateBuffer(sessionId)
    if (!buf.activeStream || buf.activeStreamMessageId !== messageId) {
      buf.activeStream = new Map()
      buf.activeStreamMessageId = messageId
    }
    const existing = buf.activeStream.get(blockIndex)
    if (existing) {
      existing.content += delta
    } else {
      buf.activeStream.set(blockIndex, { type: blockType, content: delta })
    }
  }

  /** Clear active stream snapshot (call when assistant final message arrives) */
  clearStreamSnapshot(sessionId: string): void {
    const buf = this.sessionBuffers.get(sessionId)
    if (buf) {
      buf.activeStream = null
      buf.activeStreamMessageId = null
    }
  }

  /** Get the current stream snapshot for reconnection */
  getStreamSnapshot(sessionId: string): { messageId: string; blocks: { index: number; type: 'text' | 'thinking'; content: string }[] } | null {
    const buf = this.sessionBuffers.get(sessionId)
    if (!buf?.activeStream || !buf.activeStreamMessageId) return null
    const blocks: { index: number; type: 'text' | 'thinking'; content: string }[] = []
    for (const [index, block] of buf.activeStream) {
      blocks.push({ index, type: block.type, content: block.content })
    }
    return { messageId: buf.activeStreamMessageId, blocks }
  }

  /** Get buffered messages after a given seq for replay */
  getBufferedAfter(sessionId: string, afterSeq?: number): BufferedMessage[] {
    const buf = this.sessionBuffers.get(sessionId)
    if (!buf) return []
    // Evict expired messages
    const now = Date.now()
    buf.messages = buf.messages.filter(m => now - m.timestamp < BUFFER_TTL_MS)
    if (afterSeq == null) return [...buf.messages]
    return buf.messages.filter(m => m.seq > afterSeq)
  }

  /** Get the latest seq number for a session */
  getLatestSeq(sessionId: string): number {
    const buf = this.sessionBuffers.get(sessionId)
    if (!buf || buf.messages.length === 0) return 0
    return buf.messages[buf.messages.length - 1].seq
  }

  /** Clean up buffer when session is destroyed */
  clearBuffer(sessionId: string): void {
    this.sessionBuffers.delete(sessionId)
  }
```

- [ ] **Step 5: 修改 broadcast 方法增加缓冲**

将现有 `broadcast` 方法替换为带缓冲的版本。同时添加一个不缓冲的 `broadcastRaw` 用于心跳等无需缓冲的消息：

```typescript
  /** Broadcast to all session subscribers AND buffer the message. Returns assigned seq. */
  broadcast(sessionId: string, msg: S2CMessage): number {
    const seq = this.bufferMessage(sessionId, msg)
    const envelope = JSON.stringify(msg)
    const subs = this.sessionSubscribers.get(sessionId)
    if (subs) {
      for (const connId of subs) {
        const client = this.clients.get(connId)
        if (client?.ws.readyState === WebSocket.OPEN) {
          client.ws.send(envelope)
        }
      }
    }
    return seq
  }

  /** Broadcast without buffering (for ephemeral messages like ping) */
  broadcastRaw(sessionId: string, msg: S2CMessage): void {
    const data = JSON.stringify(msg)
    const subs = this.sessionSubscribers.get(sessionId)
    if (!subs) return
    for (const connId of subs) {
      const client = this.clients.get(connId)
      if (client?.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data)
      }
    }
  }
```

同样修改 `broadcastExcept` 增加缓冲：

```typescript
  broadcastExcept(sessionId: string, excludeConnectionId: string, msg: S2CMessage): number {
    const seq = this.bufferMessage(sessionId, msg)
    const data = JSON.stringify(msg)
    const subs = this.sessionSubscribers.get(sessionId)
    if (subs) {
      for (const connId of subs) {
        if (connId === excludeConnectionId) continue
        const client = this.clients.get(connId)
        if (client?.ws.readyState === WebSocket.OPEN) {
          client.ws.send(data)
        }
      }
    }
    return seq
  }
```

- [ ] **Step 6: 添加心跳方法**

```typescript
  /** Start the heartbeat interval. Call once on server start. */
  startHeartbeat(): void {
    if (this.heartbeatTimer) return
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now()
      for (const [id, client] of this.clients) {
        // Check if client missed the last heartbeat
        if (!client.alive && now - client.lastPongAt > HEARTBEAT_TIMEOUT_MS) {
          client.ws.terminate()
          this.onDeadConnection?.(id)
          this.unregister(id)
          continue
        }
        client.alive = false
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify({ type: 'ping' }))
        }
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  /** Stop heartbeat (for graceful shutdown) */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }
```

- [ ] **Step 7: 构建验证**

Run: `pnpm --filter @claude-agent-ui/server build`
Expected: 编译成功（注意：broadcast 返回值从 void 变为 number，需要在下一个 Task 中更新调用方）

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/ws/hub.ts
git commit -m "feat: add message buffer, stream snapshot, and heartbeat to WSHub"
```

---

### Task 3: Handler — 解耦审批与锁 + 缓冲集成

**Files:**
- Modify: `packages/server/src/ws/handler.ts`

- [ ] **Step 1: 移除 handleToolApprovalResponse 中的锁检查**

将 `handleToolApprovalResponse` 函数中的锁检查移除（handler.ts 第 458-480 行）：

```typescript
  function handleToolApprovalResponse(connectionId: string, requestId: string, decision: ToolApprovalDecision) {
    const entry = pendingRequestMap.get(requestId)
    if (!entry) return

    // No lock check — any connected client can respond to approval requests.
    // Lock controls who can send new messages, not who can respond to pending approvals.

    const session = sessionManager.getActive(entry.sessionId)
    if (!session) return

    session.resolveToolApproval(requestId, decision)
    lockManager.resetIdleTimer(entry.sessionId)
    pendingRequestMap.delete(requestId)

    // Broadcast to ALL clients (including sender) so everyone clears pendingApproval
    wsHub.broadcast(entry.sessionId, {
      type: 'tool-approval-resolved',
      requestId,
      decision: { behavior: decision.behavior, message: decision.behavior === 'deny' ? decision.message : undefined },
    })
  }
```

- [ ] **Step 2: 移除 handleAskUserResponse 中的锁检查**

将 `handleAskUserResponse` 函数中的锁检查移除（handler.ts 第 482-504 行）：

```typescript
  function handleAskUserResponse(connectionId: string, requestId: string, answers: Record<string, string>) {
    const entry = pendingRequestMap.get(requestId)
    if (!entry) return

    const session = sessionManager.getActive(entry.sessionId)
    if (!session) return

    session.resolveAskUser(requestId, { answers })
    lockManager.resetIdleTimer(entry.sessionId)
    pendingRequestMap.delete(requestId)

    wsHub.broadcast(entry.sessionId, {
      type: 'ask-user-resolved',
      requestId,
      answers,
    })
  }
```

- [ ] **Step 3: 移除 handleResolvePlanApproval 中的锁检查**

在 `handleResolvePlanApproval` 函数中（handler.ts 第 506-561 行），移除锁检查部分（第 516-518 行的 3 行 if 块）：

删除这3行：
```typescript
    if (!lockManager.isHolder(entry.sessionId, connectionId)) {
      wsHub.sendTo(connectionId, { type: 'error', message: 'Not lock holder', code: 'not_lock_holder' })
      return
    }
```

- [ ] **Step 4: 修改 handleJoinSession 接收 lastSeq 并补发缓冲消息**

更新 `handleMessage` 中的 join-session 分支（handler.ts 第 76-78 行）：

```typescript
      case 'join-session':
        handleJoinSession(connectionId, msg.sessionId, (msg as any).lastSeq)
        break
```

更新 `handleJoinSession` 函数签名和内容（handler.ts 第 157-191 行）：

```typescript
  function handleJoinSession(connectionId: string, sessionId: string, lastSeq?: number) {
    wsHub.joinSession(connectionId, sessionId)
    const lockHolder = lockManager.getHolder(sessionId)
    const activeSession = sessionManager.getActive(sessionId)
    const isLockHolder = lockHolder === connectionId
    wsHub.sendTo(connectionId, {
      type: 'session-state',
      sessionId,
      sessionStatus: activeSession?.status ?? 'idle',
      lockStatus: lockManager.getStatus(sessionId),
      lockHolderId: lockHolder ?? undefined,
      isLockHolder,
      permissionMode: activeSession?.permissionMode,
    })

    // Replay buffered messages the client missed
    const missed = wsHub.getBufferedAfter(sessionId, lastSeq)
    for (const entry of missed) {
      wsHub.sendTo(connectionId, entry.message)
    }

    // Send stream snapshot if streaming is in progress
    const snapshot = wsHub.getStreamSnapshot(sessionId)
    if (snapshot) {
      wsHub.sendTo(connectionId, {
        type: 'stream-snapshot',
        sessionId,
        messageId: snapshot.messageId,
        blocks: snapshot.blocks,
      })
    }

    // Re-send any pending tool-approval or ask-user requests for this session
    resendPendingRequests(sessionId, connectionId, !isLockHolder)

    if (!lockHolder) {
      let hasPending = false
      for (const [, entry] of pendingRequestMap) {
        if (entry.sessionId === sessionId) { hasPending = true; break }
      }
      if (hasPending) {
        lockManager.acquire(sessionId, connectionId)
        wsHub.broadcast(sessionId, {
          type: 'lock-status',
          sessionId,
          status: 'locked',
          holderId: connectionId,
        })
        resendPendingRequests(sessionId, connectionId, false)
      }
    }
  }
```

- [ ] **Step 5: 添加 pong 消息处理和心跳启动**

在 `handleMessage` 的 switch 中添加 pong 处理（在最后一个 case 之后）：

```typescript
      case 'pong':
        wsHub.recordPong(connectionId)
        break
```

在 `createWsHandler` 函数开头（`const pendingRequestMap` 之后）添加：

```typescript
  // Start heartbeat and register dead connection handler
  wsHub.setOnDeadConnection((deadConnectionId) => {
    lockManager.onDisconnect(deadConnectionId)
  })
  wsHub.startHeartbeat()
```

- [ ] **Step 6: 集成 stream snapshot 更新**

在 `bindSessionEvents` 中的 `session.on('message')` 回调内，在 `wsHub.broadcast` 之前添加 stream snapshot 逻辑：

找到 `session.on('message', (msg: any) => {` 回调中的广播部分（handler.ts 第 332-337 行），修改为：

```typescript
      // Update stream snapshot for streaming events
      if (msg.type === 'stream_event') {
        const event = msg.event
        if (event?.type === 'content_block_delta') {
          const delta = event.delta
          const index = event.index ?? 0
          if (delta?.type === 'text_delta' && delta.text) {
            wsHub.updateStreamSnapshot(realSessionId, msg.uuid ?? '', index, 'text', delta.text)
          } else if (delta?.type === 'thinking_delta' && delta.thinking) {
            wsHub.updateStreamSnapshot(realSessionId, msg.uuid ?? '', index, 'thinking', delta.thinking)
          }
        }
        // Don't buffer streaming events — they're tracked via snapshot
        wsHub.broadcastRaw(realSessionId, {
          type: 'agent-message',
          sessionId: realSessionId,
          message: msg,
        })
        return
      }

      // Clear stream snapshot when final assistant message arrives
      if (msg.type === 'assistant') {
        wsHub.clearStreamSnapshot(realSessionId)
      }

      // Broadcast and buffer all other messages to ALL clients
      wsHub.broadcast(realSessionId, {
        type: 'agent-message',
        sessionId: realSessionId,
        message: msg,
      })
```

- [ ] **Step 7: 构建验证**

Run: `pnpm --filter @claude-agent-ui/server build`
Expected: 编译成功

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/ws/handler.ts
git commit -m "feat: decouple approval from lock, integrate message buffer, add heartbeat"
```

---

### Task 4: 客户端 — 心跳响应 + visibilitychange + lastSeq

**Files:**
- Modify: `packages/web/src/stores/connectionStore.ts`
- Modify: `packages/web/src/hooks/useWebSocket.ts`

- [ ] **Step 1: connectionStore 添加 lastSeq**

在 `connectionStore.ts` 的 `ConnectionState` 接口中添加：

```typescript
  lastSeq: number  // 已收到的最大消息序号
```

在 `ConnectionActions` 接口中添加：

```typescript
  setLastSeq(seq: number): void
```

在 `create` 初始值中添加：

```typescript
  lastSeq: 0,
```

在 actions 中添加：

```typescript
  setLastSeq: (seq) => set({ lastSeq: seq }),
```

- [ ] **Step 2: useWebSocket 添加心跳定时器和 visibilitychange**

在 `useWebSocket.ts` 文件顶部的模块变量区域（`let initCount = 0` 之后）添加：

```typescript
let heartbeatTimer = 0  // timeout: no ping received for 60s → reconnect
const HEARTBEAT_TIMEOUT = 60_000

function resetHeartbeatTimer() {
  if (heartbeatTimer) clearTimeout(heartbeatTimer)
  heartbeatTimer = window.setTimeout(() => {
    // No ping from server for 60s — connection is likely dead
    console.warn('[WS] Heartbeat timeout — forcing reconnect')
    ws?.close()
  }, HEARTBEAT_TIMEOUT)
}

function clearHeartbeatTimer() {
  if (heartbeatTimer) {
    clearTimeout(heartbeatTimer)
    heartbeatTimer = 0
  }
}
```

- [ ] **Step 3: 修改 connect 函数集成心跳**

在 `connect` 函数中的 `socket.onopen` 回调末尾添加心跳计时器启动：

```typescript
  socket.onopen = () => {
    useConnectionStore.getState().setConnectionStatus('connected')
    reconnectAttempt = 0

    const prevId = sessionStorage.getItem(CONNECTION_ID_KEY)
    if (prevId) {
      socket.send(JSON.stringify({ type: 'reconnect', previousConnectionId: prevId }))
    }

    const sessionId = useSessionStore.getState().currentSessionId
    if (sessionId && sessionId !== '__new__') {
      const lastSeq = useConnectionStore.getState().lastSeq
      socket.send(JSON.stringify({ type: 'join-session', sessionId, lastSeq }))
    }

    // Start heartbeat timeout detection
    resetHeartbeatTimer()
  }
```

在 `socket.onclose` 回调中添加心跳清理：

```typescript
  socket.onclose = () => {
    ws = null
    clearHeartbeatTimer()
    useConnectionStore.getState().setConnectionStatus('reconnecting')
    scheduleReconnect()
  }
```

- [ ] **Step 4: handleServerMessage 添加 ping 和 stream-snapshot 处理**

在 `handleServerMessage` 函数的 switch 中添加：

```typescript
    case 'ping':
      // Respond with pong and reset heartbeat timer
      send({ type: 'pong' } as any)
      resetHeartbeatTimer()
      break

    case 'stream-snapshot': {
      // Reconnection: apply accumulated stream content as synthetic streaming blocks
      const snapshot = msg as any
      const msgStore = useMessageStore.getState()
      for (const block of snapshot.blocks ?? []) {
        msgStore.appendStreamDelta({
          type: 'stream_event',
          uuid: snapshot.messageId,
          event: {
            type: 'content_block_start',
            index: block.index,
            content_block: { type: block.type },
          },
        } as any)
        msgStore.appendStreamDelta({
          type: 'stream_event',
          uuid: snapshot.messageId,
          event: {
            type: 'content_block_delta',
            index: block.index,
            delta: block.type === 'text'
              ? { type: 'text_delta', text: block.content }
              : { type: 'thinking_delta', thinking: block.content },
          },
        } as any)
      }
      break
    }
```

- [ ] **Step 5: 添加 visibilitychange 处理**

在 `connect` 函数定义之前添加 visibilitychange 监听器（模块级别）：

```typescript
// ── Page visibility: fast reconnect on foreground ─────────────
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Page came back to foreground — check if WebSocket is still alive
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        // Connection is dead, reconnect immediately (skip backoff delay)
        if (reconnectTimer) clearTimeout(reconnectTimer)
        reconnectAttempt = 0
        connect()
      }
    }
  })
}
```

- [ ] **Step 6: 修改 joinSession 发送 lastSeq**

更新 `joinSession` 辅助函数：

```typescript
function joinSession(sessionId: string) {
  const lastSeq = useConnectionStore.getState().lastSeq
  send({ type: 'join-session', sessionId, lastSeq } as any)
}
```

- [ ] **Step 7: 构建验证**

Run: `pnpm --filter @claude-agent-ui/web build`
Expected: 编译成功

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/stores/connectionStore.ts packages/web/src/hooks/useWebSocket.ts
git commit -m "feat: add heartbeat, visibilitychange, and message replay on reconnect"
```

---

### Task 5: 端到端集成验证

- [ ] **Step 1: 构建全部包**

Run: `pnpm build`
Expected: shared → server → web 全部编译成功

- [ ] **Step 2: 启动 dev 服务器**

Run: `pnpm dev`
Expected: server (4000) + web (5173) 正常启动

- [ ] **Step 3: 手动测试 — 心跳**

在浏览器中打开 http://localhost:5173，打开 DevTools → Network → WS。观察：
- 每 30 秒服务端发送 `{"type":"ping"}`
- 客户端立即回复 `{"type":"pong"}`

- [ ] **Step 4: 手动测试 — 后台执行**

1. 使用 `bypassPermissions` 模式启动一个 Agent 任务
2. 在 Agent 执行过程中关闭浏览器标签
3. 等待 10 秒后重新打开
4. 验证 Agent 继续执行并且断开期间的消息补发

- [ ] **Step 5: 手动测试 — 审批无锁限制**

1. 打开两个浏览器标签连接同一个 session
2. 标签 A 持有锁，发送消息触发工具审批
3. 标签 A 释放锁
4. 标签 B 获取锁并响应审批
5. 验证审批响应成功处理

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: agent background execution with message buffer and heartbeat"
```
