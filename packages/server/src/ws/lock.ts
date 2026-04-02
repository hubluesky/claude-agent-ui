export interface SessionLock {
  holderId: string
  sessionId: string
  acquiredAt: number
  gracePeriodTimer: ReturnType<typeof setTimeout> | null
  idleTimer: ReturnType<typeof setTimeout> | null
}

const GRACE_PERIOD_MS = 60_000  // 1 min grace after disconnect
const IDLE_TIMEOUT_MS = 60_000  // 1 min no interaction → auto-release

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

  resetIdleTimer(sessionId: string): void {
    const lock = this.locks.get(sessionId)
    if (!lock) return
    if (lock.idleTimer) clearTimeout(lock.idleTimer)
    lock.idleTimer = this.startIdleTimer(sessionId)
  }

  onDisconnect(connectionId: string): void {
    for (const [sessionId, lock] of this.locks) {
      if (lock.holderId === connectionId) {
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
