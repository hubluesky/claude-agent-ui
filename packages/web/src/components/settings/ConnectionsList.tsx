import { useServerStore } from '../../stores/serverStore'

export function ConnectionsList() {
  const status = useServerStore((s) => s.status)
  const connections = status?.connections ?? []

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--accent)' }}>活跃连接</div>
      {connections.length === 0 ? (
        <div className="text-xs text-[var(--text-muted)]">无连接</div>
      ) : (
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          {connections.map((conn, i) => (
            <div key={conn.connectionId} className="flex justify-between px-3 py-2 text-xs" style={{ background: 'var(--bg-secondary)', borderBottom: i < connections.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <span>{conn.connectionId.slice(0, 8)}</span>
              <span className="text-[var(--text-muted)]">
                {conn.sessionId ? `会话 ${conn.sessionId.slice(0, 12)}...` : '未加入会话'}
                {conn.hasLock && <span className="ml-2" style={{ color: 'var(--accent)' }}>🔒 持有锁</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
