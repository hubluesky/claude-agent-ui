# 03 — Server 核心模块

## 模块总览

```
server/src/
├── index.ts          → Fastify 入口
├── config.ts         → 配置
├── agent/
│   ├── session.ts    → AgentSession 接口
│   ├── v1-session.ts → V1QuerySession 实现
│   └── manager.ts    → SessionManager
├── ws/
│   ├── hub.ts        → WSHub 广播
│   ├── lock.ts       → LockManager
│   ├── handler.ts    → WS 消息路由
│   └── registry.ts   → 连接注册表
├── routes/
│   ├── sessions.ts   → REST API
│   └── health.ts     → 健康检查
└── db/
    ├── schema.ts     → Drizzle schema
    └── index.ts      → SQLite
```

---

## 1. Fastify 入口 (`index.ts`)

### 启动流程

```
1. 读取 config（端口、数据库路径）
2. 创建 Fastify 实例
3. 注册插件：
   - @fastify/websocket
   - @fastify/cors（开发时允许跨域）
   - @fastify/static（生产时服务前端静态文件）
4. 初始化 SQLite（Drizzle）
5. 创建单例：WSHub、LockManager、SessionManager
6. 注册路由：/api/health, /api/projects, /api/sessions
7. 注册 WebSocket 路由：/ws
8. 启动监听
```

### 配置 (`config.ts`)

```typescript
{
  port: number              // 默认 3456，环境变量 PORT
  host: string              // 默认 '0.0.0.0'
  dbPath: string            // 默认 ~/.claude-agent-ui/settings.db
  staticDir: string | null  // 生产模式指向 web/dist
  corsOrigin: string | boolean  // 开发 true，生产 false
}
```

---

## 2. AgentSession 抽象层 (`agent/session.ts`)

### 接口定义

```typescript
interface AgentSession {
  readonly id: string           // session UUID
  readonly projectCwd: string   // 工作目录
  readonly status: SessionStatus

  // 生命周期
  send(prompt: string, options?: SendOptions): void
  abort(): Promise<void>
  close(): void

  // 事件
  on(event: 'message', cb: (msg: SDKMessage) => void): void
  on(event: 'tool-approval', cb: (req: ToolApprovalRequest) => Promise<ToolApprovalDecision>): void
  on(event: 'ask-user', cb: (req: AskUserRequest) => Promise<AskUserResponse>): void
  on(event: 'complete', cb: (result: SDKResultMessage) => void): void
  on(event: 'error', cb: (err: Error) => void): void
  on(event: 'state-change', cb: (state: SessionStatus) => void): void

  // 运行时控制（代理到 Query 实例方法）
  setPermissionMode(mode: PermissionMode): Promise<void>
  setModel(model: string): Promise<void>
  interrupt(): Promise<void>
  getContextUsage(): Promise<ContextUsage>
}

type SessionStatus = 'idle' | 'running' | 'awaiting_approval' | 'awaiting_user_input'

interface SendOptions {
  images?: { data: string; mediaType: string }[]
  thinkingMode?: ThinkingConfig
  effort?: EffortLevel
}

interface ToolApprovalRequest {
  requestId: string       // 用于回传匹配
  toolName: string
  toolInput: Record<string, unknown>
  toolUseID: string
  title?: string          // "Claude wants to read foo.txt"
  displayName?: string    // "Read file"
  description?: string
  suggestions?: PermissionUpdate[]
  agentID?: string        // 子 Agent 时非空
}

type ToolApprovalDecision =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: PermissionUpdate[] }
  | { behavior: 'deny'; message: string }

interface AskUserRequest {
  requestId: string
  questions: {
    question: string
    header: string
    options: { label: string; description: string; preview?: string }[]
    multiSelect: boolean
  }[]
}

interface AskUserResponse {
  answers: Record<string, string>  // question text → selected label(s)
}
```

---

## 3. V1QuerySession 实现 (`agent/v1-session.ts`)

### 内部状态

```typescript
class V1QuerySession implements AgentSession {
  private sessionId: string | null = null
  private queryInstance: Query | null = null       // SDK query() 返回值
  private abortController: AbortController | null = null
  private status: SessionStatus = 'idle'
  private pendingApprovals: Map<string, {
    resolve: (decision: ToolApprovalDecision) => void
    timeout: NodeJS.Timeout
  }> = new Map()
  private pendingAskUser: Map<string, {
    resolve: (response: AskUserResponse) => void
    timeout: NodeJS.Timeout
  }> = new Map()
}
```

### send() 实现流程

