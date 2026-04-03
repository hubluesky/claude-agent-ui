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
          : 'bg-[#2b2a27] border border-transparent hover:bg-[#3d3b37]'
      }`}
    >
      <div className="w-5 h-5 rounded-full bg-[#d9770626] flex items-center justify-center shrink-0 mt-px">
        <span className="text-[10px] font-semibold text-[#d97706]">{project.sessionCount}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1.5">
          <span className="text-[13px] font-semibold text-[#e5e2db] truncate">{project.name}</span>
          <span className="text-[10px] text-[#7c7872] shrink-0">{relativeTime(project.lastActiveAt)}</span>
        </div>
      </div>
    </button>
  )
}
