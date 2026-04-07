import { useState } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useWebSocket } from '../../hooks/useWebSocket'

/** Extract short name from SDK displayName + description.
 *  "Opus (1M context)" + "Opus 4.6 with 1M context..." → "Opus 4.6" */
function formatDisplayName(displayName: string, description?: string): string {
  // Try to extract "Model X.Y" from description (e.g. "Opus 4.6 with 1M context")
  const verMatch = description?.match(/(\w+)\s+(\d+\.\d+)/)
  if (verMatch) return `${verMatch[1]} ${verMatch[2]}`
  // Fallback: strip parenthetical from displayName: "Opus (1M context)" → "Opus"
  return displayName.replace(/\s*\(.*\)$/, '')
}

/** Format raw model ID into friendly short name */
function formatModelId(id: string | undefined): string | undefined {
  if (!id) return undefined
  // "claude-opus-4-6" → "Opus 4.6"
  const full = id.match(/claude-(\w+)-(\d+)-(\d+)/)
  if (full) {
    const name = full[1].charAt(0).toUpperCase() + full[1].slice(1)
    return `${name} ${full[2]}.${full[3]}`
  }
  // "opus[1m]" → "Opus", "sonnet[1m]" → "Sonnet", "haiku" → "Haiku"
  const short = id.match(/^(\w+?)(?:\[.*\])?$/)
  if (short) {
    const name = short[1].charAt(0).toUpperCase() + short[1].slice(1)
    return name
  }
  return id
}

export function ModelSelector() {
  const [open, setOpen] = useState(false)
  const models = useConnectionStore((s) => s.models)
  const accountInfo = useConnectionStore((s) => s.accountInfo)
  const contextUsage = useConnectionStore((s) => s.contextUsage)
  const currentModel = accountInfo?.model ?? contextUsage?.model
  const { send } = useWebSocket()
  const sessionId = useSessionStore((s) => s.currentSessionId)

  // Show short model name: prefer extracting from models list, fallback to ID parsing
  const hasModels = models.length > 0
  const matchedModel = models.find((m) => m.value === currentModel)
  const displayName = matchedModel
    ? formatDisplayName(matchedModel.displayName, matchedModel.description)
    : formatModelId(currentModel)

  const handleSelect = (model: string) => {
    if (sessionId && sessionId !== '__new__' && model !== currentModel) {
      send({ type: 'set-model', sessionId, model } as any)
      // Optimistically update local state
      useConnectionStore.getState().setAccountInfo({ ...accountInfo, model })
    }
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        onClick={() => hasModels && setOpen(!open)}
        className={`flex items-center gap-1.5 transition-colors ${hasModels ? 'hover:text-[#e5e2db] cursor-pointer' : 'cursor-default'}`}
      >
        <span className="text-[#a8a29e]">{displayName ?? 'Model'}</span>
        {hasModels && <span className="text-[8px] text-[#7c7872]">&#9660;</span>}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 mb-1 w-72 bg-[#242320] border border-[#3d3b37] rounded-lg shadow-xl z-50 overflow-hidden">
            <div className="px-3 pt-2 pb-1">
              <span className="text-[10px] text-[#7c7872] uppercase tracking-wide font-medium">模型</span>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {models.map((m) => {
                const isActive = m.value === currentModel
                return (
                  <button
                    key={m.value}
                    onClick={() => handleSelect(m.value)}
                    className={`w-full flex items-start gap-2 px-3 py-2 text-left transition-colors ${
                      isActive ? 'bg-[#d977061a]' : 'hover:bg-[#3d3b3780]'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className={`text-[12px] font-medium truncate ${isActive ? 'text-[#e5e2db]' : 'text-[#a8a29e]'}`}>
                        {m.displayName}
                      </div>
                      <div className="text-[10px] text-[#7c7872] truncate">{m.description}</div>
                      <div className="flex gap-2 mt-0.5">
                        {m.supportsAutoMode && <span className="text-[9px] text-[#d97706]">Auto</span>}
                        {m.supportedEffortLevels && <span className="text-[9px] text-[#7c7872]">{m.supportedEffortLevels.join('/')}</span>}
                      </div>
                    </div>
                    {isActive && (
                      <svg className="w-3.5 h-3.5 text-[#d97706] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
