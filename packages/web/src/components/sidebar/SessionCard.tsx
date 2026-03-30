import type { SessionSummary } from '@claude-agent-ui/shared'

interface SessionCardProps {
  session: SessionSummary
  isSelected: boolean
  onClick: () => void
}

function relativeTime(isoDate?: string): string {
  if (!isoDate) return ''
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

export function SessionCard({ session, isSelected, onClick }: SessionCardProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-2.5 p-2.5 rounded-lg text-left transition-colors duration-150 ${
        isSelected
          ? 'bg-[#d977061a] border border-[#d9770640]'
          : 'bg-[#2b2a27] border border-transparent hover:bg-[#3d3b37]'
      }`}
    >
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-[13px] font-medium text-[#e5e2db] truncate">
          {session.title || '新会话'}
        </p>
        <div className="flex gap-2 text-[10px] text-[#7c7872]">
          <span>{relativeTime(session.updatedAt)}</span>
        </div>
        <p className="text-[9px] font-mono text-[#5c5952] truncate cursor-pointer hover:text-[#7c7872]">
          claude -r {session.sessionId.slice(0, 8)}
        </p>
      </div>
    </button>
  )
}
