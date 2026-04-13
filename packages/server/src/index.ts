import Fastify from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import fastifyCors from '@fastify/cors'
import fastifyCookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import { loadConfig } from './config.js'
import { createDb } from './db/index.js'
import { WSHub } from './ws/hub.js'
import { LockManager } from './ws/lock.js'
import { createWsHandler } from './ws/handler.js'
import { healthRoutes } from './routes/health.js'
import { SessionManager } from './agent/manager.js'
import { sessionRoutes } from './routes/sessions.js'
import { settingsRoutes } from './routes/settings.js'
import { commandRoutes } from './routes/commands.js'
import { fileRoutes } from './routes/files.js'
import { browseRoutes } from './routes/browse.js'
import open from 'open'
import { LogCollector } from './log-collector.js'
import { ServerManager } from './server-manager.js'
import { SdkUpdater } from './sdk-updater.js'
import { createTray } from './tray.js'
import { managementRoutes } from './routes/management.js'
import { AuthManager } from './auth.js'
import { adminRoutes } from './routes/admin.js'
import { ChildProcessManager } from './child-process-manager.js'

// 子进程生命周期管理（vite、systray、restart 统一收敛于此）
const pm = new ChildProcessManager()

export function restartServer() {
  pm.restart()
}

const config = loadConfig()
const server = Fastify({ logger: true })

// Plugins
await server.register(fastifyCors, { origin: config.corsOrigin })
await server.register(fastifyCookie)
await server.register(fastifyWebsocket)

if (config.staticDir) {
  await server.register(fastifyStatic, { root: config.staticDir, index: ['index.html'] })
}

// Database (optional — better-sqlite3 may not be compiled on all platforms)
let db: ReturnType<typeof createDb> | null = null
try {
  db = createDb(config.dbPath)
} catch (err) {
  server.log.warn('Database unavailable (better-sqlite3 not compiled), settings API disabled')
}

// Singletons
const wsHub = new WSHub()
const lockManager = new LockManager((sessionId) => {
  wsHub.broadcast(sessionId, { type: 'lock-status', sessionId, status: 'idle' })
})
const logCollector = new LogCollector()
pm.setLogCollector(logCollector)
const serverManager = new ServerManager(config, wsHub, lockManager)
const sdkUpdater = new SdkUpdater(logCollector)

// Auth（使用 JSON 文件存储，不依赖 SQLite）
const authManager = new AuthManager()

// Session manager
const sessionManager = new SessionManager()
serverManager.setSessionManager(sessionManager)

// Routes
await server.register(healthRoutes)
await server.register(sessionRoutes(sessionManager))
await server.register(commandRoutes(sessionManager))
await server.register(fileRoutes)
await server.register(browseRoutes)
if (db) {
  await server.register(settingsRoutes(db))
}
await server.register(managementRoutes(serverManager, logCollector, sdkUpdater, authManager))
await server.register(adminRoutes(authManager))

// WebSocket
const handleWs = createWsHandler({ wsHub, lockManager, sessionManager })
server.register(async (app) => {
  app.get('/ws', { websocket: true }, (socket, request) => {
    handleWs(socket, {
      userAgent: request.headers['user-agent'] ?? undefined,
      ip: request.ip,
    })
  })
})

// SPA fallback: serve index.html for non-API routes (client-side routing)
if (config.staticDir) {
  server.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/') || request.url.startsWith('/ws')) {
      reply.status(404).send({ error: 'Not Found' })
    } else {
      reply.sendFile('index.html')
    }
  })
}

// Graceful shutdown
let _shutdownCalled = false
async function gracefulShutdown(reason: string) {
  if (_shutdownCalled) return
  _shutdownCalled = true
  logCollector.info('server', `正在关闭：${reason}`)
  pm.cleanup()
  try { await server.close() } catch {}
  process.exit(0)
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))

// Start
server.listen({ port: config.port, host: config.host }, (err) => {
  if (err) { server.log.error(err); process.exit(1) }
  server.log.info(`Server running on ${config.host}:${config.port}`)

  logCollector.info('server', `服务器已启动，端口 ${config.port}`)

  // dev 模式下自动启动 vite dev server
  if (config.mode === 'dev') {
    pm.startVite()
  }

  // 创建系统托盘
  try {
    const trayInstance = createTray(config.port, {
      onOpenUI: () => {
        open(`http://localhost:${config.port}`)
      },
      onOpenAdmin: () => {
        open(`http://localhost:${config.port}/admin`)
      },
      onRestart: () => {
        logCollector.info('server', '服务器正在重启...')
        restartServer()
      },
      onResetPassword: () => {
        if (authManager) {
          authManager.resetPassword()
          logCollector.info('server', '管理密码已通过托盘重置')
        }
        open(`http://localhost:${config.port}/admin`)
      },
      onQuit: () => gracefulShutdown('用户通过托盘退出'),
    })
    pm.setSystray(trayInstance)
    logCollector.info('server', '系统托盘已创建')
  } catch (err) {
    server.log.warn(`系统托盘创建失败（可能无桌面环境）: ${err}`)
  }
})
