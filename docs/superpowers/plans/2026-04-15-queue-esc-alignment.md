# Queue Input & ESC Cancel — 对齐 Claude Code 行为 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将队列输入和 ESC 取消交互对齐 Claude Code CLI 行为——延迟 forward、ESC 先 pop 队列再 abort、弹回合并而非覆盖。

**Architecture:** 运行中用户消息仅入服务器队列（不 forward 给 CLI），turn 完成后自动 dequeue 执行。新增 `pop-queue` C2S 消息让 ESC 弹出队列命令。移除 `forwarded` 概念和相关方法。

**Tech Stack:** TypeScript, Fastify WebSocket, React/Zustand

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/shared/src/queue.ts` | Modify | 移除 `forwarded` 字段 |
| `packages/shared/src/protocol.ts` | Modify | 新增 `C2S_PopQueue` / `S2C_QueuePopped` 类型 |
| `packages/server/src/queue/message-queue-manager.ts` | Modify | 移除 `popAllNonForwardedEditable()` 和 `clearForwarded()` |
| `packages/server/src/ws/handler.ts` | Modify | 改 handleSendMessage（延迟 forward）、改 handleAbort（纯 abort）、新增 handlePopQueue、改 complete/error 回调 |
| `packages/web/src/lib/WebSocketManager.ts` | Modify | 新增 `popQueue()` 方法 + `handleQueuePopped()` 处理器、改 `handleSessionAborted()` |
| `packages/web/src/providers/ChatSessionContext.ts` | Modify | 接口新增 `popQueue()` + `queue` |
| `packages/web/src/providers/ChatSessionProvider.tsx` | Modify | 实现 `popQueue()` + 暴露 `queue` |
| `packages/web/src/stores/sessionContainerStore.ts` | Modify | `popBackCommands` → `poppedCommands` |
| `packages/web/src/components/chat/ChatInterface.tsx` | Modify | ESC 两阶段处理 |
| `packages/web/src/components/chat/ChatComposer.tsx` | Modify | 监听 `poppedCommands` 合并逻辑 |

---

### Task 1: shared — 移除 forwarded 字段 + 新增协议消息

**Files:**
- Modify: `packages/shared/src/queue.ts:30-56`
- Modify: `packages/shared/src/protocol.ts:382-404`

- [ ] **Step 1: 移除 QueuedCommand.forwarded 字段**

编辑 `packages/shared/src/queue.ts`，删除 `forwarded` 字段和它的 JSDoc 注释（行 47-55）：

```typescript
// 删除以下内容：
  /**
   * Whether this command has been forwarded to the CLI process for mid-query injection.
   * Forwarded commands should NOT be re-sent on session complete (CLI already has them).
   * On abort, forwarded commands are NOT returned to the composer — they remain in
   * the CLI's internal queue and will be processed in the next turn.
   *
   * @see Claude Code query.ts:1573-1593 getCommandsByMaxPriority() mid-query attachment
   */
  forwarded?: boolean
```

- [ ] **Step 2: 新增 C2S_PopQueue 和 S2C_QueuePopped 协议类型**

编辑 `packages/shared/src/protocol.ts`。

在 `C2S_Abort` 定义附近（搜索 `C2S_Abort`）添加：

```typescript
export interface C2S_PopQueue {
  type: 'pop-queue'
  sessionId: string
}
```

在 `S2C_SessionAborted` 定义附近添加：

```typescript
export interface S2C_QueuePopped {
  type: 'queue-popped'
  sessionId: string
  commands: QueueItemWire[]
}
```

注意：`QueueItemWire` 需要从 `queue.ts` 导入。检查文件顶部是否已有 import，没有则添加：

```typescript
import type { QueueItemWire } from './queue.js'
```

- [ ] **Step 3: 将新类型加入联合类型**

在 `C2SMessage` 联合类型中添加 `| C2S_PopQueue`。
在 `S2CMessage` 联合类型中添加 `| S2C_QueuePopped`。

- [ ] **Step 4: 验证 shared 包编译**

运行: `pnpm --filter @claude-agent-ui/shared build`

Expected: 编译成功，无类型错误。

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/queue.ts packages/shared/src/protocol.ts
git commit -m "feat(shared): remove forwarded flag, add pop-queue/queue-popped protocol types"
```

