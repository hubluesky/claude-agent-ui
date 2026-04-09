# Session Container 架构重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消灭前端全局状态串台，统一 single/multi 数据模型，用 per-session SessionContainer 对象替代全局 messageStore + connectionStore，用 WebSocketManager class 替代 useWebSocket hook 中的模块级状态。

**Architecture:** 创建 `sessionContainerStore` (Zustand) 持有 `Map<sessionId, SessionContainer>`，每个 Container 独立持有消息、审批状态、流式累积器、连接状态。`WebSocketManager` 单例 class 管理 WS 连接和消息路由，按 `msg.sessionId` 直接分发到对应 Container。后端小幅增强 `subscribeWithSync()` 支持 gap 检测和 stream snapshot。

**Tech Stack:** TypeScript, Zustand 5, React 19, Fastify WebSocket

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/web/src/stores/sessionContainerStore.ts` | 核心 store：containers Map + 所有 per-session 数据操作 + LRU 淘汰 |
| `packages/web/src/lib/WebSocketManager.ts` | WS 连接管理单例 class：状态机、心跳、重连、订阅路由、消息分发到 Container |
| `packages/web/src/hooks/useContainer.ts` | React hook：按 sessionId 从 containerStore 取数据的 selector |

### Delete Files
| File | Replaced By |
|------|------------|
| `packages/web/src/stores/messageStore.ts` | sessionContainerStore (messages + streaming) |
| `packages/web/src/stores/connectionStore.ts` | sessionContainerStore (approvals, lock, status) + WebSocketManager (connectionId, connectionStatus) |
| `packages/web/src/hooks/useWebSocket.ts` | WebSocketManager + useContainer |

### Modify Files
| File | Change Scope |
|------|-------------|
| `packages/web/src/providers/ChatSessionProvider.tsx` | 大幅简化：去掉 independent 分支，统一从 Container 取数据 |
| `packages/web/src/providers/ChatSessionContext.tsx` | 更新 context value 类型（如果需要） |
| `packages/web/src/components/chat/ChatInterface.tsx` | 简化 session 切换逻辑，去掉 isNewToReal 等特殊分支 |
| `packages/web/src/components/chat/ChatMessagesPane.tsx` | 数据源从 useMessageStore 改为 context |
| `packages/web/src/components/chat/ChatComposer.tsx` | 替换 connectionStore/useWebSocket 引用 |
| `packages/web/src/components/chat/StatusBar.tsx` | 替换 connectionStore 引用 |
| `packages/web/src/components/chat/MessageComponent.tsx` | 替换 connectionStore/useWebSocket 引用 |
| `packages/web/src/components/chat/ModelSelector.tsx` | 替换 connectionStore/useWebSocket 引用 |
| `packages/web/src/components/chat/ComposerToolbar.tsx` | 替换 connectionStore/useWebSocket 引用 |
| `packages/web/src/components/chat/McpPanel.tsx` | 替换 connectionStore/useWebSocket 引用 |
| `packages/web/src/components/chat/ContextPanel.tsx` | 替换 connectionStore/useWebSocket 引用 |
| `packages/web/src/components/chat/SearchBar.tsx` | 替换 messageStore 引用 |
| `packages/web/src/components/layout/BackgroundStatusDropdown.tsx` | 从 containers Map 读后台 session 状态 |
| `packages/web/src/hooks/useClaimLock.ts` | 替换 useWebSocket 引用 |
| `packages/web/src/App.tsx` | 简化 Provider 用法 |
| `packages/web/src/components/chat/MultiPanelGrid.tsx` | 简化 Provider 用法 |
| `packages/server/src/ws/hub.ts` | 新增 subscribeWithSync() |
| `packages/server/src/ws/handler.ts` | subscribe-session 增加 sync 响应 |
| `packages/shared/src/protocol.ts` | 新增 sync-gap 和 subscribe-session-result 消息类型 |

---

## Task 1: 新增 shared 协议类型

**Files:**
- Modify: `packages/shared/src/protocol.ts`

这一步为后续的 subscribeWithSync 和前端同步机制准备协议类型。

- [ ] **Step 1: 在 protocol.ts 中新增 C2S subscribe-session 的 lastSeq 字段**

当前 `C2S_SubscribeSession` 只有 `type` 和 `sessionId`。需要添加 `lastSeq` 字段：

```typescript
// 在 C2S_SubscribeSession 类型中添加 lastSeq
export interface C2S_SubscribeSession {
  type: 'subscribe-session'
  sessionId: string
  lastSeq?: number  // 新增：客户端最后收到的 seq，用于精确 replay
}
```

同样更新 `C2S_JoinSession`：

```typescript
export interface C2S_JoinSession {
  type: 'join-session'
  sessionId: string
  lastSeq?: number  // 新增
}
```

- [ ] **Step 2: 新增 S2C sync-result 消息类型**

```typescript
export interface S2C_SyncResult {
  type: 'sync-result'
  sessionId: string
  replayed: number
  hasGap: boolean
  gapRange?: [number, number]
}

// 添加到 S2CMessage union 中
```

- [ ] **Step 3: 构建 shared 包验证类型正确**

Run: `pnpm --filter @claude-agent-ui/shared build`
Expected: 成功，无类型错误

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/protocol.ts
git commit -m "feat: add lastSeq to subscribe/join protocol and sync-result message type"
```

---

## Task 2: 后端 subscribeWithSync

**Files:**
- Modify: `packages/server/src/ws/hub.ts`
- Modify: `packages/server/src/ws/handler.ts`

- [ ] **Step 1: 在 hub.ts 中新增 subscribeWithSync 方法**

在 `WSHub` class 中添加，位于 `subscribeSession` 方法之后：

```typescript
subscribeWithSync(
  connectionId: string,
  sessionId: string,
  lastSeq: number = 0,
): { replayed: number; hasGap: boolean; gapRange?: [number, number] } {
  // 先执行普通订阅
  this.subscribeSession(connectionId, sessionId)

  const buf = this.sessionBuffers.get(sessionId)
  if (!buf || buf.messages.length === 0) {
    return { replayed: 0, hasGap: lastSeq > 0 }
  }

  // 清理过期消息
  const now = Date.now()
  buf.messages = buf.messages.filter(m => now - m.timestamp < BUFFER_TTL_MS)

  if (buf.messages.length === 0) {
    return { replayed: 0, hasGap: lastSeq > 0 }
  }

  const minBufferedSeq = buf.messages[0].seq
  const hasGap = lastSeq > 0 && minBufferedSeq > lastSeq + 1

  // Replay missed messages
  const missed = buf.messages.filter(m => m.seq > lastSeq)
  for (const entry of missed) {
    this.sendTo(connectionId, { ...entry.message, _seq: entry.seq } as any)
  }

  return {
    replayed: missed.length,
    hasGap,
    gapRange: hasGap ? [lastSeq + 1, minBufferedSeq - 1] : undefined,
  }
}
```

同样新增 `joinWithSync` 方法（与 `subscribeWithSync` 逻辑相同，但调用 `joinSession` 而非 `subscribeSession`）：

```typescript
joinWithSync(
  connectionId: string,
  sessionId: string,
  lastSeq: number = 0,
): { replayed: number; hasGap: boolean; gapRange?: [number, number] } {
  this.joinSession(connectionId, sessionId)

  const buf = this.sessionBuffers.get(sessionId)
  if (!buf || buf.messages.length === 0) {
    return { replayed: 0, hasGap: lastSeq > 0 }
  }

  const now = Date.now()
  buf.messages = buf.messages.filter(m => now - m.timestamp < BUFFER_TTL_MS)

  if (buf.messages.length === 0) {
    return { replayed: 0, hasGap: lastSeq > 0 }
  }

  const minBufferedSeq = buf.messages[0].seq
  const hasGap = lastSeq > 0 && minBufferedSeq > lastSeq + 1

  const missed = buf.messages.filter(m => m.seq > lastSeq)
  for (const entry of missed) {
    this.sendTo(connectionId, { ...entry.message, _seq: entry.seq } as any)
  }

  return {
    replayed: missed.length,
    hasGap,
    gapRange: hasGap ? [lastSeq + 1, minBufferedSeq - 1] : undefined,
  }
}
```

- [ ] **Step 2: 更新 handler.ts 中的 handleSubscribeSession**

找到 `handleSubscribeSession` 函数，替换为使用 `subscribeWithSync`：

