# Session Container 架构重构设计

## 背景与问题

当前 multi/single 模式切换时存在严重的**数据串台**问题：不同对话的消息显示在错误的 session tab，审批弹窗串台，流式内容跑到其他对话。

### 根因分析

串台发生在**前端**，后端 WSHub 的 per-session broadcast 机制本身是可靠的。前端的问题来自大量**模块级全局状态**充当共享管道：

| 全局状态 | 位置 | 风险 |
|---------|------|------|
| `_pendingDeltaText` / `_deltaRafId` | useWebSocket.ts 模块级 | 切换 session 时流式未结束，delta flush 到错误 session |
| `_streamContentAccumulator` | useWebSocket.ts 模块级 | content block 累积器无 session 隔离 |
| `connectionStore.pendingApproval` / `pendingAskUser` | 全局 store | 多 session 并发审批时只保存最后一个 |
| `messageStore.messages` | 全局 store | 切换瞬间存在竞态窗口 |

此外，`ChatSessionProvider` 区分 `independent=true`（multi）和 `independent=false`（single）两套数据路径，维护成本高且是串台的源头。

## 设计目标

1. **一个对话对应一个数据对象** — 从数据底层杜绝串台
2. **统一 single/multi 数据模型** — 消除两套路径
3. **工业化的后台对话管理** — 混合策略：running session 保持连接，idle session 断开但保留缓存
4. **精确的断线重连** — 基于 seq 的精确同步，gap 检测 + REST fallback

## 核心设计

### 1. SessionContainer 数据模型

每个 session 拥有一个独立的 `SessionContainer` 对象，所有 session 相关状态收敛到此对象中：

```typescript
interface SessionContainer {
  // === 身份 ===
  sessionId: string
  projectCwd: string

  // === 消息 ===
  messages: AgentMessage[]           // 完整消息列表（含 optimistic）

  // === 流式状态（mutable，不触发 React 更新） ===
  streamAccumulator: Map<number, { blockType: string; content: string }>
  pendingDelta: { text: string; rafId: number | null }

  // === 交互状态 ===
  pendingApproval: ToolApprovalRequest | null
  pendingAskUser: AskUserRequest | null
  pendingPlanApproval: PlanApprovalRequest | null

  // === 连接状态 ===
  sessionStatus: 'idle' | 'running' | 'error'
  lockStatus: 'idle' | 'locked_by_me' | 'locked_by_other'
  lockHolder: string | null

  // === 订阅管理 ===
  subscribed: boolean                // 当前是否 WS 订阅
  lastSeq: number                    // 消息序列号（用于重连 replay）
}
```

### 2. 顶层管理 Store

```typescript
// sessionContainerStore.ts — Zustand store
interface SessionContainerStore {
  containers: Map<string, SessionContainer>
  activeSessionId: string | null     // 当前前台 session

  // 生命周期
  getOrCreate(sessionId: string, cwd: string): SessionContainer
  remove(sessionId: string): void

  // 数据操作（所有操作通过 sessionId 路由）
  pushMessage(sessionId: string, msg: AgentMessage): void
  replaceMessages(sessionId: string, msgs: AgentMessage[]): void
  appendStreamingText(sessionId: string, text: string): void
  setApproval(sessionId: string, approval: ToolApprovalRequest | null): void
  setAskUser(sessionId: string, ask: AskUserRequest | null): void
  setPlanApproval(sessionId: string, plan: PlanApprovalRequest | null): void
  setSessionStatus(sessionId: string, status: SessionStatus): void
  setLockStatus(sessionId: string, lock: LockInfo): void

  // 订阅管理
  subscribe(sessionId: string): void
  unsubscribe(sessionId: string): void
}
```

### 3. LRU 淘汰

containers Map 分两层管理：

- **hot**: 当前 active + 所有 subscribed=true → 完整数据
- **cold**: 超过 maxHotContainers(10) 个不活跃 Container → 只保留元信息（sessionId, status, title）
- 切回 cold session → REST 重新加载 → 升级为 hot

### 4. `__new__` session 处理

用户输入第一条消息时：
1. 创建临时 Container (key = `'__new__'`)
2. 存入 optimistic user message
3. 发送 `send-message` (sessionId=null) 到服务端
4. 服务端创建 session，返回 `session-created { sessionId: 'real-id' }`
5. 前端：Container 实例不变，从 `containers['__new__']` 迁移到 `containers['real-id']`，更新 `activeSessionId`

## WebSocket 连接架构

### WebSocketManager 单例

