# Task 3: Server Fastify + WS Foundation

**Files:**
- Modify: `packages/server/src/index.ts`
- Create: `packages/server/src/config.ts`
- Create: `packages/server/src/ws/hub.ts`
- Create: `packages/server/src/ws/handler.ts`
- Create: `packages/server/src/routes/health.ts`
- Create: `packages/server/src/db/schema.ts`
- Create: `packages/server/src/db/index.ts`

---

- [ ] **Step 1: Create config.ts**

```typescript
// packages/server/src/config.ts
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
```

- [ ] **Step 2: Create db/schema.ts and db/index.ts**

```typescript
// packages/server/src/db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const userSettings = sqliteTable('user_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const uiState = sqliteTable('ui_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})
```

```typescript
// packages/server/src/db/index.ts
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
```

- [ ] **Step 3: Create ws/hub.ts**

```typescript
// packages/server/src/ws/hub.ts
import { WebSocket } from 'ws'
import type { S2CMessage } from '@claude-agent-ui/shared'
import { randomUUID } from 'crypto'

export interface ClientInfo {
  ws: WebSocket
  connectionId: string
  sessionId: string | null
  joinedAt: number
}

export class WSHub {
  private clients = new Map<string, ClientInfo>()
  private sessionSubscribers = new Map<string, Set<string>>()

  register(ws: WebSocket): string {
    const connectionId = randomUUID()
    this.clients.set(connectionId, {
      ws,
      connectionId,
      sessionId: null,
      joinedAt: Date.now(),
    })
    return connectionId
  }

  unregister(connectionId: string): void {
    const client = this.clients.get(connectionId)
    if (!client) return
    if (client.sessionId) {
      this.leaveSession(connectionId)
    }
    this.clients.delete(connectionId)
  }

  joinSession(connectionId: string, sessionId: string): void {
    const client = this.clients.get(connectionId)
    if (!client) return
    if (client.sessionId) {
      this.leaveSession(connectionId)
    }
    client.sessionId = sessionId
    if (!this.sessionSubscribers.has(sessionId)) {
      this.sessionSubscribers.set(sessionId, new Set())
    }
    this.sessionSubscribers.get(sessionId)!.add(connectionId)
  }

  leaveSession(connectionId: string): void {
    const client = this.clients.get(connectionId)
    if (!client || !client.sessionId) return
    const subs = this.sessionSubscribers.get(client.sessionId)
    if (subs) {
      subs.delete(connectionId)
      if (subs.size === 0) {
        this.sessionSubscribers.delete(client.sessionId)
      }
    }
    client.sessionId = null
  }

  broadcast(sessionId: string, msg: S2CMessage): void {
    const subs = this.sessionSubscribers.get(sessionId)
    if (!subs) return
    const data = JSON.stringify(msg)
    for (const connId of subs) {
      const client = this.clients.get(connId)
      if (client?.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data)
      }
    }
  }

  sendTo(connectionId: string, msg: S2CMessage): void {
    const client = this.clients.get(connectionId)
    if (client?.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(msg))
    }
  }

  broadcastExcept(sessionId: string, excludeConnectionId: string, msg: S2CMessage): void {
    const subs = this.sessionSubscribers.get(sessionId)
    if (!subs) return
    const data = JSON.stringify(msg)
    for (const connId of subs) {
      if (connId === excludeConnectionId) continue
      const client = this.clients.get(connId)
      if (client?.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data)
      }
    }
  }

  getClient(connectionId: string): ClientInfo | undefined {
    return this.clients.get(connectionId)
  }

  getSessionClientCount(sessionId: string): number {
    return this.sessionSubscribers.get(sessionId)?.size ?? 0
  }

  getSessionIdForConnection(connectionId: string): string | null {
    return this.clients.get(connectionId)?.sessionId ?? null
  }

  /** Replace WS reference when client reconnects with new socket */
  replaceWs(connectionId: string, ws: WebSocket): void {
    const client = this.clients.get(connectionId)
    if (client) {
      client.ws = ws
    }
  }
}
```

- [ ] **Step 4: Create routes/health.ts**

```typescript
// packages/server/src/routes/health.ts
import type { FastifyInstance } from 'fastify'

const startTime = Date.now()

export async function healthRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    uptime: Math.floor((Date.now() - startTime) / 1000),
  }))
}
```

- [ ] **Step 5: Create ws/lock.ts placeholder (full impl in Task 4)**

