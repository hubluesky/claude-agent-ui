import { useRef, useCallback, useEffect, useMemo } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { useMessageStore } from '../../stores/messageStore'
import { MessageComponent, isMessageVisible } from './MessageComponent'
import { ThinkingIndicator } from './ThinkingIndicator'
import { AskUserPanel } from './AskUserPanel'
import { PlanApprovalCard } from './PlanApprovalCard'
import { useConnectionStore } from '../../stores/connectionStore'

interface ChatMessagesPaneProps {
  sessionId: string
}

export function ChatMessagesPane({ sessionId }: ChatMessagesPaneProps) {
  const rawMessages = useMessageStore((s) => s.messages)
  const messages = useMemo(() => rawMessages.filter(isMessageVisible), [rawMessages])
  const hasMore = useMessageStore((s) => s.hasMore)
  const isLoadingHistory = useMessageStore((s) => s.isLoadingHistory)
  const isLoadingMore = useMessageStore((s) => s.isLoadingMore)
  const loadInitial = useMessageStore((s) => s.loadInitial)
  const loadMore = useMessageStore((s) => s.loadMore)
  const sessionStatus = useConnectionStore((s) => s.sessionStatus)
  const pendingAskUser = useConnectionStore((s) => s.pendingAskUser)
  const pendingApproval = useConnectionStore((s) => s.pendingApproval)
  const pendingPlanApproval = useConnectionStore((s) => s.pendingPlanApproval)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const isLoadingMoreRef = useRef(false)
  const isAtBottomRef = useRef(true)

  // Track loading state in ref to avoid stale closure in startReached
  isLoadingMoreRef.current = isLoadingMore

  // Load messages when session changes — must be in useEffect, not during render
  useEffect(() => {
    loadInitial(sessionId)
  }, [sessionId, loadInitial])

  // Scroll to bottom when Footer content changes (AskUserPanel, ThinkingIndicator, PermissionBanner)
  useEffect(() => {
    if (isAtBottomRef.current) {
      // Small delay to let Footer render before scrolling
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior: 'smooth' })
      })
    }
  }, [pendingAskUser?.requestId, pendingApproval?.requestId, pendingPlanApproval?.requestId, sessionStatus])

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
              <AskUserPanel />
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
