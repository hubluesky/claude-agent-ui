import { readdir, stat } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { homedir, platform } from 'node:os'
import { execSync } from 'node:child_process'
import type { FastifyInstance } from 'fastify'

/** Get set of hidden directory names in a path (Windows only) */
function getWindowsHiddenDirs(dirPath: string): Set<string> {
  try {
    const escaped = dirPath.replace(/'/g, "''")
    const output = execSync(
      `powershell -NoProfile -Command "Get-ChildItem -Path '${escaped}' -Directory -Hidden -Force | Select-Object -ExpandProperty Name"`,
      { encoding: 'utf-8', windowsHide: true, timeout: 5000 },
    )
    return new Set(output.trim().split(/\r?\n/).filter(Boolean))
  } catch {
    return new Set()
  }
}

export async function browseRoutes(app: FastifyInstance) {
  app.get('/api/browse-directory', async (request, reply) => {
    const query = request.query as Record<string, unknown>
    const rawPath = typeof query.path === 'string' ? query.path : undefined
    const targetPath = rawPath ? resolve(rawPath) : homedir()

    try {
      const entries = await readdir(targetPath, { withFileTypes: true })

      // On Windows, get hidden dirs via attrib; on Unix, just check dot-prefix
      const isWin = platform() === 'win32'
      const hiddenDirs = isWin ? getWindowsHiddenDirs(targetPath) : new Set<string>()

      const dirs = entries
        .filter((e) => {
          if (!e.isDirectory()) return false
          if (e.name.startsWith('.') || e.name === 'node_modules') return false
          if (isWin && hiddenDirs.has(e.name)) return false
          return true
        })
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
