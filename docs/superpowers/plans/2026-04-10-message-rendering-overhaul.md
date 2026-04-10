# 消息渲染架构大修 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将消息渲染架构重构为流式内容与完成消息彻底分离的模式，对标 Claude Code CLI，消除 finalize 竞态和 _streaming 标记导致的反复回归问题。

**Architecture:** 服务端标记 partial vs final assistant 消息。前端 messages[] 只存完成消息，流式内容（text/thinking/toolUses）存在独立的 streaming 状态中。渲染层分两部分：完成消息列表 + 末尾的流式内容组件。废弃 accumulator/pendingDeltas/finalizeStreamingMessage 等所有脆弱机制。

**Tech Stack:** TypeScript, React 19, Zustand 5, Fastify 5, @anthropic-ai/claude-agent-sdk

---

## File Structure

### Modified Files
| File | Responsibility |
|------|---------------|
| `packages/shared/src/messages.ts` | 添加 `_partial` 字段到 AgentMessage |
| `packages/server/src/agent/v1-session.ts:283-303` | 标记 partial vs final assistant |
| `packages/server/src/ws/handler.ts:495-541` | partial assistant 走 broadcastRaw |
| `packages/web/src/stores/sessionContainerStore.ts` | 重构：新增 streaming 状态，废弃 StreamState 类 |
| `packages/web/src/lib/WebSocketManager.ts:517-1125` | 重写流式处理，废弃 finalize |
| `packages/web/src/components/chat/ChatMessagesPane.tsx` | 分离完成消息列表和流式内容渲染 |
| `packages/web/src/components/chat/MessageComponent.tsx:59-213` | 移除 _streaming 条件分支 |

### New Files
| File | Responsibility |
|------|---------------|
| `packages/web/src/components/chat/streaming/StreamingTextBlock.tsx` | 流式文本渲染（纯文本+光标） |
| `packages/web/src/components/chat/streaming/StreamingThinkingBlock.tsx` | 流式思考渲染（thinking+光标） |
| `packages/web/src/components/chat/streaming/StreamingToolUseBlock.tsx` | 流式工具调用渲染 |

---

### Task 1: shared — AgentMessage 添加 _partial 字段

**Files:**
- Modify: `packages/shared/src/messages.ts:46-52`

- [ ] **Step 1: 添加 _partial 字段**

```typescript
// packages/shared/src/messages.ts — 修改 AgentMessage 接口
export interface AgentMessage {
  type: AgentMessageType
  subtype?: string
  session_id?: string
  uuid?: string
  _partial?: boolean  // 新增：标记 partial assistant（流式中间态）
  [key: string]: unknown
}
```

- [ ] **Step 2: 构建 shared 包验证**

Run: `pnpm --filter @claude-agent-ui/shared build`
Expected: 编译成功，无错误

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/messages.ts
git commit -m "feat(shared): add _partial field to AgentMessage for partial/final distinction"
```

---

### Task 2: server — v1-session.ts 标记 partial vs final assistant

**Files:**
- Modify: `packages/server/src/agent/v1-session.ts:283-303`

- [ ] **Step 1: 在事件循环中标记 assistant 消息**

找到 `v1-session.ts` 第 283-303 行的 `for await` 循环，将第 302-303 行替换：

```typescript
// 旧代码（第 302-303 行）：
// Forward all messages
this.emit('message', msg)

// 新代码：
// Forward all messages — mark partial vs final assistant
if ((msg as any).type === 'assistant') {
  // partial: stop_reason 为 null（流式中间态，SDK 的 includePartialMessages）
  // final: stop_reason 有值（'end_turn', 'tool_use', 'max_tokens' 等）
  const stopReason = (msg as any).message?.stop_reason
  if (!stopReason) {
    this.emit('message', { ...msg, _partial: true })
  } else {
    this.emit('message', msg)
  }
} else {
  this.emit('message', msg)
}
```

- [ ] **Step 2: 构建 server 包验证**

Run: `pnpm --filter @claude-agent-ui/server build`
Expected: 编译成功

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/agent/v1-session.ts
git commit -m "feat(server): mark partial assistant messages with _partial flag"
```

---

### Task 3: server — handler.ts partial assistant 走 broadcastRaw