保持**单 WebSocket 连接 + 多 session 订阅**模型，但用一个专门的 class 管理：

```typescript
class WebSocketManager {
  // 连接状态机
  private state: 'connecting' | 'connected' | 'disconnected'
  private ws: WebSocket | null
  private connectionId: string | null
  private previousConnectionId: string | null

  // 心跳
  private heartbeatInterval: 30_000  // 30s
  private heartbeatTimer: number | null

  // 重连
  private reconnectAttempt: number
  private reconnectTimer: number | null
  private maxReconnectDelay: 30_000  // 30s max backoff

  // 订阅路由表
  private subscriptions: Map<string, { lastSeq: number; active: boolean }>

  // 公开方法
  connect(): void
  disconnect(): void
  send(msg: C2SMessage): void
  subscribe(sessionId: string, lastSeq?: number): void
  unsubscribe(sessionId: string): void

  // 内部
  private handleMessage(msg: S2CMessage): void   // 路由到 Container
  private handleReconnect(): void                 // 恢复所有活跃订阅
  private handleVisibilityChange(): void          // 页面可见性感知
}
```

### 消息路由

```
WebSocketManager 收到消息
  → msg.sessionId 查找 → containerStore.getContainer(sessionId)
    → 找到 → 分发到对应 Container 的操作方法
    → 找不到 → 忽略（日志警告）
```

不再有全局中转变量。消息从 WS 直达对应 Container。

### 订阅生命周期（混合策略）

```
切换 session (A → B):
  ├─ B: subscribe (或已 subscribed → 零延迟)
  ├─ A.sessionStatus === 'running'
  │   → A 保持订阅 (subscribed=true)，继续接收消息
  └─ A.sessionStatus === 'idle'
      → A 取消订阅 (subscribed=false)
      → Container 保留，消息缓存不清

切回 A:
  ├─ A.subscribed === true (running，从未断)
  │   → 直接用 Container 数据渲染，零延迟
  └─ A.subscribed === false (idle，已断)
      → subscribe + lastSeq replay 补齐
      → 如果 buffer 已过期 → REST fallback 全量加载
```

## 断线重连机制

### 重连流程

```
1. 检测断线
   ├─ WebSocket close/error 事件
   ├─ 心跳超时 (30s 无 pong)
   └─ 页面从后台恢复时检查连接状态

2. 进入重连
   ├─ 所有 Container 状态不动（消息、审批状态保留）
   ├─ UI 显示全局连接状态指示器
   └─ 指数退避：min(1000 * 2^attempt, 30000)

3. 重连成功
   ├─ 发送 reconnect { previousConnectionId }
   ├─ 服务端迁移锁持有者
   ├─ 遍历 subscriptions Map：
   │   对每个 active=true 的 sessionId：
   │   ├─ 发送 subscribe-session { sessionId, lastSeq }
   │   ├─ 服务端 subscribeWithSync() 返回 replay + gap 检测
   │   └─ Container 接收 replay 消息，UUID 去重
   └─ 连接状态恢复正常

4. 页面可见性优化
   ├─ 隐藏 → 暂停心跳
   ├─ 可见 → 立即检查连接
   │   ├─ 存活 → 恢复心跳
   │   └─ 已断 → 跳过退避，立即重连
   └─ 长时间后台 (>5min) → 重连后全量 replay
```

### 精确消息同步机制

后端新增 `subscribeWithSync()` 方法：

```typescript
interface SubscribeResult {
  replayed: number          // replay 了多少条
  hasGap: boolean           // 是否有消息空洞
  gapRange?: [number, number]  // 空洞范围
  streamSnapshot?: StreamSnapshot  // 正在进行的流式快照
}

subscribeWithSync(connectionId, sessionId, lastSeq): SubscribeResult {
  const buffer = this.sessionBuffers.get(sessionId)
  if (!buffer || buffer.messages.length === 0) {
    return { replayed: 0, hasGap: lastSeq > 0 }
  }

  const minBufferedSeq = buffer.messages[0].seq
  const hasGap = lastSeq > 0 && minBufferedSeq > lastSeq + 1

  // Replay seq > lastSeq 的消息
  const missed = buffer.messages.filter(m => m.seq > lastSeq)
  for (const entry of missed) {
    this.sendTo(connectionId, { ...entry.message, _seq: entry.seq })
  }

  // Stream snapshot（如果正在流式输出）
  const streamSnapshot = buffer.activeStream
    ? { blocks: [...buffer.activeStream.entries()], messageId: buffer.activeStreamMessageId }
    : undefined

  return { replayed: missed.length, hasGap, gapRange: hasGap ? [lastSeq + 1, minBufferedSeq - 1] : undefined, streamSnapshot }
}
```