```typescript
async function handleSubscribeSession(connectionId: string, sessionId: string, lastSeq?: number) {
  const syncResult = wsHub.subscribeWithSync(connectionId, sessionId, lastSeq ?? 0)

  // 发送 session state（保留现有逻辑）
  const session = sessionManager.getActive(sessionId)
  const lockInfo = lockManager.getStatus(sessionId)
  wsHub.sendTo(connectionId, {
    type: 'session-state',
    sessionId,
    sessionStatus: session?.status ?? 'idle',
    lockStatus: lockInfo.status,
    lockHolderId: lockInfo.holderId ?? null,
  } as any)

  // 发送 stream snapshot（保留现有逻辑）
  const snapshot = wsHub.getStreamSnapshot(sessionId)
  if (snapshot) {
    wsHub.sendTo(connectionId, {
      type: 'stream-snapshot',
      sessionId,
      blocks: snapshot.blocks,
      messageId: snapshot.messageId,
    } as any)
  }

  // 新增：发送 sync-result
  wsHub.sendTo(connectionId, {
    type: 'sync-result',
    sessionId,
    replayed: syncResult.replayed,
    hasGap: syncResult.hasGap,
    gapRange: syncResult.gapRange,
  } as any)
}
```

同样更新 `handleJoinSession` 使用 `joinWithSync` 并发送 `sync-result`。

- [ ] **Step 3: 更新 handleJoinSession 接受 lastSeq 参数**

在 handler.ts 中的消息路由 switch 里，`join-session` case 传入 `lastSeq`：

```typescript
case 'join-session':
  handleJoinSession(connectionId, msg.sessionId, msg.lastSeq)
  break
case 'subscribe-session':
  handleSubscribeSession(connectionId, msg.sessionId, msg.lastSeq)
  break
```

- [ ] **Step 4: 构建 server 验证**

Run: `pnpm --filter @claude-agent-ui/server build`
Expected: 成功

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/ws/hub.ts packages/server/src/ws/handler.ts
git commit -m "feat: add subscribeWithSync and joinWithSync with gap detection to WSHub"
```

---

## Task 3: 创建 sessionContainerStore

**Files:**
- Create: `packages/web/src/stores/sessionContainerStore.ts`

这是整个重构的核心——per-session 数据容器 + Zustand store。

- [ ] **Step 1: 创建 SessionContainer 接口和 store 骨架**

```typescript
import { create } from 'zustand'
import type {
  AgentMessage,
  SessionStatus,
  ClientLockStatus,
  ToolApprovalRequest,
  AskUserRequest,
  PlanApprovalRequest,
  ContextUsageCategory,
  McpServerStatusInfo,
} from '@claude-agent-ui/shared'

// ─── 从 connectionStore 迁移的类型 ───

export interface ModelInfo {
  value: string
  displayName: string
  description: string
  supportsAutoMode?: boolean
  supportedEffortLevels?: string[]
}

export interface AccountInfo {
  email?: string
  organization?: string
  subscriptionType?: string
  apiProvider?: string
  model?: string
}

export interface ContextUsage {
  categories: ContextUsageCategory[]
  totalTokens: number
  maxTokens: number
  percentage: number
  model: string
}

export type McpServerInfo = McpServerStatusInfo

export interface ResolvedPlanApproval {
  planContent: string
  planFilePath: string
  allowedPrompts: { tool: string; prompt: string }[]
  decision: string
}

// ─── SessionContainer ───

export interface SessionContainer {
  // 身份
  sessionId: string
  projectCwd: string

  // 消息
  messages: AgentMessage[]
  hasMore: boolean
  isLoadingHistory: boolean
  isLoadingMore: boolean

  // 交互状态
  pendingApproval: (ToolApprovalRequest & { readonly: boolean }) | null
  pendingAskUser: (AskUserRequest & { readonly: boolean }) | null
  pendingPlanApproval: (PlanApprovalRequest & { readonly: boolean; contextUsagePercent?: number }) | null
  resolvedPlanApproval: ResolvedPlanApproval | null
  planModalOpen: boolean

  // 连接状态（per-session 部分）
  sessionStatus: SessionStatus
  lockStatus: ClientLockStatus
  lockHolder: string | null

  // 数据附件
  contextUsage: ContextUsage | null
  mcpServers: McpServerInfo[]
  rewindPreview: { filesChanged?: string[]; insertions?: number; deletions?: number; canRewind?: boolean; error?: string } | null
  subagentMessages: { agentId: string; messages: any[] } | null

  // 订阅管理
  subscribed: boolean
  lastSeq: number
  needsFullSync: boolean
}

// ─── 流式 mutable 状态（不放进 Zustand，per-container 实例） ───

export class StreamState {
  accumulator = new Map<number, { blockType: string; content: string }>()
  pendingDeltaText = ''
  pendingDeltaRafId: number | null = null

  clear() {
    this.accumulator.clear()
    this.pendingDeltaText = ''
    if (this.pendingDeltaRafId !== null) {
      cancelAnimationFrame(this.pendingDeltaRafId)
      this.pendingDeltaRafId = null
    }
  }
}

// ─── 全局（非 per-session）连接状态 ───

export interface GlobalConnectionState {
  connectionId: string | null
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
  accountInfo: AccountInfo | null
  models: ModelInfo[]
}

const MAX_HOT_CONTAINERS = 10

function createContainer(sessionId: string, cwd: string): SessionContainer {
  return {
    sessionId,
    projectCwd: cwd,
    messages: [],
    hasMore: false,
    isLoadingHistory: false,
    isLoadingMore: false,
    pendingApproval: null,
    pendingAskUser: null,
    pendingPlanApproval: null,
    resolvedPlanApproval: null,
    planModalOpen: false,
    sessionStatus: 'idle',
    lockStatus: 'idle',
    lockHolder: null,
    contextUsage: null,
    mcpServers: [],
    rewindPreview: null,
    subagentMessages: null,
    subscribed: false,
    lastSeq: 0,
    needsFullSync: false,
  }
}

// ─── Store ───

interface SessionContainerStoreState {
  containers: Map<string, SessionContainer>
  streamStates: Map<string, StreamState>  // mutable，不触发 React 更新
  activeSessionId: string | null

  // 全局连接状态（不属于任何 session）
  global: GlobalConnectionState
}

interface SessionContainerStoreActions {
  // 生命周期
  getOrCreate(sessionId: string, cwd: string): SessionContainer
  remove(sessionId: string): void
  setActiveSession(sessionId: string | null): void
  migrateContainer(fromId: string, toId: string): void  // __new__ → real-id

  // 消息操作
  pushMessage(sessionId: string, msg: AgentMessage): void
  replaceMessages(sessionId: string, msgs: AgentMessage[], hasMore: boolean): void
  replaceOptimistic(sessionId: string, serverMsg: AgentMessage): void
  setLoadingHistory(sessionId: string, loading: boolean): void
  setLoadingMore(sessionId: string, loading: boolean): void
  setHasMore(sessionId: string, hasMore: boolean): void
  appendStreamingText(sessionId: string, text: string): void
  clearMessages(sessionId: string): void

  // 交互状态
  setApproval(sessionId: string, approval: SessionContainer['pendingApproval']): void
  setAskUser(sessionId: string, ask: SessionContainer['pendingAskUser']): void
  setPlanApproval(sessionId: string, plan: SessionContainer['pendingPlanApproval']): void
  setResolvedPlanApproval(sessionId: string, resolved: ResolvedPlanApproval | null): void
  setPlanModalOpen(sessionId: string, open: boolean): void

  // 连接状态
  setSessionStatus(sessionId: string, status: SessionStatus): void
  setLockStatus(sessionId: string, lockStatus: ClientLockStatus, holder: string | null): void
  setContextUsage(sessionId: string, usage: ContextUsage | null): void
  setMcpServers(sessionId: string, servers: McpServerInfo[]): void
  setRewindPreview(sessionId: string, preview: SessionContainer['rewindPreview']): void
  setSubagentMessages(sessionId: string, data: SessionContainer['subagentMessages']): void

  // 订阅管理
  setSubscribed(sessionId: string, subscribed: boolean): void
  setLastSeq(sessionId: string, seq: number): void
  setNeedsFullSync(sessionId: string, needs: boolean): void

  // 全局
  setGlobal(updates: Partial<GlobalConnectionState>): void

  // 会话重置（仅重置交互状态，不清消息）
  resetSessionInteraction(sessionId: string): void

  // 获取流式状态（mutable ref）
  getStreamState(sessionId: string): StreamState
}

