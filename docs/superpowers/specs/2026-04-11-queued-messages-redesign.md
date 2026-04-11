# Queued Messages Redesign

## Problem

排队消息（input queue）的当前实现有三个问题：

1. **位置错误**：队列指示器渲染在 ChatComposer 的 `border` 容器内部，应该在输入框上方独立显示
2. **内容不可见**：只显示 "2 messages queued" 计数，看不到每条消息的实际内容
3. **行为不一致**：当前有 x 按钮清空队列和 abort 时自动清空队列，但 Claude Code CLI 的行为是 ESC abort 时一次性取出所有排队消息放回输入框

## Goal

完全复刻 Claude Code CLI 的 input queue 行为，唯一差异是 web 端每条排队消息只显示一行（单行 ellipsis 截断）。

## Design

### 1. 排队消息渲染

**新组件 `QueuedMessages`**（`packages/web/src/components/chat/QueuedMessages.tsx`）

- 位置：`ChatMessagesPane`（可滚动区域）和 `ChatComposer`（底部固定）之间
- 不在滚动容器内，固定在输入框正上方，不随消息滚动
- 订阅 `sessionContainerStore` 的 `queue` 状态

**每条排队消息渲染规则：**
- 类似用户消息的布局，但颜色变灰（`text-[var(--text-muted)]`）
- 带 "You" 标签（与普通用户消息一致），标签也变灰
- 内容强制单行：`overflow: hidden; text-overflow: ellipsis; white-space: nowrap`
- 无任何交互按钮（无 x，无清空）

**在 ChatInterface.tsx 中的插入位置：**
```tsx
<ChatMessagesPane ... />

{/* 排队消息固定在输入框上方 */}
<QueuedMessages sessionId={ctx.sessionId} />

{compact ? null : approvalConfig ? (
  <ApprovalPanel ... />
) : (
  <ChatComposer ... />
)}
```

compact（多面板）模式下也显示。

### 2. ESC / Abort 流程改造

复刻 CLI 的 `popAllEditable` 行为：ESC 中断时一次性取出所有排队消息放回输入框。

**服务端 `handleAbort()` 改造（`handler.ts`）：**

```
1. 权限检查（lockManager.isHolder）
2. 取出当前队列所有消息的 prompt 列表
3. 清空服务端队列
4. 调用 session.abort()
5. 广播 session-aborted，附带 queuedPrompts: string[]
```

关键点：必须先清空队列再 abort，因为 abort 完成后会触发 `session.on('complete')` 回调，该回调有 `dequeueNext()` 调用。如果不先清空，complete 回调会抢先消费队列消息。

**协议变更（`protocol.ts`）：**

`S2C_SessionAborted` 增加可选字段：
```typescript
export interface S2C_SessionAborted {
  type: 'session-aborted'
  sessionId: string
  queuedPrompts?: string[]  // 新增：abort 时取出的排队消息文本
}
```

**前端处理（`WebSocketManager.ts`）：**

`session-aborted` 和 `session-complete` 当前共用 `handleSessionComplete()`，需要拆分：

- `session-complete`：保持现有行为（清空队列、清空流式状态）
- `session-aborted`：同样清空状态，但额外处理 `queuedPrompts` —— 通过 `sessionContainerStore` 暂存，让 ChatComposer 消费

**ChatComposer / ChatInterface 消费 queuedPrompts：**

`sessionContainerStore` 新增 `popBackPrompts` 字段（`string[] | null`），当 `session-aborted` 携带 `queuedPrompts` 时写入此字段。ChatComposer 通过 effect 监听此字段，非空时将内容用换行符拼接写入 textarea，然后清空 `popBackPrompts`。

### 3. ESC 按键行为调整

当前 `ChatInterface.tsx` 的 ESC handler 在 textarea/input 获焦时不触发：
```typescript
if (tag === 'TEXTAREA' || tag === 'INPUT') return
```

