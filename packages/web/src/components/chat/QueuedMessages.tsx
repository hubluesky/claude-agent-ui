import { memo } from 'react'
import type { LocalPendingItem } from '@claude-cockpit/shared'
import { useShallow } from 'zustand/react/shallow'
import { wsManager } from '../../lib/WebSocketManager'
import { useSessionContainerStore } from '../../stores/sessionContainerStore'

const EMPTY_ITEMS: LocalPendingItem[] = []

function PendingItemCard({
  item,
  sessionId,
  retryDisabled,
}: {
  item: LocalPendingItem
  sessionId: string
  retryDisabled: boolean
}) {
  const isFailed = item.status === 'failed'

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 whitespace-pre-wrap break-words text-sm text-[var(--text-secondary)]">
          {item.value}
        </p>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
            isFailed
              ? 'bg-red-500/10 text-red-500'
              : 'bg-amber-500/10 text-amber-500'
          }`}
        >
          {item.status}
        </span>
      </div>

      {isFailed ? (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="min-w-0 text-xs text-[var(--text-muted)]">
            {item.errorMessage ?? 'Claude Code did not confirm this message.'}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={retryDisabled}
              onClick={() => wsManager.retryLocalPending(sessionId, item.id)}
            >
              Retry
            </button>
            <button
              type="button"
              className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-secondary)]"
              onClick={() => wsManager.dismissLocalPending(sessionId, item.id)}
            >
              Ignore
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export const QueuedMessages = memo(function QueuedMessages({ sessionId }: { sessionId: string }) {
  const { items, lockStatus } = useSessionContainerStore(
    useShallow((state) => {
      const container = state.containers.get(sessionId)
      return {
        items: container?.localPending ?? EMPTY_ITEMS,
        lockStatus: container?.lockStatus ?? 'idle',
      }
    }),
  )

  if (items.length === 0) return null

  return (
    <div className="shrink-0 px-5 pb-2">
      <div className="mb-2 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
        Pending
      </div>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <PendingItemCard
            key={item.id}
            item={item}
            sessionId={sessionId}
            retryDisabled={lockStatus === 'locked_other'}
          />
        ))}
      </div>
    </div>
  )
})
