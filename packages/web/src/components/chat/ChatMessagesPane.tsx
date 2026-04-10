import { useRef, useCallback, useEffect, useMemo, useLayoutEffect } from 'react'
import { MessageComponent, isMessageVisible } from './MessageComponent'
import { ThinkingIndicator } from './ThinkingIndicator'
import { PlanApprovalCard } from './PlanApprovalCard'
import { StreamingTextBlock } from './streaming/StreamingTextBlock'
import { StreamingThinkingBlock } from './streaming/StreamingThinkingBlock'
import { StreamingToolUseBlock } from './streaming/StreamingToolUseBlock'
import { useChatSession } from '../../providers/ChatSessionContext'
import { useSessionContainerStore } from '../../stores/sessionContainerStore'
import type { SpinnerMode } from '../../stores/sessionContainerStore'

const EMPTY_QUEUE: never[] = []

interface ChatMessagesPaneProps {
  sessionId: string
  limit?: number
}

/**
 * Native-scroll message list — replaces Virtuoso to eliminate mobile flicker.
 *
 * Virtuoso programmatically adjusts scrollTop when items enter/leave the
 * virtual viewport. On mobile, these JS-driven adjustments race with the
 * browser's native momentum scroll, producing visible flicker every time
 * the user scrolls upward (new DOM nodes above → scrollTop bump → flash).
 *
 * With native scroll:
 *   - All loaded messages are in the DOM from the start (50–200 items is
 *     trivial for modern phones).
 *   - IntersectionObserver triggers loadMore at the top.
 *   - useLayoutEffect restores scroll position after prepend (runs before
 *     paint → zero visual shift).
 *   - No JS touches scrollTop during normal scroll → no flicker.
 */
const AT_BOTTOM_THRESHOLD = 50 // px from bottom to consider "at bottom"

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

  // Get streamingVersion from the container for scroll trigger
  const streamingVersion = useSessionContainerStore(
    (state) => state.containers.get(sessionId)?.streamingVersion ?? 0
  )

  // Get queue from the container
  const queue = useSessionContainerStore(
    (state) => state.containers.get(sessionId)?.queue ?? EMPTY_QUEUE
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
  const prevMessagesRef = useRef(messages)
  const prevSessionIdRef = useRef(sessionId)
  // scrollHeight captured in render phase (before React commits DOM changes)
  const scrollHeightBeforePrepend = useRef(0)
  const didPrepend = useRef(false)
  // Track whether this is the very first load (for scroll-to-bottom)
  const hasInitiallyScrolled = useRef(false)

  isLoadingMoreRef.current = isLoadingMore

  // ── Reset on session switch ──
  if (sessionId !== prevSessionIdRef.current) {
    prevMessagesRef.current = []
    prevSessionIdRef.current = sessionId
    isAtBottomRef.current = true
    hasInitiallyScrolled.current = false
  }

  // ── Detect prepend during render (before DOM commit) ──
  const prev = prevMessagesRef.current
  if (messages !== prev) {
    didPrepend.current = false
    if (messages.length > prev.length && prev.length > 0) {
      const prevLast = prev[prev.length - 1]
      const currLast = messages[messages.length - 1]
      if (prevLast === currLast) {
        // Items were prepended — save current scrollHeight before React commits
        didPrepend.current = true
        scrollHeightBeforePrepend.current = scrollRef.current?.scrollHeight ?? 0
      }
    }
    prevMessagesRef.current = messages
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
    if (!hasInitiallyScrolled.current && messages.length > 0) {
      hasInitiallyScrolled.current = true
      requestAnimationFrame(() => scrollToBottom('auto'))
    }
  }, [messages.length, scrollToBottom])

  // ── Auto-scroll on new messages at bottom (streaming) ──
  useEffect(() => {
    if (!hasInitiallyScrolled.current) return
    // Only follow if it's an append (new message at bottom), not a prepend
    if (isAtBottomRef.current && messages.length > 0 && !didPrepend.current) {
      requestAnimationFrame(() => scrollToBottom('smooth'))
    }
  }, [messages.length, streamingVersion, scrollToBottom])

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
      className="flex-1 overflow-y-auto overflow-x-hidden"
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

      {/* Messages — all rendered, no virtualization */}
      {messages.map((msg, i) => (
        <div
          key={(msg as any).uuid ?? `msg-${i}`}
          className="px-4 py-2.5 empty:p-0"
        >
          <MessageComponent message={msg} />
        </div>
      ))}

      {/* Streaming content — appended after completed messages, independent of messages[] */}
      {hasStreamingContent && (
        <div className="px-4 py-2.5">
          <div className="flex items-start">
            <div className="flex-1 min-w-0 flex gap-3 items-start">
              <div className="w-7 h-7 rounded-full bg-[var(--bg-secondary)] border border-[var(--border)] flex items-center justify-center shrink-0">
                <span className="text-xs font-bold font-mono text-[var(--accent)]">C</span>
              </div>
              <div className="flex-1 min-w-0 space-y-2">
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
          </div>
        </div>
      )}

      {/* Footer — derive visibility from messages: show when the last
          non-system message is a user message or streaming assistant (i.e., still
          waiting for a complete assistant response). No flags needed. */}
      {sessionStatus === 'running' && (() => {
        if (hasStreamingContent) return true
        // Walk backward to find the last non-system message
        for (let i = rawMessages.length - 1; i >= 0; i--) {
          const t = (rawMessages[i] as any).type
          if (t === 'system' || t === 'result') continue
          // If last substantive message is user → show indicator
          return t === 'user'
        }
        return true // no messages yet → show
      })() && (
        <div className="px-4 py-2.5">
          <ThinkingIndicator
            spinnerMode={spinnerMode}
            requestStartTime={requestStartTime}
            thinkingStartTime={thinkingStartTime}
            thinkingEndTime={thinkingEndTime}
            responseLength={responseLength}
            messages={rawMessages}
          />
        </div>
      )}
      {/* Queued messages */}
      {queue.length > 0 && queue.map((item) => (
        <div key={item.id} className="px-4 py-2.5">
          <div className="flex items-start gap-3 opacity-50">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--accent)]/20 flex items-center justify-center">
              <span className="text-xs text-[var(--accent)]">Q</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-[var(--text-tertiary)] mb-0.5">Queued</div>
              <div className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap break-words line-clamp-3">
                {item.prompt}
              </div>
            </div>
          </div>
        </div>
      ))}
      <PlanApprovalCard />
    </div>
  )
}
