# Subagent 渲染对齐 CLI 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 subagent 渲染从散落的 4+ 独立消息聚合到 Agent tool_use/tool_result 块内，完全对齐 Claude Code CLI 的渲染方式。

**Architecture:** 前端过滤 task_* 系统消息并聚合到 Agent tool 块内渲染；服务端实现 getSubagentMessages 接口调用 SDK API；点击展开显示完整 transcript。

**Tech Stack:** React 19, Zustand 5, @anthropic-ai/claude-agent-sdk (server-side), Fastify WebSocket

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `packages/web/src/utils/messageVisibility.ts` | 过滤 task_* 消息不可见 | Modify |
| `packages/web/src/utils/messageLookups.ts` | 添加 agentProgress 映射 | Modify |
| `packages/web/src/hooks/useProcessedMessages.ts` | 传入 rawMessages 到 lookups 构建 | Modify (minor) |
| `packages/web/src/components/chat/messages/AssistantToolUseBlock.tsx` | 重写 Agent 分支：完成统计 + 展开 | Modify |
| `packages/web/src/components/chat/messages/AgentToolBlock.tsx` | 新增：Agent tool 完整渲染组件 | Create |
| `packages/web/src/stores/sessionContainerStore.ts` | 扩展 subagentMessages 为 Map | Modify |
| `packages/web/src/providers/ChatSessionContext.ts` | 更新 getSubagentMessages 类型 | Modify |
| `packages/server/src/agent/manager.ts` | 添加 getSubagentMessages 方法 | Modify |
| `packages/server/src/agent/session-storage.ts` | 添加 getSubagentMessages 读取 | Modify |
| `packages/server/src/ws/handler.ts` | 替换 stub 为真实实现 | Modify |

---

### Task 1: 过滤 task_* 系统消息

将 task_started/task_progress/task_notification 从可见消息中移除，使它们不再作为独立 UI 元素出现。

**Files:**
- Modify: `packages/web/src/utils/messageVisibility.ts:96-126`

- [ ] **Step 1: 修改 isPassthroughVisible 过滤 task_* 消息**

在 `messageVisibility.ts` 的 `isPassthroughVisible` 函数中，将 task_started、task_progress、task_notification 改为 `return false`：

```typescript
// In isPassthroughVisible(), replace the system case:
case 'system': {
  if (sub === 'api_retry') return true
  if (sub === 'status' && (original as any).status === 'compacting') return true
  // task_* subtypes are now rendered INSIDE the Agent tool_use block,
  // not as standalone messages. Filter them from the main stream.
  if (sub === 'task_started') return false
  if (sub === 'task_progress') return false
  if (sub === 'task_notification') return false
  if (sub === 'local_command_output') return !!((original as any).output ?? (original as any).content)
  return false
}
```

- [ ] **Step 2: 验证过滤效果**

启动 dev server（`pnpm dev`），创建一个使用 Agent tool 的会话。确认 task_started/task_progress/task_notification 不再作为独立卡片出现在消息流中。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/utils/messageVisibility.ts
git commit -m "refactor: filter task_* system messages from main message stream

These messages will be rendered inline within Agent tool blocks instead."
```

---

### Task 2: 扩展 MessageLookups 支持 Agent progress 数据

构建 agent tool_use ID → progress/notification 的映射，以及从 tool_result 提取 Agent 完成统计。

**Files:**
- Modify: `packages/web/src/utils/messageLookups.ts`

- [ ] **Step 1: 添加 Agent 相关类型和映射到 MessageLookups**

在 `messageLookups.ts` 中扩展接口和构建函数：

```typescript
// ─── Types ───────────────────────────────────────────────

/** Extracted Agent tool completion stats from tool_result */
export interface AgentToolStats {
  agentId?: string
  agentType?: string
  totalToolUseCount?: number
  totalDurationMs?: number
  totalTokens?: number
  prompt?: string
  status?: string
  /** Text content from agent response */
  responseText?: string
}

/** Progress info for a running Agent (extracted from task_* messages) */
export interface AgentProgressEntry {
  lastToolName?: string
  description?: string
  toolUseCount?: number
  durationMs?: number
  tokens?: number
  status?: string
  agentName?: string
  taskId?: string
}