**Files:**
- Modify: `packages/server/src/ws/handler.ts:515-541`

- [ ] **Step 1: 区分 partial 和 final assistant 的转发策略**

找到 `handler.ts` 第 515-541 行的 assistant 处理段，替换为：

```typescript
      // Handle assistant messages — partial vs final
      if (msg.type === 'assistant') {
        if (msg._partial) {
          // Partial assistant — don't buffer, broadcast raw (transient mid-stream state)
          // Used by frontend to extract tool_use blocks and model info during streaming
          wsHub.broadcastRaw(realSessionId, {
            type: 'agent-message',
            sessionId: realSessionId,
            message: msg,
          })
          return
        }
        // Final assistant — clear stream snapshot, buffer with seq for replay
        wsHub.clearStreamSnapshot(realSessionId)

        // Auto-generate title on first assistant message
        if (!titleGenTriggered && !realSessionId.startsWith('pending-')) {
          titleGenTriggered = true
          maybeGenerateTitle(realSessionId).then((title) => {
            if (title) {
              sessionManager.invalidateSessionsCache(session.projectCwd)
              wsHub.broadcast(realSessionId, {
                type: 'session-title-updated',
                sessionId: realSessionId,
                title,
              })
            }
          }).catch(() => {})
        }
      }

      // Broadcast and buffer all other messages (including final assistant) to ALL clients
      wsHub.broadcast(realSessionId, {
        type: 'agent-message',
        sessionId: realSessionId,
        message: msg,
      })
```

- [ ] **Step 2: 构建验证**

Run: `pnpm --filter @claude-agent-ui/server build`
Expected: 编译成功

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/ws/handler.ts
git commit -m "feat(server): route partial assistant via broadcastRaw, final via broadcast"
```

---

### Task 4: store — 重构 sessionContainerStore 的流式状态

**Files:**
- Modify: `packages/web/src/stores/sessionContainerStore.ts`

- [ ] **Step 1: 定义新的流式类型和接口**

在文件顶部（StreamState 类之前，约第 76 行），添加新类型：

```typescript
// ─── Streaming State (new architecture: separated from messages) ───

export interface StreamingToolUse {
  id: string
  name: string
  input: string  // accumulated JSON string
}

export interface CompletedStreamingBlock {
  type: 'thinking' | 'text'
  content: string
}

export interface StreamingState {
  text: string | null
  thinking: string | null
  toolUses: StreamingToolUse[]
  completedBlocks: CompletedStreamingBlock[]
  model: string | null
}

function createStreamingState(): StreamingState {
  return { text: null, thinking: null, toolUses: [], completedBlocks: [], model: null }
}
```

- [ ] **Step 2: 修改 SessionContainer 接口**

在 SessionContainer 接口中添加 `streaming` 字段（第 51-74 行之间）：

```typescript
export interface SessionContainer {
  // ... 保留所有现有字段 ...
  streamingVersion: number
  // 新增：独立的流式状态
  streaming: StreamingState
  spinnerMode: SpinnerMode | null
  requestStartTime: number | null
  thinkingStartTime: number | null
  thinkingEndTime: number | null
  responseLength: number
}
```

- [ ] **Step 3: 修改 createContainer 工厂函数**

在 createContainer 函数中添加新字段（约第 117-142 行）：

```typescript
function createContainer(sessionId: string, cwd: string): SessionContainer {
  return {
    // ... 保留所有现有字段 ...
    streamingVersion: 0,
    // 新增
    streaming: createStreamingState(),
    spinnerMode: null,
    requestStartTime: null,
    thinkingStartTime: null,
    thinkingEndTime: null,
    responseLength: 0,
  }
}
```

- [ ] **Step 4: 添加新的流式操作方法**

在 store actions 中添加（在现有方法附近）：

```typescript
// ─── New streaming methods ───

updateStreamingText(sessionId: string, deltaText: string) {
  const containers = new Map(get().containers)
  const c = containers.get(sessionId)
  if (!c) return
  containers.set(sessionId, {
    ...c,
    streaming: { ...c.streaming, text: (c.streaming.text ?? '') + deltaText },
    responseLength: c.responseLength + deltaText.length,
    streamingVersion: c.streamingVersion + 1,
  })
  set({ containers })
},

