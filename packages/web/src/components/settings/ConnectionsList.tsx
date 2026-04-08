import { useServerStore } from '../../stores/serverStore'

export function ConnectionsList() {
  const status = useServerStore((s) => s.status)
  const connections = status?.connections ?? []

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
        连接 <span style={{ color: 'var(--accent)' }}>{connections.length}</span>
      </div>
      <div className="rounded-lg border overflow-hidden text-[11px]" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        {connections.length === 0 ? (
          <div className="px-3 py-2 text-[var(--text-muted)]">无连接</div>
        ) : connections.map((conn, i) => (
          <div
            key={conn.connectionId}
            className="flex items-center justify-between px-3 py-1.5"
            style={{ borderBottom: i < connections.length - 1 ? '1px solid var(--border)' : 'none' }}
          >
            <span className="font-mono text-[var(--text-muted)]">{conn.connectionId.slice(0, 8)}</span>
            <div className="flex items-center gap-1.5">
              {conn.hasLock && (
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ color: 'var(--accent)' }}>
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              )}
              <span className="text-[var(--text-muted)]">
                {conn.sessionId ? conn.sessionId.slice(0, 8) : '空闲'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