CLI 中用户在输入框内按 ESC 也能 abort。改为：当 session 正在运行且持有锁时，ESC 始终触发 abort，无论焦点在哪里。如果输入框有内容，abort 后将队列弹回的内容拼在**前面**，当前输入内容在**后面**（与 CLI `popAllEditable` 行为一致：`[...queuedTexts, currentInput].join('\n')`）。

### 4. 移除的功能

| 移除项 | 文件 | 说明 |
|-------|------|------|
| `C2S_ClearQueue` 接口 | `shared/protocol.ts` | 不再需要客户端主动清空队列 |
| `C2S_ClearQueue` 在 `C2SMessage` 联合中的条目 | `shared/protocol.ts` | 同上 |
| `handleClearQueue()` 函数 | `server/ws/handler.ts` | 移除 handler |
| `case 'clear-queue'` 消息路由 | `server/ws/handler.ts` | 移除路由 |
| `clearSessionQueue()` 函数 | `server/ws/handler.ts` | 内联到 handleAbort 中（取出+清空） |
| `clearQueue()` 方法 | `web/lib/WebSocketManager.ts` | 前端不再需要 |
| 队列指示器 UI（计数 + x 按钮） | `web/components/chat/ChatComposer.tsx` | 由新组件 QueuedMessages 替代 |
| `EMPTY_QUEUE` 常量 | `web/components/chat/ChatComposer.tsx` | 不再需要 |
| queue 订阅 | `web/components/chat/ChatComposer.tsx` | 移到 QueuedMessages 组件 |
| abort 按钮 title "Stop (clears queue)" | `web/components/chat/ChatComposer.tsx` | 改为 "Stop" |

### 5. 保留不变的

- 服务端入队逻辑（session busy 时 `enqueueMessage()`）
- 服务端 `complete`/`error` 回调的 `dequeueNext()`（正常流程：队列消息依次自动执行）
- `S2C_QueueUpdated` 广播机制（客户端需要知道队列内容来渲染）
- `sessionContainerStore.setQueue()` 方法
- `QueueItem` 类型定义
- Join/Subscribe 时发送当前队列状态

### 6. 数据流总览

**正常流程（session 忙碌时发消息）：**
```
用户发送 → 服务端 enqueue → broadcastQueueUpdate → 前端 setQueue → QueuedMessages 渲染
session complete → dequeueNext → 自动执行下一条 → broadcastQueueUpdate
```

**ESC abort 流程：**
```
用户按 ESC → ctx.abort() → 服务端 handleAbort()
  → 取出所有队列 prompts
  → 清空服务端队列
  → session.abort()
  → 广播 session-aborted { queuedPrompts }
前端收到 session-aborted
  → 状态归 idle
  → setQueue([])
  → setPopBackPrompts(queuedPrompts)
ChatComposer effect 检测到 popBackPrompts
  → 拼接写入 textarea
  → 清空 popBackPrompts
```

## File Changes Summary

| 文件 | 变更类型 |
|------|---------|
| `packages/shared/src/protocol.ts` | 修改（S2C_SessionAborted 加字段，移除 C2S_ClearQueue） |
| `packages/server/src/ws/handler.ts` | 修改（handleAbort 改造，移除 clearQueue 相关） |
| `packages/web/src/components/chat/QueuedMessages.tsx` | 新增 |
| `packages/web/src/components/chat/ChatInterface.tsx` | 修改（插入 QueuedMessages，ESC handler 调整） |
| `packages/web/src/components/chat/ChatComposer.tsx` | 修改（移除队列指示器，消费 popBackPrompts） |
| `packages/web/src/lib/WebSocketManager.ts` | 修改（拆分 abort/complete 处理，移除 clearQueue） |
| `packages/web/src/stores/sessionContainerStore.ts` | 修改（新增 popBackPrompts 字段和方法） |
| `packages/web/src/components/chat/ComposerToolbar.tsx` | 检查（abort 按钮 title） |
