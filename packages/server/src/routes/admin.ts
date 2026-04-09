import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { AuthManager } from '../auth.js'
import type { AdminSetupRequest, AdminLoginRequest, AdminChangePasswordRequest } from '@claude-agent-ui/shared'

const COOKIE_NAME = 'claude-admin-token'

function cookieOptions() {
  return { path: '/', httpOnly: true, sameSite: 'lax' as const }
}

function isLocalhost(request: FastifyRequest): boolean {
  const ip = request.ip
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}

export function adminRoutes(authManager: AuthManager) {
  return async function (app: FastifyInstance) {

    // GET /api/admin/status
    app.get('/api/admin/status', async (request) => {
      const token = authManager.getTokenFromRequest(request)
      return {
        hasPassword: authManager.hasPassword(),
        isLoggedIn: token ? authManager.verifyToken(token) : false,
        isLocalhost: isLocalhost(request),
      }
    })

    // POST /api/admin/setup — 首次设置密码（仅 localhost，仅无密码时）
    app.post<{ Body: AdminSetupRequest }>('/api/admin/setup', async (request, reply) => {
      if (!isLocalhost(request)) {
        return reply.status(403).send({ error: '只能从本机设置密码' })
      }
      if (authManager.hasPassword()) {
        return reply.status(400).send({ error: '密码已设置，请使用登录' })
      }
      if (!request.body.password || request.body.password.length < 4) {
        return reply.status(400).send({ error: '密码至少 4 个字符' })
      }
      await authManager.setPassword(request.body.password)
      const token = authManager.signToken()
      reply.setCookie(COOKIE_NAME, token, cookieOptions())
      return { ok: true }
    })

    // POST /api/admin/login
    app.post<{ Body: AdminLoginRequest }>('/api/admin/login', async (request, reply) => {
      if (!authManager.hasPassword()) {
        return reply.status(400).send({ error: '请先设置密码' })
      }
      const valid = await authManager.verifyPassword(request.body.password)
      if (!valid) {
        return reply.status(401).send({ error: '密码错误' })
      }
      const token = authManager.signToken()
      reply.setCookie(COOKIE_NAME, token, cookieOptions())
      return { ok: true }
    })

    // POST /api/admin/logout
    app.post('/api/admin/logout', async (_request, reply) => {
      reply.clearCookie(COOKIE_NAME, { path: '/' })
      return { ok: true }
    })

    // POST /api/admin/change-password — 需要 JWT
    app.post<{ Body: AdminChangePasswordRequest }>('/api/admin/change-password', async (request, reply) => {
      const token = authManager.getTokenFromRequest(request)
      if (!token || !authManager.verifyToken(token)) {
        return reply.status(401).send({ error: '未登录' })
      }
      if (!request.body.newPassword || request.body.newPassword.length < 4) {
        return reply.status(400).send({ error: '新密码至少 4 个字符' })
      }
      const ok = await authManager.changePassword(request.body.oldPassword, request.body.newPassword)
      if (!ok) {
        return reply.status(400).send({ error: '旧密码错误' })
      }
      return { ok: true }
    })

    // POST /api/admin/reset-password — 仅 localhost
    app.post('/api/admin/reset-password', async (request, reply) => {
      if (!isLocalhost(request)) {
        return reply.status(403).send({ error: '只能从本机重置密码' })
      }
      authManager.resetPassword()
      reply.clearCookie(COOKIE_NAME, { path: '/' })
      return { ok: true, message: '密码已重置，请重新设置' }
    })
  }
}
