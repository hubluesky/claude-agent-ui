# 服务端权威状态模型：修复状态显示与流式消息可靠性

## 问题

两个相互关联的 bug：

1. **状态提前变 idle**：用户发送消息后 AI 在后台运行，但客户端提前显示 idle 状态（spinner 消失、输入框边框不再高亮）。
2. **流式助手消息断裂/消失**：网络重连后或正常连接中，正在流式输出的内容突然消失。

## 根因

### Bug 1 根因：客户端 isRunning 混合了两个独立状态

客户端判断 "AI 是否在运行" 的逻辑：

```typescript
// ChatComposer.tsx:103
const isRunning = lockStatus === 'locked_self' && sessionStatus === 'running'
```

`lockStatus` 和 `sessionStatus` 是两个独立的概念：
- **lockStatus**：并发控制——谁持有写权限。lock 有 60 秒超时自动释放（tool/ask/plan approval 等待时启动），这是锁管理器的正常行为。
- **sessionStatus**：AI 运行状态——idle/running/awaiting_approval/awaiting_user_input。只有 CLI 发出 `result` 或进程退出才应该变 idle。

当 lock 因超时释放时（比如 tool approval 等了 60 秒），`lockStatus` 变 `idle`，但 `sessionStatus` 仍然是 `running` 或 `awaiting_approval`。由于 isRunning 是两者的 AND，lock 释放直接导致 isRunning = false。

**额外路径**：`resetSessionInteraction()` 方法直接把 `sessionStatus` 设为 `idle`，这是客户端自行推断状态，绕过了服务端权威。

### Bug 2 根因：stream snapshot 不完整 + 客户端重建缺失

1. **服务端 stream snapshot 只包含 text/thinking**：hub.ts 的 `StreamBlock` 类型只有 `text | thinking`，不包含 `tool_use`。重连后 tool 流式内容丢失。
2. **客户端 handleStreamSnapshot 只恢复 text/thinking**：不恢复 tool uses。

## 设计原则

**与 Claude Code CLI 对齐**：在 Claude Code 中，session 状态只有 3 个值（idle/running/requires_action），idle **只在 query 的 finally 块中设置**，是唯一的权威 "完成" 信号。客户端不自行推断 idle。

核心规则：
1. **sessionStatus 只由服务端事件驱动**：`session-state-change`、`session-complete`、`session-aborted` 是唯一能改变 sessionStatus 的消息。
2. **lockStatus 只影响输入权限**：lock 控制谁能发消息和审批，不影响 "AI 是否在运行" 的判断。
3. **流式状态只在明确终态时清除**：final assistant message 或 session-complete/aborted。
4. **stream snapshot 包含所有块类型**：text、thinking、tool_use，确保重连后完整恢复。

## 改动设计

### 1. isRunning 只看 sessionStatus

**文件**：`packages/web/src/components/chat/ChatComposer.tsx`

```typescript
// 改前
const isRunning = lockStatus === 'locked_self' && sessionStatus === 'running'

// 改后
const isRunning = sessionStatus !== 'idle'
```

isRunning 含义从 "我持有锁且 AI 在跑" 变为 "AI 在跑（不管谁持有锁）"。这直接决定了：
- 输入框边框高亮（glow 动画）
- 发送按钮变为停止按钮
- Composer 显示 "Queue message" 还是 "Send"

**文件**：`packages/web/src/components/chat/ChatInterface.tsx`

Esc 中止处理也要统一：

```typescript
// 改前
if (ctx.sessionStatus === 'running' && ctx.lockStatus === 'locked_self')

// 改后
if (ctx.sessionStatus === 'running')
```

注意：abort 操作本身仍需锁权限校验（服务端 handler 会检查），但 Esc 快捷键不应被 lock 状态阻止——如果用户不是 lock holder，服务端会返回 error，但不应该在前端静默屏蔽。

### 2. resetSessionInteraction 不再清 sessionStatus

