import { readdir, stat, open, appendFile, readFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

export interface SessionInfo {
  sessionId: string
  summary: string
  lastModified: number
  fileSize?: number
  customTitle?: string
  firstPrompt?: string
  cwd?: string
  tag?: string
  createdAt?: number
}

/**
 * Direct filesystem access to Claude session JSONL files.
 * Replaces SDK's listSessions / getSessionInfo / renameSession / getSessionMessages.
 */
export class SessionStorage {
  private claudeDir: string

  constructor() {
    this.claudeDir = join(homedir(), '.claude')
  }

  /** Convert a project path to its sanitized directory name */
  sanitizePath(name: string): string {
    const sanitized = name.replace(/[^a-zA-Z0-9]/g, '-')
    if (sanitized.length <= 200) return sanitized
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
    }
    return `${sanitized.slice(0, 200)}-${Math.abs(hash).toString(36)}`
  }

  getProjectDir(cwd: string): string {
    return join(this.claudeDir, 'projects', this.sanitizePath(cwd))
  }

  getSessionFilePath(sessionId: string, cwd: string): string {
    return join(this.getProjectDir(cwd), `${sessionId}.jsonl`)
  }

  private async readHeadTail(filePath: string): Promise<{ head: string; tail: string }> {
    const CHUNK = 65536
    const fh = await open(filePath, 'r')
    try {
      const fileStat = await fh.stat()
      const size = fileStat.size

      const headBuf = Buffer.alloc(Math.min(CHUNK, size))
      await fh.read(headBuf, 0, headBuf.length, 0)
      const head = headBuf.toString('utf-8')

      let tail = head
      if (size > CHUNK) {
        const tailBuf = Buffer.alloc(Math.min(CHUNK, size))
        await fh.read(tailBuf, 0, tailBuf.length, Math.max(0, size - CHUNK))
        tail = tailBuf.toString('utf-8')
      }

      return { head, tail }
    } finally {
      await fh.close()
    }
  }

  private extractLastField(text: string, key: string): string | undefined {
    const pattern = `"${key}":"`
    let lastIdx = -1
    let searchFrom = 0
    while (true) {
      const idx = text.indexOf(pattern, searchFrom)
      if (idx === -1) break
      lastIdx = idx
      searchFrom = idx + 1
    }
    if (lastIdx === -1) return undefined

    const valueStart = lastIdx + pattern.length
    let i = valueStart
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue }
      if (text[i] === '"') {
        return text.slice(valueStart, i).replace(/\\\\/g, '\\').replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
      }
      i++
    }
    return undefined
  }

  private extractFirstField(text: string, key: string): string | undefined {
    const pattern = `"${key}":"`
    const idx = text.indexOf(pattern)
    if (idx === -1) return undefined

    const valueStart = idx + pattern.length
    let i = valueStart
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue }
      if (text[i] === '"') {
        return text.slice(valueStart, i).replace(/\\\\/g, '\\').replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
      }
      i++
    }
    return undefined
  }

  private parseSessionInfo(sessionId: string, head: string, tail: string, fileStat: { size: number; mtimeMs: number }, cwd?: string): SessionInfo | null {
    if (head.includes('"isSidechain":true')) return null

    const customTitle = this.extractLastField(tail, 'customTitle') ?? this.extractLastField(head, 'customTitle')
    const aiTitle = this.extractLastField(tail, 'aiTitle') ?? this.extractLastField(head, 'aiTitle')
    const firstPrompt = this.extractFirstField(head, 'content')
    const tag = this.extractLastField(tail, 'tag')
    const sessionCwd = this.extractFirstField(head, 'cwd') ?? cwd
    const timestamp = this.extractFirstField(head, 'timestamp')

    const summary = customTitle ?? aiTitle ?? firstPrompt ?? ''
    if (!summary) return null

    return {
      sessionId,
      summary,
      lastModified: fileStat.mtimeMs,
      fileSize: fileStat.size,
      customTitle,
      firstPrompt,
      cwd: sessionCwd,
      tag,
      createdAt: timestamp ? new Date(timestamp).getTime() : undefined,
    }
  }

  async listSessions(dir?: string): Promise<SessionInfo[]> {
    const projectsDir = join(this.claudeDir, 'projects')

    let projectDirs: string[]
    if (dir) {
      const sanitized = this.sanitizePath(dir)
      const fullDir = join(projectsDir, sanitized)
      try {
        await stat(fullDir)
        projectDirs = [fullDir]
      } catch {
        try {
          const entries = await readdir(projectsDir)
          const matches = entries.filter(e => e.startsWith(sanitized.slice(0, 20)))
          projectDirs = matches.map(e => join(projectsDir, e))
        } catch {
          return []
        }
      }
    } else {
      try {
        const entries = await readdir(projectsDir)
        projectDirs = entries.map(e => join(projectsDir, e))
      } catch {
        return []
      }
    }

    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i
    const sessions: SessionInfo[] = []

    for (const projDir of projectDirs) {
      let files: string[]
      try {
        files = await readdir(projDir)
      } catch {
        continue
      }

      const candidates: { sessionId: string; path: string; stat: { size: number; mtimeMs: number } }[] = []
      for (const file of files) {
        if (!uuidPattern.test(file)) continue
        const filePath = join(projDir, file)
        try {
          const s = await stat(filePath)
          candidates.push({
            sessionId: file.replace('.jsonl', ''),
            path: filePath,
            stat: { size: s.size, mtimeMs: s.mtimeMs },
          })
        } catch { continue }
      }

      candidates.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)

      const batch = candidates.slice(0, 64)
      const results = await Promise.all(batch.map(async (c) => {
        try {
          const { head, tail } = await this.readHeadTail(c.path)
          return this.parseSessionInfo(c.sessionId, head, tail, c.stat, dir)
        } catch {
          return null
        }
      }))

      for (const info of results) {
        if (info) sessions.push(info)
      }
    }

    return sessions.sort((a, b) => b.lastModified - a.lastModified)
  }

  async getSessionInfo(sessionId: string, dir?: string): Promise<SessionInfo | undefined> {
    if (dir) {
      const filePath = this.getSessionFilePath(sessionId, dir)
      try {
        const s = await stat(filePath)
        const { head, tail } = await this.readHeadTail(filePath)
        return this.parseSessionInfo(sessionId, head, tail, { size: s.size, mtimeMs: s.mtimeMs }, dir) ?? undefined
      } catch {
        return undefined
      }
    }

    const sessions = await this.listSessions()
    return sessions.find(s => s.sessionId === sessionId)
  }

  async getSessionMessages(sessionId: string, dir?: string): Promise<unknown[]> {
    let filePath: string | undefined
    if (dir) {
      filePath = this.getSessionFilePath(sessionId, dir)
    } else {
      const info = await this.getSessionInfo(sessionId)
      if (info?.cwd) {
        filePath = this.getSessionFilePath(sessionId, info.cwd)
      }
    }
    if (!filePath) return []

    try {
      const content = await readFile(filePath, 'utf-8')
      const messages: unknown[] = []
      for (const line of content.split('\n')) {
        if (!line.trim()) continue
        try {
          const obj = JSON.parse(line) as Record<string, unknown>
          if (['custom-title', 'ai-title', 'tag', 'task-summary', 'pr-link', 'agent-name'].includes(obj.type as string)) continue
          messages.push(obj)
        } catch { continue }
      }
      return messages
    } catch {
      return []
    }
  }

  async renameSession(sessionId: string, title: string, dir?: string): Promise<void> {
    let filePath: string | undefined
    if (dir) {
      filePath = this.getSessionFilePath(sessionId, dir)
    } else {
      const info = await this.getSessionInfo(sessionId)
      if (info?.cwd) filePath = this.getSessionFilePath(sessionId, info.cwd)
    }
    if (!filePath) throw new Error(`Session ${sessionId} not found`)

    const entry = JSON.stringify({ type: 'custom-title', customTitle: title, sessionId }) + '\n'
    await appendFile(filePath, entry, { mode: 0o600 })
  }

  async tagSession(sessionId: string, tag: string | null, dir?: string): Promise<void> {
    let filePath: string | undefined
    if (dir) {
      filePath = this.getSessionFilePath(sessionId, dir)
    } else {
      const info = await this.getSessionInfo(sessionId)
      if (info?.cwd) filePath = this.getSessionFilePath(sessionId, info.cwd)
    }
    if (!filePath) throw new Error(`Session ${sessionId} not found`)

    const entry = JSON.stringify({ type: 'tag', tag, sessionId }) + '\n'
    await appendFile(filePath, entry, { mode: 0o600 })
  }
}
