interface PlusMenuProps {
  onUpload: () => void
  onAddContext: () => void
  onClose: () => void
}

export function PlusMenu({ onUpload, onAddContext, onClose }: PlusMenuProps) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute bottom-full left-0 mb-1 w-[220px] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl z-50 overflow-hidden">
        <button
          onClick={() => { onUpload(); onClose() }}
          className="w-full px-3 py-2.5 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-2.5"
        >
          <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          Upload from computer
        </button>
        <div className="h-px bg-[var(--border)]" />
        <button
          onClick={() => { onAddContext(); onClose() }}
          className="w-full px-3 py-2.5 text-left text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-2.5"
        >
          <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          Add context
        </button>
      </div>
    </>
  )
}
