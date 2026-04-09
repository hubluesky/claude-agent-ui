# Streaming Message Unification — 消灭双渲染路径

**日期**: 2026-04-09
**状态**: Draft
**目标**: 彻底修复 thinking/text 流式内容消失 bug，消灭 `_streaming_block` 概念

---

## 问题

AI thinking 内容在流式阶段可见，但最终 assistant 消息替换后消失。此 bug 已回归 3+ 次（2026-04-02 首次、2026-04-08 确认根因、2026-04-09 再次回归）。

### 根因

当前架构存在 **两条完全不同的渲染路径**，bug 发生在路径切换瞬间：

- **路径 A（流式）**：`stream_event` → 创建 `_streaming_block` 伪消息 → MessageComponent 按 `_blockType` 渲染
- **路径 B（最终）**：SDK `assistant` 消息 → 删除所有 `_streaming_block` → 补丁 accumulator 内容到最终消息 → MessageComponent 按 `block.type` 渲染

路径切换时的补丁逻辑（`handleFinalAssistantMessage` L704-L759）本质上是脆弱的，因为：
1. SDK `includePartialMessages` 下的 assistant 消息 content 数组不可预测（块可能为空、缺失、index 错位）
2. 补丁逻辑建立在"能预测 SDK 遗漏什么"的假设上，随 SDK 版本变化失效
3. 任何触碰流式处理的改动（spinner timing、reconnection、flush）都可能打破脆弱平衡

### 同类风险

- text 块同样受影响（最终消息 text 字段为空时显示消失）
- redacted_thinking 无特殊处理
- stream-snapshot 重连恢复是平行代码路径，也是 bug 温床

---

## 设计：单消息渐进构建

**核心原则**：消灭 `_streaming_block`，流式阶段和最终阶段共用同一个 assistant 消息对象。内容只增不减，永远不做"删除再替换"操作。

### 数据流

```
SDK stream_event → Server broadcastRaw（不变）→ Client handleStreamEvent
                                                       ↓
                                              content_block_start index=0:
                                                创建 assistant 消息（_streaming: true）
                                                content: [{ type: 'thinking', thinking: '' }]
                                                       ↓
                                              content_block_delta:
                                                RAF 节流更新对应 index 的 content block
                                                       ↓
                                              content_block_start index=1:
                                                在同一条消息的 content 数组追加新块
                                                       ↓
SDK assistant msg → Server broadcast（不变）→ Client handleFinalAssistantMessage
                                                       ↓
                                              通过 uuid 找到 streaming 消息
                                              合并 tool_use 块 + 元数据
                                              去掉 _streaming 标记
                                                       ↓
                                              MessageComponent 始终渲染 assistant
```

### 关键规则

1. **Accumulator 是 text/thinking 内容的唯一真相源**。最终 assistant 消息的 text/thinking 字段永远不被信任。
2. **tool_use/server_tool_use 取最终消息**。这些块的完整数据（tool name、input JSON）只在最终消息中可用。
3. **消息对象引用必须在每次内容更新时变更**，确保 React memo 检测到变化。
4. **`_streaming` 是客户端私有标记**（类似 `_optimistic`），不进入 shared protocol 类型。

---

## 逐模块变更

### 1. WebSocketManager.ts（主要改动）

#### handleStreamEvent()

```typescript
// content_block_start
if (evt.type === 'content_block_start') {
  const blockType = evt.content_block?.type ?? 'text'

  if (evt.index === 0) {
    // 新 response 开始 — 创建 streaming assistant 消息
    streamState.accumulator.clear()
    const streamingMsg = {
      ...agentMsg,
      type: 'assistant',
      _streaming: true,
      uuid: agentMsg.uuid,  // 与最终 assistant 消息同 uuid
      message: {
        role: 'assistant',
        content: [createEmptyBlock(blockType)],
      },
    }
    // push 到 container
  } else {
    // 同一 response 的后续块 — 追加到现有 streaming 消息的 content 数组
    // 找到 _streaming: true 的消息，在其 content 数组末尾追加空块
  }

  streamState.accumulator.set(evt.index, { blockType, content: '' })
}

// content_block_delta — 逻辑基本不变，但 flush 时更新消息内的特定 content block
```

#### handleFinalAssistantMessage()（大幅简化）

