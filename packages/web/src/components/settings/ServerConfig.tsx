import { useEffect, useState } from 'react'
import { useServerStore } from '../../stores/serverStore'

export function ServerConfig() {
  const config = useServerStore((s) => s.config)
  const status = useServerStore((s) => s.status)
  const updateConfig = useServerStore((s) => s.updateConfig)
  const fetchConfig = useServerStore((s) => s.fetchConfig)
  const [portValue, setPortValue] = useState<string>('')

  useEffect(() => { fetchConfig() }, [fetchConfig])

  if (!config) return null

  const handlePortBlur = () => {
    const raw = parseInt(portValue || String(config.port))
    if (isNaN(raw)) { setPortValue(''); return }
    const num = Math.max(1, Math.min(65535, raw))
    setPortValue(String(num))
    if (num !== config.port) {
      updateConfig({ port: num })
    }
  }

  const displayPort = portValue !== '' ? portValue : String(config.port)
  // 检测哪些配置项与运行时不同（需要重启）
  const portChanged = status && config.port !== status.port
  return (
    <div className="rounded-lg border p-4" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>服务器配置</span>
        {portChanged && (
          <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--accent)', border: '1px solid rgba(245,158,11,0.2)' }}>
            有变更待重启
          </span>
        )}
      </div>
      <div className="space-y-3">
        {/* 监听端口 */}
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'var(--text-muted)' }}>
            监听端口
            {portChanged && <span className="ml-1.5 text-[9px]" style={{ color: 'var(--accent)' }}>重启生效</span>}
          </span>
          <input type="number" min={1} max={65535} value={displayPort}
            onChange={(e) => setPortValue(e.target.value)}
            onBlur={handlePortBlur} onKeyDown={(e) => { if (e.key === 'Enter') handlePortBlur() }}
            className="w-20 px-2 py-1 rounded border text-right font-mono text-xs"
            style={{ background: 'var(--bg-primary)', borderColor: portChanged ? 'var(--accent)' : 'var(--border)', color: 'var(--text-primary)' }} />
        </div>
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
      </div>
    </div>
  )
}
