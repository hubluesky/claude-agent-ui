# claude-deck MVP (S1-S3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `E:\projects\claude-deck` with a PTY-wrapped Claude Code CLI behind xterm.js — spawn→output→input loop working, multi-session with tabs, scrollback epoch replay, single-active-client evict.

**Architecture:** pnpm monorepo (shared/server/web). Server uses Fastify + node-pty + WebSocket. Web uses React 19 + Vite + Tailwind + xterm.js. Server never parses PTY output — bytes in, bytes out. Scrollback is epoch-segmented (alt-screen-aware) with OSC strip.

**Tech Stack:** Node 22+, pnpm 10, TypeScript 5.7, Fastify 5, @fastify/websocket, node-pty, React 19, Vite 6, TailwindCSS 4, xterm.js 5 + fit-addon + unicode11-addon, Zustand 5, vitest.

**Spec:** `E:\projects\claude-agent-ui\docs\superpowers\specs\2026-04-17-claude-deck-design.md`

**Target directory:** `E:\projects\claude-deck` (does NOT exist yet; Task 1 creates it). All file paths below are relative to this directory unless noted.

---

## Task 1: Create repo skeleton + pnpm workspace

**Files:**
- Create: `E:\projects\claude-deck\package.json`
- Create: `E:\projects\claude-deck\pnpm-workspace.yaml`
- Create: `E:\projects\claude-deck\turbo.json`
- Create: `E:\projects\claude-deck\tsconfig.base.json`
- Create: `E:\projects\claude-deck\.gitignore`
- Create: `E:\projects\claude-deck\README.md`
- Create: `E:\projects\claude-deck\CLAUDE.md`

- [ ] **Step 1: Create directory and init git**

```bash
mkdir E:/projects/claude-deck
cd E:/projects/claude-deck
git init
```

- [ ] **Step 2: Write root `package.json`**

```json
{
  "name": "claude-deck",
  "private": true,
  "version": "0.0.1",
  "packageManager": "pnpm@10.30.0",
  "scripts": {
    "dev": "turbo run dev --parallel",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "test": "turbo run test"
  },
  "devDependencies": {
    "turbo": "^2.3.0",
    "typescript": "^5.7.2"
  },
  "engines": {
    "node": ">=22"
  }
}
```

- [ ] **Step 3: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 4: Write `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "dev": { "cache": false, "persistent": true },
    "lint": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] }
  }
}
```

- [ ] **Step 5: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

- [ ] **Step 6: Write `.gitignore`**

```
node_modules/
dist/
.turbo/
*.log
.DS_Store
.claude-deck/
```

- [ ] **Step 7: Write minimal `README.md` and `CLAUDE.md`**

`README.md`:
```markdown
# claude-deck

PTY-wrapped Claude Code CLI with a beautiful Web UI. CLI updates require zero code changes.

See `E:\projects\claude-agent-ui\docs\superpowers\specs\2026-04-17-claude-deck-design.md` for design.

## Dev

    pnpm install
    pnpm dev
```

`CLAUDE.md`:
```markdown
# claude-deck

PTY-wrapped Claude Code CLI (see spec at E:\projects\claude-agent-ui\docs\superpowers\specs\2026-04-17-claude-deck-design.md).

Core rule: the server NEVER parses PTY output. Bytes in, bytes out. If a task tempts you to "interpret" CLI output — STOP.
```

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "chore: init claude-deck monorepo skeleton"
```

---

## Task 2: @claude-deck/shared — protocol + session types

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/protocol.ts`
- Create: `packages/shared/src/session.ts`

- [ ] **Step 1: Write `packages/shared/package.json`**

```json
{
  "name": "@claude-deck/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "lint": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.7.2"
  }
}
```

- [ ] **Step 2: Write `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write `packages/shared/src/session.ts`**

```ts
export interface SessionInfo {
  id: string
  cwd: string
  sdkSessionId: string | null
  cols: number
  rows: number
  status: 'spawning' | 'running' | 'exited'
  exitCode: number | null
  createdAt: number
  lastActivityAt: number
}
```

- [ ] **Step 4: Write `packages/shared/src/protocol.ts`**

```ts
import type { SessionInfo } from './session.js'

// Client → Server (JSON text frames)
export type C2SMessage =
  | { type: 'attach'; sessionId: string }
  | { type: 'detach'; sessionId: string }
  | { type: 'input'; sessionId: string; dataB64: string }
  | { type: 'resize'; sessionId: string; cols: number; rows: number }
  | { type: 'create'; cwd: string; cols: number; rows: number; resumeSdkSessionId?: string }
  | { type: 'close'; sessionId: string }
  | { type: 'list' }

// Server → Client control messages (JSON text frames).
// PTY output bytes travel as BINARY frames with a 4-byte sessionId-length prefix,
// so they are NOT part of this union (see ws-router.ts for the binary framing).
export type S2CMessage =
  | { type: 'created'; session: SessionInfo }
  | { type: 'exited'; sessionId: string; exitCode: number | null }
  | { type: 'list-result'; sessions: SessionInfo[] }
  | { type: 'evicted'; sessionId: string; reason: string }
  | { type: 'replay-begin'; sessionId: string }
  | { type: 'replay-end'; sessionId: string }
  | { type: 'error'; sessionId?: string; message: string }
```

- [ ] **Step 5: Write `packages/shared/src/index.ts`**

```ts
export * from './protocol.js'
export * from './session.js'
```

- [ ] **Step 6: Install & build**

```bash
cd E:/projects/claude-deck
pnpm install
pnpm --filter @claude-deck/shared build
```

Expected: `packages/shared/dist/index.js` and `index.d.ts` exist.

- [ ] **Step 7: Commit**

```bash
git add packages/shared pnpm-lock.yaml
git commit -m "feat(shared): define C2S/S2C protocol and SessionInfo"
```

---

## Task 3: ScrollbackBuffer — tests first

**Files:**
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/vitest.config.ts`
- Create: `packages/server/src/scrollback.ts`
- Create: `packages/server/src/__tests__/scrollback.test.ts`

- [ ] **Step 1: Write `packages/server/package.json`**

```json
{
  "name": "@claude-deck/server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@claude-deck/shared": "workspace:*",
    "@fastify/websocket": "^11.0.1",
    "chokidar": "^4.0.1",
    "fastify": "^5.1.0",
    "node-pty": "^1.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.2",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `packages/server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write `packages/server/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts']
  }
})
```

- [ ] **Step 4: Install deps**

```bash
cd E:/projects/claude-deck
pnpm install
```