---

### Task 2: server — 清理 MessageQueueManager

**Files:**
- Modify: `packages/server/src/queue/message-queue-manager.ts:149-196`

- [ ] **Step 1: 删除 popAllNonForwardedEditable 方法**

删除 `packages/server/src/queue/message-queue-manager.ts` 行 149-175（`popAllNonForwardedEditable` 方法及其 JSDoc）。

- [ ] **Step 2: 删除 clearForwarded 方法**

删除同文件行 177-196（`clearForwarded` 方法及其 JSDoc）。

- [ ] **Step 3: 验证 server 包编译**

运行: `pnpm --filter @claude-agent-ui/server build`

Expected: 可能出现 handler.ts 中对 `popAllNonForwardedEditable` / `clearForwarded` 的引用错误——这是预期的，Task 3 会修复。

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/queue/message-queue-manager.ts
git commit -m "refactor(server): remove forwarded-related queue methods"
```

---

### Task 3: server — 改造 handler.ts（核心）

**Files:**
- Modify: `packages/server/src/ws/handler.ts:86-186` (message routing)
- Modify: `packages/server/src/ws/handler.ts:440-472` (complete/error callbacks)
- Modify: `packages/server/src/ws/handler.ts:544-581` (handleSendMessage busy path)
- Modify: `packages/server/src/ws/handler.ts:760-796` (handleAbort)

- [ ] **Step 1: 改造 handleSendMessage — 延迟 forward**

编辑 `packages/server/src/ws/handler.ts`，将 sessionBusy 分支（行 544-581）从"立即 forward"改为"仅入队"。

替换行 544-581 为：

```typescript
    const sessionBusy = session.status === 'running' || session.status === 'awaiting_approval' || session.status === 'awaiting_user_input'
    if (sessionBusy && effectiveSessionId && !effectiveSessionId.startsWith('pending-')) {
      // ── Deferred queue: enqueue only, do NOT forward to CLI ──
      // Mirrors Claude Code messageQueueManager.ts enqueue() — messages sit in queue
      // until the current turn completes, then processQueue() sends them via session.send().
      // ESC can pop them back to the composer before they are consumed.
      const q = getOrCreateQueue(effectiveSessionId)
      q.enqueue(command)

      // Broadcast user message to all clients (so it appears in chat immediately)
      const broadcastContent: any[] = []
      if (command.images) {
        for (const img of command.images) {
          broadcastContent.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })
        }
      }
      if (command.value) {
        broadcastContent.push({ type: 'text', text: command.value })
      }
      wsHub.broadcast(effectiveSessionId, {
        type: 'agent-message',
        sessionId: effectiveSessionId,
        message: { type: 'user', uuid: command.id, message: { role: 'user', content: broadcastContent } },
      } as any)
      return
    }
```

关键变化：移除 `command.forwarded = true`，移除 `session.send()` 调用。

- [ ] **Step 2: 改造 session complete 回调**

编辑 `packages/server/src/ws/handler.ts`，将 `session.on('complete', ...)` 中的队列处理（行 440-454）替换为：

```typescript
      // ── Input Queue: process remaining items after turn completes ──
      // All queued items are un-forwarded (deferred queue model), so just process them.
      setImmediate(() => {
        const q = sessionQueues.get(realSessionId)
        if (!q || q.isEmpty) return
        processQueue(q, {
          executeInput: (cmds) => executeCommands(connectionId, realSessionId, session, cmds),
          isSessionBusy: () => session.status !== 'idle',
        })
      })
```

移除 `q.clearForwarded()` 调用。同时更新注释。

- [ ] **Step 3: 改造 session error 回调**

编辑同文件 `session.on('error', ...)` 中的队列处理（行 460-471），同样移除 `q.clearForwarded()` 调用：

```typescript
      // ── Input Queue: try dequeue on error ──
      setImmediate(() => {
        const q = sessionQueues.get(realSessionId)
        if (!q || q.isEmpty) return
        processQueue(q, {
          executeInput: (cmds) => executeCommands(connectionId, realSessionId, session, cmds),
          isSessionBusy: () => session.status !== 'idle',
        })
      })
