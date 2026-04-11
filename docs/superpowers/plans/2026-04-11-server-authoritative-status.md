# Server-Authoritative Status Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix premature idle status and streaming message disappearance by making session status purely server-driven and stream snapshots complete.

**Architecture:** Two independent fix tracks: (A) decouple isRunning from lockStatus so it only depends on sessionStatus (server-authoritative), (B) extend stream snapshot to include tool_use blocks for reliable reconnection. No new files, no new abstractions — surgical edits to 8 existing files.

**Tech Stack:** TypeScript, Zustand, Fastify WebSocket

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/shared/src/protocol.ts:365-370` | Modify | Add `tool_use` to `S2C_StreamSnapshot` block type |
| `packages/server/src/ws/hub.ts:27-30,332-363` | Modify | Extend `StreamBlock` type and snapshot methods for `tool_use` |
| `packages/server/src/ws/handler.ts:334-347` | Modify | Capture `content_block_start` + `input_json_delta` into snapshot |
| `packages/web/src/lib/WebSocketManager.ts:900-917` | Modify | Rebuild tool_use blocks from snapshot on reconnect |
| `packages/web/src/stores/sessionContainerStore.ts:546-561` | Modify | Remove `sessionStatus: 'idle'` from `resetSessionInteraction` |
| `packages/web/src/components/chat/ChatComposer.tsx:103` | Modify | `isRunning` only checks `sessionStatus` |
| `packages/web/src/components/chat/ChatInterface.tsx:157` | Modify | Esc abort only checks `sessionStatus` |
| `packages/web/src/components/chat/ComposerToolbar.tsx:54-58` | Modify | Always show session status indicator |

---

### Task 1: Extend shared protocol type for stream-snapshot

**Files:**
- Modify: `packages/shared/src/protocol.ts:365-370`

- [ ] **Step 1: Add `tool_use` type and optional fields to `S2C_StreamSnapshot`**

In `packages/shared/src/protocol.ts`, find line 365-370:

```typescript
export interface S2C_StreamSnapshot {
  type: 'stream-snapshot'
  sessionId: string
  messageId: string
  blocks: { index: number; type: 'text' | 'thinking'; content: string }[]
}
```

Replace with:

```typescript
export interface S2C_StreamSnapshot {
  type: 'stream-snapshot'
  sessionId: string
  messageId: string
  blocks: { index: number; type: 'text' | 'thinking' | 'tool_use'; content: string; toolId?: string; toolName?: string }[]
}
```

- [ ] **Step 2: Build shared package**

Run: `pnpm --filter @claude-agent-ui/shared build`
Expected: Clean compilation, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/protocol.ts
git commit -m "feat: extend stream-snapshot protocol to include tool_use blocks"
```

---

### Task 2: Extend server-side stream snapshot for tool_use

**Files:**
- Modify: `packages/server/src/ws/hub.ts:27-30,332-363`

- [ ] **Step 1: Extend `StreamBlock` interface**

In `packages/server/src/ws/hub.ts`, find line 27-30:

```typescript
interface StreamBlock {
  type: 'text' | 'thinking'
  content: string
}
```

Replace with:

```typescript
interface StreamBlock {
  type: 'text' | 'thinking' | 'tool_use'
  content: string
  toolId?: string
  toolName?: string
}
```

- [ ] **Step 2: Extend `updateStreamSnapshot` signature and body**

In `packages/server/src/ws/hub.ts`, find line 331-344:

```typescript
  /** Update the active stream snapshot for a session */
  updateStreamSnapshot(sessionId: string, messageId: string, blockIndex: number, blockType: 'text' | 'thinking', delta: string): void {
    const buf = this.getOrCreateBuffer(sessionId)
    if (!buf.activeStream || buf.activeStreamMessageId !== messageId) {
      buf.activeStream = new Map()
      buf.activeStreamMessageId = messageId
    }
    const existing = buf.activeStream.get(blockIndex)
    if (existing) {
      existing.content += delta
    } else {
      buf.activeStream.set(blockIndex, { type: blockType, content: delta })
    }
  }
```

Replace with:

```typescript
  /** Update the active stream snapshot for a session */
  updateStreamSnapshot(sessionId: string, messageId: string, blockIndex: number, blockType: 'text' | 'thinking' | 'tool_use', delta: string, toolMeta?: { toolId: string; toolName: string }): void {
    const buf = this.getOrCreateBuffer(sessionId)
    if (!buf.activeStream || buf.activeStreamMessageId !== messageId) {
      buf.activeStream = new Map()
      buf.activeStreamMessageId = messageId
    }
    const existing = buf.activeStream.get(blockIndex)
    if (existing) {
      existing.content += delta
    } else {
      buf.activeStream.set(blockIndex, {
        type: blockType,
        content: delta,
        ...(toolMeta && { toolId: toolMeta.toolId, toolName: toolMeta.toolName }),
      })
    }
  }
```

