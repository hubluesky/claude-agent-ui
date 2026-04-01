import { create } from 'zustand'
import type { AgentMessage } from '@claude-agent-ui/shared'
import { fetchSessionMessages } from '../lib/api'

interface MessageState {
  messages: AgentMessage[]
  hasMore: boolean
  isLoadingHistory: boolean
  isLoadingMore: boolean
  currentLoadedSessionId: string | null
}

interface MessageActions {
  loadInitial(sessionId: string): Promise<void>
  loadMore(): Promise<void>
  appendMessage(msg: AgentMessage): void
  appendStreamDelta(msg: AgentMessage): void
  /** Replace a matching optimistic user message with the server version, or append if no match */
  replaceOptimistic(serverMsg: AgentMessage): void
  clear(): void
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

export const useMessageStore = create<MessageState & MessageActions>((set, get) => ({
  messages: [],
  hasMore: false,
  isLoadingHistory: false,
  isLoadingMore: false,
  currentLoadedSessionId: null,

  async loadInitial(sessionId: string) {
    const { messages: current, currentLoadedSessionId } = get()

    // If we already have messages for this session (from live WS), skip API load
    if (currentLoadedSessionId === sessionId && current.length > 0) return

    // Preserve any optimistic messages that haven't been confirmed yet
    const optimistic = current.filter((m: any) => m._optimistic)

    set({ isLoadingHistory: true, currentLoadedSessionId: sessionId })
    try {
      const result = await fetchSessionMessages(sessionId, { limit: 50, offset: 0 })
      const loaded = result.messages as AgentMessage[]
      // Append leftover optimistic messages that aren't in the loaded set
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
      set({ isLoadingHistory: false })
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
    const { messages } = get()
    const event = (msg as any).event
    if (!event) return

    if (event.type === 'content_block_start') {
      set({
        messages: [...messages, {
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
      const updated = [...messages]
      for (let i = updated.length - 1; i >= 0; i--) {
        if ((updated[i] as any).type === '_streaming_block') {
          const delta = event.delta
          if (delta?.type === 'text_delta') {
            (updated[i] as any)._content += delta.text
          } else if (delta?.type === 'thinking_delta') {
            (updated[i] as any)._content += delta.thinking
          }
          break
        }
      }
      set({ messages: updated })
      return
    }
  },

  clear() {
    set({ messages: [], hasMore: false, currentLoadedSessionId: null })
  },
}))
