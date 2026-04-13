/**
 * isBlockVisible — Per-block visibility filter for normalized messages.
 *
 * Replaces the old isMessageVisible (whole-message level) with per-block
 * precision. After normalizeMessages splits blocks, we filter at block
 * granularity: [empty_text, tool_use] → tool_use survives, empty_text removed.
 */

import type { NormalizedMessage } from './normalizeMessages'
import type { MessageLookups } from './messageLookups'

/** Known SDK internal messages that should not be displayed */
const SDK_INTERNAL_PATTERNS = [
  /^Continue from where you left off\.?$/,
  /^No response requested\.?$/,
]

function isSDKInternalText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return SDK_INTERNAL_PATTERNS.some(p => p.test(trimmed))
}

/**
 * Determine if a normalized message (single block) should be visible.
 * This runs BEFORE collapseReadSearch and lookups, so it cannot check
 * if a tool_result is "absorbed". That filtering happens in the pipeline
 * after lookups are built.
 */
export function isBlockVisible(msg: NormalizedMessage): boolean {
  // Passthrough types: delegate to type-specific logic
  if (msg._kind === 'passthrough') {
    return isPassthroughVisible(msg)
  }

  // Normalized messages with no block: not visible
  if (!msg.block) return false

  if (msg.role === 'assistant') {
    return isAssistantBlockVisible(msg)
  }

  if (msg.role === 'user') {
    return isUserBlockVisible(msg)
  }

  return false
}

function isAssistantBlockVisible(msg: NormalizedMessage): boolean {
  const block = msg.block!
  switch (block.type) {
    case 'text':
      if (!block.text) return false
      if (isSDKInternalText(block.text as string)) return false
      return true
    case 'thinking':
      // Thinking blocks are hidden by default (matching Claude Code behavior).
      // They become visible only in verbose/transcript mode, which is handled
      // at the component level, not the visibility filter.
      return false
    case 'redacted_thinking':
      return false // Same as thinking — hidden by default
    case 'tool_use':
    case 'server_tool_use':
      return true
    case 'tool_result':
    case 'web_search_tool_result':
    case 'code_execution_tool_result':
      return true
    default:
      return false
  }
}

function isUserBlockVisible(msg: NormalizedMessage): boolean {
  const block = msg.block!
  switch (block.type) {
    case 'text': {
      const text = (block.text as string) ?? ''
      if (!text.trim()) return false
      if (isSDKInternalText(text)) return false
      // Internal output (hook stdout etc.)
      if (/^<local-command-stdout>/i.test(text.trim())) return false
      return true
    }
    case 'tool_result':
      return true // Will be filtered later if absorbed by tool_use
    case 'image':
      return true
    default:
      return false
  }
}

function isPassthroughVisible(msg: NormalizedMessage): boolean {
  const original = msg.original
  const type = original.type
  const sub = (original as any).subtype as string | undefined

  switch (type) {
    case 'result': {
      const subtype = (original as any).subtype ?? ''
      return typeof subtype === 'string' && subtype.startsWith('error')
    }
    case 'system': {
      if (sub === 'api_retry') return true
      if (sub === 'status' && (original as any).status === 'compacting') return true
      // task_* subtypes are now rendered INSIDE the Agent tool_use block,
      // not as standalone messages. Filter them from the main stream.
      if (sub === 'task_started') return false
      if (sub === 'task_progress') return false
      if (sub === 'task_notification') return false
      if (sub === 'local_command_output') return !!((original as any).output ?? (original as any).content)
      return false
    }
    case 'tool_use_summary':
      return true
    case 'tool_progress':
      return !!(original as any).content
    case 'rate_limit_event':
      return true
    default:
      return false
  }
}

/**
 * Filter tool_results that are absorbed by their corresponding tool_use.
 * Runs AFTER lookups are built, AFTER collapseReadSearch.
 * tool_results inside collapsed groups are already hidden.
 * This handles tool_results that are NOT in collapsed groups.
 */
export function filterAbsorbedToolResults(
  items: NormalizedMessage[],
  lookups: MessageLookups,
): NormalizedMessage[] {
  return items.filter(msg => {
    if (!msg.block || msg.block.type !== 'tool_result') return true
    const toolUseId = msg.block.tool_use_id as string
    if (!toolUseId) return true
    // If the corresponding tool_use exists, the result will be inlined
    // into the tool_use display — don't show it as a separate block.
    return !lookups.toolUseById.has(toolUseId)
  })
}
