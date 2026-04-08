import type { LogEntry } from '@claude-agent-ui/shared'

type LogListener = (entry: LogEntry) => void

const MAX_BUFFER_SIZE = 1000

export class LogCollector {
  private buffer: LogEntry[] = []
  private listeners = new Set<LogListener>()

  log(level: LogEntry['level'], category: LogEntry['category'], message: string): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
    }
    this.buffer.push(entry)
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.shift()
    }
    for (const listener of this.listeners) {
      listener(entry)
    }
  }

  info(category: LogEntry['category'], message: string): void {
    this.log('info', category, message)
  }

  warn(category: LogEntry['category'], message: string): void {
    this.log('warn', category, message)
  }

  error(category: LogEntry['category'], message: string): void {
    this.log('error', category, message)
  }

  getBuffer(): LogEntry[] {
    return [...this.buffer]
  }

  clear(): void {
    this.buffer = []
  }

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}
