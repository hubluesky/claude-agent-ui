# SDK → CLI 子进程迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Agent SDK 直接调用替换为 Claude Code CLI 子进程（stream-json 模式），削减 ~1200 行自建 bug 密集代码。

**Architecture:** 服务器为每个 agent 会话 spawn 一个 CLI 子进程（`claude -p --input-format stream-json --output-format stream-json`），通过 stdin/stdout NDJSON 通信。服务器拦截 control_request 转发给前端，多终端同步层（WSHub、LockManager）不变。会话元数据改为直接读写 JSONL 文件。

**Tech Stack:** Node.js child_process, NDJSON readline, 现有 Fastify + WebSocket 不变

**Spec:** `docs/superpowers/specs/2026-04-10-sdk-to-cli-migration-design.md`

---

## File Structure

### 新建文件
- `packages/server/src/agent/cli-session.ts` — CliSession 类，封装 CLI 子进程通信（替代 v1-session.ts）
- `packages/server/src/agent/process-manager.ts` — ProcessManager 类，管理子进程生命周期
- `packages/server/src/agent/session-storage.ts` — SessionStorage 类，直接读写 JSONL 文件（替代 SDK listSessions 等）
- `packages/server/src/agent/ndjson.ts` — NDJSON stdin/stdout 解析/写入工具

### 修改文件
- `packages/server/src/agent/manager.ts` — 用 SessionStorage + CliSession 替代 SDK 调用
- `packages/server/src/agent/session.ts` — 添加新的抽象方法签名
- `packages/server/src/agent/title-generator.ts` — 用 SessionStorage 替代 SDK 调用
- `packages/server/src/ws/handler.ts` — 大幅简化，删除 SDK 调用和自建审批逻辑
- `packages/server/package.json` — 移除 `@anthropic-ai/claude-agent-sdk` 依赖
- `packages/shared/src/constants.ts` — 移除 PLAN_TOOL 和 safety-sensitive 逻辑（CLI 处理）

### 删除文件
- `packages/server/src/agent/v1-session.ts` — 整个文件
- `packages/shared/src/sdk-features.ts` — 整个文件

---

## Task 1: NDJSON 工具模块

**Files:**
- Create: `packages/server/src/agent/ndjson.ts`

- [ ] **Step 1: 创建 NDJSON 解析器和写入器**

```typescript
// packages/server/src/agent/ndjson.ts
import { createInterface } from 'readline'
import type { Readable, Writable } from 'stream'

/**
 * Parse NDJSON from a readable stream, yielding one parsed object per line.
 * Skips empty lines and logs parse errors without crashing.
 */
export async function* parseNdjson(stream: Readable): AsyncGenerator<unknown> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      yield JSON.parse(line)
    } catch {
      console.error('[NDJSON] Failed to parse line:', line.slice(0, 200))
    }
  }
}

/**
 * Write a JSON object as a single NDJSON line to a writable stream.
 * Returns false if the stream is not writable.
 */
export function writeNdjson(stream: Writable, obj: unknown): boolean {
  if (!stream.writable) return false
  stream.write(JSON.stringify(obj) + '\n')
  return true
}
```

- [ ] **Step 2: 验证构建通过**

