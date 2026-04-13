/**
 * AgentToolBlock — Renders Agent tool calls matching CLI's rendering.
 *
 * States:
 * - Running: header + inline progress (last 3 tool actions)
 * - Completed (collapsed): header + "Done (N tool uses · tokens · time)"
 * - Completed (expanded): header + full transcript from getSubagentMessages
 *
 * Mirrors: claude-code/src/tools/AgentTool/UI.tsx
 */
import { useState, memo } from 'react'
import { useChatSession } from '../../../providers/ChatSessionContext'
import { MarkdownRenderer } from '../MarkdownRenderer'
import type { MessageLookups, AgentToolStats, AgentProgressEntry } from '../../../utils/messageLookups'

interface Props {
  block: { id?: string; name?: string; input?: any; [key: string]: unknown }
  lookups: MessageLookups
}

const MAX_PROGRESS_TO_SHOW = 3

/** Format number with K/M suffix */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** Format duration ms → "Xs" or "Xm Ys" */
function formatDuration(ms: number): string {
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rs = Math.round(s % 60)
  return `${m}m ${rs}s`
}

export const AgentToolBlock = memo(function AgentToolBlock({ block, lookups }: Props) {
  const { id: toolUseId, input } = block
  const isResolved = toolUseId ? lookups.resolvedToolUseIds.has(toolUseId) : false
  const isErrored = toolUseId ? lookups.erroredToolUseIds.has(toolUseId) : false
  const stats = toolUseId ? lookups.agentStatsByToolUseId.get(toolUseId) : undefined
  const progressEntries = toolUseId ? lookups.agentProgressByToolUseId.get(toolUseId) : undefined

  const [expanded, setExpanded] = useState(false)

  const description = input?.description as string | undefined
  const subagentType = input?.subagent_type as string | undefined
  const agentName = input?.name as string | undefined
  const displayType = agentName ? `@${agentName}` : subagentType && subagentType !== 'general-purpose' ? subagentType : 'Agent'

  // Build completion summary line (like CLI: "Done (N tool uses · X tokens · Ys)")
  const completionParts: string[] = []
  if (stats?.totalToolUseCount != null) {
    completionParts.push(`${stats.totalToolUseCount} tool ${stats.totalToolUseCount === 1 ? 'use' : 'uses'}`)
  }
  if (stats?.totalTokens != null) {
    completionParts.push(`${formatTokens(stats.totalTokens)} tokens`)
  }
  if (stats?.totalDurationMs != null) {
    completionParts.push(formatDuration(stats.totalDurationMs))
  }
  const completionSummary = completionParts.length > 0 ? `Done (${completionParts.join(' · ')})` : 'Done'

  // Last N progress entries for inline display
  const recentProgress = progressEntries?.filter((e: AgentProgressEntry) => e.lastToolName || e.description).slice(-MAX_PROGRESS_TO_SHOW) ?? []
  const hiddenCount = (progressEntries?.filter((e: AgentProgressEntry) => e.lastToolName || e.description).length ?? 0) - recentProgress.length

  return (
    <div className="border border-[var(--border)] rounded-md overflow-hidden">
      {/* Header */}
      <div
        className={`flex items-center gap-2 px-3 py-2 bg-[var(--bg-secondary)] ${isResolved ? 'cursor-pointer hover:bg-[var(--bg-hover)]' : ''}`}
        onClick={() => isResolved && setExpanded(!expanded)}
      >
        <div className="w-0.5 h-4 rounded-full shrink-0 bg-[var(--purple)]" />
        {/* Status indicator */}
        {!isResolved && !isErrored && (
          <span className="inline-block w-1.5 h-1.5 bg-[var(--purple)] rounded-full animate-pulse shrink-0" />
        )}
        {isResolved && !isErrored && (
          <span className="text-[var(--text-dim)] shrink-0 text-xs">■</span>
        )}
        {isErrored && (
          <span className="text-[var(--error)] shrink-0 text-xs">✗</span>
        )}
        {/* Agent type */}
        <span className="text-xs font-mono font-semibold text-[var(--purple)] shrink-0">{displayType}</span>
        {/* Description */}
        {description && (
          <span className="text-xs font-mono text-[var(--text-muted)] truncate flex-1">{description}</span>
        )}
        {/* Completion stats (when resolved) */}
        {isResolved && !isErrored && (
          <span className="text-[10px] text-[var(--text-dim)] shrink-0">{completionSummary}</span>
        )}
        {isErrored && (
          <span className="text-[10px] text-[var(--error)] font-mono shrink-0">Error</span>
        )}
        {/* Expand chevron (only when resolved) */}
        {isResolved && (
          <svg className={`w-3 h-3 text-[var(--text-muted)] transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>

      {/* Inline progress (running state) */}
      {!isResolved && recentProgress.length > 0 && (
        <div className="border-t border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-1.5">
          {recentProgress.map((entry, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--text-muted)] py-0.5">
              <span className="text-[var(--text-dim)]">⎿</span>
              {entry.lastToolName && (
                <span className="font-semibold text-[var(--text-secondary)]">{entry.lastToolName}</span>
              )}
              <span className="truncate">{entry.description ?? ''}</span>
            </div>
          ))}
          {hiddenCount > 0 && (
            <div className="text-[10px] text-[var(--text-dim)] py-0.5">
              +{hiddenCount} more tool {hiddenCount === 1 ? 'use' : 'uses'}
            </div>
          )}
        </div>
      )}

      {/* Expanded transcript */}
      {expanded && isResolved && (
        <AgentTranscript
          stats={stats}
        />
      )}
    </div>
  )
})

// ─── AgentTranscript (expanded view) ─────────────────────

function AgentTranscript({ stats }: { stats?: AgentToolStats }) {
  const { getSubagentMessages, subagentMessages, sessionId } = useChatSession()
  const agentId = stats?.agentId

  // Fetch messages on first render
  const [fetched, setFetched] = useState(false)
  if (!fetched && agentId && sessionId && sessionId !== '__new__') {
    setFetched(true)
    getSubagentMessages(agentId)
  }

  // Current type is { agentId: string; messages: any[] } | null
  // Will become Map<string, any[]> in Task 7. Handle both shapes.
  const messages: any[] | null = (() => {
    if (!subagentMessages || !agentId) return null
    // Future Map shape
    if (subagentMessages instanceof Map) {
      return (subagentMessages as Map<string, any[]>).get(agentId) ?? null
    }
    // Current object shape: { agentId: string; messages: any[] }
    const obj = subagentMessages as { agentId: string; messages: any[] }
    return obj.agentId === agentId ? obj.messages : null
  })()

  return (
    <div className="border-t border-[var(--border)] bg-[var(--bg-tertiary)] max-h-[400px] overflow-y-auto">
      {/* Prompt */}
      {stats?.prompt && (
        <div className="px-3 py-2 border-b border-[var(--border)]">
          <div className="text-[10px] font-semibold text-[var(--success)] mb-1">Prompt:</div>
          <div className="text-xs text-[var(--text-secondary)] pl-2">
            <MarkdownRenderer content={stats.prompt} />
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="px-3 py-2">
        {messages === null ? (
          <div className="text-[10px] text-[var(--text-muted)]">
            {agentId ? 'Loading transcript...' : 'Transcript unavailable'}
          </div>
        ) : messages.length === 0 ? (
          <div className="text-[10px] text-[var(--text-muted)]">No messages</div>
        ) : (
          <div className="space-y-1">
            {messages.map((m: any, i: number) => {
              const role = m.type ?? m.message?.role ?? 'system'
              const content = m.message?.content
              let text = ''
              if (typeof content === 'string') text = content
              else if (Array.isArray(content)) {
                text = content
                  .filter((b: any) => b.type === 'text')
                  .map((b: any) => b.text ?? '')
                  .join('\n')
              }

              // Show tool_use blocks as compact tool headers
              if (Array.isArray(content)) {
                const toolUses = content.filter((b: any) => b.type === 'tool_use')
                if (toolUses.length > 0 && !text.trim()) {
                  return toolUses.map((tu: any, j: number) => (
                    <div key={`${i}-tu-${j}`} className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--text-muted)] py-0.5">
                      <span className="text-[var(--text-dim)]">⎿</span>
                      <span className="font-semibold text-[var(--text-secondary)]">{tu.name}</span>
                      <span className="truncate text-[var(--text-dim)]">
                        {tu.input?.file_path ?? tu.input?.pattern ?? tu.input?.command?.slice(0, 80) ?? tu.input?.description ?? ''}
                      </span>
                    </div>
                  ))
                }
              }

              if (!text.trim()) return null

              const roleColor = role === 'assistant'
                ? 'text-[var(--accent)]'
                : role === 'user'
                  ? 'text-[var(--info)]'
                  : 'text-[var(--text-muted)]'

              return (
                <div key={i} className="text-xs leading-relaxed">
                  {role === 'assistant' && (
                    <div className={roleColor}>
                      <MarkdownRenderer content={text} />
                    </div>
                  )}
                  {role !== 'assistant' && (
                    <div className="text-[var(--text-muted)] text-[10px]">{text.slice(0, 200)}</div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Response */}
      {stats?.responseText && (
        <div className="px-3 py-2 border-t border-[var(--border)]">
          <div className="text-[10px] font-semibold text-[var(--success)] mb-1">Response:</div>
          <div className="text-xs text-[var(--text-secondary)] pl-2">
            <MarkdownRenderer content={stats.responseText} />
          </div>
        </div>
      )}
    </div>
  )
}