```
1. 创建 AbortController
2. 构造 query options:
   - prompt: 用户输入
   - resume: this.sessionId（首次为 undefined）
   - cwd: this.projectCwd
   - allowedTools: 从当前 permissionMode 派生
   - canUseTool: 见下方
   - includePartialMessages: true（流式增量）
   - abortController
   - hooks: 可选
3. 调用 SDK query()
4. this.status = 'running'
5. emit('state-change', 'running')
6. for await (const msg of this.queryInstance):
   a. if msg.type === 'system' && msg.subtype === 'init':
      - 捕获 this.sessionId = msg.session_id
   b. emit('message', msg)
   c. if msg.type === 'result':
      - emit('complete', msg)
      - this.status = 'idle'
      - emit('state-change', 'idle')
7. 异常处理:
   - AbortError → 正常中止，不 emit error
   - 其他 → emit('error', err)
```

### canUseTool 实现

```typescript
canUseTool: async (toolName, input, options) => {
  // 1. 判断是否为 AskUserQuestion
  if (toolName === 'AskUserQuestion') {
    this.status = 'awaiting_user_input'
    this.emit('state-change', 'awaiting_user_input')

    const requestId = crypto.randomUUID()
    const req: AskUserRequest = { requestId, questions: input.questions }

    // 2. 创建 Promise 等待前端响应
    const response = await new Promise<AskUserResponse>((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ answers: {} })  // 超时默认空
      }, 5 * 60 * 1000)  // 5 分钟超时
      this.pendingAskUser.set(requestId, { resolve, timeout })
      this.emit('ask-user', req)  // → WS → 前端
    })

    this.status = 'running'
    this.emit('state-change', 'running')
    return { behavior: 'allow', updatedInput: { questions: input.questions, answers: response.answers } }
  }

  // 3. 普通工具审批
  this.status = 'awaiting_approval'
  this.emit('state-change', 'awaiting_approval')

  const requestId = crypto.randomUUID()
  const req: ToolApprovalRequest = {
    requestId, toolName, toolInput: input,
    toolUseID: options.toolUseID,
    title: options.title,
    displayName: options.displayName,
    description: options.description,
    suggestions: options.suggestions,
    agentID: options.agentID,
  }

  // 4. 创建 Promise 等待前端响应
  const decision = await new Promise<ToolApprovalDecision>((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ behavior: 'deny', message: 'Approval timed out' })
    }, 5 * 60 * 1000)
    this.pendingApprovals.set(requestId, { resolve, timeout })
    this.emit('tool-approval', req)  // → WS → 前端
  })

  this.status = 'running'
  this.emit('state-change', 'running')
  return decision
}
```

### abort() 实现

```
1. this.abortController?.abort()
2. this.queryInstance?.interrupt()
3. 清理所有 pendingApprovals 和 pendingAskUser（reject/超时）
4. this.status = 'idle'
5. emit('state-change', 'idle')
```

### resolveToolApproval / resolveAskUser（供外部调用）

```typescript
resolveToolApproval(requestId: string, decision: ToolApprovalDecision): void {
  const pending = this.pendingApprovals.get(requestId)
  if (pending) {
    clearTimeout(pending.timeout)
    pending.resolve(decision)
    this.pendingApprovals.delete(requestId)
  }
}

resolveAskUser(requestId: string, response: AskUserResponse): void {
  const pending = this.pendingAskUser.get(requestId)
  if (pending) {
    clearTimeout(pending.timeout)
    pending.resolve(response)
    this.pendingAskUser.delete(requestId)
  }
}
```

---

## 4. SessionManager (`agent/manager.ts`)

### 职责

