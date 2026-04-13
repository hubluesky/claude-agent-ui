/**
 * MessageComponent — Thin dispatch layer for normalized messages.
 *
 * After the normalizeMessages pipeline, each message contains exactly ONE
 * content block. This component routes to the appropriate block renderer.
 *
 * Architecture mirrors Claude Code's Message.tsx → AssistantMessageBlock / UserMessage dispatch.
 */

import { memo } from 'react'
import type { NormalizedMessage } from '../../utils/normalizeMessages'
import type { RenderableItem } from '../../utils/collapseReadSearch'
import { isCollapsedGroup, type CollapsedGroup } from '../../utils/collapseReadSearch'
import type { MessageLookups } from '../../utils/messageLookups'
import { useChatSession } from '../../providers/ChatSessionContext'

// Block components
import { AssistantTextBlock } from './messages/AssistantTextBlock'
import { AssistantToolUseBlock } from './messages/AssistantToolUseBlock'
import { UserTextBlock } from './messages/UserTextBlock'
import { UserImageBlock } from './messages/UserImageBlock'
import { SystemMessageBlock } from './messages/SystemMessageBlock'
import { ResultBlock, ToolUseSummaryBlock, ToolProgressBlock, RateLimitBlock } from './messages/PassthroughBlocks'
import { CollapsedReadSearchBlock } from './messages/CollapsedReadSearchBlock'

// ─── Props ───────────────────────────────────────────────

interface MessageComponentProps {
  item: RenderableItem
  lookups: MessageLookups
}

// ─── Main Component ──────────────────────────────────────

export const MessageComponent = memo(function MessageComponent({ item, lookups }: MessageComponentProps) {
  // Collapsed read/search group
  if (isCollapsedGroup(item)) {
    return <CollapsedReadSearchBlock group={item as CollapsedGroup} />
  }

  const msg = item as NormalizedMessage

  // Normalized messages (assistant/user with single block)
  if (msg._kind === 'normalized') {
    if (msg.role === 'assistant') {
      return <AssistantBlockDispatch msg={msg} lookups={lookups} />
    }
    if (msg.role === 'user') {
      return <UserBlockDispatch msg={msg} />
    }
    return null
  }

  // Passthrough messages (system, result, tool_progress, etc.)
  if (msg._kind === 'passthrough') {
    return <PassthroughDispatch msg={msg} />
  }

  return null
})

// ─── Assistant Block Router ──────────────────────────────

function AssistantBlockDispatch({ msg, lookups }: { msg: NormalizedMessage; lookups: MessageLookups }) {
  const block = msg.block
  if (!block) return null

  const content = (
    <>
      {block.type === 'text' && <AssistantTextBlock block={block} />}
      {(block.type === 'tool_use' || block.type === 'server_tool_use') && (
        <AssistantToolUseBlock block={block} lookups={lookups} />
      )}
      {/* thinking/redacted_thinking: hidden by default (filtered in pipeline) */}
    </>
  )

  return (
    <div className="group relative pl-3 border-l-[3px] border-[var(--accent)] border-opacity-50">
      <MessageActions messageId={msg.uuid} />
      {content}
    </div>
  )
}

// ─── User Block Router ───────────────────────────────────

function UserBlockDispatch({ msg }: { msg: NormalizedMessage }) {
  const block = msg.block
  if (!block) return null

  return (
    <div className="group relative">
      {block.type === 'text' && <UserTextBlock block={block} isOptimistic={msg.isOptimistic} />}
      {block.type === 'image' && <UserImageBlock block={block} />}
      {/* tool_result: absorbed by tool_use (filtered in pipeline), not rendered here */}
      <MessageActions messageId={msg.uuid} />
    </div>
  )
}

// ─── Passthrough Router ──────────────────────────────────

function PassthroughDispatch({ msg }: { msg: NormalizedMessage }) {
  const original = msg.original
  switch (original.type) {
    case 'system':
      return <SystemMessageBlock message={original} />
    case 'result':
      return <ResultBlock message={original} />
    case 'tool_use_summary':
      return <ToolUseSummaryBlock message={original} />
    case 'tool_progress':
      return <ToolProgressBlock message={original} />
    case 'rate_limit_event':
      return <RateLimitBlock message={original} />
    default:
      return null
  }
}

// ─── Message Actions (Fork button) ───────────────────────

function MessageActions({ messageId }: { messageId: string }) {
  const { forkSession } = useChatSession()
  return (
    <button
      onClick={() => forkSession(messageId)}
      className="absolute top-1 right-1.5 opacity-0 group-hover:opacity-100 transition-all text-[10px] text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)]/30 hover:bg-[var(--bg-hover)] cursor-pointer border border-[var(--border)] rounded-[5px] bg-[var(--bg-secondary)] px-2.5 py-0.5"
      title="Fork"
    >
      Fork
    </button>
  )
}

// ─── Legacy export for backward compatibility during transition ───
// TODO: Remove once all consumers migrate to the new pipeline
export { isBlockVisible as isMessageVisible } from '../../utils/messageVisibility'
