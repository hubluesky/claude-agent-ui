import { useState } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useWebSocket } from '../../hooks/useWebSocket'
import { getToolCategory, TOOL_COLORS, type ToolCategory } from '@claude-agent-ui/shared'

export function PermissionBanner() {
  const { pendingApproval } = useConnectionStore()
  const { respondToolApproval } = useWebSocket()
  const [expanded, setExpanded] = useState(false)

  if (!pendingApproval) return null

  const { requestId, toolName, toolInput, title, description, readonly } = pendingApproval
  const category = getToolCategory(toolName)
  const color = TOOL_COLORS[category]
  const summary = formatToolSummary(toolName, toolInput)
  const fullInput = JSON.stringify(toolInput, null, 2)

  const handleAllow = () => {
    respondToolApproval(requestId, { behavior: 'allow', updatedInput: toolInput })
  }

  const handleAlwaysAllow = () => {
    respondToolApproval(requestId, {
      behavior: 'allow',
      updatedInput: toolInput,
      updatedPermissions: [{ type: 'addRules', tool: toolName }],
    })
  }

  const handleDeny = () => {
    respondToolApproval(requestId, { behavior: 'deny', message: 'User denied' })
  }

  return (
    <div className={`mx-10 mb-4 rounded-lg border ${
      readonly
        ? 'bg-[#78787214] border-[#3d3b37]'
        : 'bg-[#d977060a] border-[#d9770626]'
    }`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
        {readonly ? (
          <>
            <svg className="w-4 h-4 text-[#7c7872]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span className="text-[13px] text-[#7c7872]">Waiting for operator to respond...</span>
          </>
        ) : (
          <>
            <svg className="w-4 h-4 text-[#d97706]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            <span className="text-[13px] text-[#a8a29e]">
              {title ?? description ?? `Claude wants to use ${toolName}`}
            </span>
          </>
        )}
      </div>

      {/* Tool display */}
      <div className="mx-4 mb-3 bg-[#1e1d1a] border border-[#3d3b37] rounded-md overflow-hidden">
        <div
          className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-[#2b2a2780]"
          onClick={() => setExpanded(!expanded)}
        >
          <ToolIcon category={category} />
          <span className="text-xs font-mono font-semibold" style={{ color }}>{toolName}</span>
          <span className="text-xs font-mono text-[#a8a29e] truncate flex-1">{summary}</span>
          <svg
            className={`w-3.5 h-3.5 text-[#7c7872] transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        {expanded && (
          <div className="border-t border-[#3d3b37] px-3 py-2.5 text-xs font-mono text-[#a8a29e] whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto">
            {fullInput}
          </div>
        )}
      </div>

      {/* Action buttons */}
      {!readonly && (
        <div className="flex gap-2 justify-end px-4 pb-3.5">
          <button
            onClick={handleDeny}
            className="px-4 py-1.5 text-xs font-medium text-[#a8a29e] border border-[#3d3b37] rounded-md hover:bg-[#3d3b37] transition-colors"
          >Deny</button>
          <button
            onClick={handleAlwaysAllow}
            className="px-4 py-1.5 text-xs font-medium text-[#a8a29e] border border-[#3d3b37] rounded-md hover:bg-[#3d3b37] transition-colors"
          >Always Allow</button>
          <button
            onClick={handleAllow}
            className="px-4 py-1.5 text-xs font-semibold text-[#1c1b18] bg-[#d97706] rounded-md hover:bg-[#b45309] transition-colors"
          >Allow</button>
        </div>
      )}
    </div>
  )
}

function ToolIcon({ category }: { category: ToolCategory }) {
  const cls = "w-3.5 h-3.5 shrink-0"
  switch (category) {
    case 'bash':
      return <span className={`${cls} text-[#059669] font-mono text-[10px] leading-none`}>{'>'}_</span>
    case 'edit':
      return <svg className={`${cls} text-[#d97706]`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
    case 'search':
      return <svg className={`${cls} text-[#059669]`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
    case 'read':
      return <svg className={`${cls} text-[#6b7280]`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
    case 'web':
      return <svg className={`${cls} text-[#0ea5e9]`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582" /></svg>
    case 'agent':
      return <svg className={`${cls} text-[#a855f7]`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197" /></svg>
    default:
      return <div className={`${cls} rounded-full bg-[#6b7280]`} />
  }
}

function formatToolSummary(toolName: string, input: any): string {
  if (!input) return ''
  switch (toolName) {
    case 'Bash': return input.command ?? ''
    case 'Read': return input.file_path ?? ''
    case 'Write': return input.file_path ?? ''
    case 'Edit': return input.file_path ?? ''
    case 'Grep': return `"${input.pattern ?? ''}" ${input.path ?? ''}`
    case 'Glob': return input.pattern ?? ''
    case 'Agent': return input.description ?? input.prompt?.slice(0, 80) ?? ''
    case 'WebSearch': return `"${input.query ?? ''}"`
    case 'WebFetch': return input.url ?? ''
    default: return JSON.stringify(input).slice(0, 120)
  }
}
