import type { ProjectInfo } from '@claude-agent-ui/shared'

interface ProjectCardProps {
  project: ProjectInfo
  isSelected: boolean
  onClick: () => void
}

function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return `${Math.floor(days / 30)} 个月前`
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
