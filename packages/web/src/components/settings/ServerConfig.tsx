import { useState } from 'react'
import { useServerStore } from '../../stores/serverStore'

export function ServerConfig() {
  const config = useServerStore((s) => s.config)
  const updateConfig = useServerStore((s) => s.updateConfig)
  const [portValue, setPortValue] = useState<string>('')
  const [portDirty, setPortDirty] = useState(false)

  if (!config) return null

  const handlePortChange = (val: string) => {
    setPortValue(val)
    setPortDirty(val !== '' && parseInt(val) !== config.port)
  }

  const handlePortBlur = () => {
    const num = parseInt(portValue)
    if (!isNaN(num) && num >= 1 && num <= 65535 && num !== config.port) {
      updateConfig({ port: num })
      setPortDirty(true)
    }
  }

  const displayPort = portValue !== '' ? portValue : String(config.port)

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--accent)' }}>配置</div>
      <div className="p-3 rounded-lg border space-y-3 text-xs" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between">
          <span className="text-[var(--text-muted)]">端口</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={65535}
              value={displayPort}
              onChange={(e) => handlePortChange(e.target.value)}
              onBlur={handlePortBlur}
              onKeyDown={(e) => { if (e.key === 'Enter') handlePortBlur() }}
              className="w-20 px-2 py-0.5 rounded border text-right font-mono text-xs"
              style={{ background: 'var(--bg-primary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
            {portDirty && (
              <span className="text-[10px]" style={{ color: 'var(--accent)' }}>需重启生效</span>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[var(--text-muted)]">开机自启</span>
          <button onClick={() => updateConfig({ autoLaunch: !config.autoLaunch })} className="relative w-9 h-5 rounded-full cursor-pointer transition-colors" style={{ background: config.autoLaunch ? 'var(--accent)' : 'rgba(255,255,255,0.1)' }}>
            <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform" style={{ left: config.autoLaunch ? '18px' : '2px' }} />
          </button>
        </div>
        {config.hasSourceCode && (
          <div className="flex items-center justify-between">
            <span className="text-[var(--text-muted)]">运行模式</span>
            <div className="flex gap-1">
              {(['prod', 'dev'] as const).map((mode) => (
                <button key={mode} onClick={() => updateConfig({ mode })} className="px-2 py-0.5 rounded text-[10px] border cursor-pointer" style={{ background: config.mode === mode ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.04)', borderColor: config.mode === mode ? 'rgba(245,158,11,0.3)' : 'var(--border)', color: config.mode === mode ? 'var(--accent)' : 'var(--text-muted)' }}>
                  {mode === 'dev' ? '开发' : '生产'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