```

- [ ] **Step 4: 改造 handleAbort — 纯 abort**

替换 `handleAbort` 函数（行 760-796）为：

```typescript
  async function handleAbort(connectionId: string, sessionId: string) {
    if (!lockManager.isHolder(sessionId, connectionId)) {
      wsHub.sendTo(connectionId, { type: 'error', message: 'Not lock holder', code: 'not_lock_holder' })
      return
    }

    // Pure abort — no queue popping. ESC pop is handled separately via pop-queue.
    // Mirrors Claude Code useCancelRequest.ts — abort only fires when queue is empty.
    const session = sessionManager.getActive(sessionId)
    if (session) await session.abort()

    wsHub.broadcast(sessionId, { type: 'session-aborted', sessionId } as any)
  }
```

- [ ] **Step 5: 新增 handlePopQueue**

在 `handleAbort` 函数之后添加新函数：

```typescript
  function handlePopQueue(connectionId: string, sessionId: string) {
    if (!lockManager.isHolder(sessionId, connectionId)) {
      wsHub.sendTo(connectionId, { type: 'error', message: 'Not lock holder', code: 'not_lock_holder' })
      return
    }

    const q = sessionQueues.get(sessionId)
    const editableCommands = q?.popAllEditable() ?? []
    if (editableCommands.length === 0) return

    // Send popped commands to requester only (lock holder merges into composer)
    wsHub.sendTo(connectionId, {
      type: 'queue-popped',
      sessionId,
      commands: editableCommands.map(cmd => ({
        id: cmd.id,
        value: cmd.value,
        mode: cmd.mode,
        priority: cmd.priority,
        editable: cmd.editable,
        addedAt: cmd.addedAt,
        images: cmd.images,
      })),
    } as any)
    // queue-updated is auto-broadcast via queue's 'changed' event listener
  }
```

- [ ] **Step 6: 注册 pop-queue 消息路由**

在 `handleMessage` 的 switch 语句中（行 99-101 的 `case 'abort':` 之后），添加：

```typescript
      case 'pop-queue':
        handlePopQueue(connectionId, msg.sessionId)
        break
```

注意：TypeScript 可能需要将 `msg` 断言为含 `sessionId` 的类型。由于 `C2SMessage` 联合类型已包含 `C2S_PopQueue`，switch 应该能正确窄化类型。如果遇到类型问题，使用 `(msg as any).sessionId`。

- [ ] **Step 7: 验证 server 编译**

运行: `pnpm --filter @claude-agent-ui/shared build && pnpm --filter @claude-agent-ui/server build`

Expected: 编译成功。

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/ws/handler.ts
git commit -m "feat(server): deferred queue + pop-queue handler + pure abort"
```

---

### Task 4: 前端 — store 重命名 + WebSocketManager

**Files:**
- Modify: `packages/web/src/stores/sessionContainerStore.ts:88,165,234,535-542`
- Modify: `packages/web/src/lib/WebSocketManager.ts:157-159,556-558,589-591,977-1003`

- [ ] **Step 1: store 重命名 popBackCommands → poppedCommands**

编辑 `packages/web/src/stores/sessionContainerStore.ts`：

1. 在 `SessionContainer` 接口中（行 88），将 `popBackCommands: QueueItemWire[] | null` 改为 `poppedCommands: QueueItemWire[] | null`
2. 在初始化（行 165），将 `popBackCommands: null` 改为 `poppedCommands: null`
3. 在 `SessionContainerActions` 接口中（行 234），将 `setPopBackCommands` 改为 `setPoppedCommands`
4. 在实现中（行 535-542），将 `setPopBackCommands` 改为 `setPoppedCommands`，将 `popBackCommands` 改为 `poppedCommands`：

```typescript
    setPoppedCommands(sessionId, commands) {
      const { containers } = get()
      const c = containers.get(sessionId)
      if (!c) return
      const next = new Map(containers)
      next.set(sessionId, { ...c, poppedCommands: commands })
      set({ containers: next })
    },
```

- [ ] **Step 2: WebSocketManager — 新增 popQueue 方法**

