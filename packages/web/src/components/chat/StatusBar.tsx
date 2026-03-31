import { useState } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useWebSocket } from '../../hooks/useWebSocket'
import { useSessionStore } from '../../stores/sessionStore'
import { ModesPopup } from './ModesPopup'
import type { PermissionMode, EffortLevel } from '@claude-agent-ui/shared'

export function StatusBar() {
  const { sessionStatus, lockStatus, connectionStatus } = useConnectionStore()
  const { currentSessionId } = useSessionStore()
  const { permissionMode, effort, setPermissionMode, setEffort } = useSettingsStore()
  const { send } = useWebSocket()
  const [showModes, setShowModes] = useState(false)

  const statusConfig = {
    idle: { color: 'bg-[#a3e635]', text: 'idle', pulse: false },
    running: { color: 'bg-[#d97706]', text: 'running', pulse: true },
    awaiting_approval: { color: 'bg-[#eab308]', text: 'awaiting approval', pulse: true },
    awaiting_user_input: { color: 'bg-[#eab308]', text: 'awaiting input', pulse: true },
  }

  const config = lockStatus === 'locked_other'
    ? { color: 'bg-[#f87171]', text: 'locked by another client', pulse: false }
    : connectionStatus !== 'connected'
      ? { color: 'bg-[#7c7872]', text: connectionStatus, pulse: connectionStatus === 'connecting' || connectionStatus === 'reconnecting' }
      : statusConfig[sessionStatus]

  const modeLabel: Record<string, string> = { default: 'Ask', acceptEdits: 'Edit', plan: 'Plan', bypassPermissions: 'Bypass', dontAsk: 'Auto' }

  const handleModeChange = (newMode: PermissionMode) => {
    setPermissionMode(newMode)
    if (currentSessionId && currentSessionId !== '__new__') {
      send({ type: 'set-mode', sessionId: currentSessionId, mode: newMode })
    }
  }

  const handleEffortChange = (newEffort: EffortLevel) => {
    setEffort(newEffort)
    if (currentSessionId && currentSessionId !== '__new__') {
      send({ type: 'set-effort', sessionId: currentSessionId, effort: newEffort })
    }
  }

  return (
    <div className="h-10 flex items-center gap-3 px-4 sm:px-10 border-t border-[#3d3b37] relative">
      <div className={`w-2 h-2 rounded-full ${config.color} ${config.pulse ? 'animate-pulse' : ''}`} />
      <span className="text-xs font-mono text-[#7c7872]">{config.text}</span>
      <span className="text-xs text-[#3d3b37]">|</span>

      <div className="relative">
        <button
          onClick={() => setShowModes(!showModes)}
          className="text-xs text-[#a8a29e] hover:text-[#d97706] transition-colors flex items-center gap-1"
        >
          {modeLabel[permissionMode] ?? permissionMode}
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showModes && (
          <ModesPopup
            currentMode={permissionMode}
            currentEffort={effort}
            onModeChange={handleModeChange}
            onEffortChange={handleEffortChange}
            onClose={() => setShowModes(false)}
          />
        )}
      </div>
    </div>
  )
}
