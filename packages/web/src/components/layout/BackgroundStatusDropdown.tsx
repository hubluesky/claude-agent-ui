import { useEffect, useRef } from 'react'
import { useMultiPanelStore, type PanelSummary } from '../../stores/multiPanelStore'
import { useSessionStore } from '../../stores/sessionStore'

interface BackgroundStatusDropdownProps {
  onClose: () => void
}

export function BackgroundStatusDropdown({ onClose }: BackgroundStatusDropdownProps) {
  const panelSummaries = useMultiPanelStore((s) => s.panelSummaries)
  const addPanel = useMultiPanelStore((s) => s.addPanel)
  const hasPanel = useMultiPanelStore((s) => s.hasPanel)
  const currentSessionId = useSessionStore((s) => s.currentSessionId)
  const selectSession = useSessionStore((s) => s.selectSession)
  const ref = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  // Get all panel summaries except current session
  const items: PanelSummary[] = []
  for (const [sid, summary] of panelSummaries) {
    if (sid !== currentSessionId) {
      items.push(summary)
    }
  }

  // Sort: waiting > running > idle
  items.sort((a, b) => {
    const order = (s: string) =>
      s === 'awaiting_approval' || s === 'awaiting_user_input' ? 0
        : s === 'running' ? 1
        : 2
    return order(a.status) - order(b.status)
  })

  const handleClick = (summary: PanelSummary) => {
    selectSession(summary.sessionId, summary.projectCwd)
    onClose()
  }

  const handleAdd = (summary: PanelSummary, e: React.MouseEvent) => {
    e.stopPropagation()
    addPanel(summary.sessionId, summary)
  }

  return (
    <div
      ref={ref}
      className="absolute top-full right-0 mt-1 w-[280px] bg-[var(--bg-primary)] border border-[var(--border)] rounded-[10px] shadow-[0_12px_40px_rgba(0,0,0,0.5)] z-20 flex flex-col max-h-[400px]"
    >
      <div className="flex items-center gap-1.5 px-3.5 py-2.5 border-b border-[var(--border)]">
        <span className="text-xs font-semibold flex-1 text-[var(--text-primary)]">后台会话</span>
      </div>
      <div className="flex-1 overflow-y-auto py-1.5 px-1.5">
        {items.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] text-xs py-6">没有后台会话</div>
        ) : (
          items.map((item) => {
            const isWaiting = item.hasApproval || item.status === 'awaiting_approval' || item.status === 'awaiting_user_input'
            const isRunning = item.status === 'running'
            const dotClass = isWaiting
              ? 'bg-[var(--warning)] animate-pulse'
              : isRunning
                ? 'bg-[var(--success)] shadow-[0_0_3px_rgba(34,197,94,0.3)]'
                : 'bg-[var(--border)]'
            const inPanel = hasPanel(item.sessionId)

            return (
              <div
                key={item.sessionId}
                onClick={() => handleClick(item)}
                className={`flex items-center gap-2 px-2.5 py-[7px] rounded-[7px] cursor-pointer mb-0.5 transition-all ${
                  isWaiting ? 'bg-[var(--warning-subtle-bg)] hover:bg-[var(--warning-subtle-border)]' : 'hover:bg-[var(--bg-secondary)]'
                }`}
              >
                <div className={`w-[7px] h-[7px] rounded-full shrink-0 ${dotClass}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold truncate text-[var(--text-primary)]">{item.title || '新会话'}</div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-[8px] text-[var(--accent)] bg-[var(--accent-subtle-bg)] px-1 rounded">{item.projectName}</span>
                    {item.lastMessage && (
                      <span className="text-[8px] text-[var(--text-muted)] truncate flex-1">{item.lastMessage}</span>
                    )}
                  </div>
                </div>
                {isWaiting && (
                  <span className="text-[7px] bg-[var(--warning)] text-[var(--bg-primary)] px-1.5 rounded font-bold">审批</span>
                )}
                {inPanel ? (
                  <div className="w-[18px] h-[18px] rounded bg-[var(--accent-subtle-bg)] border border-[var(--accent-subtle-border)] text-[var(--accent)] flex items-center justify-center text-[8px] shrink-0">
                    ✓
                  </div>
                ) : (
                  <button
                    onClick={(e) => handleAdd(item, e)}
                    className="w-[18px] h-[18px] rounded border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] hover:bg-[var(--accent-subtle-bg)] flex items-center justify-center text-[10px] shrink-0 cursor-pointer bg-transparent"
                    title="添加到面板"
                  >
                    +
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
      <div className="px-3 py-2 border-t border-[var(--border)] text-center text-[9px] text-[var(--text-muted)]">
        + 添加到面板 · ✓ 已在面板 · 点击切换
      </div>
    </div>
  )
}
