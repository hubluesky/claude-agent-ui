import { useState, useRef, useCallback, useMemo } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useEmbedStore } from '../../stores/embedStore'
import { useMultiPanelStore } from '../../stores/multiPanelStore'
import { HistoryPanel } from './HistoryPanel'
import { ViewModeToggle } from './ViewModeToggle'
import { BackgroundStatusButton } from './BackgroundStatusButton'

export function TopBar() {
  const currentSessionId = useSessionStore((s) => s.currentSessionId)
  const currentProjectCwd = useSessionStore((s) => s.currentProjectCwd)
  const currentSessions = useSessionStore((s) => s.currentProjectCwd ? s.sessions.get(s.currentProjectCwd) : undefined) ?? []
  const selectSession = useSessionStore((s) => s.selectSession)
  const renameSession = useSessionStore((s) => s.renameSession)
  const sidebarOpen = useSettingsStore((s) => s.sidebarOpen)
  const setSidebarOpen = useSettingsStore((s) => s.setSidebarOpen)
  const viewMode = useSettingsStore((s) => s.viewMode)
  const isEmbed = useEmbedStore((s) => s.isEmbed)
  const panelSummary = useMultiPanelStore((s) => currentSessionId ? s.panelSummaries.get(currentSessionId) : undefined)
  const isInMulti = useMultiPanelStore((s) => currentSessionId ? s.panelSessionIds.includes(currentSessionId) : false)

  const [showHistory, setShowHistory] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const isNewSession = currentSessionId === '__new__'

  const currentSession = useMemo(
    () => currentSessions.find((s) => s.sessionId === currentSessionId),
    [currentSessions, currentSessionId],
  )
  // Fallback to panelSummary title when session list hasn't loaded yet (e.g. switching from multi-view)
  const sessionTitle = currentSession?.title || panelSummary?.title || (isNewSession ? 'New conversation' : '')

  const handleTitleClick = useCallback(() => {
    if (isNewSession || !currentSessionId) return
    setEditValue(currentSession?.title || '')
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [isNewSession, currentSessionId, currentSession])

  const handleTitleSubmit = useCallback(() => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== currentSession?.title && currentSessionId && !isNewSession) {
      renameSession(currentSessionId, trimmed)
    }
    setEditing(false)
  }, [editValue, currentSession, currentSessionId, isNewSession, renameSession])

  const handleNewSession = useCallback(() => {
    if (currentProjectCwd) {
      selectSession('__new__', currentProjectCwd)
    }
  }, [currentProjectCwd, selectSession])

  const handleSelectHistory = useCallback((sessionId: string) => {
    if (currentProjectCwd) {
      selectSession(sessionId, currentProjectCwd)
    }
    setShowHistory(false)
  }, [currentProjectCwd, selectSession])

  const handleCloseHistory = useCallback(() => setShowHistory(false), [])

  const handleAddToMulti = useCallback(() => {
    if (!currentSessionId || currentSessionId === '__new__' || !currentProjectCwd) return
    const { projects } = useSessionStore.getState()
    const project = projects.find((p) => p.cwd === currentProjectCwd)
    const projectName = project?.name ?? currentProjectCwd.split(/[/\\]/).pop() ?? ''
    const session = currentSessions.find((s) => s.sessionId === currentSessionId)
    useMultiPanelStore.getState().addPanel(currentSessionId, {
      sessionId: currentSessionId,
      title: session?.title ?? '',
      projectCwd: currentProjectCwd,
      projectName,
    })
  }, [currentSessionId, currentProjectCwd, currentSessions])

  const handleRemoveFromMulti = useCallback(() => {
    if (!currentSessionId) return
    useMultiPanelStore.getState().removePanel(currentSessionId)
  }, [currentSessionId])

  return (
    <div className="flex items-center justify-between h-10 shrink-0 px-3 border-b border-[var(--border)] relative">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {isEmbed ? (
          <div className="w-5 h-5 bg-[var(--accent)] rounded flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold text-[var(--bg-primary)]">C</span>
          </div>
        ) : (
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-[var(--border)] text-[var(--text-muted)] shrink-0"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
        )}

        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleTitleSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTitleSubmit()
              if (e.key === 'Escape') setEditing(false)
            }}
            className="flex-1 min-w-0 bg-[var(--bg-tertiary)] border border-[var(--accent)] rounded px-2 py-0.5 text-xs text-[var(--text-primary)] outline-none"
          />
        ) : (
          <span
            onClick={handleTitleClick}
            className={`text-xs truncate ${
              isNewSession || !currentSessionId
                ? 'text-[var(--text-muted)]'
                : 'text-[var(--text-primary)] cursor-pointer hover:text-[var(--accent)]'
            }`}
            title={isNewSession || !currentSessionId ? undefined : '点击编辑标题'}
          >
            {sessionTitle || 'Select a session'}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {!isEmbed && <ViewModeToggle />}
        {/* Pin/Unpin to Multi — only in Single mode for non-new sessions */}
        {!isEmbed && viewMode === 'single' && currentSessionId && currentSessionId !== '__new__' && (
          isInMulti ? (
            <button
              onClick={handleRemoveFromMulti}
              className="w-8 h-8 rounded-md flex items-center justify-center text-[var(--accent)] hover:bg-[var(--border)]"
              title="从 Multi 移除"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="3" width="7" height="7" rx="1" fill="currentColor" opacity="0.3" />
                <rect x="14" y="3" width="7" height="7" rx="1" fill="currentColor" opacity="0.3" />
                <rect x="3" y="14" width="7" height="7" rx="1" fill="currentColor" opacity="0.3" />
                <rect x="14" y="14" width="7" height="7" rx="1" fill="currentColor" opacity="0.3" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleAddToMulti}
              className="w-8 h-8 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-[var(--accent)]"
              title="添加到 Multi"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.5 14v7M14 17.5h7" />
              </svg>
            </button>
          )
        )}
        {!isEmbed && <BackgroundStatusButton />}
        {/* History and new session only in Single mode (project-specific) */}
        {(viewMode === 'single' || isEmbed) && (
          <>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
                showHistory ? 'bg-[var(--border)] text-[var(--text-primary)]' : 'hover:bg-[var(--border)] text-[var(--text-muted)]'
              }`}
              title="历史会话"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </button>
            <button
              onClick={handleNewSession}
              className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-[var(--border)] text-[var(--text-muted)]"
              title="新建会话"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2 12c0-4.418 4.03-8 9-8s9 3.582 9 8-4.03 8-9 8c-1.065 0-2.08-.164-3.012-.463L3 21l1.338-3.346C2.842 16.078 2 14.12 2 12z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6M12 9v6" />
              </svg>
            </button>
          </>
        )}
      </div>

      {showHistory && (
        <HistoryPanel
          onSelect={handleSelectHistory}
          onClose={handleCloseHistory}
        />
      )}
    </div>
  )
}
