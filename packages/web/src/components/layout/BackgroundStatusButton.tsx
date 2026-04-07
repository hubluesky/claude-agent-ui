import { useState } from 'react'
import { useMultiPanelStore } from '../../stores/multiPanelStore'
import { BackgroundStatusDropdown } from './BackgroundStatusDropdown'

export function BackgroundStatusButton() {
  const [open, setOpen] = useState(false)
  const summaries = useMultiPanelStore((s) => s.panelSummaries)

  // Count sessions needing attention
  let attentionCount = 0
  for (const [, s] of summaries) {
    if (s.hasApproval || s.status === 'awaiting_approval' || s.status === 'awaiting_user_input') {
      attentionCount++
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors relative ${
          open ? 'bg-[var(--border)] text-[var(--text-primary)]' : 'hover:bg-[var(--border)] text-[var(--text-muted)]'
        }`}
        title="后台会话"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        {attentionCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[14px] h-[14px] rounded-full bg-[var(--warning)] text-[var(--bg-primary)] text-[7px] font-bold flex items-center justify-center px-0.5">
            {attentionCount}
          </span>
        )}
      </button>
      {open && <BackgroundStatusDropdown onClose={() => setOpen(false)} />}
    </div>
  )
}
