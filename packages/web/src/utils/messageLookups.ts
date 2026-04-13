/**
 * buildMessageLookups — Builds tool_use ↔ tool_result mapping for O(1) access.
 *
 * Mirrors Claude Code's buildMessageLookups (messages.ts:1178-1356).
 * Used by:
 * - AssistantToolUseBlock: to inline-display tool results (instead of separate blocks)
 * - collapseReadSearch: to absorb tool_results into collapsed groups
 * - isBlockVisible: to hide tool_results that are already displayed by their tool_use
 */

import type { NormalizedMessage } from './normalizeMessages'

// ─── Types ───────────────────────────────────────────────

export interface MessageLookups {
  /** tool_use block.id → the NormalizedMessage containing that tool_use */
  toolUseById: Map<string, NormalizedMessage>
  /** tool_use_id → the NormalizedMessage containing the corresponding tool_result */
  toolResultByToolUseId: Map<string, NormalizedMessage>
  /** Set of tool_use IDs that have received a tool_result */
  resolvedToolUseIds: Set<string>
  /** Set of tool_use IDs whose tool_result has is_error=true */
  erroredToolUseIds: Set<string>
}

// ─── Core function ───────────────────────────────────────

export function buildMessageLookups(messages: NormalizedMessage[]): MessageLookups {
  const toolUseById = new Map<string, NormalizedMessage>()
  const toolResultByToolUseId = new Map<string, NormalizedMessage>()
  const resolvedToolUseIds = new Set<string>()
  const erroredToolUseIds = new Set<string>()

  for (const msg of messages) {
    if (!msg.block) continue

    // Collect tool_use blocks
    if (msg.role === 'assistant' && (msg.block.type === 'tool_use' || msg.block.type === 'server_tool_use')) {
      const toolId = msg.block.id as string
      if (toolId) {
        toolUseById.set(toolId, msg)
      }
    }

    // Collect tool_result blocks
    if (msg.role === 'user' && msg.block.type === 'tool_result') {
      const toolUseId = msg.block.tool_use_id as string
      if (toolUseId) {
        toolResultByToolUseId.set(toolUseId, msg)
        resolvedToolUseIds.add(toolUseId)
        if (msg.block.is_error) {
          erroredToolUseIds.add(toolUseId)
        }
      }
    }
  }

  return { toolUseById, toolResultByToolUseId, resolvedToolUseIds, erroredToolUseIds }
}

/** Check if a tool_result message has been absorbed by its tool_use (should be hidden) */
export function isToolResultAbsorbed(msg: NormalizedMessage, lookups: MessageLookups): boolean {
  if (!msg.block || msg.block.type !== 'tool_result') return false
  const toolUseId = msg.block.tool_use_id as string
  // If the tool_use exists in lookups, the result is absorbed into tool_use display
  return toolUseId ? lookups.toolUseById.has(toolUseId) : false
}
