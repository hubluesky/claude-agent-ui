import { useEffect, useRef, useState } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useWebSocket } from '../../hooks/useWebSocket'

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
  const contextUsage = useConnectionStore((s) => s.contextUsage)

  if (!contextUsage) {
    return (
      <>
        <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="w-[28rem] max-w-[calc(100vw-2rem)] bg-[#242320] border border-[#3d3b37] rounded-lg shadow-2xl pointer-events-auto p-5">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold text-[#60a5fa]">Context Usage</span>
              <button onClick={onClose} className="text-[#5c5952] hover:text-[#a8a29e] cursor-pointer">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <p className="text-xs text-[#5c5952]">No active session</p>
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
        <div className="w-[28rem] max-w-[calc(100vw-2rem)] bg-[#242320] border border-[#3d3b37] rounded-lg shadow-2xl pointer-events-auto overflow-hidden">
          {/* Header */}
          <div className="px-5 pt-4 pb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-[#60a5fa]">Context Usage</span>
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-[#7c7872] tabular-nums">
                {formatTokens(totalTokens)} / {formatTokens(maxTokens)} tokens ({percentage.toFixed(0)}%)
              </span>
              <button onClick={onClose} className="text-[#5c5952] hover:text-[#a8a29e] cursor-pointer">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="px-5 pb-4">
            <div style={{ height: 12, borderRadius: 6, background: '#1a1918', overflow: 'hidden', display: 'flex' }}>
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
                <span className="flex-1 text-[#e5e2db]">{cat.name}</span>
                <span className="text-[#7c7872] tabular-nums">{formatTokens(cat.tokens)}</span>
                <span className="text-[#5c5952] tabular-nums w-10 text-right">{((cat.tokens / maxTokens) * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-[#3d3b37] text-[11px] text-[#5c5952]">
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
  const contextUsage = useConnectionStore((s) => s.contextUsage)
  const sessionStatus = useConnectionStore((s) => s.sessionStatus)
  const sessionId = useSessionStore((s) => s.currentSessionId)
  const { getContextUsage } = useWebSocket()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!sessionId || sessionId === '__new__') return
    getContextUsage(sessionId)
    intervalRef.current = setInterval(() => {
      if (useConnectionStore.getState().sessionStatus === 'running') {
        getContextUsage(sessionId)
      }
    }, 15000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [sessionId])

  useEffect(() => {
    if (sessionStatus === 'running' && sessionId && sessionId !== '__new__') {
      getContextUsage(sessionId)
    }
  }, [sessionStatus])

  const hasData = !!contextUsage
  const percentage = contextUsage?.percentage ?? 0
  const color = percentage > 80 ? '#f87171' : percentage > 60 ? '#f59e0b' : '#3fb950'

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-[#242320] transition-colors cursor-pointer"
        title="Context usage"
      >
        <div className="w-12 h-1.5 rounded-full bg-[#1a1918] overflow-hidden">
          <div className="h-full rounded-full transition-all duration-300" style={{ width: `${percentage}%`, background: hasData ? color : '#5c5952' }} />
        </div>
        <span className="text-[10px] tabular-nums" style={{ color: hasData ? color : '#5c5952' }}>{hasData ? `${percentage.toFixed(0)}%` : '—'}</span>
      </button>
      {open && <ContextPanel onClose={() => setOpen(false)} />}
    </div>
  )
}
