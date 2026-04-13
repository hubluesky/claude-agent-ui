/**
 * Queue processor — determines HOW to dequeue commands.
 *
 * Direct port of Claude Code's queueProcessor.ts + print.ts canBatchWith logic.
 *
 * Strategy:
 *   - Slash commands: dequeue one at a time (need individual processing)
 *   - Bash commands:  dequeue one at a time (error isolation, progress UI)
 *   - Prompt commands: batch all consecutive same-mode non-slash commands
 *
 * @see Claude Code src/utils/queueProcessor.ts processQueueIfReady()
 * @see Claude Code src/cli/print.ts canBatchWith() (line 437)
 */

import type { QueuedCommand } from '@claude-agent-ui/shared'
import type { MessageQueueManager } from './message-queue-manager.js'

export interface ProcessorCallbacks {
  /** Execute the given commands as a single turn */
  executeInput(commands: QueuedCommand[]): void
  /** Whether the session is currently busy (running / awaiting_approval / awaiting_user_input) */
  isSessionBusy(): boolean
}

/**
 * Whether this command is a slash command.
 * @see Claude Code queueProcessor.ts isSlashCommand()
 */
function isSlashCommand(cmd: QueuedCommand): boolean {
  return cmd.mode === 'slash'
}

/**
 * Whether `next` can be batched into the same turn as `head`.
 * Only prompt-mode commands batch.
 *
 * @see Claude Code print.ts canBatchWith() (line 437-446)
 */
function canBatchWith(
  head: QueuedCommand,
  next: QueuedCommand | undefined,
): boolean {
  return (
    next !== undefined &&
    next.mode === 'prompt' &&
    head.mode === 'prompt' &&
    !isSlashCommand(next)
  )
}

/**
 * Join prompt values from multiple queued commands into one newline-joined string.
 * @see Claude Code print.ts joinPromptValues() (line 422-427)
 */
export function joinPromptValues(values: string[]): string {
  if (values.length === 1) return values[0]!
  return values.join('\n')
}

/**
 * Process the next command(s) from the queue if the session is idle.
 *
 * Slash commands and bash-mode commands are processed individually.
 * Prompt commands are batched: all items with the same mode are drained at
 * once and passed as a single array to executeInput — each keeps its own UUID.
 *
 * @see Claude Code queueProcessor.ts processQueueIfReady()
 * @see Claude Code print.ts drainCommandQueue() (line 1931-1958)
 */
export function processQueue(
  queue: MessageQueueManager,
  callbacks: ProcessorCallbacks,
): void {
  if (callbacks.isSessionBusy()) return

  const next = queue.peek()
  if (!next) return

  // Slash and bash: dequeue exactly one — need individual processing
  // @see Claude Code queueProcessor.ts line 70-73
  if (isSlashCommand(next) || next.mode === 'bash') {
    const cmd = queue.dequeue()!
    callbacks.executeInput([cmd])
    return
  }

  // Prompt mode: batch consecutive same-mode non-slash commands
  // @see Claude Code queueProcessor.ts line 76-86
  // @see Claude Code print.ts drainCommandQueue line 1946-1958
  const head = queue.dequeue()!
  const batch: QueuedCommand[] = [head]

  while (canBatchWith(head, queue.peek())) {
    batch.push(queue.dequeue()!)
  }

  callbacks.executeInput(batch)
}