编辑 `packages/web/src/lib/WebSocketManager.ts`，在 `abort()` 方法（行 157-159）之后添加：

```typescript
  popQueue(sessionId: string) {
    this.send({ type: 'pop-queue', sessionId } as any)
  }
```

- [ ] **Step 3: WebSocketManager — 新增 handleQueuePopped 处理器**

在 `handleQueueUpdated` 方法（行 1118-1122）附近添加：

```typescript
  private handleQueuePopped(msg: any) {
    const sessionId = msg.sessionId as string | undefined
    if (!sessionId) return
    store().setPoppedCommands(sessionId, msg.commands ?? [])
  }
```

- [ ] **Step 4: WebSocketManager — 注册 queue-popped 消息路由**

在 `onmessage` 的 switch 语句中（行 589 `case 'queue-updated':` 之后），添加：

```typescript
      case 'queue-popped':
        this.handleQueuePopped(msg)
        break
```

- [ ] **Step 5: WebSocketManager — 修改 handleSessionAborted**

编辑 `handleSessionAborted` 方法（行 977-1003），移除 popBackCommands 相关逻辑（行 989-996）。

最终代码：

```typescript
  private handleSessionAborted(msg: any) {
    const sessionId = (msg as any).sessionId as string | undefined
    if (!sessionId) return
    const s = store()
    s.setSessionStatus(sessionId, 'idle')
    s.setApproval(sessionId, null)
    s.setAskUser(sessionId, null)
    s.setPlanApproval(sessionId, null)
    s.setPlanModalOpen(sessionId, false)
    s.setQueue(sessionId, [])
    s.clearStreaming(sessionId)
    this.currentToolBlockIndex.delete(sessionId)
    // Refresh session list
    const sessStore = useSessionStore.getState()
    if (sessStore.currentProjectCwd) {
      sessStore.invalidateProjectSessions(sessStore.currentProjectCwd)
      sessStore.loadProjectSessions(sessStore.currentProjectCwd, true)
    }
  }
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/stores/sessionContainerStore.ts packages/web/src/lib/WebSocketManager.ts
git commit -m "feat(web): rename popBackCommands→poppedCommands, add popQueue + handleQueuePopped"
```

---

### Task 5: 前端 — Context + Provider + ESC 处理 + Composer 合并

**Files:**
- Modify: `packages/web/src/providers/ChatSessionContext.ts:41-82`
- Modify: `packages/web/src/providers/ChatSessionProvider.tsx:160-162`
- Modify: `packages/web/src/components/chat/ChatInterface.tsx:157-173`
- Modify: `packages/web/src/components/chat/ChatComposer.tsx:120-134`

- [ ] **Step 1: ChatSessionContext — 新增 popQueue 和 queue**

编辑 `packages/web/src/providers/ChatSessionContext.ts`，在 `ChatSessionContextValue` 接口中：

1. 在 `// Actions` 之前（约行 67），添加：
```typescript
  queue: QueueItemWire[]
```

2. 在 `abort(): void`（行 73）之后，添加：
```typescript
  popQueue(): void
```

3. 在文件顶部添加 import：
```typescript
import type { QueueItemWire } from '@claude-agent-ui/shared'
```

- [ ] **Step 2: ChatSessionProvider — 实现 popQueue 和暴露 queue**

编辑 `packages/web/src/providers/ChatSessionProvider.tsx`：

1. 在 provider 的 value 中，添加 `queue` 数据。需要从 sessionContainerStore 读取：

在文件中找到 `useMemo` 构建 contextValue 的地方，添加：
```typescript
      queue: container?.queue ?? [],
```

2. 在 `abort()` 方法（行 160-162）之后，添加：
```typescript
      popQueue() {
        if (sessionId && sessionId !== '__new__') wsManager.popQueue(sessionId)
      },
```

3. 确保 `QueueItemWire` 类型已导入。

- [ ] **Step 3: ChatInterface — ESC 两阶段处理**

编辑 `packages/web/src/components/chat/ChatInterface.tsx`，替换 ESC 处理 useEffect（行 157-173）：