export const useSessionContainerStore = create<SessionContainerStoreState & SessionContainerStoreActions>(
  (set, get) => ({
    containers: new Map(),
    streamStates: new Map(),
    activeSessionId: null,
    global: {
      connectionId: null,
      connectionStatus: 'disconnected',
      accountInfo: null,
      models: [],
    },

    getOrCreate(sessionId, cwd) {
      const { containers } = get()
      const existing = containers.get(sessionId)
      if (existing) return existing
      const container = createContainer(sessionId, cwd)
      const next = new Map(containers)
      next.set(sessionId, container)
      // LRU 淘汰
      if (next.size > MAX_HOT_CONTAINERS) {
        const { activeSessionId } = get()
        for (const [id, c] of next) {
          if (next.size <= MAX_HOT_CONTAINERS) break
          if (id !== activeSessionId && !c.subscribed) {
            next.delete(id)
            get().streamStates.delete(id)
          }
        }
      }
      set({ containers: next })
      return container
    },

    remove(sessionId) {
      const next = new Map(get().containers)
      next.delete(sessionId)
      get().streamStates.get(sessionId)?.clear()
      get().streamStates.delete(sessionId)
      set({ containers: next })
    },

    setActiveSession(sessionId) {
      set({ activeSessionId: sessionId })
    },

    migrateContainer(fromId, toId) {
      const { containers, streamStates } = get()
      const container = containers.get(fromId)
      if (!container) return
      const nextContainers = new Map(containers)
      nextContainers.delete(fromId)
      nextContainers.set(toId, { ...container, sessionId: toId })
      const nextStreams = new Map(streamStates)
      const stream = nextStreams.get(fromId)
      if (stream) {
        nextStreams.delete(fromId)
        nextStreams.set(toId, stream)
      }
      set({
        containers: nextContainers,
        streamStates: nextStreams,
        activeSessionId: get().activeSessionId === fromId ? toId : get().activeSessionId,
      })
    },

    // ─── 消息操作 ───

    pushMessage(sessionId, msg) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c) return
      // UUID 去重
      if (msg.uuid && c.messages.some(m => m.uuid === msg.uuid)) return
      const next = new Map(containers)
      next.set(sessionId, { ...c, messages: [...c.messages, msg] })
      set({ containers: next })
    },

    replaceMessages(sessionId, msgs, hasMore) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c) return
      const next = new Map(containers)
      next.set(sessionId, { ...c, messages: msgs, hasMore, isLoadingHistory: false })
      set({ containers: next })
    },

    replaceOptimistic(sessionId, serverMsg) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c) return
      const idx = c.messages.findIndex(
        m => m.type === 'user' && (m as any)._optimistic === true,
      )
      const newMessages = [...c.messages]
      if (idx >= 0) {
        newMessages[idx] = serverMsg
      } else {
        // UUID 去重
        if (serverMsg.uuid && newMessages.some(m => m.uuid === serverMsg.uuid)) return
        newMessages.push(serverMsg)
      }
      const next = new Map(containers)
      next.set(sessionId, { ...c, messages: newMessages })
      set({ containers: next })
    },

    setLoadingHistory(sessionId, loading) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c) return
      const next = new Map(containers)
      next.set(sessionId, { ...c, isLoadingHistory: loading })
      set({ containers: next })
    },

    setLoadingMore(sessionId, loading) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c) return
      const next = new Map(containers)
      next.set(sessionId, { ...c, isLoadingMore: loading })
      set({ containers: next })
    },

    setHasMore(sessionId, hasMore) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c) return
      const next = new Map(containers)
      next.set(sessionId, { ...c, hasMore })
      set({ containers: next })
    },

    appendStreamingText(sessionId, text) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c || c.messages.length === 0) return
      const lastMsg = c.messages[c.messages.length - 1]
      if (lastMsg.type !== 'assistant') return
      // 克隆最后一条消息并追加文本
      const newMsg = { ...lastMsg }
      const blocks = Array.isArray((newMsg as any).content) ? [...(newMsg as any).content] : []
      const lastBlock = blocks.length > 0 ? { ...blocks[blocks.length - 1] } : null
      if (lastBlock && lastBlock.type === 'text') {
        lastBlock.text = (lastBlock.text || '') + text
        blocks[blocks.length - 1] = lastBlock
      }
      ;(newMsg as any).content = blocks
      const newMessages = [...c.messages]
      newMessages[newMessages.length - 1] = newMsg
      const next = new Map(containers)
      next.set(sessionId, { ...c, messages: newMessages })
      set({ containers: next })
    },

    clearMessages(sessionId) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c) return
      get().getStreamState(sessionId).clear()
      const next = new Map(containers)
      next.set(sessionId, { ...c, messages: [], hasMore: false })
      set({ containers: next })
    },

    // ─── 交互状态 ───

    setApproval(sessionId, approval) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c) return
      const next = new Map(containers)
      next.set(sessionId, { ...c, pendingApproval: approval })
      set({ containers: next })
    },

    setAskUser(sessionId, ask) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c) return
      const next = new Map(containers)
      next.set(sessionId, { ...c, pendingAskUser: ask })
      set({ containers: next })
    },

    setPlanApproval(sessionId, plan) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c) return
      const next = new Map(containers)
      next.set(sessionId, { ...c, pendingPlanApproval: plan })
      set({ containers: next })
    },

    setResolvedPlanApproval(sessionId, resolved) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c) return
      const next = new Map(containers)
      next.set(sessionId, { ...c, resolvedPlanApproval: resolved })
      set({ containers: next })
    },

    setPlanModalOpen(sessionId, open) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c) return
      const next = new Map(containers)
      next.set(sessionId, { ...c, planModalOpen: open })
      set({ containers: next })
    },

    // ─── 连接状态 ───

    setSessionStatus(sessionId, status) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c) return
      const next = new Map(containers)
      next.set(sessionId, { ...c, sessionStatus: status })
      set({ containers: next })
    },

    setLockStatus(sessionId, lockStatus, holder) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c) return
      const next = new Map(containers)
      next.set(sessionId, { ...c, lockStatus, lockHolder: holder })
      set({ containers: next })
    },

    setContextUsage(sessionId, usage) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c) return
      const next = new Map(containers)
      next.set(sessionId, { ...c, contextUsage: usage })
      set({ containers: next })
    },

    setMcpServers(sessionId, servers) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c) return
      const next = new Map(containers)
      next.set(sessionId, { ...c, mcpServers: servers })
      set({ containers: next })
    },

    setRewindPreview(sessionId, preview) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c) return
      const next = new Map(containers)
      next.set(sessionId, { ...c, rewindPreview: preview })
      set({ containers: next })
    },

    setSubagentMessages(sessionId, data) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c) return
      const next = new Map(containers)
      next.set(sessionId, { ...c, subagentMessages: data })
      set({ containers: next })
    },

    // ─── 订阅管理 ───

    setSubscribed(sessionId, subscribed) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c) return
      const next = new Map(containers)
      next.set(sessionId, { ...c, subscribed })
      set({ containers: next })
    },

    setLastSeq(sessionId, seq) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c) return
      const next = new Map(containers)
      next.set(sessionId, { ...c, lastSeq: seq })
      set({ containers: next })
    },

    setNeedsFullSync(sessionId, needs) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c) return
      const next = new Map(containers)
      next.set(sessionId, { ...c, needsFullSync: needs })
      set({ containers: next })
    },

    // ─── 全局 ───

    setGlobal(updates) {
      set({ global: { ...get().global, ...updates } })
    },

    resetSessionInteraction(sessionId) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c) return
      const next = new Map(containers)
      next.set(sessionId, {
        ...c,
        lockStatus: 'idle',
        lockHolder: null,
        sessionStatus: 'idle',
        pendingApproval: null,
        pendingAskUser: null,
        pendingPlanApproval: null,
        resolvedPlanApproval: null,
        planModalOpen: false,
      })
      set({ containers: next })
    },

    getStreamState(sessionId) {
      const { streamStates } = get()
      let ss = streamStates.get(sessionId)
      if (!ss) {
        ss = new StreamState()
        streamStates.set(sessionId, ss)
      }
      return ss
    },
  }),
)
```

- [ ] **Step 2: 验证类型编译通过**

Run: `cd packages/web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: 无与 sessionContainerStore 相关的错误（其他文件可能有已有错误）

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/stores/sessionContainerStore.ts
git commit -m "feat: create sessionContainerStore with per-session Container model"
```

---

## Task 4: 创建 useContainer hook

**Files:**
- Create: `packages/web/src/hooks/useContainer.ts`

为 React 组件提供类型安全的 per-session 数据访问。

- [ ] **Step 1: 创建 useContainer hook**

```typescript
import { useSessionContainerStore } from '../stores/sessionContainerStore'
import type { SessionContainer } from '../stores/sessionContainerStore'
import { useShallow } from 'zustand/react/shallow'

/**
 * 按 sessionId 从 containerStore 取 Container 数据。
 * 返回 null 如果 Container 不存在。
 */
