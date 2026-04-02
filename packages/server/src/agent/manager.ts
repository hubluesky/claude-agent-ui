import { listSessions, getSessionInfo, getSessionMessages, query } from '@anthropic-ai/claude-agent-sdk'
import type { ProjectInfo, SessionSummary, SlashCommandInfo } from '@claude-agent-ui/shared'
import { V1QuerySession } from './v1-session.js'
import { AgentSession } from './session.js'
import { basename } from 'path'
import { scanSkills } from './skills.js'

interface CacheEntry<T> {
  data: T
  expiry: number
}

const CACHE_TTL_MS = 30_000 // 30 seconds

export class SessionManager {
  private activeSessions = new Map<string, AgentSession>()
  private _cachedCommands: SlashCommandInfo[] | null = null
  private _fetchingCommands = false
  private _projectsCache: CacheEntry<ProjectInfo[]> | null = null
  private _sessionsCache = new Map<string, CacheEntry<{ sessions: SessionSummary[]; total: number; hasMore: boolean }>>()

  async listProjects(): Promise<ProjectInfo[]> {
    if (this._projectsCache && Date.now() < this._projectsCache.expiry) {
      return this._projectsCache.data
    }
    const sessions = await listSessions()
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
    const allSessions = await listSessions({ dir: cwd })
    const sorted = allSessions.sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0))

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
    return await getSessionInfo(sessionId)
  }

  async getSessionMessages(
    sessionId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<{ messages: unknown[]; total: number; hasMore: boolean }> {
    // SDK offset counts "from the start", but the UI needs the LATEST messages.
    // Fetch all messages, then paginate from the end.
    const allMessages = await getSessionMessages(sessionId)
    const total = allMessages.length
    const limit = options?.limit ?? 50
    const offset = options?.offset ?? 0

    // offset=0 → last `limit` messages (newest)
    // offset=N → messages before the last N (older)
    const endIndex = total - offset
    const startIndex = Math.max(0, endIndex - limit)
    const sliced = endIndex > 0 ? allMessages.slice(startIndex, endIndex) : []

    return {
      messages: sliced,
      total,
      hasMore: startIndex > 0,
    }
  }

  createSession(cwd: string): AgentSession {
    const session = new V1QuerySession(cwd)
    return session
  }

  async resumeSession(sessionId: string): Promise<AgentSession> {
    const existing = this.activeSessions.get(sessionId)
    if (existing) return existing

    const info = await getSessionInfo(sessionId)
    if (!info) throw new Error(`Session ${sessionId} not found`)

    const session = new V1QuerySession(info.cwd ?? '.', { resumeSessionId: sessionId })
    this.activeSessions.set(sessionId, session)
    return session
  }

  registerActive(sessionId: string, session: AgentSession): void {
    this.activeSessions.set(sessionId, session)
  }

  getActive(sessionId: string): AgentSession | undefined {
    return this.activeSessions.get(sessionId)
  }

  removeActive(sessionId: string): void {
    this.activeSessions.delete(sessionId)
  }

  /** Cache commands pushed by an active session */
  cacheCommands(commands: SlashCommandInfo[]): void {
    this._cachedCommands = commands
  }

  /** Get cached commands, or fetch from a temporary query if not yet cached */
  async getCommands(cwd?: string): Promise<SlashCommandInfo[]> {
    if (this._cachedCommands) return this._cachedCommands
    if (this._fetchingCommands) return []

    this._fetchingCommands = true
    try {
      const effectiveCwd = cwd ?? process.cwd()
      const q = query({ prompt: '', options: { cwd: effectiveCwd } as any })
      // Wait for initialization to complete so plugins/skills are loaded
      const initResult = await q.initializationResult()
      const sdkCommands = (initResult.commands ?? await q.supportedCommands()).map((c: any) => ({
        name: c.name,
        description: c.description ?? '',
        argumentHint: c.argumentHint,
      }))
      q.close?.()

      // Scan filesystem for skills from enabled plugins
      const skills = scanSkills()

      // Merge: SDK commands first, then skills (deduplicate by name)
      const seen = new Set(sdkCommands.map((c: SlashCommandInfo) => c.name))
      const merged = [...sdkCommands, ...skills.filter((s) => !seen.has(s.name))]
      this._cachedCommands = merged
      return this._cachedCommands
    } catch {
      // If SDK fails, still try to return skills from filesystem
      try {
        const skills = scanSkills()
        if (skills.length) {
          this._cachedCommands = skills
          return skills
        }
      } catch { /* ignore */ }
      return []
    } finally {
      this._fetchingCommands = false
    }
  }
}
