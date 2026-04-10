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
  private readonly HEARTBEAT_TIMEOUT = 90_000 // 3x server ping interval (30s) to tolerate delays

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
    this.send({ type: 'join-session', sessionId, lastSeq } as any)
    store().setSubscribed(sessionId, true)
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

  /** On reconnect: resubscribe all active containers with their lastSeq.
   *  Each session is only sent ONE request (join or subscribe, never both)
   *  to prevent duplicate buffer replays from the server. */
  private resubscribeAll() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const { containers } = useSessionContainerStore.getState()
    const activeId = useSessionStore.getState().currentSessionId

    for (const [sessionId, container] of containers) {
      if (!container.subscribed) continue
      const lastSeq = container.lastSeq

      if (sessionId === activeId) {
        // Active session: join (which also subscribes on server side)
        this.ws.send(JSON.stringify({ type: 'join-session', sessionId, lastSeq }))
      } else {
        // Background session: subscribe only
        this.ws.send(JSON.stringify({ type: 'subscribe-session', sessionId, lastSeq }))
      }
    }

    // If active session wasn't in containers (edge case), still join it
    if (activeId && activeId !== '__new__' && !containers.has(activeId)) {
      this.ws.send(JSON.stringify({ type: 'join-session', sessionId: activeId, lastSeq: 0 }))
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
    // Track message sequence number for reconnection replay.
    // The seq-based protocol guarantees no duplicates: server only sends
    // seq > lastSeq, and resubscribeAll sends exactly one request per session.
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
        const s = store()
        // Migrate optimistic messages from __new__ container to the real session
        const newContainer = s.containers.get('__new__')
        if (newContainer && newContainer.messages.length > 0) {
          s.migrateContainer('__new__', newId)
        } else {
          const cwd = sessState.currentProjectCwd ?? ''
          s.getOrCreate(newId, cwd)
        }
        sessState.setCurrentSessionId(newId)
        // Join the real session
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'join-session', sessionId: newId }))
        }
        // Refresh sidebar session list (force bypass cache — new session just created)
        if (sessState.currentProjectCwd) {
          sessState.invalidateProjectSessions(sessState.currentProjectCwd)
          sessState.loadProjectSessions(sessState.currentProjectCwd, true)
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

  /** Build content blocks from the stream accumulator.
   *  Only produces text/thinking blocks — tool_use comes from the final SDK message. */
  private buildContentFromAccumulator(
    accumulator: Map<number, { blockType: string; content: string }>
  ): any[] {
    const blocks: any[] = []
    const sorted = [...accumulator.entries()].sort((a, b) => a[0] - b[0])
    for (const [, entry] of sorted) {
      if (entry.blockType === 'thinking') {
        blocks.push({ type: 'thinking', thinking: entry.content })
      } else if (entry.blockType === 'text') {
        blocks.push({ type: 'text', text: entry.content })
      }
    }
    return blocks
  }

  /** Create an empty content block for the given type */
  private createEmptyBlock(blockType: string): any {
    if (blockType === 'thinking') return { type: 'thinking', thinking: '' }
    return { type: 'text', text: '' }
  }

  private handleStreamEvent(sessionId: string, agentMsg: AgentMessage) {
    const evt = (agentMsg as any).event
    if (!evt) return

    const s = store()
    const streamState = s.getStreamState(sessionId)

    if (evt.type === 'content_block_start') {
      const blockType = evt.content_block?.type ?? 'text'

      // ── Spinner timing ──
      if (streamState.requestStartTime === null) {
        streamState.requestStartTime = Date.now()
      }
      if (blockType === 'thinking') {
        streamState.spinnerMode = 'thinking'
        if (streamState.thinkingStartTime === null) {
          streamState.thinkingStartTime = Date.now()
        }
      } else if (blockType === 'text') {
        if (streamState.thinkingStartTime !== null && streamState.thinkingEndTime === null) {
          streamState.thinkingEndTime = Date.now()
        }
        streamState.spinnerMode = 'responding'
      } else if (blockType === 'tool_use' || blockType === 'server_tool_use') {
        streamState.spinnerMode = 'tool-use'
      }

      // Flush pending deltas before modifying the message structure
      this.flushStreamState(sessionId, streamState)

      const container = s.containers.get(sessionId)
      if (!container) return

      if (evt.index === 0) {
        // New response starting — finalize any previous streaming message first
        this.finalizeStreamingMessage(sessionId)

        // Clear stale accumulator entries and create streaming assistant message
        streamState.accumulator.clear()
        streamState.accumulator.set(0, { blockType, content: '' })

        const streamingMsg: any = {
          ...agentMsg,
          type: 'assistant',
          _streaming: true,
          message: {
            role: 'assistant',
            content: [this.createEmptyBlock(blockType)],
          },
        }
        const next = new Map(s.containers)
        next.set(sessionId, {
          ...container,
          messages: [...container.messages, streamingMsg],
          streamingVersion: container.streamingVersion + 1,
        })
        useSessionContainerStore.setState({ containers: next })
      } else {
        // Subsequent block in same response — append empty block to streaming message
        streamState.accumulator.set(evt.index, { blockType, content: '' })
        const messages = container.messages
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i] as any
          if (msg._streaming && msg.type === 'assistant') {
            const updatedContent = [...(msg.message?.content ?? []), this.createEmptyBlock(blockType)]
            const updated = [...messages]
            updated[i] = { ...msg, message: { ...msg.message, content: updatedContent } }
            const next = new Map(s.containers)
            next.set(sessionId, {
              ...container,
              messages: updated,
              streamingVersion: container.streamingVersion + 1,
            })
            useSessionContainerStore.setState({ containers: next })
            break
          }
        }
      }
    } else if (evt.type === 'content_block_delta') {
      const delta = evt.delta
      const deltaText = delta?.type === 'text_delta' ? (delta.text ?? '')
        : delta?.type === 'thinking_delta' ? (delta.thinking ?? '') : ''
      const acc = streamState.accumulator.get(evt.index)
      if (acc) {
        acc.content += deltaText
      }
      streamState.responseLength += deltaText.length

      // Accumulate in pendingDeltas for RAF batching (per block index)
      const prev = streamState.pendingDeltas.get(evt.index) ?? ''
      streamState.pendingDeltas.set(evt.index, prev + deltaText)

      if (streamState.pendingDeltaRafId === null) {
        streamState.pendingDeltaRafId = requestAnimationFrame(() => {
          this.flushStreamState(sessionId, streamState)
        })
      }
    }
  }

  /** Flush all accumulated pending deltas to the store */
  private flushStreamState(sessionId: string, streamState: StreamState) {
    streamState.pendingDeltaRafId = null
    if (streamState.pendingDeltas.size === 0) return
    const s = store()
    for (const [blockIndex, text] of streamState.pendingDeltas) {
      if (text) s.updateStreamingBlock(sessionId, blockIndex, text)
    }
    streamState.pendingDeltas.clear()
  }

  /**
   * Finalize the current streaming assistant message:
   * - Build final content from accumulator (text/thinking) + provided tool/metadata blocks
   * - Remove _streaming flag
   * - Clear stream state
   * Called by: content_block_start index=0 (new response) and handleSessionComplete
   */
  private finalizeStreamingMessage(sessionId: string, sdkMsg?: any) {
    const s = store()
    const streamState = s.getStreamState(sessionId)
    const container = s.containers.get(sessionId)
    if (!container) return

    const messages = container.messages
    const streamIdx = messages.findIndex(
      (m: any) => m._streaming && m.type === 'assistant'
    )
    if (streamIdx < 0) return

    // Build final content from accumulator
    const accumulatedContent = this.buildContentFromAccumulator(streamState.accumulator)

    // Extract tool/structural blocks from the SDK message (if provided)
    const sdkContent: any[] = sdkMsg?.message?.content ?? []
    const toolBlocks = sdkContent.filter(
      (b: any) => b.type === 'tool_use' || b.type === 'server_tool_use'
        || b.type === 'tool_result' || b.type === 'web_search_tool_result'
        || b.type === 'code_execution_tool_result'
    )
    const redactedBlocks = sdkContent.filter(
      (b: any) => b.type === 'redacted_thinking'
    )

    // If accumulator has content, use it; otherwise fall back to the streaming message's own content
    const streamingMsg = messages[streamIdx] as any
    const finalContent = accumulatedContent.length > 0
      ? [...accumulatedContent, ...redactedBlocks, ...toolBlocks]
      : [...(streamingMsg.message?.content ?? []), ...toolBlocks]

    // Build finalized message: merge SDK metadata if available
    const finalized: any = sdkMsg
      ? { ...sdkMsg, message: { ...sdkMsg.message, content: finalContent } }
      : { ...streamingMsg, message: { ...streamingMsg.message, content: finalContent } }
    delete finalized._streaming

    const updated = [...messages]
    updated[streamIdx] = finalized

    const next = new Map(s.containers)
    next.set(sessionId, { ...container, messages: updated })
    useSessionContainerStore.setState({ containers: next })

    streamState.clear()
  }

  private handleFinalAssistantMessage(sessionId: string, agentMsg: AgentMessage) {
    let s = store()
    const streamState = s.getStreamState(sessionId)

    // 1. Flush any buffered streaming text
    if (streamState.pendingDeltaRafId !== null) {
      cancelAnimationFrame(streamState.pendingDeltaRafId)
      streamState.pendingDeltaRafId = null
    }
    if (streamState.pendingDeltas.size > 0) {
      for (const [blockIndex, text] of streamState.pendingDeltas) {
        if (text) s.updateStreamingBlock(sessionId, blockIndex, text)
      }
      streamState.pendingDeltas.clear()
    }

    // 2. Re-read store after flush
    s = store()
    const container = s.containers.get(sessionId)
    if (!container) return

    const finalMsg = agentMsg as any
    const apiId = finalMsg.message?.id
    const messages = container.messages

    // 3. Find the streaming message
    const streamIdx = messages.findIndex(
      (m: any) => m._streaming && m.type === 'assistant'
    )

    // ── CASE A: Streaming is active — SDK sent a partial/final mid-stream ──
    // DON'T finalize. Only merge tool_use blocks and metadata into the streaming message.
    // The streaming message keeps _streaming:true and the accumulator stays intact.
    // True finalization happens at: content_block_start index=0 (next response) or session complete.
    if (streamIdx >= 0) {
      const sdkContent: any[] = finalMsg.message?.content ?? []
      const toolBlocks = sdkContent.filter(
        (b: any) => b.type === 'tool_use' || b.type === 'server_tool_use'
          || b.type === 'tool_result' || b.type === 'web_search_tool_result'
          || b.type === 'code_execution_tool_result'
      )
      // Only merge if there are tool blocks to add (most partials won't have any)
      if (toolBlocks.length > 0) {
        const streamingMsg = messages[streamIdx] as any
        const existingContent = streamingMsg.message?.content ?? []
        const updatedContent = [...existingContent, ...toolBlocks]
        const updated = [...messages]
        updated[streamIdx] = {
          ...streamingMsg,
          message: { ...streamingMsg.message, content: updatedContent },
          // Preserve metadata from SDK message (uuid, message.id, model)
          uuid: finalMsg.uuid ?? streamingMsg.uuid,
        }
        // Store the SDK message reference for later finalization
        if (apiId) {
          (updated[streamIdx] as any)._sdkMsgId = apiId
          if (finalMsg.message?.model) {
            updated[streamIdx] = {
              ...updated[streamIdx],
              message: { ...(updated[streamIdx] as any).message, id: apiId, model: finalMsg.message.model },
            }
          }
        }
        const next = new Map(s.containers)
        next.set(sessionId, { ...container, messages: updated })
        useSessionContainerStore.setState({ containers: next })
      } else if (apiId) {
        // No tool blocks but update metadata (API id, model) on the streaming message
        const streamingMsg = messages[streamIdx] as any
        const updated = [...messages]
        updated[streamIdx] = {
          ...streamingMsg,
          uuid: finalMsg.uuid ?? streamingMsg.uuid,
          message: {
            ...streamingMsg.message,
            id: apiId,
            model: finalMsg.message?.model ?? streamingMsg.message?.model,
          },
        }
        const next = new Map(s.containers)
        next.set(sessionId, { ...container, messages: updated })
        useSessionContainerStore.setState({ containers: next })
      }
      // DON'T clear streamState — streaming is still active
      return
    }

    // ── CASE B: No streaming message — fallback for history/no-stream-events ──
    // Deduplicate by API id, then push the SDK message directly.
    let base = messages
    if (apiId) {
      base = messages.filter((m: any) => {
        if (m.type === 'assistant' && (m as any).message?.id === apiId) return false
        return true
      })
    }

    const merged: any = { ...finalMsg }
    delete merged._streaming

    const nextContainers = new Map(s.containers)
    nextContainers.set(sessionId, { ...container, messages: [...base, merged] })
    useSessionContainerStore.setState({ containers: nextContainers })
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

    // idle → everyone can interact (readonly=false)
    // locked_self → I can interact (readonly=false)
    // locked_other → I cannot interact (readonly=true)
    const readonly = lockStatus === 'locked_other'
    const container = s.containers.get(sessionId)
    if (!container) return
    if (container.pendingAskUser) {
      s.setAskUser(sessionId, { ...container.pendingAskUser, readonly })
    }
    if (container.pendingApproval) {
      s.setApproval(sessionId, { ...container.pendingApproval, readonly })
    }
    if (container.pendingPlanApproval) {
      s.setPlanApproval(sessionId, { ...container.pendingPlanApproval, readonly })
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
    // Finalize any in-progress streaming message (with accumulated content)
    this.finalizeStreamingMessage(sessionId)
    // Safety net: clear any remaining _streaming flags
    s.clearStreamingFlag(sessionId)
    // Refresh session list in sidebar (force — session just completed, title may have changed)
    const sessStore = useSessionStore.getState()
    if (sessStore.currentProjectCwd) {
      sessStore.invalidateProjectSessions(sessStore.currentProjectCwd)
      sessStore.loadProjectSessions(sessStore.currentProjectCwd, true)
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
    // Refresh sidebar (force — new forked session)
    if (sessState.currentProjectCwd) {
      sessState.invalidateProjectSessions(sessState.currentProjectCwd)
      sessState.loadProjectSessions(sessState.currentProjectCwd, true)
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
    const snapshot = msg as any
    const sessionId = snapshot.sessionId as string | undefined
    if (!sessionId) return

    const s = store()
    const container = s.containers.get(sessionId)
    if (!container) return

    const streamState = s.getStreamState(sessionId)
    streamState.accumulator.clear()

    // Build content blocks from snapshot
    const contentBlocks: any[] = []
    for (const block of snapshot.blocks ?? []) {
      streamState.accumulator.set(block.index, {
        blockType: block.type,
        content: block.content ?? '',
      })
      if (block.type === 'thinking') {
        contentBlocks.push({ type: 'thinking', thinking: block.content ?? '' })
      } else {
        contentBlocks.push({ type: 'text', text: block.content ?? '' })
      }
    }

    if (contentBlocks.length === 0) return

    // Create a single streaming assistant message
    const streamingMsg: any = {
      type: 'assistant',
      _streaming: true,
      uuid: snapshot.messageId,
      message: { role: 'assistant', content: contentBlocks },
    }

    const next = new Map(s.containers)
    next.set(sessionId, {
      ...container,
      messages: [...container.messages, streamingMsg],
      streamingVersion: container.streamingVersion + 1,
    })
    useSessionContainerStore.setState({ containers: next })
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
        (m: any) => m._optimistic || (m as any)._streaming === true
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