export function useContainer(sessionId: string | null): SessionContainer | null {
  return useSessionContainerStore(
    useShallow((s) => (sessionId ? s.containers.get(sessionId) ?? null : null)),
  )
}

/**
 * 取 Container 中的单个字段，避免不必要的 re-render。
 */
export function useContainerField<K extends keyof SessionContainer>(
  sessionId: string | null,
  field: K,
): SessionContainer[K] | undefined {
  return useSessionContainerStore(
    (s) => (sessionId ? s.containers.get(sessionId)?.[field] : undefined),
  )
}

/**
 * 取全局连接状态。
 */
export function useGlobalConnection() {
  return useSessionContainerStore(useShallow((s) => s.global))
}

/**
 * 取活跃 sessionId。
 */
export function useActiveSessionId() {
  return useSessionContainerStore((s) => s.activeSessionId)
}
```

- [ ] **Step 2: 验证类型编译通过**

Run: `cd packages/web && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: 无新增类型错误

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/hooks/useContainer.ts
git commit -m "feat: create useContainer hook for per-session data access"
```

---

## Task 5: 创建 WebSocketManager

**Files:**
- Create: `packages/web/src/lib/WebSocketManager.ts`

这是替代 `useWebSocket.ts` 的核心——一个独立于 React 的单例 class。

- [ ] **Step 1: 创建 WebSocketManager class 骨架**

```typescript
import type { C2SMessage, S2CMessage, ToolApprovalDecision, PlanApprovalDecisionType } from '@claude-agent-ui/shared'
import { useSessionContainerStore } from '../stores/sessionContainerStore'
import { useSessionStore } from '../stores/sessionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { fetchSessionMessages } from './api'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

class WebSocketManager {
  private ws: WebSocket | null = null
  private state: ConnectionState = 'disconnected'
  private connectionId: string | null = null
  private previousConnectionId: string | null = null

  // 心跳
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null
  private readonly HEARTBEAT_TIMEOUT = 30_000

  // 重连
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private readonly MAX_RECONNECT_DELAY = 30_000
  private reconnectingBannerTimer: ReturnType<typeof setTimeout> | null = null

  // 页面可见性
  private visibilityHandler: (() => void) | null = null
  private lastBackgroundTime = 0

  // ─── Public API ───

  connect() {
    if (this.state === 'connected' || this.state === 'connecting') return
    this.setState(this.previousConnectionId ? 'reconnecting' : 'connecting')
    this.doConnect()
  }

  disconnect() {
    this.clearTimers()
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
    this.setState('disconnected')
    this.removeVisibilityListener()
  }

