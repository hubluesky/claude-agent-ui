# 07 — 端到端数据流闭环

每个用户场景的完整链路，从用户动作到最终 UI 更新，覆盖所有节点。

---

## 场景 1：首次打开应用

```
用户打开浏览器 → http://localhost:3456
  │
  ├─ 1. 加载前端静态文件（Fastify static plugin）
  │     index.html → main.tsx → App.tsx → AppLayout.tsx
  │
  ├─ 2. settingsStore.load()
  │     → GET /api/settings（未来）或读 localStorage
  │     → 设置 theme、sidebarWidth、defaultMode 等
  │
  ├─ 3. sessionStore.loadProjects()
  │     → GET /api/projects
  │     → server: SDK listSessions() → 按 cwd 聚合
  │     → 返回 ProjectInfo[]（cwd, name, lastActiveAt, sessionCount）
  │     → 渲染 Sidebar: ProjectGroup 列表
  │
  ├─ 4. useWebSocket().connect('ws://localhost:3456/ws')
  │     → WebSocket 连接建立
  │     → server: WSHub.register(ws) → connectionId
  │     → S2C: { type: 'init', connectionId: 'abc-123' }
  │     → connectionStore.setConnectionId('abc-123')
  │     → connectionStore.setConnectionStatus('connected')
  │
  └─ 5. 渲染完成
        侧栏：项目列表（按 lastActiveAt 排序）
        主区：空状态 "选择一个会话开始"
```

---

## 场景 2：点击项目展开会话列表

```
用户点击侧栏的 "my-project" 项目
  │
  ├─ 1. sessionStore.loadProjectSessions('/path/to/my-project')
  │     → GET /api/sessions?project=%2Fpath%2Fto%2Fmy-project&limit=20
  │     → server: SDK listSessions() → 过滤 cwd → 分页
  │     → 返回 SDKSessionInfo[]（sessionId, tag, title, createdAt, updatedAt）
  │     → 不加载消息内容
  │
  └─ 2. 渲染
        ProjectGroup 展开，显示会话列表
        每个会话：标题/tag、相对时间、sessionId 缩写
```

---

## 场景 3：点击会话进入聊天

```
用户点击 session "sess-001"
  │
  ├─ 1. sessionStore.selectSession('sess-001', '/path/to/my-project')
  │     → currentSessionId = 'sess-001'
  │
  ├─ 2. messageStore.loadInitial('sess-001')
  │     → GET /api/sessions/sess-001/messages?limit=50&offset=0
  │     → server: SDK getSessionMessages('sess-001', { limit: 50, offset: 0 })
  │     → 返回最新 50 条消息 + hasMore + total
  │     → messageStore.messages = [...messages]
  │     → messageStore.hasMore = true/false
  │
  ├─ 3. WS: joinSession
  │     → C2S: { type: 'join-session', sessionId: 'sess-001' }
  │     → server: WSHub.joinSession('abc-123', 'sess-001')
  │     → server: 查询锁状态和会话状态
  │     → S2C: { type: 'session-state', sessionId: 'sess-001',
  │              lockStatus: 'idle', sessionStatus: 'idle', isLockHolder: false }
  │     → connectionStore 更新
  │
  └─ 4. 渲染
        ChatMessagesPane：渲染 50 条消息，滚动到底部
        StatusBar：🟢 空闲
        ChatComposer：可输入
```

---

## 场景 4：向上滚动加载更多

```
用户在 ChatMessagesPane 向上滚动到顶部
  │
  ├─ 1. IntersectionObserver 检测到 topSentinel 可见
  │     → 检查 messageStore.hasMore && !messageStore.isLoadingMore
  │
  ├─ 2. messageStore.loadMore()
  │     → 计算 offset = messageStore.messages.length
  │     → GET /api/sessions/sess-001/messages?limit=50&offset=50
  │     → 返回更早的 50 条
  │
  └─ 3. 渲染
        → 记录当前 scrollHeight
        → 插入消息到列表顶部
        → 恢复 scrollTop = newScrollHeight - prevScrollHeight（保持位置）
        → 更新 hasMore
```

