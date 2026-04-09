# Streaming Message Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the dual rendering path (`_streaming_block` → assistant replacement) that causes recurring thinking/text content disappearing bugs, replacing it with a single assistant message that is progressively built during streaming.

**Architecture:** Stream events create and update a single `assistant` message (marked `_streaming: true`) in the store. When the final SDK assistant message arrives, it merges tool_use blocks and metadata into the existing message and removes the `_streaming` flag. MessageComponent always renders `assistant` messages — no `_streaming_block` type exists.

**Tech Stack:** TypeScript, React 19, Zustand 5

**Spec:** `docs/superpowers/specs/2026-04-09-streaming-message-unification-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/web/src/stores/sessionContainerStore.ts` | Modify | StreamState pendingDeltas, SessionContainer streamingVersion, updateStreamingBlock(), clearStreamingFlag() |
| `packages/web/src/lib/WebSocketManager.ts` | Modify | handleStreamEvent(), handleFinalAssistantMessage(), handleStreamSnapshot(), handleSessionComplete(), doFullSync(), flushStreamState() |
| `packages/web/src/components/chat/MessageComponent.tsx` | Modify | Remove `_streaming_block` rendering, add streaming-aware assistant rendering |
| `packages/web/src/components/chat/ChatMessagesPane.tsx` | Modify | ThinkingIndicator visibility, auto-scroll streamingVersion dependency |

Server-side files (`hub.ts`, `handler.ts`) are **not touched**.

---

### Task 1: Refactor StreamState and SessionContainer in sessionContainerStore.ts

**Files:**
- Modify: `packages/web/src/stores/sessionContainerStore.ts`

This task changes the store foundation — StreamState's pendingDelta from a single string to a per-block Map, adds `streamingVersion` to SessionContainer, replaces `appendStreamingText` with `updateStreamingBlock`, and adds `clearStreamingFlag`.

- [ ] **Step 1: Update StreamState class — change pendingDeltaText to pendingDeltas Map**

In `packages/web/src/stores/sessionContainerStore.ts`, replace the StreamState class (lines 78-103):

```typescript
export class StreamState {
  accumulator = new Map<number, { blockType: string; content: string }>()
  pendingDeltas = new Map<number, string>()
  pendingDeltaRafId: number | null = null

  // Spinner state tracking
  requestStartTime: number | null = null
  thinkingStartTime: number | null = null
  thinkingEndTime: number | null = null
  responseLength = 0
  spinnerMode: SpinnerMode = 'requesting'

  clear() {
    this.accumulator.clear()
    this.pendingDeltas.clear()
    if (this.pendingDeltaRafId !== null) {
      cancelAnimationFrame(this.pendingDeltaRafId)
      this.pendingDeltaRafId = null
    }
    this.requestStartTime = null
    this.thinkingStartTime = null
    this.thinkingEndTime = null
    this.responseLength = 0
    this.spinnerMode = 'requesting'
  }
}
```

- [ ] **Step 2: Add `streamingVersion` to SessionContainer interface**

In `packages/web/src/stores/sessionContainerStore.ts`, add to the SessionContainer interface (after line 71 `needsFullSync: boolean`):

```typescript
  streamingVersion: number
```

And in `createContainer()` (after line 140 `needsFullSync: false,`), add:

```typescript
    streamingVersion: 0,
```

- [ ] **Step 3: Replace `appendStreamingText` with `updateStreamingBlock` in the actions interface**

In `packages/web/src/stores/sessionContainerStore.ts`, in `SessionContainerActions` interface, replace line 181:

```typescript
  // Old:
  // appendStreamingText(sessionId: string, text: string): void
  // New:
  /** Updates a specific content block inside the _streaming assistant message */
  updateStreamingBlock(sessionId: string, blockIndex: number, text: string): void
  /** Removes _streaming flag from all messages in a session (for abort/complete) */
  clearStreamingFlag(sessionId: string): void
  /** Increments streamingVersion (for scroll trigger on new content blocks) */
  incrementStreamingVersion(sessionId: string): void
```

- [ ] **Step 4: Replace `appendStreamingText` implementation with `updateStreamingBlock`, `clearStreamingFlag`, `incrementStreamingVersion`**

