import type { FastifyInstance } from 'fastify'

const startTime = Date.now()

export async function healthRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    uptime: Math.floor((Date.now() - startTime) / 1000),
  }))
}
