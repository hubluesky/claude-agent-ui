import { useState, useEffect, useCallback } from 'react'
import { useGlobalConnection } from '../../hooks/useContainer'
import { useChatSession } from '../../providers/ChatSessionContext'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { wsManager } from '../../lib/WebSocketManager'
import { MODES, ModeIcon } from './ModesPopup'
import { PlusMenu } from './PlusMenu'

interface ComposerToolbarProps {
  onUpload: () => void
  onSlashClick: () => void
  onAtClick: () => void
  onSend: () => void
  onAbort: () => void
  canSend: boolean
  fileRefs: string[]
  isLocked: boolean
  isRunning: boolean
  isLockHolder: boolean
  onReleaseLock: () => void
}

// modeColorClass is module-level so it's not recreated on every render
const modeColorClass: Record<string, { text: string; hover: string; hoverBg: string }> = {
  default: { text: 'text-[var(--text-secondary)]', hover: 'hover:text-[var(--text-primary)]', hoverBg: 'hover:bg-[var(--border-half)]' },
  acceptEdits: { text: 'text-[var(--info)]', hover: 'hover:text-[var(--info-hover)]', hoverBg: 'hover:bg-[var(--info-subtle-bg)]' },
  auto: { text: 'text-[var(--accent)]', hover: 'hover:text-[var(--warning)]', hoverBg: 'hover:bg-[var(--accent-subtle-bg)]' },
  plan: { text: 'text-[var(--purple)]', hover: 'hover:text-[var(--purple)]', hoverBg: 'hover:bg-[var(--purple-subtle-bg)]' },
  bypassPermissions: { text: 'text-[var(--error)]', hover: 'hover:text-[var(--error)]', hoverBg: 'hover:bg-[var(--error-subtle-bg)]' },
}

export function ComposerToolbar({
  onUpload, onSlashClick, onAtClick, onSend, onAbort,
  canSend, fileRefs, isLocked, isRunning, isLockHolder, onReleaseLock,
  showModes, setShowModes,
}: ComposerToolbarProps & { showModes: boolean; setShowModes: (v: boolean) => void }) {
  const [showPlusMenu, setShowPlusMenu] = useState(false)
  const { connectionStatus } = useGlobalConnection()
  const { sessionStatus } = useChatSession()
  const { currentSessionId } = useSessionStore()
  const { permissionMode, setPermissionMode } = useSettingsStore()

  const isDisconnected = connectionStatus !== 'connected'

  // Status config (migrated from StatusBar)
  const statusConfig: Record<string, { color: string; text: string; pulse: boolean }> = {
    idle: { color: 'bg-[var(--success)]', text: 'idle', pulse: false },
    running: { color: 'bg-[var(--accent)]', text: 'running', pulse: true },
    awaiting_approval: { color: 'bg-[var(--warning)]', text: 'awaiting approval', pulse: true },
    awaiting_user_input: { color: 'bg-[var(--warning)]', text: 'awaiting input', pulse: true },
  }

  const statusInfo = isDisconnected
    ? { color: 'bg-[var(--text-muted)]', text: connectionStatus, pulse: connectionStatus === 'connecting' || connectionStatus === 'reconnecting' }
    : statusConfig[sessionStatus]

  const currentModeInfo = MODES.find((m) => m.mode === permissionMode) ?? MODES[0]

  const modeColor = modeColorClass[permissionMode] ?? modeColorClass.default

  // Shift+Tab cycles through permission modes
  const cycleMode = useCallback(() => {
    const modeOrder = MODES.map((m) => m.mode)
    const currentIndex = modeOrder.indexOf(permissionMode)
    const nextMode = modeOrder[(currentIndex + 1) % modeOrder.length]
    setPermissionMode(nextMode)
    if (currentSessionId && currentSessionId !== '__new__') {
      wsManager.setMode(currentSessionId, nextMode)
    }
  }, [permissionMode, currentSessionId, setPermissionMode])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault()
        cycleMode()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [cycleMode])

  const handleAddContext = () => {
    onAtClick()
  }

  return (
    <div className={`flex items-center justify-between px-2.5 py-1.5 ${isLocked ? 'opacity-35' : ''}`}>
      {/* Left side: +, /, @ buttons + separator + file refs */}
      <div className="flex items-center gap-0.5">
        <div className="relative">
          <button
            onClick={() => !isLocked && setShowPlusMenu(!showPlusMenu)}
            disabled={isLocked}
            className="w-7 h-7 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors text-lg"
          >
            +
          </button>
          {showPlusMenu && (
            <PlusMenu
              onUpload={onUpload}
              onAddContext={handleAddContext}
              onClose={() => setShowPlusMenu(false)}
            />
          )}
        </div>

        <button
          onClick={() => !isLocked && onSlashClick()}
          disabled={isLocked}
          className="w-7 h-7 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors text-sm font-mono font-bold"
        >
          /
        </button>

        <button
          onClick={() => !isLocked && onAtClick()}
          disabled={isLocked}
          className="w-7 h-7 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded transition-colors text-sm"
        >
          @
        </button>

        {fileRefs.length > 0 && (
          <>
            <div className="w-px h-4 bg-[var(--border)] mx-1.5" />
            <div className="flex items-center gap-2">
              {fileRefs.map((ref) => (
                <span key={ref} className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                  <span className="text-[var(--text-muted)]">📄</span>
                  {ref.split('/').pop()}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Right side: status + mode + send/stop */}
      <div className="flex items-center gap-2">
        {statusInfo && (
          <>
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${statusInfo.color} ${statusInfo.pulse ? 'animate-pulse' : ''}`} />
              <span className={`text-[11px] font-mono ${
                sessionStatus === 'running' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
              }`}>
                {statusInfo.text}
              </span>
            </div>
            <span className="text-[var(--border)]">|</span>
          </>
        )}

        {isLockHolder && (
          <>
            <button
              onClick={onReleaseLock}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border-half)] transition-colors"
              title="Release lock"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </button>
            <span className="text-[var(--border)]">|</span>
          </>
        )}

        <button
          onClick={() => !isLocked && setShowModes(!showModes)}
          disabled={isLocked}
          className={`text-[11px] transition-colors flex items-center gap-1.5 px-2 py-1 rounded-md ${modeColor.text} ${modeColor.hover} ${modeColor.hoverBg}`}
        >
          <ModeIcon type={currentModeInfo.icon} active={permissionMode !== 'default'} className="w-3.5 h-3.5 text-current" />
          {permissionMode === 'auto' ? '自动模式' : currentModeInfo.label}
        </button>

        {isRunning ? (
          <button
            onClick={onAbort}
            className="w-7 h-7 rounded-md bg-[var(--error)] flex items-center justify-center shrink-0"
            title="Stop"
          >
            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={!canSend || isLocked || isDisconnected}
            className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-colors ${
              canSend && !isLocked && !isDisconnected
                ? 'bg-[var(--text-primary)] hover:bg-white'
                : 'bg-[var(--bg-secondary)] opacity-40'
            }`}
          >
            <svg className={`w-3.5 h-3.5 ${canSend && !isLocked ? 'text-[var(--bg-input)]' : 'text-[var(--text-muted)]'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
