import { useServerStore } from '../../stores/serverStore'

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

export function ServerStatusCard() {
  const status = useServerStore((s) => s.status)
  const restart = useServerStore((s) => s.restart)

  if (!status) return <div className="text-[var(--text-muted)] text-sm">加载中...</div>

  return (
    <div className="p-4 rounded-lg border" style={{ background: status.status === 'running' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', borderColor: status.status === 'running' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)' }}>
      <div className="flex justify-between items-center">
        <div>
          <span className="font-semibold" style={{ color: status.status === 'running' ? 'var(--success)' : 'var(--error)' }}>
            {status.status === 'running' ? '● 运行中' : '○ 已停止'}
          </span>
          <span className="ml-3 text-[var(--text-muted)] text-xs">
            端口 {status.port} · 上线 {formatUptime(status.uptime)} · PID {status.pid}
          </span>
        </div>
        <button onClick={restart} className="px-3 py-1 text-xs rounded-md border cursor-pointer" style={{ background: 'rgba(59,130,246,0.15)', borderColor: 'rgba(59,130,246,0.25)', color: '#60a5fa' }}>
          重启
        </button>
      </div>
      <div className="mt-1 text-xs text-[var(--text-muted)]">
        模式: {status.mode === 'dev' ? '开发' : '生产'} · 连接数: {status.connections.length}
      </div>
    </div>
  )
}
