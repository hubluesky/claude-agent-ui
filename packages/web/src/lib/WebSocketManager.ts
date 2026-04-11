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
import { useSessionContainerStore } from '../stores/sessionContainerStore'
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

  // ── Streaming ────────────────────────────────────────────────
  private currentToolBlockIndex = new Map<string, number>()

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
      // Only handle close for the CURRENT socket. When the visibility handler
      // creates a new socket (e.g., after mobile screen unlock), the old socket's
      // close event fires later — it must not wipe the new socket's reference
      // or trigger a redundant reconnect, which would break the lock chain.
      if (this.ws !== socket) return

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
        this.handleSessionComplete(msg)
        break
      case 'session-aborted':
        this.handleSessionAborted(msg)
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
      case 'queue-updated':
        this.handleQueueUpdated(msg)
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
      if ((agentMsg as any)._partial) {
        // Partial assistant — extract tool_use blocks and model info, don't push to messages
        this.handlePartialAssistant(targetSessionId, agentMsg)
      } else {
        // Final assistant — atomically clear streaming AND push message in a single
        // Zustand set() call. This eliminates the flash where streaming disappears
        // but the message hasn't rendered yet (two separate set() calls would produce
        // an intermediate render with neither content visible).
        this.currentToolBlockIndex.delete(targetSessionId)
        s.pushMessageAndClearStreaming(targetSessionId, agentMsg)
      }
    } else {
      s.pushMessage(targetSessionId, agentMsg)
    }
  }

  private handleStreamEvent(sessionId: string, agentMsg: AgentMessage) {
    const evt = (agentMsg as any).event
    if (!evt) return

    const s = store()

    if (evt.type === 'content_block_start') {
      const blockType = evt.content_block?.type ?? 'text'

      // Set spinner mode based on block type
      if (blockType === 'thinking') {
        s.setSpinnerMode(sessionId, 'thinking')
      } else if (blockType === 'text') {
        s.setSpinnerMode(sessionId, 'responding')
      } else if (blockType === 'tool_use' || blockType === 'server_tool_use') {
        s.setSpinnerMode(sessionId, 'tool-use')
        // Add new streaming tool use
        const toolBlock = evt.content_block
        // Calculate the target index BEFORE adding (addStreamingToolUse creates a new Map,
        // so the stale `s` reference would give us the old length)
        const currentContainer = s.containers.get(sessionId)
        const nextToolIndex = currentContainer ? currentContainer.streaming.toolUses.length : 0
        s.addStreamingToolUse(sessionId, {
          id: toolBlock.id ?? `tool-${evt.index}`,
          name: toolBlock.name ?? '',
          input: '',
        })
        this.currentToolBlockIndex.set(sessionId, nextToolIndex)
      }
    } else if (evt.type === 'content_block_delta') {
      const delta = evt.delta
      if (delta?.type === 'text_delta' && delta.text) {
        s.updateStreamingText(sessionId, delta.text)
      } else if (delta?.type === 'thinking_delta' && delta.thinking) {
        s.updateStreamingThinking(sessionId, delta.thinking)
      } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
        const toolIdx = this.currentToolBlockIndex.get(sessionId) ?? 0
        s.updateStreamingToolInput(sessionId, toolIdx, delta.partial_json)
      }
    } else if (evt.type === 'content_block_stop') {
      // Graduate completed block (e.g., thinking done → text starting next)
      const container = s.containers.get(sessionId)
      if (container) {
        if (container.streaming.thinking !== null) {
          s.graduateStreamingBlock(sessionId, 'thinking')
        } else if (container.streaming.text !== null) {
          s.graduateStreamingBlock(sessionId, 'text')
        }
      }
    }
    // message_start, message_stop — no action needed
  }

  private handlePartialAssistant(sessionId: string, agentMsg: AgentMessage) {
    const s = store()
    const msg = agentMsg as any

    // Extract model info
    if (msg.message?.model) {
      s.setStreamingModel(sessionId, msg.message.model)
    }

    // Extract complete tool_use blocks (partial assistant has full structure
    // vs stream_event's input_json_delta fragments)
    for (const block of msg.message?.content ?? []) {
      if (block.type === 'tool_use' || block.type === 'server_tool_use') {
        s.addStreamingToolUse(sessionId, {
          id: block.id,
          name: block.name,
          input: typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}),
        })
      }
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
    // Clear pending requests but preserve lock status
    s.setApproval(sessionId, null)
    s.setAskUser(sessionId, null)
    s.setPlanApproval(sessionId, null)
    s.setPlanModalOpen(sessionId, false)
    s.setQueue(sessionId, [])
    // Clear all streaming state
    s.clearStreaming(sessionId)
    this.currentToolBlockIndex.delete(sessionId)
    // Refresh session list in sidebar
    const sessStore = useSessionStore.getState()
    if (sessStore.currentProjectCwd) {
      sessStore.invalidateProjectSessions(sessStore.currentProjectCwd)
      sessStore.loadProjectSessions(sessStore.currentProjectCwd, true)
    }
  }

  private handleSessionAborted(msg: any) {
    const sessionId = (msg as any).sessionId as string | undefined
    if (!sessionId) return
    const s = store()
    s.setSessionStatus(sessionId, 'idle')
    s.setApproval(sessionId, null)
    s.setAskUser(sessionId, null)
    s.setPlanApproval(sessionId, null)
    s.setPlanModalOpen(sessionId, false)
    s.setQueue(sessionId, [])
    s.clearStreaming(sessionId)
    this.currentToolBlockIndex.delete(sessionId)
    // Pop queued prompts back to composer — only for lock holder (not readonly observers)
    const queuedPrompts = (msg as any).queuedPrompts as string[] | undefined
    const container = s.containers.get(sessionId)
    const amLockHolder = container?.lockStatus === 'locked_self'
    if (queuedPrompts && queuedPrompts.length > 0 && amLockHolder) {
      s.setPopBackPrompts(sessionId, queuedPrompts)
    }
    // Refresh session list
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

    // Rebuild streaming state from snapshot blocks
    for (const block of snapshot.blocks ?? []) {
      if (block.type === 'thinking') {
        s.updateStreamingThinking(sessionId, block.content ?? '')
      } else if (block.type === 'text') {
        s.updateStreamingText(sessionId, block.content ?? '')
      }
    }
    s.setSpinnerMode(sessionId, 'responding')
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

  private handleQueueUpdated(msg: any) {
    const sessionId = msg.sessionId as string | undefined
    if (!sessionId) return
    store().setQueue(sessionId, msg.queue ?? [])
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
      // Preserve live (optimistic) messages
      const live = container.messages.filter((m: any) => m._optimistic)
      s.replaceMessages(sessionId, [...(result.messages as AgentMessage[]), ...live], result.hasMore)
      s.setNeedsFullSync(sessionId, false)
    } catch (err) {
      console.error('[WSManager] doFullSync failed for session', sessionId, err)
    }
  }
}

// ── Singleton export ──────────────────────────────────────────
export const wsManager = new WebSocketManager()