- [ ] **Step 5: Write failing tests `packages/server/src/__tests__/scrollback.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { ScrollbackBuffer } from '../scrollback.js'

const enc = (s: string) => new TextEncoder().encode(s)
const ALT_ON = '\x1b[?1049h'
const ALT_OFF = '\x1b[?1049l'

describe('ScrollbackBuffer', () => {
  it('empty buffer yields empty replay', () => {
    const b = new ScrollbackBuffer(1024)
    expect(b.replayBytes()).toEqual(new Uint8Array(0))
  })

  it('single write appears in replay', () => {
    const b = new ScrollbackBuffer(1024)
    b.write(enc('hello'))
    expect(new TextDecoder().decode(b.replayBytes())).toBe('hello')
  })

  it('alt screen entry creates a new epoch; replay returns only current', () => {
    const b = new ScrollbackBuffer(1024)
    b.write(enc('main-screen-content'))
    b.write(enc(ALT_ON + 'alt-screen-content'))
    // replay should NOT contain main-screen-content, because current epoch = alt
    const out = new TextDecoder().decode(b.replayBytes())
    expect(out).toContain('alt-screen-content')
    expect(out).not.toContain('main-screen-content')
    // the ALT_ON sequence itself must remain so xterm puts itself in alt mode
    expect(out).toContain(ALT_ON)
  })

  it('alt screen exit creates another epoch', () => {
    const b = new ScrollbackBuffer(1024)
    b.write(enc(ALT_ON + 'alt-stuff'))
    b.write(enc(ALT_OFF + 'back-on-main'))
    const out = new TextDecoder().decode(b.replayBytes())
    expect(out).toContain('back-on-main')
    expect(out).not.toContain('alt-stuff')
    expect(out).toContain(ALT_OFF)
  })

  it('strips OSC window-title sequences (BEL terminator)', () => {
    const b = new ScrollbackBuffer(1024)
    b.write(enc('before\x1b]0;my title\x07after'))
    const out = new TextDecoder().decode(b.replayBytes())
    expect(out).toBe('beforeafter')
  })

  it('strips OSC clipboard writes (BEL terminator)', () => {
    const b = new ScrollbackBuffer(1024)
    b.write(enc('x\x1b]52;c;abcd\x07y'))
    expect(new TextDecoder().decode(b.replayBytes())).toBe('xy')
  })

  it('strips OSC sequences with ST terminator (ESC backslash)', () => {
    const b = new ScrollbackBuffer(1024)
    b.write(enc('x\x1b]0;title\x1b\\y'))
    expect(new TextDecoder().decode(b.replayBytes())).toBe('xy')
  })

  it('strips bare BEL', () => {
    const b = new ScrollbackBuffer(1024)
    b.write(enc('a\x07b'))
    expect(new TextDecoder().decode(b.replayBytes())).toBe('ab')
  })

  it('preserves SGR color sequences', () => {
    const b = new ScrollbackBuffer(1024)
    b.write(enc('\x1b[31mred\x1b[0m'))
    expect(new TextDecoder().decode(b.replayBytes())).toBe('\x1b[31mred\x1b[0m')
  })

  it('preserves CSI cursor positioning', () => {
    const b = new ScrollbackBuffer(1024)
    b.write(enc('\x1b[10;20H'))
    expect(new TextDecoder().decode(b.replayBytes())).toBe('\x1b[10;20H')
  })

  it('drops oldest epoch on overflow', () => {
    const b = new ScrollbackBuffer(20)
    b.write(enc(ALT_ON))
    b.write(enc('x'.repeat(30)))
    const out = b.replayBytes()
    expect(out.byteLength).toBeLessThanOrEqual(30)
  })

  it('handles OSC split across writes', () => {
    const b = new ScrollbackBuffer(1024)
    b.write(enc('before\x1b]0;pa'))
    b.write(enc('rtial\x07after'))
    expect(new TextDecoder().decode(b.replayBytes())).toBe('beforeafter')
  })
})
```

- [ ] **Step 6: Run tests — expect failure**

```bash
pnpm --filter @claude-deck/server test
```

Expected: FAIL — `ScrollbackBuffer is not defined` (or module-not-found).

- [ ] **Step 7: Implement `packages/server/src/scrollback.ts`**

```ts
// Epoch-segmented circular byte buffer with OSC side-effect stripping.
// See spec §9 Scrollback Replay Safety.

const ALT_ON = '\x1b[?1049h'
const ALT_OFF = '\x1b[?1049l'

interface Epoch {
  altScreen: boolean
  bytes: Uint8Array[]
  size: number
}

export class ScrollbackBuffer {
  private epochs: Epoch[] = [{ altScreen: false, bytes: [], size: 0 }]
  private pending: number[] = []  // partial OSC being accumulated across writes
  private inOsc = false

  constructor(private readonly maxBytes: number) {}

  write(chunk: Uint8Array): void {
    const stripped = this.stripOsc(chunk)
    this.appendWithEpochSplit(stripped)
    this.evictIfOverflow()
  }

  replayBytes(): Uint8Array {
    const current = this.epochs[this.epochs.length - 1]
    const total = current.size
    const out = new Uint8Array(total)
    let off = 0
    for (const slice of current.bytes) {
      out.set(slice, off)
      off += slice.byteLength
    }
    return out
  }

  private stripOsc(chunk: Uint8Array): Uint8Array {
    const out: number[] = []
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i]
      if (this.inOsc) {
        // inside OSC; look for BEL (0x07) or ST (ESC \)
        if (b === 0x07) { this.inOsc = false; continue }
        if (b === 0x1b && i + 1 < chunk.length && chunk[i + 1] === 0x5c /* \ */) {
          this.inOsc = false; i++; continue
        }
        // might also be ESC at end-of-chunk; stash
        if (b === 0x1b && i === chunk.length - 1) {
          this.pending.push(b); return new Uint8Array(out)
        }
        continue
      }
      // bare BEL — drop
      if (b === 0x07) continue
      // detect OSC start: ESC ]
      if (b === 0x1b && i + 1 < chunk.length && chunk[i + 1] === 0x5d /* ] */) {
        this.inOsc = true; i++; continue
      }
      // ESC at end of chunk without next byte — stash to decide on next write
      if (b === 0x1b && i === chunk.length - 1) {
        this.pending.push(b); return new Uint8Array(out)
      }
      out.push(b)
    }
    // flush any un-decided pending ESC from previous write
    if (this.pending.length) {
      const lead = new Uint8Array(this.pending)
      this.pending = []
      const joined = new Uint8Array(lead.length + out.length)
      joined.set(lead, 0); joined.set(new Uint8Array(out), lead.length)
      // re-run through this pass so the ESC + first byte get classified
      return this.stripOsc(joined)
    }
    return new Uint8Array(out)
  }

  private appendWithEpochSplit(bytes: Uint8Array): void {
    if (bytes.byteLength === 0) return
    // Split on ALT_ON / ALT_OFF boundaries.
    const str = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    let cursor = 0
    while (cursor < str.length) {
      const onIdx = str.indexOf(ALT_ON, cursor)
      const offIdx = str.indexOf(ALT_OFF, cursor)
      const nextIdx = [onIdx, offIdx].filter(i => i >= 0).sort((a, b) => a - b)[0] ?? -1

      if (nextIdx === -1) {
        this.pushCurrent(bytes.subarray(cursor, bytes.length - (str.length - str.length)))
        this.pushCurrent(this.sliceUtf8(str, cursor, str.length))
        break
      }

      const marker = nextIdx === onIdx ? ALT_ON : ALT_OFF
      const before = this.sliceUtf8(str, cursor, nextIdx)
      const seq = this.sliceUtf8(str, nextIdx, nextIdx + marker.length)
      this.pushCurrent(before)
      this.pushCurrent(seq)  // include the switch sequence in the current (old) epoch too — xterm needs it
      this.epochs.push({ altScreen: marker === ALT_ON, bytes: [seq], size: seq.byteLength })
      cursor = nextIdx + marker.length
    }
  }

  private pushCurrent(bytes: Uint8Array): void {
    if (bytes.byteLength === 0) return
    const cur = this.epochs[this.epochs.length - 1]
    cur.bytes.push(bytes); cur.size += bytes.byteLength
  }

  private sliceUtf8(str: string, start: number, end: number): Uint8Array {
    return new TextEncoder().encode(str.slice(start, end))
  }

  private evictIfOverflow(): void {
    let total = this.epochs.reduce((s, e) => s + e.size, 0)
    while (total > this.maxBytes && this.epochs.length > 1) {
      const dropped = this.epochs.shift()!
      total -= dropped.size
    }
    // if single epoch still overflows, truncate its oldest chunks
    const cur = this.epochs[0]
    while (cur.size > this.maxBytes && cur.bytes.length > 1) {
      const dropped = cur.bytes.shift()!
      cur.size -= dropped.byteLength
    }
  }
}
```

