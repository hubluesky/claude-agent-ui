interface EmptyPanelProps {
  onNewConversation: () => void
}

export function EmptyPanel({ onNewConversation }: EmptyPanelProps) {
  return (
    <div
      onClick={onNewConversation}
      className="flex flex-col items-center justify-center cursor-pointer text-[var(--border)] hover:text-[var(--text-muted)] h-full bg-[var(--bg-primary)] min-h-[200px]"
    >
      <div className="w-[30px] h-[30px] rounded-full bg-[var(--bg-secondary)] border border-[var(--border)] flex items-center justify-center text-xs font-bold text-[var(--accent)] font-mono mb-2">
        C
      </div>
      <div className="text-[9px]">新建对话</div>
    </div>
  )
}