```typescript
class SessionManager {
  // 活跃会话（内存中正在运行或最近使用的）
  private activeSessions: Map<string, AgentSession> = new Map()

  // === 只读查询（代理到 SDK 函数）===

  // 列出所有项目（从 listSessions 聚合 unique cwd）
  async listProjects(): Promise<ProjectInfo[]> {
    const sessions = await listSessions()
    // 按 cwd 分组，每组取最新 session 的时间
    // 返回 { cwd, name (basename of cwd), lastActiveAt, sessionCount }
  }

  // 列出某项目的会话
  async listProjectSessions(cwd: string, options?: { limit?: number; offset?: number }): Promise<SDKSessionInfo[]> {
    const all = await listSessions()
    // 过滤 cwd 匹配的，按 updatedAt 降序，分页
  }

  // 获取会话消息（分页懒加载）
  async getSessionMessages(sessionId: string, options?: { limit?: number; offset?: number }): Promise<SessionMessage[]> {
    return await getSessionMessages(sessionId, options)
  }

  // 获取会话详情
  async getSessionInfo(sessionId: string): Promise<SDKSessionInfo | undefined> {
    return await getSessionInfo(sessionId)
  }

  // === 活跃会话管理 ===

  // 创建新会话
  async createSession(cwd: string, options?: CreateSessionOptions): Promise<AgentSession> {
    const session = new V1QuerySession(cwd, options)
    // 注意：sessionId 在首次 send 后才确定
    return session
  }

  // 恢复已有会话
  async resumeSession(sessionId: string): Promise<AgentSession> {
    // 检查是否已在 activeSessions 中
    if (this.activeSessions.has(sessionId)) {
      return this.activeSessions.get(sessionId)!
    }
    // 获取 session info 以拿到 cwd
    const info = await getSessionInfo(sessionId)
    if (!info) throw new Error(`Session ${sessionId} not found`)
    const session = new V1QuerySession(info.cwd, { resumeSessionId: sessionId })
    this.activeSessions.set(sessionId, session)
    return session
  }

  // 注册活跃会话（首次 send 后 sessionId 确定时调用）
  registerActive(sessionId: string, session: AgentSession): void {
    this.activeSessions.set(sessionId, session)
  }

  // 获取活跃会话
  getActive(sessionId: string): AgentSession | undefined {
    return this.activeSessions.get(sessionId)
  }

  // 清理（完成或断开后）
  removeActive(sessionId: string): void {
    this.activeSessions.delete(sessionId)
  }
}
```

---

## 5. WSHub (`ws/hub.ts`)

### 数据结构

```typescript
interface ClientInfo {
  ws: WebSocket
  connectionId: string
  sessionId: string | null  // 当前加入的会话
  joinedAt: number
}

class WSHub {
  // connectionId → ClientInfo
  private clients: Map<string, ClientInfo> = new Map()
  // sessionId → Set<connectionId>
  private sessionSubscribers: Map<string, Set<string>> = new Map()
}
```

### 核心方法

```typescript
class WSHub {
  // 注册新连接
  register(ws: WebSocket): string {
    const connectionId = crypto.randomUUID()
    this.clients.set(connectionId, { ws, connectionId, sessionId: null, joinedAt: Date.now() })
    return connectionId
  }

  // 加入会话
  joinSession(connectionId: string, sessionId: string): void {
    const client = this.clients.get(connectionId)
    if (!client) return
    // 离开旧会话
    if (client.sessionId) this.leaveSession(connectionId)
    // 加入新会话
    client.sessionId = sessionId
    if (!this.sessionSubscribers.has(sessionId)) {
      this.sessionSubscribers.set(sessionId, new Set())
    }
    this.sessionSubscribers.get(sessionId)!.add(connectionId)
  }

  // 离开会话
  leaveSession(connectionId: string): void { ... }

  // 广播给会话的所有客户端
  broadcast(sessionId: string, msg: S2CMessage): void {
    const subscribers = this.sessionSubscribers.get(sessionId)
    if (!subscribers) return
    const data = JSON.stringify(msg)
    for (const connId of subscribers) {
      const client = this.clients.get(connId)
      if (client?.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data)
      }
    }
  }

  // 发给特定客户端
  sendTo(connectionId: string, msg: S2CMessage): void {
    const client = this.clients.get(connectionId)
    if (client?.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(msg))
    }
  }

  // 广播给除某个客户端外的所有订阅者
  broadcastExcept(sessionId: string, excludeConnectionId: string, msg: S2CMessage): void { ... }

  // 注销连接
  unregister(connectionId: string): void { ... }

  // 获取会话的所有连接数
  getSessionClientCount(sessionId: string): number { ... }
}
```

---

## 6. LockManager (`ws/lock.ts`)

### 数据结构

```typescript
interface SessionLock {
  holderId: string        // connectionId
  sessionId: string
  acquiredAt: number
  gracePeriodTimer: NodeJS.Timeout | null
}

class LockManager {
  private locks: Map<string, SessionLock> = new Map()
  private readonly GRACE_PERIOD_MS = 10_000  // 断线宽限 10s

  private onRelease: (sessionId: string) => void  // 通知 WSHub 广播锁释放
}
```

### 完整方法

