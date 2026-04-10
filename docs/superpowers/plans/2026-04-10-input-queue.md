# Input Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an agent is running, new user messages queue up and execute automatically after the current query completes — matching Claude Code CLI behavior.

**Architecture:** Server-side FIFO queue in V1QuerySession. `send()` checks if running: idle → execute immediately, running → enqueue. On query complete/error, auto-dequeue next. Abort clears queue. Frontend shows queued messages and allows input during running state. No priority system, no mid-turn drain — simple FIFO with independent query-per-message.

**Tech Stack:** TypeScript, existing WebSocket protocol, Zustand store

---

### Task 1: Protocol Types — Add Queue Messages

**Files:**
- Modify: `packages/shared/src/protocol.ts`

- [ ] **Step 1: Add C2S_ClearQueue type**

```typescript
// Add after C2S_Abort (line 42)
export interface C2S_ClearQueue {
  type: 'clear-queue'
  sessionId: string
}
```

- [ ] **Step 2: Add S2C_QueueUpdated type**

```typescript
// Add after S2C_SessionAborted (line 195)
export interface QueueItem {
  id: string
  prompt: string
  addedAt: number
  images?: { data: string; mediaType: string }[]
}

export interface S2C_QueueUpdated {
  type: 'queue-updated'
  sessionId: string
  queue: QueueItem[]
}
```

- [ ] **Step 3: Add to union types**

```typescript
// Add C2S_ClearQueue to C2SMessage union (line 392)
  | C2S_ClearQueue

// Add S2C_QueueUpdated to S2CMessage union (line 417)
  | S2C_QueueUpdated
```

- [ ] **Step 4: Build shared package**

Run: `pnpm --filter @claude-agent-ui/shared build`
Expected: Clean compilation, no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/protocol.ts
git commit -m "feat: add input queue protocol types (C2S_ClearQueue, S2C_QueueUpdated)"
```

---

### Task 2: Server — Queue Logic in V1QuerySession

**Files:**
- Modify: `packages/server/src/agent/v1-session.ts`

- [ ] **Step 1: Add queue data structure and types**

Add after the `PendingPlanApproval` interface (line 50):

```typescript
interface QueuedMessage {
  id: string
  prompt: string
  options?: SendOptions
  images?: { data: string; mediaType: string }[]
  addedAt: number
}
```

Add to `V1QuerySession` class fields (after `_cachedAskUserAnswer`, line 71):

```typescript
  private _messageQueue: QueuedMessage[] = []
```

- [ ] **Step 2: Add queue accessor methods**

Add after `cacheAskUserAnswer()` (line 90):

```typescript
  /** Get current queue for broadcasting to clients */
  getQueue(): { id: string; prompt: string; addedAt: number; images?: { data: string; mediaType: string }[] }[] {
    return this._messageQueue.map(q => ({
      id: q.id,
      prompt: q.prompt,
      addedAt: q.addedAt,
      images: q.images,
    }))
  }

  /** Clear all queued messages */
  clearQueue(): void {
    this._messageQueue = []
    this.emit('queue-updated', this.getQueue())
  }

  /** Get queue length */
  get queueLength(): number {
    return this._messageQueue.length
  }
```

- [ ] **Step 3: Modify send() to support enqueuing**

Replace the current `send()` method (lines 140-194) with:

```typescript
  send(prompt: string, options?: SendOptions): void {
    // If a query is currently running, enqueue instead of interrupting
    if (this._status === 'running' || this._status === 'awaiting_approval' || this._status === 'awaiting_user_input') {
      const item: QueuedMessage = {
        id: randomUUID(),
        prompt,
        options,
        images: options?.images,
        addedAt: Date.now(),
      }
      this._messageQueue.push(item)
      this.emit('queue-updated', this.getQueue())
      return
    }

    this.executeQuery(prompt, options)
  }

  private executeQuery(prompt: string, options?: SendOptions): void {
    // Stop previous query if still lingering (shouldn't happen with queue, but safety net)
    this.stopCurrentQuery('New message sent')

    this.abortController = new AbortController()
    this.setStatus('running')

    const queryOptions: Record<string, unknown> = {
      cwd: this._projectCwd,
      includePartialMessages: true,
      abortController: this.abortController,
      canUseTool: this.handleCanUseTool.bind(this),
      allowDangerouslySkipPermissions: true,
      env: { ...process.env, ...claudeEnv },
      promptSuggestions: true,
      enableFileCheckpointing: true,
      agentProgressSummaries: true,
    }

    // Resume existing session or use previously captured ID
    // If _startFresh is set (clear-and-accept), skip resume to start a new context
    if (this._startFresh) {
      this._startFresh = false
    } else {
      const resumeId = this.resumeSessionId ?? this.sessionId
      if (resumeId) {
        queryOptions.resume = resumeId
      }
    }

    if (options?.effort) {
      queryOptions.effort = options.effort
    }

    if (options?.thinkingMode) {
      queryOptions.thinking = options.thinkingMode === 'disabled'
        ? { type: 'disabled' }
        : { type: 'adaptive' }
    }

    if (options?.maxBudgetUsd) {
      queryOptions.maxBudgetUsd = options.maxBudgetUsd
    }
    if (options?.maxTurns) {
      queryOptions.maxTurns = options.maxTurns
    }

    // Pass current permission mode to SDK so it applies from the start
    if (this._permissionMode && this._permissionMode !== 'default') {
      queryOptions.permissionMode = this._permissionMode
    }

    // Start the query in background
    this.runQuery(prompt, queryOptions, options?.images)
  }
