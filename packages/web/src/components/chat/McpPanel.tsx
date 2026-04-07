import { useEffect, useState } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useWebSocket } from '../../hooks/useWebSocket'

const STATUS_STYLES: Record<string, { color: string; label: string }> = {
  connected: { color: '#3fb950', label: 'connected' },
  failed: { color: '#f87171', label: 'failed' },
  'needs-auth': { color: '#f59e0b', label: 'needs-auth' },
  pending: { color: '#60a5fa', label: 'connecting...' },
  disabled: { color: '#5c5952', label: 'disabled' },
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
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div className="w-[28rem] max-w-[calc(100vw-2rem)] max-h-[80vh] bg-[#242320] border border-[#3d3b37] rounded-lg shadow-2xl overflow-hidden pointer-events-auto flex flex-col">
        {/* Header */}
        <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-[#3d3b37] shrink-0">
          <span className="text-sm font-semibold text-[#d97706]">MCP Servers</span>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-[#5c5952]">{servers.length} servers</span>
            <button onClick={onClose} className="text-[#5c5952] hover:text-[#a8a29e] cursor-pointer">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        {servers.length === 0 ? (
          <div className="px-5 py-4 text-xs text-[#5c5952]">No MCP servers configured</div>
        ) : (
          <div className="pb-2 overflow-y-auto">
            {servers.map((srv, i) => {
              const style = STATUS_STYLES[srv.status] ?? STATUS_STYLES.disabled
              const isEnabled = srv.status !== 'disabled'
              const isConnected = srv.status === 'connected'
              const isFailed = srv.status === 'failed'
              const needsAuth = srv.status === 'needs-auth'

              return (
                <div key={srv.name} className={`px-4 py-3 ${i > 0 ? 'border-t border-[#3d3b3780]' : ''}`}>
                  {/* Name + status */}
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: style.color }} />
                      <span className="text-[13px] font-medium truncate" style={{ color: isEnabled ? style.color : '#5c5952' }}>
                        {srv.name}
                      </span>
                    </div>
                    <span className="text-[11px] shrink-0 ml-2" style={{ color: style.color }}>
                      {style.label}
                    </span>
                  </div>

                  {/* Server info */}
                  {srv.serverInfo && (
                    <div className="text-[10px] text-[#7c7872] ml-4 mb-1">
                      {srv.serverInfo.name} v{srv.serverInfo.version}
                    </div>
                  )}

                  {/* Error message */}
                  {srv.error && (
                    <div className="text-[11px] text-[#f87171] ml-4 mb-1.5">{srv.error}</div>
                  )}

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 ml-4 mt-1.5">
                    {isConnected && (
                      <>
                        <button
                          onClick={() => handleToggle(srv.name, true)}
                          className="px-2.5 py-1 text-[11px] text-[#a8a29e] border border-[#3d3b37] rounded hover:bg-[#1e1d1a] cursor-pointer transition-colors"
                        >
                          Disable
                        </button>
                        <button
                          onClick={() => handleReconnect(srv.name)}
                          className="px-2.5 py-1 text-[11px] text-[#a8a29e] border border-[#3d3b37] rounded hover:bg-[#1e1d1a] cursor-pointer transition-colors"
                        >
                          Reconnect
                        </button>
                      </>
                    )}
                    {isFailed && (
                      <button
                        onClick={() => handleReconnect(srv.name)}
                        className="px-2.5 py-1 text-[11px] text-[#3fb950] border border-[#3fb95040] rounded hover:bg-[#3fb9500a] cursor-pointer transition-colors"
                      >
                        Reconnect
                      </button>
                    )}
                    {needsAuth && (
                      <button
                        onClick={() => handleReconnect(srv.name)}
                        className="px-2.5 py-1 text-[11px] text-[#f59e0b] border border-[#f59e0b40] rounded hover:bg-[#f59e0b0a] cursor-pointer transition-colors"
                      >
                        Authenticate
                      </button>
                    )}
                    {!isEnabled && (
                      <button
                        onClick={() => handleToggle(srv.name, false)}
                        className="px-2.5 py-1 text-[11px] text-[#a8a29e] border border-[#3d3b37] rounded hover:bg-[#1e1d1a] cursor-pointer transition-colors"
                      >
                        Enable
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        </div>
      </div>
    </>
  )
}

/** Compact MCP indicator for StatusBar — always visible, fetches on mount */
export function McpIndicator() {
  const [open, setOpen] = useState(false)
  const servers = useConnectionStore((s) => s.mcpServers)
  const sessionId = useSessionStore((s) => s.currentSessionId)
  const { getMcpStatus } = useWebSocket()

  // Fetch MCP status on mount / session change
  useEffect(() => {
    if (sessionId && sessionId !== '__new__') {
      getMcpStatus(sessionId)
    }
  }, [sessionId])

  const connectedCount = servers.filter((s) => s.status === 'connected').length
  const failedCount = servers.filter((s) => s.status === 'failed' || s.status === 'needs-auth').length
  const hasServers = servers.length > 0
  const color = !hasServers ? '#5c5952' : failedCount > 0 ? '#f87171' : '#3fb950'

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
          {hasServers ? `${connectedCount}/${servers.length}` : 'MCP'}
        </span>
      </button>
      {open && <McpPanel onClose={() => setOpen(false)} />}
    </div>
  )
}