```typescript
  // Esc handler: pop queue first, abort second (mirrors Claude Code PromptInput.tsx:1948-1953 + useCancelRequest.ts:87-122)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (ctx.planModalOpen) return
      if (searchOpen || helpOpen) return
      // Allow ESC from textarea (composer) but not from other inputs (search box etc.)
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (tag === 'INPUT') return

      // Phase 1: pop editable commands from queue (mirrors Claude Code popAllCommandsFromQueue)
      const hasEditable = ctx.queue.some(item => item.editable)
      if (hasEditable) {
        e.preventDefault()
        ctx.popQueue()
        return
      }

      // Phase 2: abort running session (no queue items to pop)
      if (ctx.sessionStatus === 'running') {
        e.preventDefault()
        ctx.abort()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [ctx, searchOpen, helpOpen])
```

- [ ] **Step 4: ChatComposer — 合并逻辑对齐 Claude Code**

编辑 `packages/web/src/components/chat/ChatComposer.tsx`：

1. 将 `popBackCommands` 选择器（行 120-122）改为 `poppedCommands`：

```typescript
  const poppedCommands = useSessionContainerStore(
    (state) => sessionId ? state.containers.get(sessionId)?.poppedCommands ?? null : null
  )
```

2. 将合并 useEffect（行 126-134）改为：

```typescript
  // Consume poppedCommands: merge editable command values into textarea
  // Mirrors Claude Code messageQueueManager.ts popAllEditable() → [...queuedTexts, currentInput].join('\n')
  useEffect(() => {
    if (!poppedCommands || poppedCommands.length === 0 || !sessionId) return
    const poppedTexts = poppedCommands.map(cmd => cmd.value)
    setText(prev => {
      return [...poppedTexts, prev].filter(Boolean).join('\n')
    })
    useSessionContainerStore.getState().setPoppedCommands(sessionId, null)
  }, [poppedCommands, sessionId])
```

- [ ] **Step 5: 验证全包编译**

运行: `pnpm build`

Expected: 所有三个包编译成功。

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/providers/ChatSessionContext.ts packages/web/src/providers/ChatSessionProvider.tsx packages/web/src/components/chat/ChatInterface.tsx packages/web/src/components/chat/ChatComposer.tsx
git commit -m "feat(web): two-phase ESC (pop-queue then abort) + merge-not-overwrite composer"
```

---

### Task 6: 验证 + 清理

**Files:**
- Verify: all modified files

- [ ] **Step 1: 全量类型检查**

运行: `pnpm lint`

Expected: 无 TypeScript 错误。

- [ ] **Step 2: 搜索残留的 forwarded 引用**

运行搜索（Grep），确认不再有 `forwarded` 相关引用：

搜索模式: `forwarded`
搜索范围: `packages/`

Expected: 无结果（或仅在注释/文档中）。如有残留，清理它们。

- [ ] **Step 3: 搜索残留的 popBackCommands 引用**

搜索模式: `popBackCommands`
搜索范围: `packages/`

Expected: 无结果。如有残留，更新为 `poppedCommands` / `setPoppedCommands`。

- [ ] **Step 4: dev 启动验证**

运行: `pnpm dev`

Expected: server + web 同时启动，无报错。

- [ ] **Step 5: 浏览器手动测试**

打开 http://localhost:5173，测试以下场景：

1. **场景 A：发消息 → 等待完成 → 自动执行**
   - 发一条消息开始 AI 运行
   - 运行中再发一条消息
   - 第二条消息应显示在队列区域
   - AI 完成后，第二条消息应自动开始执行

2. **场景 B：发消息 → ESC pop → 编辑**
   - 发一条消息开始 AI 运行
   - 运行中再发一条消息（入队列）
   - 按 ESC → 队列消息应弹回到输入框
   - AI 继续运行（未被 abort）
   - 可以编辑后重新发送

3. **场景 C：无队列 → ESC abort**
   - 发一条消息开始 AI 运行
   - 不发其他消息
   - 按 ESC → AI 被 abort

4. **场景 D：发消息 → ESC pop → ESC abort**
   - 发消息 + 入队列
   - 第一下 ESC → pop 队列到输入框
   - 第二下 ESC → abort AI

- [ ] **Step 6: Commit 清理**

```bash
git add -A
git commit -m "chore: clean up forwarded/popBackCommands remnants"
```
