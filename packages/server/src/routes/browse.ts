import { readdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import type { FastifyInstance } from 'fastify'

export async function browseRoutes(app: FastifyInstance) {
  app.get('/api/browse-directory', async (request, reply) => {
    const query = request.query as Record<string, unknown>
    const rawPath = typeof query.path === 'string' ? query.path : undefined
    const targetPath = rawPath ? resolve(rawPath) : homedir()

    try {
      const entries = await readdir(targetPath, { withFileTypes: true })
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => ({
          name: e.name,
          path: resolve(targetPath, e.name),
        }))

      const parent = dirname(targetPath)
      return {
        currentPath: targetPath,
        parentPath: parent !== targetPath ? parent : null,
        dirs,
      }
    } catch (err: any) {
      return reply.status(400).send({
        error: `Cannot read directory: ${err.message}`,
      })
    }
  })
}