---

## 场景 5：发送消息（核心流程）

```
Client A（发送者）点击 Send
  │
  ├─ 1. ChatComposer.onSubmit(prompt)
  │     → 清空输入框
  │     → 本地立即追加用户消息气泡（乐观 UI）
  │
  ├─ 2. WS sendMessage
  │     → C2S: { type: 'send-message', sessionId: 'sess-001', prompt: 'Fix the bug' }
  │
  │  ───── Server 处理 ─────
  │
  ├─ 3. handler.handleSendMessage()
  │     → lockManager.acquire('sess-001', 'abc-123')  ✓ 成功
  │     → S2C broadcast: { type: 'lock-status', status: 'locked', holderId: 'abc-123' }
  │       → Client A: connectionStore → 'locked_self'
  │       → Client B: connectionStore → 'locked_other'（输入区禁用）
  │
  ├─ 4. agentSession.send('Fix the bug')
  │     → 内部调用 SDK: query({ prompt: 'Fix the bug', options: { resume: 'sess-001', ... } })
  │     → S2C broadcast: { type: 'session-state-change', state: 'running' }
  │
  ├─ 4b. 广播用户消息给其他客户端
  │     → SDK 输出流中包含 SDKUserMessage（type: 'user'），会被 broadcast
  │     → 但为了让 Client B 立即看到用户消息（不等 SDK 回显），
  │       server 在 send 时额外广播：
  │       wsHub.broadcastExcept(sessionId, connectionId, {
  │         type: 'agent-message', message: { type: 'user', message: { role: 'user', content: prompt } }
  │       })
  │     → Client B: messageStore.appendMessage → 渲染用户气泡
  │
  ├─ 5. SDK 流式输出（for await 循环）
  │     → S2C broadcast: { type: 'agent-message', message: { type: 'system', subtype: 'init', ... } }
  │     → S2C broadcast: { type: 'agent-message', message: { type: 'stream_event', event: { type: 'content_block_start', ... } } }
  │     → S2C broadcast: { type: 'agent-message', message: { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '我来' } } } }
  │     → S2C broadcast: { type: 'agent-message', message: { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '看看' } } } }
  │     → ... 持续流式
  │     → S2C broadcast: { type: 'agent-message', message: { type: 'assistant', ... } }  // 完整消息
  │     → S2C broadcast: { type: 'agent-message', message: { type: 'result', subtype: 'success', ... } }
  │
  │     Client A & B 同时看到：
  │       messageStore.appendStreamDelta() → 逐字渲染
  │       messageStore.appendMessage() → 完整消息替换流式内容
  │
  ├─ 6. 完成
  │     → session.onComplete 触发
  │     → lockManager.release('sess-001')
  │     → S2C broadcast: { type: 'session-complete', result: { subtype: 'success', ... } }
  │     → S2C broadcast: { type: 'lock-status', status: 'idle' }
  │       → Client A: connectionStore → 'idle'
  │       → Client B: connectionStore → 'idle'（输入区恢复）
```

---

## 场景 6：工具审批流