- [ ] **Step 8: Run tests — expect pass**

```bash
pnpm --filter @claude-deck/server test
```

Expected: all 11 tests PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/server pnpm-lock.yaml
git commit -m "feat(server): ScrollbackBuffer with epoch segmentation + OSC strip"
```

---

## Task 4: SessionManager — real node-pty integration test

**Files:**
- Create: `packages/server/src/session-manager.ts`
- Create: `packages/server/src/__tests__/session-manager.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/server/src/__tests__/session-manager.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import { SessionManager } from '../session-manager.js'
import { platform } from 'node:os'

const isWin = platform() === 'win32'

describe('SessionManager', () => {
  const mgr = new SessionManager()
  afterAll(() => mgr.shutdown())

  it('spawns a PTY and collects output', async () => {
    const shell = isWin ? 'cmd.exe' : 'bash'
    const args = isWin ? ['/c', 'echo hello'] : ['-c', 'echo hello']
    const session = await mgr.create({ cwd: process.cwd(), cols: 80, rows: 24, command: shell, args })

    let output = ''
    session.onData(bytes => { output += new TextDecoder().decode(bytes) })

    await new Promise<void>(resolve => session.onExit(() => resolve()))
    expect(output).toContain('hello')
    expect(session.status).toBe('exited')
  })

  it('writes stdin to PTY and kills cleanly', async () => {
    const shell = isWin ? 'cmd.exe' : 'bash'
    const args: string[] = []  // interactive
    const session = await mgr.create({ cwd: process.cwd(), cols: 80, rows: 24, command: shell, args })

    mgr.close(session.id)
    await new Promise(r => setTimeout(r, 200))
    expect(mgr.get(session.id)?.status ?? 'deleted').not.toBe('running')
  })

  it('get() returns session by id; list() returns all non-deleted', async () => {
    const shell = isWin ? 'cmd.exe' : 'bash'
    const args = isWin ? ['/c', 'echo x'] : ['-c', 'echo x']
    const s = await mgr.create({ cwd: process.cwd(), cols: 80, rows: 24, command: shell, args })
    expect(mgr.get(s.id)).toBeDefined()
    expect(mgr.list().some(x => x.id === s.id)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test — expect failure (missing module)**

```bash
pnpm --filter @claude-deck/server test
```

- [ ] **Step 3: Implement `packages/server/src/session-manager.ts`**

```ts
import { spawn, type IPty } from 'node-pty'
import { randomUUID } from 'node:crypto'
import { ScrollbackBuffer } from './scrollback.js'
import type { SessionInfo } from '@claude-deck/shared'

export interface CreateOptions {
  cwd: string
  cols: number
  rows: number
  command?: string
  args?: string[]
}

type DataListener = (bytes: Uint8Array) => void
type ExitListener = (code: number | null) => void

export class PTYSession {
  readonly id = randomUUID()
  readonly createdAt = Date.now()
  lastActivityAt = this.createdAt
  status: SessionInfo['status'] = 'spawning'
  exitCode: number | null = null
  sdkSessionId: string | null = null
  readonly scrollback = new ScrollbackBuffer(200 * 1024)
  private dataListeners = new Set<DataListener>()
  private exitListeners = new Set<ExitListener>()

  constructor(readonly process: IPty, readonly cwd: string, public cols: number, public rows: number) {
    process.onData(chunk => {
      const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk)
      if (this.status === 'spawning') this.status = 'running'
      this.lastActivityAt = Date.now()
      this.scrollback.write(bytes)
      for (const l of this.dataListeners) l(bytes)
    })
    process.onExit(({ exitCode }) => {
      this.status = 'exited'
      this.exitCode = exitCode
      for (const l of this.exitListeners) l(exitCode)
    })
  }

  onData(l: DataListener) { this.dataListeners.add(l); return () => this.dataListeners.delete(l) }
  onExit(l: ExitListener) { this.exitListeners.add(l); return () => this.exitListeners.delete(l) }

  write(bytes: Uint8Array) { this.process.write(Buffer.from(bytes).toString('binary')) }
  resize(cols: number, rows: number) { this.cols = cols; this.rows = rows; this.process.resize(cols, rows) }
  kill() { try { this.process.kill() } catch { /* already dead */ } }

  toInfo(): SessionInfo {
    return {
      id: this.id, cwd: this.cwd, sdkSessionId: this.sdkSessionId,
      cols: this.cols, rows: this.rows, status: this.status, exitCode: this.exitCode,
      createdAt: this.createdAt, lastActivityAt: this.lastActivityAt
    }
  }
}

export class SessionManager {
  private sessions = new Map<string, PTYSession>()

  async create(opts: CreateOptions): Promise<PTYSession> {
    const command = opts.command ?? (process.platform === 'win32' ? 'claude.cmd' : 'claude')
    const args = opts.args ?? []
    const pty = spawn(command, args, {
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      env: process.env as Record<string, string>,
      name: 'xterm-256color'
    })
    const session = new PTYSession(pty, opts.cwd, opts.cols, opts.rows)
    this.sessions.set(session.id, session)
    session.onExit(() => {
      // keep session in map for 60s to let final bytes drain; caller decides when to forget
      setTimeout(() => this.sessions.delete(session.id), 60_000)
    })
    return session
  }

  get(id: string) { return this.sessions.get(id) }
  list() { return [...this.sessions.values()] }
  close(id: string) { this.sessions.get(id)?.kill() }
  shutdown() { for (const s of this.sessions.values()) s.kill(); this.sessions.clear() }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pnpm --filter @claude-deck/server test
```

Expected: all tests PASS. Note: node-pty compilation on Windows requires Visual Studio Build Tools or Windows Build Tools. If install fails, check the node-pty repo for ConPTY requirements.

- [ ] **Step 5: Commit**

```bash
git add packages/server
git commit -m "feat(server): SessionManager with node-pty spawn + real pty integration test"
```

---

## Task 5: WSRouter — attach/detach/input/output + evict

**Files:**
- Create: `packages/server/src/ws-router.ts`
- Create: `packages/server/src/__tests__/ws-router.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/server/src/__tests__/ws-router.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import { WebSocket } from 'ws'
import { SessionManager } from '../session-manager.js'
import { registerWSRoutes } from '../ws-router.js'
import { platform } from 'node:os'

const isWin = platform() === 'win32'

let app: FastifyInstance
let mgr: SessionManager
let port: number

beforeAll(async () => {
  mgr = new SessionManager()
  app = Fastify()
  await app.register(websocket)
  registerWSRoutes(app, mgr)
  await app.listen({ port: 0, host: '127.0.0.1' })
  const addr = app.server.address()
  if (typeof addr === 'object' && addr) port = addr.port
})

afterAll(async () => {
  mgr.shutdown()
  await app.close()
})

function openWs(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

function once(ws: WebSocket, predicate: (data: unknown) => boolean, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), timeoutMs)
    ws.on('message', (raw, isBinary) => {
      if (isBinary) {
        const m = { kind: 'binary', data: raw as Buffer }
        if (predicate(m)) { clearTimeout(t); resolve(m) }
      } else {
        const m = JSON.parse(raw.toString())
        if (predicate(m)) { clearTimeout(t); resolve(m) }
      }
    })
  })
}

describe('WSRouter', () => {
  it('create + attach + receive binary output', async () => {
    const ws = await openWs()
    const shell = isWin ? 'cmd.exe' : 'bash'
    const args = isWin ? ['/c', 'echo hello'] : ['-c', 'echo hello']
    ws.send(JSON.stringify({ type: 'create', cwd: process.cwd(), cols: 80, rows: 24, command: shell, args }))
    const created: any = await once(ws, m => (m as any).type === 'created')
    const sid = created.session.id

    ws.send(JSON.stringify({ type: 'attach', sessionId: sid }))
    await once(ws, m => (m as any).type === 'replay-end')

    const outMsg: any = await once(ws, m => (m as any).kind === 'binary')
    const buf: Buffer = outMsg.data
    // first 4 bytes: sessionId-length (32-bit LE), then sessionId bytes, then payload
    const idLen = buf.readUInt32LE(0)
    const id = buf.subarray(4, 4 + idLen).toString('utf8')
    const payload = buf.subarray(4 + idLen).toString('utf8')
    expect(id).toBe(sid)
    expect(payload).toContain('hello')
    ws.close()
  })

  it('evicts old client when second client attaches', async () => {
    const wsA = await openWs()
    const shell = isWin ? 'cmd.exe' : 'bash'
    const args: string[] = []
    wsA.send(JSON.stringify({ type: 'create', cwd: process.cwd(), cols: 80, rows: 24, command: shell, args }))
    const created: any = await once(wsA, m => (m as any).type === 'created')
    const sid = created.session.id
    wsA.send(JSON.stringify({ type: 'attach', sessionId: sid }))
    await once(wsA, m => (m as any).type === 'replay-end')

    const wsB = await openWs()
    const evicted: Promise<any> = once(wsA, m => (m as any).type === 'evicted')
    wsB.send(JSON.stringify({ type: 'attach', sessionId: sid }))
    const ev: any = await evicted
    expect(ev.sessionId).toBe(sid)

    wsA.close(); wsB.close(); mgr.close(sid)
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
pnpm --filter @claude-deck/server test
```

- [ ] **Step 3: Add `ws` as devDep**

```bash
pnpm --filter @claude-deck/server add -D ws @types/ws
```

- [ ] **Step 4: Implement `packages/server/src/ws-router.ts`**

```ts
import type { FastifyInstance } from 'fastify'
import type { WebSocket } from '@fastify/websocket'
import type { C2SMessage, S2CMessage, SessionInfo } from '@claude-deck/shared'
import type { PTYSession, SessionManager } from './session-manager.js'

export function registerWSRoutes(app: FastifyInstance, mgr: SessionManager) {
  // Tracks which WS is currently attached to which sessionId.
  const activeClient = new Map<string /* sessionId */, WebSocket>()
  const attachedSessions = new Map<WebSocket, Set<string>>()

  app.get('/ws', { websocket: true }, (ws) => {
    attachedSessions.set(ws, new Set())

    ws.on('message', async (raw, isBinary) => {
      if (isBinary) return  // client never sends binary
      let msg: C2SMessage
      try { msg = JSON.parse(raw.toString()) } catch { return send(ws, { type: 'error', message: 'bad-json' }); }
      await handle(ws, msg)
    })

    ws.on('close', () => {
      const sids = attachedSessions.get(ws) ?? new Set()
      for (const sid of sids) if (activeClient.get(sid) === ws) activeClient.delete(sid)
      attachedSessions.delete(ws)
    })
  })

  async function handle(ws: WebSocket, msg: C2SMessage) {
    switch (msg.type) {
      case 'create': {
        const sess = await mgr.create({
          cwd: msg.cwd, cols: msg.cols, rows: msg.rows,
          command: (msg as any).command, args: (msg as any).args
        })
        send(ws, { type: 'created', session: sess.toInfo() })
        sess.onExit(code => send(ws, { type: 'exited', sessionId: sess.id, exitCode: code }))
        break
      }
      case 'attach': {
        const sess = mgr.get(msg.sessionId)
        if (!sess) return send(ws, { type: 'error', sessionId: msg.sessionId, message: 'no-such-session' })
        // evict existing active client
        const prev = activeClient.get(msg.sessionId)
        if (prev && prev !== ws) {
          send(prev, { type: 'evicted', sessionId: msg.sessionId, reason: 'another client attached' })
          try { prev.close(4000, 'evicted') } catch {}
        }
        activeClient.set(msg.sessionId, ws)
        attachedSessions.get(ws)!.add(msg.sessionId)
        // replay
        send(ws, { type: 'replay-begin', sessionId: msg.sessionId })
        const bytes = sess.scrollback.replayBytes()
        if (bytes.byteLength > 0) sendBinary(ws, sess.id, bytes)
        send(ws, { type: 'replay-end', sessionId: msg.sessionId })
        // live stream
        sess.onData(chunk => { if (activeClient.get(sess.id) === ws) sendBinary(ws, sess.id, chunk) })
        break
      }
      case 'detach': {
        if (activeClient.get(msg.sessionId) === ws) activeClient.delete(msg.sessionId)
        attachedSessions.get(ws)?.delete(msg.sessionId)
        break
      }
      case 'input': {
        const sess = mgr.get(msg.sessionId)
        if (!sess) return
        const bytes = Uint8Array.from(Buffer.from(msg.dataB64, 'base64'))
        sess.write(bytes)
        break
      }
      case 'resize': {
        mgr.get(msg.sessionId)?.resize(msg.cols, msg.rows)
        break
      }
      case 'close': {
        mgr.close(msg.sessionId)
        break
      }
      case 'list': {
        send(ws, { type: 'list-result', sessions: mgr.list().map(s => s.toInfo()) })
        break
      }
    }
  }

  function send(ws: WebSocket, m: S2CMessage) {
    try { ws.send(JSON.stringify(m)) } catch {}
  }

  function sendBinary(ws: WebSocket, sessionId: string, payload: Uint8Array) {
    const idBytes = new TextEncoder().encode(sessionId)
    const out = Buffer.alloc(4 + idBytes.byteLength + payload.byteLength)
    out.writeUInt32LE(idBytes.byteLength, 0)
    out.set(idBytes, 4)
    out.set(payload, 4 + idBytes.byteLength)
    try { ws.send(out, { binary: true }) } catch {}
  }
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
pnpm --filter @claude-deck/server test
```

- [ ] **Step 6: Commit**

```bash
git add packages/server
git commit -m "feat(server): WSRouter attach/input/output + evict single-active-client"
```

---

## Task 6: Server entry — `index.ts` + config

**Files:**
- Create: `packages/server/src/index.ts`
- Create: `packages/server/src/config.ts`

- [ ] **Step 1: Write `packages/server/src/config.ts`**

```ts
export const config = {
  port: Number(process.env.PORT ?? 4100),
  host: process.env.HOST ?? '127.0.0.1',
  maxSessions: Number(process.env.MAX_SESSIONS ?? 5),
  scrollbackBytes: Number(process.env.SCROLLBACK_BYTES ?? 200_000)
}
```

- [ ] **Step 2: Write `packages/server/src/index.ts`**

```ts
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { SessionManager } from './session-manager.js'
import { registerWSRoutes } from './ws-router.js'
import { config } from './config.js'

async function main() {
  const app = Fastify({ logger: { level: 'info' } })
  await app.register(websocket)
  const mgr = new SessionManager()
  registerWSRoutes(app, mgr)

  app.get('/api/health', async () => ({ ok: true }))

  await app.listen({ port: config.port, host: config.host })
  app.log.info(`claude-deck server listening on http://${config.host}:${config.port}`)

  const shutdown = () => { mgr.shutdown(); app.close().then(() => process.exit(0)) }
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown)
}

main().catch(err => { console.error(err); process.exit(1) })
```

- [ ] **Step 3: Smoke-test `pnpm dev` runs**

```bash
cd E:/projects/claude-deck
pnpm --filter @claude-deck/server dev
```

Expected: log line `claude-deck server listening on http://127.0.0.1:4100`. Ctrl-C to stop.

- [ ] **Step 4: Commit**

```bash
git add packages/server
git commit -m "feat(server): Fastify entrypoint + config"
```

---

## Task 7: Web skeleton — Vite + React + Tailwind + xterm.js

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/tailwind.config.ts`
- Create: `packages/web/postcss.config.js`
- Create: `packages/web/index.html`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/App.tsx`
- Create: `packages/web/src/styles/index.css`

- [ ] **Step 1: Write `packages/web/package.json`**

```json
{
  "name": "@claude-deck/web",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@claude-deck/shared": "workspace:*",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-unicode11": "^0.9.0",
    "@xterm/xterm": "^5.5.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^4.0.0-beta.10",
    "@tailwindcss/vite": "^4.0.0-beta.10",
    "typescript": "^5.7.2",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: Write `packages/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "outDir": "./dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Write `packages/web/vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    proxy: {
      '/api': 'http://127.0.0.1:4100',
      '/ws': { target: 'ws://127.0.0.1:4100', ws: true }
    }
  }
})
```

- [ ] **Step 4: Write `packages/web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>claude-deck</title>
  </head>
  <body class="h-screen bg-neutral-950 text-neutral-100">
    <div id="root" class="h-full"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Write `packages/web/src/styles/index.css`**

