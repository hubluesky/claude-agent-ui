import { useEffect, useRef, useMemo } from 'react'
import { useMultiPanelStore, type PanelSummary } from '../../stores/multiPanelStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'

interface BackgroundStatusDropdownProps {
  onClose: () => void
}

type StatusGroup = '需要注意' | '进行中' | '空闲'

const STATUS_GROUP_ORDER: StatusGroup[] = ['需要注意', '进行中', '空闲']

function getStatusGroup(item: PanelSummary): StatusGroup {
  if (item.hasApproval || item.status === 'awaiting_approval' || item.status === 'awaiting_user_input') {
    return '需要注意'
  }
  if (item.status === 'running') return '进行中'
  return '空闲'
}

export function BackgroundStatusDropdown({ onClose }: BackgroundStatusDropdownProps) {
  const panelSummaries = useMultiPanelStore((s) => s.panelSummaries)
  const panelIds = useMultiPanelStore((s) => s.panelSessionIds)
  const addPanel = useMultiPanelStore((s) => s.addPanel)
  const currentSessionId = useSessionStore((s) => s.currentSessionId)
  const selectSession = useSessionStore((s) => s.selectSession)
  const viewMode = useSettingsStore((s) => s.viewMode)
  const setViewMode = useSettingsStore((s) => s.setViewMode)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 0)
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handleClick) }
  }, [onClose])

  // Collect items, in Multi mode show all, in Single exclude current
  const items: PanelSummary[] = []
  for (const [sid, summary] of panelSummaries) {
    if (viewMode === 'multi' || sid !== currentSessionId) {
      items.push(summary)
    }
  }

  // Group by status
  const grouped = useMemo(() => {
    const map = new Map<StatusGroup, PanelSummary[]>()
    for (const item of items) {
      const group = getStatusGroup(item)
      if (!map.has(group)) map.set(group, [])
      map.get(group)!.push(item)
    }
    // Return in defined order, only non-empty groups
    const ordered = new Map<StatusGroup, PanelSummary[]>()
    for (const key of STATUS_GROUP_ORDER) {
      const list = map.get(key)
      if (list?.length) ordered.set(key, list)
    }
    return ordered
  }, [items])

  const handleClick = (summary: PanelSummary) => {
    selectSession(summary.sessionId, summary.projectCwd)
    // Switch to single view for quick access
    if (viewMode === 'multi') {
      setViewMode('single')
    }
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
        <span className="text-[9px] text-[var(--text-dim)]">{items.length} 个</span>
      </div>
      <div className="flex-1 overflow-y-auto py-1 px-1.5">
        {items.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] text-xs py-6">没有后台会话</div>
        ) : (
          Array.from(grouped.entries()).map(([groupName, sessions]) => (
            <div key={groupName} className="mb-1">
              {/* Status group header */}
              <div className={`px-2.5 py-1 text-[8px] font-semibold uppercase tracking-wider ${
                groupName === '需要注意' ? 'text-[var(--warning)]'
                  : groupName === '进行中' ? 'text-[var(--success)]'
                  : 'text-[var(--text-muted)]'
              }`}>
                {groupName}
              </div>
              {sessions.map((item) => {
                const isWaiting = item.hasApproval || item.status === 'awaiting_approval' || item.status === 'awaiting_user_input'
                const isRunning = item.status === 'running'
                const dotClass = isWaiting
                  ? 'bg-[var(--warning)] animate-pulse'
                  : isRunning
                    ? 'bg-[var(--success)] shadow-[0_0_3px_rgba(34,197,94,0.3)]'
                    : 'bg-[var(--border)]'
                const inPanel = panelIds.includes(item.sessionId)

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
                      <div className="text-[8px] text-[var(--text-muted)] truncate mt-0.5">
                        {item.projectName || item.projectCwd}
                        {item.lastMessage && ` · ${item.lastMessage}`}
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
              })}
            </div>
          ))
        )}
      </div>
      <div className="px-3 py-2 border-t border-[var(--border)] text-center text-[9px] text-[var(--text-muted)]">
        点击切换 · + 添加到面板 · ✓ 已在面板
      </div>
    </div>
  )
}