```
Agent 执行中遇到需要审批的工具（如 Bash: rm -rf）
  │
  ├─ 1. SDK canUseTool('Bash', { command: 'rm -rf /tmp/test' }, options)
  │     → V1QuerySession.canUseTool 被调用
  │     → session.status = 'awaiting_approval'
  │     → S2C broadcast: { type: 'session-state-change', state: 'awaiting_approval' }
  │
  ├─ 2. 创建 pendingApproval Promise
  │     → requestId = 'req-456'
  │     → pendingApprovals.set('req-456', { resolve, timeout: 5min })
  │
  ├─ 3. 发送审批请求
  │     → 给锁持有者 (Client A): { type: 'tool-approval-request', requestId: 'req-456',
  │         toolName: 'Bash', toolInput: { command: 'rm -rf /tmp/test' },
  │         title: 'Claude wants to run a command', readonly: false }
  │     → 给其他人 (Client B): { ..., readonly: true }
  │
  │     Client A 渲染：PermissionBanner（可交互，有 Allow/Deny 按钮）
  │     Client B 渲染：PermissionBanner（只读，显示 "Waiting for operator..."）
  │
  ├─ 4. 用户（Client A）点击 Deny
  │     → C2S: { type: 'tool-approval-response', requestId: 'req-456',
  │             decision: { behavior: 'deny', message: 'Too dangerous' } }
  │
  ├─ 5. Server 处理
  │     → session.resolveToolApproval('req-456', { behavior: 'deny', message: 'Too dangerous' })
  │     → pendingApprovals Promise resolve
  │     → canUseTool 返回 { behavior: 'deny', message: 'Too dangerous' }
  │     → SDK Agent 收到拒绝，尝试其他方法
  │     → S2C broadcast: { type: 'tool-approval-resolved', requestId: 'req-456', decision: { behavior: 'deny' } }
  │     → S2C broadcast: { type: 'session-state-change', state: 'running' }
  │
  └─ 6. UI 更新
        Client A: PermissionBanner 消失，继续看 Agent 输出
        Client B: PermissionBanner 消失（显示被拒绝），继续看 Agent 输出
```

---

## 场景 7：AskUserQuestion 流

```
Agent 调用 AskUserQuestion
  │
  ├─ 1. SDK canUseTool('AskUserQuestion', { questions: [...] })
  │     → V1QuerySession 识别为 AskUserQuestion
  │     → session.status = 'awaiting_user_input'
  │
  ├─ 2. 发送问题
  │     → Client A (交互): { type: 'ask-user-request', requestId: 'req-789',
  │         questions: [{ question: '用什么数据库?', header: '数据库',
  │           options: [{ label: 'PostgreSQL', description: '...' }, ...],
  │           multiSelect: false }], readonly: false }
  │     → Client B (只读): { ..., readonly: true }
  │
  ├─ 3. Client A 渲染 AskUserPanel
  │     → 显示问题文本、选项卡片
  │     → 支持键盘选择 (1-9)、Enter 确认
  │     → 可点击 "Other" 自由输入
  │
  ├─ 4. 用户选择 "PostgreSQL"
  │     → C2S: { type: 'ask-user-response', requestId: 'req-789',
  │             answers: { '用什么数据库?': 'PostgreSQL' } }
  │
  └─ 5. Server → SDK
        → session.resolveAskUser('req-789', { answers: { '用什么数据库?': 'PostgreSQL' } })
        → canUseTool 返回 { behavior: 'allow', updatedInput: { questions, answers } }
        → Agent 继续
```

---

## 场景 8：中途 Abort

```
用户（锁持有者 Client A）点击 Stop
  │
  ├─ 1. C2S: { type: 'abort', sessionId: 'sess-001' }
  │
  ├─ 2. Server
  │     → 验证 Client A 是锁持有者
  │     → agentSession.abort()
  │       → abortController.abort()
  │       → queryInstance.interrupt()
  │       → 清理所有 pendingApprovals（reject with timeout）
  │     → lockManager.release('sess-001')
  │     → S2C broadcast: { type: 'session-aborted', sessionId: 'sess-001' }
  │     → S2C broadcast: { type: 'lock-status', status: 'idle' }
  │
  └─ 3. Client A & B
        connectionStore → idle
        ChatComposer → 恢复可输入
```

---

## 场景 9：Client B 尝试发消息但被锁

```
Client B 在 Client A 锁定期间尝试发消息
  │
  ├─ 1. 前端拦截（推荐）
  │     → connectionStore.lockStatus === 'locked_other'
  │     → ChatComposer disabled，Send 按钮灰色
  │     → placeholder: "🔒 会话已被占用"
  │     → 用户无法输入 → 流程结束
  │
  └─ 2. 后端拦截（兜底）
        如果前端bug 导致消息发出：
        → C2S: { type: 'send-message', ... }
        → lockManager.acquire() → { success: false, holder: 'abc-123' }
        → S2C sendTo(Client B): { type: 'error', message: 'Session locked', code: 'session_locked' }
```

