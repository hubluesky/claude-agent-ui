import { useState, useRef, useEffect, useCallback } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { fetchSessions } from '../../lib/api'
import type { SessionSummary } from '@claude-agent-ui/shared'

interface HistoryPanelProps {
  onSelect: (sessionId: string) => void
  onClose: () => void
}

const PAGE_SIZE = 20

function relativeTime(isoDate?: string): string {
  if (!isoDate) return ''
  const diff = Date.now() - new Date(isoDate).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天前`
  return `${Math.floor(days / 30)}个月前`
}

export function HistoryPanel({ onSelect, onClose }: HistoryPanelProps) {
  const [search, setSearch] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const { currentProjectCwd, currentSessionId } = useSessionStore()

  // 独立的会话列表状态（不影响 sessionStore）
  const [allSessions, setAllSessions] = useState<SessionSummary[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const loadingRef = useRef(false)

  // 初始加载
  useEffect(() => {
    if (!currentProjectCwd) return
    setLoading(true)
    fetchSessions(currentProjectCwd, { limit: PAGE_SIZE, offset: 0 }).then((res) => {
      setAllSessions(res.sessions)
      setHasMore(res.hasMore)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [currentProjectCwd])

  // 加载更多
  const loadMore = useCallback(async () => {
    if (!currentProjectCwd || !hasMore || loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    try {
      const res = await fetchSessions(currentProjectCwd, {
        limit: PAGE_SIZE,
        offset: allSessions.length,
      })
      setAllSessions((prev) => [...prev, ...res.sessions])
      setHasMore(res.hasMore)
    } catch { /* ignore */ }
    setLoading(false)
    loadingRef.current = false
  }, [currentProjectCwd, hasMore, allSessions.length])

  // 滚动到底部时加载更多
  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (!el || !hasMore || loadingRef.current) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      loadMore()
    }
  }, [hasMore, loadMore])

  // 客户端搜索过滤
  const filtered = allSessions.filter((s) => {
    const title = s.title ?? ''
    if (title === '/clear' || title === 'clear') return false
    return title.toLowerCase().includes(search.toLowerCase())
  })

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Escape 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      ref={panelRef}
      className="absolute top-10 right-2 w-80 bg-[#1c1b18] border border-[#3d3b37] rounded-b-lg shadow-2xl z-50"
    >
      {/* 搜索框 */}
      <div className="p-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索会话..."
          autoFocus
          className="w-full bg-[#2b2a27] border border-[#3d3b37] rounded px-2.5 py-1.5 text-xs text-[#e5e2db] placeholder-[#7c7872] outline-none focus:border-[#d97706]"
        />
      </div>

      {/* 会话列表 */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="max-h-72 overflow-y-auto px-2 pb-2 space-y-0.5"
      >
        {filtered.length === 0 && !loading ? (
          <p className="text-center text-[#7c7872] text-xs py-4">
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
                    ? 'bg-[#d977061a] border-l-2 border-[#d97706]'
                    : 'hover:bg-[#2b2a27]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#e5e2db] truncate flex-1">{s.title || '新会话'}</span>
                  <span className="text-[10px] text-[#7c7872] shrink-0 ml-2">{relativeTime(s.updatedAt)}</span>
                </div>
              </button>
            ))}
            {loading && (
              <p className="text-center text-[#7c7872] text-xs py-2">加载中...</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