客户端处理：

- 正常 replay → Container.pushMessage + UUID 去重 + lastSeq 更新
- sync-gap → REST 全量加载 → replaceMessages
- stream-snapshot → 恢复 streamAccumulator → 继续接收后续 delta
- 服务端重启（seq 归零）→ 触发 gap → REST 全量（低频事件，可接受）

### 流式恢复三种情况

| 情况 | 断线时 | 重连时 | 处理 |
|------|--------|--------|------|
| A | 流式进行中 | 仍在流式 | stream-snapshot 恢复 + 后续 delta |
| B | 流式进行中 | 已结束 | snapshot=null, buffer replay 包含 final message |
| C | 流式已结束 | — | 纯 buffer replay |

## 流式 Delta 的 React 桥接

流式 delta 是高频 mutable 操作，不能每次都触发 React 更新。采用 per-container RAF 批处理：

```typescript
// Container 实例方法
appendDelta(text: string) {
  this.pendingDelta.text += text
  if (!this.pendingDelta.rafId) {
    this.pendingDelta.rafId = requestAnimationFrame(() => {
      // flush 到 Zustand store → 触发 React 更新
      containerStore.appendStreamingText(this.sessionId, this.pendingDelta.text)
      this.pendingDelta.text = ''
      this.pendingDelta.rafId = null
    })
  }
}
```

关键：这和现有的 `_pendingDeltaText` 机制原理相同，但从全局变量变成了 per-container 实例变量，**物理隔离，不可能串台**。

## Single/Multi 统一

```
Single 模式:
  ├─ 渲染 1 个 ChatInterface(sessionId = activeSessionId)
  ├─ 该 session 的 Container subscribed=true
  ├─ 后台 running session 也 subscribed=true（不渲染面板）
  ├─ 后台 idle session subscribed=false（Container 保留数据）
  └─ 切换 session → 切换 activeSessionId → React 重新 select 对应 Container

Multi 模式:
  ├─ 渲染 N 个 ChatInterface(sessionId = panelSessionIds[i])
  ├─ 每个面板的 Container 都 subscribed=true
  └─ 完全相同的代码路径，数量不同

ChatInterface 不知道也不关心自己在 single 还是 multi 模式下。
它只接收 sessionId prop，然后 useContainer(sessionId) 取数据。
```

## 文件变更清单

### 前端

| 文件 | 操作 | 说明 |
|------|------|------|
| `stores/sessionContainerStore.ts` | **新建** | 核心 store：containers Map + 所有 per-session 操作 |
| `lib/WebSocketManager.ts` | **新建** | WS 连接管理单例：状态机、心跳、重连、订阅路由、消息分发 |
| `hooks/useContainer.ts` | **新建** | React hook：`useContainer(sessionId)` 返回 Container 数据 |
| `hooks/useWebSocket.ts` | **删除** | 被 WebSocketManager + useContainer 替代 |
| `stores/messageStore.ts` | **删除** | 被 sessionContainerStore 替代 |
| `stores/connectionStore.ts` | **删除** | 审批/锁状态收入 Container |
| `providers/ChatSessionProvider.tsx` | **大幅简化** | 不再区分 independent/非 independent |
| `components/chat/ChatInterface.tsx` | **简化** | 去掉 `isNewToReal` 等特殊分支 |
| `components/chat/ChatMessagesPane.tsx` | **小改** | 数据源改为 `useContainer` |
| `components/chat/StatusBar.tsx` | **小改** | 从 Container 读 sessionStatus |
| `components/layout/BackgroundStatusDropdown.tsx` | **小改** | 从 containers Map 读后台 session 状态 |

### 后端

| 文件 | 操作 | 说明 |
|------|------|------|
| `ws/hub.ts` | **增强** | 新增 `subscribeWithSync()` 返回 gap 检测 + stream snapshot |
| `ws/handler.ts` | **小改** | `subscribe-session` 处理增加 sync 响应 |
| 其他后端文件 | **不变** | SessionManager、LockManager、V1Session 无需改动 |

## 设计约束

- WebSocket 保持单连接多订阅模型
- 后端改动最小化——核心重构在前端
- Container LRU 淘汰上限 10 个 hot container
- 服务端 buffer: 500 条 / 30min TTL（现有配置不变）
- seq 不持久化，服务端重启后通过 sync-gap → REST 全量恢复