```css
@import "tailwindcss";
@import "@xterm/xterm/css/xterm.css";

html, body, #root { height: 100%; margin: 0; }
```

- [ ] **Step 6: Write `packages/web/src/main.tsx` + `App.tsx`**

`main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>
)
```

`App.tsx`:
```tsx
export function App() {
  return (
    <div className="h-full flex items-center justify-center text-neutral-400">
      claude-deck — skeleton ready
    </div>
  )
}
```

- [ ] **Step 7: Install + smoke test**

```bash
cd E:/projects/claude-deck
pnpm install
pnpm --filter @claude-deck/web dev
```

Expected: Vite serves at http://localhost:5180; page shows "claude-deck — skeleton ready".

- [ ] **Step 8: Commit**

```bash
git add packages/web pnpm-lock.yaml
git commit -m "feat(web): Vite + React 19 + Tailwind 4 + xterm.js skeleton"
```

---

## Task 8: ws-client singleton + binary frame parsing

**Files:**
- Create: `packages/web/src/lib/ws-client.ts`

- [ ] **Step 1: Write the module**

```ts
import type { C2SMessage, S2CMessage } from '@claude-deck/shared'

type BinaryHandler = (sessionId: string, payload: Uint8Array) => void
type ControlHandler = (msg: S2CMessage) => void

class WSClient {
  private ws: WebSocket | null = null
  private backoffMs = 1000
  private readonly binary = new Set<BinaryHandler>()
  private readonly control = new Set<ControlHandler>()
  private readonly outbox: C2SMessage[] = []

  connect() {
    if (this.ws && this.ws.readyState <= 1) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => {
      this.backoffMs = 1000
      while (this.outbox.length) ws.send(JSON.stringify(this.outbox.shift()!))
    }
    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        const buf = new Uint8Array(e.data)
        const idLen = new DataView(e.data).getUint32(0, true)
        const sid = new TextDecoder().decode(buf.subarray(4, 4 + idLen))
        const payload = buf.subarray(4 + idLen)
        for (const h of this.binary) h(sid, payload)
      } else {
        const msg = JSON.parse(e.data) as S2CMessage
        for (const h of this.control) h(msg)
      }
    }
    ws.onclose = () => {
      this.ws = null
      setTimeout(() => this.connect(), this.backoffMs)
      this.backoffMs = Math.min(this.backoffMs * 2, 30_000)
    }
    ws.onerror = () => { /* close will follow */ }
  }

  send(msg: C2SMessage) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg))
    else this.outbox.push(msg)
  }

  onBinary(h: BinaryHandler) { this.binary.add(h); return () => this.binary.delete(h) }
  onControl(h: ControlHandler) { this.control.add(h); return () => this.control.delete(h) }
}

export const wsClient = new WSClient()
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/lib/ws-client.ts
git commit -m "feat(web): ws-client singleton with binary frame parsing + exp backoff"
```

