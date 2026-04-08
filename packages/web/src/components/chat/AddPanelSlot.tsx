import { useState, useMemo, useRef, useEffect } from 'react'
import { useSessionStore } from '../../stores/sessionStore'

interface AddPanelSlotProps {
  existingPanelIds: string[]
  onAddSession: (sessionId: string, title: string, cwd: string, projectName: string) => void
}

export function AddPanelSlot({ existingPanelIds, onAddSession }: AddPanelSlotProps) {
  const [expanded, setExpanded] = useState(false)
  const allSessions = useSessionStore((s) => s.sessions)
  const projects = useSessionStore((s) => s.projects)
  const ref = useRef<HTMLDivElement>(null)

  // Group available sessions by project for cross-project support
  const groupedAvailable = useMemo(() => {
    const groups: { cwd: string; projectName: string; sessions: { sessionId: string; title: string }[] }[] = []
    for (const [cwd, sessionList] of allSessions) {
      const available = sessionList.filter((s) => !existingPanelIds.includes(s.sessionId))
      if (available.length === 0) continue
      const project = projects.find((p) => p.cwd === cwd)
      const projectName = project?.name ?? cwd.split(/[/\\]/).pop() ?? ''
      groups.push({
        cwd,
        projectName,
        sessions: available.map((s) => ({ sessionId: s.sessionId, title: s.title ?? '' })),
      })
    }
    return groups
  }, [allSessions, existingPanelIds, projects])

  const totalAvailable = groupedAvailable.reduce((sum, g) => sum + g.sessions.length, 0)

  // Close popup on click outside
  useEffect(() => {
    if (!expanded) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setExpanded(false)
      }
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler) }
  }, [expanded])

  const sessionList = (
    <div className="flex-1 overflow-y-auto py-1 px-1.5">
      {totalAvailable === 0 ? (
        <div className="text-center text-[var(--text-muted)] text-[10px] py-4">
          没有更多可添加的会话
        </div>
      ) : (
        groupedAvailable.map((group) => (
          <div key={group.cwd}>
            {groupedAvailable.length > 1 && (
              <div className="px-2.5 pt-2 pb-1 text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider truncate">
                {group.projectName}
              </div>
            )}
            {group.sessions.map((session) => (
              <button
                key={session.sessionId}
                onClick={() => {
                  onAddSession(session.sessionId, session.title, group.cwd, group.projectName)
                  setExpanded(false)
                }}
                className="w-full flex items-center gap-2 px-2.5 py-[6px] rounded-md text-left hover:bg-[var(--bg-secondary)] transition-colors mb-0.5 cursor-pointer bg-transparent border-none"
              >
                <div className="w-[5px] h-[5px] rounded-full bg-[var(--border)] shrink-0" />
                <span className="text-[10px] text-[var(--text-primary)] truncate flex-1">
                  {session.title || '无标题'}
                </span>
              </button>
            ))}
          </div>
        ))
      )}
    </div>
  )

  return (
    <div ref={ref} className="absolute bottom-3 right-3 z-10">
      {expanded && (
        <div className="absolute bottom-full right-0 mb-1 w-[240px] bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg shadow-[0_8px_30px_rgba(0,0,0,0.4)] flex flex-col max-h-[300px]">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] shrink-0">
            <span className="text-[11px] font-semibold text-[var(--text-primary)] flex-1">添加面板</span>
          </div>
          {sessionList}
        </div>
      )}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shadow-lg transition-colors ${
          expanded
            ? 'bg-[var(--accent)] text-[var(--bg-primary)]'
            : 'bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)]'
        }`}
        title="添加面板"
      >
        +
      </button>
    </div>
  )
}
