import { useMemo, useState, useEffect, useCallback, type ReactNode } from 'react'
import { ChatSessionContext, type ChatSessionContextValue } from './ChatSessionContext'
import { useMessageStore } from '../stores/messageStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useWebSocket } from '../hooks/useWebSocket'
import { useSessionStore } from '../stores/sessionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { fetchSessionMessages } from '../lib/api'
import type { AgentMessage } from '@claude-agent-ui/shared'

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
 * - independent=true: loads messages via REST API into local state (Multi mode)
 */
export function ChatSessionProvider({ sessionId, independent, children }: ChatSessionProviderProps) {
  // ── Independent message state (Multi mode) ──────────────────
  const [localMessages, setLocalMessages] = useState<AgentMessage[]>([])
  const [localLoading, setLocalLoading] = useState(false)
  const [localHasMore, setLocalHasMore] = useState(false)

  useEffect(() => {
    if (!independent || !sessionId || sessionId === '__new__') return
    let cancelled = false
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
    return () => { cancelled = true }
  }, [independent, sessionId])

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
  const sessionStatus = useConnectionStore((s) => s.sessionStatus)
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