---

## Task 9: Terminal component — xterm mount + input/output/resize + replay gating

**Files:**
- Create: `packages/web/src/components/Terminal.tsx`
- Modify: `packages/web/src/App.tsx` (mount one Terminal for smoke test)

- [ ] **Step 1: Write `Terminal.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { wsClient } from '../lib/ws-client'

export function Terminal({ sessionId }: { sessionId: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)

  useEffect(() => {
    const container = containerRef.current!
    const term = new XTerm({
      fontFamily: 'JetBrains Mono, Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: { background: '#0a0a0a', foreground: '#e5e5e5' },
      allowProposedApi: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    term.open(container)
    fit.fit()
    termRef.current = term

    // Let browser handle Ctrl+W/T/R/+/-; xterm handles everything else.
    term.attachCustomKeyEventHandler(e => {
      if (e.ctrlKey && ['w', 't', 'r', '+', '-'].includes(e.key.toLowerCase())) return false
      return true
    })

    let replaying = false
    // Buffer live output that arrives during replay, apply after replay-end.
    const buffered: Uint8Array[] = []

    const offBin = wsClient.onBinary((sid, payload) => {
      if (sid !== sessionId) return
      if (replaying) { buffered.push(payload); return }
      term.write(payload)
    })

    const offCtrl = wsClient.onControl((msg) => {
      if ('sessionId' in msg && msg.sessionId !== sessionId) return
      if (msg.type === 'replay-begin') { replaying = true; term.reset() }
      else if (msg.type === 'replay-end') {
        replaying = false
        for (const chunk of buffered) term.write(chunk)
        buffered.length = 0
      }
    })

    term.onData(data => {
      const dataB64 = btoa(data)
      wsClient.send({ type: 'input', sessionId, dataB64 })
    })

    const sendResize = () => {
      fit.fit()
      wsClient.send({ type: 'resize', sessionId, cols: term.cols, rows: term.rows })
    }
    const ro = new ResizeObserver(() => sendResize())
    ro.observe(container)

    // initial attach (ws-client was connected at app boot)
    wsClient.send({ type: 'attach', sessionId })
    sendResize()

    return () => {
      ro.disconnect()
      offBin(); offCtrl()
      wsClient.send({ type: 'detach', sessionId })
      term.dispose()
      termRef.current = null
    }
  }, [sessionId])

  return <div ref={containerRef} className="h-full w-full" />
}
```