In `packages/web/src/stores/sessionContainerStore.ts`, replace the `appendStreamingText` method (lines 369-392) with:

```typescript
  updateStreamingBlock(sessionId, blockIndex, text) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    // Find the _streaming assistant message (search from end)
    for (let i = c.messages.length - 1; i >= 0; i--) {
      const msg = c.messages[i] as any
      if (msg._streaming && msg.type === 'assistant') {
        const content = msg.message?.content
        if (!Array.isArray(content) || !content[blockIndex]) return
        const blocks = [...content]
        const block = blocks[blockIndex]
        // Create new block object (triggers React memo)
        if (block.type === 'thinking') {
          blocks[blockIndex] = { ...block, thinking: (block.thinking ?? '') + text }
        } else {
          blocks[blockIndex] = { ...block, text: (block.text ?? '') + text }
        }
        const updated = [...c.messages]
        updated[i] = { ...msg, message: { ...msg.message, content: blocks } }
        const next = new Map(containers)
        next.set(sessionId, { ...c, messages: updated })
        set({ containers: next })
        return
      }
    }
  },

  clearStreamingFlag(sessionId) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const hasStreaming = c.messages.some((m: any) => m._streaming)
    if (!hasStreaming) return
    const updated = c.messages.map((m: any) => {
      if (m._streaming) {
        const clean = { ...m }
        delete clean._streaming
        return clean
      }
      return m
    })
    const next = new Map(containers)
    next.set(sessionId, { ...c, messages: updated })
    set({ containers: next })
  },

  incrementStreamingVersion(sessionId) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const next = new Map(containers)
    next.set(sessionId, { ...c, streamingVersion: c.streamingVersion + 1 })
    set({ containers: next })
  },
```

- [ ] **Step 5: Also update `clearMessages` to clear streamingVersion**

In `packages/web/src/stores/sessionContainerStore.ts`, in `clearMessages` (around line 394), add `streamingVersion: 0` to the reset:

```typescript
  clearMessages(sessionId) {
    const { containers } = get()
    const c = containers.get(sessionId)
    if (!c) return
    const { streamStates } = get()
    const stream = streamStates.get(sessionId)
    if (stream) stream.clear()
    const next = new Map(containers)
    next.set(sessionId, { ...c, messages: [], hasMore: false, streamingVersion: 0 })
    set({ containers: next })
  },
```

- [ ] **Step 6: Build and verify no type errors**

Run:
```bash
pnpm --filter @claude-agent-ui/web build
```
Expected: Build succeeds. There will be unused-import warnings since WebSocketManager still references `appendStreamingText` — that's fixed in Task 2.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/stores/sessionContainerStore.ts
git commit -m "refactor: replace appendStreamingText with updateStreamingBlock + per-block pendingDeltas

Foundation for streaming message unification: StreamState tracks
pending deltas per block index instead of a single string.
New store actions: updateStreamingBlock, clearStreamingFlag,
incrementStreamingVersion."
```

---

### Task 2: Rewrite WebSocketManager streaming handlers

**Files:**
- Modify: `packages/web/src/lib/WebSocketManager.ts`

This is the core task. Rewrites `handleStreamEvent`, `handleFinalAssistantMessage`, `handleStreamSnapshot`, `flushStreamState`, `doFullSync`, and `handleSessionComplete`.

- [ ] **Step 1: Add `buildContentFromAccumulator` helper function**

In `packages/web/src/lib/WebSocketManager.ts`, add this function inside the class, before `handleStreamEvent`:

```typescript
  /** Build content blocks from the stream accumulator.
   *  Only produces text/thinking blocks — tool_use comes from the final SDK message. */
  private buildContentFromAccumulator(
    accumulator: Map<number, { blockType: string; content: string }>
  ): any[] {
    const blocks: any[] = []
    const sorted = [...accumulator.entries()].sort((a, b) => a[0] - b[0])
    for (const [, entry] of sorted) {
      if (entry.blockType === 'thinking') {
        blocks.push({ type: 'thinking', thinking: entry.content })
      } else if (entry.blockType === 'text') {
        blocks.push({ type: 'text', text: entry.content })
      }
    }
    return blocks
  }

  /** Create an empty content block for the given type */
  private createEmptyBlock(blockType: string): any {
    if (blockType === 'thinking') return { type: 'thinking', thinking: '' }
    return { type: 'text', text: '' }
  }
