# 消息渲染架构大修——对标 Claude Code CLI

**日期**: 2026-04-10
**目标**: 一劳永逸解决消息渲染的反复回归问题，完整对标 Claude Code CLI 的消息处理和渲染架构。

## 问题根因

当前消息渲染反复出问题的根本原因：**流式消息和完成消息混在同一个 `messages[]` 数组中**。

- 流式消息带 `_streaming: true` 标记，与完成消息共存于 `messages[]`
- 流式结束时需要 `finalizeStreamingMessage()` "替换"流式消息为完成消息——这个转换逻辑极其脆弱
- accumulator + pendingDeltas + RAF 批处理 + spinnerMode 等多个可变状态需要精确协调
- partial assistant 和 final assistant 两条消息的区分和合并逻辑容易出错

Claude Code CLI 的做法完全不同：**流式数据和完成消息彻底分离**，没有 finalize 逻辑，没有替换，没有竞态。

## 参考架构：Claude Code CLI

### Claude Code 的消息数据流

```
SDK query() 返回事件
    │
    ├─ stream_event (type: 'stream_event')
    │   ├─ content_block_delta (text_delta)    → 更新 streamingText state
    │   ├─ content_block_delta (thinking_delta) → 更新 streamingThinking state
    │   ├─ content_block_start (tool_use)       → 追加到 streamingToolUses state
    │   └─ message_stop                         → 清空流式 state
    │   【不进 messages 数组】
    │
    └─ 完成消息 (type: 'assistant' | 'user' | 'system' | ...)
        └─ 调用 onMessage() → setMessages(prev => [...prev, newMsg])
           【进 messages 数组】
```

### Claude Code 的消息存储模型

```typescript
// REPL.tsx — 完成消息（不可变数组）
const [messages, setMessages] = useState<Message[]>([]);

// REPL.tsx — 流式状态（独立，不在 messages 里）
const [streamingText, setStreamingText] = useState<string | null>(null);
const [streamingToolUses, setStreamingToolUses] = useState<StreamingToolUse[]>([]);
const [streamingThinking, setStreamingThinking] = useState<StreamingThinking | null>(null);
```

### Claude Code 的渲染管道

```
messages[]
    │
    ├─ normalizeMessages() — 拆分 content blocks 为独立消息，分配稳定 UUID
    ├─ reorderMessagesInUI() — tool_use → preHooks → tool_result → postHooks 排序
    ├─ applyGrouping() — 按工具名称聚合相邻 tool_use/tool_result
    ├─ collapseReadSearchGroups() — 折叠 read/search 操作
    │
    └─ 渲染列表
        ├─ 完成消息（来自 messages[]）
        ├─ 流式 tool_use（来自 streamingToolUses，转为合成消息追加到末尾）
        ├─ 流式 thinking（来自 streamingThinking，独立渲染在末尾）
        └─ 流式 text（来自 streamingText，独立渲染在末尾）
```

## 设计方案

### 原则

1. **服务器发什么，前端就渲染什么** — 前端不做消息累积/合并/finalize
2. **完成消息和流式内容分离** — messages[] 只存完成消息，流式内容用独立状态
3. **对标 Claude Code CLI 的整条链路** — 服务端对标后端层，前端对标 UI 层
4. **传输层透明** — WebSocket + 缓冲 + 重放是传输层关注点，不影响渲染逻辑

### 一、服务端改动

#### 1.1 消息事件处理（v1-session.ts）

**当前问题**：服务端直接透传所有 SDK 事件，包括 partial assistant 消息，前端需要自己区分 partial vs final。

**对标 Claude Code**：Claude Code 后端在 content_block_stop 时构建完整消息，message_delta 时直接变异——UI 层从不需要处理"两条 assistant"的问题。

