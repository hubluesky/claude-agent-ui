import { useState, useEffect, useCallback } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useWebSocket } from '../../hooks/useWebSocket'
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
  default: { text: 'text-[#a8a29e]', hover: 'hover:text-[#e5e2db]', hoverBg: 'hover:bg-[#3d3b3780]' },
  acceptEdits: { text: 'text-[#60a5fa]', hover: 'hover:text-[#93bbfd]', hoverBg: 'hover:bg-[#60a5fa1a]' },
  auto: { text: 'text-[#d97706]', hover: 'hover:text-[#f59e0b]', hoverBg: 'hover:bg-[#d977061a]' },
  plan: { text: 'text-[#a78bfa]', hover: 'hover:text-[#c4b5fd]', hoverBg: 'hover:bg-[#a78bfa1a]' },
  bypassPermissions: { text: 'text-[#f87171]', hover: 'hover:text-[#fca5a5]', hoverBg: 'hover:bg-[#f871711a]' },
}

export function ComposerToolbar({
  onUpload, onSlashClick, onAtClick, onSend, onAbort,
  canSend, fileRefs, isLocked, isRunning, isLockHolder, onReleaseLock,
  showModes, setShowModes,
}: ComposerToolbarProps & { showModes: boolean; setShowModes: (v: boolean) => void }) {
  const [showPlusMenu, setShowPlusMenu] = useState(false)
  const { sessionStatus, connectionStatus } = useConnectionStore()
  const { currentSessionId } = useSessionStore()
  const { permissionMode, setPermissionMode } = useSettingsStore()
  const { send } = useWebSocket()

  const isDisconnected = connectionStatus !== 'connected'

  // Status config (migrated from StatusBar)
  const statusConfig: Record<string, { color: string; text: string; pulse: boolean }> = {
    idle: { color: 'bg-[#a3e635]', text: 'idle', pulse: false },
    running: { color: 'bg-[#d97706]', text: 'running', pulse: true },
    awaiting_approval: { color: 'bg-[#eab308]', text: 'awaiting approval', pulse: true },
    awaiting_user_input: { color: 'bg-[#eab308]', text: 'awaiting input', pulse: true },
  }

  const statusInfo = isLocked
    ? null // locked state has no status indicator
    : isDisconnected
      ? { color: 'bg-[#7c7872]', text: connectionStatus, pulse: connectionStatus === 'connecting' || connectionStatus === 'reconnecting' }
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
      send({ type: 'set-mode', sessionId: currentSessionId, mode: nextMode })
    }
  }, [permissionMode, currentSessionId, setPermissionMode, send])

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
            className="w-7 h-7 flex items-center justify-center text-[#7c7872] hover:text-[#e5e2db] hover:bg-[#2b2a27] rounded transition-colors text-lg"
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
          className="w-7 h-7 flex items-center justify-center text-[#7c7872] hover:text-[#e5e2db] hover:bg-[#2b2a27] rounded transition-colors text-sm font-mono font-bold"
        >
          /
        </button>

        <button
          onClick={() => !isLocked && onAtClick()}
          disabled={isLocked}
          className="w-7 h-7 flex items-center justify-center text-[#7c7872] hover:text-[#e5e2db] hover:bg-[#2b2a27] rounded transition-colors text-sm"
        >
          @
        </button>

        {fileRefs.length > 0 && (
          <>
            <div className="w-px h-4 bg-[#3d3b37] mx-1.5" />
            <div className="flex items-center gap-2">
              {fileRefs.map((ref) => (
                <span key={ref} className="flex items-center gap-1 text-xs text-[#a8a29e]">
                  <span className="text-[#7c7872]">📄</span>
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
                sessionStatus === 'running' ? 'text-[#d97706]' : 'text-[#7c7872]'
              }`}>
                {statusInfo.text}
              </span>
            </div>
            <span className="text-[#3d3b37]">|</span>
          </>
        )}

        {isLockHolder && (
          <>
            <button
              onClick={onReleaseLock}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] text-[#a8a29e] hover:text-[#e5e2db] hover:bg-[#3d3b3780] transition-colors"
              title="Release lock"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </button>
            <span className="text-[#3d3b37]">|</span>
          </>
        )}

        <button
          onClick={() => !isLocked && setShowModes(!showModes)}
          disabled={isLocked}
          className={`text-[11px] transition-colors flex items-center gap-1.5 px-2 py-1 rounded-md ${modeColor.text} ${modeColor.hover} ${modeColor.hoverBg}`}
        >
          {permissionMode === 'auto' && <span>{'»'}</span>}
          <ModeIcon type={currentModeInfo.icon} active={permissionMode !== 'default'} className="w-3.5 h-3.5 text-current" />
          {permissionMode === 'auto' ? '自动模式' : currentModeInfo.label}
        </button>

        {isRunning && !canSend ? (
          <button
            onClick={onAbort}
            className="w-7 h-7 rounded-md bg-[#f87171] flex items-center justify-center shrink-0"
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
                ? 'bg-[#e5e2db] hover:bg-white'
                : 'bg-[#242320] opacity-40'
            }`}
          >
            <svg className={`w-3.5 h-3.5 ${canSend && !isLocked ? 'text-[#1a1918]' : 'text-[#7c7872]'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
