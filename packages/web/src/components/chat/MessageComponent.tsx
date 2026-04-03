import { useState, memo } from 'react'
import type { AgentMessage } from '@claude-agent-ui/shared'
import { getToolCategory, TOOL_COLORS, type ToolCategory } from '@claude-agent-ui/shared'
import { MarkdownRenderer } from './MarkdownRenderer'

interface MessageComponentProps {
  message: AgentMessage
}

/** Parse SDK command XML format into a friendly display string, or return null if not a command */
function parseCommandXml(text: string): string | null {
  const nameMatch = text.match(/<command-name>\s*(.*?)\s*<\/command-name>/)
  if (!nameMatch) return null
  const name = nameMatch[1]
  const argsMatch = text.match(/<command-args>\s*(.*?)\s*<\/command-args>/s)
  const args = argsMatch?.[1]?.trim() ?? ''
  return args ? `${name} ${args}` : name
}

/** Strip SDK internal XML tags (local-command-stdout, etc.) and check if text is a compact summary */
function classifyText(text: string): 'compact-summary' | 'internal-output' | 'normal' {
  if (!text) return 'normal'
  // Compact summary detection
  if (/continued from a previous conversation|ran out of context|summary below covers the earlier portion/i.test(text.slice(0, 300))) {
    return 'compact-summary'
  }
  // SDK internal output (hook stdout, etc.)
  if (/^<local-command-stdout>/i.test(text.trim())) {
    return 'internal-output'
  }
  return 'normal'
}

/** Fast visibility check — mirrors the null-return paths of MessageComponent.
 *  Used by ChatMessagesPane to pre-filter messages so Virtuoso never sees zero-height items. */
export function isMessageVisible(message: AgentMessage): boolean {
  if (message.type === 'user') return true

  if (message.type === 'assistant') {
    const contentBlocks = (message as any).message?.content ?? []
    return contentBlocks.some((block: any) => {
      if (block.type === 'text') return !!block.text
      if (block.type === 'tool_use' || block.type === 'server_tool_use') return true
      if (block.type === 'tool_result' || block.type === 'web_search_tool_result' || block.type === 'code_execution_tool_result') return true
      if (block.type === 'redacted_thinking') return true
      if (block.type === 'thinking') return !!(block.thinking || block.text)
      return false
    })
  }

  if (message.type === 'result') {
    const subtype = (message as any).subtype ?? ''
    return subtype.startsWith('error')
  }

  if ((message as any).type === '_streaming_block') {
    const blockType = (message as any)._blockType
    return blockType === 'text' || blockType === 'thinking'
  }

  if (message.type === 'system') {
    const sub = (message as any).subtype
    if (sub === 'api_retry') return true
    if (sub === 'status' && (message as any).status === 'compacting') return true
    if (sub === 'task_started') return true
    if (sub === 'task_progress') return !!(message as any).content || !!(message as any).message
    if (sub === 'task_notification') return true
    if (sub === 'local_command_output') return !!((message as any).output ?? (message as any).content)
    return false
  }

  if (message.type === 'tool_use_summary') return true
  if (message.type === 'tool_progress') return !!(message as any).content
  if (message.type === 'rate_limit_event') return true

  return false
}