export interface MessageLookups {
  /** tool_use block.id → the NormalizedMessage containing that tool_use */
  toolUseById: Map<string, NormalizedMessage>
  /** tool_use_id → the NormalizedMessage containing the corresponding tool_result */
  toolResultByToolUseId: Map<string, NormalizedMessage>
  /** Set of tool_use IDs that have received a tool_result */
  resolvedToolUseIds: Set<string>
  /** Set of tool_use IDs whose tool_result has is_error=true */
  erroredToolUseIds: Set<string>
  /** Agent tool_use ID → completion stats (extracted from tool_result content) */
  agentStatsByToolUseId: Map<string, AgentToolStats>
  /** Agent tool_use ID → latest progress entries (from task_* messages in raw stream) */
  agentProgressByToolUseId: Map<string, AgentProgressEntry[]>
}
```

- [ ] **Step 2: 实现 Agent stats 提取逻辑**

在 `buildMessageLookups` 中添加提取 Agent tool_result 统计的逻辑：

```typescript
export function buildMessageLookups(messages: NormalizedMessage[]): MessageLookups {
  const toolUseById = new Map<string, NormalizedMessage>()
  const toolResultByToolUseId = new Map<string, NormalizedMessage>()
  const resolvedToolUseIds = new Set<string>()
  const erroredToolUseIds = new Set<string>()
  const agentStatsByToolUseId = new Map<string, AgentToolStats>()
  const agentProgressByToolUseId = new Map<string, AgentProgressEntry[]>()

  for (const msg of messages) {
    if (!msg.block) continue

    // Collect tool_use blocks
    if (msg.role === 'assistant' && (msg.block.type === 'tool_use' || msg.block.type === 'server_tool_use')) {
      const toolId = msg.block.id as string
      if (toolId) {
        toolUseById.set(toolId, msg)
      }
    }

    // Collect tool_result blocks
    if (msg.role === 'user' && msg.block.type === 'tool_result') {
      const toolUseId = msg.block.tool_use_id as string
      if (toolUseId) {
        toolResultByToolUseId.set(toolUseId, msg)
        resolvedToolUseIds.add(toolUseId)
        if (msg.block.is_error) {
          erroredToolUseIds.add(toolUseId)
        }
        // Extract Agent tool stats from tool_result
        const toolUseMsg = toolUseById.get(toolUseId)
        if (toolUseMsg?.block?.name === 'Agent') {
          const stats = extractAgentStats(msg)
          if (stats) {
            agentStatsByToolUseId.set(toolUseId, stats)
          }
        }
      }
    }
  }

  return {
    toolUseById, toolResultByToolUseId, resolvedToolUseIds, erroredToolUseIds,
    agentStatsByToolUseId, agentProgressByToolUseId,
  }
}

/**
 * Extract Agent tool completion stats from a tool_result message.
 *
 * The tool_result content may be:
 * 1. A string containing the agent's text response
 * 2. An array with text blocks
 *
 * The original message may also have a `toolUseResult` field (CLI internal)
 * with structured stats: { status, agentId, totalToolUseCount, totalDurationMs, totalTokens, ... }
 */
function extractAgentStats(resultMsg: NormalizedMessage): AgentToolStats | null {
  const original = resultMsg.original as any
  const block = resultMsg.block as any

  // Try toolUseResult first (CLI internal structured data)
  const tur = original?.toolUseResult ?? original?.message?.toolUseResult
  if (tur && typeof tur === 'object') {
    return {
      agentId: tur.agentId,
      agentType: tur.agentType,
      totalToolUseCount: tur.totalToolUseCount,
      totalDurationMs: tur.totalDurationMs,
      totalTokens: tur.totalTokens,
      prompt: tur.prompt,
      status: tur.status ?? 'completed',
      responseText: extractTextContent(tur.content),
    }
  }

  // Fallback: try to extract from tool_result content text
  const content = block?.content
  let text = ''
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    text = content.filter((b: any) => b.type === 'text').map((b: any) => b.text ?? '').join('')
  }

  if (text) {
    return { status: 'completed', responseText: text }
  }

  return null
}

function extractTextContent(content: any): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.filter((b: any) => b.type === 'text').map((b: any) => b.text ?? '').join('\n')
  }
  return ''
}
```

- [ ] **Step 3: 验证编译通过**

Run: `pnpm --filter @claude-agent-ui/web build` (or just check TSC)
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/utils/messageLookups.ts
git commit -m "feat: extend MessageLookups with Agent stats and progress mapping

Extract agentId, totalToolUseCount, totalDurationMs, totalTokens from
Agent tool_result. Supports both CLI toolUseResult and fallback text."
```

---

### Task 3: 构建 Agent progress 映射（从 raw messages）

