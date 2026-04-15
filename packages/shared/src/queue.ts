/**
 * Message queue types — mirrors Claude Code's textInputTypes.ts queue types
 * and messageQueueManager.ts semantics.
 *
 * Priority: 'now' > 'next' > 'later'
 *   - now:   Interrupt and send immediately (abort in-flight tool)
 *   - next:  Standard user input (default)
 *   - later: End-of-turn drain (task notifications, system messages)
 *
 * @see Claude Code src/types/textInputTypes.ts (QueuePriority, QueuedCommand)
 * @see Claude Code src/utils/messageQueueManager.ts
 */

// ── Priority ──

export type QueuePriority = 'now' | 'next' | 'later'

export const PRIORITY_ORDER: Record<QueuePriority, number> = {
  now: 0,
  next: 1,
  later: 2,
}

// ── Command Mode ──

export type CommandMode = 'prompt' | 'bash' | 'slash' | 'task-notification'

// ── QueuedCommand (server-side canonical type) ──

export interface QueuedCommand {
  id: string
  value: string
  mode: CommandMode
  /** Defaults to 'next' when enqueued. */
  priority: QueuePriority
  /** false for task-notification; true for prompt/bash/slash */
  editable: boolean
  connectionId: string
  addedAt: number
  images?: { data: string; mediaType: string }[]
  options?: {
    cwd?: string
    thinkingMode?: string
    effort?: string
    permissionMode?: string
  }
  /**
   * Whether this command has been forwarded to the CLI process for mid-query injection.
   * Forwarded commands should NOT be re-sent on session complete (CLI already has them).
   * On abort, forwarded commands are NOT returned to the composer — they remain in
   * the CLI's internal queue and will be processed in the next turn.
   *
   * @see Claude Code query.ts:1573-1593 getCommandsByMaxPriority() mid-query attachment
   */
  forwarded?: boolean
}

// ── Wire type for S2C queue-updated (subset — no connectionId/options) ──

export interface QueueItemWire {
  id: string
  value: string
  mode: CommandMode
  priority: QueuePriority
  editable: boolean
  addedAt: number
  images?: { data: string; mediaType: string }[]
}
