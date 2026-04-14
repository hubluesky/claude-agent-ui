import type { FastifyInstance } from 'fastify'
import type { SessionManager } from '../agent/manager.js'
import { computeEditDiffContext, computeWriteDiffContext, computeWriteOldContent } from '../agent/diff-context.js'

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
        await sessionManager.sessionStorage.renameSession(request.params.id, request.body.title)
        return { status: 'ok' }
      }
    )

    // GET /api/sessions/:id/export?format=md|json
    app.get<{
      Params: { id: string }
      Querystring: { format?: string }
    }>('/api/sessions/:id/export', async (request, reply) => {
      const format = request.query.format === 'json' ? 'json' : 'md'
      const info = await sessionManager.getSessionInfo(request.params.id)
      if (!info) {
        reply.status(404)
        return { error: 'Session not found' }
      }
      const messages = await sessionManager.getSessionMessages(request.params.id, { limit: 10000 })

      // Sanitize session ID for Content-Disposition filename
      const safeId = request.params.id.slice(0, 8).replace(/[^a-zA-Z0-9_-]/g, '')

      if (format === 'json') {
        reply.header('Content-Type', 'application/json')
        reply.header('Content-Disposition', `attachment; filename="session-${safeId}.json"`)
        return { session: info, messages: messages.messages }
      }

      // Markdown export
      const lines: string[] = []
      lines.push(`# ${(info as any)?.title ?? 'Session'}\n`)
      lines.push(`Session ID: ${request.params.id}`)
      lines.push(`Created: ${(info as any)?.createdAt ?? 'unknown'}\n`)
      lines.push('---\n')

      for (const msg of (messages.messages ?? [])) {
        const role = (msg as any).type ?? 'system'
        const content = (msg as any).message?.content
        let text = ''
        if (typeof content === 'string') {
          text = content
        } else if (Array.isArray(content)) {
          text = content
            .filter((b: any) => b.type === 'text' || b.type === 'thinking')
            .map((b: any) => b.text ?? b.thinking ?? '')
            .join('\n\n')
        }
        if (!text) continue

        if (role === 'user') {
          lines.push(`## User\n\n${text}\n`)
        } else if (role === 'assistant') {
          lines.push(`## Assistant\n\n${text}\n`)
        }
      }

      reply.header('Content-Type', 'text/markdown; charset=utf-8')
      reply.header('Content-Disposition', `attachment; filename="session-${safeId}.md"`)
      return lines.join('\n')
    })

    // POST /api/diff-context — compute diff with real line numbers for Edit tool
    // POST because old_string/new_string can be large (entire code blocks)
    // Optional sessionId + toolUseId to reconstruct file state from JSONL for historical sessions
    app.post<{
      Body: { file: string; old_string: string; new_string: string; sessionId?: string; toolUseId?: string }
    }>('/api/diff-context', async (request, reply) => {
      const { file, old_string, new_string, sessionId, toolUseId } = request.body ?? {}
      if (!file || old_string == null || new_string == null) {
        reply.status(400)
        return { error: 'file, old_string, and new_string are required' }
      }

      // If session context provided, reconstruct file state from JSONL history
      let fileContent: string | null | undefined = undefined
      if (sessionId && toolUseId) {
        fileContent = await computeWriteOldContent(
          sessionManager.sessionStorage,
          sessionId,
          file,
          toolUseId,
        )
      }

      const diff = await computeEditDiffContext(file, old_string, new_string, fileContent)
      if (!diff) {
        reply.status(404)
        return { error: 'Could not compute diff (string not found in file)' }
      }
      return diff
    })

    // POST /api/write-diff-context — compute diff for Write tool (full file content)
    // Optional sessionId + toolUseId to compute accurate baseline from JSONL history
    app.post<{
      Body: { file: string; content: string; sessionId?: string; toolUseId?: string }
    }>('/api/write-diff-context', async (request, reply) => {
      const { file, content, sessionId, toolUseId } = request.body ?? {}
      if (!file || content == null) {
        reply.status(400)
        return { error: 'file and content are required' }
      }

      // If session context provided, compute accurate baseline from JSONL
      let oldContent: string | null | undefined = undefined
      if (sessionId && toolUseId) {
        oldContent = await computeWriteOldContent(
          sessionManager.sessionStorage,
          sessionId,
          file,
          toolUseId,
        )
      }

      const diff = await computeWriteDiffContext(file, content, oldContent)
      if (!diff) {
        reply.status(404)
        return { type: 'create' }
      }
      return { type: 'update', ...diff }
    })

    // POST /api/sessions/:id/tag
    app.post<{ Params: { id: string }; Body: { tag: string | null } }>(
      '/api/sessions/:id/tag',
      async (request) => {
        await sessionManager.sessionStorage.tagSession(request.params.id, request.body.tag)
        return { status: 'ok' }
      }
    )

    // GET /api/sessions/by-name?cwd=<cwd>&name=<name>
    app.get<{
      Querystring: { cwd: string; name: string }
    }>('/api/sessions/by-name', async (request, reply) => {
      const { cwd, name } = request.query
      if (!cwd || !name) {
        reply.status(400)
        return { error: 'cwd and name are required' }
      }
      const session = await sessionManager.sessionStorage.findByCustomTitle(
        decodeURIComponent(cwd),
        decodeURIComponent(name),
      )
      if (!session) {
        reply.status(404)
        return { error: 'No session found with that name' }
      }
      return session
    })
  }
}
