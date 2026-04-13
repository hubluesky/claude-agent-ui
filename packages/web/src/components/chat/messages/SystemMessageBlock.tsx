/**
 * System message rendering — handles all system subtypes.
 * Extracted from MessageComponent.tsx L243-331.
 */
import { memo } from 'react'
import type { AgentMessage } from '@claude-agent-ui/shared'

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

