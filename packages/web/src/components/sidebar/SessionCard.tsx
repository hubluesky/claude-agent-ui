import { useState, useRef, useCallback } from 'react'
import type { SessionSummary } from '@claude-agent-ui/shared'
import { relativeTime } from '../../lib/time'
import { exportSession } from '../../lib/api'

interface SessionCardProps {
  session: SessionSummary
  isSelected: boolean
  onClick: () => void
  onRename?: (title: string) => void
}

export function SessionCard({ session, isSelected, onClick, onRename }: SessionCardProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!onRename) return
    setEditValue(session.title || '')
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleSubmitRename = () => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== session.title) {
      onRename?.(trimmed)
    }
    setEditing(false)
  }

  const [copied, setCopied] = useState(false)
  const handleCopyId = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const cmd = `claude -r ${session.sessionId}`
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [session.sessionId])

  return (
    <button
      onClick={onClick}
      onDoubleClick={handleDoubleClick}
      className={`w-full flex items-start gap-2.5 p-2.5 rounded-lg text-left transition-colors duration-150 ${
        isSelected
          ? 'bg-[#d977061a] border border-[#d9770640]'
          : 'bg-[#2b2a27] border border-transparent hover:bg-[#3d3b37]'
      }`}
    >
      <div className="flex-1 min-w-0 space-y-1">
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSubmitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmitRename()
              if (e.key === 'Escape') setEditing(false)
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-[#1e1d1a] border border-[#d97706] rounded px-1.5 py-0.5 text-[13px] text-[#e5e2db] outline-none"
          />
        ) : (
          <p className="text-[13px] font-medium text-[#e5e2db] truncate">
            {session.title || '新会话'}
          </p>
        )}
        <div className="flex gap-2 text-[10px] text-[#7c7872]">
          <span>{relativeTime(session.updatedAt)}</span>
        </div>
        <div className="flex items-center gap-1">
          <p
            onClick={handleCopyId}
            title="点击复制恢复命令"
            className="text-[9px] font-mono text-[#5c5952] truncate cursor-pointer hover:text-[#7c7872] select-all"
          >
            {copied ? '✓ 已复制' : `claude -r ${session.sessionId}`}
          </p>
          <span className="flex-1" />
          <button
            onClick={(e) => { e.stopPropagation(); exportSession(session.sessionId, 'md') }}
            className="text-[9px] text-[#5c5952] hover:text-[#a8a29e] cursor-pointer px-1"
            title="导出 Markdown"
          >
            MD
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); exportSession(session.sessionId, 'json') }}
            className="text-[9px] text-[#5c5952] hover:text-[#a8a29e] cursor-pointer px-1"
            title="导出 JSON"
          >
            JSON
          </button>
        </div>
      </div>
    </button>
  )
}
