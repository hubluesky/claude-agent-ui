import { listSessions, getSessionInfo, getSessionMessages } from '@anthropic-ai/claude-agent-sdk'
import type { ProjectInfo, SessionSummary } from '@claude-agent-ui/shared'
import { V1QuerySession } from './v1-session.js'
import { AgentSession } from './session.js'
import { basename } from 'path'

export class SessionManager {
  private activeSessions = new Map<string, AgentSession>()

  async listProjects(): Promise<ProjectInfo[]> {
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

    return projects.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
  }

  async listProjectSessions(
    cwd: string,
    options?: { limit?: number; offset?: number }
  ): Promise<{ sessions: SessionSummary[]; total: number; hasMore: boolean }> {
    const allSessions = await listSessions({ dir: cwd })
    const sorted = allSessions.sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0))

    const limit = options?.limit ?? 20
    const offset = options?.offset ?? 0
    const paged = sorted.slice(offset, offset + limit)

    return {
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
  }

  async getSessionInfo(sessionId: string) {
    return await getSessionInfo(sessionId)
  }

  async getSessionMessages(
    sessionId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<{ messages: unknown[]; total: number; hasMore: boolean }> {
    const messages = await getSessionMessages(sessionId, options)
    return {
      messages,
      total: messages.length,
      hasMore: messages.length === (options?.limit ?? 50),
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
}