**改动**：
- 在 SDK 事件循环中，对 assistant 消息添加明确标记区分 partial vs final
- partial assistant：添加 `_partial: true` 标记，仅用于提供 tool_use 块结构和 model 信息
- final assistant：无标记，作为该轮的权威完成消息
- stream_event：保持原样转发

```typescript
// v1-session.ts — 事件循环改造
for await (const msg of queryResult) {
  if (msg.type === 'assistant') {
    // SDK 返回的 assistant 消息可能是 partial（流式中间态）或 final（完成态）
    // partial: stop_reason === null, usage 不完整
    // final: stop_reason !== null（'end_turn', 'tool_use' 等）
    const isPartial = !msg.message?.stop_reason;
    if (isPartial) {
      this.emit('message', { ...msg, _partial: true });
    } else {
      this.emit('message', msg); // final，无标记
    }
  } else {
    this.emit('message', msg);
  }
}
```

#### 1.2 handler.ts 消息转发

**改动**：
- partial assistant：通过 `broadcastRaw()`（不缓冲），因为它是临时中间态
- final assistant：通过 `broadcast()`（缓冲+序列号），因为它是持久化消息
- stream_event：保持现有 `broadcastRaw()` 逻辑不变

```typescript
// handler.ts — 消息转发策略
session.on('message', (msg) => {
  if (msg.type === 'assistant' && msg._partial) {
    // partial assistant — 不缓冲，用于实时显示 tool_use 块
    wsHub.broadcastRaw(sessionId, wrapS2C(msg));
  } else if (msg.type === 'stream_event') {
    // stream_event — 不缓冲，更新 stream-snapshot
    wsHub.updateStreamSnapshot(sessionId, msg);
    wsHub.broadcastRaw(sessionId, wrapS2C(msg));
  } else {
    // final assistant, user, result, system 等 — 缓冲+序列号
    wsHub.broadcast(sessionId, wrapS2C(msg));
  }
});
```

#### 1.3 shared/messages.ts

**改动**：AgentMessage 类型添加可选的 `_partial` 字段。

```typescript
// 在 assistant 类型的 AgentMessage 中添加
interface AssistantAgentMessage {
  type: 'assistant';
  message: { role: 'assistant'; content: ContentBlock[]; model?: string; stop_reason?: string; usage?: Usage };
  _partial?: boolean;  // 新增：标记为 partial（流式中间态）
}
```

### 二、前端改动

#### 2.1 sessionContainerStore.ts — 消息存储重构

**当前结构**（要废弃）：
```typescript
// ❌ 流式和完成混在一起
interface SessionContainer {
  messages: AgentMessage[];        // 混合 _streaming 和完成消息
  streamingVersion: number;
}

// ❌ 复杂的可变流式状态
class StreamState {
  accumulator: Map<number, { blockType: string; content: string }>;
  pendingDeltas: Map<number, string>;
  pendingDeltaRafId: number | null;
  spinnerMode: SpinnerMode;
  // ...
}
```

**新结构**（对标 Claude Code）：
```typescript
interface SessionContainer {
  // 完成消息（不可变数组，只存 final 消息）
  messages: AgentMessage[];

  // 流式内容（独立于 messages，对标 Claude Code 的 streamingText/streamingToolUses/streamingThinking）
  streaming: {
    text: string | null;                    // 当前正在流式输出的文本
    thinking: { content: string } | null;    // 当前正在流式输出的思考
    toolUses: StreamingToolUse[];            // 当前正在流式输出的工具调用块
    model: string | null;                    // 当前模型（从 partial assistant 获取）
    // 已完成的流式块（同一 assistant 消息中，前面的块已完成但 final 还没到）
    // 例如：thinking 块完成后进入这里，text 块开始流式
    completedBlocks: CompletedStreamingBlock[];
  };

  // ...

interface CompletedStreamingBlock {
  type: 'thinking' | 'text' | 'tool_use';
  content: string;
  // tool_use 额外字段
  toolId?: string;
  toolName?: string;
}

  // 状态指示
  spinnerMode: SpinnerMode | null;          // 'requesting' | 'thinking' | 'responding' | 'tool-use' | null
  requestStartTime: number | null;
  thinkingStartTime: number | null;

  // 版本号（触发 UI 更新）
  streamingVersion: number;

  // 其他不变的字段
  status: SessionStatus;
  hasMore: boolean;
  isLoadingHistory: boolean;
  isLoadingMore: boolean;
  lockHolder: string | null;
  // ...
}

interface StreamingToolUse {
  id: string;
  name: string;
  input: string;  // 累积的 JSON 字符串
}
```

