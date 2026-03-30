# Task 9: Web Chat Interface + Messages

**Files:**
- Create: `packages/web/src/lib/ws-client.ts`
- Create: `packages/web/src/stores/connectionStore.ts`
- Create: `packages/web/src/stores/messageStore.ts`
- Create: `packages/web/src/hooks/useWebSocket.ts`
- Create: `packages/web/src/hooks/useMessages.ts`
- Create: `packages/web/src/components/chat/ChatInterface.tsx`
- Create: `packages/web/src/components/chat/ChatMessagesPane.tsx`
- Create: `packages/web/src/components/chat/ChatComposer.tsx`
- Create: `packages/web/src/components/chat/MessageComponent.tsx`
- Create: `packages/web/src/components/chat/StatusBar.tsx`
- Create: `packages/web/src/components/chat/ThinkingIndicator.tsx`
- Modify: `packages/web/src/App.tsx`

---

- [ ] **Step 1: Create stores/connectionStore.ts**

```typescript
// packages/web/src/stores/connectionStore.ts
import { create } from 'zustand'
import type { SessionStatus, ClientLockStatus, ConnectionStatus } from '@claude-agent-ui/shared'
import type { ToolApprovalRequest, AskUserRequest } from '@claude-agent-ui/shared'

interface ConnectionState {
  connectionId: string | null
  connectionStatus: ConnectionStatus
  lockStatus: ClientLockStatus
  lockHolderId: string | null
  sessionStatus: SessionStatus
  pendingApproval: (ToolApprovalRequest & { readonly: boolean }) | null
  pendingAskUser: (AskUserRequest & { readonly: boolean }) | null
}

interface ConnectionActions {
  setConnectionId(id: string | null): void
  setConnectionStatus(status: ConnectionStatus): void
  setLockStatus(status: ClientLockStatus): void
  setLockHolderId(id: string | null): void
  setSessionStatus(status: SessionStatus): void
  setPendingApproval(req: (ToolApprovalRequest & { readonly: boolean }) | null): void
  setPendingAskUser(req: (AskUserRequest & { readonly: boolean }) | null): void
  reset(): void
}

export const useConnectionStore = create<ConnectionState & ConnectionActions>((set) => ({
  connectionId: null,
  connectionStatus: 'disconnected',
  lockStatus: 'idle',
  lockHolderId: null,
  sessionStatus: 'idle',
  pendingApproval: null,
  pendingAskUser: null,

  setConnectionId: (id) => set({ connectionId: id }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setLockStatus: (status) => set({ lockStatus: status }),
  setLockHolderId: (id) => set({ lockHolderId: id }),
  setSessionStatus: (status) => set({ sessionStatus: status }),
  setPendingApproval: (req) => set({ pendingApproval: req }),
  setPendingAskUser: (req) => set({ pendingAskUser: req }),
  reset: () => set({
    lockStatus: 'idle', lockHolderId: null, sessionStatus: 'idle',
    pendingApproval: null, pendingAskUser: null,
  }),
}))
```

- [ ] **Step 2: Create stores/messageStore.ts**

```typescript
// packages/web/src/stores/messageStore.ts
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

  /** Accumulate stream_event deltas into the last assistant message being built */
  appendStreamDelta(msg: AgentMessage) {
    const { messages } = get()
    const event = (msg as any).event
    if (!event) return

    // content_block_start: create a new streaming message placeholder
    if (event.type === 'content_block_start') {
      set({
        messages: [...messages, {
          type: '_streaming_block' as any,
          _blockType: event.content_block?.type ?? 'text',
          _content: '',
          _index: event.index,
          ...msg,
        }],
      })
      return
    }

    // content_block_delta: append to the last streaming block
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

    // content_block_stop: finalize the streaming block
    if (event.type === 'content_block_stop') {
      // Leave as-is; will be replaced by full assistant message
      return
    }
  },

  clear() {
    set({ messages: [], hasMore: false, currentLoadedSessionId: null })
  },
}))
```

- [ ] **Step 3: Create hooks/useWebSocket.ts**

