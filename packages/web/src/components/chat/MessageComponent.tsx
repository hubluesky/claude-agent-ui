import { useState, memo } from 'react'
import type { AgentMessage } from '@claude-agent-ui/shared'
import { getToolCategory, TOOL_COLORS } from '@claude-agent-ui/shared'
import { ToolIcon, formatToolSummary } from './tool-display'
import { MarkdownRenderer } from './MarkdownRenderer'
import { useWebSocket } from '../../hooks/useWebSocket'
import { useSessionStore } from '../../stores/sessionStore'

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
    const userUuid = (message as any).uuid as string | undefined
    return <UserMessage message={message} isOptimistic={isOptimistic} uuid={userUuid} />
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
    const msgUuid = (message as any).uuid as string | undefined
    return (
      <div className="group/msg relative flex gap-3 items-start">
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
        {msgUuid && <ForkButton messageId={msgUuid} />}
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
              {subtype === 'error_max_turns' ? '已达最大轮次'
                : subtype === 'error_max_budget_usd' ? '已达预算上限'
                : '执行出错'}
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
      const taskId = (message as any).task_id
      return (
        <div className="flex items-center gap-2 text-xs text-[#a855f7] bg-[#a855f70a] border border-[#a855f726] rounded-md px-3 py-2 ml-10">
          <svg className="w-3.5 h-3.5 text-[#a855f7]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197" />
          </svg>
          <span className="flex-1">Agent: {(message as any).agent_name ?? taskId ?? 'subagent'}</span>
          <span className="text-[#a855f780] bg-[#a855f71a] px-1.5 py-0.5 rounded text-[10px]">running</span>
          {taskId && <StopTaskButton taskId={taskId} />}
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
    const rawElapsed = (message as any).elapsed_time_seconds
    const elapsed = typeof rawElapsed === 'number' ? rawElapsed : undefined
    const elapsedStr = elapsed != null ? `${elapsed.toFixed(1)}s` : null
    return (
      <div className="flex items-center gap-2 text-xs text-[#7c7872] ml-10">
        <svg className="w-3 h-3 text-[#059669] animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
        </svg>
        <span className="truncate">{typeof content === 'string' ? content : JSON.stringify(content).slice(0, 150)}</span>
        {elapsedStr && <span className="text-[#5c5954] tabular-nums shrink-0">{elapsedStr}</span>}
      </div>
    )
  }

  // Rate limit event — distinguish warning vs rejected
  if (message.type === 'rate_limit_event') {
    const rlType = (message as any).rate_limit_type ?? (message as any).subtype
    const isWarning = rlType === 'allowed_warning'
    const retryAfter = (message as any).retry_after ?? 30
    const wrapCls = isWarning
      ? 'bg-[#f59e0b0a] border border-[#f59e0b26]'
      : 'bg-[#f871710a] border border-[#f8717126]'
    const dotCls = isWarning ? 'bg-[#f59e0b]' : 'bg-[#f87171]'
    const textCls = isWarning ? 'text-[#f59e0b]' : 'text-[#f87171]'
    return (
      <div className={`flex items-center gap-2 rounded-md px-4 py-3 ${wrapCls}`}>
        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${dotCls}`}>
          <span className="text-[11px] font-bold text-[#1c1b18]">{isWarning ? '⚠' : '!'}</span>
        </div>
        <p className={`text-xs ${textCls}`}>
          {isWarning
            ? 'Approaching rate limit. Requests may slow down.'
            : `Rate limit exceeded. Retrying in ${retryAfter}s...`}
        </p>
      </div>
    )
  }

  // Prompt suggestion
  if (message.type === 'prompt_suggestion') {
    const suggestion = (message as any).suggestion as string
    if (!suggestion) return null
    return <PromptSuggestionCard suggestion={suggestion} />
  }

  return null
})

// ---- Stop Task Button ----

function ForkButton({ messageId }: { messageId: string }) {
  const { forkSession } = useWebSocket()
  const sessionId = useSessionStore((s) => s.currentSessionId)

  const handleFork = () => {
    if (sessionId && sessionId !== '__new__') {
      forkSession(sessionId, messageId)
    }
  }

  return (
    <button
      onClick={handleFork}
      className="absolute top-0 right-0 opacity-0 group-hover/msg:opacity-100 transition-opacity px-2 py-1 text-[10px] text-[#a8a29e] bg-[#242320] border border-[#3d3b37] rounded-md hover:text-[#d97706] hover:border-[#d97706] cursor-pointer"
      title="Fork — 从这条消息分叉新会话"
    >
      ⚲ Fork
    </button>
  )
}

function StopTaskButton({ taskId }: { taskId: string }) {
  const { send } = useWebSocket()
  const sessionId = useSessionStore((s) => s.currentSessionId)

  const handleStop = () => {
    if (sessionId && sessionId !== '__new__') {
      send({ type: 'stop-task', sessionId, taskId } as any)
    }
  }

  return (
    <button
      onClick={handleStop}
      className="px-1.5 py-0.5 text-[10px] text-[#f87171] bg-[#f871710a] border border-[#f8717126] rounded hover:bg-[#f871711a] transition-colors cursor-pointer"
      title="Stop this task"
    >
      Stop
    </button>
  )
}

// ---- Prompt Suggestion Card ----

function PromptSuggestionCard({ suggestion }: { suggestion: string }) {
  const handleClick = () => {
    useSessionStore.getState().setComposerDraft(suggestion)
  }

  return (
    <div className="ml-10 mt-1">
      <button
        onClick={handleClick}
        className="group flex items-center gap-2 px-3 py-2 rounded-lg border border-[#3d3b37] bg-[#1e1d1a] hover:border-[#d97706] hover:bg-[#d977060a] transition-colors text-left cursor-pointer"
      >
        <span className="text-[#d97706] text-xs shrink-0">&#10148;</span>
        <span className="text-xs text-[#a8a29e] group-hover:text-[#e5e2db] transition-colors">{suggestion}</span>
      </button>
    </div>
  )
}

// ---- User Message (extracted for Rewind button wrapper) ----

function UserMessage({ message, isOptimistic, uuid }: { message: AgentMessage; isOptimistic?: boolean; uuid?: string }) {
  const content = (message as any).message?.content

  const renderContent = () => {
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
              if (textClass === 'internal-output') return null
              if (textClass === 'compact-summary') {
                return (
                  <details key={i} className="bg-[#0ea5e90a] border border-[#0ea5e926] rounded-md px-3 py-2">
                    <summary className="text-xs text-[#0ea5e9] cursor-pointer">Context summary (compacted)</summary>
                    <div className="text-xs text-[#a8a29e] mt-2 leading-relaxed whitespace-pre-wrap">{block.text}</div>
                  </details>
                )
              }
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
    const rawTextClass = classifyText(rawText)
    if (rawTextClass === 'internal-output') return null
    if (rawTextClass === 'compact-summary') {
      return (
        <details className="bg-[#0ea5e90a] border border-[#0ea5e926] rounded-md px-3 py-2">
          <summary className="text-xs text-[#0ea5e9] cursor-pointer">Context summary (compacted)</summary>
          <div className="text-xs text-[#a8a29e] mt-2 leading-relaxed whitespace-pre-wrap">{rawText}</div>
        </details>
      )
    }
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

  return (
    <div className="group/usr relative">
      {renderContent()}
      {uuid && <RewindButton messageId={uuid} />}
    </div>
  )
}

// ---- Rewind Button ----

function RewindButton({ messageId }: { messageId: string }) {
  const { rewindFiles } = useWebSocket()
  const sessionId = useSessionStore((s) => s.currentSessionId)
  const [showPreview, setShowPreview] = useState(false)
  const [preview, setPreview] = useState<{ filesChanged?: string[]; insertions?: number; deletions?: number } | null>(null)

  const handleDryRun = () => {
    if (!sessionId || sessionId === '__new__') return
    rewindFiles(sessionId, messageId, true)
    setShowPreview(true)

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      setPreview(detail)
      window.removeEventListener('rewind-preview', handler)
    }
    window.addEventListener('rewind-preview', handler)
  }

  const handleRewind = () => {
    if (!sessionId || sessionId === '__new__') return
    rewindFiles(sessionId, messageId, false)
    setShowPreview(false)
    setPreview(null)
  }

  return (
    <>
      <button
        onClick={handleDryRun}
        className="opacity-0 group-hover/usr:opacity-100 transition-opacity px-2 py-0.5 text-[10px] text-[#a8a29e] bg-[#242320] border border-[#3d3b37] rounded hover:text-[#60a5fa] hover:border-[#60a5fa] cursor-pointer absolute top-0 left-0"
        title="Rewind files to this point"
      >
        ⏪ Rewind
      </button>
      {showPreview && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => { setShowPreview(false); setPreview(null) }} />
          <div className="absolute left-0 top-full mt-1 w-72 bg-[#242320] border border-[#3d3b37] rounded-lg shadow-xl z-50 p-3">
            <p className="text-xs text-[#a8a29e] mb-2 font-medium">Rewind Preview</p>
            {!preview ? (
              <p className="text-[10px] text-[#7c7872]">Loading...</p>
            ) : !preview.filesChanged?.length ? (
              <p className="text-[10px] text-[#7c7872]">No files to rewind</p>
            ) : (
              <>
                <div className="space-y-1 max-h-40 overflow-y-auto mb-2">
                  {preview.filesChanged.map((f: string) => (
                    <div key={f} className="text-[10px] font-mono text-[#a8a29e] truncate">{f}</div>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-[#7c7872] mb-2">
                  <span className="text-[#3fb950]">+{preview.insertions ?? 0}</span>
                  <span className="text-[#f87171]">-{preview.deletions ?? 0}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleRewind}
                    className="flex-1 px-2 py-1.5 text-xs text-[#e5e2db] bg-[#60a5fa] rounded hover:bg-[#3b82f6] cursor-pointer"
                  >
                    Confirm Rewind
                  </button>
                  <button
                    onClick={() => { setShowPreview(false); setPreview(null) }}
                    className="px-2 py-1.5 text-xs text-[#7c7872] border border-[#3d3b37] rounded hover:bg-[#1e1d1a] cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  )
}

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

  // Distinguish user-initiated denials (short messages) from real execution errors
  const isDenial = isError && text.length < 200
  const preview = text.length > 120 ? text.slice(0, 120) + '...' : text
  const isLong = text.length > 120

  return (
    <div className={`border rounded-md overflow-hidden ml-10 ${
      isDenial ? 'border-[#d9770626] bg-[#d977060a]'
        : isError ? 'border-[#f8717126] bg-[#f871710a]'
        : 'border-[#3d3b37] bg-[#242320]'
    }`}>
      <div
        className={`flex items-center gap-2 px-3 py-1.5 ${isLong ? 'cursor-pointer hover:bg-[#2b2a2780]' : ''}`}
        onClick={() => isLong && setExpanded(!expanded)}
      >
        <div className={`w-0.5 h-3 rounded-full ${isDenial ? 'bg-[#d97706]' : isError ? 'bg-[#f87171]' : 'bg-[#6b7280]'}`} />
        <span className={`text-[10px] font-mono ${isDenial ? 'text-[#d97706]' : isError ? 'text-[#f87171]' : 'text-[#7c7872]'}`}>
          {isDenial ? '拒绝' : isError ? '错误' : '结果'}
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

// ---- Inline Diff ----

function InlineDiff({ filePath, oldStr, newStr }: { filePath?: string; oldStr: string; newStr: string }) {
  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')

  return (
    <div className="font-mono text-[11px] leading-[1.6]">
      {filePath && <div className="text-[10px] text-[#7c7872] mb-1 font-sans">{filePath}</div>}
      <div className="rounded overflow-hidden border border-[#3d3b37]">
        {oldLines.map((line, i) => (
          <div key={`d${i}`} className="flex bg-[#f871710a]">
            <span className="w-8 text-right pr-2 text-[#f8717166] select-none shrink-0 border-r border-[#3d3b37]">{i + 1}</span>
            <span className="px-2 text-[#f87171cc] whitespace-pre-wrap break-all">- {line}</span>
          </div>
        ))}
        {newLines.map((line, i) => (
          <div key={`a${i}`} className="flex bg-[#3fb95010]">
            <span className="w-8 text-right pr-2 text-[#3fb95066] select-none shrink-0 border-r border-[#3d3b37]">{i + 1}</span>
            <span className="px-2 text-[#3fb950cc] whitespace-pre-wrap break-all">+ {line}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-3 mt-1 text-[10px] text-[#7c7872] font-sans">
        <span className="text-[#f87171]">-{oldLines.length}</span>
        <span className="text-[#3fb950]">+{newLines.length}</span>
      </div>
    </div>
  )
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
      if (input.old_string != null && input.new_string != null) {
        return <InlineDiff filePath={input.file_path} oldStr={input.old_string} newStr={input.new_string} />
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

