import { useState, useRef, useEffect, memo } from 'react'
import type { AgentMessage } from '@claude-agent-ui/shared'
import { getToolCategory, TOOL_COLORS } from '@claude-agent-ui/shared'
import { ToolIcon, formatToolSummary } from './tool-display'
import { MarkdownRenderer } from './MarkdownRenderer'
import { useChatSession } from '../../providers/ChatSessionContext'
import { useSessionStore } from '../../stores/sessionStore'
import { wsManager } from '../../lib/WebSocketManager'
import { HighlightText } from './SearchBar'
import { ImagePreviewModal } from './ImagePreviewModal'

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

/** Parse <task-notification> XML block into structured data */
interface TaskNotificationData {
  taskId: string
  status: string
  summary: string
  outputFile?: string
}
function parseTaskNotificationXml(text: string): TaskNotificationData | null {
  if (!text.includes('<task-notification>')) return null
  const taskId = text.match(/<task-id>\s*(.*?)\s*<\/task-id>/)?.[1] ?? ''
  const status = text.match(/<status>\s*(.*?)\s*<\/status>/)?.[1] ?? 'completed'
  const summary = text.match(/<summary>\s*(.*?)\s*<\/summary>/s)?.[1] ?? ''
  const outputFile = text.match(/<output-file>\s*(.*?)\s*<\/output-file>/)?.[1]
  if (!taskId && !summary) return null
  return { taskId, status, summary, outputFile }
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

  if ((message as any)._streaming) return true

  if (message.type === 'system') {
    const sub = (message as any).subtype
    if (sub === 'api_retry') return true
    if (sub === 'status' && (message as any).status === 'compacting') return true
    if (sub === 'task_started') return true
    if (sub === 'task_progress') return !!(message as any).description || !!(message as any).summary || !!(message as any).content || !!(message as any).message
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
      <div className="flex items-start">
        <div className="flex-1 min-w-0 flex gap-3 items-start">
          <div className="w-7 h-7 rounded-full bg-[var(--bg-secondary)] border border-[var(--border)] flex items-center justify-center shrink-0">
            <span className="text-xs font-bold font-mono text-[var(--accent)]">C</span>
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            {contentBlocks.map((block: any, i: number) => {
              if (block.type === 'text') {
                const isStreaming = (message as any)._streaming === true
                const textClass = classifyText(block.text)
                if (textClass === 'internal-output') return null
                if (textClass === 'compact-summary') {
                  return (
                    <details key={i} className="bg-[var(--info-subtle-bg)] border border-[var(--info-subtle-border)] rounded-md px-3 py-2">
                      <summary className="text-xs text-[var(--cyan)] cursor-pointer">Context summary (compacted)</summary>
                      <div className="text-xs text-[var(--text-secondary)] mt-2 leading-relaxed overflow-hidden"><MarkdownRenderer content={block.text} /></div>
                    </details>
                  )
                }
                const assistantTaskNotif = parseTaskNotificationXml(block.text)
                if (assistantTaskNotif) return <TaskNotificationCard key={i} data={assistantTaskNotif} />
                if (isStreaming) {
                  // Streaming: plain text with cursor animation (no markdown — too expensive mid-stream)
                  if (!block.text) return null
                  return (
                    <div key={i} className="flex gap-3 items-start">
                      <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed flex-1">
                        {block.text}
                        <span className="inline-block w-2 h-4 bg-[var(--accent)] rounded-sm ml-0.5 animate-pulse" />
                      </p>
                    </div>
                  )
                }
                return <div key={i} className="text-sm text-[var(--text-primary)] leading-relaxed overflow-hidden"><MarkdownRenderer content={block.text} /></div>
              }
              if (block.type === 'thinking' || block.type === 'redacted_thinking') {
                const isStreaming = (message as any)._streaming === true
                const thinkingText = block.thinking || block.text || ''

                if (isStreaming) {
                  // Streaming: open display with cursor animation
                  if (!thinkingText) return null
                  return (
                    <div key={i} className="border-l-2 border-[var(--purple-subtle-border)] pl-3 py-1">
                      <p className="text-xs text-[var(--purple)] whitespace-pre-wrap leading-relaxed">
                        {thinkingText}
                        <span className="inline-block w-1.5 h-3 bg-[var(--purple)] rounded-sm ml-0.5 animate-pulse" />
                      </p>
                    </div>
                  )
                }

                // Final: existing collapsible rendering
                if (!thinkingText) {
                  return block.type === 'redacted_thinking' ? (
                    <div key={i} className="bg-[var(--purple-subtle-bg)] rounded-md px-3 py-2">
                      <span className="text-xs text-[#8b5cf680] italic">Thinking (redacted)</span>
                    </div>
                  ) : null
                }
                const charCount = thinkingText.length
                const charLabel = charCount >= 1000 ? `${(charCount / 1000).toFixed(1)}k` : String(charCount)
                return (
                  <details key={i} className="bg-[var(--purple-subtle-bg)] rounded-md px-3 py-2">
                    <summary className="text-xs text-[var(--purple)] cursor-pointer select-none">
                      Thinking — {charLabel} 字
                    </summary>
                    <p className="text-xs text-[var(--text-secondary)] mt-2 whitespace-pre-wrap leading-relaxed">
                      {thinkingText}
                    </p>
                  </details>
                )
              }
              if (block.type === 'tool_use' || block.type === 'server_tool_use') {
                if (block.name === 'TodoWrite') return <TodoWriteBlock key={i} block={block} />
                return <ToolUseBlock key={i} block={block} />
              }
              if (block.type === 'tool_result' || block.type === 'web_search_tool_result' || block.type === 'code_execution_tool_result') {
                // Hide tool_result for TodoWrite — the checklist already shows all info
                const prevBlock = contentBlocks[i - 1]
                if (prevBlock && (prevBlock.type === 'tool_use' || prevBlock.type === 'server_tool_use') && prevBlock.name === 'TodoWrite') return null
                return <ToolResultBlock key={i} block={block} />
              }
              return null
            })}
          </div>
        </div>
        {msgUuid && <MessageActions messageId={msgUuid} />}
      </div>
    )
  }

  // Result
  if (message.type === 'result') {
    const subtype = (message as any).subtype ?? ''
    if (subtype.startsWith('error')) {
      return (
        <div className="flex items-start gap-2.5 bg-[var(--error-subtle-bg)] border border-[var(--error-subtle-border)] rounded-md px-4 py-3">
          <div className="w-5 h-5 rounded-full bg-[var(--error)] flex items-center justify-center shrink-0">
            <span className="text-[11px] font-bold text-[var(--bg-primary)]">!</span>
          </div>
          <div>
            <p className="text-xs font-medium text-[var(--error)]">
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

  // System messages
  if (message.type === 'system') {
    const sub = (message as any).subtype
    if (sub === 'api_retry') {
      return (
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] bg-[var(--warning-subtle-bg)] border border-[var(--warning-subtle-border)] rounded-md px-3 py-2">
          <svg className="w-3.5 h-3.5 text-[var(--warning)] animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
          </svg>
          API retry (attempt {(message as any).attempt}/{(message as any).max_retries}) — waiting {(message as any).wait_seconds}s...
        </div>
      )
    }
    if (sub === 'status' && (message as any).status === 'compacting') {
      return (
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] bg-[var(--info-subtle-bg)] border border-[var(--info-subtle-border)] rounded-md px-3 py-2">
          <svg className="w-3.5 h-3.5 text-[var(--cyan)] animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
          </svg>
          Compacting context...
        </div>
      )
    }
    if (sub === 'task_started') {
      const taskId = (message as any).task_id
      const agentName = (message as any).agent_name ?? taskId ?? 'subagent'
      return <AgentCard agentId={taskId} agentName={agentName} />
    }
    if (sub === 'task_progress') {
      // SDK sends: description, summary, last_tool_name, usage
      const content = (message as any).description ?? (message as any).summary ?? (message as any).content ?? (message as any).message ?? ''
      if (!content) return null
      const lastTool = (message as any).last_tool_name
      const usage = (message as any).usage
      return (
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] ml-10 pl-5 border-l-2 border-[var(--purple-subtle-border)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--purple)]" />
          <span className="min-w-0 truncate">{typeof content === 'string' ? content.slice(0, 150) : JSON.stringify(content).slice(0, 150)}</span>
          {lastTool && <span className="text-[10px] text-[var(--purple)] bg-[#a855f71a] px-1.5 py-0.5 rounded shrink-0">{lastTool}</span>}
          {usage?.duration_ms != null && <span className="text-[10px] text-[var(--text-dim)] tabular-nums shrink-0">{(usage.duration_ms / 1000).toFixed(1)}s</span>}
        </div>
      )
    }
    if (sub === 'task_notification') {
      const status = (message as any).status ?? 'completed'
      const isError = status === 'error' || status === 'failed'
      const agentName = (message as any).agent_name ?? (message as any).task_id ?? 'subagent'
      const summary = (message as any).summary ?? ''
      const usage = (message as any).usage
      const durationMs = usage?.duration_ms ?? (message as any).duration_ms
      const toolCount = usage?.tool_uses ?? (message as any).tool_count
      return (
        <div className={`ml-10 rounded-md border overflow-hidden ${
          isError ? 'border-[var(--error-subtle-border)]' : 'border-[var(--success-subtle-border)]'
        }`}>
          {/* Status header */}
          <div className={`flex items-center gap-2 text-xs px-3 py-2 ${
            isError ? 'text-[var(--error)] bg-[var(--error-subtle-bg)]'
              : 'text-[var(--success)] bg-[var(--success-subtle-bg)]'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isError ? 'bg-[var(--error)]' : 'bg-[var(--success)]'}`} />
            <span className="font-semibold">{agentName}</span>
            <span>{status}</span>
            {durationMs != null && <span className="text-[10px] opacity-70 tabular-nums">— {(durationMs / 1000).toFixed(1)}s</span>}
            {toolCount != null && <span className="text-[10px] opacity-70">{toolCount} tools</span>}
          </div>
          {/* Summary content */}
          {summary && (
            <div className="px-3 py-2 text-xs text-[var(--text-secondary)] leading-relaxed overflow-hidden border-t border-[var(--border)]">
              <MarkdownRenderer content={summary} />
            </div>
          )}
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
        <div className="border border-[var(--border)] rounded-md overflow-hidden ml-10">
          <div className="px-3 py-2 text-xs font-mono text-[var(--text-secondary)] whitespace-pre-wrap break-all">
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
      <div className="border border-[var(--border)] rounded-md overflow-hidden ml-10">
        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-secondary)]">
          <div className="w-0.5 h-4 rounded-full bg-[var(--text-muted)]" />
          <span className="text-xs font-mono font-semibold text-[var(--text-muted)]">{toolName}</span>
          {summary && <span className="text-xs font-mono text-[var(--text-muted)] truncate flex-1">{typeof summary === 'string' ? summary.slice(0, 200) : JSON.stringify(summary).slice(0, 200)}</span>}
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
      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] ml-10">
        <svg className="w-3 h-3 text-[var(--success)] animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
        </svg>
        <span className="truncate">{typeof content === 'string' ? content : JSON.stringify(content).slice(0, 150)}</span>
        {elapsedStr && <span className="text-[var(--text-dim)] tabular-nums shrink-0">{elapsedStr}</span>}
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
      : 'bg-[var(--error-subtle-bg)] border border-[var(--error-subtle-border)]'
    const dotCls = isWarning ? 'bg-[var(--warning)]' : 'bg-[var(--error)]'
    const textCls = isWarning ? 'text-[var(--warning)]' : 'text-[var(--error)]'
    return (
      <div className={`flex items-center gap-2 rounded-md px-4 py-3 ${wrapCls}`}>
        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${dotCls}`}>
          <span className="text-[11px] font-bold text-[var(--bg-primary)]">{isWarning ? '⚠' : '!'}</span>
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

// ---- Message Actions (⋯ menu with Fork + Rewind) ----

function MessageActions({ messageId }: { messageId: string }) {
  const { forkSession, rewindFiles, rewindPreview: ctxRewindPreview } = useChatSession()
  const sessionId = useSessionStore((s) => s.currentSessionId)
  const [rewindPreview, setLocalRewindPreview] = useState<typeof ctxRewindPreview>(null)
  const [open, setOpen] = useState(false)
  const [showRewindPreview, setShowRewindPreview] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Sync rewindPreview from context when it changes
  useEffect(() => {
    if (showRewindPreview) {
      setLocalRewindPreview(ctxRewindPreview)
    }
  }, [ctxRewindPreview, showRewindPreview])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleFork = () => {
    forkSession(messageId)
    setOpen(false)
  }

  const handleRewindDryRun = () => {
    if (!sessionId || sessionId === '__new__') return
    setLocalRewindPreview(null)
    rewindFiles(messageId, true)
    setShowRewindPreview(true)
    setOpen(false)
  }

  const handleRewindConfirm = () => {
    if (!sessionId || sessionId === '__new__') return
    rewindFiles(messageId, false)
    setShowRewindPreview(false)
    setLocalRewindPreview(null)
  }

  const handleRewindClose = () => {
    setShowRewindPreview(false)
    setLocalRewindPreview(null)
  }

  const preview = showRewindPreview ? rewindPreview : null

  return (
    <>
      <div ref={ref} className="relative shrink-0 ml-1">
        <button
          onClick={() => setOpen(!open)}
          className="px-1 py-0.5 text-[11px] text-[var(--text-dim)] hover:text-[var(--text-secondary)] cursor-pointer transition-colors"
          title="操作"
        >
          ⋯
        </button>
        {open && (
          <div className="absolute top-full right-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-md shadow-lg z-10 py-1 min-w-[100px]">
            <button
              onClick={handleFork}
              className="w-full text-left px-3 py-1.5 text-[10px] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
            >
              Fork
            </button>
            <button
              onClick={handleRewindDryRun}
              className="w-full text-left px-3 py-1.5 text-[10px] text-[var(--text-secondary)] hover:text-[var(--info)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
            >
              Rewind
            </button>
          </div>
        )}
      </div>
      {showRewindPreview && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={handleRewindClose} />
          <div className="absolute right-0 top-full mt-1 w-72 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl z-50 p-3">
            <p className="text-xs text-[var(--text-secondary)] mb-2 font-medium">Rewind Preview</p>
            {!preview ? (
              <p className="text-[10px] text-[var(--text-muted)]">Loading...</p>
            ) : !preview.filesChanged?.length ? (
              <p className="text-[10px] text-[var(--text-muted)]">No files to rewind</p>
            ) : (
              <>
                <div className="space-y-1 max-h-40 overflow-y-auto mb-2">
                  {preview.filesChanged.map((f: string) => (
                    <div key={f} className="text-[10px] font-mono text-[var(--text-secondary)] truncate">{f}</div>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] mb-2">
                  <span className="text-[var(--success)]">+{preview.insertions ?? 0}</span>
                  <span className="text-[var(--error)]">-{preview.deletions ?? 0}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleRewindConfirm}
                    className="flex-1 px-2 py-1.5 text-xs text-[var(--text-primary)] bg-[var(--info)] rounded hover:bg-[var(--info-hover)] cursor-pointer"
                  >
                    Confirm Rewind
                  </button>
                  <button
                    onClick={handleRewindClose}
                    className="px-2 py-1.5 text-xs text-[var(--text-muted)] border border-[var(--border)] rounded hover:bg-[var(--bg-tertiary)] cursor-pointer"
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

function AgentCard({ agentId, agentName }: { agentId?: string; agentName: string }) {
  const [expanded, setExpanded] = useState(false)
  const { getSubagentMessages, subagentMessages: subagentData, sessionId } = useChatSession()
  const messages = (subagentData && subagentData.agentId === agentId) ? subagentData.messages : null

  const handleExpand = () => {
    if (!expanded && agentId && sessionId && sessionId !== '__new__') {
      getSubagentMessages(agentId)
    }
    setExpanded(!expanded)
  }

  return (
    <div className="ml-10 border border-[var(--purple-subtle-border)] rounded-md overflow-hidden">
      <div
        className="flex items-center gap-2 text-xs text-[var(--purple)] bg-[#a855f70a] px-3 py-2 cursor-pointer hover:bg-[#a855f712]"
        onClick={handleExpand}
      >
        <svg className="w-3.5 h-3.5 text-[var(--purple)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197" />
        </svg>
        <span className="flex-1">Agent: {agentName}</span>
        <span className="text-[#a855f780] bg-[#a855f71a] px-1.5 py-0.5 rounded text-[10px]">running</span>
        {agentId && <StopTaskButton taskId={agentId} />}
        <svg className={`w-3 h-3 text-[#a855f780] transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      {expanded && (
        <div className="border-t border-[var(--purple-subtle-border)] bg-[var(--bg-input)] max-h-60 overflow-y-auto">
          {messages === null ? (
            <div className="px-3 py-2 text-[10px] text-[var(--text-muted)]">Loading messages...</div>
          ) : messages.length === 0 ? (
            <div className="px-3 py-2 text-[10px] text-[var(--text-muted)]">No messages yet</div>
          ) : (
            <div className="py-1 space-y-1 px-2">
              {messages.map((m: any, i: number) => (
                <SubagentMessageRow key={m.uuid ?? i} msg={m} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SubagentMessageRow({ msg }: { msg: any }) {
  const role = msg.type ?? msg.message?.role ?? 'system'
  const content = msg.message?.content
  let text = ''
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    text = content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
  }
  if (!text) return null

  const preview = text.length > 200 ? text.slice(0, 200) + '...' : text
  const roleColor = role === 'assistant' ? 'var(--accent)' : role === 'user' ? 'var(--info)' : 'var(--text-muted)'

  return (
    <div className="text-[10px] leading-relaxed">
      <span className="font-medium" style={{ color: roleColor }}>{role}: </span>
      <span className="text-[var(--text-secondary)]">{preview}</span>
    </div>
  )
}

function StopTaskButton({ taskId }: { taskId: string }) {
  const { sessionId } = useChatSession()

  const handleStop = () => {
    if (sessionId && sessionId !== '__new__') {
      wsManager.send({ type: 'stop-task', sessionId, taskId } as any)
    }
  }

  return (
    <button
      onClick={handleStop}
      className="px-1.5 py-0.5 text-[10px] text-[var(--error)] bg-[var(--error-subtle-bg)] border border-[var(--error-subtle-border)] rounded hover:bg-[#f871711a] transition-colors cursor-pointer"
      title="Stop this task"
    >
      Stop
    </button>
  )
}

// ---- Task Notification Card ----

function TaskNotificationCard({ data }: { data: TaskNotificationData }) {
  const isError = data.status === 'failed' || data.status === 'error'
  const isCompleted = data.status === 'completed'
  const dotClass = isError ? 'bg-[var(--error)]'
    : isCompleted ? 'bg-[var(--success)]'
    : 'bg-[var(--warning)]'
  const borderClass = isError ? 'border-[var(--error-subtle-border)]'
    : isCompleted ? 'border-[var(--success-subtle-border)]'
    : 'border-[var(--warning-subtle-border)]'
  const headerBg = isError ? 'bg-[var(--error-subtle-bg)]'
    : isCompleted ? 'bg-[var(--success-subtle-bg)]'
    : 'bg-[var(--warning-subtle-bg)]'
  const headerText = isError ? 'text-[var(--error)]'
    : isCompleted ? 'text-[var(--success)]'
    : 'text-[var(--warning)]'

  return (
    <div className={`rounded-md border overflow-hidden ${borderClass}`}>
      <div className={`flex items-center gap-2 px-3 py-2 ${headerBg}`}>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
        <svg className={`w-3.5 h-3.5 shrink-0 ${headerText}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
        </svg>
        <span className={`text-xs font-semibold ${headerText}`}>
          {data.status === 'completed' ? '后台任务完成' : data.status === 'failed' ? '后台任务失败' : `后台任务 ${data.status}`}
        </span>
        {data.taskId && <span className={`text-[10px] ${headerText} opacity-60 ml-auto font-mono`}>{data.taskId}</span>}
      </div>
      {data.summary && (
        <div className="px-3 py-2 text-xs text-[var(--text-secondary)] leading-relaxed">
          {data.summary}
        </div>
      )}
    </div>
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
        className="group flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] hover:border-[var(--accent)] hover:bg-[#d977060a] transition-colors text-left cursor-pointer"
      >
        <span className="text-[var(--accent)] text-xs shrink-0">&#10148;</span>
        <span className="text-xs text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">{suggestion}</span>
      </button>
    </div>
  )
}

// ---- User Message (extracted for Rewind button wrapper) ----

function UserMessage({ message, isOptimistic, uuid }: { message: AgentMessage; isOptimistic?: boolean; uuid?: string }) {
  const content = (message as any).message?.content
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)

  const renderContent = () => {
    if (Array.isArray(content)) {
      return (
        <>
          {content.map((block: any, i: number) => {
            if (block.type === 'tool_result') {
              // Hide TodoWrite results — the checklist already shows all info
              const text = typeof block.content === 'string' ? block.content
                : Array.isArray(block.content) ? block.content.map((c: any) => c.text ?? '').join('') : ''
              if (text.startsWith('Todos have been modified')) return null
              return <ToolResultBlock key={i} block={block} />
            }
            if (block.type === 'image' && block.source?.type === 'base64') {
              const src = `data:${block.source.media_type};base64,${block.source.data}`
              return (
                <div key={i} className="flex justify-end">
                  <img
                    src={src}
                    alt="attached"
                    loading="lazy"
                    className="max-w-[70%] max-h-[400px] rounded-lg border border-[var(--border)] cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => setPreviewSrc(src)}
                  />
                </div>
              )
            }
            if (block.type === 'text') {
              const textClass = classifyText(block.text)
              if (textClass === 'internal-output') return null
              if (textClass === 'compact-summary') {
                return (
                  <details key={i} className="bg-[var(--info-subtle-bg)] border border-[var(--info-subtle-border)] rounded-md px-3 py-2">
                    <summary className="text-xs text-[var(--cyan)] cursor-pointer">Context summary (compacted)</summary>
                    <div className="text-xs text-[var(--text-secondary)] mt-2 leading-relaxed whitespace-pre-wrap">{block.text}</div>
                  </details>
                )
              }
              const taskNotif = parseTaskNotificationXml(block.text)
              if (taskNotif) return <TaskNotificationCard key={i} data={taskNotif} />
              const cmdText = parseCommandXml(block.text)
              if (cmdText) {
                return (
                  <div key={i} className="flex justify-end">
                    <div className="bg-[var(--accent-bg)] rounded-xl rounded-br-sm px-4 py-2.5 max-w-[70%] flex items-center gap-2">
                      <span className="text-xs font-mono text-[var(--accent)] bg-[#d9770620] px-1.5 py-0.5 rounded">/</span>
                      <span className="text-sm text-[var(--text-primary)]">{cmdText}</span>
                    </div>
                  </div>
                )
              }
              return (
                <div key={i} className="flex justify-end">
                  <div className={`bg-[var(--accent-bg)] rounded-xl rounded-br-sm px-4 py-3 max-w-[70%]${isOptimistic ? ' opacity-60' : ''}`}>
                    <HighlightText text={block.text} className="text-sm text-[var(--text-primary)] whitespace-pre-wrap" />
                    {isOptimistic && <span className="text-[10px] text-[var(--text-muted)] float-right mt-0.5 tracking-widest">···</span>}
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
        <details className="bg-[var(--info-subtle-bg)] border border-[var(--info-subtle-border)] rounded-md px-3 py-2">
          <summary className="text-xs text-[var(--cyan)] cursor-pointer">Context summary (compacted)</summary>
          <div className="text-xs text-[var(--text-secondary)] mt-2 leading-relaxed whitespace-pre-wrap">{rawText}</div>
        </details>
      )
    }
    const rawTaskNotif = parseTaskNotificationXml(rawText)
    if (rawTaskNotif) return <TaskNotificationCard data={rawTaskNotif} />
    const cmdText = parseCommandXml(rawText)
    if (cmdText) {
      return (
        <div className="flex justify-end">
          <div className="bg-[var(--accent-bg)] rounded-xl rounded-br-sm px-4 py-2.5 max-w-[70%] flex items-center gap-2">
            <span className="text-xs font-mono text-[var(--accent)] bg-[#d9770620] px-1.5 py-0.5 rounded">/</span>
            <span className="text-sm text-[var(--text-primary)]">{cmdText}</span>
          </div>
        </div>
      )
    }
    return (
      <div className="flex justify-end">
        <div className={`bg-[var(--accent-bg)] rounded-xl rounded-br-sm px-4 py-3 max-w-[70%]${isOptimistic ? ' opacity-60' : ''}`}>
          <HighlightText text={rawText} className="text-sm text-[var(--text-primary)] whitespace-pre-wrap" />
          {isOptimistic && <span className="text-[10px] text-[var(--text-muted)] float-right mt-0.5 tracking-widest">···</span>}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start">
      <div className="flex-1 min-w-0">
        {renderContent()}
      </div>
      {uuid && <MessageActions messageId={uuid} />}
      {previewSrc && <ImagePreviewModal src={previewSrc} name="attached" onClose={() => setPreviewSrc(null)} />}
    </div>
  )
}


// ---- TodoWrite Block (VSCode-style checklist) ----

function TodoCheckbox({ status }: { status: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = status === 'in_progress'
    }
  }, [status])
  return (
    <input
      ref={ref}
      type="checkbox"
      className="todo-checkbox"
      checked={status === 'completed'}
      readOnly
      tabIndex={-1}
    />
  )
}

function TodoWriteBlock({ block }: { block: any }) {
  const todos = (block.input?.todos as Array<{ content: string; status: string }>) ?? []
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 py-1">
        <div className="w-2 h-2 rounded-full bg-[var(--success)] shrink-0" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">Update Todos</span>
      </div>
      <div className="pl-4 flex flex-col gap-1">
        {todos.map((todo, i) => (
          <div key={i} className="flex items-start gap-2">
            <TodoCheckbox status={todo.status} />
            <span className={`text-sm leading-relaxed ${
              todo.status === 'completed'
                ? 'line-through text-[var(--text-secondary)] opacity-70'
                : todo.status === 'in_progress'
                  ? 'font-semibold text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)]'
            }`}>
              {todo.content}
            </span>
          </div>
        ))}
      </div>
    </div>
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
    <div className="border border-[var(--border)] rounded-md overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-secondary)] cursor-pointer hover:bg-[var(--bg-hover)]"
        onClick={() => detail && setExpanded(!expanded)}
      >
        <div className="w-0.5 h-4 rounded-full" style={{ backgroundColor: color }} />
        <ToolIcon category={category} />
        <span className="text-xs font-mono font-semibold" style={{ color }}>{name}</span>
        <span className="text-xs font-mono text-[var(--text-muted)] truncate flex-1">{summary}</span>
        {detail && (
          <svg className={`w-3 h-3 text-[var(--text-muted)] transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>
      {expanded && detail && (
        <div className="border-t border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2.5 text-xs font-mono text-[var(--text-secondary)] whitespace-pre-wrap break-all">
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
      isDenial ? 'border-[var(--accent-subtle-border)] bg-[#d977060a]'
        : isError ? 'border-[var(--error-subtle-border)] bg-[var(--error-subtle-bg)]'
        : 'border-[var(--border)] bg-[var(--bg-secondary)]'
    }`}>
      <div
        className={`flex items-center gap-2 px-3 py-1.5 ${isLong ? 'cursor-pointer hover:bg-[var(--bg-hover)]' : ''}`}
        onClick={() => isLong && setExpanded(!expanded)}
      >
        <div className={`w-0.5 h-3 rounded-full ${isDenial ? 'bg-[var(--accent)]' : isError ? 'bg-[var(--error)]' : 'bg-[var(--text-muted)]'}`} />
        <span className={`text-[10px] font-mono ${isDenial ? 'text-[var(--accent)]' : isError ? 'text-[var(--error)]' : 'text-[var(--text-muted)]'}`}>
          {isDenial ? '拒绝' : isError ? '错误' : '结果'}
        </span>
        <span className="flex-1" />
        {isLong && (
          <svg className={`w-3 h-3 text-[var(--text-muted)] transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>
      <div className="px-3 py-2 text-xs font-mono text-[var(--text-secondary)] whitespace-pre-wrap break-all">
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
      {filePath && <div className="text-[10px] text-[var(--text-muted)] mb-1 font-sans">{filePath}</div>}
      <div className="rounded overflow-hidden border border-[var(--border)]">
        {oldLines.map((line, i) => (
          <div key={`d${i}`} className="flex bg-[var(--error-subtle-bg)]">
            <span className="w-8 text-right pr-2 text-[#f8717166] select-none shrink-0 border-r border-[var(--border)]">{i + 1}</span>
            <span className="px-2 text-[#f87171cc] whitespace-pre-wrap break-all">- {line}</span>
          </div>
        ))}
        {newLines.map((line, i) => (
          <div key={`a${i}`} className="flex bg-[#3fb95010]">
            <span className="w-8 text-right pr-2 text-[#3fb95066] select-none shrink-0 border-r border-[var(--border)]">{i + 1}</span>
            <span className="px-2 text-[#3fb950cc] whitespace-pre-wrap break-all">+ {line}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-3 mt-1 text-[10px] text-[var(--text-muted)] font-sans">
        <span className="text-[var(--error)]">-{oldLines.length}</span>
        <span className="text-[var(--success)]">+{newLines.length}</span>
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
          <div className="text-[var(--success)] mb-1">$ {input.command}</div>
          {input.description && <div className="text-[var(--text-muted)] text-[10px] mb-1">{input.description}</div>}
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
          <span className="text-[var(--success)]">pattern: </span>{input.pattern}
          {input.path && <><br /><span className="text-[var(--success)]">path: </span>{input.path}</>}
          {input.glob && <><br /><span className="text-[var(--success)]">glob: </span>{input.glob}</>}
        </div>
      )
    case 'Agent':
      return input.prompt ? <div>{input.prompt.slice(0, 500)}</div> : null
    default:
      return null
  }
}

