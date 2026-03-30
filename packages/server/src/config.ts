import { homedir } from 'os'
import { join } from 'path'

export interface AppConfig {
  port: number
  host: string
  dbPath: string
  staticDir: string | null
  corsOrigin: string | boolean
}

export function loadConfig(): AppConfig {
  return {
    port: parseInt(process.env.PORT ?? '3456'),
    host: process.env.HOST ?? '0.0.0.0',
    dbPath: process.env.DB_PATH ?? join(homedir(), '.claude-agent-ui', 'settings.db'),
    staticDir: process.env.STATIC_DIR ?? null,
    corsOrigin: process.env.NODE_ENV === 'production' ? false : true,
  }
}
