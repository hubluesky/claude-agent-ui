import { useServerStore } from '../../stores/serverStore'

/** 从 userAgent 字符串解析出浏览器简称 */
function parseBrowser(ua: string | null): string {
  if (!ua) return '未知'
  if (ua.includes('Edg/')) return 'Edge'
  if (ua.includes('Firefox/')) return 'Firefox'
  if (ua.includes('Safari/') && !ua.includes('Chrome/')) return 'Safari'
  if (ua.includes('Chrome/')) return 'Chrome'
  if (ua.includes('Opera/') || ua.includes('OPR/')) return 'Opera'
  return '浏览器'
}

/** 从 userAgent 解析出操作系统简称 */
function parseOS(ua: string | null): string {
  if (!ua) return ''
  if (ua.includes('Windows')) return 'Win'
  if (ua.includes('Mac OS X') || ua.includes('Macintosh')) return 'Mac'
  if (ua.includes('Linux')) return 'Linux'
  if (ua.includes('Android')) return 'Android'
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS'
  return ''
}

/** 格式化连接时间为相对时间 */
function formatConnTime(connectedAt: string): string {
  const diff = Math.floor((Date.now() - new Date(connectedAt).getTime()) / 1000)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  return `${Math.floor(diff / 3600)}h${Math.floor((diff % 3600) / 60)}m`
}

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
        ) : connections.map((conn, i) => {
          const browser = parseBrowser(conn.userAgent)
          const os = parseOS(conn.userAgent)
          const client = os ? `${browser} · ${os}` : browser

          return (
            <div key={conn.connectionId} className="flex items-center justify-between px-3 py-1.5" style={{ borderBottom: i < connections.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div className="flex items-center gap-2">
                <span style={{ color: 'var(--text-primary)' }}>{client}</span>
                {conn.projectName && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(59,130,246,0.08)', color: '#60a5fa' }}>
                    {conn.projectName}
                  </span>
                )}
                {conn.ip && conn.ip !== '127.0.0.1' && conn.ip !== '::1' && (
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{conn.ip}</span>
                )}
                {conn.hasLock && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--accent)' }}>锁定中</span>
                )}
              </div>
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {formatConnTime(conn.connectedAt)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
