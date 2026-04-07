export function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-3 px-4">
      <div className="w-7 h-7 rounded-full bg-[var(--bg-secondary)] border border-[var(--border)] flex items-center justify-center">
        <span className="text-xs font-bold font-mono text-[var(--accent)]">C</span>
      </div>
      <span className="text-sm text-[var(--text-muted)]">Thinking</span>
      <div className="flex gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  )
}
