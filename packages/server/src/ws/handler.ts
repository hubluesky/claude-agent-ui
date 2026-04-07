import { randomUUID } from 'crypto'
import type { WebSocket } from 'ws'
import type { C2SMessage, ToolApprovalDecision, PermissionMode, PlanApprovalDecision } from '@claude-agent-ui/shared'
import { TOOL_CATEGORIES } from '@claude-agent-ui/shared'
import type { WSHub } from './hub.js'
import type { LockManager } from './lock.js'
import type { SessionManager } from '../agent/manager.js'
import type { AgentSession } from '../agent/session.js'
import { V1QuerySession } from '../agent/v1-session.js'
import { forkSession, getSubagentMessages, getSessionMessages } from '@anthropic-ai/claude-agent-sdk'

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

  // Start heartbeat and register dead connection handler
  wsHub.setOnDeadConnection((deadConnectionId) => {
    lockManager.onDisconnect(deadConnectionId)
  })
  wsHub.startHeartbeat()

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
      case 'get-context-usage': {
        await handleGetContextUsage(connectionId, msg.sessionId)
        break
      }
      case 'get-mcp-status': {
        await handleGetMcpStatus(connectionId, msg.sessionId)
        break
      }
      case 'toggle-mcp-server': {
        await handleToggleMcpServer(connectionId, msg.sessionId, msg.serverName, msg.enabled)
        break
      }
      case 'reconnect-mcp-server': {
        await handleReconnectMcpServer(connectionId, msg.sessionId, msg.serverName)
        break
      }
      case 'rewind-files': {
        await handleRewindFiles(connectionId, msg.sessionId, msg.messageId, msg.dryRun)
        break
      }
      case 'get-subagent-messages': {
        await handleGetSubagentMessages(connectionId, msg.sessionId, msg.agentId, msg.limit, msg.offset)
        break
      }
      case 'pong':
        wsHub.recordPong(connectionId)
        break
    }
  }

  function handleJoinSession(connectionId: string, sessionId: string, lastSeq?: number) {
    wsHub.joinSession(connectionId, sessionId)
    const lockHolder = lockManager.getHolder(sessionId)
    let activeSession = sessionManager.getActive(sessionId)
    const isLockHolder = lockHolder === connectionId

    // Warm up session for MCP/model/context data if not already active
    if (!activeSession && sessionId && sessionId !== '__new__') {
      sessionManager.resumeSession(sessionId).then((session) => {
        // Bind info events (models, account-info, mcp-status)
        session.on('models', (models: any[]) => {
          wsHub.broadcast(sessionId, {
            type: 'models',
            sessionId,
            models: models.map((m: any) => ({
              value: m.value, displayName: m.displayName, description: m.description,
              supportsAutoMode: m.supportsAutoMode, supportedEffortLevels: m.supportedEffortLevels,
            })),
          })
        })
        session.on('account-info', (info: any) => {
          wsHub.broadcast(sessionId, {
            type: 'account-info', sessionId,
            email: info.email, organization: info.organization,
            subscriptionType: info.subscriptionType, apiProvider: info.apiProvider,
          })
        })
        session.on('mcp-status', (servers: any[]) => {
          wsHub.broadcast(sessionId, { type: 'mcp-status', sessionId, servers })
        })
        session.on('context-usage', (usage: any) => {
          wsHub.broadcast(sessionId, {
            type: 'context-usage', sessionId,
            categories: usage.categories, totalTokens: usage.totalTokens,
            maxTokens: usage.maxTokens, percentage: usage.percentage, model: usage.model,
          })
        })
        // Trigger background init
        if ('warmUp' in session) (session as any).warmUp()
      }).catch(() => {})
    }
    wsHub.sendTo(connectionId, {
      type: 'session-state',
      sessionId,
      sessionStatus: activeSession?.status ?? 'idle',
      lockStatus: lockManager.getStatus(sessionId),
      lockHolderId: lockHolder ?? undefined,
      isLockHolder,
      permissionMode: activeSession?.permissionMode,
    })

    // Send stream snapshot FIRST if streaming is in progress (design spec order)
    const snapshot = wsHub.getStreamSnapshot(sessionId)
    if (snapshot) {
      wsHub.sendTo(connectionId, {
        type: 'stream-snapshot',
        sessionId,
        messageId: snapshot.messageId,
        blocks: snapshot.blocks,
      })
    }

    // Then replay buffered messages the client missed (with _seq for client tracking)
    const missed = wsHub.getBufferedAfter(sessionId, lastSeq)
    for (const entry of missed) {
      wsHub.sendTo(connectionId, { ...entry.message, _seq: entry.seq } as any)
    }

    // Send model name from session history (async, non-blocking)
    if (sessionId && sessionId !== '__new__') {
      getSessionMessages(sessionId).then((msgs: any[]) => {
        for (let i = msgs.length - 1; i >= 0; i--) {
          const model = msgs[i]?.message?.model
          if (msgs[i].type === 'assistant' && model) {
            wsHub.sendTo(connectionId, {
              type: 'account-info',
              sessionId,
              model,
            } as any)
            break
          }
        }
      }).catch(() => {})
    }

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
        resendPendingRequests(sessionId, connectionId, false)
      }
    }
  }

  async function handleSendMessage(
    connectionId: string,
    sessionId: string | null,
    prompt: string,
    options?: { cwd?: string; images?: any[]; thinkingMode?: string; effort?: string; permissionMode?: string }
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

    // Apply permission mode from client BEFORE binding events or sending,
    // so the session starts with the correct mode (not 'default')
    if (options?.permissionMode && session instanceof V1QuerySession) {
      try {
        await session.setPermissionMode(options.permissionMode as any)
      } catch { /* ignore — mode will be applied on next query */ }
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
          // Migrate pending requests from old session ID to new one
          for (const [, entry] of pendingRequestMap) {
            if (entry.sessionId === realSessionId) {
              entry.sessionId = newId
            }
          }
          // Migrate lock from old session ID to new one
          lockManager.release(realSessionId)
          lockManager.acquire(newId, connectionId)
          // Migrate session subscription to new ID
          wsHub.joinSession(connectionId, newId)
          // Broadcast lock status under new session ID
          wsHub.broadcast(newId, {
            type: 'lock-status',
            sessionId: newId,
            status: 'locked',
            holderId: connectionId,
          })
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

      // Update stream snapshot for streaming events
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
        // Don't buffer streaming events — they're tracked via snapshot
        wsHub.broadcastRaw(realSessionId, {
          type: 'agent-message',
          sessionId: realSessionId,
          message: msg,
        })
        return
      }

      // Clear stream snapshot when final assistant message arrives
      if (msg.type === 'assistant') {
        wsHub.clearStreamSnapshot(realSessionId)
      }

      // Broadcast and buffer all other messages to ALL clients
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
      // Approval requests are NOT buffered — resendPendingRequests handles reconnection.
      // Send directly to each client (lock holder gets readonly=false, others readonly=true).
      for (const connId of wsHub.getSessionClients(realSessionId)) {
        wsHub.sendTo(connId, {
          type: 'tool-approval-request',
          ...req,
          readonly: connId !== connectionId,
        })
      }
    })

    session.on('ask-user', (req) => {
      pendingRequestMap.set(req.requestId, {
        sessionId: realSessionId,
        type: 'ask-user',
        payload: req,
      })
      for (const connId of wsHub.getSessionClients(realSessionId)) {
        wsHub.sendTo(connId, {
          type: 'ask-user-request',
          ...req,
          readonly: connId !== connectionId,
        })
      }
    })

    session.on('plan-approval', (req) => {
      pendingRequestMap.set(req.requestId, {
        sessionId: realSessionId,
        type: 'plan-approval',
        payload: req,
      })
      for (const connId of wsHub.getSessionClients(realSessionId)) {
        wsHub.sendTo(connId, {
          type: 'plan-approval',
          sessionId: realSessionId,
          ...req,
          readonly: connId !== connectionId,
        })
      }
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

    session.on('mcp-status', (servers: any[]) => {
      wsHub.broadcast(realSessionId, {
        type: 'mcp-status',
        sessionId: realSessionId,
        servers,
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
      // Clean up buffer after session completes — messages are no longer needed
      wsHub.clearBuffer(realSessionId)
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

  function handleToolApprovalResponse(_connectionId: string, requestId: string, decision: ToolApprovalDecision) {
    const entry = pendingRequestMap.get(requestId)
    if (!entry) return

    // No lock check — any connected client can respond to approval requests.
    // Lock controls who can send new messages, not who can respond to pending approvals.

    const session = sessionManager.getActive(entry.sessionId)
    if (!session) return

    session.resolveToolApproval(requestId, decision)
    lockManager.resetIdleTimer(entry.sessionId)
    pendingRequestMap.delete(requestId)

    wsHub.broadcast(entry.sessionId, {
      type: 'tool-approval-resolved',
      requestId,
      decision: { behavior: decision.behavior, message: decision.behavior === 'deny' ? decision.message : undefined },
    })
  }

  function handleAskUserResponse(_connectionId: string, requestId: string, answers: Record<string, string>) {
    const entry = pendingRequestMap.get(requestId)
    if (!entry) return

    const session = sessionManager.getActive(entry.sessionId)
    if (!session) return

    session.resolveAskUser(requestId, { answers })
    lockManager.resetIdleTimer(entry.sessionId)
    pendingRequestMap.delete(requestId)

    wsHub.broadcast(entry.sessionId, {
      type: 'ask-user-resolved',
      requestId,
      answers,
    })
  }

  async function handleResolvePlanApproval(
    _connectionId: string,
    _sessionId: string,
    requestId: string,
    decision: PlanApprovalDecision['decision'],
    feedback?: string
  ) {
    const entry = pendingRequestMap.get(requestId)
    if (!entry) return

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

  async function handleGetContextUsage(connectionId: string, sessionId: string) {
    const session = sessionManager.getActive(sessionId)
    if (!session || !('getContextUsage' in session)) return
    try {
      const usage = await (session as any).getContextUsage()
      wsHub.sendTo(connectionId, {
        type: 'context-usage',
        sessionId,
        categories: usage.categories,
        totalTokens: usage.totalTokens,
        maxTokens: usage.maxTokens,
        percentage: usage.percentage,
        model: usage.model,
      })
    } catch {
      // Non-critical
    }
  }

  async function handleGetMcpStatus(connectionId: string, sessionId: string) {
    const session = sessionManager.getActive(sessionId)
    if (!session || !('getMcpStatus' in session)) return
    try {
      const servers = await (session as any).getMcpStatus()
      wsHub.sendTo(connectionId, {
        type: 'mcp-status',
        sessionId,
        servers,
      })
    } catch (err) {
      console.log(`[MCP-DEBUG] getMcpStatus error:`, err)
    }
  }

  async function handleToggleMcpServer(connectionId: string, sessionId: string, serverName: string, enabled: boolean) {
    const session = sessionManager.getActive(sessionId)
    if (!session || !('toggleMcpServer' in session)) return
    try {
      await (session as any).toggleMcpServer(serverName, enabled)
      // Refresh status after toggle
      await handleGetMcpStatus(connectionId, sessionId)
    } catch (err: any) {
      wsHub.sendTo(connectionId, { type: 'error', message: `MCP toggle failed: ${err.message}`, code: 'internal' })
    }
  }

  async function handleReconnectMcpServer(connectionId: string, sessionId: string, serverName: string) {
    const session = sessionManager.getActive(sessionId)
    if (!session || !('reconnectMcpServer' in session)) return
    try {
      await (session as any).reconnectMcpServer(serverName)
      await handleGetMcpStatus(connectionId, sessionId)
    } catch (err: any) {
      wsHub.sendTo(connectionId, { type: 'error', message: `MCP reconnect failed: ${err.message}`, code: 'internal' })
    }
  }

  async function handleRewindFiles(connectionId: string, sessionId: string, messageId: string, dryRun?: boolean) {
    const session = sessionManager.getActive(sessionId)
    if (!session || !('rewindFiles' in session)) return
    try {
      const result = await (session as any).rewindFiles(messageId, { dryRun: dryRun ?? false })
      wsHub.sendTo(connectionId, {
        type: 'rewind-result',
        sessionId,
        canRewind: result.canRewind,
        error: result.error,
        filesChanged: result.filesChanged,
        insertions: result.insertions,
        deletions: result.deletions,
        dryRun: dryRun ?? false,
      })
    } catch (err: any) {
      wsHub.sendTo(connectionId, { type: 'error', message: `Rewind failed: ${err.message}`, code: 'internal' })
    }
  }

  async function handleGetSubagentMessages(
    connectionId: string,
    sessionId: string,
    agentId: string,
    limit?: number,
    offset?: number
  ) {
    try {
      const session = sessionManager.getActive(sessionId)
      const cwd = session?.projectCwd
      const msgs = await getSubagentMessages(sessionId, agentId, {
        dir: cwd,
        limit: limit ?? 50,
        offset: offset ?? 0,
      })
      wsHub.sendTo(connectionId, {
        type: 'subagent-messages',
        sessionId,
        agentId,
        messages: msgs,
      })
    } catch (err: any) {
      wsHub.sendTo(connectionId, {
        type: 'error',
        message: `Failed to get subagent messages: ${err.message}`,
        code: 'internal',
      })
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
