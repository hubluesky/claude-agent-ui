# Persistent Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-query lock model with persistent manual lock — first to send claims lock, lock persists until manual release or 1-min idle timeout.

**Architecture:** Server LockManager gains idle timeout + manual release. Handler stops auto-releasing on session-complete. Client ComposerToolbar gets lock indicator button. New `release-lock` C2S message type.

**Tech Stack:** TypeScript, Fastify WebSocket, React/Zustand, TailwindCSS

---

### Task 1: Add `C2S_ReleaseLock` to shared protocol

**Files:**
- Modify: `packages/shared/src/protocol.ts`

- [ ] **Step 1: Add the new message type**

In `packages/shared/src/protocol.ts`, add after `C2S_LeaveSession`:

```typescript
export interface C2S_ReleaseLock {
  type: 'release-lock'
  sessionId: string
}
```

Update the `C2SMessage` union to include it:

```typescript
export type C2SMessage =
  | C2S_JoinSession
  | C2S_SendMessage
  | C2S_ToolApprovalResponse
  | C2S_AskUserResponse
  | C2S_Abort
  | C2S_SetMode
  | C2S_SetEffort
  | C2S_Reconnect
  | C2S_LeaveSession
  | C2S_ResolvePlanApproval
  | C2S_ReleaseLock
```

- [ ] **Step 2: Build shared to verify**

```bash
pnpm --filter @claude-agent-ui/shared build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/protocol.ts
git commit -m "feat(shared): add C2S_ReleaseLock message type"
```

---

### Task 2: Add idle timeout to LockManager

**Files:**
- Modify: `packages/server/src/ws/lock.ts`

- [ ] **Step 1: Add idleTimer to SessionLock and increase grace period**

Replace the full `lock.ts` content:

```typescript
export interface SessionLock {
  holderId: string
  sessionId: string
  acquiredAt: number
  gracePeriodTimer: ReturnType<typeof setTimeout> | null
  idleTimer: ReturnType<typeof setTimeout> | null
}

const GRACE_PERIOD_MS = 60_000  // 1 min (up from 10s)
const IDLE_TIMEOUT_MS = 60_000  // 1 min no interaction → auto-release

export class LockManager {
  private locks = new Map<string, SessionLock>()

  constructor(private onRelease: (sessionId: string) => void) {}

  acquire(sessionId: string, connectionId: string): { success: boolean; holder?: string } {
    const existing = this.locks.get(sessionId)
    if (existing && existing.holderId !== connectionId) {
      return { success: false, holder: existing.holderId }
    }
    // Clear any existing timers before re-acquiring
    if (existing) {
      if (existing.gracePeriodTimer) clearTimeout(existing.gracePeriodTimer)
      if (existing.idleTimer) clearTimeout(existing.idleTimer)
    }
    this.locks.set(sessionId, {
      holderId: connectionId,
      sessionId,
      acquiredAt: Date.now(),
      gracePeriodTimer: null,
      idleTimer: this.startIdleTimer(sessionId),
    })
    return { success: true }
  }

  release(sessionId: string): void {
    const lock = this.locks.get(sessionId)
    if (!lock) return
    if (lock.gracePeriodTimer) clearTimeout(lock.gracePeriodTimer)
    if (lock.idleTimer) clearTimeout(lock.idleTimer)
    this.locks.delete(sessionId)
    this.onRelease(sessionId)
  }

  /** Reset the idle timer — call on every user interaction (send, approve, answer) */
  resetIdleTimer(sessionId: string): void {
    const lock = this.locks.get(sessionId)
    if (!lock) return
    if (lock.idleTimer) clearTimeout(lock.idleTimer)
    lock.idleTimer = this.startIdleTimer(sessionId)
  }

  onDisconnect(connectionId: string): void {
    for (const [sessionId, lock] of this.locks) {
      if (lock.holderId === connectionId) {
        // Pause idle timer during disconnection grace
        if (lock.idleTimer) {
          clearTimeout(lock.idleTimer)
          lock.idleTimer = null
        }
        lock.gracePeriodTimer = setTimeout(() => {
          this.release(sessionId)
        }, GRACE_PERIOD_MS)
      }
    }
  }

  onReconnect(previousConnectionId: string, newConnectionId: string): void {
    for (const lock of this.locks.values()) {
      if (lock.holderId === previousConnectionId) {
        if (lock.gracePeriodTimer) {
          clearTimeout(lock.gracePeriodTimer)
          lock.gracePeriodTimer = null
        }
        lock.holderId = newConnectionId
        // Restart idle timer on reconnect
        if (lock.idleTimer) clearTimeout(lock.idleTimer)
        lock.idleTimer = this.startIdleTimer(lock.sessionId)
      }
    }
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
      if (lock.holderId === connectionId) {
        sessions.push(sessionId)
      }
    }
    return sessions
  }

  private startIdleTimer(sessionId: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      this.release(sessionId)
    }, IDLE_TIMEOUT_MS)
  }
}
```

