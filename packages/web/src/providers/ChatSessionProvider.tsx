import { useMemo, useEffect, useCallback, type ReactNode } from 'react'
import { ChatSessionContext, type ChatSessionContextValue } from './ChatSessionContext'
import { useContainer, useGlobalConnection } from '../hooks/useContainer'
import { useSessionContainerStore } from '../stores/sessionContainerStore'
import { useSessionStore } from '../stores/sessionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { wsManager } from '../lib/WebSocketManager'
import { fetchSessionMessages } from '../lib/api'
import type { AgentMessage } from '@claude-agent-ui/shared'

interface ChatSessionProviderProps {
  sessionId: string | null
  children: ReactNode
}

/**
 * Unified ChatSessionProvider — all data comes from useSessionContainerStore
 * via useContainer(sessionId). No more `independent` mode split.
 *
 * Responsibilities:
 * 1. Ensure a Container exists for the sessionId
 * 2. Load messages via REST if the Container has no messages
 * 3. Provide action callbacks via wsManager
 * 4. Expose everything through ChatSessionContext
 */
export function ChatSessionProvider({ sessionId, children }: ChatSessionProviderProps) {
  const globalConn = useGlobalConnection()
  const container = useContainer(sessionId)
  const currentProjectCwd = useSessionStore((s) => s.currentProjectCwd)

  // ── Ensure Container exists ─────────────────────────────────
  useEffect(() => {
    if (!sessionId || sessionId === '__new__') return
    const cwd = currentProjectCwd ?? ''
    useSessionContainerStore.getState().getOrCreate(sessionId, cwd)
  }, [sessionId, currentProjectCwd])

  // ── Load messages via REST if Container is empty ────────────
  useEffect(() => {
    if (!sessionId || sessionId === '__new__') return
    const s = useSessionContainerStore.getState()
    const c = s.containers.get(sessionId)
    if (!c) return
    // Only fetch if no messages exist yet and we aren't already loading
    if (c.messages.length > 0 || c.isLoadingHistory) return

    s.setLoadingHistory(sessionId, true)
    fetchSessionMessages(sessionId, { limit: 50, offset: 0 })
      .then((result) => {
        const state = useSessionContainerStore.getState()
        const current = state.containers.get(sessionId)
        if (!current) return
        state.replaceMessages(sessionId, result.messages as AgentMessage[], result.hasMore)
      })
      .catch(() => {
        useSessionContainerStore.getState().setLoadingHistory(sessionId, false)
      })
  }, [sessionId])

  // ── loadMore callback ────────────────────────────────────────
  const loadMore = useCallback(() => {
    if (!sessionId || sessionId === '__new__') return
    const s = useSessionContainerStore.getState()
    const c = s.containers.get(sessionId)
    if (!c || c.isLoadingMore || !c.hasMore) return

    s.setLoadingMore(sessionId, true)
    const offset = c.messages.length
    fetchSessionMessages(sessionId, { limit: 50, offset })
      .then((result) => {
        const state = useSessionContainerStore.getState()
        const current = state.containers.get(sessionId)
        if (!current) return
        // Prepend older messages
        const next = new Map(state.containers)
        next.set(sessionId, {
          ...current,
          messages: [...(result.messages as AgentMessage[]), ...current.messages],
          hasMore: result.hasMore,
          isLoadingMore: false,
        })
        useSessionContainerStore.setState({ containers: next })
      })
      .catch(() => {
        useSessionContainerStore.getState().setLoadingMore(sessionId, false)
      })
  }, [sessionId])

  // ── Build context value ──────────────────────────────────────
  const value = useMemo((): ChatSessionContextValue => {
    // Fallback values when container doesn't exist yet (e.g., __new__ session)
    const messages = container?.messages ?? []
    const isLoadingHistory = container?.isLoadingHistory ?? false
    const isLoadingMore = container?.isLoadingMore ?? false
    const hasMore = container?.hasMore ?? false
    const sessionStatus = container?.sessionStatus ?? 'idle'
    const lockStatus = container?.lockStatus ?? 'idle'
    const lockHolderId = container?.lockHolder ?? null
    const pendingApproval = container?.pendingApproval ?? null
    const pendingAskUser = container?.pendingAskUser ?? null
    const pendingPlanApproval = container?.pendingPlanApproval ?? null
    const resolvedPlanApproval = container?.resolvedPlanApproval ?? null
    const planModalOpen = container?.planModalOpen ?? false
    const contextUsage = container?.contextUsage ?? null
    const mcpServers = container?.mcpServers ?? []
    const subagentMessages = container?.subagentMessages ?? null

    return {
      sessionId,
      connectionStatus: globalConn.connectionStatus,

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
      subagentMessages,

      send(prompt, options) {
        const isNew = sessionId === '__new__' || !sessionId
        const { thinkingMode, effort } = useSettingsStore.getState()
        // Optimistic: set session status running immediately
        if (sessionId && sessionId !== '__new__') {
          useSessionContainerStore.getState().setSessionStatus(sessionId, 'running')
        }
        wsManager.sendMessage(prompt, isNew ? null : sessionId, {
          cwd: currentProjectCwd ?? undefined,
          thinkingMode,
          effort,
          ...options,
        })
      },

      respondToolApproval(requestId, decision) {
        wsManager.respondToolApproval(requestId, decision)
      },

      respondAskUser(requestId, answers) {
        wsManager.respondAskUser(requestId, answers)
      },

      respondPlanApproval(requestId, decision, feedback) {
        wsManager.respondPlanApproval(requestId, decision, feedback)
      },

      abort() {
        if (sessionId && sessionId !== '__new__') wsManager.abort(sessionId)
      },

      releaseLock() {
        if (sessionId && sessionId !== '__new__') wsManager.releaseLock(sessionId)
      },

      setPlanModalOpen(open) {
        if (sessionId && sessionId !== '__new__') {
          useSessionContainerStore.getState().setPlanModalOpen(sessionId, open)
        }
      },

      getContextUsage() {
        if (sessionId && sessionId !== '__new__') wsManager.getContextUsage(sessionId)
      },

      getMcpStatus() {
        if (sessionId && sessionId !== '__new__') wsManager.getMcpStatus(sessionId)
      },

      toggleMcpServer(serverName, enabled) {
        if (sessionId && sessionId !== '__new__') wsManager.toggleMcpServer(sessionId, serverName, enabled)
      },

      reconnectMcpServer(serverName) {
        if (sessionId && sessionId !== '__new__') wsManager.reconnectMcpServer(sessionId, serverName)
      },

      getSubagentMessages(agentId) {
        if (sessionId && sessionId !== '__new__') wsManager.getSubagentMessages(sessionId, agentId)
      },

      forkSession(atMessageId) {
        if (sessionId && sessionId !== '__new__') wsManager.forkSession(sessionId, atMessageId)
      },
    }
  }, [
    sessionId,
    globalConn.connectionStatus,
    container,
    loadMore,
    currentProjectCwd,
  ])

  return (
    <ChatSessionContext.Provider value={value}>
      {children}
    </ChatSessionContext.Provider>
  )
}