```

- [ ] **Step 2: Rewrite `flushStreamState` to flush per-block deltas**

Replace the existing `flushStreamState` method (lines 652-658) with:

```typescript
  /** Flush all accumulated pending deltas to the store */
  private flushStreamState(sessionId: string, streamState: StreamState) {
    streamState.pendingDeltaRafId = null
    if (streamState.pendingDeltas.size === 0) return
    const s = store()
    for (const [blockIndex, text] of streamState.pendingDeltas) {
      if (text) s.updateStreamingBlock(sessionId, blockIndex, text)
    }
    streamState.pendingDeltas.clear()
  }
```

- [ ] **Step 3: Rewrite `handleStreamEvent` — create/update streaming assistant message**

Replace the entire `handleStreamEvent` method (lines 571-648) with:

```typescript
  private handleStreamEvent(sessionId: string, agentMsg: AgentMessage) {
    const evt = (agentMsg as any).event
    if (!evt) return

    const s = store()
    const streamState = s.getStreamState(sessionId)

    if (evt.type === 'content_block_start') {
      const blockType = evt.content_block?.type ?? 'text'

      // ── Spinner timing ──
      if (streamState.requestStartTime === null) {
        streamState.requestStartTime = Date.now()
      }
      if (blockType === 'thinking') {
        streamState.spinnerMode = 'thinking'
        if (streamState.thinkingStartTime === null) {
          streamState.thinkingStartTime = Date.now()
        }
      } else if (blockType === 'text') {
        if (streamState.thinkingStartTime !== null && streamState.thinkingEndTime === null) {
          streamState.thinkingEndTime = Date.now()
        }
        streamState.spinnerMode = 'responding'
      } else if (blockType === 'tool_use' || blockType === 'server_tool_use') {
        streamState.spinnerMode = 'tool-use'
      }

      // Flush pending deltas before modifying the message structure
      this.flushStreamState(sessionId, streamState)

      streamState.accumulator.set(evt.index, { blockType, content: '' })

      const container = s.containers.get(sessionId)
      if (!container) return

      if (evt.index === 0) {
        // New response — clear stale accumulator entries and create streaming assistant message
        streamState.accumulator.clear()
        streamState.accumulator.set(0, { blockType, content: '' })

        const streamingMsg: any = {
          ...agentMsg,
          type: 'assistant',
          _streaming: true,
          message: {
            role: 'assistant',
            content: [this.createEmptyBlock(blockType)],
          },
        }
        const next = new Map(s.containers)
        next.set(sessionId, {
          ...container,
          messages: [...container.messages, streamingMsg],
          streamingVersion: container.streamingVersion + 1,
        })
        useSessionContainerStore.setState({ containers: next })
      } else {
        // Subsequent block in same response — append empty block to streaming message
        const messages = container.messages
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i] as any
          if (msg._streaming && msg.type === 'assistant') {
            const updatedContent = [...(msg.message?.content ?? []), this.createEmptyBlock(blockType)]
            const updated = [...messages]
            updated[i] = { ...msg, message: { ...msg.message, content: updatedContent } }
            const next = new Map(s.containers)
            next.set(sessionId, {
              ...container,
              messages: updated,
              streamingVersion: container.streamingVersion + 1,
            })
            useSessionContainerStore.setState({ containers: next })
            break
          }
        }
      }
    } else if (evt.type === 'content_block_delta') {
      const delta = evt.delta
      const deltaText = delta?.type === 'text_delta' ? (delta.text ?? '')
        : delta?.type === 'thinking_delta' ? (delta.thinking ?? '') : ''
      const acc = streamState.accumulator.get(evt.index)
      if (acc) {
        acc.content += deltaText
      }
      streamState.responseLength += deltaText.length

      // Accumulate in pendingDeltas for RAF batching
      const prev = streamState.pendingDeltas.get(evt.index) ?? ''
      streamState.pendingDeltas.set(evt.index, prev + deltaText)

      if (streamState.pendingDeltaRafId === null) {
        streamState.pendingDeltaRafId = requestAnimationFrame(() => {
          this.flushStreamState(sessionId, streamState)
        })
      }
    }
  }