从原始消息流中提取 task_* 消息，关联到对应的 Agent tool_use 块。

**Files:**
- Modify: `packages/web/src/hooks/useProcessedMessages.ts`
- Modify: `packages/web/src/utils/messageLookups.ts`

- [ ] **Step 1: 添加 buildAgentProgress 函数到 messageLookups.ts**

在 `messageLookups.ts` 底部添加：

```typescript
/**
 * Build Agent progress mapping from raw (unfiltered) messages.
 *
 * Associates task_started/task_progress/task_notification system messages
 * with the Agent tool_use they belong to, using positional matching:
 * task_* messages between an Agent tool_use and its tool_result belong to that Agent.
 *
 * @param rawMessages - Original unfiltered messages from SDK
 * @param lookups - Already-built lookups (for toolUseById)
 * @returns Map from Agent tool_use ID → AgentProgressEntry[]
 */
export function buildAgentProgress(
  rawMessages: AgentMessage[],
  lookups: MessageLookups,
): Map<string, AgentProgressEntry[]> {
  const progressMap = new Map<string, AgentProgressEntry[]>()

  // Find all Agent tool_use IDs (unresolved = still running)
  const agentToolUseIds: string[] = []
  for (const [id, msg] of lookups.toolUseById) {
    if (msg.block?.name === 'Agent') {
      agentToolUseIds.push(id)
    }
  }
  if (agentToolUseIds.length === 0) return progressMap

  // Track which Agent tool_use is "current" (most recently seen, not yet resolved)
  // Walk through raw messages and assign task_* messages to their Agent
  let currentAgentToolUseId: string | null = null

  for (const msg of rawMessages) {
    // Detect Agent tool_use start
    if (msg.type === 'assistant') {
      const content = (msg as any).message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if ((block.type === 'tool_use' || block.type === 'server_tool_use') && block.name === 'Agent' && block.id) {
            currentAgentToolUseId = block.id
            if (!progressMap.has(block.id)) {
              progressMap.set(block.id, [])
            }
          }
        }
      }
    }

    // Detect tool_result → resolve current Agent
    if (msg.type === 'user') {
      const content = (msg as any).message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result' && block.tool_use_id === currentAgentToolUseId) {
            currentAgentToolUseId = null
          }
        }
      }
    }

    // Collect task_* system messages for current Agent
    if (currentAgentToolUseId && msg.type === 'system') {
      const sub = (msg as any).subtype as string | undefined
      const entries = progressMap.get(currentAgentToolUseId)
      if (!entries) continue

      if (sub === 'task_started') {
        entries.push({
          agentName: (msg as any).agent_name,
          taskId: (msg as any).task_id,
          status: 'running',
        })
      } else if (sub === 'task_progress') {
        entries.push({
          lastToolName: (msg as any).last_tool_name,
          description: (msg as any).description ?? (msg as any).summary ?? (msg as any).content,
          status: 'running',
        })
      } else if (sub === 'task_notification') {
        const usage = (msg as any).usage
        entries.push({
          agentName: (msg as any).agent_name ?? (msg as any).task_id,
          status: (msg as any).status ?? 'completed',
          toolUseCount: usage?.tool_uses ?? (msg as any).tool_count,
          durationMs: usage?.duration_ms ?? (msg as any).duration_ms,
          tokens: usage?.total_tokens,
          description: (msg as any).summary,
        })
      }
    }
  }

  return progressMap
}
```

- [ ] **Step 2: 在 useProcessedMessages 中调用 buildAgentProgress**

修改 `useProcessedMessages.ts`，将 agentProgress 注入到 lookups 中：

```typescript
import { normalizeMessages, type NormalizedMessage } from '../utils/normalizeMessages'
import { buildMessageLookups, buildAgentProgress, type MessageLookups } from '../utils/messageLookups'
import { collapseReadSearch, type RenderableItem } from '../utils/collapseReadSearch'
import { isBlockVisible, filterAbsorbedToolResults } from '../utils/messageVisibility'

export interface ProcessedMessages {
  /** The final list of renderable items (NormalizedMessage or CollapsedGroup) */
  items: RenderableItem[]
  /** Tool use/result lookup table */
  lookups: MessageLookups
}

export function useProcessedMessages(rawMessages: AgentMessage[]): ProcessedMessages {
  return useMemo(() => {
    // Stage 1: Normalize — split multi-block messages into single-block
    const normalized = normalizeMessages(rawMessages)

    // Stage 2: Visibility filter — remove empty/internal blocks
    const visible = normalized.filter(isBlockVisible)

    // Stage 3: Build lookups (needed for tool_result absorption)
    const lookups = buildMessageLookups(visible)

    // Stage 3b: Build Agent progress from RAW messages (before filtering)
    // task_* messages are filtered out in Stage 2 but we need them for Agent progress
    const agentProgress = buildAgentProgress(rawMessages, lookups)
    lookups.agentProgressByToolUseId = agentProgress

    // Stage 4: Filter absorbed tool_results (they'll be shown inline by tool_use)
    const withoutAbsorbed = filterAbsorbedToolResults(visible, lookups)

    // Stage 5: Collapse consecutive Read/Grep/Glob into summaries
    const collapsed = collapseReadSearch(withoutAbsorbed)

    return { items: collapsed, lookups }
  }, [rawMessages])
}
```

