import { useRef, useCallback, useEffect, useMemo } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { MessageComponent, isMessageVisible } from './MessageComponent'
import { ThinkingIndicator } from './ThinkingIndicator'
import { PlanApprovalCard } from './PlanApprovalCard'
import { useChatSession } from '../../providers/ChatSessionContext'

interface ChatMessagesPaneProps {
  sessionId: string
  limit?: number
}

// Virtuoso firstItemIndex: start at a high number so we have room to prepend.
// When loadMore prepends N items, firstItemIndex decreases by N, keeping the
// logical indices of existing items stable → no scroll jump / flicker.
const START_INDEX = 100_000

export function ChatMessagesPane({ sessionId, limit }: ChatMessagesPaneProps) {
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
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const isLoadingMoreRef = useRef(false)
  const isAtBottomRef = useRef(true)

  // Track loading state in ref to avoid stale closure in startReached
  isLoadingMoreRef.current = isLoadingMore

  // ── firstItemIndex tracking (anti-flicker for loadMore prepend) ─────
  // Compute during render (before Virtuoso draws) so there's zero delay.
  const firstItemIndexRef = useRef(START_INDEX)
  const prevMessagesRef = useRef(messages)
  const prevSessionIdRef = useRef(sessionId)

  // Reset on session switch
  if (sessionId !== prevSessionIdRef.current) {
    firstItemIndexRef.current = START_INDEX
    prevMessagesRef.current = []
    prevSessionIdRef.current = sessionId
  }

  // Detect prepend: array grew AND the last element is the same reference → items prepended
  const prev = prevMessagesRef.current
  if (messages !== prev) {
    if (messages.length > prev.length && prev.length > 0) {
      const prevLast = prev[prev.length - 1]
      const currLast = messages[messages.length - 1]
      if (prevLast === currLast) {
        // loadMore prepended items
        firstItemIndexRef.current -= (messages.length - prev.length)
      }
    } else if (messages.length === 0 || (prev.length > 0 && messages.length > 0
        && messages[messages.length - 1] !== prev[prev.length - 1]
        && messages.length <= prev.length)) {
      // Full replacement (loadInitial, session switch) → reset
      firstItemIndexRef.current = START_INDEX
    }
    prevMessagesRef.current = messages
  }

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
        firstItemIndex={firstItemIndexRef.current}
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
