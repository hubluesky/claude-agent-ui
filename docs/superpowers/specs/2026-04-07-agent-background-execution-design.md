# Agent 后台执行 — 设计文档

## 背景

在移动端浏览器中切换/关闭浏览器后再回来，Agent 会话中断。用户需要重新发送消息才能继续。

### 根本原因

当 Agent 执行到需要用户审批的工具调用时，`canUseTool` hook 创建一个 Promise 等待客户端通过 WebSocket 响应。如果所有客户端断开：
1. `wsHub.sendTo()` 检测到 WebSocket 已关闭，静默丢弃审批请求
2. Promise 的 `resolve()` 永远不会被调用
3. Agent 的 `query()` 永远卡在 `await` 处 — 会话死锁

同样的问题存在于 `ask-user` 和 `plan-approval` 两个交互点。

即使 Agent 不需要审批（如 `bypassPermissions` 模式），客户端断开期间 Agent 产生的消息也会被 `wsHub.sendTo()` 丢弃，客户端重连后看不到这些消息。

## 设计目标

1. Agent 不依赖客户端在线，在服务端后台持续运行
2. 审批决策由服务端根据 PermissionMode 统一处理
3. 客户端断开期间的消息缓冲，重连后补发
4. 统一逻辑 — 不分"有客户端/无客户端"两条路径

## 架构设计

### 1. 统一审批决策流程

**核心原则**：服务端始终是审批决策者，客户端只是通知和交互渠道。

**统一流程**：

```
canUseTool(toolName, input)
    |
    v
getAutoDecision(toolName, input)  -- 服务端根据 PermissionMode 判断
    |
    ├── 返回 decision (auto/bypass/plan/dontAsk 等) --> 直接返回，Agent 继续
    |
    └── 返回 null (需要人工审批)
            |
            v
        创建 PendingApproval (存入 pendingApprovals Map)
            |
            v
        emit('tool-approval', ...) --> handler 通知所有在线客户端 (如果有)
            |
            v
        await Promise  <-- 等待任意来源的 resolve
            |
            ├── 客户端当场在线 --> 用户响应 --> resolve
            └── 客户端断开后重连 --> resendPendingRequests --> 用户响应 --> resolve
```

**改动要点**（`v1-session.ts`）：
- `getAutoDecision()` 逻辑不变（已经是服务端决策）
- Promise 创建逻辑不变 — 它本身不依赖客户端在线，只是 emit 后等 resolve
- 核心修复在 handler 层和 WSHub 层

**对 ask-user 和 plan-approval 同理**：
- `ask-user` 在所有模式下都需要人工响应（不能自动回答）
- `plan-approval` 在 plan 模式下需要人工响应
- 它们的 Promise 同样会安静地等待，直到客户端连接后响应

### 2. 消息缓冲与补发

**目标**：客户端断开期间 Agent 产生的消息不丢失，重连后按序补发。

**实现**：在 WSHub 层为每个 session 维护一个有序消息缓冲区。

#### 数据结构

```typescript
interface BufferedMessage {
  seq: number           // 递增序号
  message: S2CMessage   // 原始消息
  timestamp: number     // 时间戳
  isStreaming: boolean   // 是否为流式消息
}

// WSHub 新增
private sessionBuffers: Map<string, {
  messages: BufferedMessage[]
  nextSeq: number
  currentStreamSnapshot: S2CMessage | null  // 当前流式消息的累积快照
}>
```

#### 消息分类策略

| 消息类型 | 缓冲策略 |
|---------|---------|
| assistant (最终) | 缓冲 |
| tool_use / tool_result | 缓冲 |
| tool-approval-request | 缓冲（重连后重发） |
| ask-user-request | 缓冲（重连后重发） |
| plan-approval-request | 缓冲（重连后重发） |
| session-status | 缓冲（仅保留最新一条） |
| stream_event (delta) | 不缓冲，仅更新 currentStreamSnapshot |
| error | 缓冲 |

#### 流式消息处理

流式 delta 消息不逐条缓冲。WSHub 维护一个 `currentStreamSnapshot`：
- 收到 stream_event 时：更新 snapshot（累积文本）
- 流结束时：snapshot 清空（最终消息会作为 assistant 消息缓冲）
- 客户端重连时：如果有活跃 snapshot，先发送 snapshot 再发送后续缓冲消息

#### 重连补发流程

```
客户端重连 → join-session(sessionId, lastSeq?)
    |
    v
WSHub 查找 sessionBuffers[sessionId]
    |
    ├── lastSeq 存在 → 发送 seq > lastSeq 的消息
    └── lastSeq 不存在 → 发送全部缓冲消息
    |
    v
如果有 currentStreamSnapshot → 先发送 snapshot
    |
    v
按序发送缓冲消息
    |
    v
发送 resendPendingRequests（审批请求）
```

#### 流式 Snapshot 格式

当客户端重连时，如果 Agent 正在生成文本（有活跃的 stream），发送一个合成的 `stream-snapshot` 消息：