```typescript
/** 从 accumulator 构建内容块数组。
 *  按 index 升序遍历，每个 entry 生成对应类型的 content block。
 *  只处理 text/thinking — tool_use 来自最终消息。 */
function buildContentFromAccumulator(
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
    // tool_use 等其他类型忽略 — 从最终消息取
  }
  return blocks
}

private handleFinalAssistantMessage(sessionId: string, agentMsg: AgentMessage) {
  const s = store()
  const streamState = s.getStreamState(sessionId)
  // 1. Flush pending deltas
  this.flushAllPendingDeltas(sessionId, streamState)

  // 2. Re-read store after flush (flush may create new containers Map)
  const container = store().containers.get(sessionId)
  if (!container) return
  const messages = container.messages

  // 3. 找到 streaming 消息（_streaming 标记）
  const streamIdx = messages.findIndex(
    (m: any) => m._streaming && m.type === 'assistant'
  )

  // 4. 构建最终 content 数组
  const finalMsg = agentMsg as any
  const accumulatedContent = buildContentFromAccumulator(streamState.accumulator)
  const toolBlocks = (finalMsg.message?.content ?? []).filter(
    (b: any) => b.type === 'tool_use' || b.type === 'server_tool_use'
        || b.type === 'tool_result' || b.type === 'web_search_tool_result'
        || b.type === 'code_execution_tool_result'
  )
  // 也保留 redacted_thinking（accumulator 无法捕获）
  const redactedBlocks = (finalMsg.message?.content ?? []).filter(
    (b: any) => b.type === 'redacted_thinking'
  )
  const mergedContent = [...accumulatedContent, ...redactedBlocks, ...toolBlocks]

  // 5. 构建最终消息（元数据取 SDK 消息，内容取 accumulator + tool/redacted blocks）
  const merged = {
    ...finalMsg,
    message: { ...finalMsg.message, content: mergedContent },
  }
  delete merged._streaming

  // 6. 如果 accumulator 为空但最终消息有内容，信任最终消息（无 stream events 场景）
  if (streamState.accumulator.size === 0 && mergedContent.length === 0) {
    // 完全没有 stream events — 直接使用 SDK 原始消息
    const raw = { ...finalMsg }
    delete raw._streaming
    if (streamIdx >= 0) {
      const updated = [...messages]
      updated[streamIdx] = raw
      // set containers
    } else {
      // push raw
    }
    streamState.clear()
    return
  }

  // 7. 写入 store
  if (streamIdx >= 0) {
    const updated = [...messages]
    updated[streamIdx] = merged
    // set containers
  } else {
    // Fallback：没找到 streaming 消息（stream events 全丢），直接 push
    // push merged
  }

  streamState.clear()
}
```

#### handleStreamSnapshot()（重写）

从 snapshot blocks 创建一条 `_streaming: true` 的 assistant 消息（不再创建多个 `_streaming_block`）：

```typescript
private handleStreamSnapshot(msg: any) {
  const snapshot = msg as any
  const sessionId = snapshot.sessionId as string
  // ...
  const contentBlocks = (snapshot.blocks ?? []).map((block: any) => {
    if (block.type === 'thinking') return { type: 'thinking', thinking: block.content ?? '' }
    return { type: 'text', text: block.content ?? '' }
  })

  const streamingMsg = {
    type: 'assistant',
    _streaming: true,
    uuid: snapshot.messageId,
    message: { role: 'assistant', content: contentBlocks },
  }

  // Push 到 container + 填充 accumulator
}
```

#### doFullSync()

```typescript
// 旧: m._optimistic || m.type === '_streaming_block'
// 新: m._optimistic || m._streaming === true
```

### 2. sessionContainerStore.ts

#### appendStreamingText() → updateStreamingBlock()

重命名并重写。接受 `blockIndex` 参数，更新 streaming 消息内特定 content block：

```typescript
updateStreamingBlock(sessionId: string, blockIndex: number, text: string) {
  const c = containers.get(sessionId)
  if (!c) return
  // 从后向前找 _streaming 消息
  for (let i = c.messages.length - 1; i >= 0; i--) {
    const msg = c.messages[i] as any
    if (msg._streaming && msg.type === 'assistant') {
      const blocks = [...msg.message.content]
      const block = blocks[blockIndex]
      if (!block) return
      // 创建新 block 对象（触发 memo）
      if (block.type === 'thinking') {
        blocks[blockIndex] = { ...block, thinking: (block.thinking ?? '') + text }
      } else {
        blocks[blockIndex] = { ...block, text: (block.text ?? '') + text }
      }
      const updated = [...c.messages]
      updated[i] = { ...msg, message: { ...msg.message, content: blocks } }
      // set containers
      return
    }
  }
}
```

#### StreamState 调整

`pendingDeltaText` 从 `string` 改为 `Map<number, string>`（按 blockIndex 累积）：

```typescript
pendingDeltas = new Map<number, string>()  // 替代 pendingDeltaText
pendingDeltaRafId: number | null = null

// flush 时批量更新所有有 pending text 的 blocks
```

#### SessionContainer 新增字段

```typescript
streamingVersion: number  // 每次 content_block_start 递增，用于滚动触发
```

### 3. MessageComponent.tsx

#### 删除 `_streaming_block` 分支

L215-241 的整个 `_streaming_block` 渲染代码删除。

#### assistant 渲染调整

thinking 块渲染（L148-168）：

