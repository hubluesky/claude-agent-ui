import { useRef, useCallback, useEffect, useMemo } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { useMessageStore } from '../../stores/messageStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { MessageComponent, isMessageVisible } from './MessageComponent'
import { ThinkingIndicator } from './ThinkingIndicator'
import { PlanApprovalCard } from './PlanApprovalCard'
import { useChatSession } from '../../providers/ChatSessionContext'

interface ChatMessagesPaneProps {
  sessionId: string
  limit?: number
  /** When true, skip global messageStore loadInitial (Multi mode panels load independently) */
  compact?: boolean
}

export function ChatMessagesPane({ sessionId, limit, compact }: ChatMessagesPaneProps) {
  const ctx = useChatSession()
  const rawMessages = ctx.messages
  const messages = useMemo(() => {
    const visible = rawMessages.filter(isMessageVisible)
    return limit ? visible.slice(-limit) : visible
  }, [rawMessages, limit])
  const hasMore = ctx.hasMore
  const isLoadingHistory = ctx.isLoadingHistory
  const isLoadingMore = ctx.isLoadingMore
  const loadMore = ctx.loadMore
  const sessionStatus = ctx.sessionStatus
  const pendingPlanApproval = ctx.pendingPlanApproval
  const loadInitial = useMessageStore((s) => s.loadInitial)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const isLoadingMoreRef = useRef(false)
  const isAtBottomRef = useRef(true)

  // Track loading state in ref to avoid stale closure in startReached
  isLoadingMoreRef.current = isLoadingMore

  // Load messages when session changes or when returning to single mode.
  // Compact panels (Multi mode) load independently; skip global store load.
  const viewMode = useSettingsStore((s) => s.viewMode)
  useEffect(() => {
    if (!compact) loadInitial(sessionId)
  }, [sessionId, loadInitial, compact, viewMode])

  // Scroll to bottom when Footer content changes (PlanApprovalCard, ThinkingIndicator)
  useEffect(() => {
    if (isAtBottomRef.current) {
      // Small delay to let Footer render before scrolling
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior: 'smooth' })
      })
    }
  }, [pendingPlanApproval?.requestId, sessionStatus])

  // Scroll to bottom on initial message load
  const prevMessageCountRef = useRef(0)
  useEffect(() => {
    if (prevMessageCountRef.current === 0 && messages.length > 0) {
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, behavior: 'auto' })
      })
    }
    prevMessageCountRef.current = messages.length
  }, [messages.length])

  const handleStartReached = useCallback(() => {
    if (hasMore && !isLoadingMoreRef.current) {
      loadMore()
    }
  }, [hasMore, loadMore])

  if (isLoadingHistory) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#7c7872] text-sm">
        Loading messages...
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Virtuoso
        ref={virtuosoRef}
        data={messages}
        initialTopMostItemIndex={Math.max(0, messages.length - 1)}
        followOutput="smooth"
        alignToBottom
        atBottomStateChange={(atBottom) => { isAtBottomRef.current = atBottom }}
        atTopThreshold={200}
        startReached={handleStartReached}
        increaseViewportBy={{ top: 400, bottom: 200 }}
        itemContent={(_index, msg) => (
          <div className="px-4 py-2.5 empty:p-0">
            <MessageComponent message={msg} />
          </div>
        )}
        components={{
          Header: () => (
            isLoadingMore ? (
              <p className="text-center text-xs text-[#7c7872] py-2">Loading earlier messages...</p>
            ) : null
          ),
          Footer: () => (
            <>
              {sessionStatus === 'running' && (
                <div className="px-4 py-2.5">
                  <ThinkingIndicator />
                </div>
              )}
              <PlanApprovalCard />
            </>
          ),
        }}
        className="flex-1"
        style={{ overflowX: 'hidden' }}
      />
    </div>
  )
}
