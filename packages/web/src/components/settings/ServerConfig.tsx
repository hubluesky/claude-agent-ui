import { useEffect, useState } from 'react'
import { useServerStore } from '../../stores/serverStore'

export function ServerConfig() {
  const config = useServerStore((s) => s.config)
  const updateConfig = useServerStore((s) => s.updateConfig)
  const fetchConfig = useServerStore((s) => s.fetchConfig)
  const [portValue, setPortValue] = useState<string>('')
  const [portDirty, setPortDirty] = useState(false)

  useEffect(() => { fetchConfig() }, [fetchConfig])

  if (!config) return null

  const handlePortBlur = () => {
    const num = parseInt(portValue || String(config.port))
    if (!isNaN(num) && num >= 1 && num <= 65535 && num !== config.port) {
      updateConfig({ port: num })
      setPortDirty(true)
    }
  }

  const displayPort = portValue !== '' ? portValue : String(config.port)

  return (
    <div className="rounded-lg border p-4" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>服务器配置</div>
      <div className="space-y-3">
        {/* 监听端口 */}
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'var(--text-muted)' }}>监听端口</span>
          <div className="flex items-center gap-2">
            <input type="number" min={1} max={65535} value={displayPort}
              onChange={(e) => { setPortValue(e.target.value); setPortDirty(e.target.value !== '' && parseInt(e.target.value) !== config.port) }}
              onBlur={handlePortBlur} onKeyDown={(e) => { if (e.key === 'Enter') handlePortBlur() }}
              className="w-20 px-2 py-1 rounded border text-right font-mono text-xs"
              style={{ background: 'var(--bg-primary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
            {portDirty && <span className="text-[9px]" style={{ color: 'var(--accent)' }}>重启生效</span>}
          </div>
        </div>
        {/* 分隔线 */}
        <div className="border-t" style={{ borderColor: 'var(--border)' }} />
        {/* 开机自启 */}
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'var(--text-muted)' }}>开机自启</span>
          <button onClick={() => updateConfig({ autoLaunch: !config.autoLaunch })}
            className="relative w-8 h-[18px] rounded-full cursor-pointer transition-colors"
            style={{ background: config.autoLaunch ? 'var(--accent)' : 'rgba(255,255,255,0.1)' }}>
            <span className="absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform" style={{ left: config.autoLaunch ? '15px' : '2px' }} />
          </button>
        </div>
        {/* 运行模式 */}
        {config.hasSourceCode && (
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: 'var(--text-muted)' }}>运行模式</span>
            <div className="flex">
              {(['prod', 'dev'] as const).map((mode) => (
                <button key={mode} onClick={() => { if (mode !== config.mode) updateConfig({ mode }) }}
                  className="px-3 py-1 text-[10px] border cursor-pointer transition-colors first:rounded-l last:rounded-r"
                  style={{ background: config.mode === mode ? 'rgba(245,158,11,0.15)' : 'transparent', borderColor: config.mode === mode ? 'rgba(245,158,11,0.3)' : 'var(--border)', color: config.mode === mode ? 'var(--accent)' : 'var(--text-muted)' }}>
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
