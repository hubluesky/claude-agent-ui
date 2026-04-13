import { memo } from 'react'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { classifyText, parseTaskNotificationXml } from './textUtils'
import { TaskNotificationCard } from './TaskNotificationCard'

interface Props {
  block: { text?: string; [key: string]: unknown }
}

export const AssistantTextBlock = memo(function AssistantTextBlock({ block }: Props) {
  const text = (block.text as string) ?? ''
  if (!text) return null

  const textClass = classifyText(text)
  if (textClass === 'internal-output') return null

  if (textClass === 'compact-summary') {
    return (
      <details className="bg-[var(--info-subtle-bg)] border border-[var(--info-subtle-border)] rounded-md px-3 py-2">
        <summary className="text-xs text-[var(--cyan)] cursor-pointer">Context summary (compacted)</summary>
        <div className="text-xs text-[var(--text-secondary)] mt-2 leading-relaxed overflow-hidden">
          <MarkdownRenderer content={text} />
        </div>
      </details>
    )
  }

  const taskNotif = parseTaskNotificationXml(text)
  if (taskNotif) return <TaskNotificationCard data={taskNotif} />

  return (
    <div className="text-sm text-[var(--text-primary)] leading-relaxed overflow-hidden">
      <MarkdownRenderer content={text} />
    </div>
  )
})
