import type { FastifyInstance } from 'fastify'
import type { ServerManager } from '../server-manager.js'
import type { LogCollector } from '../log-collector.js'
import type { SdkUpdater } from '../sdk-updater.js'
import type { AuthManager } from '../auth.js'
import type { ServerConfigUpdate } from '@claude-agent-ui/shared'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

export function managementRoutes(
  serverManager: ServerManager,
  logCollector: LogCollector,
  sdkUpdater: SdkUpdater,
  authManager: AuthManager,
) {
  return async function (app: FastifyInstance) {
    // 认证中间件：已设密码时需要 JWT
    app.addHook('preHandler', async (request, reply) => {
      if (!authManager.hasPassword()) return
      const token = authManager.getTokenFromRequest(request)
      if (!token || !authManager.verifyToken(token)) {
        reply.status(401).send({ error: '未登录' })
      }
    })
    // GET /api/server/status
    app.get('/api/server/status', async () => {
      return serverManager.getStatus()
    })

    // GET /api/server/logs — SSE stream
    app.get('/api/server/logs', async (request, reply) => {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })

      // 发送缓冲的历史日志
      for (const entry of logCollector.getBuffer()) {
        reply.raw.write(`data: ${JSON.stringify(entry)}\n\n`)
      }

      // 订阅新日志
      const unsubscribe = logCollector.subscribe((entry) => {
        reply.raw.write(`data: ${JSON.stringify(entry)}\n\n`)
      })

      request.raw.on('close', () => { unsubscribe() })
    })

    // POST /api/server/restart
    app.post('/api/server/restart', async () => {
      logCollector.info('server', '服务器正在重启...')
      return { ok: true, message: '正在重启' }
    })

    // DELETE /api/server/logs
    app.delete('/api/server/logs', async () => {
      logCollector.clear()
      return { ok: true }
    })

    // GET /api/server/config
    app.get('/api/server/config', async () => {
      const serverDir = dirname(fileURLToPath(import.meta.url))
      const hasSourceCode = existsSync(join(serverDir, '..', '..', 'src', 'index.ts'))

      const status = serverManager.getStatus()
      return {
        port: status.port,
        dbPath: '',
        autoLaunch: false,
        mode: status.mode,
        hasSourceCode,
      }
    })

    // PUT /api/server/config
    app.put<{ Body: ServerConfigUpdate }>('/api/server/config', async (_request) => {
      return { ok: true, message: '配置已更新' }
    })

    // GET /api/sdk/version
    app.get('/api/sdk/version', async () => {
      const current = sdkUpdater.getCurrentVersion()
      const latest = await sdkUpdater.getLatestVersion()
      return {
        current,
        latest,
        updateAvailable: latest !== null && latest !== current,
        lastChecked: new Date().toISOString(),
      }
    })

    // POST /api/sdk/update — SSE stream
    app.post('/api/sdk/update', async (_request, reply) => {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      // 发送初始注释防止代理缓冲
      reply.raw.write(': ok\n\n')

      const status = serverManager.getStatus()

      try {
        await sdkUpdater.update(status.mode, (progress) => {
          reply.raw.write(`data: ${JSON.stringify(progress)}\n\n`)
        })
      } catch {
        // 错误已在 progress callback 中发送
      }
      reply.raw.end()
    })

    // GET /api/sdk/features
    app.get('/api/sdk/features', async () => {
      return sdkUpdater.getFeatures()
    })
  }
}