```typescript
// packages/web/src/hooks/useWebSocket.ts
import { useRef, useCallback, useEffect } from 'react'
import type { S2CMessage, C2SMessage, ToolApprovalDecision } from '@claude-agent-ui/shared'
import { useConnectionStore } from '../stores/connectionStore'
import { useMessageStore } from '../stores/messageStore'
import { useSessionStore } from '../stores/sessionStore'

const CONNECTION_ID_KEY = 'claude-agent-ui-connection-id'

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<number>()
  const reconnectAttempt = useRef(0)

  const connStore = useConnectionStore()
  const msgStore = useMessageStore()
  const sessStore = useSessionStore()

  const connect = useCallback(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${location.host}/ws`

    connStore.setConnectionStatus('connecting')
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      connStore.setConnectionStatus('connected')
      reconnectAttempt.current = 0

      // Reconnect: send previous connectionId
      const prevId = localStorage.getItem(CONNECTION_ID_KEY)
      if (prevId) {
        ws.send(JSON.stringify({ type: 'reconnect', previousConnectionId: prevId }))
      }

      // Re-join session if we had one
      const sessionId = sessStore.currentSessionId
      if (sessionId) {
        ws.send(JSON.stringify({ type: 'join-session', sessionId }))
      }
    }

    ws.onmessage = (event) => {
      const msg: S2CMessage = JSON.parse(event.data)
      handleServerMessage(msg)
    }

    ws.onclose = () => {
      connStore.setConnectionStatus('reconnecting')
      scheduleReconnect()
    }
  }, [])

  function scheduleReconnect() {
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempt.current), 30000)
    reconnectAttempt.current++
    reconnectTimer.current = window.setTimeout(() => connect(), delay)
  }

  function handleServerMessage(msg: S2CMessage) {
    switch (msg.type) {
      case 'init':
        connStore.setConnectionId(msg.connectionId)
        localStorage.setItem(CONNECTION_ID_KEY, msg.connectionId)
        break

      case 'session-state':
        connStore.setSessionStatus(msg.sessionStatus)
        connStore.setLockHolderId(msg.lockHolderId ?? null)
        connStore.setLockStatus(
          msg.lockStatus === 'idle' ? 'idle'
            : msg.isLockHolder ? 'locked_self' : 'locked_other'
        )
        break

      case 'agent-message':
        // Capture session_id from init message (for new sessions where currentSessionId was null)
        if (msg.message.type === 'system' && (msg.message as any).subtype === 'init' && (msg.message as any).session_id) {
          const newId = (msg.message as any).session_id
          if (!sessStore.currentSessionId || sessStore.currentSessionId !== newId) {
            sessStore.setCurrentSessionId(newId)
            // Re-join with real session ID
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'join-session', sessionId: newId }))
            }
          }
        }

        if (msg.message.type === 'stream_event') {
          msgStore.appendStreamDelta(msg.message)
        } else {
          // Full message (assistant, user, result, system, etc.)
          // Remove any _streaming_block placeholders when full assistant message arrives
          if (msg.message.type === 'assistant') {
            const current = msgStore.messages
            const cleaned = current.filter((m: any) => m.type !== '_streaming_block')
            // Replace store then append
            msgStore.clear()
            for (const m of cleaned) msgStore.appendMessage(m)
          }
          msgStore.appendMessage(msg.message)
        }
        break

      case 'tool-approval-request':
        if (msg.readonly) {
          // Non-lock-holder: show readonly approval display in messages
          connStore.setPendingApproval({ ...msg, readonly: true })
        } else {
          // Lock holder: show interactive approval banner
          connStore.setPendingApproval({ ...msg, readonly: false })
        }
        break

      case 'tool-approval-resolved':
        connStore.setPendingApproval(null)
        break

      case 'ask-user-request':
        connStore.setPendingAskUser({ ...msg, readonly: msg.readonly })
        break

      case 'ask-user-resolved':
        connStore.setPendingAskUser(null)
        break

      case 'lock-status': {
        const myId = connStore.connectionId
        connStore.setLockStatus(
          msg.status === 'idle' ? 'idle'
            : msg.holderId === myId ? 'locked_self' : 'locked_other'
        )
        connStore.setLockHolderId(msg.holderId ?? null)
        break
      }

      case 'session-state-change':
        connStore.setSessionStatus(msg.state)
        break

      case 'session-complete':
      case 'session-aborted':
        connStore.reset()
        break

      case 'error':
        console.error('[WS Error]', msg.message, msg.code)
        break
    }
  }

  const send = useCallback((msg: C2SMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  const sendMessage = useCallback((prompt: string, sessionId: string | null, options?: any) => {
    send({ type: 'send-message', sessionId, prompt, options })
  }, [send])

  const joinSession = useCallback((sessionId: string) => {
    send({ type: 'join-session', sessionId })
  }, [send])

  const respondToolApproval = useCallback((requestId: string, decision: ToolApprovalDecision) => {
    send({ type: 'tool-approval-response', requestId, decision })
  }, [send])

  const respondAskUser = useCallback((requestId: string, answers: Record<string, string>) => {
    send({ type: 'ask-user-response', requestId, answers })
  }, [send])

  const abort = useCallback((sessionId: string) => {
    send({ type: 'abort', sessionId })
  }, [send])

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    wsRef.current?.close()
    wsRef.current = null
  }, [])

  // Auto-connect on mount
  useEffect(() => {
    connect()
    return () => disconnect()
  }, [])

  return { sendMessage, joinSession, respondToolApproval, respondAskUser, abort, disconnect }
}
```

- [ ] **Step 4: Create chat components**

```tsx
// packages/web/src/components/chat/ThinkingIndicator.tsx
export function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-3 px-10">
      <div className="w-7 h-7 rounded-full bg-[#242320] border border-[#3d3b37] flex items-center justify-center">
        <span className="text-xs font-bold font-mono text-[#d97706]">C</span>
      </div>
      <span className="text-sm text-[#7c7872]">Thinking</span>
      <div className="flex gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-[#7c7872] animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-[#7c7872] animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-[#7c7872] animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  )
}
```

```tsx
// packages/web/src/components/chat/StatusBar.tsx
import { useConnectionStore } from '../../stores/connectionStore'

