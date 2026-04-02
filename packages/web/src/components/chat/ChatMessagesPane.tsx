import { useRef, useCallback, useEffect } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { useMessageStore } from '../../stores/messageStore'
import { MessageComponent } from './MessageComponent'
import { ThinkingIndicator } from './ThinkingIndicator'
import { useConnectionStore } from '../../stores/connectionStore'

interface ChatMessagesPaneProps {
  sessionId: string
}

export function ChatMessagesPane({ sessionId }: ChatMessagesPaneProps) {
  const messages = useMessageStore((s) => s.messages)
  const hasMore = useMessageStore((s) => s.hasMore)
  const isLoadingHistory = useMessageStore((s) => s.isLoadingHistory)
  const isLoadingMore = useMessageStore((s) => s.isLoadingMore)
  const loadInitial = useMessageStore((s) => s.loadInitial)
  const loadMore = useMessageStore((s) => s.loadMore)
  const sessionStatus = useConnectionStore((s) => s.sessionStatus)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const isLoadingMoreRef = useRef(false)

  // Track loading state in ref to avoid stale closure in startReached
  isLoadingMoreRef.current = isLoadingMore

  // Load messages when session changes — must be in useEffect, not during render
  useEffect(() => {
    loadInitial(sessionId)
  }, [sessionId, loadInitial])

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
        computeItemKey={(_index, msg) => (msg as any).uuid ?? (msg as any).message?.id ?? `msg-${_index}`}
        initialTopMostItemIndex={Math.max(0, messages.length - 1)}
        followOutput="smooth"
        alignToBottom
        atTopThreshold={200}
        startReached={handleStartReached}
        increaseViewportBy={{ top: 400, bottom: 200 }}
        itemContent={(_index, msg) => (
          <div className="px-4 py-2.5">
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
            sessionStatus === 'running' ? (
              <div className="px-4 py-2.5">
                <ThinkingIndicator />
              </div>
            ) : null
          ),
        }}
        className="flex-1"
        style={{ overflowX: 'hidden' }}
      />
    </div>
  )
}