---

## 场景 10：断线重连

```
Client A（锁持有者）网络断开
  │
  ├─ 1. WS close 事件
  │     → server: WSHub.unregister('abc-123')
  │     → server: lockManager.onDisconnect('abc-123')
  │       → 启动 10s 宽限期定时器
  │     → Agent 继续运行（不中止！消息继续广播给 Client B）
  │
  ├─ 2a. 10s 内重连成功
  │     → 新 WS 连接建立
  │     → server: WSHub.register(ws) → newConnectionId = 'abc-456'
  │     → 如何关联旧 connectionId?
  │       方案：Client A 在 localStorage 存 connectionId
  │       重连时 C2S: { type: 'reconnect', previousConnectionId: 'abc-123' }
  │       server: lockManager.onReconnect('abc-123') → 取消宽限期
  │       server: WSHub 用新 ws 替换旧连接
  │     → C2S: { type: 'join-session', sessionId: 'sess-001' }
  │     → S2C: session-state（恢复锁持有者身份）
  │     → 前端：从 messageStore 已有消息继续显示，WS 推送的新消息继续追加
  │
  └─ 2b. 10s 超时
        → lockManager.release('sess-001')
        → agentSession 继续运行直到完成（但锁释放了）
        → S2C broadcast (Client B): { type: 'lock-status', status: 'idle' }
        → Client B 现在可以获取锁发消息
```

---

## 场景 11：新建会话

```
用户点击 "New Chat" 按钮
  │
  ├─ 1. 弹出项目选择（或使用当前项目）
  │     → 用户选择 cwd: '/path/to/project'
  │
  ├─ 2. sessionStore.createSession('/path/to/project')
  │     → currentSessionId = null（新会话还没有 ID）
  │     → currentProjectCwd = '/path/to/project'
  │     → messageStore.clear()
  │
  ├─ 3. 用户输入消息并 Send
  │     → C2S: { type: 'send-message', sessionId: null, prompt: '...', options: { cwd: '/path/to/project' } }
  │
  ├─ 4. Server
  │     → sessionManager.createSession('/path/to/project')
  │     → 新建 V1QuerySession
  │     → session.send(prompt)
  │     → SDK query() 启动 → init 消息包含新 sessionId
  │     → sessionManager.registerActive(newSessionId, session)
  │
  ├─ 5. S2C: agent-message(init)
  │     → 前端从 init 消息提取 session_id
  │     → sessionStore.currentSessionId = newSessionId
  │     → WS: joinSession(newSessionId)
  │
  └─ 6. 后续消息正常流式
```

---

## 场景 12：多端同时连接同一会话（核心验证场景）

```
Client A (Chrome 标签页 1) 和 Client B (Chrome 标签页 2) 同时看 sess-001
  │
  ├─ 两者都已 join-session('sess-001')
  ├─ 两者都通过 REST 加载了历史消息
  │
  ├─ Client A 发消息 "Hello"
  │     → Client A: 本地追加用户气泡（乐观 UI）
  │     → Server 处理，流式输出
  │     → Client A: 收到 agent-message → messageStore.appendMessage/appendStreamDelta
  │     → Client B: 同时收到完全相同的 agent-message → 同样追加
  │     → 两个标签页显示完全一致的对话内容
  │
  ├─ 工具审批时
  │     → Client A (锁持有者): 看到 Allow/Deny 按钮
  │     → Client B: 看到只读审批展示 + "Waiting for operator..."
  │     → Client A 点击 Allow
  │     → Client B: 看到审批结果，继续看后续输出
  │
  └─ Client A 断线
        → 10s 内: Client B 继续看到输出（Agent 没停）
        → 10s 后: 锁释放，Client B 可以接管输入
```
