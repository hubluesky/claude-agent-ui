import { memo, useState } from 'react'
import { MarkdownRenderer } from '../MarkdownRenderer'

interface Props {
  block: { type: string; thinking?: string; [key: string]: unknown }
}

export const AssistantThinkingBlock = memo(function AssistantThinkingBlock({ block }: Props) {
  const [expanded, setExpanded] = useState(false)
  const isRedacted = block.type === 'redacted_thinking'
  const thinking = (block.thinking as string) ?? ''

  return (
    <details
      open={expanded}
      onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
      className="border-l-2 border-[var(--purple-subtle-border)] pl-3 py-1"
    >
      <summary className="text-xs text-[var(--purple)] cursor-pointer select-none list-none flex items-center gap-1.5 opacity-70 hover:opacity-100 transition-opacity">
        <svg
          className={`w-3 h-3 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M6 4l8 6-8 6V4z" />
        </svg>
        <span className="italic">
          {isRedacted ? '∴ Thinking (redacted)' : '∴ Thinking'}
        </span>
      </summary>
      {!isRedacted && thinking && (
        <div className="text-xs text-[var(--purple)] whitespace-pre-wrap leading-relaxed mt-1 opacity-80">
          <MarkdownRenderer content={thinking} />
        </div>
      )}
    </details>
  )
})