**文件**：`packages/web/src/stores/sessionContainerStore.ts`

```typescript
// 改前
resetSessionInteraction(sessionId) {
    // ...
    next.set(sessionId, {
      ...c,
      pendingApproval: null,
      pendingAskUser: null,
      pendingPlanApproval: null,
      resolvedPlanApproval: null,
      planModalOpen: false,
      sessionStatus: 'idle',  // ← 客户端自行推断 idle
    })
}

// 改后：去掉 sessionStatus: 'idle'
resetSessionInteraction(sessionId) {
    // ...
    next.set(sessionId, {
      ...c,
      pendingApproval: null,
      pendingAskUser: null,
      pendingPlanApproval: null,
      resolvedPlanApproval: null,
      planModalOpen: false,
      // sessionStatus 不在这里改——只由服务端事件驱动
    })
}
```

### 3. ComposerToolbar 始终显示 session status

**文件**：`packages/web/src/components/chat/ComposerToolbar.tsx`

```typescript
// 改前：locked 状态下隐藏 session status
const statusInfo = isLocked
    ? null
    : isDisconnected
      ? { ... }
      : statusConfig[sessionStatus]

// 改后：始终显示 session status（lock 影响输入权限，不影响状态可见性）
const statusInfo = isDisconnected
    ? { color: 'bg-[var(--text-muted)]', text: connectionStatus, pulse: connectionStatus === 'connecting' || connectionStatus === 'reconnecting' }
    : statusConfig[sessionStatus]
```

### 4. Stream snapshot 支持 tool_use

**文件**：`packages/server/src/ws/hub.ts`

扩展 StreamBlock 类型和 snapshot 逻辑：

```typescript
// 改前
interface StreamBlock {
  type: 'text' | 'thinking'
  content: string
}

// 改后
interface StreamBlock {
  type: 'text' | 'thinking' | 'tool_use'
  content: string
  toolId?: string
  toolName?: string
}
```

`updateStreamSnapshot` 新增 tool_use 支持：

```typescript
updateStreamSnapshot(
  sessionId: string,
  messageId: string,
  blockIndex: number,
  blockType: 'text' | 'thinking' | 'tool_use',
  delta: string,
  toolMeta?: { toolId: string; toolName: string }
): void {
  // ... 现有逻辑
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

`getStreamSnapshot` 返回包含 tool_use 的完整 blocks，无需修改（已经返回所有 blocks）。

**文件**：`packages/server/src/ws/handler.ts`

在 `session.on('message')` 的 stream_event 处理中，分两步更新 tool_use snapshot：

**步骤 A：`content_block_start` 时初始化 tool_use entry**

```typescript
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
}
```

**步骤 B：`content_block_delta` 时 append tool input**

```typescript
if (event?.type === 'content_block_delta') {
  const delta = event.delta
  const index = event.index ?? 0
  if (delta?.type === 'text_delta' && delta.text) {
    wsHub.updateStreamSnapshot(realSessionId, msg.uuid ?? '', index, 'text', delta.text)
  } else if (delta?.type === 'thinking_delta' && delta.thinking) {
    wsHub.updateStreamSnapshot(realSessionId, msg.uuid ?? '', index, 'thinking', delta.thinking)
  } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
    // tool_use entry 已在 content_block_start 中初始化（带 toolId/toolName）
    // 这里只 append content，不需要重复传 toolMeta
    wsHub.updateStreamSnapshot(realSessionId, msg.uuid ?? '', index, 'tool_use', delta.partial_json)
  }
}
```

注意：`updateStreamSnapshot` 对已存在的 entry 只做 `content += delta`，不覆盖 toolId/toolName。对不存在的 entry 才创建新的。这样 content_block_start 创建带 meta 的 entry，后续 delta 只追加 content。

### 5. 客户端 handleStreamSnapshot 完整重建

**文件**：`packages/web/src/lib/WebSocketManager.ts`

```typescript
// 改前：只恢复 text/thinking
private handleStreamSnapshot(msg: any) {
    for (const block of snapshot.blocks ?? []) {
      if (block.type === 'thinking') {
        s.updateStreamingThinking(sessionId, block.content ?? '')
      } else if (block.type === 'text') {
        s.updateStreamingText(sessionId, block.content ?? '')
      }
    }
    s.setSpinnerMode(sessionId, 'responding')
}

