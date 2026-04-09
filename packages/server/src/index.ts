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
import { spawn } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'

/** 全局 systray 引用，重启时需要 kill 掉旧进程 */
let _systrayInstance: any = null
export function setSystrayInstance(instance: any) { _systrayInstance = instance }

/** 重启服务器：spawn 新进程后退出当前进程 */
export function restartServer() {
  // 先 kill 旧的 systray Go 进程，避免重启后出现重复图标
  if (_systrayInstance) {
    try { _systrayInstance.kill(false) } catch {}
  }
  setTimeout(() => {
    const serverDir = dirname(fileURLToPath(import.meta.url))
    const projectRoot = join(serverDir, '..', '..', '..')
    // 找到 tsx 可执行文件
    const tsxPaths = [
      join(projectRoot, 'packages', 'server', 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.CMD' : 'tsx'),
      join(projectRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.CMD' : 'tsx'),
    ]
    const tsxBin = tsxPaths.find(p => existsSync(p))
    const scriptPath = join(projectRoot, 'packages', 'server', 'src', 'index.ts')

    if (tsxBin) {
      // 用 tsx 启动
      spawn(tsxBin, [scriptPath, '--mode=auto'], {
        detached: true,
        stdio: 'ignore',
        cwd: projectRoot,
        shell: process.platform === 'win32',
      }).unref()
    } else {
      // fallback: 用 node 启动编译后的代码
      const distPath = join(projectRoot, 'packages', 'server', 'dist', 'index.js')
      spawn(process.argv[0], [distPath, '--mode=auto'], {
        detached: true,
        stdio: 'ignore',
        cwd: projectRoot,
      }).unref()
    }
    process.exit(0)
  }, 300)
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

// Start
server.listen({ port: config.port, host: config.host }, (err) => {
  if (err) { server.log.error(err); process.exit(1) }
  server.log.info(`Server running on ${config.host}:${config.port}`)

  logCollector.info('server', `服务器已启动，端口 ${config.port}`)

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
      onQuit: async () => {
        logCollector.info('server', '用户通过托盘退出')
        try { trayInstance.kill(false) } catch {}
        await server.close()
        process.exit(0)
      },
    })
    setSystrayInstance(trayInstance)
    logCollector.info('server', '系统托盘已创建')
  } catch (err) {
    server.log.warn(`系统托盘创建失败（可能无桌面环境）: ${err}`)
  }
})