Run: `pnpm --filter @claude-agent-ui/server build`
Expected: 成功编译，无错误

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/agent/ndjson.ts
git commit -m "feat: add NDJSON parser and writer utility for CLI subprocess communication"
```

---

## Task 2: SessionStorage — 直接读写 JSONL 文件

**Files:**
- Create: `packages/server/src/agent/session-storage.ts`

- [ ] **Step 1: 实现 SessionStorage 类**

```typescript
// packages/server/src/agent/session-storage.ts
import { readdir, stat, open, appendFile, mkdir } from 'fs/promises'
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
    // For long paths, append a simple hash for uniqueness
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
    }
    return `${sanitized.slice(0, 200)}-${Math.abs(hash).toString(36)}`
  }

  /** Get the project directory path for sessions */
  getProjectDir(cwd: string): string {
    return join(this.claudeDir, 'projects', this.sanitizePath(cwd))
  }

  /** Get the full path to a session's JSONL file */
  getSessionFilePath(sessionId: string, cwd: string): string {
    return join(this.getProjectDir(cwd), `${sessionId}.jsonl`)
  }

  /** Read head and tail of a file (64KB each) for fast metadata extraction */
  private async readHeadTail(filePath: string): Promise<{ head: string; tail: string }> {
    const CHUNK = 65536
    const fh = await open(filePath, 'r')
    try {
      const fileStat = await fh.stat()
      const size = fileStat.size

      // Read head
      const headBuf = Buffer.alloc(Math.min(CHUNK, size))
      await fh.read(headBuf, 0, headBuf.length, 0)
      const head = headBuf.toString('utf-8')

      // Read tail (may overlap with head for small files)
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

  /** Extract the last occurrence of a JSON string field from text */
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
        return text.slice(valueStart, i).replace(/\\"/g, '"').replace(/\\n/g, '\n')
      }
      i++
    }
    return undefined
  }

  /** Extract the first occurrence of a JSON string field from text */
  private extractFirstField(text: string, key: string): string | undefined {
    const pattern = `"${key}":"`
    const idx = text.indexOf(pattern)
    if (idx === -1) return undefined

    const valueStart = idx + pattern.length
    let i = valueStart
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue }
      if (text[i] === '"') {
        return text.slice(valueStart, i).replace(/\\"/g, '"').replace(/\\n/g, '\n')
      }
      i++
    }
    return undefined
  }

  /** Parse session metadata from head+tail without full JSON parsing */
  private parseSessionInfo(sessionId: string, head: string, tail: string, fileStat: { size: number; mtimeMs: number }, cwd?: string): SessionInfo | null {
    // Skip sidechain sessions
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

  /** List all sessions, optionally filtered by project directory */
  async listSessions(dir?: string): Promise<SessionInfo[]> {
    const projectsDir = join(this.claudeDir, 'projects')

    // Determine which project directories to scan
    let projectDirs: string[]
    if (dir) {
      // Find the matching project directory (prefix match for hash variants)
      const sanitized = this.sanitizePath(dir)
      const fullDir = join(projectsDir, sanitized)
      try {
        await stat(fullDir)
        projectDirs = [fullDir]
      } catch {
        // Try prefix match
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

    // UUID pattern for session files
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i

    const sessions: SessionInfo[] = []

    for (const projDir of projectDirs) {
      let files: string[]
      try {
        files = await readdir(projDir)
      } catch {
        continue
      }

      // Filter and stat candidates
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

      // Sort by mtime descending
      candidates.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)

      // Read metadata from top candidates (batch of 64)
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

  /** Get info for a single session */
  async getSessionInfo(sessionId: string, dir?: string): Promise<SessionInfo | undefined> {
    // If dir provided, look directly
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

    // Otherwise scan all project dirs
    const sessions = await this.listSessions()
    return sessions.find(s => s.sessionId === sessionId)
  }

  /** Get all messages from a session JSONL file */
  async getSessionMessages(sessionId: string, dir?: string): Promise<unknown[]> {
    // Find the file
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

    const { readFile } = await import('fs/promises')
    try {
      const content = await readFile(filePath, 'utf-8')
      const messages: unknown[] = []
      for (const line of content.split('\n')) {
        if (!line.trim()) continue
        try {
          const obj = JSON.parse(line) as Record<string, unknown>
          // Skip metadata-only entries
          if (['custom-title', 'ai-title', 'tag', 'task-summary', 'pr-link', 'agent-name'].includes(obj.type as string)) continue
          messages.push(obj)
        } catch { continue }
      }
      return messages
    } catch {
      return []
    }
  }

  /** Rename a session by appending a custom-title entry */
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

  /** Tag a session by appending a tag entry */
  async tagSession(sessionId: string, tag: string, dir?: string): Promise<void> {
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
```

- [ ] **Step 2: 验证构建通过**

Run: `pnpm --filter @claude-agent-ui/server build`
Expected: 成功编译

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/agent/session-storage.ts
git commit -m "feat: add SessionStorage for direct JSONL file access, replacing SDK session APIs"
```

---

## Task 3: ProcessManager — CLI 子进程生命周期管理

**Files:**
- Create: `packages/server/src/agent/process-manager.ts`

- [ ] **Step 1: 实现 ProcessManager 类**

```typescript
// packages/server/src/agent/process-manager.ts
import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import { parseNdjson, writeNdjson } from './ndjson.js'

export interface SpawnOptions {
  cwd: string
  resumeSessionId?: string
  forkSession?: boolean
  sessionId?: string
  model?: string
  effort?: string
  thinking?: string
  permissionMode?: string
}

export interface CliProcess extends EventEmitter {
  readonly process: ChildProcess
  readonly sessionId: string
  status: 'starting' | 'ready' | 'idle' | 'running' | 'dead'
  pendingRequests: Map<string, { resolve: (response: unknown) => void; timer: ReturnType<typeof setTimeout> }>

  send(message: unknown): boolean
  kill(): void
}

export class ProcessManager {
  private processes = new Map<string, CliProcess>()
  private cliBin: string

  constructor(cliBin?: string) {
    // Default to 'claude' in PATH, allow override
    this.cliBin = cliBin ?? 'claude'
  }

  /** Spawn a CLI subprocess for a session */
  spawn(options: SpawnOptions): CliProcess {
    const sessionId = options.sessionId ?? randomUUID()

    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--include-partial-messages',
    ]
    if (options.resumeSessionId) {
      args.push('--resume', options.resumeSessionId)
    }
    if (options.forkSession) {
      args.push('--fork-session')
    }
    if (options.sessionId) {
      args.push('--session-id', options.sessionId)
    }
    if (options.model) {
      args.push('--model', options.model)
    }
    if (options.effort) {
      args.push('--effort', options.effort)
    }
    if (options.thinking) {
      args.push('--thinking', options.thinking)
    }
    if (options.permissionMode) {
      args.push('--permission-mode', options.permissionMode)
    }

    const sessionAccessToken = randomUUID()
    const child = spawn(this.cliBin, args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CLAUDE_CODE_SESSION_ACCESS_TOKEN: sessionAccessToken,
      },
    })

    const cliProcess: CliProcess = Object.assign(new EventEmitter(), {
      process: child,
      sessionId,
      status: 'starting' as CliProcess['status'],
      pendingRequests: new Map<string, { resolve: (response: unknown) => void; timer: ReturnType<typeof setTimeout> }>(),

      send(message: unknown): boolean {
        return writeNdjson(child.stdin!, message)
      },

      kill(): void {
        cliProcess.status = 'dead'
        child.kill('SIGTERM')
        // Force kill after 5s if still running
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL')
        }, 5000)
      },
    })

    // Parse stdout NDJSON and emit messages
    if (child.stdout) {
      const parse = async () => {
        try {
          for await (const msg of parseNdjson(child.stdout!)) {
            const obj = msg as Record<string, unknown>

            // Route control_response to pending request resolvers
            if (obj.type === 'control_response') {
              const resp = obj.response as Record<string, unknown>
              const requestId = resp?.request_id as string
              const pending = cliProcess.pendingRequests.get(requestId)
              if (pending) {
                clearTimeout(pending.timer)
                cliProcess.pendingRequests.delete(requestId)
                pending.resolve(resp)
              }
            }

            cliProcess.emit('message', obj)
          }
        } catch (err) {
          cliProcess.emit('error', err)
        }
      }
      parse()
    }

    // Log stderr
    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim()
        if (text) console.error(`[CLI:${sessionId.slice(0, 8)}] ${text}`)
      })
    }

    // Handle process exit
    child.on('exit', (code, signal) => {
      cliProcess.status = 'dead'
      // Clean up pending requests
      for (const [, pending] of cliProcess.pendingRequests) {
        clearTimeout(pending.timer)
        pending.resolve({ subtype: 'error', error: 'Process exited' })
      }
      cliProcess.pendingRequests.clear()
      cliProcess.emit('exit', code, signal)
    })

    this.processes.set(sessionId, cliProcess)
    return cliProcess
  }

  /** Send a control_request and wait for the matching control_response */
  sendControlRequest(sessionId: string, request: Record<string, unknown>, timeoutMs = 10000): Promise<unknown> {
    const proc = this.processes.get(sessionId)
    if (!proc || proc.status === 'dead') {
      return Promise.reject(new Error(`No active process for session ${sessionId}`))
    }

    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        proc.pendingRequests.delete(requestId)
        reject(new Error(`Control request timed out: ${request.subtype}`))
      }, timeoutMs)

      proc.pendingRequests.set(requestId, { resolve, timer })
      proc.send({
        type: 'control_request',
        request_id: requestId,
        request,
      })
    })
  }

  get(sessionId: string): CliProcess | undefined {
    return this.processes.get(sessionId)
  }

  kill(sessionId: string): void {
    const proc = this.processes.get(sessionId)
    if (proc) {
      proc.kill()
      this.processes.delete(sessionId)
    }
  }

  killAll(): void {
    for (const [id, proc] of this.processes) {
      proc.kill()
      this.processes.delete(id)
    }
  }

  has(sessionId: string): boolean {
    const proc = this.processes.get(sessionId)
    return !!proc && proc.status !== 'dead'
  }

  /** Remove dead processes from the map */
  cleanup(): void {
    for (const [id, proc] of this.processes) {
      if (proc.status === 'dead') {
        this.processes.delete(id)
      }
    }
  }
}
```

- [ ] **Step 2: 验证构建通过**

Run: `pnpm --filter @claude-agent-ui/server build`
Expected: 成功编译

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/agent/process-manager.ts
git commit -m "feat: add ProcessManager for CLI subprocess lifecycle management"
```

---

## Task 4: CliSession — 替代 V1QuerySession

**Files:**
- Create: `packages/server/src/agent/cli-session.ts`
- Modify: `packages/server/src/agent/session.ts`

- [ ] **Step 1: 更新 AgentSession 抽象类，添加新方法签名**

在 `packages/server/src/agent/session.ts` 中添加可选方法：

```typescript
// 在 abstract class AgentSession 的末尾，close() 之后添加：

  // Optional methods — subclasses may implement
  setModel?(model: string): Promise<void>
  stopTask?(taskId: string): Promise<void>
  getContextUsage?(): Promise<unknown>
  getMcpStatus?(): Promise<unknown[]>
  toggleMcpServer?(serverName: string, enabled: boolean): Promise<void>
  reconnectMcpServer?(serverName: string): Promise<void>
  rewindFiles?(messageId: string): Promise<unknown>
  setThinking?(tokens: number | null): void
  setEffort?(level: string): void

  // Queue
  getQueue?(): { id: string; prompt: string; addedAt: number; images?: { data: string; mediaType: string }[] }[]
  clearQueue?(): void
  get queueLength(): number { return 0 }
```

- [ ] **Step 2: 创建 CliSession 类**

```typescript
// packages/server/src/agent/cli-session.ts
import { randomUUID } from 'crypto'
import type { ProcessManager, CliProcess, SpawnOptions } from './process-manager.js'
import { AgentSession } from './session.js'
import type { SessionStatus, PermissionMode } from '@claude-agent-ui/shared'
import type { ToolApprovalDecision, AskUserResponse, PlanApprovalDecision, SendOptions, SessionResult } from '@claude-agent-ui/shared'

export class CliSession extends AgentSession {
  private _sessionId: string | null = null
  private _status: SessionStatus = 'idle'
  private _permissionMode: PermissionMode = 'default'
  private _projectCwd: string
  private _resumeSessionId: string | null
  private _process: CliProcess | null = null
  private _processManager: ProcessManager
  private _model?: string
  private _effort?: string
  private _thinking?: string

  constructor(processManager: ProcessManager, cwd: string, options?: {
    resumeSessionId?: string
    model?: string
    effort?: string
    thinking?: string
    permissionMode?: PermissionMode
  }) {
    super()
    this._processManager = processManager
    this._projectCwd = cwd
    this._resumeSessionId = options?.resumeSessionId ?? null
    this._model = options?.model
    this._effort = options?.effort
    this._thinking = options?.thinking
    if (options?.permissionMode) this._permissionMode = options.permissionMode
  }

  get id(): string | null { return this._sessionId }
  get projectCwd(): string { return this._projectCwd }
  get status(): SessionStatus { return this._status }
  get permissionMode(): PermissionMode { return this._permissionMode }

  /** Ensure a CLI process is running, spawn if needed */
  private ensureProcess(): CliProcess {
    if (this._process && this._process.status !== 'dead') {
      return this._process
    }

    const opts: SpawnOptions = {
      cwd: this._projectCwd,
      model: this._model,
      effort: this._effort,
      thinking: this._thinking,
      permissionMode: this._permissionMode,
    }

    if (this._resumeSessionId) {
      opts.resumeSessionId = this._resumeSessionId
    }

    this._process = this._processManager.spawn(opts)
    this._sessionId = this._process.sessionId

    // Wire up stdout message handling
    this._process.on('message', (msg: Record<string, unknown>) => {
      this.handleCliMessage(msg)
    })

    this._process.on('exit', (code: number | null) => {
      this._status = 'idle'
      this.emit('state-change', 'idle')
      if (code !== 0 && code !== null) {
        this.emit('error', new Error(`CLI process exited with code ${code}`))
      }
    })

    return this._process
  }

  /** Route CLI stdout messages to appropriate handlers */
  private handleCliMessage(msg: Record<string, unknown>): void {
    const type = msg.type as string

    switch (type) {
      case 'system': {
        const subtype = msg.subtype as string
        if (subtype === 'init') {
          // Extract real session_id from CLI
          const cliSessionId = msg.session_id as string
          if (cliSessionId && cliSessionId !== this._sessionId) {
            const oldId = this._sessionId
            this._sessionId = cliSessionId
            this.emit('session-id-changed', oldId, cliSessionId)
          }
          this._model = msg.model as string | undefined
        } else if (subtype === 'session_state_changed') {
          const state = msg.state as string
          if (state === 'idle') this._status = 'idle'
          else if (state === 'running') this._status = 'running'
          else if (state === 'requires_action') this._status = 'awaiting_approval'
          this.emit('state-change', this._status)
        }
        // Broadcast all system messages
        this.emit('message', msg)
        break
      }

      case 'stream_event':
        // Forward directly (not buffered in WSHub)
        this.emit('message', msg)
        break

      case 'assistant':
        // Finalized assistant message
        this.emit('message', msg)
        break

      case 'user':
        // CLI echo — skip (server already broadcast user message)
        break

      case 'tool_progress':
      case 'tool_use_summary':
      case 'rate_limit_event':
      case 'auth_status':
        this.emit('message', msg)
        break

      case 'result': {
        const result: SessionResult = {
          subtype: (msg.subtype as SessionResult['subtype']) ?? 'success',
          result: msg.result as string | undefined,
          errors: msg.errors as string[] | undefined,
          duration_ms: (msg.duration_ms as number) ?? 0,
          total_cost_usd: (msg.total_cost_usd as number) ?? 0,
          num_turns: (msg.num_turns as number) ?? 0,
          usage: {
            input_tokens: (msg.usage as any)?.inputTokens ?? (msg.usage as any)?.input_tokens ?? 0,
            output_tokens: (msg.usage as any)?.outputTokens ?? (msg.usage as any)?.output_tokens ?? 0,
          },
        }
        this._status = 'idle'
        this.emit('complete', result)
        this.emit('state-change', 'idle')
        break
      }

      case 'control_request': {
        const request = msg.request as Record<string, unknown>
        const requestId = msg.request_id as string
        const subtype = request?.subtype as string

        if (subtype === 'can_use_tool') {
          const toolName = request.tool_name as string

          // Check if this is ExitPlanMode (plan approval)
          if (toolName === 'ExitPlanMode') {
            this._status = 'awaiting_approval'
            this.emit('state-change', this._status)
            const input = request.input as Record<string, unknown>
            this.emit('plan-approval', {
              requestId,
              planContent: (input.plan as string) ?? '',
              planFilePath: (input.planFilePath as string) ?? '',
              allowedPrompts: (input.allowedPrompts as { tool: string; prompt: string }[]) ?? [],
            })
          } else {
            // Regular tool approval
            this._status = 'awaiting_approval'
            this.emit('state-change', this._status)
            this.emit('tool-approval', {
              requestId,
              toolName,
              toolInput: (request.input as Record<string, unknown>) ?? {},
              toolUseID: (request.tool_use_id as string) ?? '',
              title: request.title as string | undefined,
              displayName: request.display_name as string | undefined,
              description: request.description as string | undefined,
              suggestions: request.permission_suggestions as unknown[] | undefined,
              agentID: request.agent_id as string | undefined,
            })
          }
        } else if (subtype === 'elicitation') {
          // MCP elicitation → AskUser
          this._status = 'awaiting_user_input'
          this.emit('state-change', this._status)
          this.emit('ask-user', {
            requestId,
            questions: (request.questions as unknown[]) ?? [],
          })
        }
        break
      }

      default:
        // Unknown message types — forward as generic message
        this.emit('message', msg)
    }
  }

  // ======== AgentSession interface ========

  send(prompt: string, options?: SendOptions): void {
    const proc = this.ensureProcess()

    // Build user message
    const content: unknown[] = []
    if (options?.images?.length) {
      for (const img of options.images) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.data },
        })
      }
    }
    content.push({ type: 'text', text: prompt })

    proc.send({
      type: 'user',
      content,
      message: { role: 'user', content: content.length === 1 ? prompt : content },
      uuid: randomUUID(),
      priority: 'next',
    })
  }

  async abort(): Promise<void> {
    if (!this._process || this._process.status === 'dead') return
    // Send interrupt control_request
    this._process.send({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'interrupt' },
    })
  }

  close(): void {
    if (this._process) {
      this._process.kill()
      this._process = null
    }
  }

  resolveToolApproval(requestId: string, decision: ToolApprovalDecision): void {
    if (!this._process) return
    this._process.send({
      type: 'control_response',
      response: {
        request_id: requestId,
        subtype: 'success',
        response: decision,
      },
    })
  }

  resolvePlanApproval(requestId: string, decision: PlanApprovalDecision): void {
    if (!this._process) return

    if (decision.decision === 'feedback') {
      // Deny with feedback message
      this._process.send({
        type: 'control_response',
        response: {
          request_id: requestId,
          subtype: 'success',
          response: {
            behavior: 'deny',
            toolUseID: requestId,
            message: decision.feedback ?? 'User requested changes',
          },
        },
      })
    } else if (decision.decision === 'clear-and-accept') {
      // Deny to end current query, then respawn fresh
      this._process.send({
        type: 'control_response',
        response: {
          request_id: requestId,
          subtype: 'success',
          response: { behavior: 'deny', toolUseID: requestId, message: '' },
        },
      })
      // The caller (handler) will handle the respawn + new message after idle
      this.emit('clear-and-accept-requested', decision)
    } else {
      // auto-accept, bypass, manual → allow, then switch mode
      this._process.send({
        type: 'control_response',
        response: {
          request_id: requestId,
          subtype: 'success',
          response: { behavior: 'allow', toolUseID: requestId },
        },
      })

      // Switch permission mode based on decision
      const modeMap: Record<string, PermissionMode> = {
        'auto-accept': 'acceptEdits',
        'bypass': 'bypassPermissions',
        'manual': 'default',
      }
      const newMode = modeMap[decision.decision]
      if (newMode) {
        this.setPermissionMode(newMode).catch(() => {})
      }
    }
  }

  resolveAskUser(requestId: string, response: AskUserResponse): void {
    if (!this._process) return
    this._process.send({
      type: 'control_response',
      response: {
        request_id: requestId,
        subtype: 'success',
        response: {
          action: 'accept',
          content: response.answers,
        },
      },
    })
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this._permissionMode = mode
    if (!this._process || this._process.status === 'dead') return
    this._process.send({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'set_permission_mode', mode },
    })
  }

  // ======== Extended methods ========

  async setModel(model: string): Promise<void> {
    this._model = model
    if (!this._process || this._process.status === 'dead') return
    this._process.send({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'set_model', model },
    })
  }

  async stopTask(taskId: string): Promise<void> {
    if (!this._process || this._process.status === 'dead') return
    this._process.send({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'stop_task', task_id: taskId },
    })
  }

  async getContextUsage(): Promise<unknown> {
    if (!this._process || this._process.status === 'dead') return null
    return this._processManager.sendControlRequest(this._process.sessionId, { subtype: 'get_context_usage' })
  }

  async getMcpStatus(): Promise<unknown[]> {
    if (!this._process || this._process.status === 'dead') return []
    const resp = await this._processManager.sendControlRequest(this._process.sessionId, { subtype: 'mcp_status' }) as any
    return resp?.response?.mcpServers ?? []
  }

  async toggleMcpServer(serverName: string, enabled: boolean): Promise<void> {
    if (!this._process || this._process.status === 'dead') return
    this._process.send({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'mcp_toggle', serverName, enabled },
    })
  }

  async reconnectMcpServer(serverName: string): Promise<void> {
    if (!this._process || this._process.status === 'dead') return
    this._process.send({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'mcp_reconnect', serverName },
    })
  }

  async rewindFiles(messageId: string): Promise<unknown> {
    if (!this._process || this._process.status === 'dead') return null
    return this._processManager.sendControlRequest(this._process.sessionId, {
      subtype: 'rewind_files',
      user_message_id: messageId,
    })
  }

  setThinking(tokens: number | null): void {
    if (!this._process || this._process.status === 'dead') return
    this._process.send({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'set_max_thinking_tokens', max_thinking_tokens: tokens },
    })
  }

  setEffort(level: string): void {
    if (!this._process || this._process.status === 'dead') return
    this._process.send({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'apply_flag_settings', settings: { effortLevel: level } },
    })
  }
}
```

- [ ] **Step 3: 验证构建通过**

Run: `pnpm --filter @claude-agent-ui/server build`
Expected: 成功编译

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/agent/cli-session.ts packages/server/src/agent/session.ts
git commit -m "feat: add CliSession wrapping CLI subprocess, replacing V1QuerySession"
```

