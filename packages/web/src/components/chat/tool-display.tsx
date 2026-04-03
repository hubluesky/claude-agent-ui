import { getToolCategory, TOOL_COLORS, type ToolCategory } from '@claude-agent-ui/shared'

// ─── ToolIcon ────────────────────────────────────────────────────────────────
export function ToolIcon({ category }: { category: ToolCategory }) {
  const cls = 'w-3.5 h-3.5 shrink-0'
  const color = TOOL_COLORS[category]
  switch (category) {
    case 'bash':
      return <span className={`${cls} font-mono text-[10px] leading-none`} style={{ color }}>{'>'}_</span>
    case 'edit':
      return (
        <svg className={cls} style={{ color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
        </svg>
      )
    case 'search':
      return (
        <svg className={cls} style={{ color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      )
    case 'read':
      return (
        <svg className={cls} style={{ color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      )
    case 'web':
      return (
        <svg className={cls} style={{ color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582" />
        </svg>
      )
    case 'agent':
      return (
        <svg className={cls} style={{ color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197" />
        </svg>
      )
    case 'todo':
    case 'task':
      return (
        <svg className={cls} style={{ color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    case 'question':
      return (
        <svg className={cls} style={{ color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
        </svg>
      )
    default:
      return <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
  }
}

// ─── formatToolSummary ────────────────────────────────────────────────────────
export function formatToolSummary(toolName: string, input: Record<string, unknown>): string {
  if (!input) return ''
  switch (toolName) {
    case 'Bash': return (input.command as string) ?? ''
    case 'Read': return (input.file_path as string) ?? ''
    case 'Write': return (input.file_path as string) ?? ''
    case 'Edit': return (input.file_path as string) ?? ''
    case 'Grep': return `"${input.pattern ?? ''}" ${input.path ?? ''}`
    case 'Glob': return (input.pattern as string) ?? ''
    case 'Agent': return (input.description as string) ?? ((input.prompt as string)?.slice(0, 80) ?? '')
    case 'WebSearch': return `"${input.query ?? ''}"`
    case 'WebFetch': return (input.url as string) ?? ''
    case 'TaskCreate': return (input.subject as string) ?? ''
    case 'TaskUpdate': return `#${input.taskId} → ${input.status ?? ''}`
    case 'TodoWrite': return `${((input.todos as unknown[]) ?? []).length} items`
    default: return JSON.stringify(input).slice(0, 120)
  }
}

// Re-export for convenience
export { getToolCategory, TOOL_COLORS }
export type { ToolCategory }
