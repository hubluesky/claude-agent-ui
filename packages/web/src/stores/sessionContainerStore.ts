import { create } from 'zustand'
import type {
  AgentMessage,
  SessionStatus,
  ClientLockStatus,
  ToolApprovalRequest,
  AskUserRequest,
  PlanApprovalRequest,
  ContextUsageCategory,
  McpServerStatusInfo,
} from '@claude-agent-ui/shared'

// ─── Types migrated from connectionStore ───

export interface ModelInfo {
  value: string
  displayName: string
  description: string
  supportsAutoMode?: boolean
  supportedEffortLevels?: string[]
}

export interface AccountInfo {
  email?: string
  organization?: string
  subscriptionType?: string
  apiProvider?: string
  model?: string
}

export interface ContextUsage {
  categories: ContextUsageCategory[]
  totalTokens: number
  maxTokens: number
  percentage: number
  model: string
}

export type McpServerInfo = McpServerStatusInfo

export interface ResolvedPlanApproval {
  planContent: string
  planFilePath: string
  allowedPrompts: { tool: string; prompt: string }[]
  decision: string
}

// ─── SessionContainer ───

export interface SessionContainer {
  sessionId: string
  projectCwd: string
  messages: AgentMessage[]
  hasMore: boolean
  isLoadingHistory: boolean
  isLoadingMore: boolean
  pendingApproval: (ToolApprovalRequest & { readonly: boolean }) | null
  pendingAskUser: (AskUserRequest & { readonly: boolean }) | null
  pendingPlanApproval: (PlanApprovalRequest & { readonly: boolean; contextUsagePercent?: number }) | null
  resolvedPlanApproval: ResolvedPlanApproval | null
  planModalOpen: boolean
  sessionStatus: SessionStatus
  lockStatus: ClientLockStatus
  lockHolder: string | null
  contextUsage: ContextUsage | null
  mcpServers: McpServerInfo[]
  rewindPreview: { filesChanged?: string[]; insertions?: number; deletions?: number; canRewind?: boolean; error?: string } | null
  subagentMessages: { agentId: string; messages: any[] } | null
  subscribed: boolean
  lastSeq: number
  needsFullSync: boolean
}

// ─── StreamState (mutable, per-container, NOT in Zustand) ───

export class StreamState {
  accumulator = new Map<number, { blockType: string; content: string }>()
  pendingDeltaText = ''
  pendingDeltaRafId: number | null = null

  clear() {
    this.accumulator.clear()
    this.pendingDeltaText = ''
    if (this.pendingDeltaRafId !== null) {
      cancelAnimationFrame(this.pendingDeltaRafId)
      this.pendingDeltaRafId = null
    }
  }
}

// ─── Global connection state (not per-session) ───

export interface GlobalConnectionState {
  connectionId: string | null
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
  accountInfo: AccountInfo | null
  models: ModelInfo[]
}

// ─── Store interfaces ───

const MAX_HOT_CONTAINERS = 10

function createContainer(sessionId: string, cwd: string): SessionContainer {
  return {
    sessionId,
    projectCwd: cwd,
    messages: [],
    hasMore: false,
    isLoadingHistory: false,
    isLoadingMore: false,
    pendingApproval: null,
    pendingAskUser: null,
    pendingPlanApproval: null,
    resolvedPlanApproval: null,
    planModalOpen: false,
    sessionStatus: 'idle',
    lockStatus: 'idle',
    lockHolder: null,
    contextUsage: null,
    mcpServers: [],
    rewindPreview: null,
    subagentMessages: null,
    subscribed: false,
    lastSeq: 0,
    needsFullSync: false,
  }
}

/** Extract the plain text from a user message for matching */
function getUserText(msg: any): string {
  const content = msg?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
  }
  return ''
}

interface SessionContainerState {
  containers: Map<string, SessionContainer>
  streamStates: Map<string, StreamState>
  activeSessionId: string | null
  global: GlobalConnectionState
}

