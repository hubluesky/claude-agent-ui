import type { ServerStatus, ConnectionInfo } from '@claude-agent-ui/shared'
import type { WSHub } from './ws/hub.js'
import type { LockManager } from './ws/lock.js'
import type { SessionManager } from './agent/manager.js'
import type { AppConfig } from './config.js'
import { basename } from 'path'

export class ServerManager {
  private startedAt = new Date()
  private sessionManager: SessionManager | null = null
  private sessionInfoCache = new Map<string, { projectName: string; sessionTitle: string | null }>()

  constructor(
    private config: AppConfig,
    private wsHub: WSHub,
    private lockManager: LockManager,
  ) {}

  setSessionManager(sm: SessionManager): void {
    this.sessionManager = sm
  }

  private async resolveSessionInfo(sessionId: string): Promise<{ projectName: string | null; sessionTitle: string | null }> {
    const cached = this.sessionInfoCache.get(sessionId)
    if (cached) return cached

    if (!this.sessionManager) return { projectName: null, sessionTitle: null }

    // Check active sessions first
    const active = this.sessionManager.getActive(sessionId)
    if (active) {
      const name = basename(active.projectCwd)
      const entry = { projectName: name, sessionTitle: null as string | null }
      this.sessionInfoCache.set(sessionId, entry)
      return entry
    }

    // Fall back to SessionStorage
    try {
      const info = await this.sessionManager.getSessionInfo(sessionId)
      if (info) {
        const name = info.cwd ? basename(info.cwd) : null
        const title = info.customTitle ?? info.summary ?? null
        const entry = { projectName: name ?? '', sessionTitle: title }
        if (name) this.sessionInfoCache.set(sessionId, entry)
        return entry
      }
    } catch { /* session not found */ }

    return { projectName: null, sessionTitle: null }
  }

  async getStatus(): Promise<ServerStatus> {
    const now = Date.now()
    const rawConns = this.wsHub.getAllConnections()
    const connections: ConnectionInfo[] = await Promise.all(
      rawConns.map(async (c) => {
        const info = c.sessionId ? await this.resolveSessionInfo(c.sessionId) : { projectName: null, sessionTitle: null }
        return {
          connectionId: c.connectionId,
          sessionId: c.sessionId,
          connectedAt: c.connectedAt.toISOString(),
          hasLock: c.sessionId ? this.lockManager.getHolder(c.sessionId) === c.connectionId : false,
          userAgent: c.userAgent,
          ip: c.ip,
          projectName: info.projectName,
          sessionTitle: info.sessionTitle,
        }
      })
    )

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