- [ ] **Step 2: Build server to verify**

```bash
pnpm --filter @claude-agent-ui/server build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/ws/lock.ts
git commit -m "feat(server): persistent lock with 1-min idle timeout and extended grace period"
```

---

### Task 3: Update handler — persistent lock + release-lock + idle reset

**Files:**
- Modify: `packages/server/src/ws/handler.ts`

- [ ] **Step 1: Add `release-lock` to message switch**

In `handleMessage`, add a new case:

```typescript
case 'release-lock':
  handleReleaseLock(connectionId, msg.sessionId)
  break
```

- [ ] **Step 2: Implement handleReleaseLock**

Add this function after `handleAbort`:

```typescript
function handleReleaseLock(connectionId: string, sessionId: string) {
  if (!lockManager.isHolder(sessionId, connectionId)) {
    wsHub.sendTo(connectionId, { type: 'error', message: 'Not lock holder', code: 'not_lock_holder' })
    return
  }
  lockManager.release(sessionId)
  // onRelease callback broadcasts lock-status: idle (via LockManager constructor)
}
```

- [ ] **Step 3: Remove lock release from session-complete and session-error**

In `bindSessionEvents`, change the `complete` handler — remove `lockManager.release(realSessionId)` and the idle lock-status broadcast:

```typescript
session.on('complete', (result) => {
  // Lock persists — do NOT release on completion
  // Reset idle timer since session just finished (user may want to continue)
  lockManager.resetIdleTimer(realSessionId)
  wsHub.broadcast(realSessionId, {
    type: 'session-complete',
    sessionId: realSessionId,
    result,
  })
})
```

Same for the `error` handler:

```typescript
session.on('error', (err) => {
  // Lock persists — do NOT release on error
  lockManager.resetIdleTimer(realSessionId)
  wsHub.broadcast(realSessionId, {
    type: 'error',
    message: err.message,
    code: 'internal',
  })
})
```

- [ ] **Step 4: Add resetIdleTimer calls to interaction handlers**

Add `lockManager.resetIdleTimer(entry.sessionId)` at the START of each response handler (after the lock holder check passes):

In `handleToolApprovalResponse`, after line `session.resolveToolApproval(...)`:
```typescript
lockManager.resetIdleTimer(entry.sessionId)
```

In `handleAskUserResponse`, after line `session.resolveAskUser(...)`:
```typescript
lockManager.resetIdleTimer(entry.sessionId)
```

In `handleResolvePlanApproval`, after line `session.resolvePlanApproval(...)`:
```typescript
lockManager.resetIdleTimer(entry.sessionId)
```

In `handleSendMessage`, after the lock is acquired (after `lockManager.acquire`):
```typescript
// resetIdleTimer is already handled by acquire() which starts a fresh timer
```

- [ ] **Step 5: Add auto-claim on join when pending tasks exist**

In `handleJoinSession`, after the pending request re-send loop, add auto-claim logic:

```typescript
// Auto-claim lock if no holder AND there are pending requests for this session
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
    // Re-send pending requests as non-readonly since this client now holds lock
    for (const [, entry] of pendingRequestMap) {
      if (entry.sessionId !== sessionId) continue
      if (entry.type === 'tool-approval') {
        wsHub.sendTo(connectionId, { type: 'tool-approval-request', ...entry.payload, readonly: false } as any)
      } else if (entry.type === 'ask-user') {
        wsHub.sendTo(connectionId, { type: 'ask-user-request', ...entry.payload, readonly: false } as any)
      } else if (entry.type === 'plan-approval') {
        wsHub.sendTo(connectionId, { type: 'plan-approval', sessionId, ...entry.payload, readonly: false } as any)
      }
    }
  }
}
```

