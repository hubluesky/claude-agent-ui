# Task 6: SessionManager + REST API

**Files:**
- Create: `packages/server/src/agent/manager.ts`
- Create: `packages/server/src/routes/sessions.ts`
- Modify: `packages/server/src/index.ts` (register routes)

---

- [ ] **Step 1: Create agent/manager.ts**

```typescript
// packages/server/src/agent/manager.ts
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
      const existing = projectMap.get(s.cwd)
      const updatedAt = s.updatedAt ?? s.createdAt ?? ''
      if (!existing) {
        projectMap.set(s.cwd, { lastActiveAt: updatedAt, count: 1 })
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
    const allSessions = await listSessions()
    const filtered = allSessions
      .filter((s) => s.cwd === cwd)
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))

    const limit = options?.limit ?? 20
    const offset = options?.offset ?? 0
    const paged = filtered.slice(offset, offset + limit)

    return {
      sessions: paged.map((s) => ({
        sessionId: s.sessionId,
        cwd: s.cwd,
        tag: s.tag,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
      total: filtered.length,
      hasMore: offset + limit < filtered.length,
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
      total: messages.length, // SDK may not provide total — approximate
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

    const session = new V1QuerySession(info.cwd, { resumeSessionId: sessionId })
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
```

- [ ] **Step 2: Create routes/sessions.ts**

```typescript
// packages/server/src/routes/sessions.ts
import type { FastifyInstance } from 'fastify'
import { renameSession, tagSession } from '@anthropic-ai/claude-agent-sdk'
import type { SessionManager } from '../agent/manager.js'

export function sessionRoutes(sessionManager: SessionManager) {
  return async function (app: FastifyInstance) {
    // GET /api/projects
    app.get('/api/projects', async () => {
      const projects = await sessionManager.listProjects()
      return { projects }
    })

    // GET /api/sessions?project=<cwd>&limit=20&offset=0
    app.get<{
      Querystring: { project: string; limit?: string; offset?: string }
    }>('/api/sessions', async (request) => {
      const { project, limit, offset } = request.query
      if (!project) {
        return { sessions: [], total: 0, hasMore: false }
      }
      return await sessionManager.listProjectSessions(decodeURIComponent(project), {
        limit: limit ? parseInt(limit) : undefined,
        offset: offset ? parseInt(offset) : undefined,
      })
    })

    // GET /api/sessions/:id
    app.get<{ Params: { id: string } }>('/api/sessions/:id', async (request, reply) => {
      const info = await sessionManager.getSessionInfo(request.params.id)
      if (!info) {
        reply.status(404)
        return { error: 'Session not found' }
      }
      return info
    })

    // GET /api/sessions/:id/messages?limit=50&offset=0
    app.get<{
      Params: { id: string }
      Querystring: { limit?: string; offset?: string }
    }>('/api/sessions/:id/messages', async (request) => {
      const { limit, offset } = request.query
      return await sessionManager.getSessionMessages(request.params.id, {
        limit: limit ? parseInt(limit) : undefined,
        offset: offset ? parseInt(offset) : undefined,
      })
    })

    // POST /api/sessions
    app.post<{ Body: { cwd: string } }>('/api/sessions', async (request, reply) => {
      reply.status(201)
      return { status: 'created', cwd: request.body.cwd }
    })

    // POST /api/sessions/:id/rename
    app.post<{ Params: { id: string }; Body: { title: string } }>(
      '/api/sessions/:id/rename',
      async (request) => {
        await renameSession(request.params.id, request.body.title)
        return { status: 'ok' }
      }
    )

    // POST /api/sessions/:id/tag
    app.post<{ Params: { id: string }; Body: { tag: string | null } }>(
      '/api/sessions/:id/tag',
      async (request) => {
        await tagSession(request.params.id, request.body.tag)
        return { status: 'ok' }
      }
    )
  }
}
```

- [ ] **Step 3: Create routes/settings.ts**

```typescript
// packages/server/src/routes/settings.ts
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { userSettings } from '../db/schema.js'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type * as schema from '../db/schema.js'

export function settingsRoutes(db: BetterSQLite3Database<typeof schema>) {
  return async function (app: FastifyInstance) {
    // GET /api/settings
    app.get('/api/settings', async () => {
      const rows = db.select().from(userSettings).all()
      const settings: Record<string, string> = {}
      for (const row of rows) {
        settings[row.key] = row.value
      }
      return { settings }
    })

    // PUT /api/settings
    app.put<{ Body: { settings: Record<string, string> } }>('/api/settings', async (request) => {
      const entries = Object.entries(request.body.settings)
      for (const [key, value] of entries) {
        db.insert(userSettings)
          .values({ key, value, updatedAt: new Date() })
          .onConflictDoUpdate({ target: userSettings.key, set: { value, updatedAt: new Date() } })
          .run()
      }
      return { status: 'ok' }
    })
  }
}
```

- [ ] **Step 4: Register routes in index.ts**

Add to `packages/server/src/index.ts` after health routes:

```typescript
import { SessionManager } from './agent/manager.js'
import { sessionRoutes } from './routes/sessions.js'
import { settingsRoutes } from './routes/settings.js'

// ... after wsHub and lockManager creation:
const sessionManager = new SessionManager()

// ... after healthRoutes registration:
await server.register(sessionRoutes(sessionManager))
await server.register(settingsRoutes(db))
```

Also update the WS handler creation to pass sessionManager:

```typescript
const handleWs = createWsHandler({ wsHub, lockManager, sessionManager })
```

- [ ] **Step 5: Verify REST API**

Run server, then test:
```bash
curl http://localhost:3456/api/projects
curl "http://localhost:3456/api/sessions?project=%2Fpath%2Fto%2Fproject"
curl http://localhost:3456/api/health
```

Expected: `/api/projects` returns projects from `~/.claude/projects/`. May return empty array if no CLI sessions exist.

- [ ] **Step 6: Commit**

```bash
git add packages/server/
git commit -m "feat(server): SessionManager + REST API (projects, sessions, messages, rename, tag)"
```