```

- [ ] **Step 4: Rewrite `handleFinalAssistantMessage`**

Replace the entire `handleFinalAssistantMessage` method (lines 660-786) with:

```typescript
  private handleFinalAssistantMessage(sessionId: string, agentMsg: AgentMessage) {
    let s = store()
    const streamState = s.getStreamState(sessionId)

    // 1. Flush any buffered streaming text
    if (streamState.pendingDeltaRafId !== null) {
      cancelAnimationFrame(streamState.pendingDeltaRafId)
      streamState.pendingDeltaRafId = null
    }
    if (streamState.pendingDeltas.size > 0) {
      for (const [blockIndex, text] of streamState.pendingDeltas) {
        if (text) s.updateStreamingBlock(sessionId, blockIndex, text)
      }
      streamState.pendingDeltas.clear()
    }

    // 2. Re-read store after flush
    s = store()
    const container = s.containers.get(sessionId)
    if (!container) return

    const finalMsg = agentMsg as any
    const apiId = finalMsg.message?.id
    const messages = container.messages

    // 3. Find the streaming message
    const streamIdx = messages.findIndex(
      (m: any) => m._streaming && m.type === 'assistant'
    )

    // 4. Build merged content: accumulator (text/thinking) + SDK (tool_use, redacted_thinking)
    const accumulatedContent = this.buildContentFromAccumulator(streamState.accumulator)
    const sdkContent: any[] = finalMsg.message?.content ?? []
    const toolBlocks = sdkContent.filter(
      (b: any) => b.type === 'tool_use' || b.type === 'server_tool_use'
        || b.type === 'tool_result' || b.type === 'web_search_tool_result'
        || b.type === 'code_execution_tool_result'
    )
    const redactedBlocks = sdkContent.filter(
      (b: any) => b.type === 'redacted_thinking'
    )
    const mergedContent = [...accumulatedContent, ...redactedBlocks, ...toolBlocks]

    // 5. If accumulator is empty, trust the SDK message directly (no stream events scenario)
    const useRawSdk = streamState.accumulator.size === 0

    // 6. Build final message
    const merged: any = {
      ...finalMsg,
      message: {
        ...finalMsg.message,
        content: useRawSdk ? sdkContent : mergedContent,
      },
    }
    delete merged._streaming

    // 7. Deduplicate: also remove any previous assistant message with same API id
    let cleaned = messages
    if (apiId) {
      cleaned = messages.filter((m: any) => {
        if (m._streaming) return true  // Keep the streaming msg — we'll replace it by index
        if (m.type === 'assistant' && (m as any).message?.id === apiId) return false
        return true
      })
    }

    // 8. Write to store
    const nextContainers = new Map(s.containers)
    if (streamIdx >= 0) {
      // Replace the streaming message in-place
      const updated = [...cleaned]
      // Recalculate streamIdx in cleaned array
      const newStreamIdx = updated.findIndex((m: any) => m._streaming && m.type === 'assistant')
      if (newStreamIdx >= 0) {
        updated[newStreamIdx] = merged
      } else {
        updated.push(merged)
      }
      nextContainers.set(sessionId, { ...container, messages: updated })
    } else {
      // No streaming message found — fallback: just push the final message
      const updated = [...cleaned, merged]
      nextContainers.set(sessionId, { ...container, messages: updated })
    }
    useSessionContainerStore.setState({ containers: nextContainers })

    // 9. Clear stream state
    streamState.clear()
  }