export function StatusBar() {
  const { sessionStatus, lockStatus } = useConnectionStore()

  const statusConfig = {
    idle: { color: 'bg-[#a3e635]', text: 'idle' },
    running: { color: 'bg-[#d97706]', text: 'running' },
    awaiting_approval: { color: 'bg-[#eab308]', text: 'awaiting approval' },
    awaiting_user_input: { color: 'bg-[#eab308]', text: 'awaiting input' },
  }

  const config = lockStatus === 'locked_other'
    ? { color: 'bg-[#f87171]', text: 'locked by another client' }
    : statusConfig[sessionStatus]

  return (
    <div className="h-10 flex items-center gap-3 px-10 border-t border-[#3d3b37]">
      <div className={`w-2 h-2 rounded-full ${config.color}`} />
      <span className="text-xs font-mono text-[#7c7872]">{config.text}</span>
      <span className="text-xs text-[#7c7872]">·</span>
      <span className="text-xs text-[#a8a29e]">Ask</span>
    </div>
  )
}
```

```tsx
// packages/web/src/components/chat/MessageComponent.tsx
import type { AgentMessage } from '@claude-agent-ui/shared'

interface MessageComponentProps {
  message: AgentMessage
}

export function MessageComponent({ message }: MessageComponentProps) {
  // User message
  if (message.type === 'user') {
    const content = (message as any).message?.content ?? ''
    const text = typeof content === 'string' ? content : JSON.stringify(content)
    return (
      <div className="flex justify-end">
        <div className="bg-[#3d2e14] rounded-xl rounded-br-sm px-4 py-3 max-w-[70%]">
          <p className="text-sm text-[#e5e2db] whitespace-pre-wrap">{text}</p>
        </div>
      </div>
    )
  }

  // Assistant message
  if (message.type === 'assistant') {
    const contentBlocks = (message as any).message?.content ?? []
    return (
      <div className="flex gap-3 items-start">
        <div className="w-7 h-7 rounded-full bg-[#242320] border border-[#3d3b37] flex items-center justify-center shrink-0">
          <span className="text-xs font-bold font-mono text-[#d97706]">C</span>
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          {contentBlocks.map((block: any, i: number) => {
            if (block.type === 'text') {
              return <p key={i} className="text-sm text-[#e5e2db] whitespace-pre-wrap leading-relaxed">{block.text}</p>
            }
            if (block.type === 'thinking') {
              return (
                <details key={i} className="bg-[#8b5cf60f] rounded-md px-3 py-2">
                  <summary className="text-xs text-[#8b5cf6] cursor-pointer">Thinking...</summary>
                  <p className="text-xs text-[#a8a29e] mt-1 whitespace-pre-wrap">{block.thinking}</p>
                </details>
              )
            }
            if (block.type === 'tool_use') {
              return (
                <div key={i} className="border border-[#3d3b37] rounded-md overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="w-0.5 h-4 rounded-full bg-[#059669]" />
                    <span className="text-xs font-mono font-medium text-[#a8a29e]">{block.name}</span>
                  </div>
                </div>
              )
            }
            return null
          })}
        </div>
      </div>
    )
  }

  // Result (error)
  if (message.type === 'result' && (message as any).subtype?.startsWith('error')) {
    return (
      <div className="flex items-start gap-2.5 bg-[#f8717114] border border-[#f8717133] rounded-md px-4 py-3">
        <div className="w-5 h-5 rounded-full bg-[#f87171] flex items-center justify-center shrink-0">
          <span className="text-[11px] font-bold text-[#2b2a27]">!</span>
        </div>
        <p className="text-sm text-[#f87171]">{((message as any).errors ?? []).join('\n')}</p>
      </div>
    )
  }

  // Stream event — show text deltas inline
  if (message.type === 'stream_event') {
    const event = (message as any).event
    if (event?.delta?.type === 'text_delta') {
      return <span className="text-sm text-[#e5e2db]">{event.delta.text}</span>
    }
    return null
  }

  // Streaming block (accumulated text delta)
  if ((message as any).type === '_streaming_block') {
    const blockType = (message as any)._blockType
    const content = (message as any)._content ?? ''
    if (blockType === 'text') {
      return (
        <div className="flex gap-3 items-start">
          <div className="w-7 h-7 rounded-full bg-[#242320] border border-[#3d3b37] flex items-center justify-center shrink-0">
            <span className="text-xs font-bold font-mono text-[#d97706]">C</span>
          </div>
          <p className="text-sm text-[#e5e2db] whitespace-pre-wrap leading-relaxed flex-1">{content}<span className="inline-block w-2 h-4 bg-[#d97706] rounded-sm ml-0.5 animate-pulse" /></p>
        </div>
      )
    }
    if (blockType === 'thinking') {
      return (
        <details open className="bg-[#8b5cf60f] rounded-md px-3 py-2 ml-10">
          <summary className="text-xs text-[#8b5cf6] cursor-pointer">Thinking...</summary>
          <p className="text-xs text-[#a8a29e] mt-1 whitespace-pre-wrap">{content}</p>
        </details>
      )
    }
    return null
  }

  // System messages — don't render most
  if (message.type === 'system') {
    if ((message as any).subtype === 'api_retry') {
      return (
        <div className="text-xs text-[#7c7872] bg-[#eab3080f] rounded px-3 py-1.5">
          API retry (attempt {(message as any).attempt}/{(message as any).max_retries})...
        </div>
      )
    }
    return null
  }

  return null
}
```

```tsx
// packages/web/src/components/chat/ChatMessagesPane.tsx
import { useRef, useEffect } from 'react'
import { useMessageStore } from '../../stores/messageStore'
import { MessageComponent } from './MessageComponent'
import { ThinkingIndicator } from './ThinkingIndicator'
import { useConnectionStore } from '../../stores/connectionStore'

interface ChatMessagesPaneProps {
  sessionId: string
}

export function ChatMessagesPane({ sessionId }: ChatMessagesPaneProps) {
  const { messages, hasMore, isLoadingHistory, isLoadingMore, loadInitial, loadMore } = useMessageStore()
  const sessionStatus = useConnectionStore((s) => s.sessionStatus)
  const scrollRef = useRef<HTMLDivElement>(null)
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)

  useEffect(() => { loadInitial(sessionId) }, [sessionId])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (shouldAutoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length])

  // Track scroll position for auto-scroll
  const handleScroll = () => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 100
  }

  // IntersectionObserver for loadMore
  useEffect(() => {
    if (!topSentinelRef.current) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && hasMore && !isLoadingMore) {
        const prevHeight = scrollRef.current?.scrollHeight ?? 0
        loadMore().then(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight - prevHeight
          }
        })
      }
    })
    observer.observe(topSentinelRef.current)
    return () => observer.disconnect()
  }, [hasMore, isLoadingMore])

  if (isLoadingHistory) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#7c7872] text-sm">
        Loading messages...
      </div>
    )
  }

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
      <div className="px-10 py-6 space-y-5">
        <div ref={topSentinelRef} />
        {isLoadingMore && (
          <p className="text-center text-xs text-[#7c7872]">Loading earlier messages...</p>
        )}
        {messages.map((msg, i) => (
          <MessageComponent key={(msg as any).uuid ?? i} message={msg} />
        ))}
        {sessionStatus === 'running' && <ThinkingIndicator />}
      </div>
    </div>
  )
}
```

```tsx
// packages/web/src/components/chat/ChatComposer.tsx
import { useState, useRef, useCallback } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'

