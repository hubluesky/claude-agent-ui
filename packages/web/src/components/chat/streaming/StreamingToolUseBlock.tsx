import { memo } from 'react'
import { getToolCategory, TOOL_COLORS } from '@claude-cockpit/shared'
import { ToolIcon } from '../tool-display'
import type { StreamingToolUse } from '../../../stores/sessionContainerStore'

interface StreamingToolUseBlockProps {
  tool: StreamingToolUse
}

export const StreamingToolUseBlock = memo(function StreamingToolUseBlock({ tool }: StreamingToolUseBlockProps) {
  const category = getToolCategory(tool.name)
  const color = TOOL_COLORS[category] ?? TOOL_COLORS['default']

  return (
    <div className="border border-[var(--border)] rounded-md overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-secondary)]">
        <div className="w-0.5 h-4 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <ToolIcon category={category} />
        <span className="text-xs font-mono font-semibold shrink-0" style={{ color }}>{tool.name}</span>
        <span className="flex-1" />
        <span className="inline-block w-1.5 h-1.5 bg-[var(--accent)] rounded-full animate-pulse shrink-0" />
      </div>
      {tool.input && (
        <pre className="border-t border-[var(--border)] bg-[var(--bg-tertiary)] text-xs font-mono text-[var(--text-secondary)] px-3 py-2.5 overflow-x-auto max-h-32 whitespace-pre-wrap break-all">
          {tool.input}
        </pre>
      )}
    </div>
  )
})
