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
            <span className="font-mono" style={{ color: 'var(--text-muted)' }}>{conn.connectionId.slice(0, 8)}</span>
            <div className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
              {conn.hasLock && <span style={{ color: 'var(--accent)' }}>&#9679;</span>}
              <span className="text-[10px]">{conn.sessionId ? conn.sessionId.slice(0, 8) : '空闲'}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
