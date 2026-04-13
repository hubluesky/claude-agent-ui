import { memo } from 'react'
import { MarkdownRenderer } from '../MarkdownRenderer'
import type { TaskNotificationData } from './textUtils'

interface Props {
  data: TaskNotificationData
}

export const TaskNotificationCard = memo(function TaskNotificationCard({ data }: Props) {
  const isError = data.status === 'failed' || data.status === 'error'
  const isCompleted = data.status === 'completed'
  const dotClass = isError ? 'bg-[var(--error)]' : isCompleted ? 'bg-[var(--success)]' : 'bg-[var(--warning)]'
  const borderClass = isError ? 'border-[var(--error-subtle-border)]' : isCompleted ? 'border-[var(--success-subtle-border)]' : 'border-[var(--warning-subtle-border)]'
  const headerBg = isError ? 'bg-[var(--error-subtle-bg)]' : isCompleted ? 'bg-[var(--success-subtle-bg)]' : 'bg-[var(--warning-subtle-bg)]'
  const headerText = isError ? 'text-[var(--error)]' : isCompleted ? 'text-[var(--success)]' : 'text-[var(--warning)]'

  return (
    <div className={`rounded-md border overflow-hidden ${borderClass}`}>
      <div className={`flex items-center gap-2 px-3 py-2 ${headerBg}`}>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
        <span className={`text-xs font-semibold ${headerText}`}>
          {data.status === 'completed' ? 'Task completed' : data.status === 'failed' ? 'Task failed' : `Task ${data.status}`}
        </span>
        {data.taskId && <span className={`text-[10px] ${headerText} opacity-60 ml-auto font-mono`}>{data.taskId}</span>}
      </div>
      {data.summary && (
        <div className="px-3 py-2 text-xs text-[var(--text-secondary)] leading-relaxed overflow-hidden border-t border-[var(--border)]">
          <MarkdownRenderer content={data.summary} />
        </div>
      )}
    </div>
  )
})