updateStreamingThinking(sessionId: string, deltaThinking: string) {
  const containers = new Map(get().containers)
  const c = containers.get(sessionId)
  if (!c) return
  containers.set(sessionId, {
    ...c,
    streaming: { ...c.streaming, thinking: (c.streaming.thinking ?? '') + deltaThinking },
    streamingVersion: c.streamingVersion + 1,
  })
  set({ containers })
},

addStreamingToolUse(sessionId: string, tool: StreamingToolUse) {
  const containers = new Map(get().containers)
  const c = containers.get(sessionId)
  if (!c) return
  // Replace existing tool with same id, or append
  const existing = c.streaming.toolUses.findIndex(t => t.id === tool.id)
  const toolUses = [...c.streaming.toolUses]
  if (existing >= 0) {
    toolUses[existing] = tool
  } else {
    toolUses.push(tool)
  }
  containers.set(sessionId, {
    ...c,
    streaming: { ...c.streaming, toolUses },
    streamingVersion: c.streamingVersion + 1,
  })
  set({ containers })
},

updateStreamingToolInput(sessionId: string, toolIndex: number, deltaJson: string) {
  const containers = new Map(get().containers)
  const c = containers.get(sessionId)
  if (!c) return
  const toolUses = [...c.streaming.toolUses]
  const tool = toolUses[toolIndex]
  if (!tool) return
  toolUses[toolIndex] = { ...tool, input: tool.input + deltaJson }
  containers.set(sessionId, {
    ...c,
    streaming: { ...c.streaming, toolUses },
    streamingVersion: c.streamingVersion + 1,
  })
  set({ containers })
},

graduateStreamingBlock(sessionId: string, blockType: string) {
  const containers = new Map(get().containers)
  const c = containers.get(sessionId)
  if (!c) return
  const completedBlocks = [...c.streaming.completedBlocks]
  if (blockType === 'thinking' && c.streaming.thinking !== null) {
    completedBlocks.push({ type: 'thinking', content: c.streaming.thinking })
  } else if (blockType === 'text' && c.streaming.text !== null) {
    completedBlocks.push({ type: 'text', content: c.streaming.text })
  }
  containers.set(sessionId, {
    ...c,
    streaming: {
      ...c.streaming,
      thinking: blockType === 'thinking' ? null : c.streaming.thinking,
      text: blockType === 'text' ? null : c.streaming.text,
      completedBlocks,
    },
    streamingVersion: c.streamingVersion + 1,
  })
  set({ containers })
},

clearStreaming(sessionId: string) {
  const containers = new Map(get().containers)
  const c = containers.get(sessionId)
  if (!c) return
  containers.set(sessionId, {
    ...c,
    streaming: createStreamingState(),
    spinnerMode: null,
    requestStartTime: null,
    thinkingStartTime: null,
    thinkingEndTime: null,
    responseLength: 0,
    streamingVersion: c.streamingVersion + 1,
  })
  set({ containers })
},

setStreamingModel(sessionId: string, model: string) {
  const containers = new Map(get().containers)
  const c = containers.get(sessionId)
  if (!c) return
  containers.set(sessionId, {
    ...c,
    streaming: { ...c.streaming, model },
  })
  set({ containers })
},

setSpinnerMode(sessionId: string, mode: SpinnerMode) {
  const containers = new Map(get().containers)
  const c = containers.get(sessionId)
  if (!c) return
  const updates: Partial<SessionContainer> = { spinnerMode: mode }
  if (mode === 'requesting' && c.requestStartTime === null) {
    updates.requestStartTime = Date.now()
  }
  if (mode === 'thinking' && c.thinkingStartTime === null) {
    updates.thinkingStartTime = Date.now()
  }
  if (mode === 'responding' && c.thinkingStartTime !== null && c.thinkingEndTime === null) {
    updates.thinkingEndTime = Date.now()
  }
  containers.set(sessionId, { ...c, ...updates })
  set({ containers })
},
```

- [ ] **Step 5: 在 actions interface 中声明新方法**

在 SessionContainerActions 接口中添加：

```typescript
// New streaming methods
updateStreamingText(sessionId: string, deltaText: string): void
updateStreamingThinking(sessionId: string, deltaThinking: string): void
addStreamingToolUse(sessionId: string, tool: StreamingToolUse): void
updateStreamingToolInput(sessionId: string, toolIndex: number, deltaJson: string): void
graduateStreamingBlock(sessionId: string, blockType: string): void
clearStreaming(sessionId: string): void
setStreamingModel(sessionId: string, model: string): void
setSpinnerMode(sessionId: string, mode: SpinnerMode): void
```

- [ ] **Step 6: 构建验证**

Run: `pnpm --filter @claude-agent-ui/web build`
Expected: 编译成功（旧方法还在，新方法已添加，两套共存）

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/stores/sessionContainerStore.ts
git commit -m "feat(store): add separated streaming state to SessionContainer"
```

