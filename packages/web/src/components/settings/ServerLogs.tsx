import { useEffect, useRef } from 'react'
import { useServerStore } from '../../stores/serverStore'

const LEVEL_COLORS: Record<string, string> = { info: '#22c55e', warn: '#eab308', error: '#ef4444', debug: '#6b7280' }
const CATEGORY_COLORS: Record<string, string> = { server: '#22c55e', connection: '#3b82f6', session: '#a855f7', sdk: '#f59e0b' }

export function ServerLogs() {
  const logs = useServerStore((s) => s.logs)
  const addLog = useServerStore((s) => s.addLog)
  const clearLogs = useServerStore((s) => s.clearLogs)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/server/logs', { signal: controller.signal }).then(async (res) => {
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) return
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try { addLog(JSON.parse(line.slice(6))) } catch { /* ignore */ }
          }
        }
      }
    }).catch(() => { /* aborted */ })
    return () => controller.abort()
  }, [addLog])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [logs.length])

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex justify-between items-center mb-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          日志 <span style={{ color: 'var(--accent)' }}>{logs.length}</span>
        </div>
        <button onClick={clearLogs} className="text-[10px] text-[var(--text-muted)] cursor-pointer hover:underline transition-colors">清除</button>
      </div>
      <div
        className="flex-1 p-2.5 rounded-lg border font-mono text-[10px] leading-[1.7] overflow-y-auto"
        style={{ background: 'rgba(0,0,0,0.3)', borderColor: 'var(--border)', maxHeight: '240px', minHeight: '120px' }}
      >
        {logs.length === 0 && <div className="text-[var(--text-muted)] py-2 text-center">暂无日志</div>}
        {logs.map((entry, i) => (
          <div key={i} className="hover:bg-white/[0.02] px-1 rounded">
            <span className="opacity-30 select-none">{new Date(entry.timestamp).toLocaleTimeString()}</span>{' '}
            <span style={{ color: LEVEL_COLORS[entry.level] ?? '#888' }}>{entry.level.toUpperCase().padEnd(5)}</span>{' '}
            <span style={{ color: CATEGORY_COLORS[entry.category] ?? '#888' }}>[{entry.category}]</span>{' '}
            <span style={{ color: 'var(--text-primary)' }}>{entry.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
