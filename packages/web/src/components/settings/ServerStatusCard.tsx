import { useServerStore } from '../../stores/serverStore'

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h${m}m`
}

export function ServerStatusCard() {
  const status = useServerStore((s) => s.status)
  const restart = useServerStore((s) => s.restart)

  if (!status) return <div className="text-[var(--text-muted)] text-xs">加载中...</div>

  const running = status.status === 'running'

  return (
    <div
      className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg border"
      style={{
        background: running ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
        borderColor: running ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
      }}
    >
      <div className="flex items-center gap-4 text-xs">
        {/* 状态指示 */}
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ background: running ? 'var(--success)' : 'var(--error)' }} />
          <span className="font-semibold" style={{ color: running ? 'var(--success)' : 'var(--error)' }}>
            {running ? '运行中' : '已停止'}
          </span>
        </div>
        {/* 信息标签 */}
        <div className="flex items-center gap-3 text-[var(--text-muted)]">
          <span className="font-mono">:{status.port}</span>
          <span className="w-px h-3 bg-[var(--border)]" />
          <span>{formatUptime(status.uptime)}</span>
          <span className="w-px h-3 bg-[var(--border)]" />
          <span>PID {status.pid}</span>
          <span className="w-px h-3 bg-[var(--border)]" />
          <span>{status.mode === 'dev' ? '开发' : '生产'}</span>
          <span className="w-px h-3 bg-[var(--border)]" />
          <span>{status.connections.length} 连接</span>
        </div>
      </div>
      <button
        onClick={restart}
        className="px-3 py-1 text-[11px] rounded border cursor-pointer transition-colors hover:opacity-80"
        style={{ background: 'rgba(59,130,246,0.1)', borderColor: 'rgba(59,130,246,0.2)', color: '#60a5fa' }}
      >
        重启
      </button>
    </div>
  )
}
