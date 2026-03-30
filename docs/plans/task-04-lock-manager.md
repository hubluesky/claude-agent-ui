# Task 4: LockManager

**Files:**
- Create: `packages/server/src/ws/lock.ts`

---

- [ ] **Step 1: Create lock.ts**

```typescript
// packages/server/src/ws/lock.ts

export interface SessionLock {
  holderId: string
  sessionId: string
  acquiredAt: number
  gracePeriodTimer: ReturnType<typeof setTimeout> | null
}

export class LockManager {
  private locks = new Map<string, SessionLock>()
  private readonly GRACE_PERIOD_MS = 10_000

  constructor(private onRelease: (sessionId: string) => void) {}

  acquire(sessionId: string, connectionId: string): { success: boolean; holder?: string } {
    const existing = this.locks.get(sessionId)
    if (existing && existing.holderId !== connectionId) {
      return { success: false, holder: existing.holderId }
    }
    this.locks.set(sessionId, {
      holderId: connectionId,
      sessionId,
      acquiredAt: Date.now(),
      gracePeriodTimer: null,
    })
    return { success: true }
  }

  release(sessionId: string): void {
    const lock = this.locks.get(sessionId)
    if (lock?.gracePeriodTimer) {
      clearTimeout(lock.gracePeriodTimer)
    }
    this.locks.delete(sessionId)
    this.onRelease(sessionId)
  }

  onDisconnect(connectionId: string): void {
    for (const [sessionId, lock] of this.locks) {
      if (lock.holderId === connectionId) {
        lock.gracePeriodTimer = setTimeout(() => {
          this.release(sessionId)
        }, this.GRACE_PERIOD_MS)
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

  /** Get all sessions locked by a specific connection */
  getLockedSessions(connectionId: string): string[] {
    const sessions: string[] = []
    for (const [sessionId, lock] of this.locks) {
      if (lock.holderId === connectionId) {
        sessions.push(sessionId)
      }
    }
    return sessions
  }
}
```

- [ ] **Step 2: Verify lock.ts is imported in handler.ts**

The import already exists from Task 3 Step 5: `import type { LockManager } from './lock.js'`

The actual lock.ts file wasn't created then (only the type was referenced). Now it exists.

- [ ] **Step 3: Verify server starts**

Run:
```bash
cd E:/projects/claude-agent-ui
pnpm --filter @claude-agent-ui/server run dev
```

Expected: Server starts without import errors.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/ws/lock.ts
git commit -m "feat(server): LockManager with acquire/release/grace-period/reconnect"
```