```typescript
if (block.type === 'thinking' || block.type === 'redacted_thinking') {
  const isStreaming = (message as any)._streaming === true
  const thinkingText = block.thinking || block.text || ''

  if (isStreaming) {
    // 流式：开放显示 + 光标动画
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

  // 最终：折叠显示（现有逻辑不变）
  // ...
}
```

text 块渲染类似——streaming 时追加闪烁光标。

#### isMessageVisible()

```typescript
// 新增：streaming 消息始终可见
if ((message as any)._streaming) return true

// 删除：_streaming_block 分支
// if ((message as any).type === '_streaming_block') { ... }
```

### 4. ChatMessagesPane.tsx

#### ThinkingIndicator 可见性

```typescript
// 旧:
return t === 'user' || t === '_streaming_block'

// 新:
return t === 'user' || (t === 'assistant' && (rawMessages[i] as any)._streaming)
```

#### 自动滚动

新增 `streamingVersion` 作为滚动依赖：

```typescript
const streamingVersion = container?.streamingVersion ?? 0

useEffect(() => {
  if (!hasInitiallyScrolled.current) return
  if (isAtBottomRef.current && !didPrepend.current) {
    requestAnimationFrame(() => scrollToBottom('smooth'))
  }
}, [messages.length, streamingVersion, scrollToBottom])
```

### 5. 服务器端（零改动）

- `hub.ts`：stream snapshot 逻辑不变（按 blockIndex 追踪内容，与客户端解耦）
- `handler.ts`：消息转发逻辑不变

### 6. shared 类型（零改动）

`_streaming` 是客户端私有标记，不进入 shared types。

---

## 边界 Case 处理

### Abort 中断

`handleSessionComplete` / `handleSessionAborted` 时，扫描 container 中 `_streaming: true` 的消息，去掉标记：

```typescript
// 在 handleSessionComplete 中新增：
const container = s.containers.get(sessionId)
if (container) {
  const hasStreaming = container.messages.some((m: any) => m._streaming)
  if (hasStreaming) {
    const updated = container.messages.map((m: any) =>
      m._streaming ? { ...m, _streaming: undefined } : m
    )
    // set containers with updated messages
  }
}
```

### SDK 未发 stream_event 直接发 assistant

`handleFinalAssistantMessage` 找不到 streaming 消息 → fallback 直接 push，走历史消息的渲染路径。无数据丢失。

### 多客户端重连

服务器的 stream-snapshot 返回 `{ messageId, blocks }` → 客户端创建一条 `_streaming: true` assistant 消息。后续 stream_event 正常追加。与新连接客户端无行为差异。

### 历史消息加载

REST API 返回完整 assistant 消息（无 `_streaming` 标记）→ 走正常渲染路径。零兼容问题。

---

## 改动量

| 模块 | 类型 | 行数变化 |
|------|------|---------|
| WebSocketManager.ts handleStreamEvent | 重写 | -40 / +35 |
| WebSocketManager.ts handleFinalAssistantMessage | 大幅简化 | -130 / +40 |
| WebSocketManager.ts handleStreamSnapshot | 重写 | -35 / +20 |
| WebSocketManager.ts doFullSync | 微调 | -1 / +1 |
| WebSocketManager.ts handleSessionComplete | 新增 abort 清理 | +8 |
| sessionContainerStore.ts appendStreamingText → updateStreamingBlock | 重写 | -20 / +25 |
| sessionContainerStore.ts StreamState | 微调 pendingDelta | -5 / +15 |
| sessionContainerStore.ts container type | 加 streamingVersion | +3 |
| MessageComponent.tsx | 删 _streaming_block，改 thinking/text 渲染 | -30 / +15 |
| ChatMessagesPane.tsx | 改 indicator 判断 + scroll | -3 / +8 |
| **合计** | | **-264 / +170 = 净减 ~94 行** |

服务器端零改动。净减少约 94 行代码。

---

## 不变的部分

- 服务器 WebSocket 协议（C2S/S2C 消息格式）
- 服务器 stream snapshot 机制
- REST API 消息加载格式
- shared 类型定义
- StreamState 的 accumulator 追踪机制（只改 pendingDelta 部分）
- Spinner timing 逻辑
- ThinkingIndicator 组件本身
- SearchBar 搜索逻辑

---

## 验证清单

- [ ] 流式阶段 thinking 可见（紫色文字 + 光标动画）
- [ ] 流式阶段 text 可见（正常文字 + 光标动画）
- [ ] 最终消息 thinking 折叠显示（可展开）
- [ ] 最终消息 text 正常显示（Markdown 渲染）
- [ ] 多 tool_use 场景：thinking + text + tool_use × N
- [ ] abort 中断后内容保留
- [ ] 重连恢复（stream-snapshot）后流式内容可见
- [ ] 历史消息加载正常
- [ ] 多客户端同步正常
- [ ] 自动滚动正常（流式内容增长时跟随）
- [ ] 搜索功能正常
- [ ] ThinkingIndicator 显示/隐藏时机正确
