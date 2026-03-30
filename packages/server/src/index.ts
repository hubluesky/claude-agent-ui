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

const config = loadConfig()
const server = Fastify({ logger: true })

// Plugins
await server.register(fastifyCors, { origin: config.corsOrigin })
await server.register(fastifyWebsocket)

if (config.staticDir) {
  await server.register(fastifyStatic, { root: config.staticDir })
}

// Database
const db = createDb(config.dbPath)

// Singletons
const wsHub = new WSHub()
const lockManager = new LockManager((sessionId) => {
  wsHub.broadcast(sessionId, { type: 'lock-status', sessionId, status: 'idle' })
})

// Routes
await server.register(healthRoutes)

// WebSocket
const handleWs = createWsHandler({ wsHub, lockManager })
server.register(async (app) => {
  app.get('/ws', { websocket: true }, (socket) => {
    handleWs(socket)
  })
})

// Start
server.listen({ port: config.port, host: config.host }, (err) => {
  if (err) { server.log.error(err); process.exit(1) }
  server.log.info(`Server running on ${config.host}:${config.port}`)
})