- [ ] **Step 6: Ensure LockManager onRelease broadcasts lock-status**

Check the LockManager constructor call (likely in server startup). The `onRelease` callback should broadcast `lock-status: idle`. Find where `new LockManager(...)` is called:

```typescript
const lockManager = new LockManager((sessionId) => {
  wsHub.broadcast(sessionId, {
    type: 'lock-status',
    sessionId,
    status: 'idle',
  })
})
```

If it's already doing this, no change needed. If not, update it.

- [ ] **Step 7: Build and verify**

```bash
pnpm --filter @claude-agent-ui/server build
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/ws/handler.ts
git commit -m "feat(server): persistent lock — no auto-release on complete, manual release, idle timer reset"
```

---

### Task 4: Add lock indicator to ComposerToolbar

**Files:**
- Modify: `packages/web/src/components/chat/ComposerToolbar.tsx`
- Modify: `packages/web/src/hooks/useWebSocket.ts`

- [ ] **Step 1: Add `releaseLock` helper to useWebSocket**

In `packages/web/src/hooks/useWebSocket.ts`, add after the `abort` function:

```typescript
function releaseLock(sessionId: string) {
  send({ type: 'release-lock', sessionId })
}
```

Update the return:
```typescript
return { send, sendMessage, joinSession, respondToolApproval, respondAskUser, respondPlanApproval, abort, releaseLock, disconnect }
```

- [ ] **Step 2: Add lock indicator to ComposerToolbar**

In `packages/web/src/components/chat/ComposerToolbar.tsx`:

Add to imports:
```typescript
import { useWebSocket } from '../../hooks/useWebSocket'
```

This is already imported. Now update the component. Add `lockStatus` from connection store and `releaseLock` from useWebSocket:

Inside the component function, after existing hooks:
```typescript
const { releaseLock } = useWebSocket()
const lockStatus = useConnectionStore((s) => s.lockStatus)
const { currentSessionId } = useSessionStore()

const handleReleaseLock = useCallback(() => {
  if (currentSessionId && currentSessionId !== '__new__' && lockStatus === 'locked_self') {
    releaseLock(currentSessionId)
  }
}, [currentSessionId, lockStatus, releaseLock])
```

Note: `useWebSocket` and `useSessionStore` are already imported. `lockStatus` — we need to read from the store directly since it's not passed as a prop currently. Actually, looking at the code, `isLocked` prop already represents `lockStatus === 'locked_other'`. We need the full `lockStatus` to also detect `locked_self`. Let me update the approach.

The `ComposerToolbar` receives `isLocked` (boolean, true when `locked_other`). We need to pass the full `lockStatus` or just `isLockHolder`. Let's add a prop:

Update `ComposerToolbarProps`:
```typescript
interface ComposerToolbarProps {
  onUpload: () => void
  onSlashClick: () => void
  onAtClick: () => void
  onSend: () => void
  onAbort: () => void
  canSend: boolean
  fileRefs: string[]
  isLocked: boolean
  isRunning: boolean
  isLockHolder: boolean
  onReleaseLock: () => void
}
```

Update destructuring:
```typescript
export function ComposerToolbar({
  onUpload, onSlashClick, onAtClick, onSend, onAbort,
  canSend, fileRefs, isLocked, isRunning, isLockHolder, onReleaseLock,
}: ComposerToolbarProps) {
```

In the JSX, add lock indicator between the status indicator and the mode selector. After the `statusInfo` block (after line `<span className="text-[#3d3b37]">|</span>`), add:

```typescript
{isLockHolder && (
  <>
    <button
      onClick={onReleaseLock}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] text-[#a8a29e] hover:text-[#e5e2db] hover:bg-[#3d3b3780] transition-colors"
      title="Release lock (allow other terminals to control)"
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    </button>
    <span className="text-[#3d3b37]">|</span>
  </>
)}
```