- [ ] **Step 3: Extend `getStreamSnapshot` return type**

In `packages/server/src/ws/hub.ts`, find line 355-364:

```typescript
  /** Get the current stream snapshot for reconnection */
  getStreamSnapshot(sessionId: string): { messageId: string; blocks: { index: number; type: 'text' | 'thinking'; content: string }[] } | null {
    const buf = this.sessionBuffers.get(sessionId)
    if (!buf?.activeStream || !buf.activeStreamMessageId) return null
    const blocks: { index: number; type: 'text' | 'thinking'; content: string }[] = []
    for (const [index, block] of buf.activeStream) {
      blocks.push({ index, type: block.type, content: block.content })
    }
    return { messageId: buf.activeStreamMessageId, blocks }
  }
```

Replace with:

```typescript
  /** Get the current stream snapshot for reconnection */
  getStreamSnapshot(sessionId: string): { messageId: string; blocks: { index: number; type: 'text' | 'thinking' | 'tool_use'; content: string; toolId?: string; toolName?: string }[] } | null {
    const buf = this.sessionBuffers.get(sessionId)
    if (!buf?.activeStream || !buf.activeStreamMessageId) return null
    const blocks: { index: number; type: 'text' | 'thinking' | 'tool_use'; content: string; toolId?: string; toolName?: string }[] = []
    for (const [index, block] of buf.activeStream) {
      blocks.push({ index, type: block.type, content: block.content, toolId: block.toolId, toolName: block.toolName })
    }
    return { messageId: buf.activeStreamMessageId, blocks }
  }
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/ws/hub.ts
git commit -m "feat: extend StreamBlock and snapshot methods to support tool_use"
```

---

### Task 3: Capture tool_use blocks in handler stream_event

**Files:**
- Modify: `packages/server/src/ws/handler.ts:335-345`

- [ ] **Step 1: Add `content_block_start` and `input_json_delta` handling**

In `packages/server/src/ws/handler.ts`, find line 335-345:

```typescript
      if (msg.type === 'stream_event') {
        const event = msg.event
        if (event?.type === 'content_block_delta') {
          const delta = event.delta
          const index = event.index ?? 0
          if (delta?.type === 'text_delta' && delta.text) {
            wsHub.updateStreamSnapshot(realSessionId, msg.uuid ?? '', index, 'text', delta.text)
          } else if (delta?.type === 'thinking_delta' && delta.thinking) {
            wsHub.updateStreamSnapshot(realSessionId, msg.uuid ?? '', index, 'thinking', delta.thinking)
          }
        }
```

Replace with:

```typescript
      if (msg.type === 'stream_event') {
        const event = msg.event
        if (event?.type === 'content_block_start') {
          const blockType = event.content_block?.type
          if (blockType === 'tool_use' || blockType === 'server_tool_use') {
            const toolBlock = event.content_block
            const index = event.index ?? 0
            wsHub.updateStreamSnapshot(realSessionId, msg.uuid ?? '', index, 'tool_use', '', {
              toolId: toolBlock.id ?? `tool-${index}`,
              toolName: toolBlock.name ?? '',
            })
          }
        } else if (event?.type === 'content_block_delta') {
          const delta = event.delta
          const index = event.index ?? 0
          if (delta?.type === 'text_delta' && delta.text) {
            wsHub.updateStreamSnapshot(realSessionId, msg.uuid ?? '', index, 'text', delta.text)
          } else if (delta?.type === 'thinking_delta' && delta.thinking) {
            wsHub.updateStreamSnapshot(realSessionId, msg.uuid ?? '', index, 'thinking', delta.thinking)
          } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
            wsHub.updateStreamSnapshot(realSessionId, msg.uuid ?? '', index, 'tool_use', delta.partial_json)
          }
        }
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/ws/handler.ts
git commit -m "feat: capture tool_use content_block_start and input_json_delta in stream snapshot"
```

---

### Task 4: Rebuild tool_use from snapshot on client reconnect

**Files:**
- Modify: `packages/web/src/lib/WebSocketManager.ts:900-917`

- [ ] **Step 1: Extend `handleStreamSnapshot` to restore tool_use blocks**

In `packages/web/src/lib/WebSocketManager.ts`, find line 900-918 (the entire `handleStreamSnapshot` method):

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

Replace with:

```typescript
  private handleStreamSnapshot(msg: any) {
    const snapshot = msg as any
    const sessionId = snapshot.sessionId as string | undefined
    if (!sessionId) return

    const s = store()
    const container = s.containers.get(sessionId)
    if (!container) return

    // Rebuild streaming state from snapshot blocks (all types: text, thinking, tool_use)
    let lastBlockType: string = 'text'
    for (const block of snapshot.blocks ?? []) {
      if (block.type === 'thinking') {
        s.updateStreamingThinking(sessionId, block.content ?? '')
        lastBlockType = 'thinking'
      } else if (block.type === 'text') {
        s.updateStreamingText(sessionId, block.content ?? '')
        lastBlockType = 'text'
      } else if (block.type === 'tool_use') {
        s.addStreamingToolUse(sessionId, {
          id: block.toolId ?? `tool-${block.index}`,
          name: block.toolName ?? '',
          input: block.content ?? '',
        })
        lastBlockType = 'tool_use'
      }
    }
    // spinnerMode based on last block type
    const modeMap: Record<string, 'thinking' | 'responding' | 'tool-use'> = {
      thinking: 'thinking',
      text: 'responding',
      tool_use: 'tool-use',
    }
    s.setSpinnerMode(sessionId, modeMap[lastBlockType] ?? 'responding')
  }
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/lib/WebSocketManager.ts
git commit -m "feat: restore tool_use blocks from stream snapshot on reconnect"
```

---

### Task 5: Fix isRunning — decouple from lockStatus

**Files:**
- Modify: `packages/web/src/components/chat/ChatComposer.tsx:103`
- Modify: `packages/web/src/components/chat/ChatInterface.tsx:157`
- Modify: `packages/web/src/stores/sessionContainerStore.ts:558`
- Modify: `packages/web/src/components/chat/ComposerToolbar.tsx:54-58`

- [ ] **Step 1: Fix `isRunning` in ChatComposer**

In `packages/web/src/components/chat/ChatComposer.tsx`, find line 103:

```typescript
  const isRunning = lockStatus === 'locked_self' && sessionStatus === 'running'
```

Replace with:

```typescript
  const isRunning = sessionStatus !== 'idle'
```

- [ ] **Step 2: Fix Esc abort in ChatInterface**

In `packages/web/src/components/chat/ChatInterface.tsx`, find line 157:

```typescript
      if (ctx.sessionStatus === 'running' && ctx.lockStatus === 'locked_self') {
```

Replace with:

```typescript
      if (ctx.sessionStatus === 'running') {
```

- [ ] **Step 3: Remove `sessionStatus: 'idle'` from resetSessionInteraction**

In `packages/web/src/stores/sessionContainerStore.ts`, find line 551-559:

```typescript
    next.set(sessionId, {
      ...c,
      pendingApproval: null,
      pendingAskUser: null,
      pendingPlanApproval: null,
      resolvedPlanApproval: null,
      planModalOpen: false,
      sessionStatus: 'idle',
    })
```

Replace with:

```typescript
    next.set(sessionId, {
      ...c,
      pendingApproval: null,
      pendingAskUser: null,
      pendingPlanApproval: null,
      resolvedPlanApproval: null,
      planModalOpen: false,
    })
```

- [ ] **Step 4: Always show session status indicator in ComposerToolbar**

In `packages/web/src/components/chat/ComposerToolbar.tsx`, find line 54-58:

```typescript
  const statusInfo = isLocked
    ? null // locked state has no status indicator
    : isDisconnected
      ? { color: 'bg-[var(--text-muted)]', text: connectionStatus, pulse: connectionStatus === 'connecting' || connectionStatus === 'reconnecting' }
      : statusConfig[sessionStatus]
```

Replace with:

```typescript
  const statusInfo = isDisconnected
    ? { color: 'bg-[var(--text-muted)]', text: connectionStatus, pulse: connectionStatus === 'connecting' || connectionStatus === 'reconnecting' }
    : statusConfig[sessionStatus]
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/chat/ChatComposer.tsx packages/web/src/components/chat/ChatInterface.tsx packages/web/src/stores/sessionContainerStore.ts packages/web/src/components/chat/ComposerToolbar.tsx
git commit -m "fix: decouple isRunning from lockStatus, session status is server-authoritative only"
```

---

### Task 6: Build and verify

- [ ] **Step 1: Build all packages**

Run: `pnpm build`
Expected: Clean compilation across shared → server → web, no type errors.

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: No type errors.

- [ ] **Step 3: Final commit if any build fixes needed**

Only if build/lint revealed issues that need fixing.