---

## Task 5: 迁移 SessionManager — 用 SessionStorage 替代 SDK

**Files:**
- Modify: `packages/server/src/agent/manager.ts`

- [ ] **Step 1: 重写 manager.ts，移除所有 SDK import**

完整替换 `packages/server/src/agent/manager.ts`：

```typescript
// packages/server/src/agent/manager.ts
import type { ProjectInfo, SessionSummary, SlashCommandInfo } from '@claude-agent-ui/shared'
import { CliSession } from './cli-session.js'
import { AgentSession } from './session.js'
import { ProcessManager } from './process-manager.js'
import { SessionStorage } from './session-storage.js'
import { basename } from 'path'

interface CacheEntry<T> {
  data: T
  expiry: number
}

const CACHE_TTL_MS = 30_000 // 30 seconds

export class SessionManager {
  private activeSessions = new Map<string, AgentSession>()
  private _cachedCommands: SlashCommandInfo[] | null = null
  private _projectsCache: CacheEntry<ProjectInfo[]> | null = null
  private _sessionsCache = new Map<string, CacheEntry<{ sessions: SessionSummary[]; total: number; hasMore: boolean }>>()

  readonly processManager: ProcessManager
  readonly sessionStorage: SessionStorage

  constructor(cliBin?: string) {
    this.processManager = new ProcessManager(cliBin)
    this.sessionStorage = new SessionStorage()
  }

  async listProjects(): Promise<ProjectInfo[]> {
    if (this._projectsCache && Date.now() < this._projectsCache.expiry) {
      return this._projectsCache.data
    }
    const sessions = await this.sessionStorage.listSessions()
    const projectMap = new Map<string, { lastActiveAt: string; count: number }>()

    for (const s of sessions) {
      const cwd = s.cwd ?? ''
      if (!cwd) continue
      const existing = projectMap.get(cwd)
      const updatedAt = s.lastModified
        ? new Date(s.lastModified).toISOString()
        : s.createdAt
          ? new Date(s.createdAt).toISOString()
          : ''
      if (!existing) {
        projectMap.set(cwd, { lastActiveAt: updatedAt, count: 1 })
      } else {
        existing.count++
        if (updatedAt > existing.lastActiveAt) {
          existing.lastActiveAt = updatedAt
        }
      }
    }

    const projects: ProjectInfo[] = []
    for (const [cwd, info] of projectMap) {
      projects.push({
        cwd,
        name: basename(cwd),
        lastActiveAt: info.lastActiveAt,
        sessionCount: info.count,
      })
    }

    const result = projects.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
    this._projectsCache = { data: result, expiry: Date.now() + CACHE_TTL_MS }
    return result
  }

  async listProjectSessions(
    cwd: string,
    options?: { limit?: number; offset?: number }
  ): Promise<{ sessions: SessionSummary[]; total: number; hasMore: boolean }> {
    const cacheKey = `${cwd}:${options?.limit ?? 20}:${options?.offset ?? 0}`
    const cached = this._sessionsCache.get(cacheKey)
    if (cached && Date.now() < cached.expiry) {
      return cached.data
    }
    const allSessions = await this.sessionStorage.listSessions(cwd)
    const sorted = allSessions.sort((a, b) => b.lastModified - a.lastModified)

    const limit = options?.limit ?? 20
    const offset = options?.offset ?? 0
    const paged = sorted.slice(offset, offset + limit)

    const result = {
      sessions: paged.map((s) => ({
        sessionId: s.sessionId,
        cwd: s.cwd ?? cwd,
        tag: s.tag,
        title: s.customTitle ?? s.summary,
        createdAt: s.createdAt ? new Date(s.createdAt).toISOString() : undefined,
        updatedAt: s.lastModified ? new Date(s.lastModified).toISOString() : undefined,
      })),
      total: sorted.length,
      hasMore: offset + limit < sorted.length,
    }
    this._sessionsCache.set(cacheKey, { data: result, expiry: Date.now() + CACHE_TTL_MS })
    return result
  }

  async getSessionInfo(sessionId: string) {
    return await this.sessionStorage.getSessionInfo(sessionId)
  }

  async getSessionMessages(
    sessionId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<{ messages: unknown[]; total: number; hasMore: boolean }> {
    const allMessages = await this.sessionStorage.getSessionMessages(sessionId)
    const total = allMessages.length
    const limit = options?.limit ?? 50
    const offset = options?.offset ?? 0

    const endIndex = total - offset
    const startIndex = Math.max(0, endIndex - limit)
    const sliced = endIndex > 0 ? allMessages.slice(startIndex, endIndex) : []

    return {
      messages: sliced,
      total,
      hasMore: startIndex > 0,
    }
  }

  createSession(cwd: string, options?: { model?: string; effort?: string; thinking?: string; permissionMode?: any }): AgentSession {
    const session = new CliSession(this.processManager, cwd, options)
    return session
  }

  async resumeSession(sessionId: string): Promise<AgentSession> {
    const existing = this.activeSessions.get(sessionId)
    if (existing) return existing

    const info = await this.sessionStorage.getSessionInfo(sessionId)
    if (!info) throw new Error(`Session ${sessionId} not found`)

    const session = new CliSession(this.processManager, info.cwd ?? '.', { resumeSessionId: sessionId })
    this.activeSessions.set(sessionId, session)
    return session
  }

  registerActive(sessionId: string, session: AgentSession): void {
    this.activeSessions.set(sessionId, session)
    this.invalidateSessionsCache(session.projectCwd)
  }

  invalidateSessionsCache(cwd?: string): void {
    this._projectsCache = null
    if (!cwd) {
      this._sessionsCache.clear()
    } else {
      for (const key of this._sessionsCache.keys()) {
        if (key.startsWith(cwd + ':')) {
          this._sessionsCache.delete(key)
        }
      }
    }
  }

  getActive(sessionId: string): AgentSession | undefined {
    return this.activeSessions.get(sessionId)
  }

  getAllActive(): ReadonlyMap<string, AgentSession> {
    return this.activeSessions
  }

  removeActive(sessionId: string): void {
    this.activeSessions.delete(sessionId)
  }

  cacheCommands(commands: SlashCommandInfo[]): void {
    this._cachedCommands = commands
  }

  async getCommands(): Promise<SlashCommandInfo[]> {
    // CLI init message will provide commands; return cached if available
    if (this._cachedCommands) return this._cachedCommands
    return []
  }
}
```

