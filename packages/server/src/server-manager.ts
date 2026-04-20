import type { ServerStatus, ConnectionInfo } from '@claude-cockpit/shared'
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
    // Only include connections that have joined a session
    const activeConns = rawConns.filter(c => c.sessionId)
    const resolved = await Promise.all(
      activeConns.map(async (c) => {
        const info = await this.resolveSessionInfo(c.sessionId!)
        return {
          connectionId: c.connectionId,
          sessionId: c.sessionId,
          connectedAt: c.connectedAt.toISOString(),
          hasLock: this.lockManager.getHolder(c.sessionId!) === c.connectionId,
          userAgent: c.userAgent,
          ip: c.ip,
          projectName: info.projectName,
          sessionTitle: info.sessionTitle,
        }
      })
    )
    // Only show connections with resolved project info
    const connections: ConnectionInfo[] = resolved.filter(c => c.projectName)

    return {
      status: 'running',
      port: this.config.port,
      pid: process.pid,
      uptime: Math.floor((now - this.startedAt.getTime()) / 1000),
      mode: this.config.mode,
      totalConnections: rawConns.length,
      connections,
      startedAt: this.startedAt.toISOString(),
    }
  }
}
