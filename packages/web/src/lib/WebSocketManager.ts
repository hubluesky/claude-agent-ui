/**
 * WebSocketManager — Singleton WebSocket connection manager.
 *
 * Replaces the module-level global state in useWebSocket.ts with a proper class.
 * Routes messages by sessionId to the correct SessionContainer via sessionContainerStore.
 *
 * Key design:
 * - Single WebSocket connection, multiple session subscriptions
 * - Heartbeat timeout: 30s
 * - Exponential backoff reconnection: 1s → 2s → 4s → ... → 30s max
 * - Page visibility: pause heartbeat in background, fast reconnect on foreground
 * - On reconnect: resubscribe all active sessions with their lastSeq
 */

import type {
  S2CMessage,
  C2SMessage,
  ToolApprovalDecision,
  PlanApprovalDecisionType,
  AgentMessage,
} from '@claude-agent-ui/shared'
import { useSessionContainerStore, StreamState } from '../stores/sessionContainerStore'
import { useSessionStore } from '../stores/sessionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { fetchSessionMessages } from './api'
import { useToastStore } from '../components/chat/Toast'
import { useCommandStore } from '../stores/commandStore'

const CONNECTION_ID_KEY = 'claude-agent-ui-connection-id'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

// ── Helper: store access ──────────────────────────────────────
function store() {
  return useSessionContainerStore.getState()
}

class WebSocketManager {
  // ── Connection ───────────────────────────────────────────────
  private ws: WebSocket | null = null
  private state: ConnectionState = 'disconnected'
  private connectionId: string | null = null
  private previousConnectionId: string | null = null

  // ── Heartbeat ────────────────────────────────────────────────
  private heartbeatTimer = 0
  private readonly HEARTBEAT_TIMEOUT = 30_000

  // ── Reconnection ─────────────────────────────────────────────
  private reconnectTimer = 0
  private reconnectAttempt = 0
  private reconnectingBannerTimer = 0
  private readonly MAX_RECONNECT_DELAY = 30_000

  // ── Page visibility ──────────────────────────────────────────
  private visibilityHandler: (() => void) | null = null
  private lastBackgroundTime = 0

  constructor() {
    this.setupVisibilityListener()
  }

  // ════════════════════════════════════════════════════════════
  // Public API
  // ════════════════════════════════════════════════════════════

  connect() {
    this.doConnect()
  }

  disconnect() {
    this.clearTimers()
    this.ws?.close()
    this.ws = null
    this.setState('disconnected')
  }

