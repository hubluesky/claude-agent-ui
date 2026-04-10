import type { ServerStatus, ConnectionInfo } from '@claude-agent-ui/shared'
import type { WSHub } from './ws/hub.js'
import type { LockManager } from './ws/lock.js'
import type { SessionManager } from './agent/manager.js'
import type { AppConfig } from './config.js'
import { basename } from 'path'

export class ServerManager {
  private startedAt = new Date()
  private sessionManager: SessionManager | null = null
  /** sessionId → projectName 缓存（避免重复读 JSONL） */
  private sessionProjectCache = new Map<string, string>()

  constructor(
    private config: AppConfig,
    private wsHub: WSHub,
    private lockManager: LockManager,
  ) {}

  setSessionManager(sm: SessionManager): void {
    this.sessionManager = sm
  }

  private async resolveProjectName(sessionId: string): Promise<string | null> {
    // 先查缓存
    const cached = this.sessionProjectCache.get(sessionId)
    if (cached) return cached
    // 再查活跃会话
    if (this.sessionManager) {
      const active = this.sessionManager.getActive(sessionId)
      if (active) {
        const name = basename(active.projectCwd)
        this.sessionProjectCache.set(sessionId, name)
        return name
      }
    }
    // 最后从 SessionStorage 读取会话信息
    if (this.sessionManager) {
      try {
        const info = await this.sessionManager.getSessionInfo(sessionId)
        const cwd = info?.cwd ?? ''
        if (cwd) {
          const name = basename(cwd)
          this.sessionProjectCache.set(sessionId, name)
          return name
        }
      } catch { /* session not found */ }
    }
    return null
  }

  async getStatus(): Promise<ServerStatus> {
    const now = Date.now()
    const rawConns = this.wsHub.getAllConnections()
    const connections: ConnectionInfo[] = await Promise.all(
      rawConns.map(async (c) => ({
        connectionId: c.connectionId,
        sessionId: c.sessionId,
        connectedAt: c.connectedAt.toISOString(),
        hasLock: c.sessionId ? this.lockManager.getHolder(c.sessionId) === c.connectionId : false,
        userAgent: c.userAgent,
        ip: c.ip,
        projectName: c.sessionId ? await this.resolveProjectName(c.sessionId) : null,
      }))
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
