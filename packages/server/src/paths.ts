import { homedir } from 'os'
import { join } from 'path'
import { existsSync, renameSync } from 'fs'

export const CONFIG_DIR_NAME = '.claude-cockpit'
const LEGACY_DIR_NAME = '.claude-agent-ui'

let migrated = false

/**
 * One-shot migration: if legacy ~/.claude-agent-ui/ exists and new ~/.claude-cockpit/ does not,
 * rename the directory. Idempotent across the process lifetime.
 */
export function ensureConfigDir(): string {
  const home = homedir()
  const target = join(home, CONFIG_DIR_NAME)
  if (!migrated) {
    migrated = true
    const legacy = join(home, LEGACY_DIR_NAME)
    if (existsSync(legacy) && !existsSync(target)) {
      try {
        renameSync(legacy, target)
        console.log(`[paths] Migrated ${legacy} → ${target}`)
      } catch (err) {
        console.warn(`[paths] Failed to migrate ${legacy} → ${target}:`, err)
      }
    }
  }
  return target
}

export function configDir(): string {
  return ensureConfigDir()
}

export function configPath(...segments: string[]): string {
  return join(ensureConfigDir(), ...segments)
}
