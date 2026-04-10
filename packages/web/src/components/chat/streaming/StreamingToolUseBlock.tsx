import { memo } from 'react'
import { getToolCategory, TOOL_COLORS } from '@claude-agent-ui/shared'
import { ToolIcon } from '../tool-display'
import type { StreamingToolUse } from '../../../stores/sessionContainerStore'

interface StreamingToolUseBlockProps {
  tool: StreamingToolUse
}

export const StreamingToolUseBlock = memo(function StreamingToolUseBlock({ tool }: StreamingToolUseBlockProps) {
  const category = getToolCategory(tool.name)
  const color = TOOL_COLORS[category] ?? TOOL_COLORS.other

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-md overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-tertiary)] border-b border-[var(--border)]">
        <ToolIcon category={category} />
        <span className="text-xs font-medium" style={{ color }}>{tool.name}</span>
        <span className="ml-auto inline-block w-1.5 h-1.5 bg-[var(--accent)] rounded-full animate-pulse" />
      </div>
      {tool.input && (
        <pre className="text-xs text-[var(--text-secondary)] px-3 py-2 overflow-x-auto max-h-32 whitespace-pre-wrap break-all">
          {tool.input}
        </pre>
      )}
    </div>
  )
})
