import type { ServerStatus, ConnectionInfo } from '@claude-agent-ui/shared'
import type { WSHub } from './ws/hub.js'
import type { LockManager } from './ws/lock.js'
import type { AppConfig } from './config.js'

export class ServerManager {
  private startedAt = new Date()

  constructor(
    private config: AppConfig,
    private wsHub: WSHub,
    private lockManager: LockManager,
  ) {}

  getStatus(): ServerStatus {
    const now = Date.now()
    const connections: ConnectionInfo[] = this.wsHub.getAllConnections().map((c) => ({
      connectionId: c.connectionId,
      sessionId: c.sessionId,
      connectedAt: c.connectedAt.toISOString(),
      hasLock: c.sessionId ? this.lockManager.getHolder(c.sessionId) === c.connectionId : false,
    }))

    return {
      status: 'running',
      port: this.config.port,
      pid: process.pid,
      uptime: Math.floor((now - this.startedAt.getTime()) / 1000),
      mode: this.config.mode,
      connections,
      startedAt: this.startedAt.toISOString(),
    }
  }
}
