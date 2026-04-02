import { homedir } from 'os'
import { join, resolve, dirname } from 'path'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'

export interface AppConfig {
  port: number
  host: string
  dbPath: string
  staticDir: string | null
  corsOrigin: string | boolean
}

function findStaticDir(): string | null {
  if (process.env.STATIC_DIR) return process.env.STATIC_DIR

  // Auto-detect: look for sibling web/dist relative to server package
  const serverDir = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(serverDir, '..', '..', 'web', 'dist'),       // from dist/
    resolve(serverDir, '..', '..', '..', 'web', 'dist'),  // from src/ in dev
  ]
  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.html'))) return dir
  }
  return null
}

export function loadConfig(): AppConfig {
  return {
    port: parseInt(process.env.PORT ?? '3665'),
    host: process.env.HOST ?? '0.0.0.0',
    dbPath: process.env.DB_PATH ?? join(homedir(), '.claude-agent-ui', 'settings.db'),
    staticDir: findStaticDir(),
    corsOrigin: process.env.NODE_ENV === 'production' ? false : true,
  }
}
