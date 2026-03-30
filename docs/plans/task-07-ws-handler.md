# Task 7: Complete WS Handler

**Files:**
- Modify: `packages/server/src/ws/handler.ts`

---

- [ ] **Step 1: Update handler.ts with full message routing**

Replace the skeleton `handleMessage` and add all handlers:

```typescript
// packages/server/src/ws/handler.ts
import type { WebSocket } from 'ws'
import type { C2SMessage, S2CMessage, ToolApprovalDecision } from '@claude-agent-ui/shared'
import type { WSHub } from './hub.js'
import type { LockManager } from './lock.js'
import type { SessionManager } from '../agent/manager.js'
import type { AgentSession } from '../agent/session.js'

export interface HandlerDeps {
  wsHub: WSHub
  lockManager: LockManager
  sessionManager: SessionManager
}

export function createWsHandler(deps: HandlerDeps) {
  const { wsHub, lockManager, sessionManager } = deps

  // requestId → sessionId mapping for tool approvals and ask-user
  const pendingRequestMap = new Map<string, string>()

  return function handleConnection(ws: WebSocket) {
    const connectionId = wsHub.register(ws)
    wsHub.sendTo(connectionId, { type: 'init', connectionId })

    ws.on('message', async (raw) => {
      try {
        const msg: C2SMessage = JSON.parse(raw.toString())
        await handleMessage(connectionId, msg)
      } catch (err: any) {
        wsHub.sendTo(connectionId, {
          type: 'error',
          message: err.message ?? 'Invalid message',
          code: 'internal',
        })
      }
    })

    ws.on('close', () => {
      lockManager.onDisconnect(connectionId)
      wsHub.unregister(connectionId)
    })
  }

  async function handleMessage(connectionId: string, msg: C2SMessage) {
    switch (msg.type) {
      case 'join-session':
        handleJoinSession(connectionId, msg.sessionId)
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
      case 'set-mode':
        await handleSetMode(connectionId, msg.sessionId, msg.mode)
        break
      case 'set-effort':
        // Effort is applied on next send, store if needed
        break
      case 'reconnect':
        handleReconnect(connectionId, msg.previousConnectionId)
        break
      case 'leave-session':
        wsHub.leaveSession(connectionId)
        break
    }
  }

  function handleJoinSession(connectionId: string, sessionId: string) {
    wsHub.joinSession(connectionId, sessionId)
    const lockHolder = lockManager.getHolder(sessionId)
    const activeSession = sessionManager.getActive(sessionId)
    wsHub.sendTo(connectionId, {
      type: 'session-state',
      sessionId,
      sessionStatus: activeSession?.status ?? 'idle',
      lockStatus: lockManager.getStatus(sessionId),
      lockHolderId: lockHolder ?? undefined,
      isLockHolder: lockHolder === connectionId,
    })
  }

  async function handleSendMessage(
    connectionId: string,
    sessionId: string | null,
    prompt: string,
    options?: { cwd?: string; images?: any[]; thinkingMode?: string; effort?: string }
  ) {
    // Handle new session (sessionId === null)
    let effectiveSessionId = sessionId
    let session: AgentSession

    if (!effectiveSessionId) {
      if (!options?.cwd) {
        wsHub.sendTo(connectionId, { type: 'error', message: 'cwd is required for new sessions', code: 'internal' })
        return
      }
      session = sessionManager.createSession(options.cwd)
      // Use a temp ID for locking until we get the real one
      effectiveSessionId = `pending-${connectionId}`
    } else {
      // Acquire lock
      const lockResult = lockManager.acquire(effectiveSessionId, connectionId)
      if (!lockResult.success) {
        wsHub.sendTo(connectionId, {
          type: 'error',
          message: 'Session is locked by another client',
          code: 'session_locked',
        })
        return
      }

      // Get or resume session
      session = sessionManager.getActive(effectiveSessionId) ?? await sessionManager.resumeSession(effectiveSessionId)
    }

    // Broadcast lock status
    if (effectiveSessionId && !effectiveSessionId.startsWith('pending-')) {
      lockManager.acquire(effectiveSessionId, connectionId)
      wsHub.broadcast(effectiveSessionId, {
        type: 'lock-status',
        sessionId: effectiveSessionId,
        status: 'locked',
        holderId: connectionId,
      })
    }

    // Bind session events → WS broadcast
    bindSessionEvents(session, effectiveSessionId, connectionId)

    // Broadcast user message to other clients immediately
    if (effectiveSessionId && !effectiveSessionId.startsWith('pending-')) {
      wsHub.broadcastExcept(effectiveSessionId, connectionId, {
        type: 'agent-message',
        sessionId: effectiveSessionId,
        message: { type: 'user', message: { role: 'user', content: prompt } } as any,
      })
    }

    // Send
    session.send(prompt, {
      cwd: options?.cwd,
      effort: options?.effort as any,
      thinkingMode: options?.thinkingMode as any,
    })
  }

  function bindSessionEvents(session: AgentSession, sessionId: string, connectionId: string) {
    let realSessionId = sessionId

    session.on('message', (msg: any) => {
      // Capture real session ID from init
      if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
        const newId = msg.session_id
        if (realSessionId.startsWith('pending-')) {
          // Register with real ID
          sessionManager.registerActive(newId, session)
          lockManager.acquire(newId, connectionId)
          wsHub.joinSession(connectionId, newId)
          wsHub.broadcast(newId, {
            type: 'lock-status',
            sessionId: newId,
            status: 'locked',
            holderId: connectionId,
          })
          realSessionId = newId
        } else if (realSessionId !== newId) {
          sessionManager.registerActive(newId, session)
          realSessionId = newId
        }
      }

      wsHub.broadcast(realSessionId, {
        type: 'agent-message',
        sessionId: realSessionId,
        message: msg,
      })
    })

    session.on('tool-approval', (req) => {
      pendingRequestMap.set(req.requestId, realSessionId)
      wsHub.sendTo(connectionId, {
        type: 'tool-approval-request',
        ...req,
        readonly: false,
      })
      wsHub.broadcastExcept(realSessionId, connectionId, {
        type: 'tool-approval-request',
        ...req,
        readonly: true,
      })
    })

    session.on('ask-user', (req) => {
      pendingRequestMap.set(req.requestId, realSessionId)
      wsHub.sendTo(connectionId, {
        type: 'ask-user-request',
        ...req,
        readonly: false,
      })
      wsHub.broadcastExcept(realSessionId, connectionId, {
        type: 'ask-user-request',
        ...req,
        readonly: true,
      })
    })

    session.on('state-change', (state) => {
      wsHub.broadcast(realSessionId, {
        type: 'session-state-change',
        sessionId: realSessionId,
        state,
      })
    })

    session.on('complete', (result) => {
      lockManager.release(realSessionId)
      wsHub.broadcast(realSessionId, {
        type: 'session-complete',
        sessionId: realSessionId,
        result,
      })
      wsHub.broadcast(realSessionId, {
        type: 'lock-status',
        sessionId: realSessionId,
        status: 'idle',
      })
    })

    session.on('error', (err) => {
      lockManager.release(realSessionId)
      wsHub.broadcast(realSessionId, {
        type: 'error',
        message: err.message,
        code: 'internal',
      })
      wsHub.broadcast(realSessionId, {
        type: 'lock-status',
        sessionId: realSessionId,
        status: 'idle',
      })
    })
  }

  function handleToolApprovalResponse(connectionId: string, requestId: string, decision: ToolApprovalDecision) {
    const sessionId = pendingRequestMap.get(requestId)
    if (!sessionId) return

    if (!lockManager.isHolder(sessionId, connectionId)) {
      wsHub.sendTo(connectionId, { type: 'error', message: 'Not lock holder', code: 'not_lock_holder' })
      return
    }

    const session = sessionManager.getActive(sessionId)
    if (!session) return

    session.resolveToolApproval(requestId, decision)
    pendingRequestMap.delete(requestId)

    wsHub.broadcastExcept(sessionId, connectionId, {
      type: 'tool-approval-resolved',
      requestId,
      decision: { behavior: decision.behavior, message: decision.behavior === 'deny' ? decision.message : undefined },
    })
  }

  function handleAskUserResponse(connectionId: string, requestId: string, answers: Record<string, string>) {
    const sessionId = pendingRequestMap.get(requestId)
    if (!sessionId) return

    if (!lockManager.isHolder(sessionId, connectionId)) {
      wsHub.sendTo(connectionId, { type: 'error', message: 'Not lock holder', code: 'not_lock_holder' })
      return
    }

    const session = sessionManager.getActive(sessionId)
    if (!session) return

    session.resolveAskUser(requestId, { answers })
    pendingRequestMap.delete(requestId)

    wsHub.broadcastExcept(sessionId, connectionId, {
      type: 'ask-user-resolved',
      requestId,
      answers,
    })
  }

  async function handleAbort(connectionId: string, sessionId: string) {
    if (!lockManager.isHolder(sessionId, connectionId)) {
      wsHub.sendTo(connectionId, { type: 'error', message: 'Not lock holder', code: 'not_lock_holder' })
      return
    }

    const session = sessionManager.getActive(sessionId)
    if (!session) return

    await session.abort()
    lockManager.release(sessionId)

    wsHub.broadcast(sessionId, { type: 'session-aborted', sessionId })
    wsHub.broadcast(sessionId, { type: 'lock-status', sessionId, status: 'idle' })
  }

  async function handleSetMode(connectionId: string, sessionId: string, mode: string) {
    const isIdle = lockManager.getStatus(sessionId) === 'idle'
    const isHolder = lockManager.isHolder(sessionId, connectionId)

    if (!isIdle && !isHolder) {
      wsHub.sendTo(connectionId, { type: 'error', message: 'Cannot change mode', code: 'not_lock_holder' })
      return
    }

    const session = sessionManager.getActive(sessionId)
    if (session) {
      await session.setPermissionMode(mode as any)
    }
  }

  function handleReconnect(connectionId: string, previousConnectionId: string) {
    lockManager.onReconnect(previousConnectionId, connectionId)

    // Migrate session subscriptions from old connection to new
    const oldClient = wsHub.getClient(previousConnectionId)
    if (oldClient?.sessionId) {
      wsHub.joinSession(connectionId, oldClient.sessionId)
    }
  }
}
```

- [ ] **Step 2: Update HandlerDeps import in index.ts**

The `createWsHandler` now requires `sessionManager`. Ensure `index.ts` passes it:

```typescript
const handleWs = createWsHandler({ wsHub, lockManager, sessionManager })
```

- [ ] **Step 3: Verify full WS flow**

Run server. Open two browser tabs. In console of Tab A:
```javascript
const ws = new WebSocket('ws://localhost:3456/ws')
ws.onmessage = (e) => console.log('A:', JSON.parse(e.data))
// Wait for init, then:
ws.send(JSON.stringify({ type: 'join-session', sessionId: 'test-session' }))
```

In Tab B:
```javascript
const ws = new WebSocket('ws://localhost:3456/ws')
ws.onmessage = (e) => console.log('B:', JSON.parse(e.data))
ws.send(JSON.stringify({ type: 'join-session', sessionId: 'test-session' }))
```

Both should receive `session-state` after joining.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/ws/handler.ts packages/server/src/index.ts
git commit -m "feat(server): complete WS handler (send, approve, abort, reconnect, mode)"
```
