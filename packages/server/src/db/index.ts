import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import * as schema from './schema.js'

export function createDb(dbPath: string) {
  mkdirSync(dirname(dbPath), { recursive: true })
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  const db = drizzle(sqlite, { schema })

  // Auto-create tables
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS user_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ui_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)

  return db
}
