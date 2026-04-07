import { useRef, useEffect } from 'react'

export interface FileItem {
  path: string
  type: 'file' | 'directory'
}

interface FileReferencePopupProps {
  files: FileItem[]
  selectedIndex: number
  onSelect: (file: FileItem) => void
}

export function FileReferencePopup({ files, selectedIndex, onSelect }: FileReferencePopupProps) {
  if (files.length === 0) return null

  const selectedRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg shadow-xl z-50 overflow-hidden">
      <div className="px-4 py-2 border-b border-[var(--border)]">
        <span className="text-xs text-[var(--text-muted)]">Files</span>
      </div>
      <div className="max-h-[320px] overflow-y-auto py-1">
        {files.map((file, i) => (
          <button
            key={file.path}
            ref={i === selectedIndex ? selectedRef : undefined}
            onMouseDown={(e) => { e.preventDefault(); onSelect(file) }}
            className={`w-full px-4 py-1.5 text-left flex items-center gap-2 transition-colors ${
              i === selectedIndex ? 'bg-[#2563eb]' : 'hover:bg-[#2a2925]'
            }`}
          >
            <span className="text-[13px] shrink-0">{file.type === 'directory' ? '📁' : '📄'}</span>
            <span className={`text-[13px] font-mono truncate ${
              i === selectedIndex ? 'text-white' : 'text-[#c4c0b8]'
            }`}>
              {file.path}
            </span>
          </button>
        ))}
      </div>
      <div className="px-4 py-1.5 border-t border-[var(--border)]">
        <span className="text-[11px] text-[var(--text-muted)]">↑↓ navigate · Enter select · Esc cancel</span>
      </div>
    </div>
  )
}
