import { memo } from 'react'

interface StreamingTextBlockProps {
  text: string
}

export const StreamingTextBlock = memo(function StreamingTextBlock({ text }: StreamingTextBlockProps) {
  if (!text) return null
  return (
    <div className="flex gap-3 items-start">
      <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed flex-1">
        {text}
        <span className="inline-block w-2 h-4 bg-[var(--accent)] rounded-sm ml-0.5 animate-pulse" />
      </p>
    </div>
  )
})