- [ ] **Step 3: 验证编译通过**

Run: `pnpm --filter @claude-agent-ui/web build`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/utils/messageLookups.ts packages/web/src/hooks/useProcessedMessages.ts
git commit -m "feat: build Agent progress mapping from raw message stream

Positional matching: task_* messages between Agent tool_use and its
tool_result are associated with that Agent for inline rendering."
```

---

### Task 4: 创建 AgentToolBlock 组件

新建 Agent tool 的完整渲染组件：运行中 inline progress + 完成统计 + 展开 transcript。

**Files:**
- Create: `packages/web/src/components/chat/messages/AgentToolBlock.tsx`

- [ ] **Step 1: 创建 AgentToolBlock 组件**

```tsx
/**
 * AgentToolBlock — Renders Agent tool calls matching CLI's rendering.
 *
 * States:
 * - Running: header + inline progress (last 3 tool actions)
 * - Completed (collapsed): header + "Done (N tool uses · tokens · time)"
 * - Completed (expanded): header + full transcript from getSubagentMessages
 *
 * Mirrors: claude-code/src/tools/AgentTool/UI.tsx
 */
import { useState, memo } from 'react'
import { useChatSession } from '../../../providers/ChatSessionContext'
import { MarkdownRenderer } from '../MarkdownRenderer'
import type { MessageLookups, AgentToolStats, AgentProgressEntry } from '../../../utils/messageLookups'

interface Props {
  block: { id?: string; name?: string; input?: any; [key: string]: unknown }
  lookups: MessageLookups
}

const MAX_PROGRESS_TO_SHOW = 3

/** Format number with K/M suffix */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** Format duration ms → "Xs" or "Xm Ys" */
function formatDuration(ms: number): string {
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rs = Math.round(s % 60)
  return `${m}m ${rs}s`
}