```

- [ ] **Step 5: Rewrite `handleStreamSnapshot`**

Replace the entire `handleStreamSnapshot` method (lines 1016-1073) with:

```typescript
  private handleStreamSnapshot(msg: any) {
    const snapshot = msg as any
    const sessionId = snapshot.sessionId as string | undefined
    if (!sessionId) return

    const s = store()
    const container = s.containers.get(sessionId)
    if (!container) return

    const streamState = s.getStreamState(sessionId)
    streamState.accumulator.clear()

    // Build content blocks from snapshot
    const contentBlocks: any[] = []
    for (const block of snapshot.blocks ?? []) {
      streamState.accumulator.set(block.index, {
        blockType: block.type,
        content: block.content ?? '',
      })
      if (block.type === 'thinking') {
        contentBlocks.push({ type: 'thinking', thinking: block.content ?? '' })
      } else {
        contentBlocks.push({ type: 'text', text: block.content ?? '' })
      }
    }

    if (contentBlocks.length === 0) return

    // Create a single streaming assistant message
    const streamingMsg: any = {
      type: 'assistant',
      _streaming: true,
      uuid: snapshot.messageId,
      message: { role: 'assistant', content: contentBlocks },
    }

    const next = new Map(s.containers)
    next.set(sessionId, {
      ...container,
      messages: [...container.messages, streamingMsg],
      streamingVersion: container.streamingVersion + 1,
    })
    useSessionContainerStore.setState({ containers: next })
  }
```

- [ ] **Step 6: Update `handleSessionComplete` — clean up streaming flag on abort/complete**

In the existing `handleSessionComplete` method (around line 912), add streaming cleanup after setting status to idle. The method currently looks like:

```typescript
  private handleSessionComplete(msg: any) {
    const sessionId = (msg as any).sessionId as string | undefined
    if (!sessionId) return
    const s = store()
    s.setSessionStatus(sessionId, 'idle')
    s.setApproval(sessionId, null)
    s.setAskUser(sessionId, null)
    s.setPlanApproval(sessionId, null)
    s.setPlanModalOpen(sessionId, false)
    // ...
  }
```

Add after `s.setPlanModalOpen(sessionId, false)`:

```typescript
    // Finalize any in-progress streaming message (e.g. abort during streaming)
    s.clearStreamingFlag(sessionId)
```

- [ ] **Step 7: Update `doFullSync` — change `_streaming_block` filter to `_streaming`**

In the `doFullSync` method (around line 1121), change:

```typescript
    // Old:
    const live = container.messages.filter(
      (m: any) => m._optimistic || m.type === '_streaming_block'
    )
    // New:
    const live = container.messages.filter(
      (m: any) => m._optimistic || (m as any)._streaming === true
    )
```

- [ ] **Step 8: Build and verify no type errors**

Run:
```bash
pnpm --filter @claude-agent-ui/web build
```
Expected: Build succeeds. The web package compiles without errors.

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/lib/WebSocketManager.ts
git commit -m "refactor: rewrite streaming handlers — single assistant message progressive build

Eliminates _streaming_block: stream events now create/update a single
assistant message with _streaming:true. Final SDK message merges
tool_use blocks + metadata. Accumulator is the sole source of truth
for text/thinking content. ~130 lines of fragile patching logic removed."
```

---

### Task 3: Update MessageComponent — remove `_streaming_block`, add streaming-aware rendering

**Files:**
- Modify: `packages/web/src/components/chat/MessageComponent.tsx`

- [ ] **Step 1: Update `isMessageVisible` — replace `_streaming_block` check with `_streaming`**

In `packages/web/src/components/chat/MessageComponent.tsx`, in the `isMessageVisible` function, replace lines 79-82:

```typescript
  // Old:
  if ((message as any).type === '_streaming_block') {
    const blockType = (message as any)._blockType
    return blockType === 'text' || blockType === 'thinking'
  }

  // New:
  if ((message as any)._streaming) return true
```

- [ ] **Step 2: Update assistant thinking block rendering for streaming**

In `packages/web/src/components/chat/MessageComponent.tsx`, replace the thinking/redacted_thinking rendering block (lines 148-168) with:

```typescript
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
```

- [ ] **Step 3: Update assistant text block rendering for streaming cursor**

In the text block rendering (around line 133-147), wrap the normal text rendering to add a cursor when streaming:

```typescript
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
```

- [ ] **Step 4: Delete the `_streaming_block` rendering section**

In `packages/web/src/components/chat/MessageComponent.tsx`, delete the entire `_streaming_block` rendering block (lines 215-241):

```typescript
  // DELETE THIS ENTIRE BLOCK:
  // Streaming block
  if ((message as any).type === '_streaming_block') {
    // ... all ~25 lines
  }
```

- [ ] **Step 5: Build and verify**

