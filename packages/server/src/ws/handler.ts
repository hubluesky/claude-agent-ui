import { randomUUID } from 'crypto'
import type { WebSocket } from 'ws'
import type {
  C2SMessage,
  LocalPendingItem,
  PermissionMode,
  PlanApprovalDecision,
} from '@claude-cockpit/shared'
import type { WSHub } from './hub.js'
import type { LockManager } from './lock.js'
import type { SessionManager } from '../agent/manager.js'
import { CliSession } from '../agent/cli-session.js'
import { maybeGenerateTitle } from '../agent/title-generator.js'
import { getKnownModels } from '../agent/known-models.js'

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

  interface MessageOptions {
    cwd?: string
    images?: { data: string; mediaType: string }[]
    thinkingMode?: string
    effort?: string
    permissionMode?: string
  }

  interface UserCommand {
    id: string
    value: string
    images?: { data: string; mediaType: string }[]
    options?: MessageOptions
  }

  interface LocalPendingSubmission {
    id: string
    sessionId: string
    connectionId: string
    value: string
    addedAt: number
    status: 'pending' | 'failed'
    errorMessage?: string
    options?: MessageOptions
  }

  const pendingRequestMap = new Map<string, PendingRequest>()
  const localPendingBySession = new Map<string, Map<string, LocalPendingSubmission>>()
  // Grace window between WS close and forced lock release. If the same
  // connectionId comes back via `reconnect` (handleReconnect transfers lock
  // to the new connection), the scheduled release is cancelled.
  const pendingLockReleaseByConnection = new Map<string, ReturnType<typeof setTimeout>>()
  const CLOSE_LOCK_RELEASE_GRACE_MS = 15_000

  wsHub.startHeartbeat()

  function scheduleLockReleaseOnClose(connectionId: string): void {
    const locked = lockManager.getLockedSessions(connectionId)
    if (locked.length === 0) return
    const existing = pendingLockReleaseByConnection.get(connectionId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      pendingLockReleaseByConnection.delete(connectionId)
      for (const sid of locked) {
        // Only release if this connection still owns the lock (no reconnect/transfer happened)
        if (lockManager.isHolder(sid, connectionId)) {
          lockManager.release(sid)
        }
      }
    }, CLOSE_LOCK_RELEASE_GRACE_MS)
    pendingLockReleaseByConnection.set(connectionId, timer)
  }

  function cancelPendingLockRelease(previousConnectionId: string): void {
    const timer = pendingLockReleaseByConnection.get(previousConnectionId)
    if (timer) {
      clearTimeout(timer)
      pendingLockReleaseByConnection.delete(previousConnectionId)
    }
  }

  function toLocalPendingItem(item: LocalPendingSubmission): LocalPendingItem {
    return {
      id: item.id,
      value: item.value,
      status: item.status,
      addedAt: item.addedAt,
      ...(item.errorMessage ? { errorMessage: item.errorMessage } : {}),
    }
  }

  function getLocalPendingSnapshot(sessionId: string, connectionId: string): LocalPendingItem[] {
    const items = localPendingBySession.get(sessionId)
    if (!items) return []
    return [...items.values()]
      .filter(item => item.connectionId === connectionId)
      .sort((a, b) => a.addedAt - b.addedAt)
      .map(toLocalPendingItem)
  }

  function syncLocalPending(sessionId: string, connectionId: string): void {
    wsHub.sendTo(connectionId, {
      type: 'local-pending-sync',
      sessionId,
      items: getLocalPendingSnapshot(sessionId, connectionId),
    } as any)
  }

  function storeLocalPending(sessionId: string, item: LocalPendingSubmission): void {
    let items = localPendingBySession.get(sessionId)
    if (!items) {
      items = new Map()
      localPendingBySession.set(sessionId, items)
    }
    items.set(item.id, item)
    syncLocalPending(sessionId, item.connectionId)
  }

  function removeLocalPending(sessionId: string, id: string): LocalPendingSubmission | undefined {
    const items = localPendingBySession.get(sessionId)
    if (!items) return undefined
    const item = items.get(id)
    if (!item) return undefined
    items.delete(id)
    if (items.size === 0) {
      localPendingBySession.delete(sessionId)
    }
    syncLocalPending(sessionId, item.connectionId)
    return item
  }

  function markLocalPendingFailed(sessionId: string, id: string, errorMessage: string): LocalPendingSubmission | undefined {
    const items = localPendingBySession.get(sessionId)
    if (!items) return undefined
    const item = items.get(id)
    if (!item) return undefined
    item.status = 'failed'
    item.errorMessage = errorMessage
    syncLocalPending(sessionId, item.connectionId)
    return item
  }

  function resolveLocalPendingAck(sessionId: string, id: string): LocalPendingSubmission | undefined {
    return removeLocalPending(sessionId, id)
  }

  async function cancelLocalPendingAfterAbort(
    session: CliSession,
    sessionId: string,
    connectionId: string,
  ): Promise<void> {
    const items = localPendingBySession.get(sessionId)
    if (!items) return

    const pendingItems = [...items.values()].filter(
      item => item.connectionId === connectionId && item.status === 'pending',
    )
    if (pendingItems.length === 0) return

    await Promise.all(
      pendingItems.map(async (item) => {
        const cancelled = await session.cancelAsyncMessage(item.id).catch(() => false)
        if (!cancelled) return

        session.clearForwardedMessage(item.id)
        markLocalPendingFailed(
          sessionId,
          item.id,
          'Interrupted before Claude Code confirmed this message',
        )
      }),
    )
  }

  function markAllLocalPendingFailed(sessionId: string, errorMessage: string): void {
    const items = localPendingBySession.get(sessionId)
    if (!items) return
    const affectedConnections = new Set<string>()
    for (const item of items.values()) {
      item.status = 'failed'
      item.errorMessage = errorMessage
      affectedConnections.add(item.connectionId)
    }
    for (const connectionId of affectedConnections) {
      syncLocalPending(sessionId, connectionId)
    }
  }

  function transferLocalPending(previousConnectionId: string, connectionId: string): void {
    for (const [sessionId, items] of localPendingBySession) {
      let changed = false
      for (const item of items.values()) {
        if (item.connectionId === previousConnectionId) {
          item.connectionId = connectionId
          changed = true
        }
      }
      if (changed) {
        syncLocalPending(sessionId, connectionId)
      }
    }
  }

  function migrateLocalPendingSession(oldSessionId: string, newSessionId: string): void {
    const items = localPendingBySession.get(oldSessionId)
    if (!items) return
    const affectedConnectionIds = [...new Set([...items.values()].map(item => item.connectionId))]
    localPendingBySession.delete(oldSessionId)
    for (const connectionId of affectedConnectionIds) {
      wsHub.sendTo(connectionId, {
        type: 'local-pending-sync',
        sessionId: oldSessionId,
        items: [],
      } as any)
    }
    const target = localPendingBySession.get(newSessionId) ?? new Map<string, LocalPendingSubmission>()
    for (const item of items.values()) {
      item.sessionId = newSessionId
      target.set(item.id, item)
    }
    localPendingBySession.set(newSessionId, target)
    for (const connectionId of affectedConnectionIds) {
      syncLocalPending(newSessionId, connectionId)
    }
  }

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
      // Schedule lock release if this connection held any locks. Cancelled
      // if a reconnect with this connectionId as previousConnectionId arrives.
      scheduleLockReleaseOnClose(connectionId)
    })
  }

  async function handleMessage(connectionId: string, msg: C2SMessage) {
    switch (msg.type) {
      case 'join-session':
        handleJoinSession(connectionId, msg.sessionId, msg.lastSeq)
        break
      case 'send-message':
        await handleSendMessage(
          connectionId,
          msg.sessionId,
          msg.clientMessageId,
          msg.prompt,
          msg.options,
          msg.sessionName,
        )
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
      case 'retry-local-pending':
        await handleRetryLocalPending(connectionId, msg.sessionId, msg.id)
        break
      case 'dismiss-local-pending':
        handleDismissLocalPending(connectionId, msg.sessionId, msg.id)
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
      case 'get-subagent-messages': {
        try {
          const messages = await sessionManager.getSubagentMessages(msg.sessionId, msg.agentId)
          wsHub.sendTo(connectionId, {
            type: 'subagent-messages',
            sessionId: msg.sessionId,
            agentId: msg.agentId,
            messages,
          } as any)
        } catch {
          wsHub.sendTo(connectionId, {
            type: 'subagent-messages',
            sessionId: msg.sessionId,
            agentId: msg.agentId,
            messages: [],
          } as any)
        }
        break
      }
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

    // Always send known models when joining
    wsHub.sendTo(connectionId, { type: 'models', models: getKnownModels() } as any)

    if (!syncResult.alreadyInSession) {
      const snapshot = wsHub.getStreamSnapshot(sessionId)
      if (snapshot) {
        wsHub.sendTo(connectionId, { type: 'stream-snapshot', sessionId, messageId: snapshot.messageId, blocks: snapshot.blocks })
      }
      wsHub.sendTo(connectionId, { type: 'sync-result', sessionId, replayed: syncResult.replayed, hasGap: syncResult.hasGap, gapRange: syncResult.gapRange } as any)
    }

    const readonly = lockHolder !== null && lockHolder !== connectionId
    resendPendingRequests(sessionId, connectionId, readonly)
    syncLocalPending(sessionId, connectionId)
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
    syncLocalPending(sessionId, connectionId)
  }

  // ======== Session event binding ========

  function bindSessionEvents(
    session: CliSession,
    sessionId: string,
    connectionId: string,
    pendingUserMsg?: { prompt: string; content: unknown[]; uuid: string },
  ) {
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
    let titleGenerated = false

    session.on('session-id-changed', (_oldId: string | null, newId: string) => {
      if (realSessionId.startsWith('pending-')) {
        // New session: register, acquire lock, join, then replace the
        // optimistic first user message once the real session id exists.
        sessionManager.registerActive(newId, session)
        // ── Named Session: set customTitle on newly created session ──
        const pendingName = (session as any).__pendingSessionName as string | undefined
        if (pendingName) {
          sessionManager.sessionStorage.renameSession(newId, pendingName, session.projectCwd).catch(() => {})
          delete (session as any).__pendingSessionName
        }
        lockManager.acquire(newId, connectionId)
        wsHub.joinSession(connectionId, newId)
        wsHub.broadcast(newId, { type: 'lock-status', sessionId: newId, status: 'locked', holderId: connectionId })
        wsHub.broadcast(newId, { type: 'session-state-change', sessionId: newId, state: session.status } as any)

        // Send known models list to clients
        wsHub.broadcast(newId, { type: 'models', models: getKnownModels() } as any)

        if (pendingUserMsg) {
          wsHub.broadcast(newId, {
            type: 'agent-message',
            sessionId: newId,
            message: { type: 'user', uuid: pendingUserMsg.uuid, message: { role: 'user', content: pendingUserMsg.content } },
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
      migrateLocalPendingSession(realSessionId, newId)
      realSessionId = newId
    })

    session.on('message', (msg: any) => {
      // Detect resumption of a new turn without an explicit session_state_changed(running)
      // from CLI. This happens for queued (priority:'next') messages where CLI consumes
      // the queued prompt internally after the previous turn's result but doesn't emit
      // a new state-change event. Without this synthetic broadcast, clients stay at
      // sessionStatus='idle' during the whole queued turn and render nothing.
      const isTurnActivityMsg =
        msg.type === 'stream_event' ||
        msg.type === 'assistant' ||
        msg.type === 'user' ||
        msg.type === 'tool_progress'
      if (isTurnActivityMsg && session.status !== 'running' && session.status !== 'awaiting_approval' && session.status !== 'awaiting_user_input') {
        // Promote locally so subsequent messages see the consistent state, then broadcast.
        ;(session as any)._status = 'running'
        wsHub.broadcast(realSessionId, { type: 'session-state-change', sessionId: realSessionId, state: 'running' } as any)
        lockManager.cancelTimeout(realSessionId)
      }
      if (msg.type === 'stream_event') {
        const event = msg.event
        if (event?.type === 'content_block_start') {
          const blockType = event.content_block?.type
          if (blockType === 'tool_use' || blockType === 'server_tool_use') {
            const toolBlock = event.content_block
            const index = event.index ?? 0
            wsHub.updateStreamSnapshot(realSessionId, msg.uuid ?? '', index, 'tool_use', '', {
              toolId: toolBlock.id ?? `tool-${index}`,
              toolName: toolBlock.name ?? '',
            })
          }
        } else if (event?.type === 'content_block_delta') {
          const delta = event.delta
          const index = event.index ?? 0
          if (delta?.type === 'text_delta' && delta.text) {
            wsHub.updateStreamSnapshot(realSessionId, msg.uuid ?? '', index, 'text', delta.text)
          } else if (delta?.type === 'thinking_delta' && delta.thinking) {
            wsHub.updateStreamSnapshot(realSessionId, msg.uuid ?? '', index, 'thinking', delta.thinking)
          } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
            wsHub.updateStreamSnapshot(realSessionId, msg.uuid ?? '', index, 'tool_use', delta.partial_json)
          }
        }
        wsHub.broadcastRaw(realSessionId, { type: 'agent-message', sessionId: realSessionId, message: msg })
        return
      }

      if (msg.type === 'assistant') {
        wsHub.clearStreamSnapshot(realSessionId)

        // Trigger title generation on first assistant message (user+assistant >= 2 messages)
        if (!titleGenerated && !realSessionId.startsWith('pending-')) {
          titleGenerated = true
          maybeGenerateTitle(realSessionId).then((title) => {
            if (title) {
              sessionManager.invalidateSessionsCache(session.projectCwd)
              wsHub.broadcast(realSessionId, { type: 'session-title-updated', sessionId: realSessionId, title })
            }
          }).catch(() => {})
        }
      }

      if (msg.type === 'user' && typeof msg.uuid === 'string') {
        resolveLocalPendingAck(realSessionId, msg.uuid)
      }

      wsHub.broadcast(realSessionId, { type: 'agent-message', sessionId: realSessionId, message: msg })
    })

    session.on('tool-approval', (req: any) => {
      pendingRequestMap.set(req.requestId, { sessionId: realSessionId, type: 'tool-approval', toolName: req.toolName, payload: req })
      const holder = lockManager.getHolder(realSessionId)
      for (const connId of wsHub.getSessionClients(realSessionId)) {
        wsHub.sendTo(connId, { type: 'tool-approval-request', sessionId: realSessionId, ...req, readonly: holder !== null && connId !== holder })
      }
    })

    session.on('ask-user', (req: any) => {
      pendingRequestMap.set(req.requestId, { sessionId: realSessionId, type: 'ask-user', payload: req })
      const holder = lockManager.getHolder(realSessionId)
      for (const connId of wsHub.getSessionClients(realSessionId)) {
        wsHub.sendTo(connId, { type: 'ask-user-request', sessionId: realSessionId, ...req, readonly: holder !== null && connId !== holder })
      }
    })

    session.on('plan-approval', (req: any) => {
      pendingRequestMap.set(req.requestId, { sessionId: realSessionId, type: 'plan-approval', payload: req })
      const holder = lockManager.getHolder(realSessionId)
      for (const connId of wsHub.getSessionClients(realSessionId)) {
        wsHub.sendTo(connId, { type: 'plan-approval', sessionId: realSessionId, ...req, readonly: holder !== null && connId !== holder })
      }
    })

    session.on('state-change', (state: string) => {
      wsHub.broadcast(realSessionId, { type: 'session-state-change', sessionId: realSessionId, state } as any)
      // Centralized lock timeout management:
      // - AI running → cancel timeout (lock held indefinitely while AI works)
      // - AI not running (idle/awaiting_approval/awaiting_user_input) → start 60s timeout
      if (state === 'running') {
        lockManager.cancelTimeout(realSessionId)
      } else {
        lockManager.startTimeout(realSessionId)
      }
    })

    session.on('complete', (result: any) => {
      // Clean up pending requests
      for (const [id, entry] of pendingRequestMap) {
        if (entry.sessionId === realSessionId) pendingRequestMap.delete(id)
      }
      wsHub.broadcast(realSessionId, { type: 'session-complete', sessionId: realSessionId, result })
      wsHub.clearBuffer(realSessionId)
      sessionManager.invalidateSessionsCache(session.projectCwd)

      // Re-evaluate title on every session complete
      if (!realSessionId.startsWith('pending-')) {
        maybeGenerateTitle(realSessionId).then((title) => {
          if (title) {
            sessionManager.invalidateSessionsCache(session.projectCwd)
            wsHub.broadcast(realSessionId, { type: 'session-title-updated', sessionId: realSessionId, title })
          }
        }).catch(() => {})
      }

      // Push context usage immediately after session completes
      if (session.getContextUsage) {
        session.getContextUsage().then((resp: any) => {
          const usage = resp?.response ?? resp
          if (usage) {
            wsHub.broadcast(realSessionId, {
              type: 'context-usage',
              sessionId: realSessionId,
              categories: usage.categories ?? [],
              totalTokens: usage.totalTokens ?? 0,
              maxTokens: usage.maxTokens ?? 0,
              percentage: usage.percentage ?? 0,
              model: usage.model ?? '',
            } as any)
          }
        }).catch(() => {})
      }

      // Forwarded busy-turn messages stay local-only until Claude Code
      // replays the same uuid back to us.

    })

    session.on('error', (err: Error) => {
      wsHub.broadcast(realSessionId, { type: 'error', message: err.message, code: 'internal' })
      // A process/transport failure means any still-unconfirmed local pending
      // message can no longer be promoted into shared session history.
      markAllLocalPendingFailed(
        realSessionId,
        'Claude Code exited before pending messages were confirmed',
      )
    })
  }

  // ======== Send Message ========

  async function handleSendMessage(
    connectionId: string,
    sessionId: string | null,
    clientMessageId: string,
    prompt: string,
    options?: MessageOptions,
    sessionName?: string,
  ) {
    let effectiveSessionId = sessionId
    const messageId = clientMessageId || randomUUID()

    // ── Named Session: resolve sessionName → sessionId via customTitle ──
    if (!effectiveSessionId && sessionName && options?.cwd) {
      const found = await sessionManager.sessionStorage.findByCustomTitle(options.cwd, sessionName)
      if (found) {
        effectiveSessionId = found.sessionId
      }
      // If not found, fall through to create a new session (existing logic below)
    }

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
      // Track sessionName for the pending session → will be set as customTitle after session-id-changed
      if (sessionName) {
        (session as any).__pendingSessionName = sessionName
      }
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
        session = await sessionManager.resumeSession(effectiveSessionId, options?.cwd)
      }
    }

    const command: UserCommand = {
      id: messageId,
      value: prompt,
      images: options?.images,
      options,
    }

    const sessionBusy = session.status === 'running' || session.status === 'awaiting_approval' || session.status === 'awaiting_user_input'
    if (sessionBusy && effectiveSessionId && !effectiveSessionId.startsWith('pending-')) {
      // Busy-turn submissions remain local-only in the UI until Claude Code
      // replays the same uuid, but we still forward them immediately so the
      // CLI stays authoritative about what was actually consumed.
      const pendingSubmission: LocalPendingSubmission = {
        id: messageId,
        sessionId: effectiveSessionId,
        connectionId,
        value: prompt,
        addedAt: Date.now(),
        status: 'pending',
        options,
      }
      storeLocalPending(effectiveSessionId, pendingSubmission)
      forwardLocalPendingSubmission(connectionId, effectiveSessionId, session, pendingSubmission)
      return
    }

    // Idle path keeps the existing optimistic shared user-message behavior.
    executeCommands(connectionId, effectiveSessionId!, session, [command])
  }

  /**
   * Execute one or more user commands as a single turn.
   * Each command is broadcast as a separate user message with its own UUID.
   * Only the first command applies options (permissionMode, thinkingMode, effort).
   *
   * Mirrors Claude Code handlePromptSubmit.ts executeUserInput() (line 448-522):
   * for (let i = 0; i < commands.length; i++) { processUserInput(...) }
   */
  function executeCommands(
    connectionId: string,
    sessionId: string,
    session: CliSession,
    commands: UserCommand[],
  ) {
    if (commands.length === 0) return

    const isPending = sessionId.startsWith('pending-')

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i]!
      const isFirst = i === 0

      // Build content blocks for broadcast
      const broadcastContent: any[] = []
      if (isFirst && cmd.images) {
        for (const img of cmd.images) {
          broadcastContent.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })
        }
      }
      if (cmd.value) {
        broadcastContent.push({ type: 'text', text: cmd.value })
      }

      // Apply per-message options only on first command (mirrors skipAttachments: !isFirst)
      if (isFirst && cmd.options) {
        if (cmd.options.permissionMode) {
          session.setPermissionMode(cmd.options.permissionMode as PermissionMode).catch(() => {})
        }
        if (cmd.options.thinkingMode) {
          if (cmd.options.thinkingMode === 'disabled') session.setThinking?.(0)
          else session.setThinking?.(null)
        }
        if (cmd.options.effort) session.setEffort?.(cmd.options.effort)
      }

      // Bind events only on first command
      if (isFirst) {
        bindSessionEvents(
          session,
          sessionId,
          connectionId,
          isPending ? { prompt: cmd.value, content: broadcastContent, uuid: cmd.id } : undefined,
        )
      }

      // Broadcast user message (each command keeps its own UUID)
      // Skip for pending — deferred until session-id-changed
      if (!isPending) {
        wsHub.broadcast(sessionId, {
          type: 'agent-message',
          sessionId,
          message: { type: 'user', uuid: cmd.id, message: { role: 'user', content: broadcastContent } },
        } as any)
      }

      // For batched prompt commands, join values into single send
      // For single commands, send as-is
    }

    const firstCmd = commands[0]!
    const promptValue = commands.length === 1
      ? firstCmd.value
      : commands.map(cmd => cmd.value).join('\n')
    session.send(promptValue, {
      cwd: firstCmd.options?.cwd,
      images: firstCmd.images,
      effort: firstCmd.options?.effort as any,
      thinkingMode: firstCmd.options?.thinkingMode as any,
      uuid: firstCmd.id,
    })
  }

  function forwardLocalPendingSubmission(
    connectionId: string,
    sessionId: string,
    session: CliSession,
    submission: LocalPendingSubmission,
  ): void {
    if (session.status === 'idle') {
      bindSessionEvents(session, sessionId, connectionId)
    }

    const sent = session.send(submission.value, {
      cwd: submission.options?.cwd,
      images: submission.options?.images,
      priority: 'next',
      uuid: submission.id,
    })

    if (!sent) {
      markLocalPendingFailed(sessionId, submission.id, 'Failed to deliver message to Claude Code')
      return
    }

    session.trackForwardedMessage(submission.id)
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

        markAllLocalPendingFailed(entry.sessionId, 'Session was replaced before pending messages were confirmed')
        session.close()
        sessionManager.removeActive(entry.sessionId)

        const newSession = sessionManager.createSession(session.projectCwd, {
          model: session.model,
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
    // Interrupt the active turn first, then try to retract any still-local
    // async messages from Claude Code's internal queue. Items that were
    // already consumed will simply continue toward replay/ack.
    const session = sessionManager.getActive(sessionId) as CliSession | undefined
    if (session) {
      await session.abort()
      void cancelLocalPendingAfterAbort(session, sessionId, connectionId)
    }
    wsHub.broadcast(sessionId, { type: 'session-aborted', sessionId } as any)
  }

  async function handleRetryLocalPending(connectionId: string, sessionId: string, id: string) {
    const items = localPendingBySession.get(sessionId)
    const existing = items?.get(id)
    if (!existing || existing.connectionId !== connectionId || existing.status !== 'failed') {
      return
    }
    if (!lockManager.isHolder(sessionId, connectionId)) {
      wsHub.sendTo(connectionId, { type: 'error', message: 'Not lock holder', code: 'not_lock_holder' })
      return
    }

    const session = (sessionManager.getActive(sessionId) as CliSession | undefined)
      ?? await sessionManager.resumeSession(sessionId, existing.options?.cwd)

    const newId = randomUUID()
    removeLocalPending(sessionId, id)

    const retrySubmission: LocalPendingSubmission = {
      ...existing,
      id: newId,
      sessionId,
      connectionId,
      addedAt: Date.now(),
      status: 'pending',
      errorMessage: undefined,
    }
    storeLocalPending(sessionId, retrySubmission)
    forwardLocalPendingSubmission(connectionId, sessionId, session, retrySubmission)
  }

  function handleDismissLocalPending(connectionId: string, sessionId: string, id: string) {
    const items = localPendingBySession.get(sessionId)
    const existing = items?.get(id)
    if (!existing || existing.connectionId !== connectionId) {
      return
    }
    removeLocalPending(sessionId, id)
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

      const newSession = sessionManager.createSession(cwd, {
        model: (session as CliSession)?.model,
      })
      // Set resumeSessionId + forkSession so CLI spawns with --resume --fork-session
      ;(newSession as any)._resumeSessionId = sessionId
      ;(newSession as any)._forkSession = true
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
    // Cancel any pending close-triggered release so the lock can be transferred
    cancelPendingLockRelease(previousConnectionId)
    transferLocalPending(previousConnectionId, connectionId)
    const lockedSessions = lockManager.getLockedSessions(previousConnectionId)
    for (const sid of lockedSessions) {
      // Transfer lock to new connection, preserving timeout state
      lockManager.transfer(sid, connectionId)
      wsHub.broadcast(sid, { type: 'lock-status', sessionId: sid, status: 'locked', holderId: connectionId })
      // Ensure timeout is running if session is not actively running
      const session = sessionManager.getActive(sid)
      if (!session || session.status !== 'running') {
        lockManager.startTimeout(sid)
      }
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
