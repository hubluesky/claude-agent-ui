import { homedir } from 'os'
import { join, resolve, dirname } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'

export interface AppConfig {
  port: number
  host: string
  dbPath: string
  staticDir: string | null
  corsOrigin: string | boolean
  mode: 'dev' | 'prod'
}

/** 持久化用户配置到 ~/.claude-agent-ui/server-config.json */
const CONFIG_DIR = join(homedir(), '.claude-agent-ui')
const CONFIG_FILE = join(CONFIG_DIR, 'server-config.json')

interface PersistedConfig {
  mode?: 'dev' | 'prod'
  port?: number
}

function loadPersistedConfig(): PersistedConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
    }
  } catch { /* ignore */ }
  return {}
}

export function savePersistedConfig(update: Partial<PersistedConfig>): void {
  const current = loadPersistedConfig()
  const merged = { ...current, ...update }
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8')
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
  const persisted = loadPersistedConfig()
  const modeArg = process.argv.find(a => a.startsWith('--mode='))
  const modeValue = modeArg ? modeArg.split('=')[1] : null
  // --mode=auto 或无参数：从持久化配置读取，默认 prod
  // --mode=dev/prod：强制指定（CLI 覆盖）
  const mode = (modeValue && modeValue !== 'auto' ? modeValue : persisted.mode ?? 'prod') as 'dev' | 'prod'
  const port = parseInt(process.env.PORT ?? String(persisted.port ?? 4000))

  return {
    port,
    host: process.env.HOST ?? '0.0.0.0',
    dbPath: process.env.DB_PATH ?? join(homedir(), '.claude-agent-ui', 'settings.db'),
    staticDir: findStaticDir(),
    corsOrigin: process.env.NODE_ENV === 'production' ? false : true,
    mode,
  }
}