```typescript
{
  type: 'stream-snapshot',
  messageId: string,        // 当前正在生成的消息 ID
  accumulatedText: string,  // 已累积的文本
  thinking?: string,        // 已累积的 thinking 内容
}
```

客户端收到后渲染为"正在生成中"的消息，后续的 stream_event 继续追加。

#### 缓冲区管理

- 每个 session 一个缓冲区
- 最大缓冲 500 条消息，超出后丢弃最老的
- session 关闭/销毁时清理对应缓冲区
- 缓冲区消息保留 30 分钟，超时清理

### 3. Heartbeat 保活

**目的**：快速检测死连接（TCP keepalive 在移动网络上不可靠）。

**实现**：使用 WebSocket 协议级 ping/pong（`ws` 库原生支持）。

#### 服务端

```typescript
// WSHub 新增
private heartbeatInterval: NodeJS.Timeout

startHeartbeat() {
  this.heartbeatInterval = setInterval(() => {
    for (const [id, client] of this.clients) {
      if (!client.alive) {
        // 上次 ping 后没有收到 pong → 连接已死
        client.ws.terminate()
        this.unregister(id)
        continue
      }
      client.alive = false
      client.ws.ping()  // 协议级 ping
    }
  }, 30_000)  // 每 30 秒
}
```

#### 客户端

```typescript
// useWebSocket.ts
// ws 库的协议级 ping/pong 由浏览器 WebSocket 自动处理
// 但浏览器 WebSocket API 不支持 protocol-level ping
// 因此改用应用层心跳：

// 服务端每 30 秒发送 { type: 'ping' }
// 客户端收到后回复 { type: 'pong' }
// 客户端 60 秒未收到 ping → 触发主动重连
```

**注意**：浏览器 WebSocket API 不暴露协议级 ping/pong。需要用应用层消息。

#### 心跳消息

```typescript
// 新增 C2S/S2C 消息类型
type S2CMessage = ... | { type: 'ping' }
type C2SMessage = ... | { type: 'pong' }
```

### 4. 客户端 visibilitychange 处理（增强项）

**目的**：页面回到前台时立即检测连接状态，加速重连。

```typescript
// useWebSocket.ts 新增
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // 回到前台：立即检查 WebSocket 状态
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // 连接已断开，立即重连（不等待重试定时器）
      scheduleReconnect(/* immediate: true */)
    }
  }
})
```

这不是核心机制，是优化。核心保障由 heartbeat + 消息缓冲提供。

### 5. 审批与锁的解耦

**现状**：只有锁持有者能发送审批响应。

**问题**：如果锁持有者断开，60 秒后锁释放，新客户端需要先获取锁才能响应审批。

**改动**：审批响应不绑定锁。

- **锁**控制的是：谁能发送新的用户消息给 Agent（`send-message`）
- **审批响应**是对 Agent 已经发出的请求的回复，任何连接的客户端都可以响应
- 服务端 handler 中移除审批响应的锁检查

```
// handler.ts 现有：
case 'tool-approval-response':
  if (!lockManager.isHolder(connectionId, sessionId)) return  // ← 移除此检查
  handleToolApprovalResponse(...)
```

## 涉及的文件

| 文件 | 改动 |
|------|------|
| `packages/server/src/ws/hub.ts` | 新增消息缓冲区、心跳、重连补发 |
| `packages/server/src/ws/handler.ts` | 解耦审批与锁、join-session 传 lastSeq、心跳消息处理 |
| `packages/shared/src/protocol.ts` | 新增 ping/pong 消息类型、join-session 增加 lastSeq 字段 |
| `packages/web/src/hooks/useWebSocket.ts` | 心跳处理、visibilitychange、重连时发送 lastSeq |
| `packages/web/src/stores/connectionStore.ts` | 维护 lastSeq |

## 不涉及的改动

- `v1-session.ts` 的审批流程 — 现有 `getAutoDecision` + Promise 等待的设计本身是正确的，不需要改
- `SessionManager` — 会话生命周期管理不变
- `LockManager` — 锁的核心逻辑不变，只是审批响应不再检查锁

## 验证方案

1. **手动测试 — 移动端场景**：
   - 启动 Agent 任务（如 `bypassPermissions` 模式）
   - 在手机上切换到其他 App
   - 等待 1-2 分钟
   - 切回浏览器，验证 Agent 继续执行且消息补发正确

2. **手动测试 — 需要审批的场景**：
   - 使用 `default` 模式启动 Agent 任务
   - 当 Agent 请求工具审批时断开浏览器
   - 重新打开浏览器，验证审批请求自动弹出
   - 批准后 Agent 继续执行

3. **手动测试 — 心跳检测**：
   - 连接后观察浏览器 DevTools 中的 WebSocket 帧
   - 确认每 30 秒有 ping/pong 交换
   - 模拟网络断开（DevTools Network throttling → Offline）
   - 确认 60 秒内客户端检测到断开并尝试重连

4. **手动测试 — 消息缓冲**：
   - 在 `bypassPermissions` 模式下启动长任务
   - 断开 WebSocket（关闭浏览器标签）
   - 在另一个标签页重新打开
   - join-session 后验证断开期间的消息全部补发
