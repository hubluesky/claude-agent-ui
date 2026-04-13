/**
 * System message rendering — handles all system subtypes.
 * Extracted from MessageComponent.tsx L243-331.
 */
import { useState, memo } from 'react'
import type { AgentMessage } from '@claude-agent-ui/shared'
import { MarkdownRenderer } from '../MarkdownRenderer'
import { useChatSession } from '../../../providers/ChatSessionContext'
import { wsManager } from '../../../lib/WebSocketManager'

interface Props {
  message: AgentMessage
}

export const SystemMessageBlock = memo(function SystemMessageBlock({ message }: Props) {
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
    const content = (message as any).description ?? (message as any).summary ?? (message as any).content ?? (message as any).message ?? ''
    if (!content) return null
    const lastTool = (message as any).last_tool_name
    const usage = (message as any).usage
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] pl-4 border-l-2 border-[var(--purple-subtle-border)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--purple)] shrink-0" />
        {lastTool && <span className="font-mono font-semibold text-[var(--purple)] shrink-0">{lastTool}</span>}
        {usage?.duration_ms != null && <span className="text-[10px] text-[var(--text-dim)] tabular-nums shrink-0">{(usage.duration_ms / 1000).toFixed(1)}s</span>}
        <span className="font-mono truncate flex-1">{typeof content === 'string' ? content.slice(0, 150) : JSON.stringify(content).slice(0, 150)}</span>
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
      <div className={`rounded-md border overflow-hidden ${isError ? 'border-[var(--error-subtle-border)]' : 'border-[var(--success-subtle-border)]'}`}>
        <div className={`flex items-center gap-2 text-xs px-3 py-2 ${isError ? 'text-[var(--error)] bg-[var(--error-subtle-bg)]' : 'text-[var(--success)] bg-[var(--success-subtle-bg)]'}`}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isError ? 'bg-[var(--error)]' : 'bg-[var(--success)]'}`} />
          <span className="font-semibold">{agentName}</span>
          <span>{status}</span>
          {durationMs != null && <span className="text-[10px] opacity-70 tabular-nums">— {(durationMs / 1000).toFixed(1)}s</span>}
          {toolCount != null && <span className="text-[10px] opacity-70">{toolCount} tools</span>}
        </div>
        {summary && (
          <div className="px-3 py-2 text-xs text-[var(--text-secondary)] leading-relaxed overflow-hidden border-t border-[var(--border)]">
            <MarkdownRenderer content={summary} />
          </div>
        )}
      </div>
    )
  }

  if (sub === 'local_command_output') {
    const output = (message as any).output ?? (message as any).content ?? ''
    if (!output) return null
    return (
      <div className="border border-[var(--border)] rounded-md overflow-hidden">
        <div className="px-3 py-2 text-xs font-mono text-[var(--text-secondary)] whitespace-pre-wrap break-all">
          {typeof output === 'string' ? output : JSON.stringify(output)}
        </div>
      </div>
    )
  }

  return null
})

// ─── AgentCard ───────────────────────────────────────────

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
    <div className="border border-[var(--purple-subtle-border)] rounded-md overflow-hidden">
      <div className="flex items-center gap-2 text-xs text-[var(--purple)] bg-[#a855f70a] px-3 py-2 cursor-pointer hover:bg-[#a855f712]" onClick={handleExpand}>
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
              {messages.map((m: any, i: number) => {
                const role = m.type ?? m.message?.role ?? 'system'
                const content = m.message?.content
                let text = ''
                if (typeof content === 'string') text = content
                else if (Array.isArray(content)) text = content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
                if (!text) return null
                const preview = text.length > 200 ? text.slice(0, 200) + '...' : text
                const roleColor = role === 'assistant' ? 'var(--accent)' : role === 'user' ? 'var(--info)' : 'var(--text-muted)'
                return (
                  <div key={m.uuid ?? i} className="text-[10px] leading-relaxed">
                    <span className="font-medium" style={{ color: roleColor }}>{role}: </span>
                    <span className="text-[var(--text-secondary)]">{preview}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StopTaskButton({ taskId }: { taskId: string }) {
  const { sessionId } = useChatSession()
  return (
    <button
      onClick={() => { if (sessionId && sessionId !== '__new__') wsManager.send({ type: 'stop-task', sessionId, taskId } as any) }}
      className="px-1.5 py-0.5 text-[10px] text-[var(--error)] bg-[var(--error-subtle-bg)] border border-[var(--error-subtle-border)] rounded hover:bg-[#f871711a] transition-colors cursor-pointer"
      title="Stop this task"
    >
      Stop
    </button>
  )
}
