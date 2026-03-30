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
      } catch {
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