Run:
```bash
pnpm --filter @claude-agent-ui/web build
```
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/chat/MessageComponent.tsx
git commit -m "refactor: remove _streaming_block rendering, add streaming-aware assistant rendering

MessageComponent now only renders assistant messages. During streaming
(_streaming: true), thinking shows open with cursor, text shows plain
with cursor. After finalization, thinking collapses, text gets markdown."
```

---

### Task 4: Update ChatMessagesPane — ThinkingIndicator visibility + scroll

**Files:**
- Modify: `packages/web/src/components/chat/ChatMessagesPane.tsx`

- [ ] **Step 1: Update ThinkingIndicator visibility check**

In `packages/web/src/components/chat/ChatMessagesPane.tsx`, replace line 220:

```typescript
          // Old:
          return t === 'user' || t === '_streaming_block'

          // New:
          return t === 'user' || (t === 'assistant' && (rawMessages[i] as any)._streaming)
```

- [ ] **Step 2: Add `streamingVersion` as auto-scroll dependency**

In `packages/web/src/components/chat/ChatMessagesPane.tsx`, add after the existing `useChatSession` context extraction (around line 33-45):

```typescript
  // Get streamingVersion from the container for scroll trigger
  const streamingVersion = useSessionContainerStore(
    (state) => state.containers.get(sessionId)?.streamingVersion ?? 0
  )
```

Add the import for `useSessionContainerStore` at the top if not already imported (it's already imported on line 6).

Then update the auto-scroll useEffect (lines 144-150) to include `streamingVersion`:

```typescript
  // ── Auto-scroll on new messages at bottom (streaming) ──
  useEffect(() => {
    if (!hasInitiallyScrolled.current) return
    // Only follow if it's an append (new message at bottom), not a prepend
    if (isAtBottomRef.current && messages.length > 0 && !didPrepend.current) {
      requestAnimationFrame(() => scrollToBottom('smooth'))
    }
  }, [messages.length, streamingVersion, scrollToBottom])
```

- [ ] **Step 3: Build and verify**

Run:
```bash
pnpm --filter @claude-agent-ui/web build
```
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/chat/ChatMessagesPane.tsx
git commit -m "refactor: update ChatMessagesPane for streaming unification

ThinkingIndicator now checks _streaming flag instead of _streaming_block
type. Auto-scroll uses streamingVersion as additional dependency to
trigger scroll when new content blocks start streaming."
```

---

### Task 5: Full build + manual smoke test

**Files:** None (verification only)

- [ ] **Step 1: Full project build**

Run:
```bash
pnpm build
```
Expected: All 3 packages build successfully (shared → server → web).

- [ ] **Step 2: TypeScript lint check**

Run:
```bash
pnpm lint
```
Expected: No type errors.

- [ ] **Step 3: Grep for any remaining `_streaming_block` references**

Run:
```bash
grep -r "_streaming_block" packages/web/src/ --include="*.ts" --include="*.tsx"
```
Expected: Zero results. The concept should be fully eliminated.

- [ ] **Step 4: Grep for any remaining `appendStreamingText` references**

Run:
```bash
grep -r "appendStreamingText" packages/web/src/ --include="*.ts" --include="*.tsx"
```
Expected: Zero results. Should be fully replaced by `updateStreamingBlock`.

- [ ] **Step 5: Grep for any remaining `pendingDeltaText` references**

Run:
```bash
grep -r "pendingDeltaText" packages/web/src/ --include="*.ts" --include="*.tsx"
```
Expected: Zero results. Should be fully replaced by `pendingDeltas` Map.

- [ ] **Step 6: Manual smoke test checklist**

Start dev server (`pnpm dev`) and test:

1. Send a message — verify thinking appears (purple text with cursor), then text appears (with cursor), then final message renders (thinking collapsed, text with markdown)
2. Send a message that triggers tool use — verify tool_use blocks appear after text
3. Abort mid-stream — verify accumulated content stays visible
4. Refresh page — verify history loads correctly (no empty thinking/text)
5. Check auto-scroll follows content during streaming

- [ ] **Step 7: Final commit if any fixes needed**

If smoke testing reveals issues, fix and commit. Otherwise skip this step.