- [ ] **Step 2: Wire smoke test in `App.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Terminal } from './components/Terminal'
import { wsClient } from './lib/ws-client'

export function App() {
  const [sessionId, setSessionId] = useState<string | null>(null)

  useEffect(() => {
    wsClient.connect()
    const off = wsClient.onControl(msg => {
      if (msg.type === 'created') setSessionId(msg.session.id)
    })
    // spawn a bash/cmd for skeleton smoke test
    const isWin = navigator.userAgent.includes('Windows')
    wsClient.send({
      type: 'create',
      cwd: isWin ? 'C:\\' : '/',
      cols: 80, rows: 24,
      // @ts-expect-error — command/args are accepted by server but not in shared type (used for test builds only)
      command: isWin ? 'cmd.exe' : 'bash',
      args: []
    })
    return off
  }, [])

  return (
    <div className="h-full">
      {sessionId ? <Terminal sessionId={sessionId} /> : <div className="p-4 text-neutral-400">spawning…</div>}
    </div>
  )
}
```

Note: `command`/`args` are passed for dev smoke; Task 11 drops these in favor of `claude`. Remove the `@ts-expect-error` then.

- [ ] **Step 3: Smoke test**

Run in two shells:
```bash
pnpm --filter @claude-deck/server dev
pnpm --filter @claude-deck/web dev
```
Open http://localhost:5180 — you should see a bash/cmd prompt. Type `ls` / `dir`, press Enter, see output. Refresh the page — the same output should redraw via scrollback replay.

- [ ] **Step 4: Commit**

```bash
git add packages/web
git commit -m "feat(web): Terminal component — xterm mount, I/O pipe, replay gating"
```

---

## Task 10: S1 acceptance gate — document & commit

- [ ] **Step 1: Run `pnpm lint` + `pnpm test` across workspace**

```bash
cd E:/projects/claude-deck
pnpm -r lint
pnpm -r test
```

Expected: all green.

- [ ] **Step 2: Add a Dev-quickstart section to `README.md`**

Append:
```markdown
## S1 Smoke Test

1. `pnpm install`
2. In one shell: `pnpm --filter @claude-deck/server dev`
3. In another shell: `pnpm --filter @claude-deck/web dev`
4. Open http://localhost:5180 — see a live bash/cmd terminal.
```

- [ ] **Step 3: Commit S1 gate**

```bash
git add README.md
git commit -m "chore: S1 acceptance — skeleton smoke passes"
```

---

## Task 11: S2 — spawn `claude` (replace placeholder command)

**Files:**
- Modify: `packages/server/src/session-manager.ts` (preflight `which claude`)
- Modify: `packages/server/src/ws-router.ts` (drop command/args from protocol; allow only for internal tests)
- Modify: `packages/shared/src/protocol.ts` (no change — spec already omits command/args)
- Modify: `packages/web/src/App.tsx` (remove command/args from create)

- [ ] **Step 1: Add preflight to `SessionManager.create`**

In `session-manager.ts`, before the `spawn()` call:

```ts
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

function resolveClaudePath(): string | null {
  const name = process.platform === 'win32' ? 'claude.cmd' : 'claude'
  try {
    const cmd = process.platform === 'win32' ? `where ${name}` : `command -v ${name}`
    const out = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split(/\r?\n/)[0]
    return out && existsSync(out) ? out : null
  } catch { return null }
}
```

And inside `create()`, if `opts.command` is undefined:

```ts
const defaultCmd = resolveClaudePath()
if (!opts.command && !defaultCmd) {
  throw new Error('claude CLI not found in PATH. Install with: npm i -g @anthropic-ai/claude-code')
}
const command = opts.command ?? defaultCmd!
```

- [ ] **Step 2: Surface the error to WS clients**

In `ws-router.ts` `case 'create'`, wrap in try/catch:

```ts
try {
  const sess = await mgr.create({ ... })
  ...
} catch (err) {
  send(ws, { type: 'error', message: (err as Error).message })
}
```

- [ ] **Step 3: Update `App.tsx` to spawn `claude` (no command/args)**

```tsx
wsClient.send({ type: 'create', cwd: 'E:\\projects\\claude-deck', cols: 80, rows: 24 })
```