- [ ] **Step 2: 验证构建通过**

Run: `pnpm --filter @claude-agent-ui/server build`
Expected: 成功编译

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/agent/manager.ts
git commit -m "refactor: rewrite SessionManager to use SessionStorage and CliSession, remove SDK"
```

---

## Task 6: 迁移 title-generator — 移除 SDK 依赖

**Files:**
- Modify: `packages/server/src/agent/title-generator.ts`

- [ ] **Step 1: 替换 SDK 调用为 SessionStorage**

完整替换 `packages/server/src/agent/title-generator.ts`：

```typescript
// packages/server/src/agent/title-generator.ts
import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { SessionStorage } from './session-storage.js'

const sessionStorage = new SessionStorage()

function getApiConfig(): { apiKey: string; baseUrl: string } | null {
  const envKey = process.env.ANTHROPIC_API_KEY
  if (envKey) {
    return {
      apiKey: envKey,
      baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    }
  }

  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json')
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    const env = settings.env
    if (env?.ANTHROPIC_API_KEY) {
      return { apiKey: env.ANTHROPIC_API_KEY, baseUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com' }
    }
    if (env?.ANTHROPIC_AUTH_TOKEN) {
      return { apiKey: env.ANTHROPIC_AUTH_TOKEN, baseUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com' }
    }
  } catch { /* settings file missing */ }

  return null
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text ?? '')
      .join('\n')
      .slice(0, 2000)
  }
  return ''
}

