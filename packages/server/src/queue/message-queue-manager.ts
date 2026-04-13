/**
 * Per-session message queue manager.
 *
 * Direct port of Claude Code's messageQueueManager.ts, adapted from a global
 * singleton to a per-session instance (because we're a server managing many
 * sessions, not a single CLI process).
 *
 * Priority determines dequeue order: 'now' > 'next' > 'later'.
 * Within the same priority, commands are processed FIFO.
 *
 * @see Claude Code src/utils/messageQueueManager.ts
 */

import { EventEmitter } from 'events'
import type { QueuedCommand, QueuePriority, QueueItemWire } from '@claude-agent-ui/shared'
import { PRIORITY_ORDER } from '@claude-agent-ui/shared'

type FilterFn = (cmd: QueuedCommand) => boolean

export class MessageQueueManager extends EventEmitter {
  private queue: QueuedCommand[] = []

  // ── Enqueue ──

  /**
   * Add a command to the queue.
   * @see Claude Code messageQueueManager.ts enqueue()
   */
  enqueue(command: QueuedCommand): void {
    this.queue.push({ ...command, priority: command.priority ?? 'next' })
    this.notify()
  }

  // ── Dequeue ──

  /**
   * Remove and return the highest-priority command, or undefined if empty.
   * Within the same priority level, commands are dequeued FIFO.
   *
   * An optional `filter` narrows the candidates: only commands for which the
   * predicate returns `true` are considered. Non-matching commands stay in the
   * queue untouched.
   *
   * @see Claude Code messageQueueManager.ts dequeue()
   */
  dequeue(filter?: FilterFn): QueuedCommand | undefined {
    if (this.queue.length === 0) return undefined

    let bestIdx = -1
    let bestPriority = Infinity
    for (let i = 0; i < this.queue.length; i++) {
      const cmd = this.queue[i]!
      if (filter && !filter(cmd)) continue
      const priority = PRIORITY_ORDER[cmd.priority ?? 'next']
      if (priority < bestPriority) {
        bestIdx = i
        bestPriority = priority
      }
    }

    if (bestIdx === -1) return undefined
    const [dequeued] = this.queue.splice(bestIdx, 1)
    this.notify()
    return dequeued
  }

  // ── Peek ──

  /**
   * Return the highest-priority command without removing it, or undefined if empty.
   * Accepts an optional `filter`.
   *
   * @see Claude Code messageQueueManager.ts peek()
   */
  peek(filter?: FilterFn): QueuedCommand | undefined {
    if (this.queue.length === 0) return undefined

    let bestIdx = -1
    let bestPriority = Infinity
    for (let i = 0; i < this.queue.length; i++) {
      const cmd = this.queue[i]!
      if (filter && !filter(cmd)) continue
      const priority = PRIORITY_ORDER[cmd.priority ?? 'next']
      if (priority < bestPriority) {
        bestIdx = i
        bestPriority = priority
      }
    }

    if (bestIdx === -1) return undefined
    return this.queue[bestIdx]
  }

  // ── Batch dequeue ──

  /**
   * Remove and return all commands matching a predicate, preserving priority order.
   * Non-matching commands stay in the queue.
   *
   * @see Claude Code messageQueueManager.ts dequeueAllMatching()
   */
  dequeueAllMatching(predicate: FilterFn): QueuedCommand[] {
    const matched: QueuedCommand[] = []
    const remaining: QueuedCommand[] = []
    for (const cmd of this.queue) {
      if (predicate(cmd)) {
        matched.push(cmd)
      } else {
        remaining.push(cmd)
      }
    }
    if (matched.length === 0) return []

    this.queue.length = 0
    this.queue.push(...remaining)
    this.notify()
    return matched
  }

  // ── Cancel support ──

  /**
   * Pop all editable commands and return them. Non-editable commands
   * (task-notification) stay in the queue for auto-processing later.
   *
   * @see Claude Code messageQueueManager.ts popAllEditable()
   */
  popAllEditable(): QueuedCommand[] {
    if (this.queue.length === 0) return []

    const editable: QueuedCommand[] = []
    const nonEditable: QueuedCommand[] = []
    for (const cmd of this.queue) {
      if (cmd.editable) {
        editable.push(cmd)
      } else {
        nonEditable.push(cmd)
      }
    }

    if (editable.length === 0) return []

    this.queue.length = 0
    this.queue.push(...nonEditable)
    this.notify()
    return editable
  }

  // ── Remove by ID ──

  removeById(id: string): boolean {
    const idx = this.queue.findIndex(cmd => cmd.id === id)
    if (idx === -1) return false
    this.queue.splice(idx, 1)
    this.notify()
    return true
  }

  // ── Accessors ──

  get length(): number {
    return this.queue.length
  }

  get isEmpty(): boolean {
    return this.queue.length === 0
  }

  /**
   * Convert queue to wire format for S2C broadcast (strips connectionId/options).
   */
  toWireArray(): QueueItemWire[] {
    return this.queue.map(cmd => ({
      id: cmd.id,
      value: cmd.value,
      mode: cmd.mode,
      priority: cmd.priority,
      editable: cmd.editable,
      addedAt: cmd.addedAt,
      images: cmd.images,
    }))
  }

  /**
   * Clear all commands from the queue.
   */
  clear(): void {
    if (this.queue.length === 0) return
    this.queue.length = 0
    this.notify()
  }

  // ── Internal ──

  private notify(): void {
    this.emit('changed')
  }
}