// 改后：恢复所有块类型
private handleStreamSnapshot(msg: any) {
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
    // spinnerMode 根据最后一个块类型决定
    const modeMap: Record<string, SpinnerMode> = {
      thinking: 'thinking',
      text: 'responding',
      tool_use: 'tool-use',
    }
    s.setSpinnerMode(sessionId, modeMap[lastBlockType] ?? 'responding')
}
```

### 6. stream-snapshot 协议扩展

**文件**：`packages/shared/src/protocol.ts`

在 `S2CMessage` 的 `stream-snapshot` 消息类型中，blocks 的类型定义需要扩展：

```typescript
// blocks 中的元素
interface StreamSnapshotBlock {
  index: number
  type: 'text' | 'thinking' | 'tool_use'
  content: string
  toolId?: string
  toolName?: string
}
```

## 不需要改的地方

| 模块 | 原因 |
|------|------|
| `lock.ts` | lock 超时释放逻辑本身正确（60s 超时是并发控制需求），问题在客户端混用了 lock 和 session 状态 |
| `cli-session.ts` | 服务端状态机逻辑正确：idle 只在 result/exit 时设置 |
| `handler.ts` 的事件绑定 | session-complete/error 后的 dequeue 逻辑正确 |
| `ChatMessagesPane.tsx:250` | ThinkingIndicator 的可见性条件 `sessionStatus === 'running'` 正确——修复 isRunning 后它自然工作 |
| `session-complete` handler | 清除 streaming 正确（final assistant message 已到达） |
| `pushMessageAndClearStreaming` | 原子替换逻辑正确 |

## 影响范围

| 文件 | 改动类型 | 改动量 |
|------|----------|--------|
| `packages/web/src/components/chat/ChatComposer.tsx` | isRunning 判断 | 1 行 |
| `packages/web/src/components/chat/ChatInterface.tsx` | Esc 中止判断 | 1 行 |
| `packages/web/src/components/chat/ComposerToolbar.tsx` | 始终显示 status | 3 行 |
| `packages/web/src/stores/sessionContainerStore.ts` | 去掉 sessionStatus: idle | 1 行 |
| `packages/web/src/lib/WebSocketManager.ts` | handleStreamSnapshot 完整重建 | 15 行 |
| `packages/server/src/ws/hub.ts` | StreamBlock 加 tool_use | 10 行 |
| `packages/server/src/ws/handler.ts` | stream_event 中 tool input 更新 snapshot | 10 行 |
| `packages/shared/src/protocol.ts` | stream-snapshot block 类型扩展 | 5 行 |

总计约 46 行实质改动，8 个文件。

## 验证场景

1. **正常流程**：发送消息 → spinner 显示 → 流式输出 → session-complete → spinner 消失、状态 idle
2. **Tool approval > 60s**：发送消息 → tool approval → 等 60s+ → lock 释放 → spinner 仍然显示、状态仍然是 awaiting_approval
3. **网络断开重连（streaming 中）**：断网 → 重连 → stream snapshot 恢复（含 tool uses）→ 继续流式输出
4. **网络断开重连（idle 中）**：断网 → 重连 → session-state 显示 idle → 正确
5. **CLI 进程崩溃**：进程 exit → state-change: idle 广播 → 客户端正确切换 idle
6. **session-complete 后 queue dequeue**：complete → idle → dequeue → running → 新一轮流式
7. **多终端观察**：观察者（locked_other）能看到 AI running 状态和 spinner