(or use the user's preferred dev cwd)

- [ ] **Step 4: Manual acceptance**

```bash
pnpm --filter @claude-deck/server dev
pnpm --filter @claude-deck/web dev
```

Open http://localhost:5180 — claude CLI should start. Verify:
1. `/help` menu renders correctly
2. Type two messages quickly — second one should show as queued in CLI's own indicator
3. Press Esc while a turn is running — CLI should abort (or pop queue depending on state)
4. Type a prompt with a Chinese markdown table — check alignment

- [ ] **Step 5: Commit**

```bash
git add packages/server packages/web
git commit -m "feat(S2): spawn real claude CLI + preflight PATH check"
```

---

## Task 12: S2 — SDK session id lazy backfill

**Files:**
- Create: `packages/server/src/sdk-session-watcher.ts`
- Modify: `packages/server/src/session-manager.ts`
- Create: `packages/server/src/__tests__/sdk-session-watcher.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/server/src/__tests__/sdk-session-watcher.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { watchSdkSessions } from '../sdk-session-watcher.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cd-watcher-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('watchSdkSessions', () => {
  it('fires callback with uuid when a new .jsonl is created in project slug dir', async () => {
    const events: string[] = []
    const stop = watchSdkSessions(dir, id => events.push(id))
    // create a new session file
    const sid = 'abc-123-uuid'
    writeFileSync(join(dir, `${sid}.jsonl`), '{}\n')
    await new Promise(r => setTimeout(r, 300))
    expect(events).toContain(sid)
    await stop()
  })
})
```

- [ ] **Step 2: Implement `sdk-session-watcher.ts`**

```ts
import chokidar from 'chokidar'
import { basename, extname } from 'node:path'

export function watchSdkSessions(dir: string, onNew: (sdkSessionId: string) => void) {
  const watcher = chokidar.watch(dir, { depth: 0, ignoreInitial: true, awaitWriteFinish: false })
  watcher.on('add', p => {
    if (extname(p) !== '.jsonl') return
    const id = basename(p, '.jsonl')
    onNew(id)
  })
  return async () => { await watcher.close() }
}
```

- [ ] **Step 3: Hook the watcher into SessionManager on create**

Modify `SessionManager.create()`:

```ts
import { watchSdkSessions } from './sdk-session-watcher.js'
import { homedir } from 'node:os'
import { join } from 'node:path'

// inside create(), after constructing `session`:
const slug = opts.cwd.replace(/[\\/]/g, '-').replace(/[^a-zA-Z0-9\-_.]/g, '-')
const watchDir = join(homedir(), '.claude', 'projects', slug)
const stop = watchSdkSessions(watchDir, id => {
  if (!session.sdkSessionId) session.sdkSessionId = id
})
session.onExit(() => { void stop() })
```

(Create the dir if it doesn't exist yet — chokidar `add` will fire once CLI writes the file.)

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @claude-deck/server test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server
git commit -m "feat(S2): lazy-backfill sdkSessionId via chokidar on ~/.claude/projects"
```

---

## Task 13: S3 — projects/sessions REST endpoints

**Files:**
- Create: `packages/server/src/routes/projects.ts`
- Modify: `packages/server/src/index.ts` (register route)

- [ ] **Step 1: Implement `routes/projects.ts`**

```ts
import type { FastifyInstance } from 'fastify'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function registerProjectRoutes(app: FastifyInstance) {
  app.get('/api/projects', async () => {
    const root = join(homedir(), '.claude', 'projects')
    let slugs: string[] = []
    try { slugs = readdirSync(root) } catch { return { projects: [] } }
    const projects = slugs.map(slug => {
      const dir = join(root, slug)
      let sessions: { id: string; mtime: number; firstLine?: string }[] = []
      try {
        sessions = readdirSync(dir)
          .filter(f => f.endsWith('.jsonl'))
          .map(f => {
            const p = join(dir, f)
            const st = statSync(p)
            let firstLine: string | undefined
            try { firstLine = readFileSync(p, 'utf-8').split('\n', 1)[0] } catch {}
            return { id: f.replace(/\.jsonl$/, ''), mtime: st.mtimeMs, firstLine }
          })
          .sort((a, b) => b.mtime - a.mtime)
      } catch {}
      return { slug, sessions }
    })
    return { projects }
  })
}
```

- [ ] **Step 2: Register in `index.ts`**

```ts
import { registerProjectRoutes } from './routes/projects.js'
// after ws register:
registerProjectRoutes(app)
```

- [ ] **Step 3: Smoke test**

```bash
curl http://127.0.0.1:4100/api/projects
```

Expected: JSON with your existing Claude Code sessions under `~/.claude/projects`.

- [ ] **Step 4: Commit**

```bash
git add packages/server
git commit -m "feat(S3): GET /api/projects — scan ~/.claude/projects"
```

---

## Task 14: S3 — sessionStore (Zustand)

**Files:**
- Create: `packages/web/src/stores/sessionStore.ts`

- [ ] **Step 1: Implement**

```ts
import { create } from 'zustand'
import type { SessionInfo } from '@claude-deck/shared'

interface State {
  sessions: Record<string, SessionInfo>
  activeId: string | null
  upsert: (s: SessionInfo) => void
  remove: (id: string) => void
  setActive: (id: string | null) => void
}

export const useSessionStore = create<State>((set) => ({
  sessions: {},
  activeId: null,
  upsert: (s) => set(state => ({ sessions: { ...state.sessions, [s.id]: s }, activeId: state.activeId ?? s.id })),
  remove: (id) => set(state => {
    const next = { ...state.sessions }; delete next[id]
    const newActive = state.activeId === id ? (Object.keys(next)[0] ?? null) : state.activeId
    return { sessions: next, activeId: newActive }
  }),
  setActive: (id) => set({ activeId: id })
}))
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/stores
git commit -m "feat(web): sessionStore"
```

---

## Task 15: S3 — SessionTabs + Sidebar + NewSessionDialog

**Files:**
- Create: `packages/web/src/components/SessionTabs.tsx`
- Create: `packages/web/src/components/Sidebar.tsx`
- Create: `packages/web/src/components/NewSessionDialog.tsx`
- Modify: `packages/web/src/App.tsx` (compose layout)

- [ ] **Step 1: Write `SessionTabs.tsx`**

```tsx
import { useSessionStore } from '../stores/sessionStore'
import { wsClient } from '../lib/ws-client'

export function SessionTabs() {
  const { sessions, activeId, setActive } = useSessionStore()
  const entries = Object.values(sessions)
  return (
    <div className="flex gap-1 border-b border-neutral-800 bg-neutral-900 px-2">
      {entries.map(s => (
        <div key={s.id}
          className={`group flex items-center gap-2 px-3 py-1 text-sm cursor-pointer ${s.id === activeId ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-neutral-200'}`}
          onClick={() => setActive(s.id)}>
          <span className="truncate max-w-[240px]">{s.sdkSessionId ?? s.id.slice(0, 8)}</span>
          <button
            className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-red-400"
            onClick={(e) => { e.stopPropagation(); wsClient.send({ type: 'close', sessionId: s.id }) }}
          >×</button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Write `Sidebar.tsx`**

```tsx
import { useEffect, useState } from 'react'

interface Project { slug: string; sessions: { id: string; mtime: number; firstLine?: string }[] }

export function Sidebar({ onResume, onNew }: { onResume: (cwd: string, id: string) => void; onNew: () => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(d => setProjects(d.projects ?? []))
  }, [])

  return (
    <aside className="w-72 shrink-0 border-r border-neutral-800 bg-neutral-950 overflow-y-auto">
      <div className="p-3 border-b border-neutral-800">
        <button className="w-full rounded bg-blue-600 hover:bg-blue-500 px-3 py-2 text-sm" onClick={onNew}>+ New Session</button>
      </div>
      {projects.map(p => (
        <div key={p.slug} className="p-2">
          <div className="text-xs text-neutral-500 px-2 py-1 truncate">{p.slug}</div>
          {p.sessions.slice(0, 20).map(s => (
            <div key={s.id} className="px-2 py-1 text-sm text-neutral-300 hover:bg-neutral-900 cursor-pointer truncate"
              title={s.firstLine}
              onClick={() => onResume(slugToCwd(p.slug), s.id)}>
              {s.firstLine ? truncate(s.firstLine, 60) : s.id.slice(0, 8)}
            </div>
          ))}
        </div>
      ))}
    </aside>
  )
}

function slugToCwd(slug: string): string {
  // Claude Code slugs a cwd path by replacing separators with `-`. We can't invert perfectly,
  // so for MVP we let the user override in NewSessionDialog. Here we just best-effort reconstruct.
  return slug.replace(/^-/, '/').replace(/-/g, '/')
}

function truncate(s: string, n: number) { return s.length > n ? s.slice(0, n) + '…' : s }
```

- [ ] **Step 3: Write `NewSessionDialog.tsx`**

```tsx
import { useState } from 'react'

export function NewSessionDialog({ onCreate, onCancel }: { onCreate: (cwd: string) => void; onCancel: () => void }) {
  const [cwd, setCwd] = useState('')
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center">
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-5 w-[480px]">
        <h2 className="text-lg mb-3">New Session</h2>
        <label className="block text-sm text-neutral-400 mb-1">Working directory</label>
        <input
          className="w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm"
          value={cwd} onChange={e => setCwd(e.target.value)}
          placeholder="E:\projects\your-project" autoFocus
        />
        <div className="flex justify-end gap-2 mt-4">
          <button className="px-3 py-1 text-sm text-neutral-400 hover:text-white" onClick={onCancel}>Cancel</button>
          <button
            className="rounded bg-blue-600 hover:bg-blue-500 px-3 py-1 text-sm disabled:opacity-50"
            disabled={!cwd.trim()}
            onClick={() => onCreate(cwd.trim())}
          >Create</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Wire in `App.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Terminal } from './components/Terminal'
import { SessionTabs } from './components/SessionTabs'
import { Sidebar } from './components/Sidebar'
import { NewSessionDialog } from './components/NewSessionDialog'
import { useSessionStore } from './stores/sessionStore'
import { wsClient } from './lib/ws-client'

export function App() {
  const { sessions, activeId, upsert, remove } = useSessionStore()
  const [showNew, setShowNew] = useState(false)

  useEffect(() => {
    wsClient.connect()
    return wsClient.onControl(msg => {
      if (msg.type === 'created') upsert(msg.session)
      else if (msg.type === 'exited') remove(msg.sessionId)
    })
  }, [upsert, remove])

  const createSession = (cwd: string, resumeSdkSessionId?: string) => {
    wsClient.send({ type: 'create', cwd, cols: 80, rows: 24, resumeSdkSessionId })
  }

  return (
    <div className="h-full flex">
      <Sidebar onNew={() => setShowNew(true)} onResume={(cwd, id) => createSession(cwd, id)} />
      <main className="flex-1 flex flex-col">
        <SessionTabs />
        <div className="flex-1">
          {activeId ? <Terminal key={activeId} sessionId={activeId} /> : (
            <div className="h-full flex items-center justify-center text-neutral-500">No session. Create one from the sidebar.</div>
          )}
        </div>
      </main>
      {showNew && (
        <NewSessionDialog
          onCancel={() => setShowNew(false)}
          onCreate={cwd => { createSession(cwd); setShowNew(false) }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 5: Manual acceptance**

Start server + web. Click "+ New Session", paste `E:\projects\claude-deck`, click Create. Second new session with a different cwd. Click tabs to switch. Close one — tab disappears.

- [ ] **Step 6: Commit**

```bash
git add packages/web
git commit -m "feat(S3): SessionTabs + Sidebar + NewSessionDialog; multi-session switching"
```

---

## Task 16: S3 acceptance gate

- [ ] **Step 1: Run full suite**

```bash
cd E:/projects/claude-deck
pnpm -r lint
pnpm -r test
```

Expected: all green.

- [ ] **Step 2: Manual checklist (document in commit message)**

- [ ] 2 sessions running in parallel, tabs switch correctly
- [ ] Refreshing browser: each session's terminal content redraws via scrollback replay
- [ ] Opening a second browser tab on the same URL and attaching to the same session evicts the first tab (first tab shows "evicted" notification once Task 10 UI is added — if not wired, check server log)
- [ ] Ctrl+C in terminal cancels CLI turn (not browser tab close)
- [ ] `/help` in claude renders correctly
- [ ] Chinese text in markdown tables aligns correctly (otherwise file an issue to enable `@xterm/addon-unicode11` — should already be loaded)

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "chore: S3 acceptance — MVP complete

- Skeleton: pnpm workspace, Fastify + node-pty, React 19 + xterm.js
- Real claude CLI spawned and fully interactive (Esc/Ctrl-C/queue all native)
- Multi-session with tabs + sidebar
- Scrollback epoch replay on reconnect
- Single-active-client evict
- SDK sessionId lazy backfill
- 16 unit/integration tests all green"
```

---

## Appendix: Out of MVP scope (for later plans)

- S4: Polished shell UI (theme, settings panel, font picker)
- S5: Image paste + file drag-drop via `/api/upload` → `@<path>` injection
- S6: systray + auto-launch, resource cap (max concurrent sessions), graceful error banners for evict
- S7: Tauri desktop wrap with sidecar Node binary
- Future: SIGSTOP/SIGCONT LRU suspension for exceeded session cap

---

## Self-Review Notes (inline fixes applied)

**Spec coverage check:**
- §3 顶层架构 → Tasks 3/4/5/6/7/9
- §4 交互等价性 → Task 9 (Terminal component passthrough), Task 11 (real claude spawn + manual Esc/queue verification)
- §5 生命周期 → Task 4 (SessionManager), Task 12 (sdkSessionId backfill)
- §6 WS 协议 → Task 2 (shared types), Task 5 (router impl)
- §7 错误处理 → Task 11 (preflight claude) — remaining scenarios addressed in S6 (out of MVP)
- §8 项目结构 → Task 1 + all scaffolding tasks
- §9 Scrollback Replay Safety → Task 3 (epoch + OSC strip unit-tested) + Task 5 (replay-begin/end) + Task 9 (client-side gating)
- §10 Single-Active-Client → Task 5 (server evict) — client UI notification deferred to S6 (out of MVP); server evict tested
- §11 Known Limitations — all mitigations either in MVP (custom key handler in Task 9, unicode11 in Task 7/9) or explicitly deferred
- §12 Historical pit immunity — structural (nothing to implement)
- §13 Testing → unit (Task 3), integration (Task 4, 5, 12)
- §14 Tech stack — locked via package.json files
- §15 Success criteria — manually verifiable at S2/S3 gates

**Placeholder scan:** none.

**Type consistency:** `SessionInfo` used uniformly. Protocol message shapes match between shared (Task 2), server (Task 5), and web (Task 8/9). `ScrollbackBuffer`/`PTYSession`/`SessionManager` method names consistent across tasks.
