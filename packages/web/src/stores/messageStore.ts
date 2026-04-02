import { create } from 'zustand'
import type { AgentMessage } from '@claude-agent-ui/shared'
import { fetchSessionMessages } from '../lib/api'

interface SessionCache {
  messages: AgentMessage[]
  hasMore: boolean
}

interface MessageState {
  messages: AgentMessage[]
  hasMore: boolean
  isLoadingHistory: boolean
  isLoadingMore: boolean
  currentLoadedSessionId: string | null
  /** Per-session message cache so switching back is instant */
  _cache: Map<string, SessionCache>
}

interface MessageActions {
  loadInitial(sessionId: string): Promise<void>
  loadMore(): Promise<void>
  appendMessage(msg: AgentMessage): void
  appendStreamDelta(msg: AgentMessage): void
  /** Replace a matching optimistic user message with the server version, or append if no match */
  replaceOptimistic(serverMsg: AgentMessage): void
  clear(): void
  /** Save current session's messages into cache */
  _saveToCache(): void
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

const MAX_CACHED_SESSIONS = 10

// ── Streaming delta batching ─────────────────────────────────
// Accumulate rapid text deltas and flush to store at ~60fps via RAF
let _pendingDeltaText = ''
let _deltaRafId: number | null = null
let _storeGet: (() => MessageState & MessageActions) | null = null
let _storeSet: ((partial: Partial<MessageState>) => void) | null = null

function _flushStreamingDelta() {
  _deltaRafId = null
  if (!_pendingDeltaText || !_storeGet || !_storeSet) return
  const text = _pendingDeltaText
  _pendingDeltaText = ''
  const { messages } = _storeGet()
  const updated = [...messages]
  for (let i = updated.length - 1; i >= 0; i--) {
    if ((updated[i] as any).type === '_streaming_block') {
      const prev = updated[i] as any
      updated[i] = { ...prev, _content: prev._content + text }
      break
    }
  }
  _storeSet({ messages: updated })
}

/** Force-flush any buffered streaming text (call before cleaning streaming blocks) */
export function flushStreamingDelta() {
  if (_deltaRafId !== null) {
    cancelAnimationFrame(_deltaRafId)
    _deltaRafId = null
  }
  _flushStreamingDelta()
}

export const useMessageStore = create<MessageState & MessageActions>((set, get) => {
  // Capture store accessors for the RAF callback
  _storeGet = get as any
  _storeSet = set as any

  return {
  messages: [],
  hasMore: false,
  isLoadingHistory: false,
  isLoadingMore: false,
  currentLoadedSessionId: null,
  _cache: new Map(),

  _saveToCache() {
    const { currentLoadedSessionId, messages, hasMore, _cache } = get()
    if (!currentLoadedSessionId || messages.length === 0) return
    _cache.set(currentLoadedSessionId, { messages: [...messages], hasMore })
    // Evict oldest entries if cache grows too large
    if (_cache.size > MAX_CACHED_SESSIONS) {
      const first = _cache.keys().next().value
      if (first) _cache.delete(first)
    }
  },

  async loadInitial(sessionId: string) {
    const { messages: current, currentLoadedSessionId, _cache } = get()

    // If we already have messages for this session (from live WS), skip API load
    if (currentLoadedSessionId === sessionId && current.length > 0) return

    // Save current session to cache before switching
    get()._saveToCache()

    // Check cache — show instantly, then refresh from API in background
    const cached = _cache.get(sessionId)
    if (cached) {
      set({
        messages: cached.messages,
        hasMore: cached.hasMore,
        isLoadingHistory: false,
        currentLoadedSessionId: sessionId,
      })
      fetchSessionMessages(sessionId, { limit: 50, offset: 0 }).then((result) => {
        if (get().currentLoadedSessionId !== sessionId) return
        const loaded = result.messages as AgentMessage[]
        const live = get().messages.filter((m: any) => m._optimistic || m.type === '_streaming_block')
        set({ messages: [...loaded, ...live], hasMore: result.hasMore })
        _cache.set(sessionId, { messages: [...loaded], hasMore: result.hasMore })
      }).catch(() => {})
      return
    }

    // No cache — full load with Loading indicator
    const optimistic = current.filter((m: any) => m._optimistic)

    set({ messages: [], isLoadingHistory: true, currentLoadedSessionId: sessionId })
    try {
      const result = await fetchSessionMessages(sessionId, { limit: 50, offset: 0 })
      if (get().currentLoadedSessionId !== sessionId) return
      const loaded = result.messages as AgentMessage[]
      const remaining = optimistic.filter((opt: any) => {
        const optText = getUserText(opt)
        return !loaded.some((m: any) => m.type === 'user' && getUserText(m) === optText)
      })
      set({
        messages: [...loaded, ...remaining],
        hasMore: result.hasMore,
        isLoadingHistory: false,
      })
    } catch {
      if (get().currentLoadedSessionId === sessionId) {
        set({ isLoadingHistory: false })
      }
    }
  },

  async loadMore() {
    const { currentLoadedSessionId, messages, isLoadingMore } = get()
    if (!currentLoadedSessionId || isLoadingMore) return
    set({ isLoadingMore: true })
    try {
      const result = await fetchSessionMessages(currentLoadedSessionId, {
        limit: 50,
        offset: messages.length,
      })
      set({
        messages: [...(result.messages as AgentMessage[]), ...get().messages],
        hasMore: result.hasMore,
        isLoadingMore: false,
      })
    } catch {
      set({ isLoadingMore: false })
    }
  },

  appendMessage(msg: AgentMessage) {
    set({ messages: [...get().messages, msg] })
  },

  replaceOptimistic(serverMsg: AgentMessage) {
    const { messages } = get()
    const serverText = getUserText(serverMsg)
    const serverUuid = (serverMsg as any).uuid

    // 1. Deduplicate by uuid — if already in store (from API load), skip
    if (serverUuid && messages.some((m: any) => m.uuid === serverUuid)) return

    // 2. Try to replace an optimistic message with matching text
    const optIdx = messages.findIndex((m: any) =>
      m._optimistic && m.type === 'user' && getUserText(m) === serverText
    )
    if (optIdx >= 0) {
      const updated = [...messages]
      updated[optIdx] = serverMsg
      set({ messages: updated })
      return
    }

    // 3. No match — observer receiving a new message, append
    set({ messages: [...messages, serverMsg] })
  },

  appendStreamDelta(msg: AgentMessage) {
    const event = (msg as any).event
    if (!event) return

    if (event.type === 'content_block_start') {
      // Flush any pending delta text before creating a new block
      flushStreamingDelta()
      set({
        messages: [...get().messages, {
          ...msg,
          type: '_streaming_block' as any,
          _blockType: event.content_block?.type ?? 'text',
          _content: '',
          _index: event.index,
        }],
      })
      return
    }

    if (event.type === 'content_block_delta') {
      const delta = event.delta
      _pendingDeltaText += delta?.type === 'text_delta' ? delta.text
        : delta?.type === 'thinking_delta' ? delta.thinking
        : ''
      // Batch rapid deltas — flush at ~60fps via requestAnimationFrame
      if (_deltaRafId === null) {
        _deltaRafId = requestAnimationFrame(_flushStreamingDelta)
      }
      return
    }
  },

  clear() {
    // Save current session before clearing so we can restore it later
    get()._saveToCache()
    set({ messages: [], hasMore: false, currentLoadedSessionId: null })
  },
}})