**废弃的方法**：
- `updateStreamingBlock()` — 不再需要，流式内容直接更新 streaming 字段
- `clearStreamingFlag()` — 不再需要，没有 _streaming 标记了
- `StreamState` 类 — 完全废弃

**新方法**：
```typescript
// 更新流式文本（从 stream_event text_delta）
updateStreamingText(sessionId: string, deltaText: string): void

// 更新流式思考（从 stream_event thinking_delta）
updateStreamingThinking(sessionId: string, deltaThinking: string): void

// 添加/更新流式工具调用（从 stream_event content_block_start/delta）
addStreamingToolUse(sessionId: string, toolUse: StreamingToolUse): void
updateStreamingToolInput(sessionId: string, toolId: string, deltaJson: string): void

// 清空所有流式内容（final assistant 到达时，或 session-complete）
clearStreaming(sessionId: string): void

// 设置模型信息（从 partial assistant）
setStreamingModel(sessionId: string, model: string): void
```

#### 2.2 WebSocketManager.ts — 流式处理重写

**当前逻辑**（要废弃）：
- `handleStreamEvent()` — 三阶段流式处理（content_block_start → delta → stop）+ accumulator + pendingDeltas + RAF
- `handleFinalAssistantMessage()` — 区分 CASE A（流式中合并工具块）和 CASE B（无流式直接推送）
- `finalizeStreamingMessage()` — 从 accumulator 构建最终内容，替换 _streaming 消息

**新逻辑**（对标 Claude Code 的 handleMessageFromStream）：

```typescript
handleS2CMessage(msg: S2C_AgentMessage) {
  const agentMsg = msg.message;

  switch (agentMsg.type) {
    case 'stream_event':
      this.handleStreamEvent(msg.sessionId, agentMsg);
      break;

    case 'assistant':
      if (agentMsg._partial) {
        // Partial assistant — 提取 tool_use 块和 model 信息，不进 messages
        this.handlePartialAssistant(msg.sessionId, agentMsg);
      } else {
        // Final assistant — 清空流式内容，追加到 messages
        store.clearStreaming(msg.sessionId);
        store.pushMessage(msg.sessionId, agentMsg);
      }
      break;

    case 'user':
    case 'result':
    case 'system':
    default:
      // 完成消息，直接追加到 messages
      store.pushMessage(msg.sessionId, agentMsg);
      break;
  }
}

handleStreamEvent(sessionId: string, msg: StreamEventMessage) {
  const event = msg.event;

  switch (event.type) {
    case 'content_block_start':
      if (event.content_block.type === 'tool_use') {
        store.addStreamingToolUse(sessionId, {
          id: event.content_block.id,
          name: event.content_block.name,
          input: '',
        });
        store.setSpinnerMode(sessionId, 'tool-use');
      } else if (event.content_block.type === 'thinking') {
        store.setSpinnerMode(sessionId, 'thinking');
      } else if (event.content_block.type === 'text') {
        store.setSpinnerMode(sessionId, 'responding');
      }
      break;

    case 'content_block_delta':
      if (event.delta.type === 'text_delta') {
        store.updateStreamingText(sessionId, event.delta.text);
      } else if (event.delta.type === 'thinking_delta') {
        store.updateStreamingThinking(sessionId, event.delta.thinking);
      } else if (event.delta.type === 'input_json_delta') {
        store.updateStreamingToolInput(sessionId, currentToolId, event.delta.partial_json);
      }
      break;

    case 'content_block_stop':
      // 当前块完成。对于同一 assistant 消息中的多个块（如先 thinking 再 text），
      // 需要将完成的块"毕业"到 completedStreamingBlocks，为下一个块腾出位置。
      // 例如：thinking 块完成后，清空 streaming.thinking，
      //       将其内容存入 completedStreamingBlocks，然后 text 块开始。
      this.graduateCurrentBlock(sessionId, event.index);
      break;

    case 'message_stop':
      // 消息流结束，清空残留流式状态（安全网，正常由 final assistant 触发）
      break;
  }
}

handlePartialAssistant(sessionId: string, msg: AssistantAgentMessage) {
  // 从 partial assistant 提取 model 信息
  if (msg.message?.model) {
    store.setStreamingModel(sessionId, msg.message.model);
  }
  // 从 partial assistant 提取完整的 tool_use 块结构
  // （stream_event 的 input_json_delta 是碎片，partial assistant 有完整结构）
  for (const block of msg.message?.content ?? []) {
    if (block.type === 'tool_use') {
      store.addStreamingToolUse(sessionId, {
        id: block.id,
        name: block.name,
        input: JSON.stringify(block.input),
      });
    }
  }
}
```