```

- [ ] **Step 4: Add dequeueNext() method**

Add after `executeQuery()`:

```typescript
  /** Process next queued message after current query completes */
  private dequeueNext(): void {
    if (this._messageQueue.length === 0) return
    if (this._status !== 'idle') return

    const next = this._messageQueue.shift()!
    this.emit('queue-updated', this.getQueue())
    this.executeQuery(next.prompt, next.options)
  }
```

- [ ] **Step 5: Hook dequeueNext into query lifecycle**

In `runQuery()`, after the `this.setStatus('idle')` + `this.emit('complete', result)` block (around line 263), add:

```typescript
          // Auto-dequeue next message after query completes
          // Use setImmediate to let the complete event propagate first
          setImmediate(() => this.dequeueNext())
```

Similarly, in the error handler (around line 272), after `this.emit('error', ...)`, add:

```typescript
      // On error, also try to dequeue next (the queued message may be unrelated)
      setImmediate(() => this.dequeueNext())
```

And in the AbortError handler (around line 268), **do NOT** add dequeueNext — abort means user explicitly stopped, queue should not auto-continue.

- [ ] **Step 6: Update abort() to clear queue**

Replace the current `abort()` method (lines 541-549):

```typescript
  async abort(): Promise<void> {
    // Clear the queue first — abort means "stop everything"
    this._messageQueue = []
    this.emit('queue-updated', this.getQueue())

    this.stopCurrentQuery('Session aborted')
    try {
      await this.queryInstance?.interrupt?.()
    } catch {
      // Ignore interrupt errors
    }
    this.setStatus('idle')
  }
```

- [ ] **Step 7: Verify build**

Run: `pnpm --filter @claude-agent-ui/server build`
Expected: Clean compilation.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/agent/v1-session.ts
git commit -m "feat: add message queue to V1QuerySession with FIFO dequeue on complete"
```

---

### Task 3: Server — Handler Integration

**Files:**
- Modify: `packages/server/src/ws/handler.ts`

- [ ] **Step 1: Update handleSendMessage to broadcast queue updates**

The current `handleSendMessage` calls `session.send()` at the end (line 373). The session will either execute or enqueue. We need to broadcast the user message regardless and handle the queue-updated event.

After the `session.send(...)` call (line 373), add queue broadcast:

```typescript
    session.send(prompt, {
      cwd: options?.cwd,
      images: options?.images,
      effort: options?.effort as any,
      thinkingMode: options?.thinkingMode as any,
    })

    // If the message was enqueued (session still running), broadcast queue state
    if (session instanceof V1QuerySession && session.queueLength > 0) {
      wsHub.broadcast(effectiveSessionId, {
        type: 'queue-updated',
        sessionId: effectiveSessionId,
        queue: session.getQueue(),
      } as any)
    }
```

- [ ] **Step 2: Add queue-updated event listener in bindSessionEvents**

Add after the `session.on('error', ...)` handler (around line 668):

```typescript
    session.on('queue-updated', (queue) => {
      wsHub.broadcast(realSessionId, {
        type: 'queue-updated',
        sessionId: realSessionId,
        queue,
      } as any)
    })
```

- [ ] **Step 3: Add clear-queue message handler**

Add to the `handleMessage` switch (after the `abort` case, around line 92):

```typescript
      case 'clear-queue':
        handleClearQueue(connectionId, (msg as any).sessionId)
        break
```

Add the handler function:

```typescript
  function handleClearQueue(connectionId: string, sessionId: string) {
    if (!lockManager.isHolder(sessionId, connectionId)) {
      wsHub.sendTo(connectionId, { type: 'error', message: 'Not lock holder', code: 'not_lock_holder' })
      return
    }

    const session = sessionManager.getActive(sessionId)
    if (!session || !(session instanceof V1QuerySession)) return

    session.clearQueue()
  }
```

