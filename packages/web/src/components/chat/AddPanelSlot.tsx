import { useState, useMemo } from 'react'
import { useSessionStore } from '../../stores/sessionStore'

interface AddPanelSlotProps {
  existingPanelIds: string[]
  onAddSession: (sessionId: string, title: string, cwd: string, projectName: string) => void
}

export function AddPanelSlot({ existingPanelIds, onAddSession }: AddPanelSlotProps) {
  const [expanded, setExpanded] = useState(false)
  const currentProjectCwd = useSessionStore((s) => s.currentProjectCwd)
  const sessions = useSessionStore((s) => s.currentProjectCwd ? s.sessions.get(s.currentProjectCwd) : undefined) ?? []
  const projects = useSessionStore((s) => s.projects)

  const projectName = useMemo(() => {
    if (!currentProjectCwd) return ''
    const p = projects.find((proj) => proj.cwd === currentProjectCwd)
    return p?.name ?? currentProjectCwd.split(/[/\\]/).pop() ?? ''
  }, [currentProjectCwd, projects])

  // Filter out sessions already in panels
  const available = useMemo(
    () => sessions.filter((s) => !existingPanelIds.includes(s.sessionId)),
    [sessions, existingPanelIds],
  )

  if (!expanded) {
    return (
      <div
        onClick={() => setExpanded(true)}
        className="flex flex-col items-center justify-center cursor-pointer text-[var(--text-dim)] hover:text-[var(--text-muted)] h-full bg-[var(--bg-primary)] min-h-[200px] transition-colors"
      >
        <div className="w-8 h-8 rounded-full bg-[var(--bg-secondary)] border border-[var(--border)] flex items-center justify-center text-lg text-[var(--text-muted)] mb-2">
          +
        </div>
        <div className="text-[10px]">添加面板</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col bg-[var(--bg-primary)] min-h-[200px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] shrink-0">
        <span className="text-[11px] font-semibold text-[var(--text-primary)] flex-1">选择会话</span>
        <button
          onClick={() => setExpanded(false)}
          className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
        >
          收起
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1 px-1.5">
        {available.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] text-[10px] py-8">
            当前项目没有更多会话
          </div>
        ) : (
          available.map((session) => (
            <button
              key={session.sessionId}
              onClick={() => {
                onAddSession(session.sessionId, session.title ?? '', currentProjectCwd ?? '', projectName)
                setExpanded(false)
              }}
              className="w-full flex items-center gap-2 px-2.5 py-[6px] rounded-md text-left hover:bg-[var(--bg-secondary)] transition-colors mb-0.5 cursor-pointer bg-transparent border-none"
            >
              <div className="w-[5px] h-[5px] rounded-full bg-[var(--border)] shrink-0" />
              <span className="text-[10px] text-[var(--text-primary)] truncate flex-1">
                {session.title || '无标题'}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
