import { useConnectionStore } from '../../stores/connectionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { ModelSelector } from './ModelSelector'

const MODE_LABELS: Record<string, { label: string; color: string }> = {
  default: { label: 'Default', color: '#a8a29e' },
  acceptEdits: { label: 'Accept Edits', color: '#60a5fa' },
  auto: { label: 'Auto', color: '#d97706' },
  plan: { label: 'Plan', color: '#a78bfa' },
  bypassPermissions: { label: 'Bypass', color: '#f87171' },
  dontAsk: { label: "Don't Ask", color: '#7c7872' },
}

export function StatusBar() {
  const accountInfo = useConnectionStore((s) => s.accountInfo)
  const connectionStatus = useConnectionStore((s) => s.connectionStatus)
  const permissionMode = useSettingsStore((s) => s.permissionMode)

  const mode = MODE_LABELS[permissionMode] ?? MODE_LABELS.default
  const isConnected = connectionStatus === 'connected'

  return (
    <div className="flex items-center gap-3 px-3 py-1 bg-[#1e1d1a] border-t border-[#3d3b37] text-[11px] text-[#7c7872] shrink-0 select-none">
      {/* Connection indicator + model selector */}
      <div className="flex items-center gap-1.5">
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: isConnected ? '#3fb950' : '#f87171' }}
        />
        <ModelSelector />
      </div>

      {/* Separator */}
      <span className="w-px h-3 bg-[#3d3b37]" />

      {/* Account info */}
      {accountInfo?.email && (
        <>
          <span>{accountInfo.email}</span>
          {accountInfo.organization && (
            <>
              <span className="text-[#3d3b37]">/</span>
              <span>{accountInfo.organization}</span>
            </>
          )}
          {accountInfo.subscriptionType && (
            <span className="px-1.5 py-0.5 rounded bg-[#242320] text-[10px]">
              {accountInfo.subscriptionType}
            </span>
          )}
          <span className="w-px h-3 bg-[#3d3b37]" />
        </>
      )}

      {/* Spacer */}
      <span className="flex-1" />

      {/* Permission mode */}
      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ color: mode.color, background: `${mode.color}1a` }}>
        {mode.label}
      </span>
    </div>
  )
}
