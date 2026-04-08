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
      <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>配置</div>
      <div className="rounded-lg border text-xs divide-y divide-[var(--border)]" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        {/* 端口 */}
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-[var(--text-muted)]">端口</span>
          <div className="flex items-center gap-1.5">
            <input
              type="number" min={1} max={65535}
              value={displayPort}
              onChange={(e) => handlePortChange(e.target.value)}
              onBlur={handlePortBlur}
              onKeyDown={(e) => { if (e.key === 'Enter') handlePortBlur() }}
              className="w-16 px-1.5 py-0.5 rounded border text-right font-mono text-[11px]"
              style={{ background: 'var(--bg-primary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
            {portDirty && <span className="text-[9px]" style={{ color: 'var(--accent)' }}>重启生效</span>}
          </div>
        </div>
        {/* 开机自启 */}
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-[var(--text-muted)]">开机自启</span>
          <button
            onClick={() => updateConfig({ autoLaunch: !config.autoLaunch })}
            className="relative w-8 h-[18px] rounded-full cursor-pointer transition-colors"
            style={{ background: config.autoLaunch ? 'var(--accent)' : 'rgba(255,255,255,0.1)' }}
          >
            <span
              className="absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform"
              style={{ left: config.autoLaunch ? '15px' : '2px' }}
            />
          </button>
        </div>
        {/* 运行模式 */}
        {config.hasSourceCode && (
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[var(--text-muted)]">模式</span>
            <div className="flex">
              {(['prod', 'dev'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => updateConfig({ mode })}
                  className="px-2 py-0.5 text-[10px] border cursor-pointer transition-colors first:rounded-l last:rounded-r"
                  style={{
                    background: config.mode === mode ? 'rgba(245,158,11,0.15)' : 'transparent',
                    borderColor: config.mode === mode ? 'rgba(245,158,11,0.3)' : 'var(--border)',
                    color: config.mode === mode ? 'var(--accent)' : 'var(--text-muted)',
                  }}
                >
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
