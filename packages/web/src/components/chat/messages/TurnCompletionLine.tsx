/**
 * TurnCompletionLine — Renders turn summary after assistant turn completes.
 *
 * Mirrors Claude Code CLI's TurnCompletionMessage (SystemTextMessage.tsx) +
 * SpinnerAnimationRow's completed-state stats display.
 *
 * Format: ✻ {verb} for {duration} · ↓ {tokens} tokens · thought for {N}s
 */

import type { TurnSummary } from '../../../stores/sessionContainerStore'

// ─── Duration formatting (matches CLI's formatDuration) ───

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min < 60) return sec > 0 ? `${min}m ${sec}s` : `${min}m`
  const hr = Math.floor(min / 60)
  const remainMin = min % 60
  return remainMin > 0 ? `${hr}h ${remainMin}m` : `${hr}h`
}

// ─── Number formatting (matches CLI's formatNumber) ───

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

// ─── Component ───

interface Props {
  summary: TurnSummary
}

export function TurnCompletionLine({ summary }: Props) {
  const { durationMs, inputTokens, outputTokens, thinkingDurationMs, verb } = summary
  const totalTokens = inputTokens + outputTokens

  const parts: string[] = []
  parts.push(`${verb} for ${formatDuration(durationMs)}`)
  if (totalTokens > 0) {
    parts.push(`↓ ${formatNumber(totalTokens)} tokens`)
  }
  if (thinkingDurationMs !== null && thinkingDurationMs >= 1000) {
    parts.push(`thought for ${Math.max(1, Math.round(thinkingDurationMs / 1000))}s`)
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
      <span className="text-[var(--text-dim)]">✻</span>
      <span>{parts.join(' · ')}</span>
    </div>
  )
}