---

### Task 5: WebSocketManager — 重写流式处理逻辑

**Files:**
- Modify: `packages/web/src/lib/WebSocketManager.ts`

这是最核心的改动。需要重写 `handleAgentMessage`、`handleStreamEvent`、`handleFinalAssistantMessage`，废弃 `finalizeStreamingMessage`、`flushStreamState`、`buildContentFromAccumulator`。

- [ ] **Step 1: 重写 handleAgentMessage（第 517-575 行的消息路由）**

替换第 565-574 行的路由逻辑：

```typescript
    // ── 3. Route by message type ──
    if (agentMsg.type === 'stream_event') {
      this.handleStreamEvent(targetSessionId, agentMsg)
    } else if (agentMsg.type === 'user') {
      s.replaceOptimistic(targetSessionId, agentMsg)
    } else if (agentMsg.type === 'assistant') {
      if ((agentMsg as any)._partial) {
        // Partial assistant — extract tool_use blocks and model info, don't push to messages
        this.handlePartialAssistant(targetSessionId, agentMsg)
      } else {
        // Final assistant — clear streaming state, push to messages
        s.clearStreaming(targetSessionId)
        s.pushMessage(targetSessionId, agentMsg)
      }
    } else {
      s.pushMessage(targetSessionId, agentMsg)
    }
```

- [ ] **Step 2: 重写 handleStreamEvent（替换第 600-699 行）**

删除整个旧的 handleStreamEvent 方法，替换为：

```typescript
  private currentToolBlockIndex = new Map<string, number>()  // sessionId → current tool block index in streaming.toolUses

  private handleStreamEvent(sessionId: string, agentMsg: AgentMessage) {
    const evt = (agentMsg as any).event
    if (!evt) return

    const s = store()

    if (evt.type === 'content_block_start') {
      const blockType = evt.content_block?.type ?? 'text'

      // Spinner timing
      if (blockType === 'thinking') {
        s.setSpinnerMode(sessionId, 'thinking')
      } else if (blockType === 'text') {
        s.setSpinnerMode(sessionId, 'responding')
      } else if (blockType === 'tool_use' || blockType === 'server_tool_use') {
        s.setSpinnerMode(sessionId, 'tool-use')
        // Add new streaming tool use
        const toolBlock = evt.content_block
        s.addStreamingToolUse(sessionId, {
          id: toolBlock.id ?? `tool-${evt.index}`,
          name: toolBlock.name ?? '',
          input: '',
        })
        this.currentToolBlockIndex.set(sessionId, s.containers.get(sessionId)?.streaming.toolUses.length
          ? s.containers.get(sessionId)!.streaming.toolUses.length - 1 : 0)
      }
    } else if (evt.type === 'content_block_delta') {
      const delta = evt.delta
      if (delta?.type === 'text_delta' && delta.text) {
        s.updateStreamingText(sessionId, delta.text)
      } else if (delta?.type === 'thinking_delta' && delta.thinking) {
        s.updateStreamingThinking(sessionId, delta.thinking)
      } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
        const toolIdx = this.currentToolBlockIndex.get(sessionId) ?? 0
        s.updateStreamingToolInput(sessionId, toolIdx, delta.partial_json)
      }
    } else if (evt.type === 'content_block_stop') {
      // Graduate completed block (e.g., thinking done → text starting)
      const container = s.containers.get(sessionId)
      if (container) {
        // Determine what type of block just finished based on current streaming state
        if (container.streaming.thinking !== null) {
          s.graduateStreamingBlock(sessionId, 'thinking')
        } else if (container.streaming.text !== null) {
          s.graduateStreamingBlock(sessionId, 'text')
        }
      }
    }
    // message_start, message_stop — no action needed
  }
```