**废弃的函数**：
- `finalizeStreamingMessage()` — 完全删除
- `handleFinalAssistantMessage()` — 用上面的简单分支替代
- `flushStreamState()` — 不再需要 RAF 批处理
- `buildContentFromAccumulator()` — 不再需要

#### 2.3 ChatMessagesPane.tsx — 列表构建

**当前**：遍历 `messages[]`（混合流式和完成消息），用 `isMessageVisible()` 过滤。

**新逻辑**（对标 Claude Code 的 Messages.tsx）：

```tsx
function ChatMessagesPane({ sessionId }) {
  const messages = useContainerField(sessionId, 'messages');       // 完成消息
  const streaming = useContainerField(sessionId, 'streaming');     // 流式内容

  return (
    <div ref={scrollRef}>
      {/* 完成消息列表 */}
      {messages.filter(isMessageVisible).map(msg => (
        <MessageComponent key={msg.uuid} message={msg} />
      ))}

      {/* 流式内容（追加在末尾，独立于 messages） */}
      {/* 1. 已完成的流式块（thinking 完成后等待 final assistant） */}
      {streaming.completedBlocks.map((block, i) => (
        <CompletedStreamingBlock key={`completed-${i}`} block={block} />
      ))}
      {/* 2. 当前正在流式输出的内容 */}
      {streaming.thinking && (
        <StreamingThinkingBlock content={streaming.thinking.content} />
      )}
      {streaming.toolUses.map(tool => (
        <StreamingToolUseBlock key={tool.id} tool={tool} />
      ))}
      {streaming.text && (
        <StreamingTextBlock text={streaming.text} />
      )}
    </div>
  );
}
```

#### 2.4 MessageComponent.tsx — 简化渲染

**当前**：大量 `_streaming` 条件判断（流式用纯文本+光标，完成用 markdown）。

**新逻辑**：MessageComponent 只渲染完成消息，**没有流式条件分支**。

- assistant 消息：遍历 content blocks，每个 block 按类型渲染（text → markdown, thinking → 折叠, tool_use → 工具详情）
- 所有流式渲染逻辑移到独立的 `StreamingThinkingBlock`、`StreamingToolUseBlock`、`StreamingTextBlock` 组件

#### 2.5 新增流式渲染组件

```
components/chat/streaming/
  StreamingTextBlock.tsx      — 纯文本 + 光标动画
  StreamingThinkingBlock.tsx  — 思考中动画 + 内容预览
  StreamingToolUseBlock.tsx   — 工具调用进行中 + 参数预览
```