interface ChatComposerProps {
  onSend: (prompt: string) => void
  onAbort: () => void
}

export function ChatComposer({ onSend, onAbort }: ChatComposerProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { lockStatus, sessionStatus } = useConnectionStore()

  const isLocked = lockStatus === 'locked_other'
  const isRunning = lockStatus === 'locked_self' && sessionStatus === 'running'
  const canSend = text.trim().length > 0 && !isLocked

  const handleSubmit = useCallback(() => {
    if (!canSend) return
    onSend(text.trim())
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [text, canSend, onSend])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    // Auto-resize
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  return (
    <div className="border-t border-[#3d3b37] px-10 py-3">
      <div className="flex items-end gap-3">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={isLocked ? '🔒 会话已被占用' : 'Ask Claude anything...'}
          disabled={isLocked}
          rows={1}
          className="flex-1 bg-[#242320] border border-[#3d3b37] rounded-lg px-4 py-3 text-sm text-[#e5e2db] placeholder-[#7c7872] resize-none outline-none focus:border-[#d97706] disabled:opacity-40 transition-colors"
        />
        {isRunning ? (
          <button
            onClick={onAbort}
            className="w-11 h-11 rounded-lg bg-[#f87171] flex items-center justify-center shrink-0"
          >
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!canSend}
            className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
              canSend ? 'bg-[#d97706] hover:bg-[#b45309]' : 'bg-[#242320] opacity-40'
            }`}
          >
            <svg className="w-5 h-5 text-[#2b2a27]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
```

```tsx
// packages/web/src/components/chat/PermissionBanner.tsx
import { useConnectionStore } from '../../stores/connectionStore'
import { useWebSocket } from '../../hooks/useWebSocket'

export function PermissionBanner() {
  const { pendingApproval } = useConnectionStore()
  const { respondToolApproval } = useWebSocket()

  if (!pendingApproval) return null

  const { requestId, toolName, toolInput, title, readonly } = pendingApproval

  return (
    <div className={`mx-10 mb-4 p-4 rounded-lg border ${
      readonly
        ? 'bg-[#78787214] border-[#3d3b37]'
        : 'bg-[#d977060f] border-[#d9770633]'
    }`}>
      <div className="flex items-center gap-2 mb-3">
        {readonly ? (
          <>
            <svg className="w-4 h-4 text-[#7c7872]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span className="text-[13px] text-[#7c7872]">Waiting for operator to respond...</span>
          </>
        ) : (
          <>
            <svg className="w-4 h-4 text-[#d97706]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-[13px] font-medium text-[#e5e2db]">{title ?? `Claude wants to use ${toolName}`}</span>
          </>
        )}
      </div>

      <div className="bg-[#1e1d1a] border border-[#3d3b37] rounded-md px-3 py-2.5 mb-3">
        <span className="text-xs font-mono font-medium text-[#059669]">{toolName}</span>
        <p className="text-xs font-mono text-[#a8a29e] mt-1 truncate">
          {JSON.stringify(toolInput).slice(0, 200)}
        </p>
      </div>

      {!readonly && (
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => respondToolApproval(requestId, { behavior: 'deny', message: 'User denied' })}
            className="px-3.5 py-1.5 text-xs font-medium text-[#a8a29e] border border-[#3d3b37] rounded-md hover:bg-[#3d3b37] transition-colors"
          >Deny</button>
          <button
            onClick={() => respondToolApproval(requestId, { behavior: 'allow', updatedInput: toolInput })}
            className="px-3.5 py-1.5 text-xs font-semibold text-[#2b2a27] bg-[#d97706] rounded-md hover:bg-[#b45309] transition-colors"
          >Allow</button>
        </div>
      )}
    </div>
  )
}
```

```tsx
// packages/web/src/components/chat/AskUserPanel.tsx
import { useState } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useWebSocket } from '../../hooks/useWebSocket'

export function AskUserPanel() {
  const { pendingAskUser } = useConnectionStore()
  const { respondAskUser } = useWebSocket()
  const [selected, setSelected] = useState<Record<string, string>>({})

  if (!pendingAskUser || pendingAskUser.readonly) return null

  const { requestId, questions } = pendingAskUser

  const handleSelect = (questionText: string, label: string) => {
    setSelected((prev) => ({ ...prev, [questionText]: label }))
  }

  const handleSubmit = () => {
    respondAskUser(requestId, selected)
    setSelected({})
  }

  const allAnswered = questions.every((q) => selected[q.question])

  return (
    <div className="mx-10 mb-4 p-5 bg-[#d977060f] border border-[#d9770626] rounded-lg">
      <div className="flex items-center gap-2 mb-4">
        <svg className="w-4 h-4 text-[#d97706]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-[13px] font-semibold text-[#d97706]">Claude needs input</span>
      </div>

      {questions.map((q, qi) => (
        <div key={qi} className="mb-4">
          <p className="text-sm font-medium text-[#e5e2db] mb-3">{q.question}</p>
          <div className="space-y-2">
            {q.options.map((opt, oi) => {
              const isSelected = selected[q.question] === opt.label
              return (
                <button
                  key={oi}
                  onClick={() => handleSelect(q.question, opt.label)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-md text-left transition-colors ${
                    isSelected
                      ? 'bg-[#d9770614] border border-[#d977064d]'
                      : 'border border-[#3d3b37] hover:bg-[#3d3b3780]'
                  }`}
                >
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                    isSelected ? 'bg-[#d97706]' : 'border border-[#3d3b37]'
                  }`}>
                    <span className={`text-[11px] font-semibold ${isSelected ? 'text-[#2b2a27]' : 'text-[#7c7872]'}`}>
                      {oi + 1}
                    </span>
                  </div>
                  <div>
                    <span className={`text-[13px] font-medium ${isSelected ? 'text-[#e5e2db]' : 'text-[#a8a29e]'}`}>
                      {opt.label}
                    </span>
                    <p className="text-xs text-[#7c7872] mt-0.5">{opt.description}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <div className="flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={!allAnswered}
          className="px-4 py-2 text-xs font-semibold text-[#2b2a27] bg-[#d97706] rounded-md hover:bg-[#b45309] disabled:opacity-40 transition-colors"
        >Confirm</button>
      </div>
    </div>
  )
}
```

```tsx
// packages/web/src/components/chat/ChatInterface.tsx
import { useCallback, useEffect } from 'react'
import { ChatMessagesPane } from './ChatMessagesPane'
import { ChatComposer } from './ChatComposer'
import { StatusBar } from './StatusBar'
import { PermissionBanner } from './PermissionBanner'
import { AskUserPanel } from './AskUserPanel'
import { useWebSocket } from '../../hooks/useWebSocket'
import { useSessionStore } from '../../stores/sessionStore'

export function ChatInterface() {
  const { sendMessage, joinSession, abort } = useWebSocket()
  const { currentSessionId, currentProjectCwd } = useSessionStore()

  // Join session when sessionId changes (not on every render)
  useEffect(() => {
    if (currentSessionId) {
      joinSession(currentSessionId)
    }
  }, [currentSessionId, joinSession])

  const handleSend = useCallback((prompt: string) => {
    sendMessage(prompt, currentSessionId, { cwd: currentProjectCwd ?? undefined })
  }, [currentSessionId, currentProjectCwd, sendMessage])

  const handleAbort = useCallback(() => {
    if (currentSessionId) abort(currentSessionId)
  }, [currentSessionId, abort])

  if (!currentSessionId) return null

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ChatMessagesPane sessionId={currentSessionId} />
      <PermissionBanner />
      <AskUserPanel />
      <StatusBar />
      <ChatComposer onSend={handleSend} onAbort={handleAbort} />
    </div>
  )
}
```

- [ ] **Step 5: Update App.tsx**

```tsx
// packages/web/src/App.tsx
import { AppLayout } from './components/layout/AppLayout'
import { ChatInterface } from './components/chat/ChatInterface'
import { useSessionStore } from './stores/sessionStore'

export function App() {
  const currentSessionId = useSessionStore((s) => s.currentSessionId)

  return (
    <AppLayout>
      {currentSessionId ? (
        <ChatInterface />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-16 h-16 rounded-full bg-[#242320] border border-[#3d3b37] flex items-center justify-center">
            <span className="text-[28px] font-bold font-mono text-[#d97706]">C</span>
          </div>
          <h1 className="text-xl font-semibold text-[#e5e2db]">Claude Agent UI</h1>
          <p className="text-sm text-[#7c7872]">Select a session from the sidebar to start</p>
        </div>
      )}
    </AppLayout>
  )
}
```

- [ ] **Step 6: Verify chat renders**

Run `pnpm dev`. Open browser. If Claude CLI sessions exist:
1. Projects should appear in sidebar
2. Click project → sessions list
3. Click session → messages load
4. Type and send → message goes through WS → Agent SDK → streaming reply

- [ ] **Step 7: Commit**

```bash
git add packages/web/
git commit -m "feat(web): chat interface with messages, composer, status bar, WebSocket sync"
```
