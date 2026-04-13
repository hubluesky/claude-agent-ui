export interface SessionLock {
  holderId: string
  sessionId: string
  acquiredAt: number
  timeoutTimer: ReturnType<typeof setTimeout> | null
}

const TIMEOUT_MS = 60_000

export class LockManager {
  private locks = new Map<string, SessionLock>()

  constructor(private onRelease: (sessionId: string) => void) {}

  setOnRelease(cb: (sessionId: string) => void): void {
    this.onRelease = cb
  }

  acquire(sessionId: string, connectionId: string): { success: boolean; holder?: string } {
    const existing = this.locks.get(sessionId)
    if (existing && existing.holderId !== connectionId) {
      return { success: false, holder: existing.holderId }
    }
    if (existing?.timeoutTimer) clearTimeout(existing.timeoutTimer)
    this.locks.set(sessionId, { holderId: connectionId, sessionId, acquiredAt: Date.now(), timeoutTimer: null })
    return { success: true }
  }

  release(sessionId: string): void {
    const lock = this.locks.get(sessionId)
    if (!lock) return
    if (lock.timeoutTimer) clearTimeout(lock.timeoutTimer)
    this.locks.delete(sessionId)
    this.onRelease(sessionId)
  }

  startTimeout(sessionId: string): void {
    const lock = this.locks.get(sessionId)
    if (!lock) return
    if (lock.timeoutTimer) clearTimeout(lock.timeoutTimer)
    lock.timeoutTimer = setTimeout(() => { this.release(sessionId) }, TIMEOUT_MS)
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

  /** Transfer lock to a new holder, preserving timeout state */
  transfer(sessionId: string, newHolderId: string): boolean {
    const lock = this.locks.get(sessionId)
    if (!lock) return false
    lock.holderId = newHolderId
    return true
  }

  /** Cancel timeout without releasing the lock (e.g. session started running) */
  cancelTimeout(sessionId: string): void {
    const lock = this.locks.get(sessionId)
    if (!lock) return
    if (lock.timeoutTimer) {
      clearTimeout(lock.timeoutTimer)
      lock.timeoutTimer = null
    }
  }

  getLockedSessions(connectionId: string): string[] {
    const sessions: string[] = []
    for (const [sessionId, lock] of this.locks) {
      if (lock.holderId === connectionId) sessions.push(sessionId)
    }
    return sessions
  }
}