export const AgentToolBlock = memo(function AgentToolBlock({ block, lookups }: Props) {
  const { id: toolUseId, input } = block
  const isResolved = toolUseId ? lookups.resolvedToolUseIds.has(toolUseId) : false
  const isErrored = toolUseId ? lookups.erroredToolUseIds.has(toolUseId) : false
  const stats = toolUseId ? lookups.agentStatsByToolUseId.get(toolUseId) : undefined
  const progressEntries = toolUseId ? lookups.agentProgressByToolUseId.get(toolUseId) : undefined

  const [expanded, setExpanded] = useState(false)

  const description = input?.description as string | undefined
  const subagentType = input?.subagent_type as string | undefined
  const agentName = input?.name as string | undefined
  const displayType = agentName ? `@${agentName}` : subagentType && subagentType !== 'general-purpose' ? subagentType : 'Agent'

  // Build completion summary line (like CLI: "Done (N tool uses · X tokens · Ys)")
  const completionParts: string[] = []
  if (stats?.totalToolUseCount != null) {
    completionParts.push(`${stats.totalToolUseCount} tool ${stats.totalToolUseCount === 1 ? 'use' : 'uses'}`)
  }
  if (stats?.totalTokens != null) {
    completionParts.push(`${formatTokens(stats.totalTokens)} tokens`)
  }
  if (stats?.totalDurationMs != null) {
    completionParts.push(formatDuration(stats.totalDurationMs))
  }
  const completionSummary = completionParts.length > 0 ? `Done (${completionParts.join(' · ')})` : 'Done'

  // Last N progress entries for inline display
  const recentProgress = progressEntries?.filter(e => e.lastToolName || e.description).slice(-MAX_PROGRESS_TO_SHOW) ?? []
  const hiddenCount = (progressEntries?.filter(e => e.lastToolName || e.description).length ?? 0) - recentProgress.length

  return (
    <div className="border border-[var(--border)] rounded-md overflow-hidden">
      {/* Header */}
      <div
        className={`flex items-center gap-2 px-3 py-2 bg-[var(--bg-secondary)] ${isResolved ? 'cursor-pointer hover:bg-[var(--bg-hover)]' : ''}`}
        onClick={() => isResolved && setExpanded(!expanded)}
      >
        <div className="w-0.5 h-4 rounded-full shrink-0 bg-[var(--purple)]" />
        {/* Status indicator */}
        {!isResolved && !isErrored && (
          <span className="inline-block w-1.5 h-1.5 bg-[var(--purple)] rounded-full animate-pulse shrink-0" />
        )}
        {isResolved && !isErrored && (
          <span className="text-[var(--text-dim)] shrink-0 text-xs">■</span>
        )}
        {isErrored && (
          <span className="text-[var(--error)] shrink-0 text-xs">✗</span>
        )}
        {/* Agent type */}
        <span className="text-xs font-mono font-semibold text-[var(--purple)] shrink-0">{displayType}</span>
        {/* Description */}
        {description && (
          <span className="text-xs font-mono text-[var(--text-muted)] truncate flex-1">{description}</span>
        )}
        {/* Completion stats (when resolved) */}
        {isResolved && !isErrored && (
          <span className="text-[10px] text-[var(--text-dim)] shrink-0">{completionSummary}</span>
        )}
        {isErrored && (
          <span className="text-[10px] text-[var(--error)] font-mono shrink-0">Error</span>
        )}
        {/* Expand chevron (only when resolved) */}
        {isResolved && (
          <svg className={`w-3 h-3 text-[var(--text-muted)] transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>

      {/* Inline progress (running state) */}
      {!isResolved && recentProgress.length > 0 && (
        <div className="border-t border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-1.5">
          {recentProgress.map((entry, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--text-muted)] py-0.5">
              <span className="text-[var(--text-dim)]">⎿</span>
              {entry.lastToolName && (
                <span className="font-semibold text-[var(--text-secondary)]">{entry.lastToolName}</span>
              )}
              <span className="truncate">{entry.description ?? ''}</span>
            </div>
          ))}
          {hiddenCount > 0 && (
            <div className="text-[10px] text-[var(--text-dim)] py-0.5">
              +{hiddenCount} more tool {hiddenCount === 1 ? 'use' : 'uses'} · click to expand
            </div>
          )}
        </div>
      )}

      {/* Expanded transcript */}
      {expanded && isResolved && (
        <AgentTranscript
          toolUseId={toolUseId!}
          stats={stats}
          onClose={() => setExpanded(false)}
        />
      )}
    </div>
  )
})

// ─── AgentTranscript (expanded view) ─────────────────────

function AgentTranscript({
  toolUseId,
  stats,
}: {
  toolUseId: string
  stats?: AgentToolStats
  onClose: () => void
}) {
  const { getSubagentMessages, subagentMessages, sessionId } = useChatSession()
  const agentId = stats?.agentId

  // Fetch messages on first render
  const [fetched, setFetched] = useState(false)
  if (!fetched && agentId && sessionId && sessionId !== '__new__') {
    setFetched(true)
    getSubagentMessages(agentId)
  }

  const messages = subagentMessages?.get(agentId ?? '') ?? null

  return (
    <div className="border-t border-[var(--border)] bg-[var(--bg-tertiary)] max-h-[400px] overflow-y-auto">
      {/* Prompt */}
      {stats?.prompt && (
        <div className="px-3 py-2 border-b border-[var(--border)]">
          <div className="text-[10px] font-semibold text-[var(--success)] mb-1">Prompt:</div>
          <div className="text-xs text-[var(--text-secondary)] pl-2">
            <MarkdownRenderer content={stats.prompt} />
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="px-3 py-2">
        {messages === null ? (
          <div className="text-[10px] text-[var(--text-muted)]">
            {agentId ? 'Loading transcript...' : 'Transcript unavailable (no agentId)'}
          </div>
        ) : messages.length === 0 ? (
          <div className="text-[10px] text-[var(--text-muted)]">No messages</div>
        ) : (
          <div className="space-y-1">
            {messages.map((m: any, i: number) => {
              const role = m.type ?? m.message?.role ?? 'system'
              const content = m.message?.content
              let text = ''
              if (typeof content === 'string') text = content
              else if (Array.isArray(content)) {
                text = content
                  .filter((b: any) => b.type === 'text')
                  .map((b: any) => b.text ?? '')
                  .join('\n')
              }

              // Show tool_use blocks as compact tool headers
              if (Array.isArray(content)) {
                const toolUses = content.filter((b: any) => b.type === 'tool_use')
                if (toolUses.length > 0 && !text.trim()) {
                  return toolUses.map((tu: any, j: number) => (
                    <div key={`${i}-tu-${j}`} className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--text-muted)] py-0.5">
                      <span className="text-[var(--text-dim)]">⎿</span>
                      <span className="font-semibold text-[var(--text-secondary)]">{tu.name}</span>
                      <span className="truncate text-[var(--text-dim)]">
                        {tu.input?.file_path ?? tu.input?.pattern ?? tu.input?.command?.slice(0, 80) ?? tu.input?.description ?? ''}
                      </span>
                    </div>
                  ))
                }
              }

              if (!text.trim()) return null

              const roleColor = role === 'assistant'
                ? 'text-[var(--accent)]'
                : role === 'user'
                  ? 'text-[var(--info)]'
                  : 'text-[var(--text-muted)]'

              return (
                <div key={i} className="text-xs leading-relaxed">
                  {role === 'assistant' && (
                    <div className={roleColor}>
                      <MarkdownRenderer content={text} />
                    </div>
                  )}
                  {role !== 'assistant' && (
                    <div className="text-[var(--text-muted)] text-[10px]">{text.slice(0, 200)}</div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Response */}
      {stats?.responseText && (
        <div className="px-3 py-2 border-t border-[var(--border)]">
          <div className="text-[10px] font-semibold text-[var(--success)] mb-1">Response:</div>
          <div className="text-xs text-[var(--text-secondary)] pl-2">
            <MarkdownRenderer content={stats.responseText} />
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 验证编译通过**

Run: `pnpm --filter @claude-agent-ui/web build`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/messages/AgentToolBlock.tsx
git commit -m "feat: add AgentToolBlock with inline progress and transcript expand

Renders Agent tool calls matching CLI:
- Running: header + last 3 tool actions inline
- Completed: Done (N tool uses · tokens · time)
- Expanded: full transcript via getSubagentMessages"
```

---

### Task 5: 替换 AssistantToolUseBlock 中的 Agent 分支

将 Agent 分支从简单的 `AgentProgressLine` 替换为新的 `AgentToolBlock`。

**Files:**
- Modify: `packages/web/src/components/chat/messages/AssistantToolUseBlock.tsx:54-59`

- [ ] **Step 1: 替换 Agent 分支**

在 `AssistantToolUseBlock.tsx` 中，将现有的 Agent 分支替换：

```typescript
// Add import at top:
import { AgentToolBlock } from './AgentToolBlock'

// Replace the Agent branch (lines 54-59):
// Agent: CLI-style aggregated rendering
if (name === 'Agent') {
  return <AgentToolBlock block={block} lookups={lookups} />
}
```

- [ ] **Step 2: 删除旧的 AgentProgressLine 函数**

移除文件底部（约 L470-504）的 `AgentProgressLine` 函数，因为它已被 AgentToolBlock 替代。同时移除 `getToolDetail` 中的 `case 'Agent'` 分支（约 L222-223），因为展开逻辑现在在 AgentToolBlock 内部处理。

```typescript
// In getToolDetail, remove:
//   case 'Agent':
//     return input.prompt ? <div>{input.prompt.slice(0, 500)}</div> : null
```

- [ ] **Step 3: 验证 UI 效果**

在 dev server 中创建使用 Agent tool 的会话：
- 运行中应显示 header + inline progress
- 完成后应显示 "Done (N tool uses · tokens · time)"
- 刷新后应从 tool_result 恢复完成状态

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/chat/messages/AssistantToolUseBlock.tsx
git commit -m "refactor: replace AgentProgressLine with AgentToolBlock

Agent tool calls now render with inline progress, completion stats,
and expandable transcript matching Claude Code CLI."
```

---

### Task 6: 删除 SystemMessageBlock 中的 task_* 渲染

移除已废弃的 AgentCard 和 task_* 独立渲染代码。

**Files:**
- Modify: `packages/web/src/components/chat/messages/SystemMessageBlock.tsx:40-85, 102-172`

- [ ] **Step 1: 删除 task_started/task_progress/task_notification 渲染**

在 `SystemMessageBlock.tsx` 中，删除三个 task_* 分支和 `AgentCard`、`StopTaskButton` 组件：

```typescript
// Remove these blocks (lines 40-85):
//   if (sub === 'task_started') { ... }
//   if (sub === 'task_progress') { ... }
//   if (sub === 'task_notification') { ... }

// Remove AgentCard component (lines 104-159)
// Remove StopTaskButton component (lines 161-172)

// Also remove unused imports if any (useState, wsManager, useChatSession)
```

最终 `SystemMessageBlock.tsx` 只保留 `api_retry`、`compacting`、`local_command_output` 三个分支。

- [ ] **Step 2: 清理未使用的 imports**

检查并移除不再需要的 imports：
- `useState` — 如果 AgentCard 是唯一使用者
- `wsManager` — 如果 StopTaskButton 是唯一使用者
- `useChatSession` — 如果 AgentCard 是唯一使用者

- [ ] **Step 3: 验证编译通过**

Run: `pnpm --filter @claude-agent-ui/web build`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/chat/messages/SystemMessageBlock.tsx
git commit -m "refactor: remove task_* rendering from SystemMessageBlock

task_started/task_progress/task_notification are now rendered inside
AgentToolBlock. Remove AgentCard and StopTaskButton."
```

---

### Task 7: 扩展 sessionContainerStore 支持多 Agent transcript

将 `subagentMessages` 从单个对象改为 Map，支持同时查看多个 Agent 的 transcript。

**Files:**
- Modify: `packages/web/src/stores/sessionContainerStore.ts`
- Modify: `packages/web/src/providers/ChatSessionContext.ts`

- [ ] **Step 1: 更新 SessionContainer 类型**

在 `sessionContainerStore.ts` 中：

```typescript
// Change in SessionContainer interface (line 86):
// FROM:
//   subagentMessages: { agentId: string; messages: any[] } | null
// TO:
subagentMessages: Map<string, any[]>
```

- [ ] **Step 2: 更新 createEmptyContainer 默认值**

在创建空 container 的地方，将 `subagentMessages: null` 改为 `subagentMessages: new Map()`。

- [ ] **Step 3: 更新 setSubagentMessages action**

```typescript
// Change setSubagentMessages to merge into Map:
setSubagentMessages(sessionId: string, data: { agentId: string; messages: any[] }) {
  const { containers } = get()
  const c = containers.get(sessionId)
  if (!c) return
  const next = new Map(containers)
  const newSubagentMessages = new Map(c.subagentMessages)
  newSubagentMessages.set(data.agentId, data.messages)
  next.set(sessionId, { ...c, subagentMessages: newSubagentMessages })
  set({ containers: next })
},
```

- [ ] **Step 4: 更新 ChatSessionContext**

在 `ChatSessionContext.ts` 中更新 `subagentMessages` 类型：

```typescript
// FROM:
//   subagentMessages: { agentId: string; messages: any[] } | null
// TO:
subagentMessages: Map<string, any[]>
```

- [ ] **Step 5: 更新 WebSocketManager handleSubagentMessages**

在 `WebSocketManager.ts` 中，`handleSubagentMessages` 已经调用 `store().setSubagentMessages(sessionId, { agentId, messages })`，这部分不需要改（action 签名不变）。

- [ ] **Step 6: 验证编译通过**

Run: `pnpm --filter @claude-agent-ui/web build`

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/stores/sessionContainerStore.ts packages/web/src/providers/ChatSessionContext.ts
git commit -m "refactor: change subagentMessages from single object to Map

Supports viewing transcripts of multiple Agent tools simultaneously."
```

---

### Task 8: 服务端实现 getSubagentMessages

替换 handler.ts 中的 stub，通过 SessionStorage 读取 subagent JSONL 文件。

**Files:**
- Modify: `packages/server/src/agent/session-storage.ts`
- Modify: `packages/server/src/agent/manager.ts`
- Modify: `packages/server/src/ws/handler.ts:163-165`

- [ ] **Step 1: 在 SessionStorage 中添加 getSubagentMessages**

在 `session-storage.ts` 底部添加方法：

```typescript
/**
 * Read subagent messages from the sidechain JSONL file.
 * CLI stores subagent transcripts at:
 *   ~/.claude/projects/{project-hash}/{sessionId}/subagents/agent-{agentId}.jsonl
 *
 * Also checks alternate path without session subdirectory:
 *   ~/.claude/projects/{project-hash}/subagents/agent-{agentId}.jsonl
 */
async getSubagentMessages(sessionId: string, agentId: string, dir?: string): Promise<unknown[]> {
  // Find the project directory for this session
  let projectDir: string | undefined
  if (dir) {
    projectDir = this.getProjectDir(dir)
  } else {
    const info = await this.getSessionInfo(sessionId)
    if (info?.cwd) {
      projectDir = this.getProjectDir(info.cwd)
    }
  }
  if (!projectDir) return []

  // Try multiple possible paths for the subagent JSONL
  const candidates = [
    join(projectDir, sessionId, 'subagents', `agent-${agentId}.jsonl`),
    join(projectDir, 'subagents', `agent-${agentId}.jsonl`),
  ]

  for (const filePath of candidates) {
    try {
      const content = await readFile(filePath, 'utf-8')
      const messages: unknown[] = []
      for (const line of content.split('\n')) {
        if (!line.trim()) continue
        try {
          const obj = JSON.parse(line) as Record<string, unknown>
          // Skip metadata entries
          if (['custom-title', 'ai-title', 'tag', 'task-summary'].includes(obj.type as string)) continue
          if (isSDKResumeArtifact(obj)) continue
          messages.push(obj)
        } catch { continue }
      }
      return messages
    } catch {
      continue // File doesn't exist at this path, try next
    }
  }

  return []
}
```

- [ ] **Step 2: 在 SessionManager 中添加 getSubagentMessages**

在 `manager.ts` 中添加：

```typescript
async getSubagentMessages(
  sessionId: string,
  agentId: string,
): Promise<unknown[]> {
  return await this.sessionStorage.getSubagentMessages(sessionId, agentId)
}
```

- [ ] **Step 3: 替换 handler.ts 中的 stub**

在 `handler.ts` 中替换 L163-165：

```typescript
case 'get-subagent-messages': {
  try {
    const messages = await sessionManager.getSubagentMessages(msg.sessionId, msg.agentId)
    wsHub.sendTo(connectionId, {
      type: 'subagent-messages',
      sessionId: msg.sessionId,
      agentId: msg.agentId,
      messages,
    } as any)
  } catch {
    wsHub.sendTo(connectionId, {
      type: 'subagent-messages',
      sessionId: msg.sessionId,
      agentId: msg.agentId,
      messages: [],
    } as any)
  }
  break
}
```

- [ ] **Step 4: 验证编译通过**

Run: `pnpm --filter @claude-agent-ui/server build`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/agent/session-storage.ts packages/server/src/agent/manager.ts packages/server/src/ws/handler.ts
git commit -m "feat: implement getSubagentMessages server endpoint

Reads subagent transcript from sidechain JSONL files at
~/.claude/projects/{hash}/{sessionId}/subagents/agent-{agentId}.jsonl"
```

---

### Task 9: 端到端验证

验证完整功能：运行中进度、完成统计、刷新恢复、展开 transcript。

**Files:** None (testing only)

- [ ] **Step 1: 验证运行中渲染**

1. 启动 `pnpm dev`
2. 创建新会话，发送一个会触发 Agent tool 的提示（如 "搜索代码库中的 TODO 注释并分析"）
3. 确认：
   - Agent tool 块显示 header（紫色竖线 + Agent 类型 + 描述）
   - 运行中显示 pulse 动画
   - Inline 显示最近的工具调用进度
   - 不再出现独立的 task_started 紫色卡片
   - 不再出现独立的 task_progress 进度行

- [ ] **Step 2: 验证完成渲染**

1. 等待 Agent 完成
2. 确认：
   - Agent 块显示 "Done (N tool uses · X tokens · Ys)"
   - 不再出现独立的 task_notification 完成卡片
   - 展开箭头可点击

- [ ] **Step 3: 验证刷新恢复**

1. 刷新页面
2. 回到同一会话
3. 确认：
   - Agent 块显示完成状态（从 tool_result 恢复）
   - 统计数据正确显示（如果 tool_result 包含结构化数据）

- [ ] **Step 4: 验证展开 transcript**

1. 点击已完成的 Agent 块展开
2. 确认：
   - 显示 Prompt 内容
   - 显示工具调用链
   - 显示 Response 内容
   - 滚动正常

- [ ] **Step 5: 验证构建通过**

```bash
pnpm build
pnpm lint
```

- [ ] **Step 6: Commit all remaining changes**

```bash
git add -A
git commit -m "feat: complete subagent rendering alignment with CLI

All subagent info now renders inside Agent tool blocks:
- Inline progress during execution
- Completion stats from tool_result
- Expandable full transcript via getSubagentMessages
- No more scattered task_* system messages"
```