```typescript
class LockManager {
  // 获取锁（发消息时调用）
  acquire(sessionId: string, connectionId: string): { success: boolean; holder?: string } {
    const existing = this.locks.get(sessionId)
    if (existing && existing.holderId !== connectionId) {
      return { success: false, holder: existing.holderId }
    }
    // 成功获取或续期
    this.locks.set(sessionId, {
      holderId: connectionId, sessionId, acquiredAt: Date.now(), gracePeriodTimer: null
    })
    return { success: true }
  }

  // 释放锁（Agent 完成时调用）
  release(sessionId: string): void {
    const lock = this.locks.get(sessionId)
    if (lock?.gracePeriodTimer) clearTimeout(lock.gracePeriodTimer)
    this.locks.delete(sessionId)
    this.onRelease(sessionId)
  }

  // 断线处理（WS close 时调用）
  onDisconnect(connectionId: string): void {
    for (const [sessionId, lock] of this.locks) {
      if (lock.holderId === connectionId) {
        // 启动宽限期
        lock.gracePeriodTimer = setTimeout(() => {
          this.release(sessionId)
        }, this.GRACE_PERIOD_MS)
      }
    }
  }

  // 重连处理：旧 connectionId → 新 connectionId
  onReconnect(previousConnectionId: string, newConnectionId: string): void {
    for (const lock of this.locks.values()) {
      if (lock.holderId === previousConnectionId) {
        if (lock.gracePeriodTimer) {
          clearTimeout(lock.gracePeriodTimer)
          lock.gracePeriodTimer = null
        }
        // 更新锁持有者为新连接 ID
        lock.holderId = newConnectionId
      }
    }
  }

  // 查询
  getHolder(sessionId: string): string | null {
    return this.locks.get(sessionId)?.holderId ?? null
  }

  isHolder(sessionId: string, connectionId: string): boolean {
    return this.locks.get(sessionId)?.holderId === connectionId
  }

  getStatus(sessionId: string): 'idle' | 'locked' {
    return this.locks.has(sessionId) ? 'locked' : 'idle'
  }
}
```

---

## 7. WS Handler (`ws/handler.ts`)

### 连接建立流程

```
1. WS 连接建立
2. WSHub.register(ws) → connectionId
3. 发送 init: { type: 'init', connectionId }
4. 注册消息处理器
5. 注册 close 处理器
```

### 消息路由

```typescript
ws.on('message', async (raw) => {
  const msg: C2SMessage = JSON.parse(raw.toString())

  switch (msg.type) {
    case 'join-session':
      await handleJoinSession(connectionId, msg.sessionId)
      break

    case 'send-message':
      await handleSendMessage(connectionId, msg.sessionId, msg.prompt, msg.options)
      break

    case 'tool-approval-response':
      handleToolApprovalResponse(connectionId, msg.requestId, msg.decision)
      break

    case 'ask-user-response':
      handleAskUserResponse(connectionId, msg.requestId, msg.answers)
      break

    case 'abort':
      await handleAbort(connectionId, msg.sessionId)
      break

    case 'set-mode':
      await handleSetMode(connectionId, msg.sessionId, msg.mode)
      break

    case 'set-effort':
      handleSetEffort(connectionId, msg.sessionId, msg.effort)
      break
  }
})
```

### handleJoinSession

```
1. wsHub.joinSession(connectionId, sessionId)
2. 获取锁状态 → lockManager.getStatus(sessionId)
3. 获取活跃会话状态 → sessionManager.getActive(sessionId)?.status
4. 发送 session-state:
   { type: 'session-state', sessionId, lockStatus, sessionStatus, holderId }
```

### handleSendMessage（核心闭环）

```
0. 处理新建会话：如果 sessionId === null
   - 需要 options.cwd（必填）
   - session = await sessionManager.createSession(options.cwd)
   - 临时用 connectionId 作为锁 key（sessionId 尚未确定）
   - 在 init 消息中获得真正的 sessionId 后，更新锁和 Hub 订阅

1. 验证锁
   lockResult = lockManager.acquire(sessionId, connectionId)
   if (!lockResult.success):
     sendTo(connectionId, { type: 'error', message: 'Session locked', holder: lockResult.holder })
     return

2. 广播锁状态
   wsHub.broadcast(sessionId, { type: 'lock-status', status: 'locked', holderId: connectionId })

3. 获取或创建 AgentSession
   session = sessionManager.getActive(sessionId) ?? await sessionManager.resumeSession(sessionId)

4. 绑定事件 → WS 广播
   session.on('message', (msg) => {
     wsHub.broadcast(sessionId, { type: 'agent-message', sessionId, message: msg })
   })

   session.on('tool-approval', async (req) => {
     // 记录 requestId → sessionId 映射
     pendingRequestMap.set(req.requestId, sessionId)
     // 发给锁持有者（可交互）
     wsHub.sendTo(connectionId, { type: 'tool-approval-request', ...req, readonly: false })
     // 广播给其他人（只读）
     wsHub.broadcastExcept(sessionId, connectionId, { type: 'tool-approval-request', ...req, readonly: true })
     // 返回 Promise — 等待 resolveToolApproval 被调用
   })

   session.on('ask-user', async (req) => {
     pendingRequestMap.set(req.requestId, sessionId)
     wsHub.sendTo(connectionId, { type: 'ask-user-request', ...req, readonly: false })
     wsHub.broadcastExcept(sessionId, connectionId, { type: 'ask-user-request', ...req, readonly: true })
   })

   session.on('state-change', (state) => {
     wsHub.broadcast(sessionId, { type: 'session-state-change', sessionId, state })
   })

   session.on('complete', (result) => {
     lockManager.release(sessionId)
     wsHub.broadcast(sessionId, { type: 'session-complete', sessionId, result })
     wsHub.broadcast(sessionId, { type: 'lock-status', status: 'idle' })
   })

   session.on('error', (err) => {
     lockManager.release(sessionId)
     wsHub.broadcast(sessionId, { type: 'error', message: err.message })
     wsHub.broadcast(sessionId, { type: 'lock-status', status: 'idle' })
   })

5. 发送消息
   session.send(msg.prompt, msg.options)

6. 注册到 SessionManager（首次 send 后 sessionId 确定）
   session.on('message', (msg) => {
     if (msg.type === 'system' && msg.subtype === 'init') {
       sessionManager.registerActive(msg.session_id, session)
     }
   })
```

