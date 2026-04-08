import type { FastifyInstance } from 'fastify'
import type { ServerManager } from '../server-manager.js'
import type { LogCollector } from '../log-collector.js'
import type { ServerConfigUpdate } from '@claude-agent-ui/shared'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

export function managementRoutes(
  serverManager: ServerManager,
  logCollector: LogCollector,
) {
  return async function (app: FastifyInstance) {
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
  }
}
