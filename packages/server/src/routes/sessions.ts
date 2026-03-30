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
