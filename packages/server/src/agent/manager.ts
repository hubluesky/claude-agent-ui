import type { ProjectInfo, SessionSummary, SlashCommandInfo } from '@claude-cockpit/shared'
import { CliSession } from './cli-session.js'
import type { AgentSession } from './session.js'
import { ProcessManager } from './process-manager.js'
import { SessionStorage } from './session-storage.js'
import { scanSkills } from './skills.js'
import { basename } from 'path'

interface CacheEntry<T> {
  data: T
  expiry: number
}

const CACHE_TTL_MS = 30_000

export class SessionManager {
  private activeSessions = new Map<string, AgentSession>()
  private _cachedCommands: SlashCommandInfo[] | null = null
  private _projectsCache: CacheEntry<ProjectInfo[]> | null = null
  private _sessionsCache = new Map<string, CacheEntry<{ sessions: SessionSummary[]; total: number; hasMore: boolean }>>()

  readonly processManager: ProcessManager
  readonly sessionStorage: SessionStorage

  constructor(cliBin?: string) {
    this.processManager = new ProcessManager(cliBin)
    this.sessionStorage = new SessionStorage()
  }

  async listProjects(): Promise<ProjectInfo[]> {
    if (this._projectsCache && Date.now() < this._projectsCache.expiry) {
      return this._projectsCache.data
    }
    const sessions = await this.sessionStorage.listSessions()
    const projectMap = new Map<string, { lastActiveAt: string; count: number }>()

    for (const s of sessions) {
      const cwd = s.cwd ?? ''
      if (!cwd) continue
      const existing = projectMap.get(cwd)
      const updatedAt = s.lastModified
        ? new Date(s.lastModified).toISOString()
        : s.createdAt
          ? new Date(s.createdAt).toISOString()
          : ''
      if (!existing) {
        projectMap.set(cwd, { lastActiveAt: updatedAt, count: 1 })
      } else {
        existing.count++
        if (updatedAt > existing.lastActiveAt) {
          existing.lastActiveAt = updatedAt
        }
      }
    }

    const projects: ProjectInfo[] = []
    for (const [cwd, info] of projectMap) {
      projects.push({
        cwd,
        name: basename(cwd),
        lastActiveAt: info.lastActiveAt,
        sessionCount: info.count,
      })
    }

    const result = projects.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
    this._projectsCache = { data: result, expiry: Date.now() + CACHE_TTL_MS }
    return result
  }

  async listProjectSessions(
    cwd: string,
    options?: { limit?: number; offset?: number }
  ): Promise<{ sessions: SessionSummary[]; total: number; hasMore: boolean }> {
    const cacheKey = `${cwd}:${options?.limit ?? 20}:${options?.offset ?? 0}`
    const cached = this._sessionsCache.get(cacheKey)
    if (cached && Date.now() < cached.expiry) {
      return cached.data
    }
    const allSessions = await this.sessionStorage.listSessions(cwd)
    const sorted = allSessions.sort((a, b) => b.lastModified - a.lastModified)

    const limit = options?.limit ?? 20
    const offset = options?.offset ?? 0
    const paged = sorted.slice(offset, offset + limit)

    const result = {
      sessions: paged.map((s) => ({
        sessionId: s.sessionId,
        cwd: s.cwd ?? cwd,
        tag: s.tag,
        title: s.customTitle ?? s.summary,
        createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : undefined,
        updatedAt: s.lastModified ? new Date(s.lastModified).toISOString() : undefined,
      })),
      total: sorted.length,
      hasMore: offset + limit < sorted.length,
    }
    this._sessionsCache.set(cacheKey, { data: result, expiry: Date.now() + CACHE_TTL_MS })
    return result
  }

  async getSessionInfo(sessionId: string) {
    return await this.sessionStorage.getSessionInfo(sessionId)
  }

  async getSessionMessages(
    sessionId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<{ messages: unknown[]; total: number; hasMore: boolean }> {
    const allMessages = await this.sessionStorage.getSessionMessages(sessionId)
    const total = allMessages.length
    const limit = options?.limit ?? 50
    const offset = options?.offset ?? 0

    const endIndex = total - offset
    const startIndex = Math.max(0, endIndex - limit)
    const sliced = endIndex > 0 ? allMessages.slice(startIndex, endIndex) : []

    return {
      messages: sliced,
      total,
      hasMore: startIndex > 0,
    }
  }

  createSession(cwd: string, options?: { model?: string; effort?: string; thinking?: string; permissionMode?: any }): CliSession {
    return new CliSession(this.processManager, cwd, options)
  }

  async resumeSession(sessionId: string, cwd?: string): Promise<CliSession> {
    const existing = this.activeSessions.get(sessionId)
    if (existing) return existing as CliSession

    const info = await this.sessionStorage.getSessionInfo(sessionId, cwd)
    if (!info) throw new Error(`Session ${sessionId} not found`)

    const session = new CliSession(this.processManager, info.cwd ?? cwd ?? '.', { resumeSessionId: sessionId })
    this.activeSessions.set(sessionId, session)
    return session
  }

  registerActive(sessionId: string, session: AgentSession): void {
    this.activeSessions.set(sessionId, session)
    this.invalidateSessionsCache(session.projectCwd)
  }

  invalidateSessionsCache(cwd?: string): void {
    this._projectsCache = null
    if (!cwd) {
      this._sessionsCache.clear()
    } else {
      for (const key of this._sessionsCache.keys()) {
        if (key.startsWith(cwd + ':')) {
          this._sessionsCache.delete(key)
        }
      }
    }
  }

  getActive(sessionId: string): AgentSession | undefined {
    return this.activeSessions.get(sessionId)
  }

  getAllActive(): ReadonlyMap<string, AgentSession> {
    return this.activeSessions
  }

  removeActive(sessionId: string): void {
    this.activeSessions.delete(sessionId)
  }

  cacheCommands(commands: SlashCommandInfo[]): void {
    this._cachedCommands = commands
  }

  async getSubagentMessages(
    sessionId: string,
    agentId: string,
  ): Promise<unknown[]> {
    return await this.sessionStorage.getSubagentMessages(sessionId, agentId)
  }

  async getCommands(cwd?: string): Promise<SlashCommandInfo[]> {
    if (this._cachedCommands) return this._cachedCommands

    try {
      const skills = scanSkills(cwd)
      this._cachedCommands = skills
      return skills
    } catch { /* ignore scan errors */ }
    return []
  }
}
