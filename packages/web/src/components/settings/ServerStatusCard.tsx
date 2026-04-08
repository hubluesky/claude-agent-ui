import { useServerStore } from '../../stores/serverStore'

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h${m}m`
}

const MODE_LABEL = { dev: '开发', prod: '生产' } as const

export function ServerStatusCard() {
  const status = useServerStore((s) => s.status)
  const config = useServerStore((s) => s.config)
  const restart = useServerStore((s) => s.restart)

  if (!status) return null

  const running = status.status === 'running'
  const pendingMode = config && config.mode !== status.mode ? config.mode : null

  return (
    <div className="rounded-lg border px-4 py-3 flex items-center justify-between" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-3 text-xs flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: running ? 'var(--success)' : 'var(--error)', boxShadow: running ? '0 0 6px rgba(34,197,94,0.4)' : 'none' }} />
          <span className="font-semibold" style={{ color: running ? 'var(--success)' : 'var(--error)' }}>
            {running ? '运行中' : '已停止'}
          </span>
        </div>
        <span className="text-[var(--text-muted)]">端口 <b className="text-[var(--text-primary)]">{status.port}</b></span>
        <span className="text-[var(--text-muted)]">上线 <b className="text-[var(--text-primary)]">{formatUptime(status.uptime)}</b></span>
        <span className="text-[var(--text-muted)]">PID <b className="text-[var(--text-primary)]">{status.pid}</b></span>
        <span className="text-[var(--text-muted)]">
          模式 <b className="text-[var(--text-primary)]">{MODE_LABEL[status.mode]}</b>
          {pendingMode && (
            <span className="ml-1 text-[10px]" style={{ color: 'var(--accent)' }}>
              → {MODE_LABEL[pendingMode]}（重启生效）
            </span>
          )}
        </span>
        <span className="text-[var(--text-muted)]">连接 <b className="text-[var(--text-primary)]">{status.connections.length}</b></span>
      </div>
      <button onClick={restart}
        className="px-3 py-1 text-[11px] rounded border cursor-pointer transition-colors hover:opacity-80 shrink-0"
        style={{ background: pendingMode ? 'rgba(245,158,11,0.12)' : 'rgba(59,130,246,0.08)', borderColor: pendingMode ? 'rgba(245,158,11,0.3)' : 'rgba(59,130,246,0.2)', color: pendingMode ? 'var(--accent)' : '#60a5fa' }}>
        {pendingMode ? '重启以生效' : '重启'}
      </button>
    </div>
  )
}