### handleToolApprovalResponse

需要一个 `requestId → sessionId` 映射（在 emit tool-approval 时记录）：

```typescript
// handler 内部维护
private pendingRequestMap: Map<string, string> = new Map()  // requestId → sessionId
```

```
1. sessionId = pendingRequestMap.get(requestId)
2. 验证 connectionId === lockManager.getHolder(sessionId)
3. session = sessionManager.getActive(sessionId)
4. session.resolveToolApproval(requestId, decision)
5. pendingRequestMap.delete(requestId)
6. 广播决策结果给其他客户端：
   wsHub.broadcastExcept(sessionId, connectionId, { type: 'tool-approval-resolved', requestId, decision })
```

### handleAbort

```
1. 验证 connectionId === lockManager.getHolder(sessionId)
2. session = sessionManager.getActive(sessionId)
3. await session.abort()
4. lockManager.release(sessionId)
5. wsHub.broadcast(sessionId, { type: 'session-aborted', sessionId })
6. wsHub.broadcast(sessionId, { type: 'lock-status', status: 'idle' })
```

### WS close 处理

```
1. lockManager.onDisconnect(connectionId)
2. wsHub.unregister(connectionId)
3. 广播连接数变化（可选）
```

---

## 8. REST Routes (`routes/sessions.ts`)

```typescript
// GET /api/projects
// → sessionManager.listProjects()
// → 返回 ProjectInfo[]（cwd, name, lastActiveAt, sessionCount）

// GET /api/sessions?project=<cwd>&limit=20&offset=0
// → sessionManager.listProjectSessions(cwd, { limit, offset })
// → 返回 SDKSessionInfo[]（sessionId, tag, title, createdAt, updatedAt）
// 不加载消息内容

// GET /api/sessions/:id
// → sessionManager.getSessionInfo(id)
// → 返回 SDKSessionInfo

// GET /api/sessions/:id/messages?limit=50&offset=0
// → sessionManager.getSessionMessages(id, { limit, offset })
// → 返回 SessionMessage[]
// 分页：offset=0 返回最新 50 条，offset=50 返回更早的 50 条

// POST /api/sessions
// body: { cwd: string }
// → sessionManager.createSession(cwd)
// → 返回 { sessionId: null }（首次 send 后才有 ID）

// POST /api/sessions/:id/rename
// body: { title: string }
// → renameSession(id, title)

// POST /api/sessions/:id/tag
// body: { tag: string | null }
// → tagSession(id, tag)
```

---

## 9. Database (`db/`)

SQLite 仅存用户偏好和 UI 状态，**不存会话数据**。

### Schema

```typescript
// Drizzle schema
export const userSettings = sqliteTable('user_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const uiState = sqliteTable('ui_state', {
  key: text('key').primaryKey(),       // 如 'sidebar_width', 'last_project'
  value: text('value').notNull(),       // JSON string
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})
```

### 存储内容示例

| key | value | 说明 |
|-----|-------|------|
| `default_mode` | `"acceptEdits"` | 默认权限模式 |
| `default_effort` | `"high"` | 默认思考力度 |
| `sidebar_width` | `"320"` | 侧栏宽度 |
| `last_project` | `"/path/to/project"` | 最后打开的项目 |
| `theme` | `"dark"` | 主题 |