```typescript
// packages/server/src/ws/lock.ts
// Placeholder — full implementation in Task 4
export class LockManager {
  constructor(private onRelease: (sessionId: string) => void) {}
  acquire(sessionId: string, connectionId: string): { success: boolean; holder?: string } { return { success: true } }
  release(sessionId: string): void { this.onRelease(sessionId) }
  onDisconnect(connectionId: string): void {}
  onReconnect(previousConnectionId: string, newConnectionId: string): void {}
  getHolder(sessionId: string): string | null { return null }
  isHolder(sessionId: string, connectionId: string): boolean { return false }
  getStatus(sessionId: string): 'idle' | 'locked' { return 'idle' }
  getLockedSessions(connectionId: string): string[] { return [] }
}
```

- [ ] **Step 6: Create ws/handler.ts skeleton**

```typescript
// packages/server/src/ws/handler.ts
import type { WebSocket } from 'ws'
import type { C2SMessage } from '@claude-agent-ui/shared'
import type { WSHub } from './hub.js'
import type { LockManager } from './lock.js'

export interface HandlerDeps {
  wsHub: WSHub
  lockManager: LockManager
}

export function createWsHandler(deps: HandlerDeps) {
  const { wsHub, lockManager } = deps

  return function handleConnection(ws: WebSocket) {
    const connectionId = wsHub.register(ws)

    // Send init
    wsHub.sendTo(connectionId, { type: 'init', connectionId })

    ws.on('message', (raw) => {
      try {
        const msg: C2SMessage = JSON.parse(raw.toString())
        handleMessage(connectionId, msg)
      } catch (err) {
        wsHub.sendTo(connectionId, {
          type: 'error',
          message: 'Invalid message format',
          code: 'internal',
        })
      }
    })

    ws.on('close', () => {
      lockManager.onDisconnect(connectionId)
      wsHub.unregister(connectionId)
    })
  }

  function handleMessage(connectionId: string, msg: C2SMessage) {
    switch (msg.type) {
      case 'join-session':
        handleJoinSession(connectionId, msg.sessionId)
        break
      case 'leave-session':
        wsHub.leaveSession(connectionId)
        break
      // Other handlers will be added in Task 7
      default:
        wsHub.sendTo(connectionId, {
          type: 'error',
          message: `Unknown message type: ${(msg as any).type}`,
          code: 'internal',
        })
    }
  }

  function handleJoinSession(connectionId: string, sessionId: string) {
    wsHub.joinSession(connectionId, sessionId)
    const lockHolder = lockManager.getHolder(sessionId)
    wsHub.sendTo(connectionId, {
      type: 'session-state',
      sessionId,
      sessionStatus: 'idle',
      lockStatus: lockManager.getStatus(sessionId),
      lockHolderId: lockHolder ?? undefined,
      isLockHolder: lockHolder === connectionId,
    })
  }
}
```

- [ ] **Step 7: Update index.ts with full Fastify setup**

```typescript
// packages/server/src/index.ts
import Fastify from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import fastifyCors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import { loadConfig } from './config.js'
import { createDb } from './db/index.js'
import { WSHub } from './ws/hub.js'
import { LockManager } from './ws/lock.js'
import { createWsHandler } from './ws/handler.js'
import { healthRoutes } from './routes/health.js'

const config = loadConfig()
const server = Fastify({ logger: true })

// Plugins
await server.register(fastifyCors, { origin: config.corsOrigin })
await server.register(fastifyWebsocket)

if (config.staticDir) {
  await server.register(fastifyStatic, { root: config.staticDir })
}

// Database
const db = createDb(config.dbPath)

// Singletons
const wsHub = new WSHub()
const lockManager = new LockManager((sessionId) => {
  wsHub.broadcast(sessionId, { type: 'lock-status', sessionId, status: 'idle' })
})

// Routes
await server.register(healthRoutes)

// WebSocket
const handleWs = createWsHandler({ wsHub, lockManager })
server.register(async (app) => {
  app.get('/ws', { websocket: true }, (socket) => {
    handleWs(socket)
  })
})

// Start
server.listen({ port: config.port, host: config.host }, (err) => {
  if (err) { server.log.error(err); process.exit(1) }
  server.log.info(`Server running on ${config.host}:${config.port}`)
})
```

- [ ] **Step 8: Verify server starts and WS works**

Run:
```bash
cd E:/projects/claude-agent-ui
pnpm --filter @claude-agent-ui/server run dev
```

Test with wscat or browser console:
```javascript
const ws = new WebSocket('ws://localhost:3456/ws')
ws.onmessage = (e) => console.log(JSON.parse(e.data))
// Should receive: { type: 'init', connectionId: '...' }
```

Test health endpoint:
```bash
curl http://localhost:3456/api/health
# Should return: { "status": "ok", "version": "0.1.0", "uptime": ... }
```

- [ ] **Step 9: Commit**

```bash
git add packages/server/
git commit -m "feat(server): Fastify + WebSocket foundation (hub, handler, health, db)"
```
