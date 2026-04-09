import { useState, useEffect, useRef, useCallback } from 'react'
import { useChatSession } from '../../providers/ChatSessionContext'

/** Global search state — shared between SearchBar and MessageComponent */
let _searchQuery = ''
let _listeners: (() => void)[] = []

export function getSearchQuery() { return _searchQuery }

function setSearchQuery(q: string) {
  _searchQuery = q
  _listeners.forEach((l) => l())
}

export function useSearchQuery() {
  const [, forceUpdate] = useState(0)
  useEffect(() => {
    const listener = () => forceUpdate((n) => n + 1)
    _listeners.push(listener)
    return () => { _listeners = _listeners.filter((l) => l !== listener) }
  }, [])
  return _searchQuery
}

export function SearchBar({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState(_searchQuery)
  const inputRef = useRef<HTMLInputElement>(null)
  const { messages } = useChatSession()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const matchCount = query
    ? messages.filter((m) => {
      const text = extractText(m)
      return text.toLowerCase().includes(query.toLowerCase())
    }).length
    : 0

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setQuery(v)
    setSearchQuery(v)
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setSearchQuery('')
      onClose()
    }
  }

  const handleClose = () => {
    setSearchQuery('')
    onClose()
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
      <svg className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        placeholder="Search messages..."
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className="flex-1 bg-transparent text-xs text-[var(--text-primary)] placeholder-[var(--text-dim)] outline-none"
      />
      {query && (
        <span className="text-[10px] text-[var(--text-muted)] tabular-nums shrink-0">
          {matchCount} match{matchCount !== 1 ? 'es' : ''}
        </span>
      )}
      <button onClick={handleClose} className="text-[var(--text-dim)] hover:text-[var(--text-secondary)] cursor-pointer">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  )
}

/** Extract searchable text from a message */
function extractText(msg: any): string {
  if (msg.type === 'user' || msg.type === 'assistant') {
    const content = msg.message?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .filter((b: any) => b.type === 'text' || b.type === 'thinking')
        .map((b: any) => b.text ?? b.thinking ?? '')
        .join(' ')
    }
  }
  if (msg.type === 'tool_progress') return msg.content ?? ''
  return ''
}

/** Highlight search matches in text */
export function HighlightText({ text, className }: { text: string; className?: string }) {
  const query = useSearchQuery()
  if (!query || !text) return <span className={className}>{text}</span>

  const parts: { text: string; match: boolean }[] = []
  const lower = text.toLowerCase()
  const qLower = query.toLowerCase()
  let lastIndex = 0

  let idx = lower.indexOf(qLower)
  while (idx !== -1) {
    if (idx > lastIndex) parts.push({ text: text.slice(lastIndex, idx), match: false })
    parts.push({ text: text.slice(idx, idx + query.length), match: true })
    lastIndex = idx + query.length
    idx = lower.indexOf(qLower, lastIndex)
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex), match: false })

  if (parts.length === 0) return <span className={className}>{text}</span>

  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.match
          ? <mark key={i} className="bg-[var(--accent)] text-[var(--bg-primary)] rounded-sm px-0.5">{p.text}</mark>
          : <span key={i}>{p.text}</span>
      )}
    </span>
  )
}