这些组件接收流式数据，渲染"进行中"的样式。与 MessageComponent 完全独立。

#### 2.6 ThinkingIndicator.tsx / StatusBar

- `spinnerMode` 从 `container.spinnerMode` 读取（不再从 StreamState 类轮询）
- 去掉 500ms setInterval 轮询，改为直接响应 Zustand 状态变更

### 三、传输层（基本不改）

#### 3.1 WSHub（hub.ts）

- `stream-snapshot` 机制保持不变 — 用于重连时恢复流式中间态
- 缓冲策略调整：partial assistant 走 `broadcastRaw()`，final assistant 走 `broadcast()`
- 其余逻辑（序列号、TTL、重放）不变

#### 3.2 重连恢复

重连时：
1. 缓冲消息重放 → 前端收到完成消息，追加到 `messages[]`
2. stream-snapshot 恢复 → 前端重建 `streaming` 状态
3. 无需特殊的 finalize 逻辑

### 四、不改动的部分

| 组件 | 原因 |
|------|------|
| shared/protocol.ts | S2C 消息类型不变，只在 AgentMessage 层添加 `_partial` |
| ApprovalPanel / AskUserPanel | 独立交互组件，不依赖流式消息 |
| REST API (sessions.ts 等) | 与渲染架构无关 |
| SQLite / 设置存储 | 与渲染架构无关 |

## 改动文件清单

### 服务端（3 文件）
| 文件 | 改动 |
|------|------|
| `packages/server/src/agent/v1-session.ts` | assistant 消息添加 `_partial` 标记 |
| `packages/server/src/ws/handler.ts` | partial assistant 走 broadcastRaw |
| `packages/shared/src/messages.ts` | AgentMessage 类型添加 `_partial` 字段 |

### 前端（5 文件改动 + 3 文件新增）
| 文件 | 改动 |
|------|------|
| `packages/web/src/stores/sessionContainerStore.ts` | 重构：废弃 StreamState，新增 streaming 字段和方法 |
| `packages/web/src/lib/WebSocketManager.ts` | 重写流式处理逻辑，废弃 finalize |
| `packages/web/src/components/chat/ChatMessagesPane.tsx` | 分离完成消息列表和流式内容渲染 |
| `packages/web/src/components/chat/MessageComponent.tsx` | 移除所有 `_streaming` 条件分支 |
| `packages/web/src/components/chat/ThinkingIndicator.tsx` | 适配新的 spinnerMode 读取方式 |
| `packages/web/src/components/chat/streaming/StreamingTextBlock.tsx` | **新增** |
| `packages/web/src/components/chat/streaming/StreamingThinkingBlock.tsx` | **新增** |
| `packages/web/src/components/chat/streaming/StreamingToolUseBlock.tsx` | **新增** |

### 总计：11 文件（8 改动 + 3 新增）

## 迁移策略

1. **先改服务端**：添加 `_partial` 标记，不影响现有前端（前端忽略未知字段）
2. **再改 store**：重构 sessionContainerStore，新旧方法并存过渡
3. **再改 WebSocketManager**：替换流式处理逻辑
4. **最后改渲染层**：MessageComponent + ChatMessagesPane + 新增流式组件
5. **清理**：删除废弃的 StreamState 类、finalize 相关代码

## 验证清单

- [ ] 流式文本实时显示，光标动画正常
- [ ] 流式 thinking 正确显示，完成后折叠
- [ ] 流式 tool_use 实时显示参数构建
- [ ] final assistant 到达后流式内容清除，完成消息正确渲染
- [ ] 多轮对话中消息不重复、不丢失、不乱序
- [ ] 断线重连后消息和流式状态正确恢复
- [ ] abort 操作正确清除流式内容
- [ ] 多终端同时观看同一会话，渲染一致
- [ ] 历史消息加载（resume）正常
- [ ] 工具审批面板正常弹出和响应