- [ ] **Step 4: Update handleAbort — queue is already cleared by session.abort()**

No change needed — `session.abort()` now clears the queue internally (Task 2, Step 6), and the `queue-updated` event from Step 2 will broadcast the empty queue.

- [ ] **Step 5: Send queue state on join**

In `handleJoinSession()`, after sending `session-state` (around line 178), add:

```typescript
    // Send current queue state if session has queued messages
    if (activeSession instanceof V1QuerySession && activeSession.queueLength > 0) {
      wsHub.sendTo(connectionId, {
        type: 'queue-updated',
        sessionId,
        queue: activeSession.getQueue(),
      } as any)
    }
```

- [ ] **Step 6: Verify build**

Run: `pnpm --filter @claude-agent-ui/server build`
Expected: Clean compilation.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/ws/handler.ts
git commit -m "feat: integrate input queue into WS handler (broadcast, clear, join sync)"
```

---

### Task 4: Frontend — Store & WebSocket

**Files:**
- Modify: `packages/web/src/stores/sessionContainerStore.ts`
- Modify: `packages/web/src/lib/WebSocketManager.ts`

- [ ] **Step 1: Add queue field to SessionContainer**

In `SessionContainer` interface (after `subagentMessages`, line 68):

```typescript
  queue: QueueItem[]
```

Add import at the top of the file:

```typescript
import type {
  AgentMessage,
  SessionStatus,
  ClientLockStatus,
  ToolApprovalRequest,
  AskUserRequest,
  PlanApprovalRequest,
  ContextUsageCategory,
  McpServerStatusInfo,
  QueueItem,
} from '@claude-agent-ui/shared'
```

In `createContainer()` function (after `subagentMessages: null`, line 139):

```typescript
    queue: [],
```

- [ ] **Step 2: Add setQueue action**

In `SessionContainerActions` interface (after `setSubagentMessages`):

```typescript
  setQueue(sessionId: string, queue: QueueItem[]): void
```

In the store implementation:

```typescript
  setQueue(sessionId, queue) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, queue })
    set({ containers: next })
  },
```

- [ ] **Step 3: Add clearQueue to WebSocketManager**

In `WebSocketManager` public API section (after `stopTask`, line 189):

```typescript
  clearQueue(sessionId: string) {
    this.send({ type: 'clear-queue', sessionId } as any)
  }
```

- [ ] **Step 4: Add queue-updated handler to WebSocketManager**

In the `handleMessage` switch (after the `sync-result` case, around line 471):

```typescript
      case 'queue-updated':
        this.handleQueueUpdated(msg)
        break
```

Add the handler method:

```typescript
  private handleQueueUpdated(msg: any) {
    const sessionId = msg.sessionId as string | undefined
    if (!sessionId) return
    store().setQueue(sessionId, msg.queue ?? [])
  }
```

- [ ] **Step 5: Clear queue on session complete/abort**

In `handleSessionComplete()` (around line 1001), add after the existing cleanup:

```typescript
    s.setQueue(sessionId, [])
```

- [ ] **Step 6: Verify build**

Run: `pnpm --filter @claude-agent-ui/web build`
Expected: Clean compilation (may show warnings, no errors).

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/stores/sessionContainerStore.ts packages/web/src/lib/WebSocketManager.ts
git commit -m "feat: add queue state to frontend store and WebSocket handler"
```

---

### Task 5: Frontend — ChatComposer Allow Input While Running

**Files:**
- Modify: `packages/web/src/components/chat/ChatComposer.tsx`

- [ ] **Step 1: Change send button to show during running state**

The current button logic (around line 464) shows "■" (abort) when `isRunning`. Change to show **both** a send button and an abort button when running.

Replace the minimal mode button (lines 464-476):

```typescript
{isRunning ? (
  <div className="flex items-center gap-1">
    <button
      onClick={handleSubmit}
      disabled={!canSend}
      className={`w-8 h-8 rounded-lg flex items-center justify-center text-base font-bold transition-all duration-150 ${
        canSend
          ? 'bg-[var(--accent)] text-white hover:brightness-110 shadow-sm'
          : 'bg-[var(--border)] text-[var(--text-tertiary)] cursor-not-allowed'
      }`}
      title="Queue message"
    >
      ↑
    </button>
    <button
      onClick={onAbort}
      className="w-8 h-8 rounded-lg flex items-center justify-center text-base font-bold transition-all duration-150 bg-[var(--error)] text-white hover:brightness-110 shadow-sm"
      title="Stop (clears queue)"
    >
      ■
    </button>
  </div>
) : (
  <button
    onClick={handleSubmit}
    disabled={!canSend}
    className={`w-8 h-8 rounded-lg flex items-center justify-center text-base font-bold transition-all duration-150 ${
      canSend
        ? 'bg-[var(--accent)] text-white hover:brightness-110 shadow-sm'
        : 'bg-[var(--border)] text-[var(--text-tertiary)] cursor-not-allowed'
    }`}
    title="Send message"
  >
    ↑
  </button>
)}
```

