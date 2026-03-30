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
  clear(): void
}

export const useMessageStore = create<MessageState & MessageActions>((set, get) => ({
  messages: [],
  hasMore: false,
  isLoadingHistory: false,
  isLoadingMore: false,
  currentLoadedSessionId: null,

  async loadInitial(sessionId: string) {
    set({ isLoadingHistory: true, messages: [], currentLoadedSessionId: sessionId })
    try {
      const result = await fetchSessionMessages(sessionId, { limit: 50, offset: 0 })
      set({
        messages: result.messages as AgentMessage[],
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