  send(msg: C2SMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  /**
   * 订阅 session 的 WS 消息。用于切换到 session 或保持后台 running session。
   */
  subscribe(sessionId: string, lastSeq: number = 0) {
    this.send({ type: 'subscribe-session', sessionId, lastSeq } as any)
    useSessionContainerStore.getState().setSubscribed(sessionId, true)
  }

  /**
   * 取消订阅。用于离开 idle session。
   */
  unsubscribe(sessionId: string) {
    this.send({ type: 'unsubscribe-session', sessionId } as any)
    useSessionContainerStore.getState().setSubscribed(sessionId, false)
  }

  /**
   * Join session（作为 primary session）。
   */
  joinSession(sessionId: string, lastSeq: number = 0) {
    this.send({ type: 'join-session', sessionId, lastSeq } as any)
    useSessionContainerStore.getState().setSubscribed(sessionId, true)
  }

  leaveSession() {
    this.send({ type: 'leave-session' } as any)
  }

  // ─── 业务方法（从 useWebSocket 迁移） ───

  sendMessage(prompt: string, sessionId: string | null, options?: {
    cwd?: string
    images?: string[]
    permissionMode?: string
    effort?: string
    model?: string
    thinkingMode?: string
    maxBudgetUsd?: number
    maxTurns?: number
  }) {
    this.send({
      type: 'send-message',
      sessionId,
      prompt,
      ...options,
    } as any)
  }

  respondToolApproval(requestId: string, decision: ToolApprovalDecision) {
    this.send({ type: 'tool-approval-response', requestId, decision } as any)
  }

  respondAskUser(requestId: string, response: string) {
    this.send({ type: 'ask-user-response', requestId, response } as any)
  }

  respondPlanApproval(requestId: string, decision: PlanApprovalDecisionType, allowedPrompts?: any[]) {
    this.send({ type: 'resolve-plan-approval', requestId, decision, allowedPrompts } as any)
  }

  abort(sessionId: string) {
    this.send({ type: 'abort', sessionId } as any)
  }

  releaseLock(sessionId: string) {
    this.send({ type: 'release-lock', sessionId } as any)
  }

  claimLock(sessionId: string) {
    this.send({ type: 'claim-lock', sessionId } as any)
  }

  setMode(mode: string) {
    this.send({ type: 'set-mode', mode } as any)
  }

  setEffort(effort: string) {
    this.send({ type: 'set-effort', effort } as any)
  }

  setModel(sessionId: string, model: string) {
    this.send({ type: 'set-model', sessionId, model } as any)
  }

  forkSession(sessionId: string, messageId: string) {
    this.send({ type: 'fork-session', sessionId, messageId } as any)
  }

  getContextUsage(sessionId: string) {
    this.send({ type: 'get-context-usage', sessionId } as any)
  }

  getMcpStatus(sessionId: string) {
    this.send({ type: 'get-mcp-status', sessionId } as any)
  }

  toggleMcpServer(sessionId: string, serverName: string) {
    this.send({ type: 'toggle-mcp-server', sessionId, serverName } as any)
  }

  reconnectMcpServer(sessionId: string, serverName: string) {
    this.send({ type: 'reconnect-mcp-server', sessionId, serverName } as any)
  }

  rewindFiles(sessionId: string, messageId: string, mode: 'preview' | 'confirm') {
    this.send({ type: 'rewind-files', sessionId, messageId, mode } as any)
  }

  getSubagentMessages(sessionId: string, agentId: string) {
    this.send({ type: 'get-subagent-messages', sessionId, agentId } as any)
  }

  stopTask(sessionId: string, taskId: string) {
    this.send({ type: 'stop-task', sessionId, taskId } as any)
  }

  getConnectionId(): string | null {
    return this.connectionId
  }

  getState(): ConnectionState {
    return this.state
  }

  // ─── Internal ───

  private setState(state: ConnectionState) {
    this.state = state
    useSessionContainerStore.getState().setGlobal({ connectionStatus: state })
  }

  private doConnect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const wsUrl = `${protocol}//${host}/ws`

    this.ws = new WebSocket(wsUrl)

    this.ws.onopen = () => {
      this.reconnectAttempt = 0
      this.clearReconnectBannerTimer()
      // reconnect 处理
      if (this.previousConnectionId) {
        this.send({ type: 'reconnect', previousConnectionId: this.previousConnectionId } as any)
      }
      this.startHeartbeat()
      this.setupVisibilityListener()
    }

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as S2CMessage & { _seq?: number }
        this.handleMessage(msg)
      } catch { /* ignore parse errors */ }
    }

    this.ws.onclose = () => {
      this.stopHeartbeat()
      if (this.state !== 'disconnected') {
        // 保留 previousConnectionId 供重连
        this.previousConnectionId = this.connectionId
        this.scheduleReconnect()
      }
    }

    this.ws.onerror = () => {
      // onclose 会紧随其后
    }
  }

  private handleMessage(msg: S2CMessage & { _seq?: number; sessionId?: string }) {
    const store = useSessionContainerStore.getState()

    // 更新 lastSeq
    if (msg._seq && msg.sessionId) {
      const c = store.containers.get(msg.sessionId)
      if (c && msg._seq > c.lastSeq) {
        store.setLastSeq(msg.sessionId, msg._seq)
      }
    }

    switch (msg.type) {
      case 'init':
        this.handleInit(msg as any)
        break
      case 'session-state':
        this.handleSessionState(msg as any)
        break
      case 'agent-message':
        this.handleAgentMessage(msg as any)
        break
      case 'tool-approval-request':
        this.handleToolApprovalRequest(msg as any)
        break
      case 'tool-approval-resolved':
        this.handleToolApprovalResolved(msg as any)
        break
      case 'ask-user-request':
        this.handleAskUserRequest(msg as any)
        break
      case 'ask-user-resolved':
        this.handleAskUserResolved(msg as any)
        break
      case 'plan-approval':
        this.handlePlanApproval(msg as any)
        break
      case 'plan-approval-resolved':
        this.handlePlanApprovalResolved(msg as any)
        break
      case 'lock-status':
        this.handleLockStatus(msg as any)
        break
      case 'session-state-change':
        this.handleSessionStateChange(msg as any)
        break
      case 'mode-change':
        this.handleModeChange(msg as any)
        break
      case 'session-complete':
      case 'session-aborted':
        this.handleSessionEnd(msg as any)
        break
      case 'session-forked':
        this.handleSessionForked(msg as any)
        break
      case 'slash-commands':
        this.handleSlashCommands(msg as any)
        break
      case 'account-info':
        this.handleAccountInfo(msg as any)
        break
      case 'models':
        this.handleModels(msg as any)
        break
      case 'context-usage':
        this.handleContextUsage(msg as any)
        break
      case 'mcp-status':
        this.handleMcpStatus(msg as any)
        break
      case 'rewind-result':
        this.handleRewindResult(msg as any)
        break
      case 'subagent-messages':
        this.handleSubagentMessages(msg as any)
        break
      case 'stream-snapshot':
        this.handleStreamSnapshot(msg as any)
        break
      case 'session-title-updated':
        this.handleSessionTitleUpdated(msg as any)
        break
      case 'sync-result':
        this.handleSyncResult(msg as any)
        break
      case 'ping':
        this.send({ type: 'pong' } as any)
        this.resetHeartbeat()
        break
      case 'error':
        this.handleError(msg as any)
        break
    }
  }

  // ─── Message handlers ───
  // 每个 handler 负责：从 msg 中取 sessionId → 操作对应 Container

  private handleInit(msg: any) {
    this.connectionId = msg.connectionId
    // 恢复 sessionStorage
    try { sessionStorage.setItem('ws-connection-id', msg.connectionId) } catch {}
    this.setState('connected')
    store().setGlobal({ connectionId: msg.connectionId })

    // 重连后恢复所有活跃订阅
    if (this.previousConnectionId) {
      this.resubscribeAll()
      this.previousConnectionId = null
    }
  }

  private handleSessionState(msg: any) {
    const { sessionId, sessionStatus, lockStatus, lockHolderId } = msg
    if (!sessionId) return
    const s = store()
    s.getOrCreate(sessionId, '')  // 确保 Container 存在
    s.setSessionStatus(sessionId, sessionStatus)
    const clientLock = lockStatus === 'locked'
      ? (lockHolderId === this.connectionId ? 'locked_self' : 'locked_other')
      : 'idle'
    s.setLockStatus(sessionId, clientLock, lockHolderId ?? null)
  }

  private handleAgentMessage(msg: any) {
    const sessionId = msg.sessionId
    if (!sessionId) return
    const s = store()
    const c = s.containers.get(sessionId)
    if (!c) return

    const agentMsg = msg.message as any

    // 流式事件处理
    if (agentMsg.type === 'stream_event') {
      this.handleStreamEvent(sessionId, agentMsg)
      return
    }

    // 用户消息（服务端确认）
    if (agentMsg.type === 'user') {
      s.replaceOptimistic(sessionId, agentMsg)
      return
    }

    // assistant 消息：应用流式累积器的内容
    if (agentMsg.type === 'assistant') {
      const ss = s.getStreamState(sessionId)
      this.patchAssistantMessage(agentMsg, ss)
      ss.clear()
    }

    s.pushMessage(sessionId, agentMsg)
  }

  private handleStreamEvent(sessionId: string, agentMsg: any) {
    const s = store()
    const ss = s.getStreamState(sessionId)
    const event = agentMsg.event

    if (!event) return

    if (event.type === 'content_block_start') {
      const idx = event.index ?? 0
      if (idx === 0) ss.accumulator.clear()
      ss.accumulator.set(idx, {
        blockType: event.content_block?.type ?? 'text',
        content: '',
      })
    } else if (event.type === 'content_block_delta') {
      const idx = event.index ?? 0
      const block = ss.accumulator.get(idx)
      const delta = event.delta
      if (delta?.type === 'text_delta' && delta.text) {
        if (block) {
          block.content += delta.text
        }
        // RAF 批处理 delta
        ss.pendingDeltaText += delta.text
        if (ss.pendingDeltaRafId === null) {
          ss.pendingDeltaRafId = requestAnimationFrame(() => {
            const text = ss.pendingDeltaText
            ss.pendingDeltaText = ''
            ss.pendingDeltaRafId = null
            if (text) {
              store().appendStreamingText(sessionId, text)
            }
          })
        }
      } else if (delta?.type === 'thinking_delta' && delta.thinking) {
        if (block) {
          block.content += delta.thinking
        }
      }
    }
  }

  private patchAssistantMessage(msg: any, ss: StreamState) {
    // 用 accumulator 中的内容补丁 assistant 消息的空块
    if (!Array.isArray(msg.content)) return
    for (let i = 0; i < msg.content.length; i++) {
      const block = msg.content[i]
      const accum = ss.accumulator.get(i)
      if (!accum) continue
      if (block.type === 'text' && (!block.text || block.text === '')) {
        block.text = accum.content
      } else if (block.type === 'thinking' && (!block.thinking || block.thinking === '')) {
        block.thinking = accum.content
      }
    }
    // 如果 accumulator 有更多块（消息中缺失的），插入
    for (const [idx, accum] of ss.accumulator) {
      if (idx >= msg.content.length) {
        if (accum.blockType === 'text') {
          msg.content.push({ type: 'text', text: accum.content })
        } else if (accum.blockType === 'thinking') {
          msg.content.push({ type: 'thinking', thinking: accum.content })
        }
      }
    }
  }

  private handleToolApprovalRequest(msg: any) {
    const sessionId = msg.sessionId
    if (!sessionId) return
    const isLockHolder = store().containers.get(sessionId)?.lockStatus === 'locked_self'
    store().setApproval(sessionId, { ...msg, readonly: !isLockHolder })

    // auto mode 自动审批
    const settings = useSettingsStore.getState()
    if (settings.permissionMode === 'auto') {
      this.respondToolApproval(msg.requestId, { type: 'allow', updatedInput: msg.toolInput ?? {} })
    }
  }

  private handleToolApprovalResolved(msg: any) {
    const sessionId = msg.sessionId
    if (!sessionId) return
    store().setApproval(sessionId, null)
  }

  private handleAskUserRequest(msg: any) {
    const sessionId = msg.sessionId
    if (!sessionId) return
    const isLockHolder = store().containers.get(sessionId)?.lockStatus === 'locked_self'
    store().setAskUser(sessionId, { ...msg, readonly: !isLockHolder })
  }

  private handleAskUserResolved(msg: any) {
    const sessionId = msg.sessionId
    if (!sessionId) return
    store().setAskUser(sessionId, null)
  }

  private handlePlanApproval(msg: any) {
    const sessionId = msg.sessionId
    if (!sessionId) return
    const isLockHolder = store().containers.get(sessionId)?.lockStatus === 'locked_self'
    store().setPlanApproval(sessionId, { ...msg, readonly: !isLockHolder })
    store().setPlanModalOpen(sessionId, true)
  }

  private handlePlanApprovalResolved(msg: any) {
    const sessionId = msg.sessionId
    if (!sessionId) return
    if (msg.decision && msg.planContent) {
      store().setResolvedPlanApproval(sessionId, {
        planContent: msg.planContent,
        planFilePath: msg.planFilePath,
        allowedPrompts: msg.allowedPrompts ?? [],
        decision: msg.decision,
      })
    }
    store().setPlanApproval(sessionId, null)
    if (msg.newMode) {
      useSettingsStore.getState().setPermissionMode(msg.newMode)
    }
  }

  private handleLockStatus(msg: any) {
    const sessionId = msg.sessionId
    if (!sessionId) return
    const clientLock = msg.status === 'locked'
      ? (msg.holderId === this.connectionId ? 'locked_self' : 'locked_other')
      : 'idle'
    store().setLockStatus(sessionId, clientLock, msg.holderId ?? null)
  }

  private handleSessionStateChange(msg: any) {
    const sessionId = msg.sessionId
    if (!sessionId) return
    store().setSessionStatus(sessionId, msg.status)
  }

  private handleModeChange(msg: any) {
    if (msg.mode) {
      useSettingsStore.getState().setPermissionMode(msg.mode)
    }
  }

  private handleSessionEnd(msg: any) {
    const sessionId = msg.sessionId
    if (!sessionId) return
    store().setSessionStatus(sessionId, 'idle')
    store().setApproval(sessionId, null)
    store().setAskUser(sessionId, null)
    // 刷新 session 列表
    const sessStore = useSessionStore.getState()
    if (sessStore.currentProjectCwd) {
      sessStore.loadProjectSessions(sessStore.currentProjectCwd)
    }
  }

  private handleSessionForked(msg: any) {
    const sessStore = useSessionStore.getState()
    if (msg.newSessionId && sessStore.currentProjectCwd) {
      sessStore.loadProjectSessions(sessStore.currentProjectCwd)
    }
  }

  private handleSlashCommands(msg: any) {
    // 将 slash commands 存入 commandStore（如果存在）
    try {
      const { useCommandStore } = require('../stores/commandStore')
      useCommandStore.getState().setCommands(msg.commands ?? [])
    } catch { /* ignore */ }
  }

  private handleAccountInfo(msg: any) {
    store().setGlobal({ accountInfo: msg.info ?? null })
  }

  private handleModels(msg: any) {
    store().setGlobal({ models: msg.models ?? [] })
  }

  private handleContextUsage(msg: any) {
    const sessionId = msg.sessionId
    if (!sessionId) return
    store().setContextUsage(sessionId, msg.usage ?? null)
  }

  private handleMcpStatus(msg: any) {
    const sessionId = msg.sessionId
    if (!sessionId) return
    store().setMcpServers(sessionId, msg.servers ?? [])
  }

  private handleRewindResult(msg: any) {
    const sessionId = msg.sessionId
    if (!sessionId) return
    store().setRewindPreview(sessionId, msg.result ?? null)
  }

  private handleSubagentMessages(msg: any) {
    const sessionId = msg.sessionId
    if (!sessionId) return
    store().setSubagentMessages(sessionId, msg.data ?? null)
  }

  private handleStreamSnapshot(msg: any) {
    const sessionId = msg.sessionId
    if (!sessionId) return
    const ss = store().getStreamState(sessionId)
    ss.clear()
    if (msg.blocks) {
      for (const [idx, block] of msg.blocks) {
        ss.accumulator.set(idx, block)
      }
    }
  }

  private handleSessionTitleUpdated(msg: any) {
    const sessStore = useSessionStore.getState()
    if (msg.sessionId && msg.title) {
      sessStore.renameSession(msg.sessionId, msg.title)
    }
  }

  private handleSyncResult(msg: any) {
    const sessionId = msg.sessionId
    if (!sessionId) return
    if (msg.hasGap) {
      // 有消息空洞 → 标记需要全量同步
      store().setNeedsFullSync(sessionId, true)
      this.doFullSync(sessionId)
    }
  }

  private handleError(msg: any) {
    // Toast 错误
    try {
      const { useToastStore } = require('../components/chat/Toast')
      useToastStore.getState().addToast({ type: 'error', message: msg.message ?? 'Unknown error' })
    } catch { /* ignore */ }
  }

  // ─── 全量同步 ───

  private async doFullSync(sessionId: string) {
    try {
      const result = await fetchSessionMessages(sessionId)
      store().replaceMessages(sessionId, result.messages as any[], result.hasMore)
      store().setNeedsFullSync(sessionId, false)
    } catch (err) {
      console.error(`[WS] Full sync failed for ${sessionId}:`, err)
    }
  }

  // ─── 重连后恢复订阅 ───

  private resubscribeAll() {
    const { containers } = store()
    for (const [sessionId, c] of containers) {
      if (c.subscribed) {
        this.subscribe(sessionId, c.lastSeq)
      }
    }
  }

  // ─── 心跳 ───

  private startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = setTimeout(() => {
      // 超时未收到 ping → 认为断线
      if (this.ws) {
        this.ws.close()
      }
    }, this.HEARTBEAT_TIMEOUT)
  }

  private resetHeartbeat() {
    this.startHeartbeat()
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  // ─── 重连 ───

  private scheduleReconnect() {
    this.setState('reconnecting')
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), this.MAX_RECONNECT_DELAY)
    this.reconnectAttempt++
    this.reconnectTimer = setTimeout(() => {
      this.doConnect()
    }, delay)

    // 1.5s 后显示 reconnecting banner
    if (!this.reconnectingBannerTimer) {
      this.reconnectingBannerTimer = setTimeout(() => {
        // banner 已通过 connectionStatus='reconnecting' 自动显示
      }, 1500)
    }
  }

  private clearReconnectBannerTimer() {
    if (this.reconnectingBannerTimer) {
      clearTimeout(this.reconnectingBannerTimer)
      this.reconnectingBannerTimer = null
    }
  }

  // ─── 页面可见性 ───

  private setupVisibilityListener() {
    if (this.visibilityHandler) return
    this.visibilityHandler = () => {
      if (document.hidden) {
        this.lastBackgroundTime = Date.now()
        this.stopHeartbeat()
      } else {
        const bgDuration = Date.now() - this.lastBackgroundTime
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          // 连接已断 → 立即重连（跳过退避）
          this.reconnectAttempt = 0
          this.clearTimers()
          this.doConnect()
        } else {
          this.startHeartbeat()
          // 长时间后台(>5min) → 对所有 subscribed session 请求 sync
          if (bgDuration > 5 * 60 * 1000) {
            this.resubscribeAll()
          }
        }
      }
    }
    document.addEventListener('visibilitychange', this.visibilityHandler)
  }

  private removeVisibilityListener() {
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler)
      this.visibilityHandler = null
    }
  }

  // ─── Cleanup ───

  private clearTimers() {
    this.stopHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.clearReconnectBannerTimer()
  }
}

