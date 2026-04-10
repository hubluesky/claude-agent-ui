import { randomUUID } from 'crypto'
import type { WebSocket } from 'ws'
import type { C2SMessage, PermissionMode, PlanApprovalDecision } from '@claude-agent-ui/shared'
import type { WSHub } from './hub.js'
import type { LockManager } from './lock.js'
import type { SessionManager } from '../agent/manager.js'
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
    toolName?: string
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
        // CLI handles its own queue via priority messages; no-op for now
        break
      case 'set-mode':
        await handleSetMode(connectionId, msg.sessionId, msg.mode)
        break
      case 'set-effort': {
        const session = sessionManager.getActive((msg as any).sessionId) as CliSession | undefined
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
        if (session?.toggleMcpServer) {
          await session.toggleMcpServer(msg.serverName, msg.enabled)
          await handleGetMcpStatus(connectionId, msg.sessionId)
        }
        break
      }
      case 'reconnect-mcp-server': {
        const session = sessionManager.getActive(msg.sessionId) as CliSession | undefined
        if (session?.reconnectMcpServer) {
          await session.reconnectMcpServer(msg.serverName)
          await handleGetMcpStatus(connectionId, msg.sessionId)
        }
        break
      }
      case 'get-subagent-messages':
        wsHub.sendTo(connectionId, { type: 'subagent-messages', sessionId: msg.sessionId, agentId: msg.agentId, messages: [] } as any)
        break
      case 'pong':
        wsHub.recordPong(connectionId)
        break
    }
  }

  // ======== Join / Subscribe ========

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

    const readonly = lockHolder !== null && lockHolder !== connectionId
    resendPendingRequests(sessionId, connectionId, readonly)
  }

  function handleSubscribeSession(connectionId: string, sessionId: string, lastSeq?: number) {
    const syncResult = wsHub.subscribeWithSync(connectionId, sessionId, lastSeq ?? 0)

    const activeSession = sessionManager.getActive(sessionId)
    const lockHolder = lockManager.getHolder(sessionId)

    wsHub.sendTo(connectionId, {
      type: 'session-state',
      sessionId,
      sessionStatus: activeSession?.status ?? 'idle',
      lockStatus: lockManager.getStatus(sessionId),
      lockHolderId: lockHolder ?? undefined,
      isLockHolder: lockHolder === connectionId,
      permissionMode: activeSession?.permissionMode,
    })

    const snapshot = wsHub.getStreamSnapshot(sessionId)
    if (snapshot) {
      wsHub.sendTo(connectionId, { type: 'stream-snapshot', sessionId, messageId: snapshot.messageId, blocks: snapshot.blocks })
    }

    wsHub.sendTo(connectionId, { type: 'sync-result', sessionId, replayed: syncResult.replayed, hasGap: syncResult.hasGap, gapRange: syncResult.gapRange } as any)
    resendPendingRequests(sessionId, connectionId, true)
  }

  // ======== Session event binding ========

  function bindSessionEvents(session: CliSession, sessionId: string, connectionId: string, pendingUserMsg?: { prompt: string; content: unknown[] }) {
    session.removeAllListeners()

    // Clean up stale pending requests
    for (const [requestId, entry] of pendingRequestMap) {
      if (entry.sessionId !== sessionId) continue
      const resolvedType = entry.type === 'tool-approval' ? 'tool-approval-resolved'
        : entry.type === 'ask-user' ? 'ask-user-resolved'
        : 'plan-approval-resolved'
      wsHub.broadcast(sessionId, { type: resolvedType, sessionId, requestId, decision: { behavior: 'deny', message: 'New query started' } } as any)
      pendingRequestMap.delete(requestId)
    }

    let realSessionId = sessionId
    let titleGenTriggered = false

    session.on('session-id-changed', (_oldId: string | null, newId: string) => {
      if (realSessionId.startsWith('pending-')) {
        // New session: register, acquire lock, join, broadcast deferred user message
        sessionManager.registerActive(newId, session)
        lockManager.acquire(newId, connectionId)
        wsHub.joinSession(connectionId, newId)
        wsHub.broadcast(newId, { type: 'lock-status', sessionId: newId, status: 'locked', holderId: connectionId })
        wsHub.broadcast(newId, { type: 'session-state-change', sessionId: newId, state: session.status } as any)

        if (pendingUserMsg) {
          wsHub.broadcast(newId, {
            type: 'agent-message',
            sessionId: newId,
            message: { type: 'user', uuid: randomUUID(), message: { role: 'user', content: pendingUserMsg.content } },
          } as any)
        }
      } else if (realSessionId !== newId) {
        // Session ID changed (resume assigned different ID)
        sessionManager.removeActive(realSessionId)
        sessionManager.registerActive(newId, session)
        for (const [, entry] of pendingRequestMap) {
          if (entry.sessionId === realSessionId) entry.sessionId = newId
        }
        lockManager.release(realSessionId)
        lockManager.acquire(newId, connectionId)
        wsHub.joinSession(connectionId, newId)
        wsHub.broadcast(newId, { type: 'lock-status', sessionId: newId, status: 'locked', holderId: connectionId })
      }
      realSessionId = newId
    })

    session.on('message', (msg: any) => {
      if (msg.type === 'stream_event') {
        const event = msg.event
        if (event?.type === 'content_block_delta') {
          const delta = event.delta
          const index = event.index ?? 0
          if (delta?.type === 'text_delta' && delta.text) {
            wsHub.updateStreamSnapshot(realSessionId, msg.uuid ?? '', index, 'text', delta.text)
          } else if (delta?.type === 'thinking_delta' && delta.thinking) {
            wsHub.updateStreamSnapshot(realSessionId, msg.uuid ?? '', index, 'thinking', delta.thinking)
          }
        }
        wsHub.broadcastRaw(realSessionId, { type: 'agent-message', sessionId: realSessionId, message: msg })
        return
      }

      if (msg.type === 'assistant') {
        wsHub.clearStreamSnapshot(realSessionId)

        if (!titleGenTriggered && !realSessionId.startsWith('pending-')) {
          titleGenTriggered = true
          maybeGenerateTitle(realSessionId).then((title) => {
            if (title) {
              sessionManager.invalidateSessionsCache(session.projectCwd)
              wsHub.broadcast(realSessionId, { type: 'session-title-updated', sessionId: realSessionId, title })
            }
          }).catch(() => {})
        }
      }

      wsHub.broadcast(realSessionId, { type: 'agent-message', sessionId: realSessionId, message: msg })
    })

    session.on('tool-approval', (req: any) => {
      lockManager.startTimeout(realSessionId)
      pendingRequestMap.set(req.requestId, { sessionId: realSessionId, type: 'tool-approval', toolName: req.toolName, payload: req })
      const holder = lockManager.getHolder(realSessionId)
      for (const connId of wsHub.getSessionClients(realSessionId)) {
        wsHub.sendTo(connId, { type: 'tool-approval-request', sessionId: realSessionId, ...req, readonly: holder !== null && connId !== holder })
      }
    })

    session.on('ask-user', (req: any) => {
      lockManager.startTimeout(realSessionId)
      pendingRequestMap.set(req.requestId, { sessionId: realSessionId, type: 'ask-user', payload: req })
      const holder = lockManager.getHolder(realSessionId)
      for (const connId of wsHub.getSessionClients(realSessionId)) {
        wsHub.sendTo(connId, { type: 'ask-user-request', sessionId: realSessionId, ...req, readonly: holder !== null && connId !== holder })
      }
    })

    session.on('plan-approval', (req: any) => {
      lockManager.startTimeout(realSessionId)
      pendingRequestMap.set(req.requestId, { sessionId: realSessionId, type: 'plan-approval', payload: req })
      const holder = lockManager.getHolder(realSessionId)
      for (const connId of wsHub.getSessionClients(realSessionId)) {
        wsHub.sendTo(connId, { type: 'plan-approval', sessionId: realSessionId, ...req, readonly: holder !== null && connId !== holder })
      }
    })

    session.on('state-change', (state: string) => {
      wsHub.broadcast(realSessionId, { type: 'session-state-change', sessionId: realSessionId, state } as any)
    })

    session.on('complete', (result: any) => {
      lockManager.startTimeout(realSessionId)
      // Clean up pending requests
      for (const [id, entry] of pendingRequestMap) {
        if (entry.sessionId === realSessionId) pendingRequestMap.delete(id)
      }
      wsHub.broadcast(realSessionId, { type: 'session-complete', sessionId: realSessionId, result })
      wsHub.clearBuffer(realSessionId)
      sessionManager.invalidateSessionsCache(session.projectCwd)

      if (!titleGenTriggered) {
        titleGenTriggered = true
        maybeGenerateTitle(realSessionId).then((title) => {
          if (title) {
            sessionManager.invalidateSessionsCache(session.projectCwd)
            wsHub.broadcast(realSessionId, { type: 'session-title-updated', sessionId: realSessionId, title })
          }
        }).catch(() => {})
      }
    })

    session.on('error', (err: Error) => {
      lockManager.startTimeout(realSessionId)
      wsHub.broadcast(realSessionId, { type: 'error', message: err.message, code: 'internal' })
    })
  }

  // ======== Send Message ========

  async function handleSendMessage(
    connectionId: string,
    sessionId: string | null,
    prompt: string,
    options?: { cwd?: string; images?: any[]; thinkingMode?: string; effort?: string; permissionMode?: string }
  ) {
    let effectiveSessionId = sessionId
    let session: CliSession

    if (!effectiveSessionId) {
      if (!options?.cwd) {
        wsHub.sendTo(connectionId, { type: 'error', message: 'cwd is required for new sessions', code: 'internal' })
        return
      }
      session = sessionManager.createSession(options.cwd, {
        model: undefined,
        effort: options.effort,
        thinking: options.thinkingMode,
        permissionMode: options.permissionMode as any,
      })
      effectiveSessionId = `pending-${connectionId}`
    } else {
      const lockResult = lockManager.acquire(effectiveSessionId, connectionId)
      if (!lockResult.success) {
        wsHub.sendTo(connectionId, { type: 'error', message: 'Session is locked by another client', code: 'session_locked' })
        return
      }
      wsHub.broadcast(effectiveSessionId, { type: 'lock-status', sessionId: effectiveSessionId, status: 'locked', holderId: connectionId })

      const existing = sessionManager.getActive(effectiveSessionId)
      if (existing) {
        session = existing as CliSession
      } else {
        session = await sessionManager.resumeSession(effectiveSessionId)
      }
    }

    // Build content blocks for broadcast
    const broadcastContent: any[] = []
    if (options?.images) {
      for (const img of options.images) {
        broadcastContent.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })
      }
    }
    if (prompt) {
      broadcastContent.push({ type: 'text', text: prompt })
    }

    // Apply per-message options
    if (options?.permissionMode) {
      await session.setPermissionMode(options.permissionMode as PermissionMode).catch(() => {})
    }
    if (options?.thinkingMode) {
      if (options.thinkingMode === 'disabled') session.setThinking?.(0)
      else session.setThinking?.(null)
    }
    if (options?.effort) session.setEffort?.(options.effort)

    const isPending = effectiveSessionId.startsWith('pending-')
    bindSessionEvents(session, effectiveSessionId, connectionId, isPending ? { prompt, content: broadcastContent } : undefined)

    // Broadcast user message (skip for pending — deferred until session-id-changed)
    if (!isPending) {
      wsHub.broadcast(effectiveSessionId, {
        type: 'agent-message',
        sessionId: effectiveSessionId,
        message: { type: 'user', uuid: randomUUID(), message: { role: 'user', content: broadcastContent } },
      } as any)
    }

    session.send(prompt, {
      cwd: options?.cwd,
      images: options?.images,
      effort: options?.effort as any,
      thinkingMode: options?.thinkingMode as any,
    })
  }

  // ======== Approval responses ========

  function handleToolApprovalResponse(connectionId: string, requestId: string, decision: any) {
    const entry = pendingRequestMap.get(requestId)
    if (!entry) return

    const session = sessionManager.getActive(entry.sessionId)
    if (!session) return

    lockManager.acquire(entry.sessionId, connectionId)
    wsHub.broadcast(entry.sessionId, { type: 'lock-status', sessionId: entry.sessionId, status: 'locked', holderId: connectionId })

    session.resolveToolApproval(requestId, decision)
    pendingRequestMap.delete(requestId)

    wsHub.broadcast(entry.sessionId, {
      type: 'tool-approval-resolved',
      sessionId: entry.sessionId,
      requestId,
      decision: { behavior: decision.behavior, message: decision.behavior === 'deny' ? decision.message : undefined },
    })
  }

  function handleAskUserResponse(connectionId: string, requestId: string, answers: Record<string, string>) {
    const entry = pendingRequestMap.get(requestId)
    if (!entry) return

    const session = sessionManager.getActive(entry.sessionId)
    if (!session) return

    lockManager.acquire(entry.sessionId, connectionId)
    wsHub.broadcast(entry.sessionId, { type: 'lock-status', sessionId: entry.sessionId, status: 'locked', holderId: connectionId })

    session.resolveAskUser(requestId, { answers })
    pendingRequestMap.delete(requestId)

    wsHub.broadcast(entry.sessionId, { type: 'ask-user-resolved', sessionId: entry.sessionId, requestId, answers })
  }

  async function handleResolvePlanApproval(
    connectionId: string,
    _sessionId: string,
    requestId: string,
    decisionType: PlanApprovalDecision['decision'],
    feedback?: string
  ) {
    const entry = pendingRequestMap.get(requestId)
    if (!entry) return

    const session = sessionManager.getActive(entry.sessionId) as CliSession | undefined
    if (!session) return

    lockManager.acquire(entry.sessionId, connectionId)
    wsHub.broadcast(entry.sessionId, { type: 'lock-status', sessionId: entry.sessionId, status: 'locked', holderId: connectionId })

    const decision: PlanApprovalDecision = { decision: decisionType, feedback }
    session.resolvePlanApproval(requestId, decision)
    pendingRequestMap.delete(requestId)

    wsHub.broadcast(entry.sessionId, { type: 'plan-approval-resolved', sessionId: entry.sessionId, requestId, decision: decisionType })

    // clear-and-accept: wait for idle, then respawn fresh session with plan content
    if (decisionType === 'clear-and-accept') {
      const planContent = (entry.payload as any).planContent as string
      const onStateChange = (state: string) => {
        if (state !== 'idle') return
        session.removeListener('state-change', onStateChange)

        session.close()
        sessionManager.removeActive(entry.sessionId)

        const newSession = sessionManager.createSession(session.projectCwd, {
          model: session._model,
          permissionMode: 'acceptEdits',
        })
        const newId = newSession.id ?? randomUUID()
        sessionManager.registerActive(newId, newSession)
        bindSessionEvents(newSession, newId, connectionId)

        newSession.send(`Implement the following plan:\n\n${planContent}`)

        wsHub.broadcast(entry.sessionId, { type: 'session-forked', sessionId: newId, originalSessionId: entry.sessionId } as any)
      }
      session.on('state-change', onStateChange)
    }
  }

  // ======== Other handlers ========

  async function handleAbort(connectionId: string, sessionId: string) {
    if (!lockManager.isHolder(sessionId, connectionId)) {
      wsHub.sendTo(connectionId, { type: 'error', message: 'Not lock holder', code: 'not_lock_holder' })
      return
    }
    const session = sessionManager.getActive(sessionId)
    if (session) await session.abort()
    wsHub.broadcast(sessionId, { type: 'session-aborted', sessionId })
  }

  async function handleSetMode(connectionId: string, sessionId: string, mode: PermissionMode) {
    const isIdle = lockManager.getStatus(sessionId) === 'idle'
    const isHolder = lockManager.isHolder(sessionId, connectionId)

    if (!isIdle && !isHolder) {
      wsHub.sendTo(connectionId, { type: 'error', message: 'Cannot change mode', code: 'not_lock_holder' })
      return
    }

    // CLI handles mode changes and auto-resolution of pending requests internally
    const session = sessionManager.getActive(sessionId)
    if (session) {
      await session.setPermissionMode(mode).catch(() => {})
    }

    wsHub.broadcast(sessionId, { type: 'mode-change', sessionId, mode })
  }

  async function handleForkSession(connectionId: string, sessionId: string, _atMessageId?: string) {
    try {
      const session = sessionManager.getActive(sessionId)
      const cwd = session?.projectCwd ?? process.cwd()

      const newSession = sessionManager.createSession(cwd, { model: (session as CliSession)?._model })
      // Set up as fork — will use --resume --fork-session when process spawns
      const newId = randomUUID()
      sessionManager.registerActive(newId, newSession)
      sessionManager.invalidateSessionsCache(cwd)

      wsHub.sendTo(connectionId, { type: 'session-forked', sessionId: newId, originalSessionId: sessionId } as any)
    } catch (err: any) {
      wsHub.sendTo(connectionId, { type: 'error', message: `Fork failed: ${err.message ?? 'unknown error'}`, code: 'internal' })
    }
  }

  function handleReleaseLock(connectionId: string, sessionId: string) {
    if (!lockManager.isHolder(sessionId, connectionId)) {
      wsHub.sendTo(connectionId, { type: 'error', message: 'Not lock holder', code: 'not_lock_holder' })
      return
    }
    lockManager.release(sessionId)
  }

  function handleReconnect(connectionId: string, previousConnectionId: string) {
    if (connectionId === previousConnectionId) return
    const lockedSessions = lockManager.getLockedSessions(previousConnectionId)
    for (const sid of lockedSessions) {
      lockManager.release(sid)
      lockManager.acquire(sid, connectionId)
    }
  }

  async function handleGetContextUsage(connectionId: string, sessionId: string) {
    const session = sessionManager.getActive(sessionId) as CliSession | undefined
    if (!session?.getContextUsage) return
    try {
      const resp = await session.getContextUsage() as any
      const usage = resp?.response ?? resp
      wsHub.sendTo(connectionId, {
        type: 'context-usage',
        sessionId,
        categories: usage?.categories ?? [],
        totalTokens: usage?.totalTokens ?? 0,
        maxTokens: usage?.maxTokens ?? 0,
        percentage: usage?.percentage ?? 0,
        model: usage?.model ?? '',
      })
    } catch { /* non-critical */ }
  }

  async function handleGetMcpStatus(connectionId: string, sessionId: string) {
    const session = sessionManager.getActive(sessionId) as CliSession | undefined
    if (!session?.getMcpStatus) return
    try {
      const servers = await session.getMcpStatus()
      wsHub.sendTo(connectionId, { type: 'mcp-status', sessionId, servers } as any)
    } catch { /* non-critical */ }
  }
}