async function callHaikuForTitle(userMessage: string, assistantSummary: string): Promise<string | null> {
  const config = getApiConfig()
  if (!config) return null

  const prompt = `Based on this conversation, generate a concise title (under 20 characters, same language as the user). Return ONLY the title, no quotes or punctuation wrapper.

User: ${userMessage.slice(0, 500)}
${assistantSummary ? `Assistant: ${assistantSummary.slice(0, 300)}` : ''}`

  try {
    const resp = await fetch(`${config.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 50,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!resp.ok) return null

    const data = await resp.json() as any
    const text = data?.content?.[0]?.text?.trim()
    if (!text) return null

    return text.replace(/^["'「『]|["'」』]$/g, '').trim().slice(0, 50)
  } catch {
    return null
  }
}

export async function maybeGenerateTitle(sessionId: string): Promise<string | null> {
  try {
    const info = await sessionStorage.getSessionInfo(sessionId)
    if (info?.customTitle) return null

    const messages = await sessionStorage.getSessionMessages(sessionId)
    if (!messages || messages.length < 2) return null

    let userText = ''
    let assistantText = ''
    for (const msg of messages) {
      const m = msg as any
      if (!userText && m.type === 'user') {
        userText = extractTextContent(m.message?.content)
      } else if (!assistantText && m.type === 'assistant') {
        assistantText = extractTextContent(m.message?.content)
      }
      if (userText && assistantText) break
    }

    if (!userText) return null

    const trimmed = userText.trim()
    if (trimmed.length < 3) return null

    const title = await callHaikuForTitle(userText, assistantText)
    if (!title) return null

    await sessionStorage.renameSession(sessionId, title)
    return title
  } catch (err) {
    console.error('[TitleGen] Failed to generate title:', err)
    return null
  }
}
```

- [ ] **Step 2: 验证构建通过**

Run: `pnpm --filter @claude-agent-ui/server build`
Expected: 成功编译

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/agent/title-generator.ts
git commit -m "refactor: title-generator uses SessionStorage instead of SDK"
```

---

## Task 7: 迁移 handler.ts — 大幅简化消息路由

**Files:**
- Modify: `packages/server/src/ws/handler.ts`

这是最复杂的任务。handler.ts 需要：
1. 移除所有 SDK import（`forkSession`, `getSubagentMessages`, `getSessionMessages`）
2. 移除 V1QuerySession import，改用 CliSession
3. 简化事件绑定（CliSession 直接发出格式化好的事件）
4. 删除 warmUp hack、pending request 恢复、mode change auto-resolve 等逻辑

- [ ] **Step 1: 重写 handler.ts**

完整替换 `packages/server/src/ws/handler.ts`。由于文件很长，这里给出关键结构（实现者需要参照原文件和设计文档完整实现）：

```typescript
// packages/server/src/ws/handler.ts
import { randomUUID } from 'crypto'
import type { WebSocket } from 'ws'
import type { C2SMessage, PermissionMode, PlanApprovalDecision } from '@claude-agent-ui/shared'
import type { WSHub } from './hub.js'
import type { LockManager } from './lock.js'
import type { SessionManager } from '../agent/manager.js'
import type { AgentSession } from '../agent/session.js'
import { CliSession } from '../agent/cli-session.js'
import { maybeGenerateTitle } from '../agent/title-generator.js'

export interface HandlerDeps {
  wsHub: WSHub
  lockManager: LockManager
  sessionManager: SessionManager
}

export function createWsHandler(deps: HandlerDeps) {
  const { wsHub, lockManager, sessionManager } = deps

  interface PendingRequest {
    sessionId: string
    type: 'tool-approval' | 'ask-user' | 'plan-approval'
    payload: Record<string, unknown>
  }
  const pendingRequestMap = new Map<string, PendingRequest>()

  wsHub.startHeartbeat()

  function resendPendingRequests(sessionId: string, connectionId: string, readonly: boolean) {
    for (const [, entry] of pendingRequestMap) {
      if (entry.sessionId !== sessionId) continue
      if (entry.type === 'tool-approval') {
        wsHub.sendTo(connectionId, { type: 'tool-approval-request', sessionId, ...entry.payload, readonly } as any)
      } else if (entry.type === 'ask-user') {
        wsHub.sendTo(connectionId, { type: 'ask-user-request', sessionId, ...entry.payload, readonly } as any)
      } else if (entry.type === 'plan-approval') {
        wsHub.sendTo(connectionId, { type: 'plan-approval', sessionId, ...entry.payload, readonly } as any)
      }
    }
  }

  lockManager.setOnRelease((sessionId: string) => {
    wsHub.broadcast(sessionId, { type: 'lock-status', sessionId, status: 'idle' })
  })

  return function handleConnection(ws: WebSocket, meta?: { userAgent?: string; ip?: string }) {
    const connectionId = wsHub.register(ws, meta)
    wsHub.sendTo(connectionId, { type: 'init', connectionId })

    ws.on('message', async (raw) => {
      try {
        const msg: C2SMessage = JSON.parse(raw.toString())
        await handleMessage(connectionId, msg)
      } catch (err: any) {
        wsHub.sendTo(connectionId, { type: 'error', message: err.message ?? 'Invalid message', code: 'internal' })
      }
    })

    ws.on('close', () => {
      wsHub.unregister(connectionId)
    })
  }

  async function handleMessage(connectionId: string, msg: C2SMessage) {
    switch (msg.type) {
      case 'join-session':
        handleJoinSession(connectionId, msg.sessionId, msg.lastSeq)
        break
      case 'send-message':
        await handleSendMessage(connectionId, msg.sessionId, msg.prompt, msg.options)
        break
      case 'tool-approval-response':
        handleToolApprovalResponse(connectionId, msg.requestId, msg.decision)
        break
      case 'ask-user-response':
        handleAskUserResponse(connectionId, msg.requestId, msg.answers)
        break
      case 'abort':
        await handleAbort(connectionId, msg.sessionId)
        break
      case 'clear-queue':
        handleClearQueue(connectionId, (msg as any).sessionId)
        break
      case 'set-mode':
        await handleSetMode(connectionId, msg.sessionId, msg.mode)
        break
      case 'set-effort': {
        const session = sessionManager.getActive(msg.sessionId) as CliSession | undefined
        session?.setEffort?.((msg as any).effort)
        break
      }
      case 'reconnect':
        handleReconnect(connectionId, msg.previousConnectionId)
        break
      case 'release-lock':
        handleReleaseLock(connectionId, msg.sessionId)
        break
      case 'leave-session':
        wsHub.leaveSession(connectionId)
        break
      case 'subscribe-session':
        handleSubscribeSession(connectionId, msg.sessionId, msg.lastSeq)
        break
      case 'unsubscribe-session':
        wsHub.unsubscribeSession(connectionId, msg.sessionId)
        break
      case 'resolve-plan-approval':
        handleResolvePlanApproval(connectionId, msg.sessionId, msg.requestId, msg.decision, msg.feedback)
        break
      case 'stop-task': {
        const session = sessionManager.getActive(msg.sessionId) as CliSession | undefined
        session?.stopTask?.(msg.taskId).catch(() => {})
        break
      }
      case 'set-model': {
        const session = sessionManager.getActive(msg.sessionId) as CliSession | undefined
        session?.setModel?.(msg.model).catch(() => {})
        break
      }
      case 'fork-session':
        await handleForkSession(connectionId, msg.sessionId, msg.atMessageId)
        break
      case 'get-context-usage':
        await handleGetContextUsage(connectionId, msg.sessionId)
        break
      case 'get-mcp-status':
        await handleGetMcpStatus(connectionId, msg.sessionId)
        break
      case 'toggle-mcp-server': {
        const session = sessionManager.getActive(msg.sessionId) as CliSession | undefined
        session?.toggleMcpServer?.(msg.serverName, msg.enabled).catch(() => {})
        // Refresh status after toggle
        setTimeout(() => handleGetMcpStatus(connectionId, msg.sessionId), 500)
        break
      }
      case 'reconnect-mcp-server': {
        const session = sessionManager.getActive(msg.sessionId) as CliSession | undefined
        session?.reconnectMcpServer?.(msg.serverName).catch(() => {})
        setTimeout(() => handleGetMcpStatus(connectionId, msg.sessionId), 500)
        break
      }
      case 'get-subagent-messages':
        // Not supported without SDK — send empty
        wsHub.sendTo(connectionId, { type: 'subagent-messages', sessionId: msg.sessionId, agentId: msg.agentId, messages: [] } as any)
        break
      case 'pong':
        wsHub.recordPong(connectionId)
        break
    }
  }

  // ======== Handler implementations ========

  function handleJoinSession(connectionId: string, sessionId: string, lastSeq?: number) {
    const syncResult = wsHub.joinWithSync(connectionId, sessionId, lastSeq ?? 0)
    const lockHolder = lockManager.getHolder(sessionId)
    const activeSession = sessionManager.getActive(sessionId)

    wsHub.sendTo(connectionId, {
      type: 'session-state',
      sessionId,
      sessionStatus: activeSession?.status ?? 'idle',
      lockStatus: lockManager.getStatus(sessionId),
      lockHolderId: lockHolder ?? undefined,
      isLockHolder: lockHolder === connectionId,
      permissionMode: activeSession?.permissionMode,
    })

    if (!syncResult.alreadyInSession) {
      const snapshot = wsHub.getStreamSnapshot(sessionId)
      if (snapshot) {
        wsHub.sendTo(connectionId, { type: 'stream-snapshot', sessionId, messageId: snapshot.messageId, blocks: snapshot.blocks })
      }
      wsHub.sendTo(connectionId, { type: 'sync-result', sessionId, replayed: syncResult.replayed, hasGap: syncResult.hasGap, gapRange: syncResult.gapRange } as any)
    }

    // Resend pending requests to joining client
    const isLockHolder = lockHolder === connectionId
    resendPendingRequests(sessionId, connectionId, !isLockHolder)
  }

  function bindSessionEvents(sessionId: string, session: CliSession) {
    let titleGenTriggered = false

    // Handle session-id-changed (CLI may assign a different ID)
    session.on('session-id-changed', (oldId: string | null, newId: string) => {
      if (oldId && oldId !== newId) {
        sessionManager.removeActive(oldId)
        lockManager.transferSession?.(oldId, newId)
      }
      sessionManager.registerActive(newId, session)
    })

    session.on('message', (msg: Record<string, unknown>) => {
      const msgType = msg.type as string

      if (msgType === 'stream_event') {
        // Stream events: update snapshot, broadcast raw (not buffered)
        const event = msg.event as Record<string, unknown>
        if (event) {
          const eventType = event.type as string
          if (eventType === 'content_block_start' || eventType === 'content_block_delta') {
            wsHub.updateStreamSnapshot(sessionId, msg.uuid as string, event)
          }
        }
        wsHub.broadcastRaw(sessionId, { type: 'agent-message', sessionId, message: msg })
      } else if (msgType === 'assistant') {
        // Final assistant message: clear snapshot, buffer
        wsHub.clearStreamSnapshot(sessionId)
        wsHub.broadcast(sessionId, { type: 'agent-message', sessionId, message: msg })

        // Trigger title generation on first assistant message
        if (!titleGenTriggered) {
          titleGenTriggered = true
          maybeGenerateTitle(sessionId).then((title) => {
            if (title) {
              wsHub.broadcast(sessionId, { type: 'session-title-updated', sessionId, title })
            }
          }).catch(() => {})
        }
      } else {
        // All other messages: buffer and broadcast
        wsHub.broadcast(sessionId, { type: 'agent-message', sessionId, message: msg })
      }
    })

    session.on('tool-approval', (req: any) => {
      lockManager.resetIdleTimeout(sessionId)
      const payload = {
        requestId: req.requestId,
        toolName: req.toolName,
        toolInput: req.toolInput,
        toolUseID: req.toolUseID,
        title: req.title,
        displayName: req.displayName,
        description: req.description,
        suggestions: req.suggestions,
        agentID: req.agentID,
      }
      pendingRequestMap.set(req.requestId, { sessionId, type: 'tool-approval', payload })
      // Send to all clients; lock holder gets readonly=false, others readonly=true
      const lockHolder = lockManager.getHolder(sessionId)
      wsHub.broadcastPerConnection(sessionId, (connId) => ({
        type: 'tool-approval-request',
        sessionId,
        ...payload,
        readonly: connId !== lockHolder,
      }))
    })

    session.on('ask-user', (req: any) => {
      lockManager.resetIdleTimeout(sessionId)
      const payload = { requestId: req.requestId, questions: req.questions }
      pendingRequestMap.set(req.requestId, { sessionId, type: 'ask-user', payload })
      const lockHolder = lockManager.getHolder(sessionId)
      wsHub.broadcastPerConnection(sessionId, (connId) => ({
        type: 'ask-user-request',
        sessionId,
        ...payload,
        readonly: connId !== lockHolder,
      }))
    })

    session.on('plan-approval', (req: any) => {
      lockManager.resetIdleTimeout(sessionId)
      const payload = {
        requestId: req.requestId,
        planContent: req.planContent,
        planFilePath: req.planFilePath,
        allowedPrompts: req.allowedPrompts,
      }
      pendingRequestMap.set(req.requestId, { sessionId, type: 'plan-approval', payload })
      const lockHolder = lockManager.getHolder(sessionId)
      wsHub.broadcastPerConnection(sessionId, (connId) => ({
        type: 'plan-approval',
        sessionId,
        ...payload,
        readonly: connId !== lockHolder,
      }))
    })

    session.on('state-change', (state: string) => {
      wsHub.broadcast(sessionId, { type: 'session-state-change', sessionId, state })
    })

    session.on('complete', (result: any) => {
      // Clean up pending requests for this session
      for (const [id, entry] of pendingRequestMap) {
        if (entry.sessionId === sessionId) pendingRequestMap.delete(id)
      }
      lockManager.resetIdleTimeout(sessionId)
      wsHub.broadcast(sessionId, { type: 'session-complete', sessionId, result })
    })

    session.on('error', (err: Error) => {
      wsHub.broadcast(sessionId, { type: 'error', message: err.message, code: 'internal' })
    })
  }

  async function handleSendMessage(connectionId: string, sessionId: string | null, prompt: string, options?: any) {
    const cwd = options?.cwd ?? process.cwd()

    // Acquire lock
    const targetSessionId = sessionId ?? '__new__'
    const lockResult = lockManager.acquire(targetSessionId, connectionId)
    if (!lockResult) {
      wsHub.sendTo(connectionId, { type: 'error', message: 'Session is locked by another client', code: 'session_locked' })
      return
    }
    wsHub.broadcast(targetSessionId, { type: 'lock-status', sessionId: targetSessionId, status: 'locked', holderId: connectionId })

    // Get or create session
    let session: CliSession
    if (sessionId && sessionManager.getActive(sessionId)) {
      session = sessionManager.getActive(sessionId) as CliSession
    } else if (sessionId && sessionId !== '__new__') {
      session = await sessionManager.resumeSession(sessionId) as CliSession
      bindSessionEvents(sessionId, session)
    } else {
      session = sessionManager.createSession(cwd, {
        model: options?.model,
        effort: options?.effort,
        thinking: options?.thinkingMode,
        permissionMode: options?.permissionMode,
      }) as CliSession
      const tempId = session.id ?? randomUUID()
      sessionManager.registerActive(tempId, session)
      bindSessionEvents(tempId, session)
    }

    // Apply per-message options
    if (options?.thinkingMode) {
      if (options.thinkingMode === 'disabled') session.setThinking?.(0)
      else session.setThinking?.(null) // adaptive
    }
    if (options?.effort) session.setEffort?.(options.effort)
    if (options?.permissionMode) await session.setPermissionMode(options.permissionMode)

    // Broadcast user message to all clients
    const userMsgId = randomUUID()
    wsHub.broadcast(session.id ?? targetSessionId, {
      type: 'agent-message',
      sessionId: session.id ?? targetSessionId,
      message: {
        type: 'user',
        uuid: userMsgId,
        message: { role: 'user', content: prompt },
        ...(options?.images?.length ? { images: options.images } : {}),
      },
    })

    // Send to CLI
    session.send(prompt, {
      cwd,
      images: options?.images,
      effort: options?.effort,
      thinkingMode: options?.thinkingMode,
    })
  }

  function handleToolApprovalResponse(connectionId: string, requestId: string, decision: any) {
    const pending = pendingRequestMap.get(requestId)
    if (!pending) return

    const session = sessionManager.getActive(pending.sessionId)
    if (!session) return

    // Acquire lock for responder
    lockManager.acquire(pending.sessionId, connectionId)

    session.resolveToolApproval(requestId, decision)
    pendingRequestMap.delete(requestId)

    wsHub.broadcast(pending.sessionId, {
      type: 'tool-approval-resolved',
      sessionId: pending.sessionId,
      requestId,
      decision: { behavior: decision.behavior, message: decision.behavior === 'deny' ? decision.message : undefined },
    })
  }

  function handleAskUserResponse(connectionId: string, requestId: string, answers: Record<string, string>) {
    const pending = pendingRequestMap.get(requestId)
    if (!pending) return

    const session = sessionManager.getActive(pending.sessionId)
    if (!session) return

    lockManager.acquire(pending.sessionId, connectionId)

    session.resolveAskUser(requestId, { answers })
    pendingRequestMap.delete(requestId)

    wsHub.broadcast(pending.sessionId, {
      type: 'ask-user-resolved',
      sessionId: pending.sessionId,
      requestId,
      answers,
    })
  }

  function handleResolvePlanApproval(connectionId: string, sessionId: string, requestId: string, decisionType: string, feedback?: string) {
    const pending = pendingRequestMap.get(requestId)
    if (!pending) return

    const session = sessionManager.getActive(sessionId) as CliSession | undefined
    if (!session) return

    lockManager.acquire(sessionId, connectionId)

    const decision: PlanApprovalDecision = {
      decision: decisionType as any,
      feedback,
    }
    session.resolvePlanApproval(requestId, decision)
    pendingRequestMap.delete(requestId)

    wsHub.broadcast(sessionId, {
      type: 'plan-approval-resolved',
      sessionId,
      requestId,
      decision: decisionType,
    })

    // Handle clear-and-accept: listen for idle, then respawn with plan
    if (decisionType === 'clear-and-accept') {
      const planContent = (pending.payload as any).planContent as string
      const onStateChange = (state: string) => {
        if (state !== 'idle') return
        session.removeListener('state-change', onStateChange)

        // Kill old process, create new session
        session.close()
        sessionManager.removeActive(sessionId)

        const newSession = sessionManager.createSession(session.projectCwd, {
          model: (session as any)._model,
          permissionMode: 'acceptEdits' as PermissionMode,
        }) as CliSession
        const newId = newSession.id ?? randomUUID()
        sessionManager.registerActive(newId, newSession)
        bindSessionEvents(newId, newSession)

        // Send plan as implementation instruction
        newSession.send(`Implement the following plan:\n\n${planContent}`)

        wsHub.broadcast(sessionId, {
          type: 'session-forked',
          sessionId: newId,
          originalSessionId: sessionId,
        } as any)
      }
      session.on('state-change', onStateChange)
    }
  }

  async function handleAbort(connectionId: string, sessionId: string) {
    if (!lockManager.isHolder(sessionId, connectionId)) {
      wsHub.sendTo(connectionId, { type: 'error', message: 'Not lock holder', code: 'not_lock_holder' })
      return
    }
    const session = sessionManager.getActive(sessionId)
    if (session) {
      await session.abort()
    }
    wsHub.broadcast(sessionId, { type: 'session-aborted', sessionId })
  }

  function handleClearQueue(connectionId: string, sessionId: string) {
    if (!lockManager.isHolder(sessionId, connectionId)) return
    const session = sessionManager.getActive(sessionId)
    if (session && 'clearQueue' in session) {
      (session as any).clearQueue()
    }
  }

  async function handleSetMode(connectionId: string, sessionId: string, mode: PermissionMode) {
    const session = sessionManager.getActive(sessionId)
    if (!session) return
    await session.setPermissionMode(mode)
    wsHub.broadcast(sessionId, { type: 'mode-change', sessionId, mode })
  }

  function handleReconnect(connectionId: string, previousConnectionId: string) {
    wsHub.migrateConnection(connectionId, previousConnectionId)
    lockManager.transferAll(previousConnectionId, connectionId)
  }

  function handleReleaseLock(connectionId: string, sessionId: string) {
    if (lockManager.isHolder(sessionId, connectionId)) {
      lockManager.release(sessionId)
    }
  }

  function handleSubscribeSession(connectionId: string, sessionId: string, lastSeq?: number) {
    const syncResult = wsHub.subscribeWithSync(connectionId, sessionId, lastSeq ?? 0)
    wsHub.sendTo(connectionId, { type: 'sync-result', sessionId, replayed: syncResult.replayed, hasGap: syncResult.hasGap, gapRange: syncResult.gapRange } as any)
    resendPendingRequests(sessionId, connectionId, true)
  }

  async function handleForkSession(connectionId: string, sessionId: string, atMessageId?: string) {
    try {
      // Fork by spawning a new CLI process with --resume --fork-session
      const session = sessionManager.getActive(sessionId)
      const cwd = session?.projectCwd ?? process.cwd()

      const newSession = new CliSession(sessionManager.processManager, cwd, {
        resumeSessionId: sessionId,
      })
      // The fork will happen when the CLI process starts with --fork-session
      // For now, register and notify
      const newId = randomUUID()
      sessionManager.registerActive(newId, newSession)
      sessionManager.invalidateSessionsCache(cwd)

      wsHub.sendTo(connectionId, { type: 'session-forked', sessionId: newId, originalSessionId: sessionId } as any)
    } catch (err: any) {
      wsHub.sendTo(connectionId, { type: 'error', message: err.message, code: 'internal' })
    }
  }

  async function handleGetContextUsage(connectionId: string, sessionId: string) {
    const session = sessionManager.getActive(sessionId) as CliSession | undefined
    if (!session?.getContextUsage) return
    try {
      const usage = await session.getContextUsage() as any
      const response = usage?.response ?? usage
      wsHub.sendTo(connectionId, {
        type: 'context-usage',
        sessionId,
        categories: response?.categories ?? [],
        totalTokens: response?.totalTokens ?? 0,
        maxTokens: response?.maxTokens ?? 0,
        percentage: response?.percentage ?? 0,
        model: response?.model ?? '',
      })
    } catch { /* ignore */ }
  }

  async function handleGetMcpStatus(connectionId: string, sessionId: string) {
    const session = sessionManager.getActive(sessionId) as CliSession | undefined
    if (!session?.getMcpStatus) return
    try {
      const servers = await session.getMcpStatus()
      wsHub.sendTo(connectionId, { type: 'mcp-status', sessionId, servers })
    } catch { /* ignore */ }
  }
}
```

- [ ] **Step 2: 验证构建通过**

Run: `pnpm --filter @claude-agent-ui/server build`
Expected: 成功编译

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/ws/handler.ts
git commit -m "refactor: rewrite handler.ts to use CliSession, remove all SDK calls and self-built approval logic"
```

---

## Task 8: 清理 — 删除旧文件和 SDK 依赖

**Files:**
- Delete: `packages/server/src/agent/v1-session.ts`
- Delete: `packages/shared/src/sdk-features.ts`
- Modify: `packages/server/package.json`
- Modify: `packages/shared/src/index.ts`（如果导出了 sdk-features）
- Modify: `packages/server/src/routes/sessions.ts`（如果 import SDK）

- [ ] **Step 1: 删除 v1-session.ts**

```bash
rm packages/server/src/agent/v1-session.ts
```

- [ ] **Step 2: 删除 sdk-features.ts**

```bash
rm packages/shared/src/sdk-features.ts
```

- [ ] **Step 3: 从 shared/src/index.ts 移除 sdk-features 导出（如果存在）**

检查 `packages/shared/src/index.ts`，删除 `export * from './sdk-features.js'` 行（如果有）。

- [ ] **Step 4: 从 package.json 移除 SDK 依赖**

在 `packages/server/package.json` 中删除 `"@anthropic-ai/claude-agent-sdk": "^0.2.97"` 行。

- [ ] **Step 5: 迁移 routes/sessions.ts 的 SDK import**

`packages/server/src/routes/sessions.ts` 第 2 行 import 了 `renameSession` 和 `tagSession` from SDK。替换为使用 SessionManager 的 sessionStorage：

将第 2 行：
```typescript
import { renameSession, tagSession } from '@anthropic-ai/claude-agent-sdk'
```
删除，然后修改 rename 路由（第 59 行）：
```typescript
await sessionManager.sessionStorage.renameSession(request.params.id, request.body.title)
```
修改 tag 路由（第 123 行）：
```typescript
await sessionManager.sessionStorage.tagSession(request.params.id, request.body.tag)
```

- [ ] **Step 6: 全局搜索残留 SDK import**

Run: `grep -r "claude-agent-sdk" packages/server/src/ packages/shared/src/`
Expected: 无结果

- [ ] **Step 7: 全量构建**

Run: `pnpm build`
Expected: shared → server → web 全部成功编译

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: remove @anthropic-ai/claude-agent-sdk dependency and delete obsolete files"
```

---

## Task 9: 集成验证 — 端到端冒烟测试

- [ ] **Step 1: 确认 CLI 可用**

Run: `claude --version`
Expected: 显示版本号

- [ ] **Step 2: 启动 dev server**

Run: `pnpm dev`
Expected: server 启动在 4000，web 启动在 5173

- [ ] **Step 3: 打开浏览器验证基本流程**

1. 打开 http://localhost:5173
2. 选择一个项目目录
3. 发送一条消息，确认：
   - 消息发送成功
   - 流式响应正常显示（文字逐字出现）
   - 工具审批弹窗正常弹出
   - 响应完成后状态变为 idle
4. 检查会话列表是否正常显示

- [ ] **Step 4: 验证多终端同步**

1. 打开第二个浏览器标签页
2. 连接到同一个会话
3. 确认消息实时同步到第二个标签页

- [ ] **Step 5: Commit 验证通过的状态**

```bash
git add -A
git commit -m "test: verify SDK-to-CLI migration smoke test passes"
```
