/**
 * normalizeMessages — Splits multi-block SDK messages into single-block normalized messages.
 *
 * Mirrors Claude Code's normalizeMessages (messages.ts:732-825).
 * Core principle: one content block = one independent renderable message.
 *
 * Assistant message with [thinking, text, tool_use] → 3 NormalizedMessages.
 * User message with [text, tool_result, image] → 3 NormalizedMessages.
 * System/result/etc → pass through unchanged as NormalizedMessage with block=null.
 */

import type { AgentMessage } from '@claude-cockpit/shared'

// ─── Types ───────────────────────────────────────────────

export interface ContentBlock {
  type: string
  [key: string]: unknown
}

/** A normalized message wrapping exactly ONE content block (or none for passthrough types). */
export interface NormalizedMessage {
  /** Discriminator: 'normalized' for split block messages, 'passthrough' for non-splittable types */
  _kind: 'normalized' | 'passthrough'
  /** Message type from original SDK message */
  type: string
  /** Stable UUID — index 0 preserves original, others get derived UUID */
  uuid: string
  /** Original message UUID (for fork, correlation) */
  originalUuid: string
  /** The single content block (null for passthrough types like system, result, etc.) */
  block: ContentBlock | null
  /** Block index in the original message's content array */
  blockIndex: number
  /** Role: 'assistant' or 'user' (only for normalized messages) */
  role: 'assistant' | 'user' | null
  /** Reference to the original SDK message (preserves all fields) */
  original: AgentMessage
  /** Optimistic message flag */
  isOptimistic: boolean
}

// ─── UUID derivation ─────────────────────────────────────

/**
 * Derive a stable UUID for split blocks.
 * Index 0 preserves the original UUID (critical for forkSession(atMessageId)).
 * Index > 0 appends a suffix.
 */
export function deriveUUID(parentUuid: string | undefined, index: number): string {
  if (!parentUuid) return `msg-${Date.now()}-${index}`
  if (index === 0) return parentUuid
  return `${parentUuid}-${index}`
}

// ─── Core function ───────────────────────────────────────

export function normalizeMessages(messages: AgentMessage[]): NormalizedMessage[] {
  return messages.flatMap((msg): NormalizedMessage | NormalizedMessage[] => {
    const uuid = (msg as any).uuid as string | undefined
    const isOptimistic = !!(msg as any)._optimistic

    // Assistant messages: split by content blocks
    if (msg.type === 'assistant') {
      const content = (msg as any).message?.content
      if (!Array.isArray(content) || content.length === 0) {
        return [{
          _kind: 'normalized' as const,
          type: 'assistant',
          uuid: uuid ?? `msg-${Date.now()}`,
          originalUuid: uuid ?? '',
          block: null,
          blockIndex: 0,
          role: 'assistant' as const,
          original: msg,
          isOptimistic,
        }]
      }

      return content.map((block: ContentBlock, index: number): NormalizedMessage => ({
        _kind: 'normalized',
        type: 'assistant',
        uuid: deriveUUID(uuid, index),
        originalUuid: uuid ?? '',
        block,
        blockIndex: index,
        role: 'assistant',
        original: msg,
        isOptimistic,
      }))
    }

    // User messages: split by content blocks
    if (msg.type === 'user') {
      const content = (msg as any).message?.content

      // String content → single text block
      if (typeof content === 'string') {
        return [{
          _kind: 'normalized' as const,
          type: 'user',
          uuid: uuid ?? `msg-${Date.now()}`,
          originalUuid: uuid ?? '',
          block: { type: 'text', text: content } as ContentBlock,
          blockIndex: 0,
          role: 'user' as const,
          original: msg,
          isOptimistic,
        }]
      }

      if (!Array.isArray(content) || content.length === 0) {
        return [{
          _kind: 'normalized' as const,
          type: 'user',
          uuid: uuid ?? `msg-${Date.now()}`,
          originalUuid: uuid ?? '',
          block: null,
          blockIndex: 0,
          role: 'user' as const,
          original: msg,
          isOptimistic,
        }]
      }

      return content.map((block: ContentBlock, index: number): NormalizedMessage => ({
        _kind: 'normalized',
        type: 'user',
        uuid: deriveUUID(uuid, index),
        originalUuid: uuid ?? '',
        block,
        blockIndex: index,
        role: 'user',
        original: msg,
        isOptimistic,
      }))
    }

    // All other types (system, result, tool_progress, tool_use_summary, rate_limit_event):
    // Pass through unchanged, no block splitting.
    return [{
      _kind: 'passthrough' as const,
      type: msg.type,
      uuid: uuid ?? `msg-${Date.now()}-pt`,
      originalUuid: uuid ?? '',
      block: null,
      blockIndex: 0,
      role: null,
      original: msg,
      isOptimistic,
    }]
  })
}