- [ ] **Step 3: 添加 handlePartialAssistant 方法**

在 handleStreamEvent 之后添加：

```typescript
  private handlePartialAssistant(sessionId: string, agentMsg: AgentMessage) {
    const s = store()
    const msg = agentMsg as any

    // Extract model info
    if (msg.message?.model) {
      s.setStreamingModel(sessionId, msg.message.model)
    }

    // Extract complete tool_use blocks (partial assistant has full structure vs stream_event's JSON fragments)
    for (const block of msg.message?.content ?? []) {
      if (block.type === 'tool_use' || block.type === 'server_tool_use') {
        s.addStreamingToolUse(sessionId, {
          id: block.id,
          name: block.name,
          input: typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}),
        })
      }
    }
  }
```

- [ ] **Step 4: 修改 handleSessionComplete（第 995-1016 行）**

替换 finalizeStreamingMessage 和 clearStreamingFlag 调用：

```typescript
  private handleSessionComplete(msg: any) {
    const sessionId = (msg as any).sessionId as string | undefined
    if (!sessionId) return
    const s = store()
    s.setSessionStatus(sessionId, 'idle')
    // Clear pending requests but preserve lock status — lock persists across queries
    s.setApproval(sessionId, null)
    s.setAskUser(sessionId, null)
    s.setPlanApproval(sessionId, null)
    s.setPlanModalOpen(sessionId, false)
    s.setQueue(sessionId, [])
    // Clear all streaming state
    s.clearStreaming(sessionId)
    // Clean up tool index tracker
    this.currentToolBlockIndex.delete(sessionId)
    // Refresh session list in sidebar
    const sessStore = useSessionStore.getState()
    if (sessStore.currentProjectCwd) {
      sessStore.invalidateProjectSessions(sessStore.currentProjectCwd)
      sessStore.loadProjectSessions(sessStore.currentProjectCwd, true)
    }
  }
```

- [ ] **Step 5: 重写 handleStreamSnapshot（第 1082-1125 行）**

替换为基于新 streaming 状态的逻辑：

```typescript
  private handleStreamSnapshot(msg: any) {
    const snapshot = msg as any
    const sessionId = snapshot.sessionId as string | undefined
    if (!sessionId) return

    const s = store()
    const container = s.containers.get(sessionId)
    if (!container) return

    // Rebuild streaming state from snapshot blocks
    for (const block of snapshot.blocks ?? []) {
      if (block.type === 'thinking') {
        s.updateStreamingThinking(sessionId, block.content ?? '')
      } else if (block.type === 'text') {
        s.updateStreamingText(sessionId, block.content ?? '')
      }
    }
    s.setSpinnerMode(sessionId, 'responding')
  }
```

- [ ] **Step 6: 删除废弃的方法**

删除以下方法（不再需要）：
- `buildContentFromAccumulator()` (第 579-592 行)
- `createEmptyBlock()` (第 595-598 行)
- `flushStreamState()` (第 702-710 行)
- `finalizeStreamingMessage()` (第 719-765 行)
- `handleFinalAssistantMessage()` (第 767-869 行)

- [ ] **Step 7: 构建验证**

Run: `pnpm --filter @claude-agent-ui/web build`
Expected: 可能有引用旧方法的编译错误，在后续 task 中修复

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/lib/WebSocketManager.ts
git commit -m "feat(ws): rewrite streaming to separated state, remove finalize/accumulator"
```

---

### Task 6: 新增流式渲染组件

**Files:**
- Create: `packages/web/src/components/chat/streaming/StreamingTextBlock.tsx`
- Create: `packages/web/src/components/chat/streaming/StreamingThinkingBlock.tsx`
- Create: `packages/web/src/components/chat/streaming/StreamingToolUseBlock.tsx`

- [ ] **Step 1: 创建 StreamingTextBlock**

```typescript
// packages/web/src/components/chat/streaming/StreamingTextBlock.tsx
import { memo } from 'react'

