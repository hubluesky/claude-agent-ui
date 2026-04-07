import type { ProjectInfo } from '@claude-agent-ui/shared'
import { relativeTime } from '../../lib/time'

interface ProjectCardProps {
  project: ProjectInfo
  isSelected: boolean
  onClick: () => void
}

export function ProjectCard({ project, isSelected, onClick }: ProjectCardProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-2.5 p-2.5 rounded-lg text-left transition-colors duration-150 ${
        isSelected
          ? 'bg-[#d977061a] border border-[#d9770640]'
          : 'bg-[var(--bg-hover)] border border-transparent hover:bg-[var(--border)]'
      }`}
    >
      <div className="w-5 h-5 rounded-full bg-[#d9770626] flex items-center justify-center shrink-0 mt-px">
        <span className="text-[10px] font-semibold text-[var(--accent)]">{project.sessionCount}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1.5">
          <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate">{project.name}</span>
          <span className="text-[10px] text-[var(--text-muted)] shrink-0">{relativeTime(project.lastActiveAt)}</span>
        </div>
      </div>
    </button>
  )
}
