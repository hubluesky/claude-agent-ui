/**
 * Priority for messages sent to Claude Code's internal stdin queue.
 *
 * This is still used when forwarding a prompt mid-turn, even though the web UI
 * no longer exposes the CLI queue as shared state.
 */
export type QueuePriority = 'now' | 'next' | 'later'

export const PRIORITY_ORDER: Record<QueuePriority, number> = {
  now: 0,
  next: 1,
  later: 2,
}

/**
 * Local-only pending submission state for mid-turn injections.
 *
 * These items are visible only to the sending connection until Claude Code
 * replays the corresponding user message UUID.
 */
export type LocalPendingStatus = 'pending' | 'failed'

export interface LocalPendingItem {
  id: string
  value: string
  status: LocalPendingStatus
  addedAt: number
  errorMessage?: string
}