- [ ] **Step 3: Pass new props from ChatComposer**

In `packages/web/src/components/chat/ChatComposer.tsx`, update the `ComposerToolbar` usage:

Add near the top of the component (after the existing `isLocked` / `isRunning` lines):
```typescript
const isLockHolder = lockStatus === 'locked_self'
```

Add `releaseLock` from useWebSocket — but ChatComposer doesn't currently use useWebSocket. We need to add it or pass the handler from ChatInterface.

Simpler approach: import useWebSocket in ChatComposer:
```typescript
import { useWebSocket } from '../../hooks/useWebSocket'
```

Then inside the component:
```typescript
const { releaseLock } = useWebSocket()
const { currentSessionId } = useSessionStore()

const handleReleaseLock = useCallback(() => {
  if (currentSessionId && currentSessionId !== '__new__' && isLockHolder) {
    releaseLock(currentSessionId)
  }
}, [currentSessionId, isLockHolder, releaseLock])
```

Note: `useSessionStore` is already imported. `useWebSocket` needs to be added to imports.

Update the `ComposerToolbar` JSX:
```typescript
<ComposerToolbar
  onUpload={handleUpload}
  onSlashClick={handleSlashClick}
  onAtClick={handleAtClick}
  onSend={handleSubmit}
  onAbort={onAbort}
  canSend={canSend}
  fileRefs={fileRefs}
  isLocked={isLocked}
  isRunning={isRunning}
  isLockHolder={isLockHolder}
  onReleaseLock={handleReleaseLock}
/>
```

- [ ] **Step 4: Build and verify**

```bash
pnpm --filter @claude-agent-ui/web build
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/chat/ComposerToolbar.tsx packages/web/src/components/chat/ChatComposer.tsx packages/web/src/hooks/useWebSocket.ts
git commit -m "feat(web): lock indicator in toolbar with manual release button"
```

---

### Task 5: Handle lock-status on session-complete in client

**Files:**
- Modify: `packages/web/src/hooks/useWebSocket.ts`

- [ ] **Step 1: Don't reset lock on session-complete/aborted**

In `handleServerMessage`, the `session-complete` and `session-aborted` cases currently call `conn.reset()` which clears `pendingAskUser`, `pendingApproval`, AND lock status. We need to keep the lock status intact.

Change:
```typescript
case 'session-complete':
case 'session-aborted':
  conn.reset()
  break
```

To:
```typescript
case 'session-complete':
case 'session-aborted':
  // Clear pending requests but preserve lock status — lock persists across queries
  conn.setPendingApproval(null)
  conn.setPendingAskUser(null)
  conn.setPendingPlanApproval(null)
  conn.setPlanModalOpen(false)
  break
```

The lock-status will be updated separately when the server sends a `lock-status` message (on manual release, idle timeout, etc.).

- [ ] **Step 2: Build and verify**

```bash
pnpm --filter @claude-agent-ui/web build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/hooks/useWebSocket.ts
git commit -m "feat(web): preserve lock status on session-complete — lock persists across queries"
```

---

### Task 6: Full build + manual test

- [ ] **Step 1: Full build**

```bash
pnpm build
```

Expected: all 3 packages build successfully.

- [ ] **Step 2: Type check**

```bash
cd packages/server && npx tsc --noEmit && cd ../web && npx tsc --noEmit && cd ../..
```

Expected: no errors.

- [ ] **Step 3: Manual test plan**

1. Open two browser tabs to the same session
2. Tab A: send a message → verify Tab A gets lock (lock icon appears in toolbar)
3. Tab B: verify input is disabled + "Session locked by another client"
4. Tab A: wait for response → verify lock persists after session completes
5. Tab A: click lock icon → verify lock released → both tabs can input
6. Tab B: send a message → verify Tab B now holds lock, Tab A is locked out
7. Tab A: wait 1 minute → verify lock auto-releases → both can input
8. Test AskUserQuestion: send message that triggers ask-user → verify panel shows for lock holder only
9. Test reconnect: lock holder refreshes page → verify lock transfers to new connection

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: persistent lock model — manual release, 1-min idle timeout, auto-claim on pending tasks"
```
