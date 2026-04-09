# Lock Mechanism Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace connection-lifecycle lock with session-lifecycle lock — locks follow session state, not WebSocket connections. 60s timeout after session stops, no grace period, no reconnect transfer.

**Architecture:** Rewrite `LockManager` to ~50 lines (acquire/release/startTimeout). Remove all connection-lifecycle code from handler (onDisconnect, onReconnect, ownerConnectionId, auto-acquire on join, claim-lock). Client readonly derived from idle/holder status; idle = everyone can interact.

**Tech Stack:** TypeScript, Fastify WebSocket, Zustand, React

---

### Task 1: Rewrite LockManager

**Files:**
- Rewrite: `packages/server/src/ws/lock.ts`

- [ ] **Step 1: Replace lock.ts with minimal implementation**

```typescript
export interface SessionLock {
  holderId: string
  sessionId: string
  acquiredAt: number
  timeoutTimer: ReturnType<typeof setTimeout> | null
}

const TIMEOUT_MS = 60_000  // 1 min after session stops → auto-release

export class LockManager {
  private locks = new Map<string, SessionLock>()

  constructor(private onRelease: (sessionId: string) => void) {}

  /** Allow handler to override the release callback after construction */
  setOnRelease(cb: (sessionId: string) => void): void {
    this.onRelease = cb
  }

  acquire(sessionId: string, connectionId: string): { success: boolean; holder?: string } {
    const existing = this.locks.get(sessionId)
    if (existing && existing.holderId !== connectionId) {
      return { success: false, holder: existing.holderId }
    }
    // Clear any running timeout (re-acquire while timeout is ticking)
    if (existing?.timeoutTimer) {
      clearTimeout(existing.timeoutTimer)
    }
    this.locks.set(sessionId, {
      holderId: connectionId,
      sessionId,
      acquiredAt: Date.now(),
      timeoutTimer: null,
    })
    return { success: true }
  }

  release(sessionId: string): void {
    const lock = this.locks.get(sessionId)
    if (!lock) return
    if (lock.timeoutTimer) clearTimeout(lock.timeoutTimer)
    this.locks.delete(sessionId)
    this.onRelease(sessionId)
  }

  /** Start 60s countdown. Called when session stops (complete/error/approval-request). */
  startTimeout(sessionId: string): void {
    const lock = this.locks.get(sessionId)
    if (!lock) return
    if (lock.timeoutTimer) clearTimeout(lock.timeoutTimer)
    lock.timeoutTimer = setTimeout(() => {
      this.release(sessionId)
    }, TIMEOUT_MS)
  }

  getHolder(sessionId: string): string | null {
    return this.locks.get(sessionId)?.holderId ?? null
  }

  isHolder(sessionId: string, connectionId: string): boolean {
    return this.locks.get(sessionId)?.holderId === connectionId
  }

  getStatus(sessionId: string): 'idle' | 'locked' {
    return this.locks.has(sessionId) ? 'locked' : 'idle'
  }

  getLockedSessions(connectionId: string): string[] {
    const sessions: string[] = []
    for (const [sessionId, lock] of this.locks) {
      if (lock.holderId === connectionId) sessions.push(sessionId)
    }
    return sessions
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd packages/server && npx tsc --noEmit 2>&1 | head -20`

Expected: Errors in handler.ts (references to removed methods). This is expected — we fix handler.ts in the next tasks.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/ws/lock.ts
git commit -m "refactor: rewrite LockManager to session-lifecycle model

Remove connection-lifecycle coupling: no gracePeriod, no onDisconnect,
no onReconnect, no isConnectionAlive. Lock releases via 60s timeout
after session stops, or explicit release."
```

---

### Task 2: Clean up handler.ts — remove connection-lifecycle lock code

**Files:**
- Modify: `packages/server/src/ws/handler.ts`

- [ ] **Step 1: Remove dead-connection handler and isConnectionAlive setup (top of createWsHandler)**

Remove these lines near top of `createWsHandler`:
```typescript
// DELETE: lines ~40-42
wsHub.setOnDeadConnection((deadConnectionId) => {
  lockManager.onDisconnect(deadConnectionId)
})

