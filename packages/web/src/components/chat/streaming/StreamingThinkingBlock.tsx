import { memo } from 'react'

interface StreamingThinkingBlockProps {
  content: string
}

export const StreamingThinkingBlock = memo(function StreamingThinkingBlock({ content }: StreamingThinkingBlockProps) {
  if (!content) return null
  return (
    <div className="border-l-2 border-[var(--purple-subtle-border)] pl-3 py-1">
      <p className="text-xs text-[var(--purple)] whitespace-pre-wrap leading-relaxed">
        {content}
        <span className="inline-block w-1.5 h-3 bg-[var(--purple)] rounded-sm ml-0.5 animate-pulse" />
      </p>
    </div>
  )
})
