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
  QueueItemWire,
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
  subagentMessages: { agentId: string; messages: any[] } | null
  queue: QueueItemWire[]
  popBackCommands: QueueItemWire[] | null
  subscribed: boolean
  lastSeq: number
  needsFullSync: boolean
  streamingVersion: number
  // New: separated streaming state
  streaming: StreamingState
  spinnerMode: SpinnerMode | null
  requestStartTime: number | null
  thinkingStartTime: number | null
  thinkingEndTime: number | null
  responseLength: number
}

// ─── Streaming State (new: separated from messages) ───

export interface StreamingToolUse {
  id: string
  name: string
  input: string  // accumulated JSON string
}

export interface CompletedStreamingBlock {
  type: 'thinking' | 'text'
  content: string
}

export interface StreamingState {
  text: string | null
  thinking: string | null
  toolUses: StreamingToolUse[]
  completedBlocks: CompletedStreamingBlock[]
  model: string | null
}

function createStreamingState(): StreamingState {
  return { text: null, thinking: null, toolUses: [], completedBlocks: [], model: null }
}

export type SpinnerMode = 'requesting' | 'thinking' | 'responding' | 'tool-use'

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
    subagentMessages: null,
    queue: [],
    popBackCommands: null,
    subscribed: false,
    lastSeq: 0,
    needsFullSync: false,
    streamingVersion: 0,
    // New
    streaming: createStreamingState(),
    spinnerMode: null,
    requestStartTime: null,
    thinkingStartTime: null,
    thinkingEndTime: null,
    responseLength: 0,
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
  /** Atomically push a final assistant message AND clear its streaming content in one render.
   *  Eliminates the flash where streaming disappears but the message hasn't appeared yet. */
  pushMessageAndClearStreaming(sessionId: string, msg: AgentMessage): void
  replaceMessages(sessionId: string, msgs: AgentMessage[], hasMore: boolean): void
  /** Replaces an _optimistic user message with the server version */
  replaceOptimistic(sessionId: string, serverMsg: AgentMessage): void
  setLoadingHistory(sessionId: string, loading: boolean): void
  setLoadingMore(sessionId: string, loading: boolean): void
  setHasMore(sessionId: string, hasMore: boolean): void
  /** Increments streamingVersion (for scroll trigger on new content blocks) */
  incrementStreamingVersion(sessionId: string): void
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
  setSubagentMessages(sessionId: string, data: SessionContainer['subagentMessages']): void
  setQueue(sessionId: string, queue: QueueItemWire[]): void
  setPopBackCommands(sessionId: string, commands: QueueItemWire[] | null): void
  setSubscribed(sessionId: string, subscribed: boolean): void
  setLastSeq(sessionId: string, seq: number): void
  setNeedsFullSync(sessionId: string, needs: boolean): void
  /** Partial update of global state */
  setGlobal(updates: Partial<GlobalConnectionState>): void
  /** Resets interaction state without clearing messages */
  resetSessionInteraction(sessionId: string): void
  // Streaming methods
  updateStreamingText(sessionId: string, deltaText: string): void
  updateStreamingThinking(sessionId: string, deltaThinking: string): void
  addStreamingToolUse(sessionId: string, tool: StreamingToolUse): void
  updateStreamingToolInput(sessionId: string, toolIndex: number, deltaJson: string): void
  graduateStreamingBlock(sessionId: string, blockType: string): void
  clearStreaming(sessionId: string): void
  setStreamingModel(sessionId: string, model: string): void
  setSpinnerMode(sessionId: string, mode: SpinnerMode): void
}

