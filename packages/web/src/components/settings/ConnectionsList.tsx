import { useServerStore } from '../../stores/serverStore'

export function ConnectionsList() {
  const status = useServerStore((s) => s.status)
  const connections = status?.connections ?? []

  return (
    <div className="rounded-lg border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          连接 <span style={{ color: 'var(--accent)' }}>{connections.length}</span>
        </span>
      </div>
      <div className="text-[11px]">
        {connections.length === 0 ? (
          <div className="px-3 py-3 text-center" style={{ color: 'var(--text-muted)' }}>无连接</div>
        ) : connections.map((conn, i) => (
          <div key={conn.connectionId} className="flex items-center justify-between px-3 py-1.5" style={{ borderBottom: i < connections.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <div className="flex items-center gap-2">
              <span style={{ color: 'var(--text-muted)' }}>客户端 {i + 1}</span>
              {conn.hasLock && (
                <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--accent)' }}>锁定中</span>
              )}
            </div>
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {conn.sessionId ? '会话中' : '空闲'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