function store() {
  return useSessionContainerStore.getState()
}

// 单例导出
export const wsManager = new WebSocketManager()
```

- [ ] **Step 2: 验证类型编译通过**

Run: `cd packages/web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: 无新增类型错误（可能有关于 `require` 的警告，可忽略）

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/WebSocketManager.ts
git commit -m "feat: create WebSocketManager singleton class with message routing and reconnection"
```

---

## Task 6: 重写 ChatSessionProvider（统一 single/multi）

**Files:**
- Modify: `packages/web/src/providers/ChatSessionProvider.tsx`
- Modify: `packages/web/src/providers/ChatSessionContext.tsx` (如果需要更新类型)

这一步将 Provider 从 500+ 行双路径简化为统一的 Container-based 逻辑。

- [ ] **Step 1: 重写 ChatSessionProvider**

完全重写 `ChatSessionProvider.tsx`。新版不再有 `independent` prop 和两套数据路径：

```typescript
import { useMemo, useEffect, useCallback, type ReactNode } from 'react'
import { ChatSessionContext, type ChatSessionContextValue } from './ChatSessionContext'
import { useSessionContainerStore } from '../stores/sessionContainerStore'
import { useContainer, useGlobalConnection } from '../hooks/useContainer'
import { useSessionStore } from '../stores/sessionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { wsManager } from '../lib/WebSocketManager'
import { fetchSessionMessages } from '../lib/api'
import type { AgentMessage } from '@claude-agent-ui/shared'

interface Props {
  sessionId: string | null
  children: ReactNode
}

