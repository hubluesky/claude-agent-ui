import { useRef, useCallback, useEffect, useMemo, useLayoutEffect } from 'react'
import { MessageComponent } from './MessageComponent'
import { ThinkingIndicator } from './ThinkingIndicator'
import { PlanApprovalCard } from './PlanApprovalCard'
import { StreamingTextBlock } from './streaming/StreamingTextBlock'
import { StreamingThinkingBlock } from './streaming/StreamingThinkingBlock'
import { StreamingToolUseBlock } from './streaming/StreamingToolUseBlock'
import { TurnCompletionLine } from './messages/TurnCompletionLine'
import { useChatSession } from '../../providers/ChatSessionContext'
import { useSessionContainerStore } from '../../stores/sessionContainerStore'
import { useProcessedMessages } from '../../hooks/useProcessedMessages'
import { isCollapsedGroup } from '../../utils/collapseReadSearch'
import type { SpinnerMode, TurnSummary } from '../../stores/sessionContainerStore'

interface ChatMessagesPaneProps {
  sessionId: string
  limit?: number
}

const AT_BOTTOM_THRESHOLD = 50

export function ChatMessagesPane({ sessionId, limit }: ChatMessagesPaneProps) {
  const ctx = useChatSession()
  const rawMessages = ctx.messages

  // ── Pipeline: normalize → filter → collapse → lookups ──
  const limitedRaw = useMemo(() => {
    return limit ? rawMessages.slice(-limit) : rawMessages
  }, [rawMessages, limit])

  const { items, lookups } = useProcessedMessages(limitedRaw)

  const hasMore = ctx.hasMore
  const isLoadingHistory = ctx.isLoadingHistory
  const isLoadingMore = ctx.isLoadingMore
  const loadMore = ctx.loadMore
  const sessionStatus = ctx.sessionStatus
  const pendingPlanApproval = ctx.pendingPlanApproval

  // Get streamingVersion from the container for scroll trigger
  const streamingVersion = useSessionContainerStore(
    (state) => state.containers.get(sessionId)?.streamingVersion ?? 0
  )

  // ── Spinner state from Zustand (reactive, no polling) ──
  const spinnerMode = useSessionContainerStore(
    (state) => state.containers.get(sessionId)?.spinnerMode ?? null
  ) as SpinnerMode | null
  const requestStartTime = useSessionContainerStore(
    (state) => state.containers.get(sessionId)?.requestStartTime ?? null
  )
  const thinkingStartTime = useSessionContainerStore(
    (state) => state.containers.get(sessionId)?.thinkingStartTime ?? null
  )
  const thinkingEndTime = useSessionContainerStore(
    (state) => state.containers.get(sessionId)?.thinkingEndTime ?? null
  )
  const responseLength = useSessionContainerStore(
    (state) => state.containers.get(sessionId)?.responseLength ?? 0
  )

  // ── Turn summary (shown after turn completes) ──
  const turnSummary = useSessionContainerStore(
    (state) => state.containers.get(sessionId)?.turnSummary ?? null
  ) as TurnSummary | null

  // ── Current task title (from TodoWrite) ──
  const currentTaskTitle = useSessionContainerStore(
    (state) => state.containers.get(sessionId)?.currentTaskTitle ?? null
  )

  // ── Streaming state ──
  const streaming = useSessionContainerStore(
    (state) => state.containers.get(sessionId)?.streaming ?? null
  )
  const hasStreamingContent = !!(streaming?.text || streaming?.thinking || (streaming?.toolUses?.length ?? 0) > 0 || (streaming?.completedBlocks?.length ?? 0) > 0)

  const scrollRef = useRef<HTMLDivElement>(null)
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  const isLoadingMoreRef = useRef(false)

  // ── Refs for detecting prepend vs append vs initial load ──
  const prevItemsLenRef = useRef(items.length)
  const prevSessionIdRef = useRef(sessionId)
  const scrollHeightBeforePrepend = useRef(0)
  const didPrepend = useRef(false)
  const hasInitiallyScrolled = useRef(false)

  isLoadingMoreRef.current = isLoadingMore

  // ── Reset on session switch ──
  if (sessionId !== prevSessionIdRef.current) {
    prevItemsLenRef.current = 0
    prevSessionIdRef.current = sessionId
    isAtBottomRef.current = true
    hasInitiallyScrolled.current = false
  }

  // ── Detect prepend during render (before DOM commit) ──
  const prevLen = prevItemsLenRef.current
  if (items.length !== prevLen) {
    didPrepend.current = false
    if (items.length > prevLen && prevLen > 0) {
      // Check if the last item UUID is the same → items were prepended
      const prevLastUuid = prevLen > 0 ? getItemUuid(items[items.length - 1]) : null
      // Simple heuristic: if items grew but we're loading more, assume prepend
      if (isLoadingMore && prevLastUuid) {
        didPrepend.current = true
        scrollHeightBeforePrepend.current = scrollRef.current?.scrollHeight ?? 0
      }
    }
    prevItemsLenRef.current = items.length
  }

  // ── Restore scroll position after prepend (before browser paints) ──
  useLayoutEffect(() => {
    if (didPrepend.current) {
      didPrepend.current = false
      const el = scrollRef.current
      if (el && scrollHeightBeforePrepend.current > 0) {
        const delta = el.scrollHeight - scrollHeightBeforePrepend.current
        el.scrollTop += delta
      }
      scrollHeightBeforePrepend.current = 0
    }
  })

  // ── Track if user is at bottom ──
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    isAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_THRESHOLD
  }, [])

  // ── Scroll to bottom helper ──
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  // ── Initial load → scroll to bottom ──
  useEffect(() => {
    if (!hasInitiallyScrolled.current && items.length > 0) {
      hasInitiallyScrolled.current = true
      requestAnimationFrame(() => scrollToBottom('auto'))
    }
  }, [items.length, scrollToBottom])

  // ── Auto-scroll on new messages at bottom (streaming) ──
  useEffect(() => {
    if (!hasInitiallyScrolled.current) return
    if (isAtBottomRef.current && items.length > 0 && !didPrepend.current) {
      requestAnimationFrame(() => scrollToBottom('smooth'))
    }
  }, [items.length, streamingVersion, scrollToBottom])

  // ── Scroll to bottom when Footer content changes ──
  useEffect(() => {
    if (isAtBottomRef.current) {
      requestAnimationFrame(() => scrollToBottom('smooth'))
    }
  }, [pendingPlanApproval?.requestId, sessionStatus, scrollToBottom])

  // ── IntersectionObserver for loadMore ──
  useEffect(() => {
    const sentinel = topSentinelRef.current
    const scroller = scrollRef.current
    if (!sentinel || !scroller) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMoreRef.current) {
          loadMore()
        }
      },
      { root: scroller, threshold: 0, rootMargin: '200px 0px 0px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loadMore])

  if (isLoadingHistory) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-sm">
        Loading messages...
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col"
      onScroll={handleScroll}
    >
      {/* Top sentinel for loadMore trigger */}
      <div ref={topSentinelRef} className="h-px" />

      {/* Loading indicator */}
      {isLoadingMore && (
        <p className="text-center text-xs text-[var(--text-muted)] py-2">
          Loading earlier messages...
        </p>
      )}

      {/* Messages — pipeline output (normalized + collapsed) */}
      {items.map((item, i) => (
        <div
          key={getItemUuid(item) ?? `msg-${i}`}
          className="px-4 py-2.5 empty:p-0"
        >
          <MessageComponent item={item} lookups={lookups} />
        </div>
      ))}

      {/* Streaming content — appended after completed messages */}
      {hasStreamingContent && (
        <div className="px-4 py-2.5">
          <div className="pl-3 border-l-[3px] border-[var(--accent)] border-opacity-50 space-y-2">
            {streaming?.completedBlocks.map((block, i) => (
              block.type === 'thinking'
                ? <StreamingThinkingBlock key={`cb-${i}`} content={block.content} />
                : <StreamingTextBlock key={`cb-${i}`} text={block.content} />
            ))}
            {streaming?.thinking && (
              <StreamingThinkingBlock content={streaming.thinking} />
            )}
            {streaming?.toolUses.map(tool => (
              <StreamingToolUseBlock key={tool.id} tool={tool} />
            ))}
            {streaming?.text && (
              <StreamingTextBlock text={streaming.text} />
            )}
          </div>
        </div>
      )}

      {/* Turn completion summary (shown after turn finishes, before next turn starts) */}
      {turnSummary && sessionStatus !== 'running' && (
        <div className="px-4 py-1.5">
          <TurnCompletionLine summary={turnSummary} />
        </div>
      )}

      {/* flexGrow spacer — pushes spinner to bottom of scroll area (matches CLI's <Box flexGrow={1} />) */}
      <div className="flex-grow" />

      {/* Spinner indicator — inside scroll area, pushed to bottom by flexGrow spacer */}
      {sessionStatus === 'running' && (
        <div className="px-4 py-2.5">
          <ThinkingIndicator
            spinnerMode={spinnerMode}
            requestStartTime={requestStartTime}
            thinkingStartTime={thinkingStartTime}
            thinkingEndTime={thinkingEndTime}
            responseLength={responseLength}
            currentTaskTitle={currentTaskTitle}
          />
        </div>
      )}
      <PlanApprovalCard />
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────

function getItemUuid(item: any): string | undefined {
  if (isCollapsedGroup(item)) return item.uuid
  return item.uuid
}
