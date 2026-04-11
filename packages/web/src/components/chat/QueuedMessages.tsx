import { memo, useState, useCallback } from 'react'
import { useSessionContainerStore } from '../../stores/sessionContainerStore'
import type { QueueItem } from '@claude-agent-ui/shared'

const EMPTY_QUEUE: QueueItem[] = []

function QueuedMessageItem({ item }: { item: QueueItem }) {
  const [expanded, setExpanded] = useState(false)
  const toggle = useCallback(() => setExpanded(prev => !prev), [])

  return (
    <div
      className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg px-3 py-1.5 cursor-pointer opacity-60 hover:opacity-80 transition-opacity"
      onClick={toggle}
    >
      <p className={`text-sm text-[var(--text-secondary)] ${expanded ? 'whitespace-pre-wrap' : 'truncate'}`}>
        {item.prompt}
      </p>
    </div>
  )
}

export const QueuedMessages = memo(function QueuedMessages({ sessionId }: { sessionId: string }) {
  const queue = useSessionContainerStore(
    (state) => state.containers.get(sessionId)?.queue ?? EMPTY_QUEUE
  )

  if (queue.length === 0) return null

  return (
    <div className="shrink-0 px-5 pb-2 flex flex-col gap-1">
      {queue.map((item) => (
        <QueuedMessageItem key={item.id} item={item} />
      ))}
    </div>
  )
})
