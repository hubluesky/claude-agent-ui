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
    <div>
      <div className="flex justify-between items-center mb-2">
        <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>实时日志</div>
        <button onClick={clearLogs} className="text-[10px] text-[var(--text-muted)] cursor-pointer hover:underline">清除</button>
      </div>
      <div className="p-3 rounded-lg border font-mono text-[11px] leading-relaxed overflow-y-auto" style={{ background: '#111', borderColor: 'var(--border)', maxHeight: '200px' }}>
        {logs.length === 0 && <div className="text-[var(--text-muted)]">暂无日志</div>}
        {logs.map((entry, i) => (
          <div key={i}>
            <span className="opacity-40">{new Date(entry.timestamp).toLocaleTimeString()}</span>{' '}
            <span style={{ color: LEVEL_COLORS[entry.level] ?? '#fff' }}>{entry.level.toUpperCase()}</span>{' '}
            <span style={{ color: CATEGORY_COLORS[entry.category] ?? '#fff' }}>[{entry.category}]</span>{' '}
            {entry.message}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