export function ChatSessionProvider({ sessionId, children }: Props) {
  const container = useContainer(sessionId)
  const global = useGlobalConnection()
  const store = useSessionContainerStore
  const currentProjectCwd = useSessionStore((s) => s.currentProjectCwd)

  // 确保 Container 存在
  useEffect(() => {
    if (sessionId && sessionId !== '__new__') {
      store.getState().getOrCreate(sessionId, currentProjectCwd ?? '')
    }
  }, [sessionId, currentProjectCwd])

  // 加载消息（如果 Container 为空且 sessionId 有效）
  useEffect(() => {
    if (!sessionId || sessionId === '__new__') return
    const c = store.getState().containers.get(sessionId)
    if (c && c.messages.length === 0 && !c.isLoadingHistory) {
      store.getState().setLoadingHistory(sessionId, true)
      fetchSessionMessages(sessionId)
        .then((result) => {
          store.getState().replaceMessages(sessionId, result.messages as AgentMessage[], result.hasMore)
        })
        .catch(() => {
          store.getState().setLoadingHistory(sessionId, false)
        })
    }
  }, [sessionId])

  // loadMore 回调
  const loadMore = useCallback(async () => {
    if (!sessionId || sessionId === '__new__') return
    const c = store.getState().containers.get(sessionId)
    if (!c || !c.hasMore || c.isLoadingMore) return
    store.getState().setLoadingMore(sessionId, true)
    try {
      const result = await fetchSessionMessages(sessionId, {
        offset: c.messages.length,
      })
      // prepend older messages
      const existing = store.getState().containers.get(sessionId)
      if (existing) {
        const merged = [...(result.messages as AgentMessage[]), ...existing.messages]
        store.getState().replaceMessages(sessionId, merged, result.hasMore)
      }
    } finally {
      store.getState().setLoadingMore(sessionId, false)
    }
  }, [sessionId])

  // ─── 操作方法 ───

  const send = useCallback((prompt: string, options?: any) => {
    if (!sessionId && !prompt) return
    const settings = useSettingsStore.getState()
    wsManager.sendMessage(prompt, sessionId, {
      cwd: currentProjectCwd ?? undefined,
      permissionMode: settings.permissionMode,
      effort: settings.effort,
      ...options,
    })
  }, [sessionId, currentProjectCwd])

  const respondToolApproval = useCallback((requestId: string, decision: any) => {
    wsManager.respondToolApproval(requestId, decision)
  }, [])

  const respondAskUser = useCallback((requestId: string, response: string) => {
    wsManager.respondAskUser(requestId, response)
  }, [])

  const respondPlanApproval = useCallback((requestId: string, decision: any, allowedPrompts?: any[]) => {
    wsManager.respondPlanApproval(requestId, decision, allowedPrompts)
  }, [])

  const abortSession = useCallback(() => {
    if (sessionId) wsManager.abort(sessionId)
  }, [sessionId])

  const claimLockAction = useCallback(() => {
    if (sessionId) wsManager.claimLock(sessionId)
  }, [sessionId])

  const releaseLockAction = useCallback(() => {
    if (sessionId) wsManager.releaseLock(sessionId)
  }, [sessionId])

  const setPlanModalOpen = useCallback((open: boolean) => {
    if (sessionId) store.getState().setPlanModalOpen(sessionId, open)
  }, [sessionId])

  const getContextUsage = useCallback(() => {
    if (sessionId) wsManager.getContextUsage(sessionId)
  }, [sessionId])

  const getMcpStatus = useCallback(() => {
    if (sessionId) wsManager.getMcpStatus(sessionId)
  }, [sessionId])

  const toggleMcpServer = useCallback((serverName: string) => {
    if (sessionId) wsManager.toggleMcpServer(sessionId, serverName)
  }, [sessionId])

  const reconnectMcpServer = useCallback((serverName: string) => {
    if (sessionId) wsManager.reconnectMcpServer(sessionId, serverName)
  }, [sessionId])

  const rewindFiles = useCallback((messageId: string, mode: 'preview' | 'confirm') => {
    if (sessionId) wsManager.rewindFiles(sessionId, messageId, mode)
  }, [sessionId])

  const getSubagentMessages = useCallback((agentId: string) => {
    if (sessionId) wsManager.getSubagentMessages(sessionId, agentId)
  }, [sessionId])

  const forkSessionAction = useCallback((messageId: string) => {
    if (sessionId) wsManager.forkSession(sessionId, messageId)
  }, [sessionId])

  // ─── Context value ───

  const value: ChatSessionContextValue = useMemo(() => ({
    sessionId,
    connectionStatus: global.connectionStatus,
    sessionStatus: container?.sessionStatus ?? 'idle',
    lockStatus: container?.lockStatus ?? 'idle',
    lockHolderId: container?.lockHolder ?? null,
    messages: container?.messages ?? [],
    isLoadingHistory: container?.isLoadingHistory ?? false,
    isLoadingMore: container?.isLoadingMore ?? false,
    hasMore: container?.hasMore ?? false,
    loadMore,
    pendingApproval: container?.pendingApproval ?? null,
    pendingAskUser: container?.pendingAskUser ?? null,
    pendingPlanApproval: container?.pendingPlanApproval ?? null,
    resolvedPlanApproval: container?.resolvedPlanApproval ?? null,
    planModalOpen: container?.planModalOpen ?? false,
    contextUsage: container?.contextUsage ?? null,
    mcpServers: container?.mcpServers ?? [],
    rewindPreview: container?.rewindPreview ?? null,
    subagentMessages: container?.subagentMessages ?? null,
    send,
    respondToolApproval,
    respondAskUser,
    respondPlanApproval,
    abort: abortSession,
    claimLock: claimLockAction,
    releaseLock: releaseLockAction,
    setPlanModalOpen,
    getContextUsage,
    getMcpStatus,
    toggleMcpServer,
    reconnectMcpServer,
    rewindFiles,
    getSubagentMessages,
    forkSession: forkSessionAction,
  }), [
    sessionId, global.connectionStatus,
    container, loadMore,
    send, respondToolApproval, respondAskUser, respondPlanApproval,
    abortSession, claimLockAction, releaseLockAction, setPlanModalOpen,
    getContextUsage, getMcpStatus, toggleMcpServer, reconnectMcpServer,
    rewindFiles, getSubagentMessages, forkSessionAction,
  ])

  return (
    <ChatSessionContext.Provider value={value}>
      {children}
    </ChatSessionContext.Provider>
  )
}
```

- [ ] **Step 2: 验证类型编译**

Run: `cd packages/web && npx tsc --noEmit --pretty 2>&1 | head -40`
Expected: ChatSessionProvider 本身无类型错误（其他文件可能因为旧 import 报错）

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/providers/ChatSessionProvider.tsx
git commit -m "refactor: unify ChatSessionProvider to use SessionContainer (remove independent mode)"
```

---

## Task 7: 重写 ChatInterface 的 session 切换逻辑

**Files:**
- Modify: `packages/web/src/components/chat/ChatInterface.tsx`

去掉 `isNewToReal`、`clearStreamingState`、`clearPendingDelta` 等全局状态操作，改用 Container 机制。

- [ ] **Step 1: 重写 ChatInterface 的 session 切换 effect**

替换现有的 `useEffect` session 切换逻辑。核心变化：
- 不再调用全局 `clearStreamingState()` / `clearPendingDelta()`
- 不再调用 `useMessageStore.getState().clear()`
- 不再调用 `useConnectionStore.getState().reset()`
- 改为通过 `wsManager` 管理订阅
- `__new__` → real-id 通过 `migrateContainer` 处理

新的 effect：

```typescript
useEffect(() => {
  const prevSession = prevSessionRef.current
  prevSessionRef.current = ctx.sessionId

  if (!ctx.sessionId || ctx.sessionId === '__new__') return

  // 订阅当前 session
  const store = useSessionContainerStore.getState()
  const container = store.containers.get(ctx.sessionId)
  const lastSeq = container?.lastSeq ?? 0

  wsManager.joinSession(ctx.sessionId, lastSeq)

  // 离开旧 session（混合策略）
  if (prevSession && prevSession !== '__new__' && prevSession !== ctx.sessionId) {
    const prevContainer = store.containers.get(prevSession)
    if (prevContainer?.sessionStatus === 'running') {
      // running session 保持订阅
      wsManager.subscribe(prevSession, prevContainer.lastSeq)
    } else {
      // idle session 取消订阅
      wsManager.unsubscribe(prevSession)
    }
  }

  return () => {
    // 组件卸载不取消订阅（由外层管理）
  }
}, [ctx.sessionId])
```

- [ ] **Step 2: 替换其他 import**

移除：
```typescript
import { useWebSocket, clearStreamingState } from '../../hooks/useWebSocket'
import { useMessageStore, clearPendingDelta } from '../../stores/messageStore'
import { useConnectionStore } from '../../stores/connectionStore'
```

改为：
```typescript
import { useSessionContainerStore } from '../../stores/sessionContainerStore'
import { wsManager } from '../../lib/WebSocketManager'
```

更新所有引用点（optimistic message 发送、abort 等）。

- [ ] **Step 3: 更新 optimistic message 发送**

替换原有的 `useMessageStore.getState().appendMessage(optimistic)` 为：

```typescript
if (ctx.sessionId) {
  useSessionContainerStore.getState().pushMessage(ctx.sessionId, optimistic)
}
```

- [ ] **Step 4: 验证编译**

