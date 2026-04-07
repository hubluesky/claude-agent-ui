import { useEffect, useState } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useWebSocket } from '../../hooks/useWebSocket'

const STATUS_STYLES: Record<string, { color: string; label: string }> = {
  connected: { color: '#3fb950', label: 'Connected' },
  failed: { color: '#f87171', label: 'Failed' },
  'needs-auth': { color: '#f59e0b', label: 'Auth Required' },
  pending: { color: '#60a5fa', label: 'Connecting...' },
  disabled: { color: '#5c5952', label: 'Disabled' },
}

export function McpPanel({ onClose }: { onClose: () => void }) {
  const servers = useConnectionStore((s) => s.mcpServers)
  const sessionId = useSessionStore((s) => s.currentSessionId)
  const { getMcpStatus, toggleMcpServer, reconnectMcpServer } = useWebSocket()

  useEffect(() => {
    if (sessionId && sessionId !== '__new__') {
      getMcpStatus(sessionId)
    }
  }, [sessionId])

  const handleToggle = (name: string, currentEnabled: boolean) => {
    if (sessionId && sessionId !== '__new__') {
      toggleMcpServer(sessionId, name, !currentEnabled)
    }
  }

  const handleReconnect = (name: string) => {
    if (sessionId && sessionId !== '__new__') {
      reconnectMcpServer(sessionId, name)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute bottom-full right-0 mb-1 w-80 bg-[#242320] border border-[#3d3b37] rounded-lg shadow-xl z-50 overflow-hidden">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-[#7c7872] uppercase tracking-wide">MCP Servers</span>
          <button onClick={onClose} className="text-[#5c5952] hover:text-[#a8a29e] cursor-pointer">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {servers.length === 0 ? (
          <div className="px-4 pb-3 text-xs text-[#5c5952]">No MCP servers configured</div>
        ) : (
          <div className="pb-2 max-h-60 overflow-y-auto">
            {servers.map((srv) => {
              const style = STATUS_STYLES[srv.status] ?? STATUS_STYLES.disabled
              const isEnabled = srv.status !== 'disabled'
              return (
                <div key={srv.name} className="px-4 py-2 hover:bg-[#1e1d1a] flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: style.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-[#e5e2db] truncate">{srv.name}</div>
                    <div className="text-[10px] truncate" style={{ color: style.color }}>
                      {style.label}
                      {srv.serverInfo && ` · ${srv.serverInfo.name} v${srv.serverInfo.version}`}
                    </div>
                    {srv.error && (
                      <div className="text-[10px] text-[#f87171] truncate mt-0.5">{srv.error}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {(srv.status === 'failed' || srv.status === 'needs-auth') && (
                      <button
                        onClick={() => handleReconnect(srv.name)}
                        className="px-1.5 py-0.5 text-[10px] text-[#60a5fa] bg-[#60a5fa0a] border border-[#60a5fa26] rounded hover:bg-[#60a5fa1a] cursor-pointer"
                        title="Reconnect"
                      >
                        Retry
                      </button>
                    )}
                    <button
                      onClick={() => handleToggle(srv.name, isEnabled)}
                      className={`px-1.5 py-0.5 text-[10px] rounded border cursor-pointer ${
                        isEnabled
                          ? 'text-[#f87171] bg-[#f871710a] border-[#f8717126] hover:bg-[#f871711a]'
                          : 'text-[#3fb950] bg-[#3fb9500a] border-[#3fb95026] hover:bg-[#3fb9501a]'
                      }`}
                    >
                      {isEnabled ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

/** Compact MCP indicator for StatusBar */
export function McpIndicator() {
  const [open, setOpen] = useState(false)
  const servers = useConnectionStore((s) => s.mcpServers)

  const connectedCount = servers.filter((s) => s.status === 'connected').length
  const failedCount = servers.filter((s) => s.status === 'failed' || s.status === 'needs-auth').length

  if (servers.length === 0) return null

  const color = failedCount > 0 ? '#f87171' : '#3fb950'

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[#242320] transition-colors cursor-pointer"
        title="MCP Servers"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
        </svg>
        <span className="text-[10px] tabular-nums" style={{ color }}>
          {connectedCount}/{servers.length}
        </span>
      </button>
      {open && <McpPanel onClose={() => setOpen(false)} />}
    </div>
  )
}
