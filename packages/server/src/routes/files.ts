import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { FastifyInstance } from 'fastify'
import ignore from 'ignore'

const ALWAYS_IGNORE = ['.git', 'node_modules', 'dist', '.next', 'build', '.superpowers', '.claude']

interface FileItem {
  path: string
  type: 'file' | 'directory'
}

async function loadGitignore(cwd: string): Promise<ReturnType<typeof ignore> | null> {
  try {
    const content = await readFile(join(cwd, '.gitignore'), 'utf-8')
    return ignore().add(content)
  } catch {
    return null
  }
}

async function scanFiles(cwd: string, query: string, limit: number): Promise<FileItem[]> {
  const ig = await loadGitignore(cwd)
  const results: FileItem[] = []
  const lowerQuery = query.toLowerCase()

  async function walk(dir: string) {
    if (results.length >= limit) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    // Sort: directories first, then alphabetical
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of entries) {
      if (results.length >= limit) return

      if (ALWAYS_IGNORE.includes(entry.name)) continue

      const fullPath = join(dir, entry.name)
      const relPath = relative(cwd, fullPath).replace(/\\/g, '/')
      const isDir = entry.isDirectory()
      const displayPath = isDir ? relPath + '/' : relPath

      // Check .gitignore
      if (ig && ig.ignores(isDir ? relPath + '/' : relPath)) continue

      // Fuzzy match: path contains query (case-insensitive)
      const matches = !lowerQuery || displayPath.toLowerCase().includes(lowerQuery)

      if (matches) {
        results.push({ path: displayPath, type: isDir ? 'directory' : 'file' })
      }

      // Recurse into directories regardless of match (to find nested matches)
      if (isDir) {
        await walk(fullPath)
      }
    }
  }

  await walk(cwd)
  return results
}

export async function fileRoutes(app: FastifyInstance) {
  app.get('/api/files', async (request, reply) => {
    const { cwd, query = '', limit = '20' } = request.query as Record<string, string>
    if (!cwd) {
      return reply.status(400).send({ error: 'cwd parameter is required' })
    }

    // Verify cwd exists
    try {
      await stat(cwd)
    } catch {
      return reply.status(400).send({ error: 'cwd directory does not exist' })
    }

    const files = await scanFiles(cwd, query, Math.min(Number(limit) || 20, 100))
    return { files }
  })
}