interface StreamingTextBlockProps {
  text: string
}

export const StreamingTextBlock = memo(function StreamingTextBlock({ text }: StreamingTextBlockProps) {
  if (!text) return null
  return (
    <div className="flex gap-3 items-start">
      <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed flex-1">
        {text}
        <span className="inline-block w-2 h-4 bg-[var(--accent)] rounded-sm ml-0.5 animate-pulse" />
      </p>
    </div>
  )
})
```

- [ ] **Step 2: 创建 StreamingThinkingBlock**

```typescript
// packages/web/src/components/chat/streaming/StreamingThinkingBlock.tsx
import { memo } from 'react'

interface StreamingThinkingBlockProps {
  content: string
}

export const StreamingThinkingBlock = memo(function StreamingThinkingBlock({ content }: StreamingThinkingBlockProps) {
  if (!content) return null
  return (
    <div className="border-l-2 border-[var(--purple-subtle-border)] pl-3 py-1">
      <p className="text-xs text-[var(--purple)] whitespace-pre-wrap leading-relaxed">
        {content}
        <span className="inline-block w-1.5 h-3 bg-[var(--purple)] rounded-sm ml-0.5 animate-pulse" />
      </p>
    </div>
  )
})
```

- [ ] **Step 3: 创建 StreamingToolUseBlock**

```typescript
// packages/web/src/components/chat/streaming/StreamingToolUseBlock.tsx
import { memo } from 'react'
import { getToolCategory, TOOL_COLORS } from '@claude-agent-ui/shared'
import { ToolIcon } from '../tool-display'
import type { StreamingToolUse } from '../../../stores/sessionContainerStore'

interface StreamingToolUseBlockProps {
  tool: StreamingToolUse
}

export const StreamingToolUseBlock = memo(function StreamingToolUseBlock({ tool }: StreamingToolUseBlockProps) {
  const category = getToolCategory(tool.name)
  const color = TOOL_COLORS[category] ?? TOOL_COLORS.other

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-md overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-tertiary)] border-b border-[var(--border)]">
        <ToolIcon name={tool.name} className="w-3.5 h-3.5" style={{ color }} />
        <span className="text-xs font-medium" style={{ color }}>{tool.name}</span>
        <span className="ml-auto inline-block w-1.5 h-1.5 bg-[var(--accent)] rounded-full animate-pulse" />
      </div>
      {tool.input && (
        <pre className="text-xs text-[var(--text-secondary)] px-3 py-2 overflow-x-auto max-h-32 whitespace-pre-wrap break-all">
          {tool.input}
        </pre>
      )}
    </div>
  )
})
```

- [ ] **Step 4: 构建验证**

Run: `pnpm --filter @claude-agent-ui/web build`
Expected: 编译成功

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/chat/streaming/
git commit -m "feat(ui): add StreamingTextBlock, StreamingThinkingBlock, StreamingToolUseBlock"
```

---

### Task 7: ChatMessagesPane — 分离完成消息和流式内容渲染

**Files:**
- Modify: `packages/web/src/components/chat/ChatMessagesPane.tsx`

- [ ] **Step 1: 添加 imports 和 streaming state 读取**

替换文件顶部的 imports（第 1-7 行）和添加 streaming 读取：

```typescript
import { useRef, useCallback, useEffect, useMemo, useLayoutEffect, useState } from 'react'
import { MessageComponent, isMessageVisible } from './MessageComponent'
import { ThinkingIndicator } from './ThinkingIndicator'
import { PlanApprovalCard } from './PlanApprovalCard'
import { StreamingTextBlock } from './streaming/StreamingTextBlock'
import { StreamingThinkingBlock } from './streaming/StreamingThinkingBlock'
import { StreamingToolUseBlock } from './streaming/StreamingToolUseBlock'
import { useChatSession } from '../../providers/ChatSessionContext'
import { useSessionContainerStore } from '../../stores/sessionContainerStore'
import type { SpinnerMode } from '../../stores/sessionContainerStore'
```

- [ ] **Step 2: 替换 spinner 轮询为直接 Zustand selector（第 56-76 行）**