- [ ] **Step 2: Add queue indicator above composer**

The composer needs a way to accept `queue` from the container. Add to the component props or read from context.

Add inside the ChatComposer component, before the textarea area, after the component retrieves its context data:

```typescript
const queue = container?.queue ?? []
```

Then render the queue indicator above the input area (before the textarea wrapper):

```typescript
{queue.length > 0 && (
  <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] border-b border-[var(--border)]">
    <span className="inline-flex items-center gap-1">
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
      {queue.length} message{queue.length > 1 ? 's' : ''} queued
    </span>
    <button
      onClick={() => wsManager.clearQueue(sessionId!)}
      className="text-[var(--text-tertiary)] hover:text-[var(--error)] transition-colors"
      title="Clear queue"
    >
      ✕
    </button>
  </div>
)}
```

Import `wsManager`:

```typescript
import { wsManager } from '../../lib/WebSocketManager'
```

- [ ] **Step 3: Also update ComposerToolbar for non-minimal mode**

In `ComposerToolbar` (or wherever the non-minimal send button lives), apply the same pattern: show send + abort when running, just send when idle. The exact file path needs to be verified — search for `ComposerToolbar` component.

- [ ] **Step 4: Verify dev build**

Run: `pnpm --filter @claude-agent-ui/web build`
Expected: Clean compilation.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/chat/ChatComposer.tsx
git commit -m "feat: allow input while running, show queue indicator in composer"
```

---

### Task 6: Frontend — Show Queued Messages in Chat

**Files:**
- Modify: `packages/web/src/components/chat/ChatMessagesPane.tsx`

- [ ] **Step 1: Render queued messages after the running indicator**

After the `ThinkingIndicator` block (around line 239) and before the `PlanApprovalCard`, add:

```typescript
{/* Queued messages */}
{queue.length > 0 && queue.map((item) => (
  <div key={item.id} className="px-4 py-2.5">
    <div className="flex items-start gap-3 opacity-50">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--accent)]/20 flex items-center justify-center">
        <span className="text-xs text-[var(--accent)]">Q</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-[var(--text-tertiary)] mb-0.5">Queued</div>
        <div className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap break-words line-clamp-3">
          {item.prompt}
        </div>
      </div>
    </div>
  </div>
))}
```

- [ ] **Step 2: Get queue from container**

At the top of the component where other container data is read, add:

```typescript
const queue = container?.queue ?? []
```

The `container` variable should already be available from the existing `useContainer()` hook or direct store access.

- [ ] **Step 3: Verify dev build**

Run: `pnpm --filter @claude-agent-ui/web build`
Expected: Clean compilation.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/chat/ChatMessagesPane.tsx
git commit -m "feat: render queued messages in chat pane"
```

---

### Task 7: Integration Verification

**Files:** None (verification only)

- [ ] **Step 1: Build all packages**

Run: `pnpm build`
Expected: All three packages build successfully.

- [ ] **Step 2: Type check**

Run: `pnpm lint`
Expected: No type errors.

- [ ] **Step 3: Manual test scenario — basic queue**

1. Start dev: `pnpm dev`
2. Open browser, select a project, start a session
3. Send a message that takes time (e.g., "Write a detailed analysis of React's reconciliation algorithm")
4. While agent is running, type and send another message
5. Verify: second message appears as "queued" in the chat
6. Verify: queue indicator shows "1 message queued" above composer
7. When first query completes, verify: queued message auto-executes

- [ ] **Step 4: Manual test scenario — abort clears queue**

1. Send a long-running message
2. Queue 2 more messages
3. Click abort (■)
4. Verify: current query stops, queue clears, both messages disappear

- [ ] **Step 5: Manual test scenario — clear queue button**

1. Send a long-running message
2. Queue a message
3. Click the ✕ clear queue button in the composer indicator
4. Verify: queue clears but current query continues running

- [ ] **Step 6: Manual test scenario — multi-terminal**

1. Open two browser tabs on same session
2. Tab A holds lock and sends a message
3. Tab A queues another message while running
4. Tab B should see queued messages (readonly)
5. When query completes and next auto-executes, both tabs see it

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: input queue — complete implementation with server queue, protocol, and frontend UI"
```
