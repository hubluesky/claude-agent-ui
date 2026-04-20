/**
 * Passthrough message blocks — render non-splittable message types.
 * Covers: result, tool_progress, tool_use_summary, rate_limit_event.
 * Extracted from MessageComponent.tsx.
 */
import { memo } from 'react'
import type { AgentMessage } from '@claude-cockpit/shared'
import { getToolCategory, TOOL_COLORS } from '@claude-cockpit/shared'
import { ToolIcon, formatToolSummary } from '../tool-display'

interface Props {
  message: AgentMessage
}

// ─── Result ──────────────────────────────────────────────

export const ResultBlock = memo(function ResultBlock({ message }: Props) {
  const subtype = (message as any).subtype ?? ''
  if (!subtype.startsWith('error')) return null

  return (
    <div className="flex items-start gap-2.5 bg-[var(--error-subtle-bg)] border border-[var(--error-subtle-border)] rounded-md px-4 py-3">
      <div className="w-5 h-5 rounded-full bg-[var(--error)] flex items-center justify-center shrink-0">
        <span className="text-[11px] font-bold text-[var(--bg-primary)]">!</span>
      </div>
      <div>
        <p className="text-xs font-medium text-[var(--error)]">
          {subtype === 'error_max_turns' ? 'Max turns reached'
            : subtype === 'error_max_budget_usd' ? 'Budget limit reached'
            : 'Execution error'}
        </p>
        <p className="text-sm text-[#f8717199] mt-1">{((message as any).errors ?? []).join('\n')}</p>
      </div>
    </div>
  )
})

// ─── Tool Use Summary ────────────────────────────────────

export const ToolUseSummaryBlock = memo(function ToolUseSummaryBlock({ message }: Props) {
  const toolName = (message as any).tool_name ?? (message as any).name ?? 'tool'
  const summary = (message as any).summary ?? (message as any).result_summary ?? ''
  const category = getToolCategory(toolName)
  const color = TOOL_COLORS[category]

  return (
    <div className="border border-[var(--border)] rounded-md overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-secondary)]">
        <div className="w-0.5 h-4 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <ToolIcon category={category} />
        <span className="text-xs font-mono font-semibold shrink-0" style={{ color }}>{toolName}</span>
        {summary && <span className="text-xs font-mono text-[var(--text-muted)] truncate flex-1">{typeof summary === 'string' ? summary.slice(0, 200) : JSON.stringify(summary).slice(0, 200)}</span>}
      </div>
    </div>
  )
})

// ─── Tool Progress ───────────────────────────────────────

export const ToolProgressBlock = memo(function ToolProgressBlock({ message }: Props) {
  const content = (message as any).content ?? ''
  if (!content) return null
  const rawElapsed = (message as any).elapsed_time_seconds
  const elapsed = typeof rawElapsed === 'number' ? rawElapsed : undefined
  const elapsedStr = elapsed != null ? `${elapsed.toFixed(1)}s` : null

  return (
    <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
      <svg className="w-3 h-3 text-[var(--success)] animate-spin shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
      </svg>
      {elapsedStr && <span className="text-[10px] text-[var(--text-dim)] tabular-nums shrink-0">{elapsedStr}</span>}
      <span className="font-mono truncate flex-1">{typeof content === 'string' ? content : JSON.stringify(content).slice(0, 150)}</span>
    </div>
  )
})

// ─── Rate Limit Event ────────────────────────────────────

export const RateLimitBlock = memo(function RateLimitBlock({ message }: Props) {
  const rlType = (message as any).rate_limit_type ?? (message as any).subtype
  const isWarning = rlType === 'allowed_warning'
  const retryAfter = (message as any).retry_after ?? 30

  return (
    <div className={`flex items-center gap-2 rounded-md px-4 py-3 ${isWarning ? 'bg-[#f59e0b0a] border border-[#f59e0b26]' : 'bg-[var(--error-subtle-bg)] border border-[var(--error-subtle-border)]'}`}>
      <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${isWarning ? 'bg-[var(--warning)]' : 'bg-[var(--error)]'}`}>
        <span className="text-[11px] font-bold text-[var(--bg-primary)]">{isWarning ? '\u26A0' : '!'}</span>
      </div>
      <p className={`text-xs ${isWarning ? 'text-[var(--warning)]' : 'text-[var(--error)]'}`}>
        {isWarning
          ? 'Approaching rate limit. Requests may slow down.'
          : `Rate limit exceeded. Retrying in ${retryAfter}s...`}
      </p>
    </div>
  )
})
