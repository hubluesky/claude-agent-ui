// Placeholder — full implementation in Task 4
export class LockManager {
  constructor(private onRelease: (sessionId: string) => void) {}
  acquire(sessionId: string, connectionId: string): { success: boolean; holder?: string } { return { success: true } }
  release(sessionId: string): void { this.onRelease(sessionId) }
  onDisconnect(connectionId: string): void {}
  onReconnect(previousConnectionId: string, newConnectionId: string): void {}
  getHolder(sessionId: string): string | null { return null }
  isHolder(sessionId: string, connectionId: string): boolean { return false }
  getStatus(sessionId: string): 'idle' | 'locked' { return 'idle' }
  getLockedSessions(connectionId: string): string[] { return [] }
}
