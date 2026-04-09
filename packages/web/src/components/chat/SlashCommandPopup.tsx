import { useRef, useEffect } from 'react'
import type { LocalSlashCommand } from '../../stores/commandStore'

interface SlashCommandPopupProps {
  commands: LocalSlashCommand[]
  selectedIndex: number
  onSelect: (command: LocalSlashCommand) => void
}

export function SlashCommandPopup({ commands, selectedIndex, onSelect }: SlashCommandPopupProps) {
  if (commands.length === 0) return null

  const listRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg shadow-xl z-50 overflow-hidden">
      <div className="px-4 py-2 border-b border-[var(--border)]">
        <span className="text-xs text-[var(--text-muted)]">Slash Commands</span>
      </div>
      <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1">
        {commands.map((cmd, i) => (
          <button
            key={cmd.name}
            ref={i === selectedIndex ? selectedRef : undefined}
            onMouseDown={(e) => { e.preventDefault(); onSelect(cmd) }}
            className={`w-full px-4 py-1.5 text-left transition-colors ${
              i === selectedIndex ? 'bg-[#2563eb]' : 'hover:bg-[var(--bg-hover)]'
            }`}
          >
            <span className={`text-[13px] font-mono ${
              i === selectedIndex ? 'text-white' : 'text-[var(--text-secondary)]'
            }`}>
              /{cmd.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