export const useSessionContainerStore = create<SessionContainerState & SessionContainerActions>((set, get) => ({
  containers: new Map(),
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
      }
    }

    set({ containers: next })
    return container
  },

  remove(sessionId) {
    const { containers } = get()
    if (!containers.has(sessionId)) return
    const next = new Map(containers)
    next.delete(sessionId)
    set({ containers: next })
  },

  setActiveSession(sessionId) {
    set({ activeSessionId: sessionId })
  },

  migrateContainer(fromId, toId) {
    const { containers } = get()
    const container = containers.get(fromId)
    if (!container) return
    const nextContainers = new Map(containers)
    nextContainers.delete(fromId)
    nextContainers.set(toId, { ...container, sessionId: toId })
    set({ containers: nextContainers })
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

  pushMessageAndClearStreaming(sessionId, msg) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const uuid = (msg as any).uuid
    if (uuid && c.messages.some((m: any) => (m as any).uuid === uuid)) return

    // Each API turn produces exactly ONE final assistant message containing ALL
    // content blocks for that turn. Clear ALL streaming state — no selective
    // clearing needed.  This matches Claude Code's model where the final message
    // is the single source of truth for a completed turn.
    const next = new Map(containers)
    next.set(sessionId, {
      ...c,
      messages: [...c.messages, msg],
      streaming: createStreamingState(),
      streamingVersion: c.streamingVersion + 1,
    })
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

  incrementStreamingVersion(sessionId) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, streamingVersion: c.streamingVersion + 1 })
    set({ containers: next })
  },

  clearMessages(sessionId) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, messages: [], hasMore: false, streamingVersion: 0 })
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


  setSubagentMessages(sessionId, data) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, subagentMessages: data })
    set({ containers: next })
  },

  setQueue(sessionId, queue) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, queue })
    set({ containers: next })
  },

  setPopBackCommands(sessionId, commands) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, popBackCommands: commands })
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
    })
    set({ containers: next })
  },

  updateStreamingText(sessionId: string, deltaText: string) {
    const containers = new Map(get().containers)
    const c = containers.get(sessionId)
    if (!c) return
    containers.set(sessionId, {
      ...c,
      streaming: { ...c.streaming, text: (c.streaming.text ?? '') + deltaText },
      responseLength: c.responseLength + deltaText.length,
      streamingVersion: c.streamingVersion + 1,
    })
    set({ containers })
  },

  updateStreamingThinking(sessionId: string, deltaThinking: string) {
    const containers = new Map(get().containers)
    const c = containers.get(sessionId)
    if (!c) return
    containers.set(sessionId, {
      ...c,
      streaming: { ...c.streaming, thinking: (c.streaming.thinking ?? '') + deltaThinking },
      streamingVersion: c.streamingVersion + 1,
    })
    set({ containers })
  },

  addStreamingToolUse(sessionId: string, tool: StreamingToolUse) {
    const containers = new Map(get().containers)
    const c = containers.get(sessionId)
    if (!c) return
    const existing = c.streaming.toolUses.findIndex(t => t.id === tool.id)
    const toolUses = [...c.streaming.toolUses]
    if (existing >= 0) {
      toolUses[existing] = tool
    } else {
      toolUses.push(tool)
    }
    containers.set(sessionId, {
      ...c,
      streaming: { ...c.streaming, toolUses },
      streamingVersion: c.streamingVersion + 1,
    })
    set({ containers })
  },

  updateStreamingToolInput(sessionId: string, toolIndex: number, deltaJson: string) {
    const containers = new Map(get().containers)
    const c = containers.get(sessionId)
    if (!c) return
    const toolUses = [...c.streaming.toolUses]
    const tool = toolUses[toolIndex]
    if (!tool) return
    toolUses[toolIndex] = { ...tool, input: tool.input + deltaJson }
    containers.set(sessionId, {
      ...c,
      streaming: { ...c.streaming, toolUses },
      streamingVersion: c.streamingVersion + 1,
    })
    set({ containers })
  },

  graduateStreamingBlock(sessionId: string, blockType: string) {
    const containers = new Map(get().containers)
    const c = containers.get(sessionId)
    if (!c) return
    const completedBlocks = [...c.streaming.completedBlocks]
    if (blockType === 'thinking' && c.streaming.thinking !== null) {
      completedBlocks.push({ type: 'thinking', content: c.streaming.thinking })
    } else if (blockType === 'text' && c.streaming.text !== null) {
      completedBlocks.push({ type: 'text', content: c.streaming.text })
    }
    containers.set(sessionId, {
      ...c,
      streaming: {
        ...c.streaming,
        thinking: blockType === 'thinking' ? null : c.streaming.thinking,
        text: blockType === 'text' ? null : c.streaming.text,
        completedBlocks,
      },
      streamingVersion: c.streamingVersion + 1,
    })
    set({ containers })
  },

  clearStreaming(sessionId: string) {
    const containers = new Map(get().containers)
    const c = containers.get(sessionId)
    if (!c) return
    containers.set(sessionId, {
      ...c,
      streaming: createStreamingState(),
      spinnerMode: null,
      requestStartTime: null,
      thinkingStartTime: null,
      thinkingEndTime: null,
      responseLength: 0,
      streamingVersion: c.streamingVersion + 1,
    })
    set({ containers })
  },

  setStreamingModel(sessionId: string, model: string) {
    const containers = new Map(get().containers)
    const c = containers.get(sessionId)
    if (!c) return
    containers.set(sessionId, {
      ...c,
      streaming: { ...c.streaming, model },
    })
    set({ containers })
  },

  setSpinnerMode(sessionId: string, mode: SpinnerMode) {
    const containers = new Map(get().containers)
    const c = containers.get(sessionId)
    if (!c) return
    const updates: Partial<SessionContainer> = { spinnerMode: mode }
    if (mode === 'requesting' && c.requestStartTime === null) {
      updates.requestStartTime = Date.now()
    }
    if (mode === 'thinking' && c.thinkingStartTime === null) {
      updates.thinkingStartTime = Date.now()
    }
    if (mode === 'responding' && c.thinkingStartTime !== null && c.thinkingEndTime === null) {
      updates.thinkingEndTime = Date.now()
    }
    containers.set(sessionId, { ...c, ...updates })
    set({ containers })
  },
}))
