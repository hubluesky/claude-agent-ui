import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { fetchSessions } from '../../lib/api'
import { relativeTime, isVisibleSession } from '../../lib/time'
import type { SessionSummary } from '@claude-agent-ui/shared'

interface HistoryPanelProps {
  onSelect: (sessionId: string) => void
  onClose: () => void
}

const PAGE_SIZE = 20

export function HistoryPanel({ onSelect, onClose }: HistoryPanelProps) {
  const [search, setSearch] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const currentProjectCwd = useSessionStore((s) => s.currentProjectCwd)
  const currentSessionId = useSessionStore((s) => s.currentSessionId)

  const [allSessions, setAllSessions] = useState<SessionSummary[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const loadingRef = useRef(false)
  const offsetRef = useRef(0)

  useEffect(() => {
    if (!currentProjectCwd) return
    setLoading(true)
    offsetRef.current = 0
    fetchSessions(currentProjectCwd, { limit: PAGE_SIZE, offset: 0 }).then((res) => {
      setAllSessions(res.sessions)
      setHasMore(res.hasMore)
      offsetRef.current = res.sessions.length
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [currentProjectCwd])

  const loadMore = useCallback(async () => {
    if (!currentProjectCwd || loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    try {
      const res = await fetchSessions(currentProjectCwd, {
        limit: PAGE_SIZE,
        offset: offsetRef.current,
      })
      setAllSessions((prev) => [...prev, ...res.sessions])
      setHasMore(res.hasMore)
      offsetRef.current += res.sessions.length
    } catch { /* ignore */ }
    setLoading(false)
    loadingRef.current = false
  }, [currentProjectCwd])

  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (!el || !hasMore || loadingRef.current) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      loadMore()
    }
  }, [hasMore, loadMore])

  const filtered = useMemo(() => {
    const lowerSearch = search.toLowerCase()
    return allSessions.filter((s) => {
      if (!isVisibleSession(s.title)) return false
      return (s.title ?? '').toLowerCase().includes(lowerSearch)
    })
  }, [allSessions, search])

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onCloseRef.current()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  return (
    <div
      ref={panelRef}
      className="absolute top-10 right-2 w-80 bg-[var(--bg-primary)] border border-[var(--border)] rounded-b-lg shadow-2xl z-50"
    >
      <div className="p-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索会话..."
          autoFocus
          className="w-full bg-[var(--bg-hover)] border border-[var(--border)] rounded px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
        />
      </div>

      <div
        ref={listRef}
        onScroll={handleScroll}
        className="max-h-72 overflow-y-auto px-2 pb-2 space-y-0.5"
      >
        {filtered.length === 0 && !loading ? (
          <p className="text-center text-[var(--text-muted)] text-xs py-4">
            {search ? '没有匹配的会话' : '暂无会话'}
          </p>
        ) : (
          <>
            {filtered.map((s) => (
              <button
                key={s.sessionId}
                onClick={() => onSelect(s.sessionId)}
                className={`w-full text-left px-2.5 py-2 rounded-md transition-colors ${
                  currentSessionId === s.sessionId
                    ? 'bg-[#d977061a] border-l-2 border-[var(--accent)]'
                    : 'hover:bg-[var(--bg-hover)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-primary)] truncate flex-1">{s.title || '新会话'}</span>
                  <span className="text-[10px] text-[var(--text-muted)] shrink-0 ml-2">{relativeTime(s.updatedAt)}</span>
                </div>
              </button>
            ))}
            {loading && (
              <p className="text-center text-[var(--text-muted)] text-xs py-2">加载中...</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
