import { useChatSession } from '../../providers/ChatSessionContext'

interface PanelHeaderProps {
  title: string
  projectName: string
  onExpand: () => void
  onClose: () => void
}

export function PanelHeader({ title, projectName, onExpand, onClose }: PanelHeaderProps) {
  const { sessionStatus, lockStatus } = useChatSession()

  const dotColor = sessionStatus === 'running'
    ? 'bg-[var(--success)] shadow-[0_0_4px_rgba(34,197,94,0.4)]'
    : lockStatus === 'locked_self'
      ? 'bg-[var(--warning)]'
      : 'bg-[var(--border)]'

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-[var(--border)] shrink-0 bg-[var(--bg-secondary)]">
      <div className={`w-[5px] h-[5px] rounded-full shrink-0 ${dotColor}`} />
      <span
        className="text-[9px] font-semibold flex-1 truncate cursor-pointer text-[var(--text-primary)]"
        onDoubleClick={onExpand}
      >
        {title || 'New conversation'}
      </span>
      <span className="text-[7px] text-[var(--accent)] bg-[var(--accent-subtle-bg)] px-1 rounded">{projectName}</span>
      <button
        onClick={onExpand}
        className="flex items-center gap-0.5 px-1 h-[18px] rounded text-[var(--text-muted)] hover:bg-[var(--accent-subtle-bg)] hover:text-[var(--accent)]"
        title="展开全屏（双击标题也可展开）"
      >
        <span className="text-[10px]">↗</span>
        <span className="text-[7px] font-mono opacity-60">展开</span>
      </button>
      <button
        onClick={onClose}
        className="w-[18px] h-[18px] rounded text-[11px] text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-[var(--text-secondary)] flex items-center justify-center"
      >
        ×
      </button>
    </div>
  )
}