删除旧的 useState + setInterval 轮询逻辑，替换为：

```typescript
  // ── Spinner state from Zustand (reactive, no polling) ──
  const spinnerMode = useSessionContainerStore(
    (state) => state.containers.get(sessionId)?.spinnerMode ?? null
  )
  const requestStartTime = useSessionContainerStore(
    (state) => state.containers.get(sessionId)?.requestStartTime ?? null
  )
  const thinkingStartTime = useSessionContainerStore(
    (state) => state.containers.get(sessionId)?.thinkingStartTime ?? null
  )
  const thinkingEndTime = useSessionContainerStore(
    (state) => state.containers.get(sessionId)?.thinkingEndTime ?? null
  )
  const responseLength = useSessionContainerStore(
    (state) => state.containers.get(sessionId)?.responseLength ?? 0
  )

  // ── Streaming state ──
  const streaming = useSessionContainerStore(
    (state) => state.containers.get(sessionId)?.streaming ?? null
  )
  const hasStreamingContent = !!(streaming?.text || streaming?.thinking || (streaming?.toolUses.length ?? 0) > 0 || (streaming?.completedBlocks.length ?? 0) > 0)
```

- [ ] **Step 3: 更新 Footer 可见性逻辑（第 224-233 行）**

替换 Footer 逻辑，不再检查 `_streaming`：

```typescript
      {/* Footer — show ThinkingIndicator when session is running and either:
          - the last message is a user message (waiting for response)
          - there's active streaming content
          - no messages yet */}
      {sessionStatus === 'running' && (() => {
        if (hasStreamingContent) return true
        // Walk backward to find the last non-system message
        for (let i = rawMessages.length - 1; i >= 0; i--) {
          const t = (rawMessages[i] as any).type
          if (t === 'system' || t === 'result') continue
          return t === 'user'
        }
        return true // no messages yet → show
      })() && (
```

- [ ] **Step 4: 在消息列表后添加流式内容渲染（第 219 行后）**

在 `{/* Messages */}` 块之后、Footer 之前，插入流式内容：

```tsx
      {/* Streaming content — appended after completed messages, independent of messages[] */}
      {hasStreamingContent && (
        <div className="px-4 py-2.5">
          <div className="flex items-start">
            <div className="flex-1 min-w-0 flex gap-3 items-start">
              <div className="w-7 h-7 rounded-full bg-[var(--bg-secondary)] border border-[var(--border)] flex items-center justify-center shrink-0">
                <span className="text-xs font-bold font-mono text-[var(--accent)]">C</span>
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                {/* Completed streaming blocks (e.g., thinking finished, text still going) */}
                {streaming?.completedBlocks.map((block, i) => (
                  block.type === 'thinking'
                    ? <StreamingThinkingBlock key={`cb-${i}`} content={block.content} />
                    : <StreamingTextBlock key={`cb-${i}`} text={block.content} />
                ))}
                {/* Current streaming thinking */}
                {streaming?.thinking && (
                  <StreamingThinkingBlock content={streaming.thinking} />
                )}
                {/* Current streaming tool uses */}
                {streaming?.toolUses.map(tool => (
                  <StreamingToolUseBlock key={tool.id} tool={tool} />
                ))}
                {/* Current streaming text */}
                {streaming?.text && (
                  <StreamingTextBlock text={streaming.text} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 5: 更新 auto-scroll 依赖**

在 auto-scroll useEffect（约第 154-160 行）中，确保 streamingVersion 仍在依赖数组中（已有，无需改动）。

- [ ] **Step 6: 构建验证**

Run: `pnpm --filter @claude-agent-ui/web build`
Expected: 编译成功

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/chat/ChatMessagesPane.tsx
git commit -m "feat(ui): render streaming content separately after completed messages"
```

---

### Task 8: MessageComponent — 移除 _streaming 条件分支

**Files:**
- Modify: `packages/web/src/components/chat/MessageComponent.tsx`

- [ ] **Step 1: 清理 isMessageVisible — 移除 _streaming 检查（第 79 行）**

删除第 79 行：
```typescript
  // 删除这行:
  if ((message as any)._streaming) return true
```

