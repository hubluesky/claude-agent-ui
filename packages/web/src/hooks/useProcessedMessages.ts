/**
 * useProcessedMessages — The message processing pipeline hook.
 *
 * Pipeline stages:
 *   rawMessages
 *     → normalizeMessages (split multi-block → single-block)
 *     → isBlockVisible (per-block visibility filter)
 *     → collapseReadSearch (fold consecutive Read/Grep/Glob → summary)
 *     → buildMessageLookups (tool_use ↔ tool_result mapping)
 *
 * Returns the processed items and lookups for rendering.
 */

import { useMemo } from 'react'
import type { AgentMessage } from '@claude-agent-ui/shared'
import { normalizeMessages, type NormalizedMessage } from '../utils/normalizeMessages'
import { buildMessageLookups, buildAgentProgress, type MessageLookups } from '../utils/messageLookups'
import { collapseReadSearch, type RenderableItem } from '../utils/collapseReadSearch'
import { isBlockVisible, filterAbsorbedToolResults } from '../utils/messageVisibility'

export interface ProcessedMessages {
  /** The final list of renderable items (NormalizedMessage or CollapsedGroup) */
  items: RenderableItem[]
  /** Tool use/result lookup table */
  lookups: MessageLookups
}

export function useProcessedMessages(rawMessages: AgentMessage[]): ProcessedMessages {
  return useMemo(() => {
    // Stage 1: Normalize — split multi-block messages into single-block
    const normalized = normalizeMessages(rawMessages)

    // Stage 2: Visibility filter — remove empty/internal blocks
    const visible = normalized.filter(isBlockVisible)

    // Stage 3: Build lookups (needed for tool_result absorption)
    const lookups = buildMessageLookups(visible)

    // Build Agent progress from RAW messages (before filtering)
    // task_* messages are filtered out in visibility but we need them for Agent progress
    const agentProgress = buildAgentProgress(rawMessages, lookups)
    lookups.agentProgressByToolUseId = agentProgress

    // Stage 4: Filter absorbed tool_results (they'll be shown inline by tool_use)
    const withoutAbsorbed = filterAbsorbedToolResults(visible, lookups)

    // Stage 5: Collapse consecutive Read/Grep/Glob into summaries
    const collapsed = collapseReadSearch(withoutAbsorbed)

    return { items: collapsed, lookups }
  }, [rawMessages])
}