interface SessionContainerActions {
  /** Creates container with LRU eviction (MAX_HOT_CONTAINERS=10) */
  getOrCreate(sessionId: string, cwd: string): SessionContainer
  /** Removes container and clears stream state */
  remove(sessionId: string): void
  setActiveSession(sessionId: string | null): void
  /** For __new__ → real-id migration */
  migrateContainer(fromId: string, toId: string): void
  /** Push a message, deduplicating by uuid */
  pushMessage(sessionId: string, msg: AgentMessage): void
  replaceMessages(sessionId: string, msgs: AgentMessage[], hasMore: boolean): void
  /** Replaces an _optimistic user message with the server version */
  replaceOptimistic(sessionId: string, serverMsg: AgentMessage): void
  setLoadingHistory(sessionId: string, loading: boolean): void
  setLoadingMore(sessionId: string, loading: boolean): void
  setHasMore(sessionId: string, hasMore: boolean): void
  /** Appends text to the last assistant message's last text block */
  appendStreamingText(sessionId: string, text: string): void
  clearMessages(sessionId: string): void
  setApproval(sessionId: string, req: (ToolApprovalRequest & { readonly: boolean }) | null): void
  setAskUser(sessionId: string, req: (AskUserRequest & { readonly: boolean }) | null): void
  setPlanApproval(sessionId: string, req: (PlanApprovalRequest & { readonly: boolean; contextUsagePercent?: number }) | null): void
  setResolvedPlanApproval(sessionId: string, req: ResolvedPlanApproval | null): void
  setPlanModalOpen(sessionId: string, open: boolean): void
  setSessionStatus(sessionId: string, status: SessionStatus): void
  setLockStatus(sessionId: string, status: ClientLockStatus, holder?: string | null): void
  setContextUsage(sessionId: string, usage: ContextUsage | null): void
  setMcpServers(sessionId: string, servers: McpServerInfo[]): void
  setRewindPreview(sessionId: string, preview: SessionContainer['rewindPreview']): void
  setSubagentMessages(sessionId: string, data: SessionContainer['subagentMessages']): void
  setSubscribed(sessionId: string, subscribed: boolean): void
  setLastSeq(sessionId: string, seq: number): void
  setNeedsFullSync(sessionId: string, needs: boolean): void
  /** Partial update of global state */
  setGlobal(updates: Partial<GlobalConnectionState>): void
  /** Resets interaction state without clearing messages */
  resetSessionInteraction(sessionId: string): void
  /** Returns mutable StreamState, creates if needed */
  getStreamState(sessionId: string): StreamState
}