export const MessageComponent = memo(function MessageComponent({ message }: MessageComponentProps) {
  const isOptimistic = (message as any)._optimistic

  // User message
  if (message.type === 'user') {
    const content = (message as any).message?.content
    if (Array.isArray(content)) {
      return (
        <>
          {content.map((block: any, i: number) => {
            if (block.type === 'tool_result') return <ToolResultBlock key={i} block={block} />
            if (block.type === 'image' && block.source?.type === 'base64') {
              const src = `data:${block.source.media_type};base64,${block.source.data}`
              return (
                <div key={i} className="flex justify-end">
                  <img src={src} alt="attached" loading="lazy" className="max-w-[300px] max-h-[200px] rounded-lg border border-[#3d3b37]" />
                </div>
              )
            }
            if (block.type === 'text') {
              const textClass = classifyText(block.text)
              // Hide internal SDK output in user messages
              if (textClass === 'internal-output') return null
              const cmdText = parseCommandXml(block.text)
              if (cmdText) {
                return (
                  <div key={i} className="flex justify-end">
                    <div className="bg-[#3d2e14] rounded-xl rounded-br-sm px-4 py-2.5 max-w-[70%] flex items-center gap-2">
                      <span className="text-xs font-mono text-[#d97706] bg-[#d9770620] px-1.5 py-0.5 rounded">/</span>
                      <span className="text-sm text-[#e5e2db]">{cmdText}</span>
                    </div>
                  </div>
                )
              }
              return (
                <div key={i} className="flex justify-end">
                  <div className={`bg-[#3d2e14] rounded-xl rounded-br-sm px-4 py-3 max-w-[70%]${isOptimistic ? ' opacity-60' : ''}`}>
                    <p className="text-sm text-[#e5e2db] whitespace-pre-wrap">{block.text}</p>
                    {isOptimistic && <span className="text-[10px] text-[#7c7872] float-right mt-0.5 tracking-widest">···</span>}
                  </div>
                </div>
              )
            }
            return null
          })}
        </>
      )
    }
    const rawText = typeof content === 'string' ? content : JSON.stringify(content)
    if (classifyText(rawText) === 'internal-output') return null
    const cmdText = parseCommandXml(rawText)
    if (cmdText) {
      return (
        <div className="flex justify-end">
          <div className="bg-[#3d2e14] rounded-xl rounded-br-sm px-4 py-2.5 max-w-[70%] flex items-center gap-2">
            <span className="text-xs font-mono text-[#d97706] bg-[#d9770620] px-1.5 py-0.5 rounded">/</span>
            <span className="text-sm text-[#e5e2db]">{cmdText}</span>
          </div>
        </div>
      )
    }
    return (
      <div className="flex justify-end">
        <div className={`bg-[#3d2e14] rounded-xl rounded-br-sm px-4 py-3 max-w-[70%]${isOptimistic ? ' opacity-60' : ''}`}>
          <p className="text-sm text-[#e5e2db] whitespace-pre-wrap">{rawText}</p>
          {isOptimistic && <span className="text-[10px] text-[#7c7872] float-right mt-0.5 tracking-widest">···</span>}
        </div>
      </div>
    )
  }

  // Assistant message
  if (message.type === 'assistant') {
    const contentBlocks = (message as any).message?.content ?? []
    // Skip rendering if no blocks produce visible content
    const hasVisibleContent = contentBlocks.some((block: any) => {
      if (block.type === 'text') return !!block.text
      if (block.type === 'tool_use' || block.type === 'server_tool_use') return true
      if (block.type === 'tool_result' || block.type === 'web_search_tool_result' || block.type === 'code_execution_tool_result') return true
      if (block.type === 'redacted_thinking') return true
      if (block.type === 'thinking') return !!(block.thinking || block.text)
      return false
    })
    if (!hasVisibleContent) return null
    return (
      <div className="flex gap-3 items-start">
        <div className="w-7 h-7 rounded-full bg-[#242320] border border-[#3d3b37] flex items-center justify-center shrink-0">
          <span className="text-xs font-bold font-mono text-[#d97706]">C</span>
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          {contentBlocks.map((block: any, i: number) => {
            if (block.type === 'text') {
              const textClass = classifyText(block.text)
              if (textClass === 'internal-output') return null
              if (textClass === 'compact-summary') {
                return (
                  <details key={i} className="bg-[#0ea5e90a] border border-[#0ea5e926] rounded-md px-3 py-2">
                    <summary className="text-xs text-[#0ea5e9] cursor-pointer">Context summary (compacted)</summary>
                    <div className="text-xs text-[#a8a29e] mt-2 leading-relaxed overflow-hidden"><MarkdownRenderer content={block.text} /></div>
                  </details>
                )
              }
              return <div key={i} className="text-sm text-[#e5e2db] leading-relaxed overflow-hidden"><MarkdownRenderer content={block.text} /></div>
            }
            if (block.type === 'thinking' || block.type === 'redacted_thinking') {
              const thinkingText = block.thinking || block.text || ''
              if (!thinkingText) {
                return block.type === 'redacted_thinking' ? (
                  <div key={i} className="bg-[#8b5cf60f] rounded-md px-3 py-2">
                    <span className="text-xs text-[#8b5cf680] italic">Thinking (redacted)</span>
                  </div>
                ) : null
              }
              return (
                <details key={i} className="bg-[#8b5cf60f] rounded-md px-3 py-2">
                  <summary className="text-xs text-[#8b5cf6] cursor-pointer">Thinking...</summary>
                  <p className="text-xs text-[#a8a29e] mt-1 whitespace-pre-wrap">{thinkingText}</p>
                </details>
              )
            }
            if (block.type === 'tool_use' || block.type === 'server_tool_use') return <ToolUseBlock key={i} block={block} />
            if (block.type === 'tool_result' || block.type === 'web_search_tool_result' || block.type === 'code_execution_tool_result') return <ToolResultBlock key={i} block={block} />
            return null
          })}
        </div>
      </div>
    )
  }

  // Result
  if (message.type === 'result') {
    const subtype = (message as any).subtype ?? ''
    if (subtype.startsWith('error')) {
      return (
        <div className="flex items-start gap-2.5 bg-[#f871710a] border border-[#f8717126] rounded-md px-4 py-3">
          <div className="w-5 h-5 rounded-full bg-[#f87171] flex items-center justify-center shrink-0">
            <span className="text-[11px] font-bold text-[#1c1b18]">!</span>
          </div>
          <div>
            <p className="text-xs font-medium text-[#f87171]">
              {subtype === 'error_max_turns' ? 'Max turns reached'
                : subtype === 'error_max_budget_usd' ? 'Budget limit reached'
                : 'Error during execution'}
            </p>
            <p className="text-sm text-[#f8717199] mt-1">{((message as any).errors ?? []).join('\n')}</p>
          </div>
        </div>
      )
    }
    // Success results: don't render result text — the assistant message already shows it.
    // Only render if there was no assistant message (e.g. empty conversation).
    return null
  }

  // Streaming block
  if ((message as any).type === '_streaming_block') {
    const blockType = (message as any)._blockType
    const content = (message as any)._content ?? ''
    if (blockType === 'text') {
      return (
        <div className="flex gap-3 items-start">
          <div className="w-7 h-7 rounded-full bg-[#242320] border border-[#3d3b37] flex items-center justify-center shrink-0">
            <span className="text-xs font-bold font-mono text-[#d97706]">C</span>
          </div>
          <p className="text-sm text-[#e5e2db] whitespace-pre-wrap leading-relaxed flex-1">{content}<span className="inline-block w-2 h-4 bg-[#d97706] rounded-sm ml-0.5 animate-pulse" /></p>
        </div>
      )
    }
    if (blockType === 'thinking') {
      return (
        <details open className="bg-[#8b5cf60f] rounded-md px-3 py-2 ml-10">
          <summary className="text-xs text-[#8b5cf6] cursor-pointer">Thinking...</summary>
          <p className="text-xs text-[#a8a29e] mt-1 whitespace-pre-wrap">{content}</p>
        </details>
      )
    }
    return null
  }

  // System messages
  if (message.type === 'system') {
    const sub = (message as any).subtype
    if (sub === 'api_retry') {
      return (
        <div className="flex items-center gap-2 text-xs text-[#7c7872] bg-[#eab3080a] border border-[#eab30826] rounded-md px-3 py-2">
          <svg className="w-3.5 h-3.5 text-[#eab308] animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
          </svg>
          API retry (attempt {(message as any).attempt}/{(message as any).max_retries}) — waiting {(message as any).wait_seconds}s...
        </div>
      )
    }
    if (sub === 'status' && (message as any).status === 'compacting') {
      return (
        <div className="flex items-center gap-2 text-xs text-[#7c7872] bg-[#0ea5e90a] border border-[#0ea5e926] rounded-md px-3 py-2">
          <svg className="w-3.5 h-3.5 text-[#0ea5e9] animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
          </svg>
          Compacting context...
        </div>
      )
    }
    if (sub === 'task_started') {
      return (
        <div className="flex items-center gap-2 text-xs text-[#a855f7] bg-[#a855f70a] border border-[#a855f726] rounded-md px-3 py-2 ml-10">
          <svg className="w-3.5 h-3.5 text-[#a855f7]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197" />
          </svg>
          Agent: {(message as any).agent_name ?? (message as any).task_id ?? 'subagent'}
          <span className="text-[#a855f780] bg-[#a855f71a] px-1.5 py-0.5 rounded text-[10px]">running</span>
        </div>
      )
    }
    if (sub === 'task_progress') {
      const content = (message as any).content ?? (message as any).message ?? ''
      if (!content) return null
      return (
        <div className="flex items-center gap-2 text-xs text-[#7c7872] ml-10 pl-5 border-l-2 border-[#a855f726]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#a855f7]" />
          <span className="truncate">{typeof content === 'string' ? content.slice(0, 120) : JSON.stringify(content).slice(0, 120)}</span>
        </div>
      )
    }
    if (sub === 'task_notification') {
      const status = (message as any).status ?? 'completed'
      const isError = status === 'error' || status === 'failed'
      return (
        <div className={`flex items-center gap-2 text-xs ml-10 px-3 py-2 rounded-md ${
          isError ? 'text-[#f87171] bg-[#f871710a] border border-[#f8717126]'
            : 'text-[#a3e635] bg-[#a3e6350a] border border-[#a3e63526]'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isError ? 'bg-[#f87171]' : 'bg-[#a3e635]'}`} />
          {(message as any).agent_name ?? 'subagent'} {status}
          {(message as any).duration_ms ? ` — ${((message as any).duration_ms / 1000).toFixed(1)}s` : ''}
          {(message as any).tool_count ? `, ${(message as any).tool_count} tools` : ''}
        </div>
      )
    }
    // hook events — internal lifecycle noise, don't render in chat
    // (hook_started, hook_progress, hook_response fall through to return null)
    // local_command_output
    if (sub === 'local_command_output') {
      const output = (message as any).output ?? (message as any).content ?? ''
      if (!output) return null
      return (
        <div className="border border-[#3d3b37] rounded-md overflow-hidden ml-10">
          <div className="px-3 py-2 text-xs font-mono text-[#a8a29e] whitespace-pre-wrap break-all">
            {typeof output === 'string' ? output : JSON.stringify(output)}
          </div>
        </div>
      )
    }
    return null
  }

  // tool_use_summary — rendered like a compact tool block
  if (message.type === 'tool_use_summary') {
    const toolName = (message as any).tool_name ?? (message as any).name ?? 'tool'
    const summary = (message as any).summary ?? (message as any).result_summary ?? ''
    return (
      <div className="border border-[#3d3b37] rounded-md overflow-hidden ml-10">
        <div className="flex items-center gap-2 px-3 py-2 bg-[#242320]">
          <div className="w-0.5 h-4 rounded-full bg-[#6b7280]" />
          <span className="text-xs font-mono font-semibold text-[#6b7280]">{toolName}</span>
          {summary && <span className="text-xs font-mono text-[#7c7872] truncate flex-1">{typeof summary === 'string' ? summary.slice(0, 200) : JSON.stringify(summary).slice(0, 200)}</span>}
        </div>
      </div>
    )
  }

  // tool_progress
  if (message.type === 'tool_progress') {
    const content = (message as any).content ?? ''
    if (!content) return null
    return (
      <div className="flex items-center gap-2 text-xs text-[#7c7872] ml-10">
        <svg className="w-3 h-3 text-[#059669] animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
        </svg>
        <span className="truncate">{typeof content === 'string' ? content : JSON.stringify(content).slice(0, 150)}</span>
      </div>
    )
  }

  // Rate limit event
  if (message.type === 'rate_limit_event') {
    return (
      <div className="flex items-center gap-2 bg-[#f871710a] border border-[#f8717126] rounded-md px-4 py-3">
        <div className="w-5 h-5 rounded-full bg-[#f87171] flex items-center justify-center shrink-0">
          <span className="text-[11px] font-bold text-[#1c1b18]">!</span>
        </div>
        <p className="text-xs text-[#f87171]">
          Rate limit exceeded. Retrying in {(message as any).retry_after ?? 30}s...
        </p>
      </div>
    )
  }

  return null
})

