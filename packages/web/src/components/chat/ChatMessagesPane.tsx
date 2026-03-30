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

  useEffect(() => {
    if (shouldAutoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length])

  const handleScroll = () => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 100
  }

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
