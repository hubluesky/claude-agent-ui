import { memo } from 'react'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { HighlightText } from '../SearchBar'
import { classifyText, parseCommandXml, parseTaskNotificationXml } from './textUtils'
import { TaskNotificationCard } from './TaskNotificationCard'

interface Props {
  block: { text?: string; [key: string]: unknown }
  isOptimistic: boolean
}

export const UserTextBlock = memo(function UserTextBlock({ block, isOptimistic }: Props) {
  const text = (block.text as string) ?? ''
  if (!text.trim()) return null

  const textClass = classifyText(text)
  if (textClass === 'internal-output') return null

  if (textClass === 'compact-summary') {
    return (
      <details className="bg-[var(--info-subtle-bg)] border border-[var(--info-subtle-border)] rounded-md px-3 py-2">
        <summary className="text-xs text-[var(--cyan)] cursor-pointer">Context summary (compacted)</summary>
        <div className="text-xs text-[var(--text-secondary)] mt-2 leading-relaxed whitespace-pre-wrap">{text}</div>
      </details>
    )
  }

  const taskNotif = parseTaskNotificationXml(text)
  if (taskNotif) return <TaskNotificationCard data={taskNotif} />

  const cmdText = parseCommandXml(text)
  if (cmdText) {
    return (
      <div className="flex justify-end">
        <div className="bg-[var(--accent-bg)] rounded-xl rounded-br-sm px-4 py-2.5 max-w-[70%] flex items-center gap-2">
          <span className="text-xs font-mono text-[var(--accent)] bg-[#d9770620] px-1.5 py-0.5 rounded">/</span>
          <span className="text-sm text-[var(--text-primary)]">{cmdText}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-end">
      <div className={`bg-[var(--accent-bg)] rounded-xl rounded-br-sm px-4 py-3 max-w-[70%]${isOptimistic ? ' opacity-60' : ''}`}>
        <HighlightText text={text} className="text-sm text-[var(--text-primary)] whitespace-pre-wrap" />
        {isOptimistic && <span className="text-[10px] text-[var(--text-muted)] float-right mt-0.5 tracking-widest">···</span>}
      </div>
    </div>
  )
})
