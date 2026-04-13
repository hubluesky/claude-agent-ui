import { useEffect, useRef, useState } from 'react'
import { useChatSession } from '../../providers/ChatSessionContext'

const CATEGORY_COLORS = [
  '#60a5fa', // blue — System prompt
  '#f59e0b', // amber — System tools
  '#3fb950', // green — MCP tools
  '#a78bfa', // purple — Memory files
  '#0ea5e9', // cyan — Skills
  '#f87171', // red — Autocompact buffer
  '#5c5952', // dim gray — Free space
  '#7c7872', // gray
]

export function ContextPanel({ onClose }: { onClose: () => void }) {
  const { contextUsage } = useChatSession()

  if (!contextUsage) {
    return (
      <>
        <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="w-[28rem] max-w-[calc(100vw-2rem)] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-2xl pointer-events-auto p-5">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold text-[var(--info)]">Context Usage</span>
              <button onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text-secondary)] cursor-pointer">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <p className="text-xs text-[var(--text-dim)]">No active session</p>
          </div>
        </div>
      </>
    )
  }

  const { categories, totalTokens, maxTokens, percentage } = contextUsage

  // Assign colors to categories
  const usedCategories = categories.filter((c) => c.tokens > 0)
  const compactThreshold = Math.round(maxTokens * 0.9)
  function colorFor(index: number): string {
    return CATEGORY_COLORS[index % CATEGORY_COLORS.length]
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div className="w-[28rem] max-w-[calc(100vw-2rem)] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-2xl pointer-events-auto overflow-hidden">
          {/* Header */}
          <div className="px-5 pt-4 pb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--info)]">Context Usage</span>
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-[var(--text-muted)] tabular-nums">
                {formatTokens(totalTokens)} / {formatTokens(maxTokens)} tokens ({percentage.toFixed(0)}%)
              </span>
              <button onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text-secondary)] cursor-pointer">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="px-5 pb-4">
            <div style={{ height: 12, borderRadius: 6, background: 'var(--bg-input)', overflow: 'hidden', display: 'flex' }}>
              {usedCategories.map((cat, i) => {
                const w = (cat.tokens / maxTokens) * 100
                return (
                  <div
                    key={i}
                    style={{ width: `${Math.max(w, 0.5)}%`, height: '100%', background: colorFor(i) }}
                    title={`${cat.name}: ${formatTokens(cat.tokens)}`}
                  />
                )
              })}
            </div>
          </div>

          {/* Category list */}
          <div className="px-5 pb-4 space-y-2.5">
            {usedCategories.map((cat, i) => (
              <div key={i} className="flex items-center gap-3 text-[13px]">
                <div className="rounded-sm shrink-0" style={{ width: 10, height: 10, background: colorFor(i) }} />
                <span className="flex-1 text-[var(--text-primary)]">{cat.name}</span>
                <span className="text-[var(--text-muted)] tabular-nums">{formatTokens(cat.tokens)}</span>
                <span className="text-[var(--text-dim)] tabular-nums w-10 text-right">{((cat.tokens / maxTokens) * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-[var(--border)] text-[11px] text-[var(--text-dim)]">
            Auto-compact at {formatTokens(compactThreshold)} tokens
          </div>
        </div>
      </div>
    </>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/** Compact token bar for StatusBar */
export function ContextUsageIndicator() {
  const [open, setOpen] = useState(false)
  const { contextUsage, sessionStatus, sessionId, getContextUsage } = useChatSession()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!sessionId || sessionId === '__new__') return
    getContextUsage()
    intervalRef.current = setInterval(() => {
      if (sessionStatus === 'running') {
        getContextUsage()
      }
    }, 10000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [sessionId])

  // Fetch context usage on every session status change (running→idle, idle→running, etc.)
  useEffect(() => {
    if (sessionId && sessionId !== '__new__') {
      getContextUsage()
    }
  }, [sessionStatus])

  const hasData = !!contextUsage
  const percentage = contextUsage?.percentage ?? 0
  const color = percentage > 80 ? 'var(--error)' : percentage > 60 ? 'var(--warning)' : 'var(--success)'

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-[var(--bg-secondary)] transition-colors cursor-pointer"
        title="Context usage"
      >
        <div className="w-12 h-1.5 rounded-full bg-[var(--bg-input)] overflow-hidden">
          <div className="h-full rounded-full transition-all duration-300" style={{ width: `${percentage}%`, background: hasData ? color : 'var(--text-dim)' }} />
        </div>
        <span className="text-[10px] tabular-nums" style={{ color: hasData ? color : 'var(--text-dim)' }}>{hasData ? `${percentage.toFixed(0)}%` : '—'}</span>
      </button>
      {open && <ContextPanel onClose={() => setOpen(false)} />}
    </div>
  )
}
