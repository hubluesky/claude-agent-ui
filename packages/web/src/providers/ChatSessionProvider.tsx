import { useMemo, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { ChatSessionContext, type ChatSessionContextValue } from './ChatSessionContext'
import { useMessageStore } from '../stores/messageStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useWebSocket } from '../hooks/useWebSocket'
import { registerMultiSession, unregisterMultiSession } from '../hooks/useWebSocket'
import { useSessionStore } from '../stores/sessionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { fetchSessionMessages } from '../lib/api'
import type { AgentMessage, SessionStatus } from '@claude-agent-ui/shared'

interface ChatSessionProviderProps {
  sessionId: string | null
  /**
   * When true, Provider loads its own messages from REST API
   * instead of reading from the global messageStore.
   * Used in Multi mode so each panel has independent messages.
   */
  independent?: boolean
  children: ReactNode
}

/**
 * Phase 1a proxy provider.
 *
 * - independent=false (default): reads from global stores (Single mode)
 * - independent=true: loads messages via REST API + subscribes via WS for real-time updates (Multi mode)
 */
export function ChatSessionProvider({ sessionId, independent, children }: ChatSessionProviderProps) {
  // ── Independent message state (Multi mode) ──────────────────
  const [localMessages, setLocalMessages] = useState<AgentMessage[]>([])
  const [localLoading, setLocalLoading] = useState(false)
  const [localHasMore, setLocalHasMore] = useState(false)
  const [localSessionStatus, setLocalSessionStatus] = useState<SessionStatus>('idle')

  // Ref for streaming block accumulation (independent mode)
  const streamingRef = useRef<Map<number, { blockType: string; content: string }>>(new Map())

  const { subscribeSession, unsubscribeSession } = useWebSocket()

  // ── Independent mode: REST load + WS subscription for live updates ──
  useEffect(() => {
    if (!independent || !sessionId || sessionId === '__new__') return
    let cancelled = false

    // 1. Load initial messages from REST API
    setLocalLoading(true)
    fetchSessionMessages(sessionId, { limit: 50, offset: 0 })
      .then((result) => {
        if (cancelled) return
        setLocalMessages(result.messages as AgentMessage[])
        setLocalHasMore(result.hasMore)
        setLocalLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLocalLoading(false)
      })

    // 2. Register multi-session handler for real-time WS updates
    registerMultiSession(sessionId, {
      onMessage(msg: AgentMessage) {
        if (cancelled) return

        if (msg.type === 'stream_event') {
          const event = (msg as any).event
          if (!event) return

          if (event.type === 'content_block_start') {
            // Flush pending streaming if starting index 0 (new response)
            if (event.index === 0) {
              streamingRef.current.clear()
            }
            streamingRef.current.set(event.index, {
              blockType: event.content_block?.type ?? 'text',
              content: '',
            })
            // Add a streaming block placeholder
            setLocalMessages(prev => [...prev, {
              ...msg,
              type: '_streaming_block' as any,
              _blockType: event.content_block?.type ?? 'text',
              _content: '',
              _index: event.index,
            } as any])
            return
          }

          if (event.type === 'content_block_delta') {
            const delta = event.delta
            const text = delta?.type === 'text_delta' ? delta.text
              : delta?.type === 'thinking_delta' ? delta.thinking
              : ''
            if (!text) return

            // Accumulate in ref
            const acc = streamingRef.current.get(event.index)
            if (acc) acc.content += text

            // Update the streaming block in messages
            setLocalMessages(prev => {
              const updated = [...prev]
              for (let i = updated.length - 1; i >= 0; i--) {
                if ((updated[i] as any).type === '_streaming_block') {
                  const block = updated[i] as any
                  updated[i] = { ...block, _content: block._content + text }
                  break
                }
              }
              return updated
            })
            return
          }
          return
        }

        if (msg.type === 'assistant') {
          // Final assistant message — replace streaming blocks and patch content
          const finalMsg = msg as any
          const contentBlocks: any[] = finalMsg.message?.content ?? []
          const streamedByIndex = streamingRef.current

          // Patch empty blocks from accumulated content
          if (streamedByIndex.size > 0) {
            const usedIndices = new Set<number>()
            for (const block of contentBlocks) {
              if (block.type === 'text' && !block.text) {
                for (const [idx, s] of streamedByIndex) {
                  if (s.blockType === 'text' && s.content && !usedIndices.has(idx)) {
                    block.text = s.content
                    usedIndices.add(idx)
                    break
                  }
                }
              } else if (block.type === 'thinking' && !block.thinking) {
                for (const [idx, s] of streamedByIndex) {
                  if (s.blockType === 'thinking' && s.content && !usedIndices.has(idx)) {
                    block.thinking = s.content
                    usedIndices.add(idx)
                    break
                  }
                }
              }
            }
            // Insert missing blocks
            const hasText = contentBlocks.some((b: any) => b.type === 'text' && b.text)
            const hasThinking = contentBlocks.some((b: any) => b.type === 'thinking' && b.thinking)
            const inserts: any[] = []
            if (!hasThinking) {
              for (const [idx, s] of streamedByIndex) {
                if (!usedIndices.has(idx) && s.blockType === 'thinking' && s.content) {
                  inserts.push({ type: 'thinking', thinking: s.content })
                  break
                }
              }
            }
            if (!hasText) {
              for (const [idx, s] of streamedByIndex) {
                if (!usedIndices.has(idx) && s.blockType === 'text' && s.content) {
                  inserts.push({ type: 'text', text: s.content })
                  break
                }
              }
            }
            if (inserts.length && finalMsg.message) {
              const toolIdx = contentBlocks.findIndex((b: any) => b.type === 'tool_use' || b.type === 'server_tool_use')
              if (toolIdx >= 0) {
                contentBlocks.splice(toolIdx, 0, ...inserts)
              } else {
                contentBlocks.push(...inserts)
              }
            }
          }

          const apiId = finalMsg.message?.id
          setLocalMessages(prev => {
            const cleaned = prev.filter((m: any) => {
              if (m.type === '_streaming_block') return false
              if (apiId && m.type === 'assistant' && (m as any).message?.id === apiId) return false
              return true
            })
            return [...cleaned, msg]
          })
          streamingRef.current.clear()
          return
        }

        if (msg.type === 'user') {
          // Deduplicate by uuid
          const uuid = (msg as any).uuid
          setLocalMessages(prev => {
            if (uuid && prev.some((m: any) => (m as any).uuid === uuid)) return prev
            return [...prev, msg]
          })
          return
        }

        // All other message types — append with uuid dedup
        const uuid = (msg as any).uuid
        setLocalMessages(prev => {
          if (uuid && prev.some((m: any) => (m as any).uuid === uuid)) return prev
          return [...prev, msg]
        })
      },

      onStatusChange(status: SessionStatus) {
        if (!cancelled) setLocalSessionStatus(status)
      },

      onComplete() {
        if (!cancelled) setLocalSessionStatus('idle')
      },
    })

    // 3. Subscribe to this session via WS (additive, doesn't unsubscribe from primary)
    subscribeSession(sessionId)

    return () => {
      cancelled = true
      unregisterMultiSession(sessionId)
      unsubscribeSession(sessionId)
      streamingRef.current.clear()
    }
  }, [independent, sessionId, subscribeSession, unsubscribeSession])

  const localLoadMore = useCallback(() => {
    if (!independent || !sessionId || sessionId === '__new__' || localLoading) return
    setLocalLoading(true)
    fetchSessionMessages(sessionId, { limit: 50, offset: localMessages.length })
      .then((result) => {
        setLocalMessages((prev) => [...(result.messages as AgentMessage[]), ...prev])
        setLocalHasMore(result.hasMore)
        setLocalLoading(false)
      })
      .catch(() => setLocalLoading(false))
  }, [independent, sessionId, localMessages.length, localLoading])

  // ── Global store reads (Single mode / shared state) ─────────
  const globalMessages = useMessageStore((s) => s.messages)
  const globalIsLoadingHistory = useMessageStore((s) => s.isLoadingHistory)
  const globalIsLoadingMore = useMessageStore((s) => s.isLoadingMore)
  const globalHasMore = useMessageStore((s) => s.hasMore)
  const globalLoadMore = useMessageStore((s) => s.loadMore)

  // Select message source based on mode
  const messages = independent ? localMessages : globalMessages
  const isLoadingHistory = independent ? localLoading : globalIsLoadingHistory
  const isLoadingMore = independent ? false : globalIsLoadingMore
  const hasMore = independent ? localHasMore : globalHasMore
  const loadMore = independent ? localLoadMore : globalLoadMore

  // ── Connection state (shared in proxy phase) ────────────────
  const connectionStatus = useConnectionStore((s) => s.connectionStatus)
  const globalSessionStatus = useConnectionStore((s) => s.sessionStatus)
  const sessionStatus = independent ? localSessionStatus : globalSessionStatus
  const lockStatus = useConnectionStore((s) => s.lockStatus)
  const lockHolderId = useConnectionStore((s) => s.lockHolderId)
  const pendingApproval = useConnectionStore((s) => s.pendingApproval)
  const pendingAskUser = useConnectionStore((s) => s.pendingAskUser)
  const pendingPlanApproval = useConnectionStore((s) => s.pendingPlanApproval)
  const resolvedPlanApproval = useConnectionStore((s) => s.resolvedPlanApproval)
  const planModalOpen = useConnectionStore((s) => s.planModalOpen)
  const contextUsage = useConnectionStore((s) => s.contextUsage)
  const mcpServers = useConnectionStore((s) => s.mcpServers)
  const rewindPreview = useConnectionStore((s) => s.rewindPreview)
  const subagentMessages = useConnectionStore((s) => s.subagentMessages)

  const {
    sendMessage, respondToolApproval, respondAskUser, respondPlanApproval,
    abort, claimLock, releaseLock, getContextUsage, getMcpStatus,
    toggleMcpServer, reconnectMcpServer, rewindFiles, getSubagentMessages,
    forkSession,
  } = useWebSocket()

  const currentProjectCwd = useSessionStore((s) => s.currentProjectCwd)

  const value = useMemo((): ChatSessionContextValue => ({
    sessionId,
    connectionStatus,
    messages,
    isLoadingHistory,
    isLoadingMore,
    hasMore,
    loadMore,
    sessionStatus,
    lockStatus,
    lockHolderId,
    pendingApproval,
    pendingAskUser,
    pendingPlanApproval,
    resolvedPlanApproval,
    planModalOpen,
    contextUsage,
    mcpServers,
    rewindPreview,
    subagentMessages,

    send(prompt, options) {
      const isNew = sessionId === '__new__' || !sessionId
      const { thinkingMode, effort } = useSettingsStore.getState()
      // Optimistic: show ThinkingIndicator immediately, don't wait for server round-trip.
      // The server will send the authoritative session-state-change shortly.
      useConnectionStore.getState().setSessionStatus('running')
      sendMessage(prompt, isNew ? null : sessionId, {
        cwd: currentProjectCwd ?? undefined,
        thinkingMode,
        effort,
        ...options,
      })
    },
    respondToolApproval,
    respondAskUser,
    respondPlanApproval(requestId, decision, feedback) {
      respondPlanApproval(requestId, decision, feedback)
    },
    abort() {
      if (sessionId && sessionId !== '__new__') abort(sessionId)
    },
    claimLock() {
      if (sessionId && sessionId !== '__new__') claimLock(sessionId)
    },
    releaseLock() {
      if (sessionId && sessionId !== '__new__') releaseLock(sessionId)
    },
    setPlanModalOpen(open) {
      useConnectionStore.getState().setPlanModalOpen(open)
    },
    getContextUsage() {
      if (sessionId && sessionId !== '__new__') getContextUsage(sessionId)
    },
    getMcpStatus() {
      if (sessionId && sessionId !== '__new__') getMcpStatus(sessionId)
    },
    toggleMcpServer(serverName, enabled) {
      if (sessionId && sessionId !== '__new__') toggleMcpServer(sessionId, serverName, enabled)
    },
    reconnectMcpServer(serverName) {
      if (sessionId && sessionId !== '__new__') reconnectMcpServer(sessionId, serverName)
    },
    rewindFiles(messageId, dryRun) {
      if (sessionId && sessionId !== '__new__') rewindFiles(sessionId, messageId, dryRun)
    },
    getSubagentMessages(agentId) {
      if (sessionId && sessionId !== '__new__') getSubagentMessages(sessionId, agentId)
    },
    forkSession(atMessageId) {
      if (sessionId && sessionId !== '__new__') forkSession(sessionId, atMessageId)
    },
  }), [
    sessionId, connectionStatus, messages, isLoadingHistory, isLoadingMore,
    hasMore, loadMore, sessionStatus, lockStatus, lockHolderId,
    pendingApproval, pendingAskUser, pendingPlanApproval, resolvedPlanApproval,
    planModalOpen, contextUsage, mcpServers, rewindPreview, subagentMessages,
    sendMessage, respondToolApproval, respondAskUser, respondPlanApproval,
    abort, claimLock, releaseLock, getContextUsage, getMcpStatus,
    toggleMcpServer, reconnectMcpServer, rewindFiles, getSubagentMessages,
    forkSession, currentProjectCwd,
  ])

  return (
    <ChatSessionContext.Provider value={value}>
      {children}
    </ChatSessionContext.Provider>
  )
}
