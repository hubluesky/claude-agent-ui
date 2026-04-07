import { useMemo, type ReactNode } from 'react'
import { ChatSessionContext, type ChatSessionContextValue } from './ChatSessionContext'
import { useMessageStore } from '../stores/messageStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useWebSocket } from '../hooks/useWebSocket'
import { useSessionStore } from '../stores/sessionStore'
import { useSettingsStore } from '../stores/settingsStore'

interface ChatSessionProviderProps {
  sessionId: string | null
  children: ReactNode
}

/**
 * Proxy provider: reads from existing global stores.
 * Phase 1a — validates Provider tree without changing any component.
 * Will be replaced with per-session hooks in Phase 1b.
 */
export function ChatSessionProvider({ sessionId, children }: ChatSessionProviderProps) {
  const messages = useMessageStore((s) => s.messages)
  const isLoadingHistory = useMessageStore((s) => s.isLoadingHistory)
  const isLoadingMore = useMessageStore((s) => s.isLoadingMore)
  const hasMore = useMessageStore((s) => s.hasMore)
  const loadMore = useMessageStore((s) => s.loadMore)

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
