import { randomUUID } from 'crypto'
import type { WebSocket } from 'ws'
import type { C2SMessage, ToolApprovalDecision, PermissionMode, PlanApprovalDecision } from '@claude-agent-ui/shared'
import { TOOL_CATEGORIES } from '@claude-agent-ui/shared'
import type { WSHub } from './hub.js'
import type { LockManager } from './lock.js'
import type { SessionManager } from '../agent/manager.js'
import type { AgentSession } from '../agent/session.js'
import { V1QuerySession } from '../agent/v1-session.js'
import { forkSession } from '@anthropic-ai/claude-agent-sdk'

const EDIT_TOOLS: Set<string> = new Set(TOOL_CATEGORIES.edit)

export interface HandlerDeps {
  wsHub: WSHub
  lockManager: LockManager
  sessionManager: SessionManager
}

export function createWsHandler(deps: HandlerDeps) {
  const { wsHub, lockManager, sessionManager } = deps

  // requestId → full pending request data (for re-sending on client join/reconnect)
  interface PendingRequest {
    sessionId: string
    type: 'tool-approval' | 'ask-user' | 'plan-approval'
    toolName?: string
    // Full payload so we can re-send to joining clients
    payload: Record<string, unknown>
  }
  const pendingRequestMap = new Map<string, PendingRequest>()

  function resendPendingRequests(sessionId: string, connectionId: string, readonly: boolean) {
    for (const [, entry] of pendingRequestMap) {
      if (entry.sessionId !== sessionId) continue
      if (entry.type === 'tool-approval') {
        wsHub.sendTo(connectionId, { type: 'tool-approval-request', ...entry.payload, readonly } as any)
      } else if (entry.type === 'ask-user') {
        wsHub.sendTo(connectionId, { type: 'ask-user-request', ...entry.payload, readonly } as any)
      } else if (entry.type === 'plan-approval') {
        wsHub.sendTo(connectionId, { type: 'plan-approval', sessionId, ...entry.payload, readonly } as any)
      }
    }
  }

  // On lock release: just broadcast idle — clients claim manually if they want to respond
  lockManager.setOnRelease((sessionId: string) => {
    wsHub.broadcast(sessionId, { type: 'lock-status', sessionId, status: 'idle' })
  })

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
      case 'release-lock':
        handleReleaseLock(connectionId, msg.sessionId)
        break
      case 'claim-lock':
        handleClaimLock(connectionId, msg.sessionId)
        break
      case 'leave-session':
        wsHub.leaveSession(connectionId)
        break
      case 'resolve-plan-approval':
        await handleResolvePlanApproval(connectionId, msg.sessionId, msg.requestId, msg.decision, msg.feedback)
        break
      case 'stop-task': {
        const session = sessionManager.getActive(msg.sessionId)
        if (session && 'stopTask' in session) {
          (session as any).stopTask(msg.taskId).catch(() => {})
        }
        break
      }
      case 'set-model': {
        const session = sessionManager.getActive(msg.sessionId)
        if (session && 'setModel' in session) {
          (session as any).setModel(msg.model).catch(() => {})
        }
        break
      }
      case 'fork-session': {
        await handleForkSession(connectionId, msg.sessionId, msg.atMessageId)
        break
      }
    }
  }

  function handleJoinSession(connectionId: string, sessionId: string) {
    wsHub.joinSession(connectionId, sessionId)
    const lockHolder = lockManager.getHolder(sessionId)
    const activeSession = sessionManager.getActive(sessionId)
    const isLockHolder = lockHolder === connectionId
    wsHub.sendTo(connectionId, {
      type: 'session-state',
      sessionId,
      sessionStatus: activeSession?.status ?? 'idle',
      lockStatus: lockManager.getStatus(sessionId),
      lockHolderId: lockHolder ?? undefined,
      isLockHolder,
      permissionMode: activeSession?.permissionMode,
    })

    // Re-send any pending tool-approval or ask-user requests for this session
    resendPendingRequests(sessionId, connectionId, !isLockHolder)

    if (!lockHolder) {
      let hasPending = false
      for (const [, entry] of pendingRequestMap) {
        if (entry.sessionId === sessionId) { hasPending = true; break }
      }
      if (hasPending) {
        lockManager.acquire(sessionId, connectionId)
        wsHub.broadcast(sessionId, {
          type: 'lock-status',
          sessionId,
          status: 'locked',
          holderId: connectionId,
        })
        // Re-send pending requests as non-readonly since this client now holds lock
        resendPendingRequests(sessionId, connectionId, false)
      }
    }
  }

  async function handleSendMessage(
    connectionId: string,
    sessionId: string | null,
    prompt: string,
    options?: { cwd?: string; images?: any[]; thinkingMode?: string; effort?: string }
  ) {
    let effectiveSessionId = sessionId
    let session: AgentSession

    if (!effectiveSessionId) {
      if (!options?.cwd) {
        wsHub.sendTo(connectionId, { type: 'error', message: 'cwd is required for new sessions', code: 'internal' })
        return
      }
      session = sessionManager.createSession(options.cwd)
      effectiveSessionId = `pending-${connectionId}`
    } else {
      const lockResult = lockManager.acquire(effectiveSessionId, connectionId)
      if (!lockResult.success) {
        wsHub.sendTo(connectionId, {
          type: 'error',
          message: 'Session is locked by another client',
          code: 'session_locked',
        })
        return
      }

      session = sessionManager.getActive(effectiveSessionId) ?? await sessionManager.resumeSession(effectiveSessionId)
    }

    if (effectiveSessionId && !effectiveSessionId.startsWith('pending-')) {
      lockManager.acquire(effectiveSessionId, connectionId)
      wsHub.broadcast(effectiveSessionId, {
        type: 'lock-status',
        sessionId: effectiveSessionId,
        status: 'locked',
        holderId: connectionId,
      })
    }

    // Build content blocks for broadcast (includes images if present)
    const broadcastContent: any[] = []
    if (options?.images) {
      for (const img of options.images) {
        broadcastContent.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })
      }
    }
    if (prompt) {
      broadcastContent.push({ type: 'text', text: prompt })
    }

    bindSessionEvents(session, effectiveSessionId, connectionId, prompt, broadcastContent)

    // Broadcast user message to ALL clients (including sender).
    // The SDK does NOT echo user messages, so this is the only way observers see them.
    // Sender has an optimistic insert which will be matched and replaced by this broadcast.
    // For pending (new) sessions, the broadcast is deferred until session init in bindSessionEvents.
    const userMsgUuid = randomUUID()
    if (effectiveSessionId && !effectiveSessionId.startsWith('pending-')) {
      wsHub.broadcast(effectiveSessionId, {
        type: 'agent-message',
        sessionId: effectiveSessionId,
        message: {
          type: 'user',
          uuid: userMsgUuid,
          message: { role: 'user', content: broadcastContent },
        },
      } as any)
    }

    session.send(prompt, {
      cwd: options?.cwd,
      images: options?.images,
      effort: options?.effort as any,
      thinkingMode: options?.thinkingMode as any,
    })
  }

  function bindSessionEvents(session: AgentSession, sessionId: string, connectionId: string, prompt?: string, contentBlocks?: any[]) {
    // Remove ALL previous listeners to prevent accumulation across multiple sends,
    // and to ensure the latest connectionId is captured in closures.
    session.removeAllListeners()

    let realSessionId = sessionId
    let pendingUserPrompt = sessionId.startsWith('pending-') ? prompt : undefined
    let pendingContentBlocks = sessionId.startsWith('pending-') ? contentBlocks : undefined

    session.on('message', (msg: any) => {
      if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
        const newId = msg.session_id
        if (realSessionId.startsWith('pending-')) {
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

          // Broadcast the deferred user message now that we have a real session ID
          if (pendingUserPrompt || pendingContentBlocks) {
            wsHub.broadcast(newId, {
              type: 'agent-message',
              sessionId: newId,
              message: {
                type: 'user',
                uuid: randomUUID(),
                message: { role: 'user', content: pendingContentBlocks ?? [{ type: 'text', text: pendingUserPrompt }] },
              },
            } as any)
            pendingUserPrompt = undefined
            pendingContentBlocks = undefined
          }
        } else if (realSessionId !== newId) {
          sessionManager.registerActive(newId, session)
          realSessionId = newId
        }
      }

      // Skip user-typed messages from SDK — we already broadcast them in handleSendMessage.
      // But DO broadcast auto-generated user messages (tool_result) so clients see tool output.
      if (msg.type === 'user') {
        const content = msg.message?.content
        const isToolResult = Array.isArray(content) && content.some((b: any) => b.type === 'tool_result')
        if (!isToolResult) return
      }

      // Broadcast all other messages to ALL clients.
      wsHub.broadcast(realSessionId, {
        type: 'agent-message',
        sessionId: realSessionId,
        message: msg,
      })
    })

    session.on('tool-approval', (req) => {
      pendingRequestMap.set(req.requestId, {
        sessionId: realSessionId,
        type: 'tool-approval',
        toolName: req.toolName,
        payload: req,
      })
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
      pendingRequestMap.set(req.requestId, {
        sessionId: realSessionId,
        type: 'ask-user',
        payload: req,
      })
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

    session.on('plan-approval', (req) => {
      pendingRequestMap.set(req.requestId, {
        sessionId: realSessionId,
        type: 'plan-approval',
        payload: req,
      })
      wsHub.sendTo(connectionId, {
        type: 'plan-approval',
        sessionId: realSessionId,
        ...req,
        readonly: false,
      })
      wsHub.broadcastExcept(realSessionId, connectionId, {
        type: 'plan-approval',
        sessionId: realSessionId,
        ...req,
        readonly: true,
      })
    })

    session.on('commands', (commands) => {
      sessionManager.cacheCommands(commands)
      wsHub.broadcast(realSessionId, {
        type: 'slash-commands',
        sessionId: realSessionId,
        commands,
      })
    })

    session.on('models', (models: any[]) => {
      wsHub.broadcast(realSessionId, {
        type: 'models',
        sessionId: realSessionId,
        models: models.map((m: any) => ({
          value: m.value,
          displayName: m.displayName,
          description: m.description,
          supportsAutoMode: m.supportsAutoMode,
          supportedEffortLevels: m.supportedEffortLevels,
        })),
      })
    })

    session.on('account-info', (info: any) => {
      wsHub.broadcast(realSessionId, {
        type: 'account-info',
        sessionId: realSessionId,
        email: info.email,
        organization: info.organization,
        subscriptionType: info.subscriptionType,
        apiProvider: info.apiProvider,
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
      lockManager.resetIdleTimer(realSessionId)
      wsHub.broadcast(realSessionId, {
        type: 'session-complete',
        sessionId: realSessionId,
        result,
      })
    })

    session.on('error', (err) => {
      lockManager.resetIdleTimer(realSessionId)
      wsHub.broadcast(realSessionId, {
        type: 'error',
        message: err.message,
        code: 'internal',
      })
    })
  }

  function handleToolApprovalResponse(connectionId: string, requestId: string, decision: ToolApprovalDecision) {
    const entry = pendingRequestMap.get(requestId)
    if (!entry) return

    if (!lockManager.isHolder(entry.sessionId, connectionId)) {
      wsHub.sendTo(connectionId, { type: 'error', message: 'Not lock holder', code: 'not_lock_holder' })
      return
    }

    const session = sessionManager.getActive(entry.sessionId)
    if (!session) return

    session.resolveToolApproval(requestId, decision)
    lockManager.resetIdleTimer(entry.sessionId)
    pendingRequestMap.delete(requestId)

    // Broadcast to ALL clients (including sender) so everyone clears pendingApproval
    wsHub.broadcast(entry.sessionId, {
      type: 'tool-approval-resolved',
      requestId,
      decision: { behavior: decision.behavior, message: decision.behavior === 'deny' ? decision.message : undefined },
    })
  }

  function handleAskUserResponse(connectionId: string, requestId: string, answers: Record<string, string>) {
    const entry = pendingRequestMap.get(requestId)
    if (!entry) return

    if (!lockManager.isHolder(entry.sessionId, connectionId)) {
      wsHub.sendTo(connectionId, { type: 'error', message: 'Not lock holder', code: 'not_lock_holder' })
      return
    }

    const session = sessionManager.getActive(entry.sessionId)
    if (!session) return

    session.resolveAskUser(requestId, { answers })
    lockManager.resetIdleTimer(entry.sessionId)
    pendingRequestMap.delete(requestId)

    // Broadcast to ALL clients (including sender) so everyone clears pendingAskUser
    wsHub.broadcast(entry.sessionId, {
      type: 'ask-user-resolved',
      requestId,
      answers,
    })
  }

  async function handleResolvePlanApproval(
    connectionId: string,
    _sessionId: string,
    requestId: string,
    decision: PlanApprovalDecision['decision'],
    feedback?: string
  ) {
    const entry = pendingRequestMap.get(requestId)
    if (!entry) return

    if (!lockManager.isHolder(entry.sessionId, connectionId)) {
      wsHub.sendTo(connectionId, { type: 'error', message: 'Not lock holder', code: 'not_lock_holder' })
      return
    }

    const session = sessionManager.getActive(entry.sessionId)
    if (!session || !(session instanceof V1QuerySession)) return

    // 1. Switch permission mode BEFORE resolving — prevents race where SDK
    //    starts executing next tool before mode is updated
    try {
      switch (decision) {
        case 'clear-and-accept':
        case 'auto-accept':
          await session.setPermissionMode('acceptEdits')
          break
        case 'bypass':
          await session.setPermissionMode('bypassPermissions')
          break
        case 'manual':
          await session.setPermissionMode('default')
          break
        // 'feedback': keep plan mode, don't change
      }
    } catch {
      // Silently ignore mode change errors
    }

    // 2. Resolve the plan approval promise — SDK unblocks and uses the new mode
    session.resolvePlanApproval(requestId, { decision, feedback })
    lockManager.resetIdleTimer(entry.sessionId)
    pendingRequestMap.delete(requestId)

    // 3. Broadcast resolved to all clients
    wsHub.broadcast(entry.sessionId, {
      type: 'plan-approval-resolved',
      requestId,
      decision,
    })

    // 4. For clear-and-accept: mark session to start fresh (no resume) on next query
    //    This matches CLI behavior: clear context = new session without old conversation history
    if (decision === 'clear-and-accept' && session instanceof V1QuerySession) {
      session.markStartFresh()
    }
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

  async function handleForkSession(connectionId: string, sessionId: string, atMessageId?: string) {
    try {
      const result = await forkSession(sessionId, {
        upToMessageId: atMessageId,
      })
      wsHub.sendTo(connectionId, {
        type: 'session-forked',
        sessionId: result.sessionId,
        originalSessionId: sessionId,
      } as any)
    } catch (err: any) {
      wsHub.sendTo(connectionId, {
        type: 'error',
        message: `Fork failed: ${err.message ?? 'unknown error'}`,
        code: 'internal',
      })
    }
  }

  function handleReleaseLock(connectionId: string, sessionId: string) {
    if (!lockManager.isHolder(sessionId, connectionId)) {
      wsHub.sendTo(connectionId, { type: 'error', message: 'Not lock holder', code: 'not_lock_holder' })
      return
    }
    lockManager.release(sessionId)
  }

  function handleClaimLock(connectionId: string, sessionId: string) {
    const result = lockManager.acquire(sessionId, connectionId)
    if (!result.success) {
      wsHub.sendTo(connectionId, { type: 'error', message: 'Session already locked', code: 'session_locked' })
      return
    }
    wsHub.broadcast(sessionId, {
      type: 'lock-status',
      sessionId,
      status: 'locked',
      holderId: connectionId,
    })
    // Re-send pending requests as non-readonly to the new holder
    resendPendingRequests(sessionId, connectionId, false)
  }

  async function handleSetMode(connectionId: string, sessionId: string, mode: string) {
    const isIdle = lockManager.getStatus(sessionId) === 'idle'
    const isHolder = lockManager.isHolder(sessionId, connectionId)

    if (!isIdle && !isHolder) {
      wsHub.sendTo(connectionId, { type: 'error', message: 'Cannot change mode', code: 'not_lock_holder' })
      return
    }

    // Resolve pending approvals in the UI based on new mode
    resolvePendingApprovalsForMode(sessionId, mode as PermissionMode)

    const session = sessionManager.getActive(sessionId)
    if (session) {
      try {
        await session.setPermissionMode(mode as any)
      } catch {
        // Silently ignore — SDK may reject mode changes in certain states
      }
    }

    // Broadcast mode change to ALL clients (including sender for confirmation,
    // and other terminals so they stay in sync)
    wsHub.broadcast(sessionId, {
      type: 'mode-change',
      sessionId,
      mode: mode as PermissionMode,
    })
  }

  function resolvePendingApprovalsForMode(sessionId: string, mode: PermissionMode) {
    for (const [requestId, entry] of pendingRequestMap) {
      if (entry.sessionId !== sessionId) continue

      // Handle plan-approval entries separately
      if (entry.type === 'plan-approval') {
        let planDecision: string | null = null
        if (mode === 'auto' || mode === 'bypassPermissions') {
          planDecision = 'auto-accept'
        } else if (mode === 'dontAsk') {
          planDecision = 'feedback'
        }
        if (planDecision) {
          const session = sessionManager.getActive(sessionId)
          if (session instanceof V1QuerySession) {
            session.resolvePlanApproval(requestId, {
              decision: planDecision as any,
              feedback: planDecision === 'feedback' ? `Denied by ${mode} mode` : undefined,
            })
          }
          wsHub.broadcast(sessionId, {
            type: 'plan-approval-resolved',
            requestId,
            decision: planDecision,
          })
          pendingRequestMap.delete(requestId)
        }
        continue
      }

      // Handle tool-approval and ask-user entries
      let decision: { behavior: 'allow' | 'deny'; message?: string } | null = null

      switch (mode) {
        // Fully permissive: allow all pending
        case 'auto':
        case 'bypassPermissions':
          decision = { behavior: 'allow' }
          break

        // Edit-permissive: allow edit tools (+ read-only, but those won't be pending)
        case 'acceptEdits':
          if (entry.toolName && EDIT_TOOLS.has(entry.toolName)) {
            decision = { behavior: 'allow' }
          }
          break

        // Plan mode: deny pending write tools (read-only won't be pending)
        case 'plan':
          decision = { behavior: 'deny', message: 'Denied by plan mode' }
          break

        case 'dontAsk':
          decision = { behavior: 'deny', message: 'Denied by dontAsk mode' }
          break

        // Default: keep pending
        case 'default':
          break
      }

      if (decision) {
        wsHub.broadcast(sessionId, {
          type: 'tool-approval-resolved',
          requestId,
          decision,
        })
        pendingRequestMap.delete(requestId)
      }
    }
  }

  function handleReconnect(connectionId: string, previousConnectionId: string) {
    lockManager.onReconnect(previousConnectionId, connectionId)

    const oldClient = wsHub.getClient(previousConnectionId)
    if (oldClient?.sessionId) {
      wsHub.joinSession(connectionId, oldClient.sessionId)
    }
  }
}