  send(msg: C2SMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  /** Subscribe (observe) a session — receives messages but doesn't hold the lock */
  subscribe(sessionId: string, lastSeq = 0) {
    this.send({ type: 'subscribe-session', sessionId, lastSeq } as any)
    const s = store()
    s.setSubscribed(sessionId, true)
  }

  /** Unsubscribe from a session subscription */
  unsubscribe(sessionId: string) {
    this.send({ type: 'unsubscribe-session', sessionId } as any)
    store().setSubscribed(sessionId, false)
  }

  /** Join a session as the active/writing client */
  joinSession(sessionId: string, lastSeq = 0) {
    // Reset lastSeq in the container when joining
    store().setLastSeq(sessionId, 0)
    this.send({ type: 'join-session', sessionId, lastSeq } as any)
  }

  leaveSession() {
    this.send({ type: 'leave-session' } as any)
  }

  sendMessage(
    prompt: string,
    sessionId: string | null,
    options?: {
      cwd?: string
      images?: { data: string; mediaType: string }[]
      thinkingMode?: 'adaptive' | 'enabled' | 'disabled'
      effort?: 'low' | 'medium' | 'high' | 'max'
      permissionMode?: string
    }
  ) {
    this.send({ type: 'send-message', sessionId, prompt, options: options as any })
  }

  respondToolApproval(requestId: string, decision: ToolApprovalDecision) {
    this.send({ type: 'tool-approval-response', requestId, decision })
  }

  respondAskUser(requestId: string, answers: Record<string, string>) {
    this.send({ type: 'ask-user-response', requestId, answers })
  }

  respondPlanApproval(requestId: string, decision: PlanApprovalDecisionType, feedback?: string) {
    const sessionId = useSessionStore.getState().currentSessionId
    this.send({
      type: 'resolve-plan-approval',
      sessionId: sessionId!,
      requestId,
      decision,
      feedback,
    })
  }

  abort(sessionId: string) {
    this.send({ type: 'abort', sessionId })
  }

  releaseLock(sessionId: string) {
    this.send({ type: 'release-lock', sessionId })
  }

  claimLock(sessionId: string) {
    this.send({ type: 'claim-lock', sessionId })
  }

  setMode(sessionId: string, mode: string) {
    this.send({ type: 'set-mode', sessionId, mode } as any)
  }

  setEffort(sessionId: string, effort: string) {
    this.send({ type: 'set-effort', sessionId, effort } as any)
  }

  setModel(sessionId: string, model: string) {
    this.send({ type: 'set-model', sessionId, model } as any)
  }

  forkSession(sessionId: string, atMessageId?: string) {
    this.send({ type: 'fork-session', sessionId, atMessageId })
  }

  getContextUsage(sessionId: string) {
    this.send({ type: 'get-context-usage', sessionId })
  }

  getMcpStatus(sessionId: string) {
    this.send({ type: 'get-mcp-status', sessionId })
  }

  toggleMcpServer(sessionId: string, serverName: string, enabled: boolean) {
    this.send({ type: 'toggle-mcp-server', sessionId, serverName, enabled })
  }

  reconnectMcpServer(sessionId: string, serverName: string) {
    this.send({ type: 'reconnect-mcp-server', sessionId, serverName })
  }

  rewindFiles(sessionId: string, messageId: string, dryRun?: boolean) {
    this.send({ type: 'rewind-files', sessionId, messageId, dryRun })
  }

  getSubagentMessages(sessionId: string, agentId: string) {
    this.send({ type: 'get-subagent-messages', sessionId, agentId })
  }

  stopTask(sessionId: string) {
    this.send({ type: 'abort', sessionId })
  }

  getConnectionId(): string | null {
    return this.connectionId
  }

  getState(): ConnectionState {
    return this.state
  }

  // ════════════════════════════════════════════════════════════
  // Internal: Connection lifecycle
  // ════════════════════════════════════════════════════════════

  private setState(newState: ConnectionState) {
    this.state = newState
    store().setGlobal({ connectionStatus: newState })
  }

  private doConnect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${location.host}/ws`

    this.setState('connecting')
    const socket = new WebSocket(url)
    this.ws = socket

    socket.onopen = () => {
      // Cancel pending reconnecting banner
      if (this.reconnectingBannerTimer) {
        clearTimeout(this.reconnectingBannerTimer)
        this.reconnectingBannerTimer = 0
      }

      this.setState('connected')
      this.reconnectAttempt = 0

      // Send reconnect handshake with previous connection id
      const prevId = sessionStorage.getItem(CONNECTION_ID_KEY)
      if (prevId) {
        this.previousConnectionId = prevId
        socket.send(JSON.stringify({ type: 'reconnect', previousConnectionId: prevId }))
      }

      this.resubscribeAll()
      this.resetHeartbeat()
    }

    socket.onmessage = (event) => {
      try {
        const msg: S2CMessage = JSON.parse(event.data)
        this.handleMessage(msg)
      } catch (err) {
        console.error('[WSManager] Failed to parse message', err)
      }
    }

    socket.onclose = () => {
      this.ws = null
      this.stopHeartbeat()

      // Delay showing "reconnecting" banner by 1.5s to avoid flash on fast reconnect
      if (this.reconnectingBannerTimer) clearTimeout(this.reconnectingBannerTimer)
      this.reconnectingBannerTimer = window.setTimeout(() => {
        this.reconnectingBannerTimer = 0
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          this.setState('reconnecting')
        }
      }, 1500)

      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), this.MAX_RECONNECT_DELAY)
    this.reconnectAttempt++
    this.reconnectTimer = window.setTimeout(() => this.doConnect(), delay)
  }

  /** On reconnect: resubscribe all active containers with their lastSeq */
  private resubscribeAll() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const { containers } = useSessionContainerStore.getState()
    for (const [sessionId, container] of containers) {
      if (container.subscribed) {
        const lastSeq = container.lastSeq
        this.ws.send(JSON.stringify({ type: 'subscribe-session', sessionId, lastSeq } as any))
      }
    }

    // Also rejoin the active session
    const sessState = useSessionStore.getState()
    const activeId = sessState.currentSessionId
    if (activeId && activeId !== '__new__') {
      const container = containers.get(activeId)
      const lastSeq = container?.lastSeq ?? 0
      this.ws.send(JSON.stringify({ type: 'join-session', sessionId: activeId, lastSeq } as any))
    }
  }

  // ════════════════════════════════════════════════════════════
  // Internal: Heartbeat
  // ════════════════════════════════════════════════════════════

  private resetHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = window.setTimeout(() => {
      console.warn('[WSManager] Heartbeat timeout — forcing reconnect')
      this.ws?.close()
    }, this.HEARTBEAT_TIMEOUT)
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer)
      this.heartbeatTimer = 0
    }
  }

  // ════════════════════════════════════════════════════════════
  // Internal: Page visibility
  // ════════════════════════════════════════════════════════════

  private setupVisibilityListener() {
    if (typeof document === 'undefined') return
    this.visibilityHandler = () => {
      if (document.visibilityState === 'hidden') {
        this.lastBackgroundTime = Date.now()
        // Pause heartbeat — browsers throttle background timers, causing false timeouts
        this.stopHeartbeat()
      } else if (document.visibilityState === 'visible') {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          // Dead connection — reconnect immediately, skip backoff
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = 0
          }
          this.reconnectAttempt = 0
          this.doConnect()
        } else {
          // Still open — restart heartbeat monitoring
          this.resetHeartbeat()
          // Long background (>5min) — resubscribe all to catch up on missed messages
          const bgDuration = Date.now() - this.lastBackgroundTime
          if (bgDuration > 5 * 60 * 1000) {
            this.resubscribeAll()
          }
        }
      }
    }
    document.addEventListener('visibilitychange', this.visibilityHandler)
  }

  private removeVisibilityListener() {
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler)
      this.visibilityHandler = null
    }
  }

  // ════════════════════════════════════════════════════════════
  // Internal: Cleanup
  // ════════════════════════════════════════════════════════════

  private clearTimers() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = 0
    }
    if (this.reconnectingBannerTimer) {
      clearTimeout(this.reconnectingBannerTimer)
      this.reconnectingBannerTimer = 0
    }
    this.stopHeartbeat()
  }

  // ════════════════════════════════════════════════════════════
  // Internal: Message dispatcher
  // ════════════════════════════════════════════════════════════

  private handleMessage(msg: S2CMessage) {
    // Track message sequence number for reconnection replay
    const seq = (msg as any)._seq as number | undefined
    if (seq != null) {
      const sessionId = (msg as any).sessionId as string | undefined
      if (sessionId) {
        store().setLastSeq(sessionId, seq)
      }
    }

    switch (msg.type) {
      case 'init':
        this.handleInit(msg)
        break
      case 'session-state':
        this.handleSessionState(msg)
        break
      case 'agent-message':
        this.handleAgentMessage(msg)
        break
      case 'tool-approval-request':
        this.handleToolApprovalRequest(msg)
        break
      case 'tool-approval-resolved':
        this.handleToolApprovalResolved(msg)
        break
      case 'ask-user-request':
        this.handleAskUserRequest(msg)
        break
      case 'ask-user-resolved':
        this.handleAskUserResolved(msg)
        break
      case 'plan-approval':
        this.handlePlanApproval(msg)
        break
      case 'plan-approval-resolved':
        this.handlePlanApprovalResolved(msg)
        break
      case 'lock-status':
        this.handleLockStatus(msg)
        break
      case 'session-state-change':
        this.handleSessionStateChange(msg)
        break
      case 'mode-change':
        this.handleModeChange(msg)
        break
      case 'session-complete':
      case 'session-aborted':
        this.handleSessionComplete(msg)
        break
      case 'session-forked':
        this.handleSessionForked(msg)
        break
      case 'slash-commands':
        this.handleSlashCommands(msg)
        break
      case 'account-info':
        this.handleAccountInfo(msg)
        break
      case 'models':
        this.handleModels(msg)
        break
      case 'context-usage':
        this.handleContextUsage(msg)
        break
      case 'mcp-status':
        this.handleMcpStatus(msg)
        break
      case 'rewind-result':
        this.handleRewindResult(msg)
        break
      case 'subagent-messages':
        this.handleSubagentMessages(msg)
        break
      case 'stream-snapshot':
        this.handleStreamSnapshot(msg)
        break
      case 'session-title-updated':
        this.handleSessionTitleUpdated(msg)
        break
      case 'sync-result':
        this.handleSyncResult(msg)
        break
      case 'ping':
        this.handlePing()
        break
      case 'error':
        this.handleError(msg)
        break
      default:
        // Unknown message type — ignore
        break
    }
  }

  // ════════════════════════════════════════════════════════════
  // Internal: Message handlers
  // ════════════════════════════════════════════════════════════

  private handleInit(msg: any) {
    this.connectionId = msg.connectionId
    sessionStorage.setItem(CONNECTION_ID_KEY, msg.connectionId)
    store().setGlobal({ connectionId: msg.connectionId })
  }

  private handleSessionState(msg: any) {
    const sessionId = msg.sessionId as string
    if (!sessionId) return
    const s = store()
    // Ensure container exists (may not exist if we get state before joining)
    const container = s.containers.get(sessionId)
    if (!container) return

    s.setSessionStatus(sessionId, msg.sessionStatus)
    s.setLockStatus(
      sessionId,
      msg.lockStatus === 'idle' ? 'idle'
        : msg.isLockHolder ? 'locked_self' : 'locked_other',
      msg.lockHolderId ?? null
    )

    // Sync permission mode when joining a session
    if (msg.permissionMode) {
      useSettingsStore.getState().setPermissionMode(msg.permissionMode)
    }
  }

  private handleAgentMessage(msg: any) {
    const sessionId = msg.sessionId as string | undefined
    const agentMsg: AgentMessage = msg.message

    // ── 1. Handle system init: establishes/changes session context ──
    if (agentMsg.type === 'system' && (agentMsg as any).subtype === 'init' && (agentMsg as any).session_id) {
      const newId = (agentMsg as any).session_id as string
      const sessState = useSessionStore.getState()
      if (!sessState.currentSessionId || sessState.currentSessionId !== newId) {
        sessState.setCurrentSessionId(newId)
        // Ensure container exists for the new session
        const cwd = sessState.currentProjectCwd ?? ''
        store().getOrCreate(newId, cwd)
        // Join the real session
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'join-session', sessionId: newId }))
        }
        // Refresh sidebar session list
        if (sessState.currentProjectCwd) {
          sessState.loadProjectSessions(sessState.currentProjectCwd)
        }
      }
      // Capture model name from init
      if ((agentMsg as any).model) {
        const prev = store().global.accountInfo
        store().setGlobal({ accountInfo: { ...prev, model: (agentMsg as any).model } })
      }
    }

    // ── 2. Session guard: route to correct container ──
    // If no sessionId tag, fall back to the active session (legacy compat)
    const targetSessionId = sessionId ?? useSessionStore.getState().currentSessionId
    if (!sessionId) {
      console.warn('[WSManager] agent-message missing sessionId, falling back to active session:', targetSessionId)
    }
    if (!targetSessionId || targetSessionId === '__new__') return

    const s = store()
    const container = s.containers.get(targetSessionId)
    if (!container) return // Container not registered — drop message

    // ── 3. Route by message type ──
    if (agentMsg.type === 'stream_event') {
      this.handleStreamEvent(targetSessionId, agentMsg)
    } else if (agentMsg.type === 'user') {
      s.replaceOptimistic(targetSessionId, agentMsg)
    } else if (agentMsg.type === 'assistant') {
      this.handleFinalAssistantMessage(targetSessionId, agentMsg)
    } else {
      s.pushMessage(targetSessionId, agentMsg)
    }
  }

  private handleStreamEvent(sessionId: string, agentMsg: AgentMessage) {
    const evt = (agentMsg as any).event
    if (!evt) return

    const s = store()
    const streamState = s.getStreamState(sessionId)

    if (evt.type === 'content_block_start') {
      // Index 0 = new response starting → clear stale entries
      if (evt.index === 0) {
        streamState.accumulator.clear()
      }
      streamState.accumulator.set(evt.index, {
        blockType: evt.content_block?.type ?? 'text',
        content: '',
      })

      // Flush pending delta before creating new block
      this.flushStreamState(sessionId, streamState)

      // Push a new _streaming_block to the container
      const container = s.containers.get(sessionId)
      if (container) {
        const next = new Map(s.containers)
        next.set(sessionId, {
          ...container,
          messages: [
            ...container.messages,
            {
              ...agentMsg,
              type: '_streaming_block' as any,
              _blockType: evt.content_block?.type ?? 'text',
              _content: '',
              _index: evt.index,
            },
          ],
        })
        useSessionContainerStore.setState({ containers: next })
      }
    } else if (evt.type === 'content_block_delta') {
      const delta = evt.delta
      const acc = streamState.accumulator.get(evt.index)
      if (acc) {
        acc.content += delta?.type === 'text_delta' ? (delta.text ?? '')
          : delta?.type === 'thinking_delta' ? (delta.thinking ?? '') : ''
      }

      // Accumulate in pendingDeltaText for RAF batching
      streamState.pendingDeltaText += delta?.type === 'text_delta' ? (delta.text ?? '')
        : delta?.type === 'thinking_delta' ? (delta.thinking ?? '') : ''

      if (streamState.pendingDeltaRafId === null) {
        streamState.pendingDeltaRafId = requestAnimationFrame(() => {
          this.flushStreamState(sessionId, streamState)
        })
      }
    }
  }

  /** Flush accumulated pending delta text to the store */
  private flushStreamState(sessionId: string, streamState: StreamState) {
    streamState.pendingDeltaRafId = null
    if (!streamState.pendingDeltaText) return
    const text = streamState.pendingDeltaText
    streamState.pendingDeltaText = ''
    store().appendStreamingText(sessionId, text)
  }

  private handleFinalAssistantMessage(sessionId: string, agentMsg: AgentMessage) {
    const s = store()
    const container = s.containers.get(sessionId)
    if (!container) return

    const streamState = s.getStreamState(sessionId)

    // Flush any buffered streaming text
    if (streamState.pendingDeltaRafId !== null) {
      cancelAnimationFrame(streamState.pendingDeltaRafId)
      streamState.pendingDeltaRafId = null
    }
    if (streamState.pendingDeltaText) {
      const text = streamState.pendingDeltaText
      streamState.pendingDeltaText = ''
      s.appendStreamingText(sessionId, text)
    }

    const finalMsg = agentMsg as any
    const apiId = finalMsg.message?.id

    // Build streamed content map from accumulator
    const streamedByIndex = new Map<number, { blockType: string; content: string }>()
    for (const [idx, acc] of streamState.accumulator) {
      if (acc.content) {
        streamedByIndex.set(idx, { blockType: acc.blockType, content: acc.content })
      }
    }

    // Deduplicate: remove streaming blocks and previous assistant msg with same API id
    const current = s.containers.get(sessionId)?.messages ?? []
    const cleaned = current.filter((m: any) => {
      if (m.type === '_streaming_block') return false
      if (apiId && m.type === 'assistant' && (m as any).message?.id === apiId) return false
      return true
    })

    // Patch content blocks from accumulated stream content
    const contentBlocks: any[] = finalMsg.message?.content ?? []

    if (streamedByIndex.size > 0) {
      const usedIndices = new Set<number>()

      // Step 1: Patch existing empty blocks by matching TYPE
      for (const block of contentBlocks) {
        if (block.type === 'text' && !block.text) {
          for (const [idx, s2] of streamedByIndex) {
            if (s2.blockType === 'text' && s2.content && !usedIndices.has(idx)) {
              block.text = s2.content
              usedIndices.add(idx)
              break
            }
          }
        } else if (block.type === 'thinking' && !block.thinking) {
          for (const [idx, s2] of streamedByIndex) {
            if (s2.blockType === 'thinking' && s2.content && !usedIndices.has(idx)) {
              block.thinking = s2.content
              usedIndices.add(idx)
              break
            }
          }
        }
      }

      // Step 2: Insert accumulated text/thinking blocks MISSING from the message
      const hasText = contentBlocks.some((b: any) => b.type === 'text' && b.text)
      const hasThinking = contentBlocks.some((b: any) => b.type === 'thinking' && b.thinking)
      let insertedThinking: any = null
      let insertedText: any = null

      if (!hasThinking || !hasText) {
        for (const [idx, s2] of streamedByIndex) {
          if (usedIndices.has(idx)) continue
          if (!insertedThinking && s2.blockType === 'thinking' && s2.content && !hasThinking) {
            insertedThinking = { type: 'thinking', thinking: s2.content }
          } else if (!insertedText && s2.blockType === 'text' && s2.content && !hasText) {
            insertedText = { type: 'text', text: s2.content }
          }
          if ((insertedThinking || hasThinking) && (insertedText || hasText)) break
        }
      }

      if ((insertedThinking || insertedText) && finalMsg.message) {
        const inserts: any[] = []
        if (insertedThinking) inserts.push(insertedThinking)
        if (insertedText) inserts.push(insertedText)
        // Insert before tool_use blocks
        const toolIdx = contentBlocks.findIndex(
          (b: any) => b.type === 'tool_use' || b.type === 'server_tool_use'
        )
        if (toolIdx >= 0) {
          contentBlocks.splice(toolIdx, 0, ...inserts)
        } else {
          contentBlocks.push(...inserts)
        }
      }
    }

    // Check if the final message has actual content after patching
    const hasRealContent = contentBlocks.some(
      (b: any) =>
        (b.type === 'text' && b.text) ||
        (b.type === 'thinking' && b.thinking) ||
        b.type === 'tool_use' ||
        b.type === 'server_tool_use'
    )

    if (!hasRealContent && streamedByIndex.size > 0) {
      // Empty partial message — keep streaming blocks visible, skip this update
      return
    }

    // Write cleaned + patched final message to the container
    const nextContainers = new Map(s.containers)
    const c = s.containers.get(sessionId)
    if (c) {
      nextContainers.set(sessionId, { ...c, messages: [...cleaned, agentMsg] })
      useSessionContainerStore.setState({ containers: nextContainers })
    }
  }

  private handleToolApprovalRequest(msg: any) {
    const sessionId = msg.sessionId as string | undefined
    if (!sessionId) return
    store().setApproval(sessionId, {
      requestId: msg.requestId,
      toolName: msg.toolName,
      toolInput: msg.toolInput,
      toolUseID: msg.toolUseID,
      title: msg.title,
      displayName: msg.displayName,
      description: msg.description,
      agentID: msg.agentID,
      readonly: msg.readonly ?? false,
    })
  }

  private handleToolApprovalResolved(msg: any) {
    const sessionId = msg.sessionId as string | undefined
    if (!sessionId) return
    store().setApproval(sessionId, null)
  }

  private handleAskUserRequest(msg: any) {
    const sessionId = msg.sessionId as string | undefined
    if (!sessionId) return
    store().setAskUser(sessionId, {
      requestId: msg.requestId,
      questions: msg.questions,
      readonly: msg.readonly ?? false,
    })
  }

  private handleAskUserResolved(msg: any) {
    const sessionId = msg.sessionId as string | undefined
    if (!sessionId) return
    store().setAskUser(sessionId, null)
  }

  private handlePlanApproval(msg: any) {
    const sessionId = msg.sessionId as string | undefined
    if (!sessionId) return
    store().setPlanApproval(sessionId, {
      requestId: msg.requestId,
      planContent: msg.planContent,
      planFilePath: msg.planFilePath,
      allowedPrompts: msg.allowedPrompts,
      readonly: msg.readonly ?? false,
      contextUsagePercent: msg.contextUsagePercent,
    })
  }

  private handlePlanApprovalResolved(msg: any) {
    const sessionId = msg.sessionId as string | undefined
    if (!sessionId) return
    const s = store()
    const container = s.containers.get(sessionId)
    const pending = container?.pendingPlanApproval

    if (pending) {
      s.setResolvedPlanApproval(sessionId, {
        planContent: pending.planContent,
        planFilePath: pending.planFilePath,
        allowedPrompts: pending.allowedPrompts,
        decision: msg.decision ?? 'approved',
      })
    }
    s.setPlanApproval(sessionId, null)

    // Sync permission mode to match the plan approval decision
    const settings = useSettingsStore.getState()
    switch (msg.decision) {
      case 'clear-and-accept':
      case 'auto-accept':
        settings.setPermissionMode('acceptEdits')
        break
      case 'bypass':
        settings.setPermissionMode('bypassPermissions')
        break
      case 'manual':
        settings.setPermissionMode('default')
        break
      // 'feedback': stays in plan mode, no change
    }
  }

  private handleLockStatus(msg: any) {
    const sessionId = msg.sessionId as string | undefined
    if (!sessionId) return

    const s = store()
    const myId = this.connectionId
    const amIHolder = msg.status !== 'idle' && msg.holderId === myId

    const lockStatus = msg.status === 'idle' ? 'idle'
      : amIHolder ? 'locked_self' : 'locked_other'
    s.setLockStatus(sessionId, lockStatus, msg.holderId ?? null)

    // Sync readonly flag on pending requests when lock ownership changes
    const container = s.containers.get(sessionId)
    if (!container) return
    if (container.pendingAskUser) {
      s.setAskUser(sessionId, { ...container.pendingAskUser, readonly: !amIHolder })
    }
    if (container.pendingApproval) {
      s.setApproval(sessionId, { ...container.pendingApproval, readonly: !amIHolder })
    }
    if (container.pendingPlanApproval) {
      s.setPlanApproval(sessionId, { ...container.pendingPlanApproval, readonly: !amIHolder })
    }
  }

  private handleSessionStateChange(msg: any) {
    const sessionId = msg.sessionId as string | undefined
    if (!sessionId) return
    store().setSessionStatus(sessionId, msg.state)
  }

  private handleModeChange(msg: any) {
    useSettingsStore.getState().setPermissionMode(msg.mode)
  }

  private handleSessionComplete(msg: any) {
    const sessionId = (msg as any).sessionId as string | undefined
    if (!sessionId) return
    const s = store()
    s.setSessionStatus(sessionId, 'idle')
    // Clear pending requests but preserve lock status — lock persists across queries
    s.setApproval(sessionId, null)
    s.setAskUser(sessionId, null)
    s.setPlanApproval(sessionId, null)
    s.setPlanModalOpen(sessionId, false)
    // Refresh session list in sidebar
    const sessStore = useSessionStore.getState()
    if (sessStore.currentProjectCwd) {
      sessStore.loadProjectSessions(sessStore.currentProjectCwd)
    }
  }

  private handleSessionForked(msg: any) {
    const newId = (msg as any).sessionId as string
    const sessState = useSessionStore.getState()
    sessState.setCurrentSessionId(newId)
    // Join the new session
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'join-session', sessionId: newId }))
    }
    // Refresh sidebar
    if (sessState.currentProjectCwd) {
      sessState.loadProjectSessions(sessState.currentProjectCwd)
    }
  }

  private handleSlashCommands(msg: any) {
    useCommandStore.getState().setCommands(msg.commands)
  }

  private handleAccountInfo(msg: any) {
    const prev = store().global.accountInfo
    store().setGlobal({
      accountInfo: {
        ...prev,
        ...(msg.email != null && { email: msg.email }),
        ...(msg.organization != null && { organization: msg.organization }),
        ...(msg.subscriptionType != null && { subscriptionType: msg.subscriptionType }),
        ...(msg.apiProvider != null && { apiProvider: msg.apiProvider }),
        ...(msg.model != null && { model: msg.model }),
      },
    })
  }

  private handleModels(msg: any) {
    store().setGlobal({ models: msg.models ?? [] })
  }

  private handleContextUsage(msg: any) {
    const sessionId = msg.sessionId as string | undefined
    if (!sessionId) return
    store().setContextUsage(sessionId, {
      categories: msg.categories ?? [],
      totalTokens: msg.totalTokens ?? 0,
      maxTokens: msg.maxTokens ?? 0,
      percentage: msg.percentage ?? 0,
      model: msg.model ?? '',
    })
  }

  private handleMcpStatus(msg: any) {
    const sessionId = msg.sessionId as string | undefined
    if (!sessionId) return
    store().setMcpServers(sessionId, msg.servers ?? [])
  }

  private handleRewindResult(msg: any) {
    const sessionId = msg.sessionId as string | undefined
    if (!sessionId) return

    if (msg.dryRun) {
      store().setRewindPreview(sessionId, {
        canRewind: msg.canRewind,
        error: msg.error,
        filesChanged: msg.filesChanged,
        insertions: msg.insertions,
        deletions: msg.deletions,
      })
    } else if (msg.canRewind) {
      useToastStore.getState().add(
        `Rewound ${msg.filesChanged?.length ?? 0} files (+${msg.insertions ?? 0}/-${msg.deletions ?? 0})`,
        'info'
      )
    } else {
      useToastStore.getState().add(msg.error ?? 'Cannot rewind', 'error')
    }
  }

  private handleSubagentMessages(msg: any) {
    const sessionId = msg.sessionId as string | undefined
    if (!sessionId) return
    store().setSubagentMessages(sessionId, {
      agentId: msg.agentId,
      messages: msg.messages ?? [],
    })
  }

  private handleStreamSnapshot(msg: any) {
    // Reconnection: apply accumulated stream content as synthetic streaming blocks
    const snapshot = msg as any
    const sessionId = snapshot.sessionId as string | undefined
    if (!sessionId) return

    const s = store()
    const container = s.containers.get(sessionId)
    if (!container) return

    const streamState = s.getStreamState(sessionId)

    for (const block of snapshot.blocks ?? []) {
      // Feed into accumulator
      if (block.index === 0) {
        streamState.accumulator.clear()
      }
      streamState.accumulator.set(block.index, {
        blockType: block.type,
        content: block.content ?? '',
      })

      // Push _streaming_block for content_block_start
      const startEvent: AgentMessage = {
        type: 'stream_event',
        uuid: snapshot.messageId,
        event: {
          type: 'content_block_start',
          index: block.index,
          content_block: { type: block.type },
        },
      } as any

      const nextContainers1 = new Map(s.containers)
      const c1 = nextContainers1.get(sessionId)
      if (c1) {
        nextContainers1.set(sessionId, {
          ...c1,
          messages: [
            ...c1.messages,
            {
              ...startEvent,
              type: '_streaming_block' as any,
              _blockType: block.type,
              _content: '',
              _index: block.index,
            },
          ],
        })
        useSessionContainerStore.setState({ containers: nextContainers1 })
      }

      // Append the content via appendStreamingText
      if (block.content) {
        s.appendStreamingText(sessionId, block.content)
      }
    }
  }

  private handleSessionTitleUpdated(msg: any) {
    const titleMsg = msg as any
    const sessState = useSessionStore.getState()
    const sessions = new Map(sessState.sessions)
    for (const [cwd, list] of sessions) {
      const updated = list.map((s) =>
        s.sessionId === titleMsg.sessionId ? { ...s, title: titleMsg.title } : s
      )
      sessions.set(cwd, updated)
    }
    useSessionStore.setState({ sessions })
  }

  private handleSyncResult(msg: any) {
    const sessionId = msg.sessionId as string | undefined
    if (!sessionId) return

    // If server detected a gap in sequence numbers, do a full REST sync
    if (msg.hasGap) {
      store().setNeedsFullSync(sessionId, true)
      this.doFullSync(sessionId)
    }
  }

  private handlePing() {
    this.send({ type: 'pong' } as any)
    this.resetHeartbeat()
  }

  private handleError(msg: any) {
    console.error('[WSManager Error]', msg.message, msg.code)
    useToastStore.getState().add(msg.message, 'error')
  }

  // ════════════════════════════════════════════════════════════
  // Internal: REST fallback for full sync
  // ════════════════════════════════════════════════════════════

  private async doFullSync(sessionId: string) {
    try {
      const result = await fetchSessionMessages(sessionId, { limit: 50, offset: 0 })
      const s = store()
      const container = s.containers.get(sessionId)
      if (!container) return
      // Preserve live (optimistic + streaming) messages
      const live = container.messages.filter(
        (m: any) => m._optimistic || m.type === '_streaming_block'
      )
      s.replaceMessages(sessionId, [...(result.messages as AgentMessage[]), ...live], result.hasMore)
      s.setNeedsFullSync(sessionId, false)
    } catch (err) {
      console.error('[WSManager] doFullSync failed for session', sessionId, err)
    }
  }
}

// ── Singleton export ──────────────────────────────────────────
export const wsManager = new WebSocketManager()