// DELETE: line ~64
lockManager.setIsConnectionAlive((connectionId: string) => !!wsHub.getClient(connectionId))
```

Keep `wsHub.startHeartbeat()` — heartbeat is still needed for WS health, just not for lock management.

- [ ] **Step 2: Remove lockManager.onDisconnect from ws.on('close')**

Replace ws.on('close') handler:
```typescript
// BEFORE:
ws.on('close', () => {
  const heldLocks = lockManager.getLockedSessions(connectionId)
  if (heldLocks.length > 0) {
    console.log(`[LOCK-DEBUG] ws.close conn=${connectionId.slice(0,8)} heldLocks=${JSON.stringify(heldLocks.map(s => s.slice(0,8)))}`)
  }
  lockManager.onDisconnect(connectionId)
  wsHub.unregister(connectionId)
})

// AFTER:
ws.on('close', () => {
  wsHub.unregister(connectionId)
})
```

- [ ] **Step 3: Remove claim-lock case from handleMessage switch**

Delete the `case 'claim-lock'` branch and the `handleClaimLock` function entirely (lines ~117-118, ~922-936).

- [ ] **Step 4: Remove lock/owner migration from handleReconnect**

Replace `handleReconnect`:
```typescript
function handleReconnect(_connectionId: string, _previousConnectionId: string) {
  // Lock no longer tracks connections — nothing to migrate.
  // Session join is handled by the client's resubscribeAll().
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd packages/server && npx tsc --noEmit 2>&1 | head -30`

Expected: Errors in handler.ts about remaining references to `ownerConnectionId`, `resetIdleTimer`, debug code. We fix these next.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/ws/handler.ts
git commit -m "refactor: remove connection-lifecycle lock code from handler

Remove onDisconnect, claim-lock, handleReconnect lock migration,
dead connection handler. Lock no longer coupled to WS lifecycle."
```

---

### Task 3: Simplify handleJoinSession — no auto-acquire

**Files:**
- Modify: `packages/server/src/ws/handler.ts`

- [ ] **Step 1: Rewrite handleJoinSession**

Replace the entire `handleJoinSession` function. The new version only sends session-state + replays + resends pending. No lock operations.

```typescript
function handleJoinSession(connectionId: string, sessionId: string, lastSeq?: number) {
  const syncResult = wsHub.joinWithSync(connectionId, sessionId, lastSeq ?? 0)
  const alreadyInSession = syncResult.alreadyInSession
  const lockHolder = lockManager.getHolder(sessionId)
  const activeSession = sessionManager.getActive(sessionId)
  const isLockHolder = lockHolder === connectionId

  // Warm up session for MCP/model/context data if not already active
  if (!activeSession && sessionId && sessionId !== '__new__') {
    sessionManager.resumeSession(sessionId).then((session) => {
      session.on('models', (models: any[]) => {
        wsHub.broadcast(sessionId, {
          type: 'models', sessionId,
          models: models.map((m: any) => ({
            value: m.value, displayName: m.displayName, description: m.description,
            supportsAutoMode: m.supportsAutoMode, supportedEffortLevels: m.supportedEffortLevels,
          })),
        })
      })
      session.on('account-info', (info: any) => {
        wsHub.broadcast(sessionId, {
          type: 'account-info', sessionId,
          email: info.email, organization: info.organization,
          subscriptionType: info.subscriptionType, apiProvider: info.apiProvider,
        })
      })
      session.on('mcp-status', (servers: any[]) => {
        wsHub.broadcast(sessionId, { type: 'mcp-status', sessionId, servers })
      })
      session.on('context-usage', (usage: any) => {
        wsHub.broadcast(sessionId, {
          type: 'context-usage', sessionId,
          categories: usage.categories, totalTokens: usage.totalTokens,
          maxTokens: usage.maxTokens, percentage: usage.percentage, model: usage.model,
        })
      })
      if ('warmUp' in session) (session as any).warmUp()
    }).catch(() => {})
  }

  // Send session state
  wsHub.sendTo(connectionId, {
    type: 'session-state', sessionId,
    sessionStatus: activeSession?.status ?? 'idle',
    lockStatus: lockManager.getStatus(sessionId),
    lockHolderId: lockHolder ?? undefined,
    isLockHolder,
    permissionMode: activeSession?.permissionMode,
  })

  if (!alreadyInSession) {
    const snapshot = wsHub.getStreamSnapshot(sessionId)
    if (snapshot) {
      wsHub.sendTo(connectionId, {
        type: 'stream-snapshot', sessionId,
        messageId: snapshot.messageId, blocks: snapshot.blocks,
      })
    }
    wsHub.sendTo(connectionId, {
      type: 'sync-result', sessionId,
      replayed: syncResult.replayed, hasGap: syncResult.hasGap,
      gapRange: syncResult.gapRange,
    } as any)
  }

  // Load model name + detect pending from history (async)
  if (sessionId && sessionId !== '__new__') {
    getSessionMessages(sessionId).then((msgs: any[]) => {
      for (let i = msgs.length - 1; i >= 0; i--) {
        const model = msgs[i]?.message?.model
        if (msgs[i].type === 'assistant' && model) {
          wsHub.sendTo(connectionId, { type: 'account-info', sessionId, model } as any)
          break
        }
      }
      detectPendingFromHistory(sessionId, connectionId, msgs)
    }).catch(() => {})
  }

  // Re-send pending requests — readonly if locked by someone else
  const readonly = lockHolder !== null && lockHolder !== connectionId
  resendPendingRequests(sessionId, connectionId, readonly)
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/ws/handler.ts
git commit -m "refactor: simplify handleJoinSession — no auto-acquire lock"
```

---

### Task 4: Fix handleSendMessage — single acquire + broadcast

**Files:**
- Modify: `packages/server/src/ws/handler.ts`

- [ ] **Step 1: Replace handleSendMessage lock logic**

Find the existing lock handling in `handleSendMessage` (around lines 392-421). Replace with single acquire:

```typescript
async function handleSendMessage(
  connectionId: string,
  sessionId: string | null,
  prompt: string,
  options?: { cwd?: string; images?: any[]; thinkingMode?: string; effort?: string; permissionMode?: string }
) {
  let effectiveSessionId = sessionId
  let session: AgentSession

  if (!effectiveSessionId) {
    if (!options?.cwd) {
      wsHub.sendTo(connectionId, { type: 'error', message: 'cwd is required for new sessions', code: 'internal' })
      return
    }
    session = sessionManager.createSession(options.cwd)
    effectiveSessionId = `pending-${connectionId}`
  } else {
    // Single acquire — succeeds if idle or already holder, fails if someone else holds
    const lockResult = lockManager.acquire(effectiveSessionId, connectionId)
    if (!lockResult.success) {
      wsHub.sendTo(connectionId, {
        type: 'error',
        message: 'Session is locked by another client',
        code: 'session_locked',
      })
      return
    }
    // Broadcast lock acquisition
    wsHub.broadcast(effectiveSessionId, {
      type: 'lock-status',
      sessionId: effectiveSessionId,
      status: 'locked',
      holderId: connectionId,
    })

    session = sessionManager.getActive(effectiveSessionId) ?? await sessionManager.resumeSession(effectiveSessionId)
  }

  // ... rest of function unchanged (broadcastContent, permissionMode, pendingSessionMap, bindSessionEvents, user message broadcast, session.send) ...
```

Remove the old duplicate acquire block (the `if (effectiveSessionId && !effectiveSessionId.startsWith('pending-'))` block that was lines ~413-421).

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/ws/handler.ts
git commit -m "refactor: single lock acquire in handleSendMessage"
```

---

### Task 5: Fix bindSessionEvents — use lockManager.getHolder for readonly + startTimeout on stops

**Files:**
- Modify: `packages/server/src/ws/handler.ts`

- [ ] **Step 1: Remove ownerConnectionId assignment**

Delete this block from top of `bindSessionEvents`:
```typescript
// DELETE:
session.ownerConnectionId = connectionId
```

- [ ] **Step 2: Replace ownerConnectionId in tool-approval/ask-user/plan-approval events**

Replace readonly check in all three event handlers. For each one, change `connId !== session.ownerConnectionId` to use `lockManager.getHolder()`:

```typescript
session.on('tool-approval', (req) => {
  lockManager.startTimeout(realSessionId)
  pendingRequestMap.set(req.requestId, {
    sessionId: realSessionId, type: 'tool-approval', toolName: req.toolName, payload: req,
  })
  const holder = lockManager.getHolder(realSessionId)
  for (const connId of wsHub.getSessionClients(realSessionId)) {
    wsHub.sendTo(connId, {
      type: 'tool-approval-request', sessionId: realSessionId, ...req,
      readonly: holder !== null && connId !== holder,
    })
  }
})

session.on('ask-user', (req) => {
  lockManager.startTimeout(realSessionId)
  pendingRequestMap.set(req.requestId, {
    sessionId: realSessionId, type: 'ask-user', payload: req,
  })
  const holder = lockManager.getHolder(realSessionId)
  for (const connId of wsHub.getSessionClients(realSessionId)) {
    wsHub.sendTo(connId, {
      type: 'ask-user-request', sessionId: realSessionId, ...req,
      readonly: holder !== null && connId !== holder,
    })
  }
})

session.on('plan-approval', (req) => {
  lockManager.startTimeout(realSessionId)
  pendingRequestMap.set(req.requestId, {
    sessionId: realSessionId, type: 'plan-approval', payload: req,
  })
  const holder = lockManager.getHolder(realSessionId)
  for (const connId of wsHub.getSessionClients(realSessionId)) {
    wsHub.sendTo(connId, {
      type: 'plan-approval', sessionId: realSessionId, ...req,
      readonly: holder !== null && connId !== holder,
    })
  }
})
```

- [ ] **Step 3: Replace resetIdleTimer with startTimeout in complete/error handlers**

```typescript
session.on('complete', (result) => {
  lockManager.startTimeout(realSessionId)  // was: resetIdleTimer
  // ... rest unchanged
})

session.on('error', (err) => {
  lockManager.startTimeout(realSessionId)  // was: resetIdleTimer
  // ... rest unchanged
})
```

- [ ] **Step 4: Replace ownerConnectionId in pending- init (lock acquire)**

In the `session.on('message')` handler, for the `pending-` branch, change:
```typescript
// BEFORE:
const ownerId = session.ownerConnectionId ?? connectionId
lockManager.acquire(newId, ownerId)
wsHub.joinSession(ownerId, newId)
// ...holderId: ownerId

// AFTER:
lockManager.acquire(newId, connectionId)
wsHub.joinSession(connectionId, newId)
// ...holderId: connectionId
```

Same for the `else if (realSessionId !== newId)` branch — replace `ownerId` with `connectionId`.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/ws/handler.ts
git commit -m "refactor: use lockManager.getHolder for readonly, add startTimeout on session stops"
```

---

### Task 6: Fix response handlers — acquire lock for responder + remove resetIdleTimer

**Files:**
- Modify: `packages/server/src/ws/handler.ts`

- [ ] **Step 1: Fix handleToolApprovalResponse**

```typescript
function handleToolApprovalResponse(connectionId: string, requestId: string, decision: ToolApprovalDecision) {
  const entry = pendingRequestMap.get(requestId)
  if (!entry) return

  const session = sessionManager.getActive(entry.sessionId)
  if (!session) return

  // Acquire lock for the responder (succeeds if idle or already holder)
  const lockResult = lockManager.acquire(entry.sessionId, connectionId)
  if (lockResult.success) {
    wsHub.broadcast(entry.sessionId, {
      type: 'lock-status', sessionId: entry.sessionId,
      status: 'locked', holderId: connectionId,
    })
  }

  session.resolveToolApproval(requestId, decision)
  pendingRequestMap.delete(requestId)

  wsHub.broadcast(entry.sessionId, {
    type: 'tool-approval-resolved', sessionId: entry.sessionId,
    requestId,
    decision: { behavior: decision.behavior, message: decision.behavior === 'deny' ? decision.message : undefined },
  })
}
```

- [ ] **Step 2: Fix handleAskUserResponse**

In the active-session branch, add lock acquire for responder. In the resume branch, keep the existing `lockManager.acquire` + broadcast. Remove `lockManager.resetIdleTimer` at the end.

```typescript
async function handleAskUserResponse(connectionId: string, requestId: string, answers: Record<string, string>) {
  const entry = pendingRequestMap.get(requestId)
  if (!entry) return

  let session = sessionManager.getActive(entry.sessionId)

  if (session) {
    // Acquire lock for responder
    const lockResult = lockManager.acquire(entry.sessionId, connectionId)
    if (lockResult.success) {
      wsHub.broadcast(entry.sessionId, {
        type: 'lock-status', sessionId: entry.sessionId,
        status: 'locked', holderId: connectionId,
      })
    }
    session.resolveAskUser(requestId, { answers })
  } else {
    // Resume after server restart — same as before but no resetIdleTimer
    try {
      session = await sessionManager.resumeSession(entry.sessionId)
      if (session instanceof V1QuerySession) {
        session.cacheAskUserAnswer(answers)
        bindSessionEvents(session, entry.sessionId, connectionId)
        lockManager.acquire(entry.sessionId, connectionId)
        wsHub.broadcast(entry.sessionId, {
          type: 'lock-status', sessionId: entry.sessionId,
          status: 'locked', holderId: connectionId,
        })
        session.send('', { cwd: session.projectCwd })
      }
    } catch { /* Resume failed */ }
  }

  pendingRequestMap.delete(requestId)
  wsHub.broadcast(entry.sessionId, {
    type: 'ask-user-resolved', sessionId: entry.sessionId, requestId, answers,
  })
}
```

- [ ] **Step 3: Fix handleResolvePlanApproval — add lock acquire, remove resetIdleTimer**

After the mode switch and before `session.resolvePlanApproval`, add:
```typescript
// Acquire lock for the responder
const lockResult = lockManager.acquire(entry.sessionId, _connectionId)
if (lockResult.success) {
  wsHub.broadcast(entry.sessionId, {
    type: 'lock-status', sessionId: entry.sessionId,
    status: 'locked', holderId: _connectionId,
  })
}
```

Remove `lockManager.resetIdleTimer(entry.sessionId)`. Rename `_connectionId` parameter to `connectionId`.

- [ ] **Step 4: Fix handleAbort — remove direct release**

```typescript
async function handleAbort(connectionId: string, sessionId: string) {
  if (!lockManager.isHolder(sessionId, connectionId)) {
    wsHub.sendTo(connectionId, { type: 'error', message: 'Not lock holder', code: 'not_lock_holder' })
    return
  }

  const session = sessionManager.getActive(sessionId)
  if (!session) return

  await session.abort()
  // Don't release lock here — session.abort() triggers 'complete' or 'error'
  // which calls startTimeout. Lock releases after 60s timeout.

  wsHub.broadcast(sessionId, { type: 'session-aborted', sessionId })
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/ws/handler.ts
git commit -m "refactor: response handlers acquire lock for responder, abort no longer releases"
```

---

### Task 7: Fix detectPendingFromHistory — no lock acquire

**Files:**
- Modify: `packages/server/src/ws/handler.ts`

- [ ] **Step 1: Remove lock acquire from detectPendingFromHistory**

In the `detectPendingFromHistory` function, find the AskUserQuestion detection block. Change it to:

```typescript
if (block.name === 'AskUserQuestion' && block.input?.questions) {
  const requestId = block.id
  pendingRequestMap.set(requestId, {
    sessionId,
    type: 'ask-user',
    payload: { requestId, questions: block.input.questions },
  })
  // Send to the joining client — readonly based on lock state
  const holder = lockManager.getHolder(sessionId)
  const readonly = holder !== null && holder !== connectionId
  wsHub.sendTo(connectionId, {
    type: 'ask-user-request', sessionId, requestId,
    questions: block.input.questions, readonly,
  } as any)
  // No lock acquire — idle state means anyone can respond
  return
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/ws/handler.ts
git commit -m "refactor: detectPendingFromHistory no longer acquires lock"
```

---

### Task 8: Clean up session.ts, index.ts, debug code

**Files:**
- Modify: `packages/server/src/agent/session.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/ws/handler.ts`

- [ ] **Step 1: Remove ownerConnectionId from session.ts**

Delete the `ownerConnectionId` property and its JSDoc:
```typescript
// DELETE from AgentSession class:
/** The connectionId of the client that owns this session.
 *  Mutable — updated by handleReconnect when the WS reconnects,
 *  so that closures in bindSessionEvents always use the latest connectionId. */
ownerConnectionId: string | null = null
```

- [ ] **Step 2: Remove debug endpoint and setIsConnectionAlive from index.ts**

Delete the `/api/debug/locks` route block and the `lockManager.setIsConnectionAlive(...)` line.

- [ ] **Step 3: Remove pendingSessionMap from handler.ts**

Delete the `pendingSessionMap` declaration and all references to it (in `handleSendMessage` and `handleReconnect`).

- [ ] **Step 4: Remove all [LOCK-DEBUG] console.log statements from handler.ts**

Search for `[LOCK-DEBUG]` and remove every console.log line.

- [ ] **Step 5: Remove getAllActive from manager.ts if no longer used**

Check if `getAllActive()` is used anywhere other than the removed reconnect code. If not, remove it.

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd packages/server && npx tsc --noEmit`

Expected: Clean compile, zero errors.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/agent/session.ts packages/server/src/agent/manager.ts packages/server/src/index.ts packages/server/src/ws/handler.ts
git commit -m "refactor: clean up ownerConnectionId, debug code, pendingSessionMap"
```

---

### Task 9: Client — fix readonly logic for idle state

**Files:**
- Modify: `packages/web/src/lib/WebSocketManager.ts`

- [ ] **Step 1: Fix handleLockStatus — idle means readonly=false**

```typescript
private handleLockStatus(msg: any) {
  const sessionId = msg.sessionId as string | undefined
  if (!sessionId) return

  const s = store()
  const myId = this.connectionId
  const amIHolder = msg.status !== 'idle' && msg.holderId === myId

  const lockStatus = msg.status === 'idle' ? 'idle'
    : amIHolder ? 'locked_self' : 'locked_other'
  s.setLockStatus(sessionId, lockStatus, msg.holderId ?? null)

  // Sync readonly flag on pending requests
  // idle → everyone can interact (readonly=false)
  // locked_self → I can interact (readonly=false)
  // locked_other → I cannot interact (readonly=true)
  const readonly = lockStatus === 'locked_other'
  const container = s.containers.get(sessionId)
  if (!container) return
  if (container.pendingAskUser) {
    s.setAskUser(sessionId, { ...container.pendingAskUser, readonly })
  }
  if (container.pendingApproval) {
    s.setApproval(sessionId, { ...container.pendingApproval, readonly })
  }
  if (container.pendingPlanApproval) {
    s.setPlanApproval(sessionId, { ...container.pendingPlanApproval, readonly })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/lib/WebSocketManager.ts
git commit -m "fix: idle lock status means readonly=false for all pending requests"
```

---

### Task 10: Client — remove claim-lock infrastructure

**Files:**
- Delete: `packages/web/src/hooks/useClaimLock.ts`
- Modify: `packages/web/src/components/chat/ApprovalPanel.tsx`
- Modify: `packages/web/src/providers/ChatSessionProvider.tsx`
- Modify: `packages/web/src/providers/ChatSessionContext.ts`
- Modify: `packages/web/src/lib/WebSocketManager.ts`
- Modify: `packages/shared/src/protocol.ts`

- [ ] **Step 1: Delete useClaimLock.ts**

```bash
rm packages/web/src/hooks/useClaimLock.ts
```

- [ ] **Step 2: Remove claimLock from WebSocketManager.ts**

Delete the `claimLock` method:
```typescript
// DELETE:
claimLock(sessionId: string) {
  this.send({ type: 'claim-lock', sessionId })
}
```

- [ ] **Step 3: Remove claimLock from ChatSessionContext.ts**

Delete `claimLock(): void` from the context interface.

- [ ] **Step 4: Remove claimLock from ChatSessionProvider.tsx**

Delete the `claimLock()` action from the context value object.

- [ ] **Step 5: Simplify ApprovalPanel.tsx — remove canClaim logic**

Replace the claim-related logic:
```typescript
// BEFORE:
import { useClaimLock } from '../../hooks/useClaimLock'
// ...
const handleClaim = useClaimLock()
const readonly = config.readonly
const isIdle = lockStatus === 'idle'
const canClaim = readonly && isIdle
const canInteract = !readonly || canClaim
// ...
if (canClaim) handleClaim()

// AFTER:
const canInteract = !config.readonly
// ... remove handleClaim() call from fireDecision
```

Update `fireDecision`:
```typescript
const fireDecision = useCallback((key: string, extra?: string) => {
  if (!canInteract) return
  config.onDecision(key, extra)
}, [canInteract, config])
```

Remove the `useClaimLock` import.

- [ ] **Step 6: Remove C2S_ClaimLock from protocol.ts**

Delete the interface and remove from the `C2SMessage` union:
```typescript
// DELETE interface:
export interface C2S_ClaimLock {
  type: 'claim-lock'
  sessionId: string
}

// DELETE from C2SMessage union:
| C2S_ClaimLock
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `cd packages/server && npx tsc --noEmit && cd ../web && npx tsc --noEmit && cd ../shared && npx tsc --noEmit`

Expected: Clean compile across all packages.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: remove claim-lock infrastructure from client and protocol"
```

---

### Task 11: Final verification

- [ ] **Step 1: Full type check**

Run: `pnpm lint`

Expected: All packages pass.

- [ ] **Step 2: Manual test — basic lock lifecycle**

1. Open http://localhost:5173
2. Create new session, send a message
3. Watch session run → lock should be held (status bar shows running)
4. Session completes → after 60s, lock should release (status shows idle)

- [ ] **Step 3: Manual test — multi-window**

1. Window A: send message → lock held by A
2. Window B: open same session → sees "locked by another client"
3. Wait for session to stop + 60s timeout → B can now input
4. B sends message → lock transfers to B

- [ ] **Step 4: Manual test — AskUserQuestion timeout**

1. Send message that triggers AskUserQuestion
2. Wait 60s → lock should release
3. From another window, answer the question → lock acquired by responder

- [ ] **Step 5: Commit spec and plan**

```bash
git add docs/superpowers/specs/2026-04-09-lock-refactor-design.md docs/superpowers/plans/2026-04-09-lock-refactor.md
git commit -m "docs: add lock refactor spec and implementation plan"
```
