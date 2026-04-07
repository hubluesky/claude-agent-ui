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
