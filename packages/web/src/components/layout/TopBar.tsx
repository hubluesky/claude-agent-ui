import { useState, useRef, useCallback, useMemo } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useEmbedStore } from '../../stores/embedStore'
import { HistoryPanel } from './HistoryPanel'

export function TopBar() {
  const currentSessionId = useSessionStore((s) => s.currentSessionId)
  const currentProjectCwd = useSessionStore((s) => s.currentProjectCwd)
  const currentSessions = useSessionStore((s) => s.currentProjectCwd ? s.sessions.get(s.currentProjectCwd) : undefined) ?? []
  const selectSession = useSessionStore((s) => s.selectSession)
  const renameSession = useSessionStore((s) => s.renameSession)
  const sidebarOpen = useSettingsStore((s) => s.sidebarOpen)
  const setSidebarOpen = useSettingsStore((s) => s.setSidebarOpen)
  const isEmbed = useEmbedStore((s) => s.isEmbed)

  const [showHistory, setShowHistory] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const isNewSession = currentSessionId === '__new__'

  const currentSession = useMemo(
    () => currentSessions.find((s) => s.sessionId === currentSessionId),
    [currentSessions, currentSessionId],
  )
  const sessionTitle = currentSession?.title || (isNewSession ? 'New conversation' : '')

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
