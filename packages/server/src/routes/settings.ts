import type { FastifyInstance } from 'fastify'
import { userSettings } from '../db/schema.js'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type * as schema from '../db/schema.js'

export function settingsRoutes(db: BetterSQLite3Database<typeof schema>) {
  return async function (app: FastifyInstance) {
    // GET /api/settings
    app.get('/api/settings', async () => {
      const rows = db.select().from(userSettings).all()
      const settings: Record<string, string> = {}
      for (const row of rows) {
        settings[row.key] = row.value
      }
      return { settings }
    })

    // PUT /api/settings
    app.put<{ Body: { settings: Record<string, string> } }>('/api/settings', async (request) => {
      const entries = Object.entries(request.body.settings)
      for (const [key, value] of entries) {
        db.insert(userSettings)
          .values({ key, value, updatedAt: new Date() })
          .onConflictDoUpdate({ target: userSettings.key, set: { value, updatedAt: new Date() } })
          .run()
      }
      return { status: 'ok' }
    })
  }
}
