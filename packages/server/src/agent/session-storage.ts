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

/** Known SDK resume artifact patterns. These appear when sessions are resumed and should not be shown to users. */
const SDK_RESUME_PATTERNS = [
  /^Continue from where you left off\.?$/,
  /^No response requested\.?$/,
]

/** Patterns that should be skipped as first prompt (system tags, interrupt markers). Aligned with CLI's SKIP_FIRST_PROMPT_PATTERN. */
const SKIP_FIRST_PROMPT_PATTERN = /^<[a-z][\w-]*[\s>]|\[Request interrupted by user/

/** Strip display-unfriendly tags from prompt text. */
function stripDisplayTags(text: string): string {
  return text
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, '')
    .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, '')
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
    .replace(/<bash-input>([\s\S]*?)<\/bash-input>/g, '! $1')
    .replace(/\n+/g, ' ')
    .trim()
}

/**
 * Extract the first meaningful user prompt from JSONL head text.
 * Aligned with CLI's extractFirstPromptFromHead():
 * - Parses lines as JSON, finds first type:"user" message
 * - Skips tool_result, isMeta, isCompactSummary messages
 * - Handles both string and array content
 * - Truncates to 200 chars
 */
function extractFirstPromptFromHead(head: string): string {
  const MAX_PROMPT_LEN = 200
  let commandFallback = ''

  for (const line of head.split('\n')) {
    if (!line.trim()) continue
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }

    if (obj.type !== 'user') continue
    if ((obj.message as Record<string, unknown> | undefined)?.role === 'tool_result') continue
    if (obj.isMeta === true) continue
    if (obj.isCompactSummary === true) continue

    const text = extractMsgText(obj)
    if (!text) continue

    // Check for command-name tag → use as fallback
    const cmdMatch = text.match(/<command-name>([\s\S]*?)<\/command-name>/)
    if (cmdMatch && !commandFallback) {
      commandFallback = cmdMatch[1].trim()
    }

    const stripped = stripDisplayTags(text)
    if (!stripped) continue
    if (SKIP_FIRST_PROMPT_PATTERN.test(stripped)) continue

    return stripped.length > MAX_PROMPT_LEN
      ? stripped.slice(0, MAX_PROMPT_LEN) + '\u2026'
      : stripped
  }

  return commandFallback || ''
}

/** Extract plain text from a JSONL message object. */
function extractMsgText(obj: Record<string, unknown>): string {
  const msg = obj.message as Record<string, unknown> | undefined
  if (!msg) return ''
  const content = msg.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as { type?: string; text?: string }[])
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('')
  }
  return ''
}

/** Check if a JSONL message is an SDK resume artifact that should be filtered out. */
function isSDKResumeArtifact(obj: Record<string, unknown>): boolean {
  const type = obj.type as string
  if (type !== 'user' && type !== 'assistant') return false
  const text = extractMsgText(obj).trim()
  if (!text) return false
  return SDK_RESUME_PATTERNS.some(p => p.test(text))
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
    if (head.includes('"isSidechain":true') || head.includes('"isSidechain": true')) return null

    // Title priority aligned with CLI: customTitle > aiTitle > summary > firstPrompt > sessionId
    const customTitle = this.extractLastField(tail, 'customTitle') ?? this.extractLastField(head, 'customTitle')
    const aiTitle = this.extractLastField(tail, 'aiTitle') ?? this.extractLastField(head, 'aiTitle')
    const sdkSummary = this.extractLastField(tail, 'summary')
    // firstPrompt: try lastPrompt from tail first (CLI does this), then parse head line-by-line
    const lastPrompt = this.extractLastField(tail, 'lastPrompt')
    const firstPrompt = lastPrompt || extractFirstPromptFromHead(head) || this.extractFirstField(head, 'content') || ''
    const tag = this.extractLastField(tail, 'tag')
    const sessionCwd = this.extractFirstField(head, 'cwd') ?? cwd
    const timestamp = this.extractFirstField(head, 'timestamp')

    const summary = customTitle ?? aiTitle ?? sdkSummary ?? firstPrompt ?? ''
    if (!summary) return null

    return {
      sessionId,
      summary,
      lastModified: fileStat.mtimeMs,
      fileSize: fileStat.size,
      customTitle,
      firstPrompt: firstPrompt || undefined,
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
          // Filter SDK resume artifacts (e.g. "Continue from where you left off." / "No response requested.")
          if (isSDKResumeArtifact(obj)) continue
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

  /** Set AI-generated title (does not override user's custom title). */
  async setAiTitle(sessionId: string, title: string, dir?: string): Promise<void> {
    let filePath: string | undefined
    if (dir) {
      filePath = this.getSessionFilePath(sessionId, dir)
    } else {
      const info = await this.getSessionInfo(sessionId)
      if (info?.cwd) filePath = this.getSessionFilePath(sessionId, info.cwd)
    }
    if (!filePath) throw new Error(`Session ${sessionId} not found`)

    const entry = JSON.stringify({ type: 'ai-title', aiTitle: title, sessionId }) + '\n'
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

  /**
   * Read subagent messages from the sidechain JSONL file.
   * CLI stores subagent transcripts at:
   *   ~/.claude/projects/{project-hash}/{sessionId}/subagents/agent-{agentId}.jsonl
   */
  async getSubagentMessages(sessionId: string, agentId: string, dir?: string): Promise<unknown[]> {
    // Find the project directory for this session
    let projectDir: string | undefined
    if (dir) {
      projectDir = this.getProjectDir(dir)
    } else {
      const info = await this.getSessionInfo(sessionId)
      if (info?.cwd) {
        projectDir = this.getProjectDir(info.cwd)
      }
    }
    if (!projectDir) return []

    // Try multiple possible paths for the subagent JSONL
    const candidates = [
      join(projectDir, sessionId, 'subagents', `agent-${agentId}.jsonl`),
      join(projectDir, 'subagents', `agent-${agentId}.jsonl`),
    ]

    for (const filePath of candidates) {
      try {
        const content = await readFile(filePath, 'utf-8')
        const messages: unknown[] = []
        for (const line of content.split('\n')) {
          if (!line.trim()) continue
          try {
            const obj = JSON.parse(line) as Record<string, unknown>
            // Skip metadata entries
            if (['custom-title', 'ai-title', 'tag', 'task-summary'].includes(obj.type as string)) continue
            if (isSDKResumeArtifact(obj)) continue
            messages.push(obj)
          } catch { continue }
        }
        return messages
      } catch {
        continue // File doesn't exist at this path, try next
      }
    }

    return []
  }
}