Run: `cd packages/web && npx tsc --noEmit --pretty 2>&1 | head -40`

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/chat/ChatInterface.tsx
git commit -m "refactor: ChatInterface uses Container-based session switching"
```

---

## Task 8: 迁移 ChatMessagesPane 和 SearchBar

**Files:**
- Modify: `packages/web/src/components/chat/ChatMessagesPane.tsx`
- Modify: `packages/web/src/components/chat/SearchBar.tsx`

- [ ] **Step 1: 更新 ChatMessagesPane**

移除：
```typescript
import { useMessageStore } from '../../stores/messageStore'
```

ChatMessagesPane 已经从 `useChatSession()` context 读取 `messages`, `hasMore`, `isLoadingHistory`, `isLoadingMore`, `loadMore`。只需要删除 `loadInitial` 的直接调用和 `compact` 相关的条件分支。

去掉 compact 模式的 `if (!compact) loadInitial(sessionId)` 调用——消息加载现在由 ChatSessionProvider 统一处理。

- [ ] **Step 2: 更新 SearchBar**

移除 `useMessageStore` import，改为从 context 取 messages：

```typescript
import { useChatSession } from '../../providers/ChatSessionContext'
// ...
const { messages } = useChatSession()
```

- [ ] **Step 3: 验证编译**

Run: `cd packages/web && npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/chat/ChatMessagesPane.tsx packages/web/src/components/chat/SearchBar.tsx
git commit -m "refactor: ChatMessagesPane and SearchBar use context instead of global messageStore"
```

---

## Task 9: 迁移 StatusBar、ModelSelector、ComposerToolbar

**Files:**
- Modify: `packages/web/src/components/chat/StatusBar.tsx`
- Modify: `packages/web/src/components/chat/ModelSelector.tsx`
- Modify: `packages/web/src/components/chat/ComposerToolbar.tsx`

这三个组件都引用 `useConnectionStore` 和/或 `useWebSocket`。

- [ ] **Step 1: 更新 StatusBar**

替换：
```typescript
import { useConnectionStore } from '../../stores/connectionStore'
```
为：
```typescript
import { useGlobalConnection } from '../../hooks/useContainer'
```

`connectionStatus` 从 `useGlobalConnection().connectionStatus`。
`accountInfo` 从 `useGlobalConnection().accountInfo`。

其他 session-specific 数据（如 effort）从 context 或 settings store 取。

- [ ] **Step 2: 更新 ModelSelector**

替换 `useConnectionStore` → `useGlobalConnection()`（取 `models`, `accountInfo`）。
替换 `useWebSocket` → `wsManager`：

```typescript
import { wsManager } from '../../lib/WebSocketManager'
import { useGlobalConnection } from '../../hooks/useContainer'
```

`wsManager.setModel(sessionId, model)` 替代 `send({ type: 'set-model', ... })`。

- [ ] **Step 3: 更新 ComposerToolbar**

替换 `useConnectionStore` → `useChatSession()` context（取 `sessionStatus`, `connectionStatus`）。
替换 `useWebSocket` → `wsManager.setMode(mode)`。

- [ ] **Step 4: 验证编译**

Run: `cd packages/web && npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/chat/StatusBar.tsx packages/web/src/components/chat/ModelSelector.tsx packages/web/src/components/chat/ComposerToolbar.tsx
git commit -m "refactor: StatusBar, ModelSelector, ComposerToolbar use Container/wsManager"
```

---

## Task 10: 迁移 ChatComposer、McpPanel、ContextPanel、MessageComponent

**Files:**
- Modify: `packages/web/src/components/chat/ChatComposer.tsx`
- Modify: `packages/web/src/components/chat/McpPanel.tsx`
- Modify: `packages/web/src/components/chat/ContextPanel.tsx`
- Modify: `packages/web/src/components/chat/MessageComponent.tsx`

- [ ] **Step 1: 更新 ChatComposer**

替换 `useConnectionStore` → `useGlobalConnection()` + `useChatSession()`。
替换 `useMessageStore.clear()` → `useSessionContainerStore.getState().clearMessages(sessionId)`。
替换 `useWebSocket` → `wsManager`。

- [ ] **Step 2: 更新 McpPanel**

替换 `useConnectionStore` → `useChatSession()`（取 `mcpServers`）。
替换 `useWebSocket` → context methods（`getMcpStatus`, `toggleMcpServer`, `reconnectMcpServer`）。

- [ ] **Step 3: 更新 ContextPanel**

替换 `useConnectionStore` → `useChatSession()`（取 `contextUsage`, `sessionStatus`）。
替换 `useWebSocket` → context method `getContextUsage()`。

- [ ] **Step 4: 更新 MessageComponent**

替换 `useConnectionStore` → `useChatSession()`（取 `rewindPreview`, `subagentMessages`）。
替换 `useWebSocket` → context methods（`forkSession`, `rewindFiles`, `getSubagentMessages`）。

- [ ] **Step 5: 验证编译**

Run: `cd packages/web && npx tsc --noEmit --pretty 2>&1 | head -40`

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/chat/ChatComposer.tsx packages/web/src/components/chat/McpPanel.tsx packages/web/src/components/chat/ContextPanel.tsx packages/web/src/components/chat/MessageComponent.tsx
git commit -m "refactor: ChatComposer, McpPanel, ContextPanel, MessageComponent use Container/wsManager"
```

---

## Task 11: 迁移 useClaimLock 和 BackgroundStatusDropdown

**Files:**
- Modify: `packages/web/src/hooks/useClaimLock.ts`
- Modify: `packages/web/src/components/layout/BackgroundStatusDropdown.tsx`

- [ ] **Step 1: 更新 useClaimLock**

替换 `useWebSocket` → `wsManager`：

```typescript
import { wsManager } from '../lib/WebSocketManager'
import { useSessionStore } from '../stores/sessionStore'

export function useClaimLock() {
  const currentSessionId = useSessionStore((s) => s.currentSessionId)
  return useCallback(() => {
    if (currentSessionId && currentSessionId !== '__new__') {
      wsManager.claimLock(currentSessionId)
    }
  }, [currentSessionId])
}
```

- [ ] **Step 2: 更新 BackgroundStatusDropdown**

现在后台 session 状态应该从 `sessionContainerStore.containers` 读取，而不仅仅依赖 `multiPanelStore.panelSummaries`：

```typescript
import { useSessionContainerStore } from '../../stores/sessionContainerStore'
```

对每个后台 sessionId，检查 `containers.get(id)?.sessionStatus` 来决定状态分组。

- [ ] **Step 3: 验证编译**

Run: `cd packages/web && npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/hooks/useClaimLock.ts packages/web/src/components/layout/BackgroundStatusDropdown.tsx
git commit -m "refactor: useClaimLock and BackgroundStatusDropdown use Container/wsManager"
```

---

## Task 12: 更新 App.tsx 和 MultiPanelGrid

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/components/chat/MultiPanelGrid.tsx`

- [ ] **Step 1: 更新 App.tsx**

ChatSessionProvider 不再需要 `independent` prop。确保 Provider 包裹正确。

同时在 App 顶层初始化 WebSocketManager：

```typescript
import { wsManager } from './lib/WebSocketManager'

// 在 App 组件的 useEffect 中：
useEffect(() => {
  wsManager.connect()
  return () => wsManager.disconnect()
}, [])
```

- [ ] **Step 2: 更新 MultiPanelGrid**

每个 panel 包裹 `<ChatSessionProvider sessionId={panelId}>` 而不需要 `independent={true}`：

```tsx
{panelSessionIds.map((id) => (
  <ChatSessionProvider key={id} sessionId={id}>
    <ChatInterface compact />
  </ChatSessionProvider>
))}
```

- [ ] **Step 3: 验证编译**

Run: `cd packages/web && npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/App.tsx packages/web/src/components/chat/MultiPanelGrid.tsx
git commit -m "refactor: App and MultiPanelGrid use unified ChatSessionProvider"
```

---

## Task 13: 删除旧文件

**Files:**
- Delete: `packages/web/src/stores/messageStore.ts`
- Delete: `packages/web/src/stores/connectionStore.ts`
- Delete: `packages/web/src/hooks/useWebSocket.ts`

- [ ] **Step 1: 确认无残余引用**

Run: `grep -r "messageStore\|connectionStore\|useWebSocket" packages/web/src/ --include="*.ts" --include="*.tsx" -l`

Expected: 无结果（所有引用已在 Task 7-12 中迁移）

如果仍有引用，先修复这些文件。

- [ ] **Step 2: 删除文件**

```bash
rm packages/web/src/stores/messageStore.ts
rm packages/web/src/stores/connectionStore.ts
rm packages/web/src/hooks/useWebSocket.ts
```

- [ ] **Step 3: 验证完整构建**

Run: `pnpm build`
Expected: 所有三个包构建成功

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove messageStore, connectionStore, useWebSocket (replaced by Container architecture)"
```

---

## Task 14: 端到端验证

- [ ] **Step 1: 完整构建**

Run: `pnpm build`
Expected: 成功

- [ ] **Step 2: TypeScript 类型检查**

Run: `pnpm lint`
Expected: 无新增类型错误

- [ ] **Step 3: 启动 dev server 并手动测试**

Run: `pnpm dev`

测试清单：
1. 新建对话，发送消息，收到回复（basic flow）
2. 切换到另一个对话再切回（session 切换 + 消息保留）
3. Multi 模式下同时查看多个对话（Container 隔离）
4. 对话运行中切走再切回（running session 保持订阅）
5. 审批请求在正确的对话中弹出（不串台）
6. 断开网络再恢复（重连 + replay）
7. 流式输出期间切换对话（delta 不串台）

- [ ] **Step 4: Commit final**

```bash
git add -A
git commit -m "feat: complete session container refactor - per-session isolation, unified single/multi, industrial reconnection"
```