// ---- Tool Use Block ----

function ToolUseBlock({ block }: { block: any }) {
  const { name, input } = block
  const [expanded, setExpanded] = useState(false)
  const category = getToolCategory(name)
  const color = TOOL_COLORS[category]
  const summary = formatToolSummary(name, input)

  // Expandable detail content based on tool type
  const detail = getToolDetail(name, input)

  return (
    <div className="border border-[#3d3b37] rounded-md overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 bg-[#242320] cursor-pointer hover:bg-[#2b2a2780]"
        onClick={() => detail && setExpanded(!expanded)}
      >
        <div className="w-0.5 h-4 rounded-full" style={{ backgroundColor: color }} />
        <ToolIcon category={category} />
        <span className="text-xs font-mono font-semibold" style={{ color }}>{name}</span>
        <span className="text-xs font-mono text-[#7c7872] truncate flex-1">{summary}</span>
        {detail && (
          <svg className={`w-3 h-3 text-[#7c7872] transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>
      {expanded && detail && (
        <div className="border-t border-[#3d3b37] bg-[#1e1d1a] px-3 py-2.5 text-xs font-mono text-[#a8a29e] whitespace-pre-wrap break-all">
          {detail}
        </div>
      )}
    </div>
  )
}

// ---- Tool Result Block ----

function ToolResultBlock({ block }: { block: any }) {
  const [expanded, setExpanded] = useState(false)
  const content = block.content
  const isError = block.is_error
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((c: any) => c.text ?? '').join('')
      : JSON.stringify(content)

  const preview = text.length > 120 ? text.slice(0, 120) + '...' : text
  const isLong = text.length > 120

  return (
    <div className={`border rounded-md overflow-hidden ml-10 ${
      isError ? 'border-[#f8717126] bg-[#f871710a]' : 'border-[#3d3b37] bg-[#242320]'
    }`}>
      <div
        className={`flex items-center gap-2 px-3 py-1.5 ${isLong ? 'cursor-pointer hover:bg-[#2b2a2780]' : ''}`}
        onClick={() => isLong && setExpanded(!expanded)}
      >
        <div className={`w-0.5 h-3 rounded-full ${isError ? 'bg-[#f87171]' : 'bg-[#6b7280]'}`} />
        <span className={`text-[10px] font-mono ${isError ? 'text-[#f87171]' : 'text-[#7c7872]'}`}>
          {isError ? 'Error' : 'Result'}
        </span>
        <span className="flex-1" />
        {isLong && (
          <svg className={`w-3 h-3 text-[#7c7872] transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>
      <div className="px-3 py-2 text-xs font-mono text-[#a8a29e] whitespace-pre-wrap break-all">
        {expanded || !isLong ? text : preview}
      </div>
    </div>
  )
}

// ---- Tool Icon ----

function ToolIcon({ category }: { category: ToolCategory }) {
  const cls = "w-3.5 h-3.5 shrink-0"
  const color = TOOL_COLORS[category]
  switch (category) {
    case 'bash':
      return <span className={`${cls} font-mono text-[10px] leading-none`} style={{ color }}>{'>'}_</span>
    case 'edit':
      return <svg className={cls} style={{ color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
    case 'search':
      return <svg className={cls} style={{ color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
    case 'read':
      return <svg className={cls} style={{ color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
    case 'web':
      return <svg className={cls} style={{ color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582" /></svg>
    case 'agent':
      return <svg className={cls} style={{ color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197" /></svg>
    case 'todo': case 'task':
      return <svg className={cls} style={{ color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
    case 'question':
      return <svg className={cls} style={{ color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" /></svg>
    default:
      return <div className={`w-2.5 h-2.5 rounded-full`} style={{ backgroundColor: color }} />
  }
}

// ---- Format ----

function getToolDetail(toolName: string, input: any): React.ReactNode | null {
  if (!input) return null
  switch (toolName) {
    case 'Bash':
      return input.command ? (
        <div>
          <div className="text-[#059669] mb-1">$ {input.command}</div>
          {input.description && <div className="text-[#7c7872] text-[10px] mb-1">{input.description}</div>}
        </div>
      ) : null
    case 'Edit':
      if (input.old_string && input.new_string) {
        return (
          <div>
            <div className="text-[10px] text-[#7c7872] mb-1">{input.file_path}</div>
            <div className="bg-[#f871710a] border-l-2 border-[#f87171] pl-2 py-1 mb-1">
              {input.old_string.split('\n').map((line: string, i: number) => (
                <div key={i} className="text-[#f8717199]">- {line}</div>
              ))}
            </div>
            <div className="bg-[#a3e6350a] border-l-2 border-[#a3e635] pl-2 py-1">
              {input.new_string.split('\n').map((line: string, i: number) => (
                <div key={i} className="text-[#a3e63599]">+ {line}</div>
              ))}
            </div>
          </div>
        )
      }
      return null
    case 'Write':
      if (input.content) {
        const preview = input.content.length > 500 ? input.content.slice(0, 500) + '...' : input.content
        return <div>{preview}</div>
      }
      return null
    case 'Grep':
      return (
        <div>
          <span className="text-[#059669]">pattern: </span>{input.pattern}
          {input.path && <><br /><span className="text-[#059669]">path: </span>{input.path}</>}
          {input.glob && <><br /><span className="text-[#059669]">glob: </span>{input.glob}</>}
        </div>
      )
    case 'Agent':
      return input.prompt ? <div>{input.prompt.slice(0, 500)}</div> : null
    default:
      return null
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
    case 'TaskCreate': return input.subject ?? ''
    case 'TaskUpdate': return `#${input.taskId} → ${input.status ?? ''}`
    case 'TodoWrite': return `${(input.todos ?? []).length} items`
    default: return JSON.stringify(input).slice(0, 120)
  }
}