export const useSessionContainerStore = create<SessionContainerState & SessionContainerActions>((set, get) => ({
  containers: new Map(),
  streamStates: new Map(),
  activeSessionId: null,
  global: {
    connectionId: null,
    connectionStatus: 'disconnected',
    accountInfo: null,
    models: [],
  },

  getOrCreate(sessionId, cwd) {
    const { containers } = get()
    const existing = containers.get(sessionId)
    if (existing) return existing

    const container = createContainer(sessionId, cwd)
    const next = new Map(containers)
    next.set(sessionId, container)

    // LRU eviction: remove oldest entries beyond MAX_HOT_CONTAINERS
    if (next.size > MAX_HOT_CONTAINERS) {
      const { activeSessionId } = get()
      const keys = Array.from(next.keys())
      for (const key of keys) {
        if (next.size <= MAX_HOT_CONTAINERS) break
        // Never evict active session or subscribed (running) sessions
        if (key === activeSessionId || key === sessionId) continue
        const c = next.get(key)!
        if (c.subscribed) continue
        next.delete(key)
        // Also clean up stream state
        const { streamStates } = get()
        if (streamStates.has(key)) {
          streamStates.get(key)!.clear()
          const nextStreams = new Map(streamStates)
          nextStreams.delete(key)
          set({ streamStates: nextStreams })
        }
      }
    }

    set({ containers: next })
    return container
  },

  remove(sessionId) {
    const { containers, streamStates } = get()
    if (!containers.has(sessionId)) return
    const next = new Map(containers)
    next.delete(sessionId)
    // Clean up stream state
    const stream = streamStates.get(sessionId)
    if (stream) {
      stream.clear()
      const nextStreams = new Map(streamStates)
      nextStreams.delete(sessionId)
      set({ containers: next, streamStates: nextStreams })
      return
    }
    set({ containers: next })
  },

  setActiveSession(sessionId) {
    set({ activeSessionId: sessionId })
  },

  migrateContainer(fromId, toId) {
    const { containers, streamStates } = get()
    const container = containers.get(fromId)
    if (!container) return
    const nextContainers = new Map(containers)
    nextContainers.delete(fromId)
    nextContainers.set(toId, { ...container, sessionId: toId })
    // Migrate stream state if exists
    const stream = streamStates.get(fromId)
    if (stream) {
      const nextStreams = new Map(streamStates)
      nextStreams.delete(fromId)
      nextStreams.set(toId, stream)
      set({ containers: nextContainers, streamStates: nextStreams })
    } else {
      set({ containers: nextContainers })
    }
    // Update activeSessionId if it was pointing to fromId
    if (get().activeSessionId === fromId) {
      set({ activeSessionId: toId })
    }
  },

  pushMessage(sessionId, msg) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    // Deduplicate by uuid
    const uuid = (msg as any).uuid
    if (uuid && c.messages.some((m: any) => (m as any).uuid === uuid)) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, messages: [...c.messages, msg] })
    set({ containers: next })
  },

  replaceMessages(sessionId, msgs, hasMore) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, messages: msgs, hasMore, isLoadingHistory: false, isLoadingMore: false })
    set({ containers: next })
  },

  replaceOptimistic(sessionId, serverMsg) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const serverText = getUserText(serverMsg)
    const serverUuid = (serverMsg as any).uuid

    // 1. Deduplicate by uuid — if already in store (from API load), skip
    if (serverUuid && c.messages.some((m: any) => m.uuid === serverUuid)) return

    // 2. Try to replace an optimistic message with matching text
    const optIdx = c.messages.findIndex((m: any) =>
      m._optimistic && m.type === 'user' && getUserText(m) === serverText
    )
    const next = new Map(containers)
    if (optIdx >= 0) {
      const updated = [...c.messages]
      updated[optIdx] = serverMsg
      next.set(sessionId, { ...c, messages: updated })
    } else {
      // 3. No match — observer receiving a new message, append
      next.set(sessionId, { ...c, messages: [...c.messages, serverMsg] })
    }
    set({ containers: next })
  },

  setLoadingHistory(sessionId, loading) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, isLoadingHistory: loading })
    set({ containers: next })
  },

  setLoadingMore(sessionId, loading) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, isLoadingMore: loading })
    set({ containers: next })
  },

  setHasMore(sessionId, hasMore) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, hasMore })
    set({ containers: next })
  },

  appendStreamingText(sessionId, text) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    // Find the last _streaming_block and append text
    const messages = c.messages
    let found = false
    const updated = [...messages]
    for (let i = updated.length - 1; i >= 0; i--) {
      if ((updated[i] as any).type === '_streaming_block') {
        const prev = updated[i] as any
        updated[i] = { ...prev, _content: prev._content + text }
        found = true
        break
      }
    }
    if (!found) {
      console.warn('[sessionContainerStore:appendStreamingText] no _streaming_block found for session:', sessionId)
      return
    }
    const next = new Map(containers)
    next.set(sessionId, { ...c, messages: updated })
    set({ containers: next })
  },

  clearMessages(sessionId) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    // Also clear stream state
    const { streamStates } = get()
    const stream = streamStates.get(sessionId)
    if (stream) stream.clear()
    const next = new Map(containers)
    next.set(sessionId, { ...c, messages: [], hasMore: false })
    set({ containers: next })
  },

  setApproval(sessionId, req) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, pendingApproval: req })
    set({ containers: next })
  },

  setAskUser(sessionId, req) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, pendingAskUser: req })
    set({ containers: next })
  },

  setPlanApproval(sessionId, req) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, pendingPlanApproval: req })
    set({ containers: next })
  },

  setResolvedPlanApproval(sessionId, req) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, resolvedPlanApproval: req })
    set({ containers: next })
  },

  setPlanModalOpen(sessionId, open) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, planModalOpen: open })
    set({ containers: next })
  },

  setSessionStatus(sessionId, status) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, sessionStatus: status })
    set({ containers: next })
  },

  setLockStatus(sessionId, status, holder = null) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, lockStatus: status, lockHolder: holder })
    set({ containers: next })
  },

  setContextUsage(sessionId, usage) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, contextUsage: usage })
    set({ containers: next })
  },

  setMcpServers(sessionId, servers) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, mcpServers: servers })
    set({ containers: next })
  },

  setRewindPreview(sessionId, preview) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, rewindPreview: preview })
    set({ containers: next })
  },

  setSubagentMessages(sessionId, data) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, subagentMessages: data })
    set({ containers: next })
  },

  setSubscribed(sessionId, subscribed) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, subscribed })
    set({ containers: next })
  },

  setLastSeq(sessionId, seq) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, lastSeq: seq })
    set({ containers: next })
  },

  setNeedsFullSync(sessionId, needs) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, needsFullSync: needs })
    set({ containers: next })
  },

  setGlobal(updates) {
    set((state) => ({ global: { ...state.global, ...updates } }))
  },

  resetSessionInteraction(sessionId) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, {
      ...c,
      pendingApproval: null,
      pendingAskUser: null,
      pendingPlanApproval: null,
      resolvedPlanApproval: null,
      planModalOpen: false,
      sessionStatus: 'idle',
    })
    set({ containers: next })
  },

  getStreamState(sessionId) {
    const { streamStates } = get()
    const existing = streamStates.get(sessionId)
    if (existing) return existing
    const stream = new StreamState()
    const next = new Map(streamStates)
    next.set(sessionId, stream)
    set({ streamStates: next })
    return stream
  },
}))
