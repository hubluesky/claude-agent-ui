/**
 * buildMessageLookups — Builds tool_use ↔ tool_result mapping for O(1) access.
 *
 * Mirrors Claude Code's buildMessageLookups (messages.ts:1178-1356).
 * Used by:
 * - AssistantToolUseBlock: to inline-display tool results (instead of separate blocks)
 * - collapseReadSearch: to absorb tool_results into collapsed groups
 * - isBlockVisible: to hide tool_results that are already displayed by their tool_use
 */

import type { AgentMessage } from '@claude-cockpit/shared'
import type { NormalizedMessage } from './normalizeMessages'

// ─── Types ───────────────────────────────────────────────

/** Extracted Agent tool completion stats from tool_result */
export interface AgentToolStats {
  agentId?: string
  agentType?: string
  totalToolUseCount?: number
  totalDurationMs?: number
  totalTokens?: number
  prompt?: string
  status?: string
  /** Text content from agent response */
  responseText?: string
}

/** Progress info for a running Agent (extracted from task_* messages) */
export interface AgentProgressEntry {
  lastToolName?: string
  description?: string
  toolUseCount?: number
  durationMs?: number
  tokens?: number
  status?: string
  agentName?: string
  taskId?: string
}

export interface MessageLookups {
  /** tool_use block.id → the NormalizedMessage containing that tool_use */
  toolUseById: Map<string, NormalizedMessage>
  /** tool_use_id → the NormalizedMessage containing the corresponding tool_result */
  toolResultByToolUseId: Map<string, NormalizedMessage>
  /** Set of tool_use IDs that have received a tool_result */
  resolvedToolUseIds: Set<string>
  /** Set of tool_use IDs whose tool_result has is_error=true */
  erroredToolUseIds: Set<string>
  /** Agent tool_use ID → completion stats (extracted from tool_result content) */
  agentStatsByToolUseId: Map<string, AgentToolStats>
  /** Agent tool_use ID → latest progress entries (from task_* messages in raw stream) */
  agentProgressByToolUseId: Map<string, AgentProgressEntry[]>
}

// ─── Core function ───────────────────────────────────────

export function buildMessageLookups(messages: NormalizedMessage[]): MessageLookups {
  const toolUseById = new Map<string, NormalizedMessage>()
  const toolResultByToolUseId = new Map<string, NormalizedMessage>()
  const resolvedToolUseIds = new Set<string>()
  const erroredToolUseIds = new Set<string>()
  const agentStatsByToolUseId = new Map<string, AgentToolStats>()
  const agentProgressByToolUseId = new Map<string, AgentProgressEntry[]>()

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

        // Extract Agent tool stats from tool_result
        const toolUseMsg = toolUseById.get(toolUseId)
        if (toolUseMsg?.block?.name === 'Agent') {
          const stats = extractAgentStats(msg)
          if (stats) {
            agentStatsByToolUseId.set(toolUseId, stats)
          }
        }
      }
    }
  }

  return { toolUseById, toolResultByToolUseId, resolvedToolUseIds, erroredToolUseIds, agentStatsByToolUseId, agentProgressByToolUseId }
}

/** Check if a tool_result message has been absorbed by its tool_use (should be hidden) */
export function isToolResultAbsorbed(msg: NormalizedMessage, lookups: MessageLookups): boolean {
  if (!msg.block || msg.block.type !== 'tool_result') return false
  const toolUseId = msg.block.tool_use_id as string
  // If the tool_use exists in lookups, the result is absorbed into tool_use display
  return toolUseId ? lookups.toolUseById.has(toolUseId) : false
}

// ─── Agent stats helpers ────────────────────────────────

/**
 * Extract Agent tool completion stats from a tool_result message.
 * Tries toolUseResult first (CLI structured data), falls back to text content.
 */
function extractAgentStats(resultMsg: NormalizedMessage): AgentToolStats | null {
  const original = resultMsg.original as any
  const block = resultMsg.block as any

  // Try toolUseResult first (CLI internal structured data)
  const tur = original?.toolUseResult ?? original?.message?.toolUseResult
  if (tur && typeof tur === 'object') {
    return {
      agentId: tur.agentId,
      agentType: tur.agentType,
      totalToolUseCount: tur.totalToolUseCount,
      totalDurationMs: tur.totalDurationMs,
      totalTokens: tur.totalTokens,
      prompt: tur.prompt,
      status: tur.status ?? 'completed',
      responseText: extractTextContent(tur.content),
    }
  }

  // Fallback: try to extract from tool_result content text
  const content = block?.content
  let text = ''
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    text = content.filter((b: any) => b.type === 'text').map((b: any) => b.text ?? '').join('')
  }

  if (text) {
    return { status: 'completed', responseText: text }
  }

  return null
}

function extractTextContent(content: any): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.filter((b: any) => b.type === 'text').map((b: any) => b.text ?? '').join('\n')
  }
  return ''
}

/**
 * Build Agent progress mapping from raw (unfiltered) messages.
 * Associates task_started/task_progress/task_notification with Agent tool_use blocks
 * using positional matching: task_* messages between an Agent tool_use and its
 * tool_result belong to that Agent.
 */
export function buildAgentProgress(
  rawMessages: AgentMessage[],
  lookups: MessageLookups,
): Map<string, AgentProgressEntry[]> {
  const progressMap = new Map<string, AgentProgressEntry[]>()

  // Find all Agent tool_use IDs
  const agentToolUseIds: string[] = []
  for (const [id, msg] of lookups.toolUseById) {
    if (msg.block?.name === 'Agent') {
      agentToolUseIds.push(id)
    }
  }
  if (agentToolUseIds.length === 0) return progressMap

  // Walk through raw messages and assign task_* messages to their Agent
  let currentAgentToolUseId: string | null = null

  for (const msg of rawMessages) {
    // Detect Agent tool_use start
    if (msg.type === 'assistant') {
      const content = (msg as any).message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if ((block.type === 'tool_use' || block.type === 'server_tool_use') && block.name === 'Agent' && block.id) {
            currentAgentToolUseId = block.id
            if (!progressMap.has(block.id)) {
              progressMap.set(block.id, [])
            }
          }
        }
      }
    }

    // Detect tool_result → resolve current Agent
    if (msg.type === 'user') {
      const content = (msg as any).message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result' && block.tool_use_id === currentAgentToolUseId) {
            currentAgentToolUseId = null
          }
        }
      }
    }

    // Collect task_* system messages for current Agent
    if (currentAgentToolUseId && msg.type === 'system') {
      const sub = (msg as any).subtype as string | undefined
      const entries = progressMap.get(currentAgentToolUseId)
      if (!entries) continue

      if (sub === 'task_started') {
        entries.push({
          agentName: (msg as any).agent_name,
          taskId: (msg as any).task_id,
          status: 'running',
        })
      } else if (sub === 'task_progress') {
        entries.push({
          lastToolName: (msg as any).last_tool_name,
          description: (msg as any).description ?? (msg as any).summary ?? (msg as any).content,
          status: 'running',
        })
      } else if (sub === 'task_notification') {
        const usage = (msg as any).usage
        entries.push({
          agentName: (msg as any).agent_name ?? (msg as any).task_id,
          status: (msg as any).status ?? 'completed',
          toolUseCount: usage?.tool_uses ?? (msg as any).tool_count,
          durationMs: usage?.duration_ms ?? (msg as any).duration_ms,
          tokens: usage?.total_tokens,
          description: (msg as any).summary,
        })
      }
    }
  }

  return progressMap
}
