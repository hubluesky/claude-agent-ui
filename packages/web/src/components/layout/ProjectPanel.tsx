import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { relativeTime } from '../../lib/time'

interface ProjectPanelProps {
  onClose: () => void
  onNewProject: () => void
}

export function ProjectPanel({ onClose, onNewProject }: ProjectPanelProps) {
  const [search, setSearch] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const projects = useSessionStore((s) => s.projects)
  const projectsLoading = useSessionStore((s) => s.projectsLoading)
  const currentProjectCwd = useSessionStore((s) => s.currentProjectCwd)
  const selectProject = useSessionStore((s) => s.selectProject)
  const loadProjects = useSessionStore((s) => s.loadProjects)

  useEffect(() => { loadProjects() }, [loadProjects])

  const filtered = useMemo(() => {
    const lowerSearch = search.toLowerCase()
    return projects.filter((p) =>
      !p.name.startsWith('.') && p.name.toLowerCase().includes(lowerSearch)
    )
  }, [projects, search])

  const handleSelect = useCallback((cwd: string) => {
    selectProject(cwd)
    onCloseRef.current()
  }, [selectProject])

  const handleNewProject = useCallback(() => {
    onCloseRef.current()
    onNewProject()
  }, [onNewProject])

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onCloseRef.current()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  return (
    <div
      ref={panelRef}
      className="absolute top-10 left-1 w-[340px] max-sm:left-0 max-sm:right-0 max-sm:w-auto bg-[var(--bg-primary)] border border-[var(--border)] border-t-0 rounded-b-xl shadow-2xl z-50 flex flex-col"
      style={{ maxHeight: 'min(440px, calc(100dvh - 60px))' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <span className="text-[13px] font-semibold text-[var(--accent)]">项目列表</span>
      </div>

      {/* Search */}
      <div className="px-2.5 pb-2">
        <div className="flex items-center gap-1.5 h-8 px-2.5 bg-[var(--bg-hover)] rounded-md border border-[var(--border)] focus-within:border-[var(--accent)] transition-colors">
          <svg className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索项目..."
            autoFocus
            className="flex-1 bg-transparent border-none outline-none text-[var(--text-primary)] text-xs placeholder-[var(--text-muted)]"
          />
        </div>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto px-1.5 space-y-0.5">
        {projectsLoading ? (
          <p className="text-center text-[var(--text-muted)] text-xs py-4">加载中...</p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-[var(--text-muted)] text-xs py-4">
            {search ? '没有匹配的项目' : '暂无项目'}
          </p>
        ) : (
          filtered.map((p) => (
            <button
              key={p.cwd}
              onClick={() => handleSelect(p.cwd)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors ${
                currentProjectCwd === p.cwd
                  ? 'bg-[var(--accent-subtle-bg)] border-l-2 border-[var(--accent)]'
                  : 'hover:bg-[var(--bg-hover)]'
              }`}
            >
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-semibold ${
                currentProjectCwd === p.cwd
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
              }`}>
                {p.sessionCount}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-[13px] truncate ${
                  currentProjectCwd === p.cwd
                    ? 'text-[var(--text-primary)] font-medium'
                    : 'text-[var(--text-secondary)]'
                }`}>
                  {p.name}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                  {relativeTime(p.lastActiveAt)}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {/* Footer: new project button */}
      <div className="px-2.5 py-2 border-t border-[var(--border)]">
        <button
          onClick={handleNewProject}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-md text-xs text-[var(--accent)] border border-dashed border-[var(--accent)]/30 hover:bg-[var(--accent)]/5 hover:border-[var(--accent)] transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          新建项目
        </button>
      </div>
    </div>
  )
}