- [ ] **Step 2: 清理 assistant 渲染 — 移除 _streaming 空内容放行（第 120 行）**

修改第 120 行：
```typescript
  // 旧:
  if (!hasVisibleContent && !(message as any)._streaming) return null
  // 新:
  if (!hasVisibleContent) return null
```

- [ ] **Step 3: 清理 text block 渲染 — 移除流式分支（第 131, 144-155 行）**

移除 `_streaming` 检查和流式文本分支，text block 统一用 markdown 渲染：

```typescript
              if (block.type === 'text') {
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
                // All completed messages use markdown rendering (no streaming branch)
                if (!block.text) return null
                return <div key={i} className="text-sm text-[var(--text-primary)] leading-relaxed overflow-hidden"><MarkdownRenderer content={block.text} /></div>
              }
```

- [ ] **Step 4: 清理 thinking block 渲染 — 移除流式分支（第 159-173 行）**

移除 `_streaming` 检查和流式 thinking 分支，thinking block 统一用折叠渲染：

```typescript
              if (block.type === 'thinking' || block.type === 'redacted_thinking') {
                const thinkingText = block.thinking || block.text || ''

                // Completed thinking: collapsible rendering
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
```

- [ ] **Step 5: 构建验证**

Run: `pnpm --filter @claude-agent-ui/web build`
Expected: 编译成功

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/chat/MessageComponent.tsx
git commit -m "feat(ui): remove all _streaming conditional branches from MessageComponent"
```

---

### Task 9: 清理废弃代码

**Files:**
- Modify: `packages/web/src/stores/sessionContainerStore.ts`
- Modify: `packages/web/src/lib/WebSocketManager.ts`

- [ ] **Step 1: 从 sessionContainerStore 删除旧的流式方法**

删除以下方法（保留类型导出以防其他文件引用）：
- `updateStreamingBlock()` (约第 373-399 行)
- `clearStreamingFlag()` (约第 401-418 行)
- `StreamState` 类 (约第 80-102 行)
- `streamStates` 从 state 中移除
- `getStreamState()` 方法 (约第 590-599 行)

- [ ] **Step 2: 从 WebSocketManager 删除 currentToolBlockIndex（如果 step 5.6 还没删）**

确保不再有任何对旧方法（`updateStreamingBlock`、`clearStreamingFlag`、`getStreamState`、`StreamState`）的引用。

- [ ] **Step 3: 全局搜索清理**

Run: `grep -rn "_streaming" packages/web/src/ --include="*.ts" --include="*.tsx"`
Expected: 只有测试文件或注释中的引用，无生产代码引用

Run: `grep -rn "StreamState" packages/web/src/ --include="*.ts" --include="*.tsx"`
Expected: 只有类型导出的引用（如有），无使用点

Run: `grep -rn "finalizeStreamingMessage\|buildContentFromAccumulator\|flushStreamState\|accumulator" packages/web/src/ --include="*.ts" --include="*.tsx"`
Expected: 无结果

- [ ] **Step 4: 完整构建验证**

Run: `pnpm build`
Expected: 所有包（shared → server → web）编译成功

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "cleanup: remove deprecated StreamState, finalize, accumulator, _streaming flag"
```

---

### Task 10: 类型检查和集成验证

**Files:** 全项目

- [ ] **Step 1: TypeScript 类型检查**

Run: `pnpm lint`
Expected: 无类型错误

- [ ] **Step 2: 完整构建**

Run: `pnpm build`
Expected: 所有包编译成功

- [ ] **Step 3: 启动 dev server 手动验证**

Run: `pnpm dev`

验证清单：
1. 打开浏览器访问 http://localhost:5173
2. 创建新会话，发送消息
3. 观察流式文本是否实时显示（带光标动画）
4. 观察 thinking 是否实时显示（紫色边框+光标）
5. 流式完成后，消息是否正确转为 markdown 渲染
6. thinking 完成后是否变为折叠的 details 元素
7. 工具调用是否正确显示
8. 多轮对话中消息是否正确累积，无重复/丢失
9. 刷新页面后消息是否正确恢复

- [ ] **Step 4: Commit（如有修复）**

```bash
git add -A
git commit -m "fix: integration fixes for message rendering overhaul"
```
