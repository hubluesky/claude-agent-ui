import { useEffect, useRef, useState } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useWebSocket } from '../../hooks/useWebSocket'

// Note: useEffect/useRef used by ContextUsageIndicator at bottom of file

export function ContextPanel({ onClose }: { onClose: () => void }) {
  const contextUsage = useConnectionStore((s) => s.contextUsage)
  // Polling is owned by ContextUsageIndicator — panel just reads store state

  if (!contextUsage) {
    return (
      <div className="absolute bottom-full right-0 mb-1 w-80 bg-[#242320] border border-[#3d3b37] rounded-lg shadow-xl z-50 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-[#7c7872] uppercase tracking-wide">Context Usage</span>
          <button onClick={onClose} className="text-[#5c5952] hover:text-[#a8a29e] cursor-pointer">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <p className="text-xs text-[#5c5952]">No active session</p>
      </div>
    )
  }

  const { categories, totalTokens, maxTokens, percentage } = contextUsage
  const mainCategories = categories.filter((c) => !c.isDeferred && c.tokens > 0)

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute bottom-full right-0 mb-1 w-80 bg-[#242320] border border-[#3d3b37] rounded-lg shadow-xl z-50 overflow-hidden">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-[#7c7872] uppercase tracking-wide">Context Usage</span>
          <button onClick={onClose} className="text-[#5c5952] hover:text-[#a8a29e] cursor-pointer">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-4 pb-2">
          <div className="flex items-center justify-between text-[10px] text-[#7c7872] mb-1">
            <span>{formatTokens(totalTokens)} / {formatTokens(maxTokens)}</span>
            <span className={percentage > 80 ? 'text-[#f87171]' : ''}>{percentage.toFixed(0)}%</span>
          </div>
          <div className="h-2 rounded-full bg-[#1a1918] overflow-hidden flex">
            {mainCategories.map((cat, i) => {
              const w = (cat.tokens / maxTokens) * 100
              if (w < 0.5) return null
              return (
                <div
                  key={i}
                  className="h-full transition-all duration-300"
                  style={{ width: `${w}%`, background: cat.color }}
                  title={`${cat.name}: ${formatTokens(cat.tokens)}`}
                />
              )
            })}
          </div>
        </div>

        {/* Category list */}
        <div className="px-4 pb-3 space-y-1">
          {mainCategories.map((cat, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px]">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: cat.color }} />
              <span className="flex-1 text-[#a8a29e] truncate">{cat.name}</span>
              <span className="text-[#7c7872] tabular-nums">{formatTokens(cat.tokens)}</span>
              <span className="text-[#5c5952] tabular-nums w-8 text-right">{((cat.tokens / maxTokens) * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>

        {/* Model */}
        <div className="px-4 pb-3 border-t border-[#3d3b37] pt-2">
          <span className="text-[10px] text-[#5c5952]">{contextUsage.model}</span>
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

/** Compact token bar for StatusBar — shows percentage and opens ContextPanel on click.
 *  Also owns the polling lifecycle: fetches on mount + every 15s while running. */
export function ContextUsageIndicator() {
  const [open, setOpen] = useState(false)
  const contextUsage = useConnectionStore((s) => s.contextUsage)
  const sessionStatus = useConnectionStore((s) => s.sessionStatus)
  const sessionId = useSessionStore((s) => s.currentSessionId)
  const { getContextUsage } = useWebSocket()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Fetch on mount and poll while running
  useEffect(() => {
    if (!sessionId || sessionId === '__new__') return
    getContextUsage(sessionId)

    intervalRef.current = setInterval(() => {
      if (useConnectionStore.getState().sessionStatus === 'running') {
        getContextUsage(sessionId)
      }
    }, 15000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [sessionId])

  // Also fetch when status changes to running
  useEffect(() => {
    if (sessionStatus === 'running' && sessionId && sessionId !== '__new__') {
      getContextUsage(sessionId)
    }
  }, [sessionStatus])

  if (!contextUsage) return null

  const { percentage } = contextUsage
  const color = percentage > 80 ? '#f87171' : percentage > 60 ? '#f59e0b' : '#3fb950'

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-[#242320] transition-colors cursor-pointer"
        title="Context usage"
      >
        <div className="w-12 h-1.5 rounded-full bg-[#1a1918] overflow-hidden">
          <div className="h-full rounded-full transition-all duration-300" style={{ width: `${percentage}%`, background: color }} />
        </div>
        <span className="text-[10px] tabular-nums" style={{ color }}>{percentage.toFixed(0)}%</span>
      </button>
      {open && <ContextPanel onClose={() => setOpen(false)} />}
    </div>
  )
}
