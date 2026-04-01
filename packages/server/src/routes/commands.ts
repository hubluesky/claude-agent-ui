import type { FastifyInstance } from 'fastify'
import type { SessionManager } from '../agent/manager.js'

export function commandRoutes(sessionManager: SessionManager) {
  return async function (app: FastifyInstance) {
    app.get('/api/commands', async () => {
      const commands = await sessionManager.getCommands()
      return { commands }
    })
  }
}
