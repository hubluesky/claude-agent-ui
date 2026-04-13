import { useState, memo } from 'react'
import { getToolCategory, TOOL_COLORS } from '@claude-agent-ui/shared'
import { ToolIcon, formatToolSummary } from '../tool-display'
import type { CollapsedGroup } from '../../../utils/collapseReadSearch'

interface Props {
  group: CollapsedGroup
}

/**
 * Renders a collapsed read/search group as a single compact line.
 * Matches Claude Code: "Searched 2 patterns, read 3 files (click to expand)"
 */
export const CollapsedReadSearchBlock = memo(function CollapsedReadSearchBlock({ group }: Props) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-[var(--border)] rounded-md overflow-hidden">
      {/* Compact summary header */}
      <div
        className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-secondary)] cursor-pointer hover:bg-[var(--bg-hover)]"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="w-0.5 h-4 rounded-full shrink-0 bg-[var(--text-muted)]" />
        <svg className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <span className="text-xs font-mono text-[var(--text-secondary)] flex-1">{group.summary}</span>
        <span className="text-[10px] text-[var(--text-dim)]">{expanded ? 'collapse' : 'expand'}</span>
        <svg className={`w-3 h-3 text-[var(--text-muted)] transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expanded: show individual tool calls */}
      {expanded && (
        <div className="border-t border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2 space-y-1.5">
          {group.messages.filter(m => m.block && (m.block.type === 'tool_use' || m.block.type === 'server_tool_use')).map((msg, i) => {
            const block = msg.block!
            const name = (block.name as string) ?? 'tool'
            const cat = getToolCategory(name)
            const clr = TOOL_COLORS[cat]
            const sum = formatToolSummary(name, block.input as Record<string, unknown>)
            return (
              <div key={msg.uuid ?? i} className="flex items-center gap-2 text-xs">
                <ToolIcon category={cat} />
                <span className="font-mono font-semibold shrink-0" style={{ color: clr }}>{name}</span>
                <span className="font-mono text-[var(--text-muted)] truncate">{sum}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})
