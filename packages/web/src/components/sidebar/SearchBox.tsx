interface SearchBoxProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
}

export function SearchBox({ value, onChange, placeholder }: SearchBoxProps) {
  return (
    <div className="px-3 pt-2.5 pb-1.5">
      <div className="flex items-center gap-1.5 h-8 px-2.5 bg-[var(--bg-hover)] rounded-md border border-[var(--border)] focus-within:border-[var(--accent)] transition-colors">
        <svg className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent border-none outline-none text-[var(--text-primary)] text-xs placeholder-[var(--text-muted)]"
        />
      </div>
    </div>
  )
}
