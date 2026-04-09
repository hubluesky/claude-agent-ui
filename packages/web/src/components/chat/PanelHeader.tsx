import { useState, useRef, useCallback } from 'react'
import { useChatSession } from '../../providers/ChatSessionContext'
import { useSessionStore } from '../../stores/sessionStore'
import { useMultiPanelStore } from '../../stores/multiPanelStore'

interface PanelHeaderProps {
  title: string
  projectName: string
  onExpand: () => void
  onClose: () => void
}

export function PanelHeader({ title, projectName, onExpand, onClose }: PanelHeaderProps) {
  const { sessionId, sessionStatus, lockStatus } = useChatSession()
  const renameSession = useSessionStore((s) => s.renameSession)
  const updateSummary = useMultiPanelStore((s) => s.updateSummary)

  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const isNewSession = sessionId === '__new__'

  const handleTitleClick = useCallback(() => {
    if (isNewSession || !sessionId) return
    setEditValue(title || '')
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [isNewSession, sessionId, title])

  const handleTitleSubmit = useCallback(() => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== title && sessionId && !isNewSession) {
      renameSession(sessionId, trimmed)
      updateSummary(sessionId, { title: trimmed })
    }
    setEditing(false)
  }, [editValue, title, sessionId, isNewSession, renameSession, updateSummary])

  const dotColor = sessionStatus === 'running'
    ? 'bg-[var(--success)] shadow-[0_0_4px_rgba(34,197,94,0.4)]'
    : lockStatus === 'locked_self'
      ? 'bg-[var(--warning)]'
      : 'bg-[var(--border)]'

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-[var(--border)] shrink-0 bg-[var(--bg-secondary)]">
      <div className={`w-[5px] h-[5px] rounded-full shrink-0 ${dotColor}`} />
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
          className="flex-1 min-w-0 bg-[var(--bg-tertiary)] border border-[var(--accent)] rounded px-1 py-0 text-[9px] text-[var(--text-primary)] outline-none"
        />
      ) : (
        <span
          className={`text-[9px] font-semibold flex-1 truncate ${
            isNewSession || !sessionId
              ? 'text-[var(--text-muted)]'
              : 'cursor-pointer text-[var(--text-primary)] hover:text-[var(--accent)]'
          }`}
          onClick={handleTitleClick}
          onDoubleClick={onExpand}
          title={isNewSession || !sessionId ? undefined : '点击编辑标题，双击展开全屏'}
        >
          {title || 'New conversation'}
        </span>
      )}
      <span className="text-[7px] text-[var(--accent)] bg-[var(--accent-subtle-bg)] px-1 rounded">{projectName}</span>
      <button
        onClick={onExpand}
        className="flex items-center gap-0.5 px-1 h-[18px] rounded text-[var(--text-muted)] hover:bg-[var(--accent-subtle-bg)] hover:text-[var(--accent)]"
        title="展开全屏（双击标题也可展开）"
      >
        <span className="text-[10px]">↗</span>
        <span className="text-[7px] font-mono opacity-60">展开</span>
      </button>
      <button
        onClick={onClose}
        className="w-[18px] h-[18px] rounded text-[11px] text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-[var(--text-secondary)] flex items-center justify-center"
      >
        ×
      </button>
    </div>
  )
}
