import Fastify from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import fastifyCors from '@fastify/cors'
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

const config = loadConfig()
const server = Fastify({ logger: true })

// Plugins
await server.register(fastifyCors, { origin: config.corsOrigin })
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

// Session manager
const sessionManager = new SessionManager()

// Routes
await server.register(healthRoutes)
await server.register(sessionRoutes(sessionManager))
await server.register(commandRoutes(sessionManager))
if (db) {
  await server.register(settingsRoutes(db))
}

// WebSocket
const handleWs = createWsHandler({ wsHub, lockManager, sessionManager })
server.register(async (app) => {
  app.get('/ws', { websocket: true }, (socket) => {
    handleWs(socket)
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
})
