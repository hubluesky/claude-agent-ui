import { useState, useRef, useCallback } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { HistoryPanel } from './HistoryPanel'

export function TopBar() {
  const { currentSessionId, currentProjectCwd, sessions, selectSession, renameSession } = useSessionStore()
  const { setSidebarOpen } = useSettingsStore()
  const [showHistory, setShowHistory] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const isNewSession = currentSessionId === '__new__'

  // 获取当前会话标题
  const currentSessions = currentProjectCwd ? sessions.get(currentProjectCwd) ?? [] : []
  const currentSession = currentSessions.find((s) => s.sessionId === currentSessionId)
  const sessionTitle = currentSession?.title || (isNewSession ? 'New conversation' : '')

  // 标题点击编辑
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

  // 新建会话
  const handleNewSession = useCallback(() => {
    if (currentProjectCwd) {
      selectSession('__new__', currentProjectCwd)
    }
  }, [currentProjectCwd, selectSession])

  // 历史面板中选择会话
  const handleSelectHistory = useCallback((sessionId: string) => {
    if (currentProjectCwd) {
      selectSession(sessionId, currentProjectCwd)
    }
    setShowHistory(false)
  }, [currentProjectCwd, selectSession])

  return (
    <div className="flex items-center justify-between h-10 shrink-0 px-3 border-b border-[#3d3b37] relative">
      {/* 左侧：汉堡 + 会话标题 */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <button
          onClick={() => setSidebarOpen(true)}
          className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-[#3d3b37] text-[#7c7872] shrink-0"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>

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
            className="flex-1 min-w-0 bg-[#1e1d1a] border border-[#d97706] rounded px-2 py-0.5 text-xs text-[#e5e2db] outline-none"
          />
        ) : (
          <span
            onClick={handleTitleClick}
            className={`text-xs truncate ${
              isNewSession || !currentSessionId
                ? 'text-[#7c7872]'
                : 'text-[#e5e2db] cursor-pointer hover:text-[#d97706]'
            }`}
            title={isNewSession || !currentSessionId ? undefined : '点击编辑标题'}
          >
            {sessionTitle || 'Select a session'}
          </span>
        )}
      </div>

      {/* 右侧：历史 + 新建 */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
            showHistory ? 'bg-[#3d3b37] text-[#e5e2db]' : 'hover:bg-[#3d3b37] text-[#7c7872]'
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
          className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-[#3d3b37] text-[#7c7872]"
          title="新建会话"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </button>
      </div>

      {/* 历史面板 */}
      {showHistory && (
        <HistoryPanel
          onSelect={handleSelectHistory}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  )
}
