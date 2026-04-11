# Queued Messages Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 复刻 Claude Code CLI 的 input queue 行为 — 排队消息在输入框上方可见渲染（单行截断），ESC abort 时一次性取出所有排队消息放回输入框。

**Architecture:** 三层改动：协议层（S2C_SessionAborted 扩展字段），服务端（handleAbort 改造 + 移除 clearQueue），前端（新增 QueuedMessages 组件 + WebSocketManager 拆分 abort/complete 处理 + ChatComposer 消费弹回内容）。

**Tech Stack:** TypeScript, React 19, Zustand 5, Fastify WebSocket, TailwindCSS 4

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/shared/src/protocol.ts` | Modify | S2C_SessionAborted 加 queuedPrompts，移除 C2S_ClearQueue |
| `packages/server/src/ws/handler.ts` | Modify | handleAbort 改造，移除 clearQueue 相关代码 |
| `packages/web/src/stores/sessionContainerStore.ts` | Modify | 新增 popBackPrompts 字段和方法 |
| `packages/web/src/lib/WebSocketManager.ts` | Modify | 拆分 abort/complete 处理，移除 clearQueue |
| `packages/web/src/components/chat/QueuedMessages.tsx` | Create | 排队消息渲染组件 |
| `packages/web/src/components/chat/ChatInterface.tsx` | Modify | 插入 QueuedMessages，ESC handler 调整 |
| `packages/web/src/components/chat/ChatComposer.tsx` | Modify | 移除旧队列 UI，消费 popBackPrompts |

---

### Task 1: Protocol & Server — 协议变更 + 服务端改造

**Files:**
- Modify: `packages/shared/src/protocol.ts:44-47,196-200,390-413`
- Modify: `packages/server/src/ws/handler.ts:69-74,139-141,628-646`

- [ ] **Step 1: 修改 protocol.ts — S2C_SessionAborted 增加 queuedPrompts 字段**

```typescript
// packages/shared/src/protocol.ts
// 找到 S2C_SessionAborted 接口（约第197行），替换为：
export interface S2C_SessionAborted {
  type: 'session-aborted'
  sessionId: string
  queuedPrompts?: string[]
}
```

- [ ] **Step 2: 修改 protocol.ts — 移除 C2S_ClearQueue**

删除 `C2S_ClearQueue` 接口定义（第44-47行）：
```typescript
// 删除这个接口：
export interface C2S_ClearQueue {
  type: 'clear-queue'
  sessionId: string
}
```

从 `C2SMessage` 联合类型（约第396行）中移除 `| C2S_ClearQueue`。

- [ ] **Step 3: 修改 handler.ts — 改造 handleAbort()**

将 `handleAbort()` 函数（第628-638行）替换为：
```typescript
async function handleAbort(connectionId: string, sessionId: string) {
  if (!lockManager.isHolder(sessionId, connectionId)) {
    wsHub.sendTo(connectionId, { type: 'error', message: 'Not lock holder', code: 'not_lock_holder' })
    return
  }
  // Pop all queued prompts BEFORE abort — complete/error callbacks have dequeueNext()
  // that would consume them if we don't clear first
  const queue = messageQueues.get(sessionId)
  const queuedPrompts = queue && queue.length > 0
    ? queue.map(q => q.prompt)
    : undefined
  // Clear server-side queue
  if (queue) {
    messageQueues.delete(sessionId)
    broadcastQueueUpdate(sessionId)
  }
  const session = sessionManager.getActive(sessionId)
  if (session) await session.abort()
  wsHub.broadcast(sessionId, { type: 'session-aborted', sessionId, queuedPrompts })
}
```

- [ ] **Step 4: 修改 handler.ts — 移除 clearSessionQueue 和 handleClearQueue**

删除 `clearSessionQueue()` 函数（第69-74行）：
```typescript
// 删除：
function clearSessionQueue(sessionId: string) {
  if (messageQueues.has(sessionId)) {
    messageQueues.delete(sessionId)
    broadcastQueueUpdate(sessionId)
  }
}
```

删除 `handleClearQueue()` 函数（第640-646行）：
```typescript
// 删除：
function handleClearQueue(connectionId: string, sessionId: string) {
  if (!lockManager.isHolder(sessionId, connectionId)) {
    wsHub.sendTo(connectionId, { type: 'error', message: 'Not lock holder', code: 'not_lock_holder' })
    return
  }
  clearSessionQueue(sessionId)
}
```

删除消息路由中的 `case 'clear-queue'`（第139-141行）：
```typescript
// 删除：
case 'clear-queue':
  handleClearQueue(connectionId, (msg as any).sessionId)
  break
```

- [ ] **Step 5: 构建验证**

Run: `pnpm --filter @claude-agent-ui/shared build && pnpm --filter @claude-agent-ui/server build`
Expected: 编译通过，无类型错误

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/protocol.ts packages/server/src/ws/handler.ts
git commit -m "feat(queue): protocol + server — abort returns queuedPrompts, remove clearQueue"
```

---

### Task 2: Store — sessionContainerStore 新增 popBackPrompts

**Files:**
- Modify: `packages/web/src/stores/sessionContainerStore.ts:69,142,208,494-501`

- [ ] **Step 1: SessionContainer 接口新增 popBackPrompts 字段**

在 `SessionContainer` 接口中（约第69行 `queue` 下方）添加：
```typescript
queue: QueueItem[]
popBackPrompts: string[] | null  // 新增
```

- [ ] **Step 2: 初始化默认值**

在 `getOrCreate()` 中的初始值（约第142行 `queue: []` 下方）添加：
```typescript
queue: [],
popBackPrompts: null,  // 新增
```

- [ ] **Step 3: 新增 setPopBackPrompts 方法签名**

在 actions 签名区域（约第208行 `setQueue` 下方）添加：
```typescript
setQueue(sessionId: string, queue: QueueItem[]): void
setPopBackPrompts(sessionId: string, prompts: string[] | null): void  // 新增
```

- [ ] **Step 4: 新增 setPopBackPrompts 方法实现**

在 `setQueue` 实现（约第494-501行）下方添加：
```typescript
setPopBackPrompts(sessionId, prompts) {
  const { containers } = get()
  const c = containers.get(sessionId)
  if (!c) return
  const next = new Map(containers)
  next.set(sessionId, { ...c, popBackPrompts: prompts })
  set({ containers: next })
},
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/stores/sessionContainerStore.ts
git commit -m "feat(queue): store — add popBackPrompts field for abort queue pop-back"
```

---

### Task 3: WebSocketManager — 拆分 abort/complete + 移除 clearQueue

**Files:**
- Modify: `packages/web/src/lib/WebSocketManager.ts:143-145,191-193,439-441,789-809,908-912`

- [ ] **Step 1: 移除 clearQueue 方法**

删除 `clearQueue()` 方法（约第191-193行）：
```typescript
// 删除：
clearQueue(sessionId: string) {
  this.send({ type: 'clear-queue', sessionId } as any)
}
```

- [ ] **Step 2: 拆分消息路由 — session-aborted 使用独立 handler**

将消息路由（约第439-441行）从：
```typescript
case 'session-complete':
case 'session-aborted':
  this.handleSessionComplete(msg)
  break
```
改为：
```typescript
case 'session-complete':
  this.handleSessionComplete(msg)
  break
case 'session-aborted':
  this.handleSessionAborted(msg)
  break
```

- [ ] **Step 3: 新增 handleSessionAborted 方法**

在 `handleSessionComplete` 方法（约第789-809行）下方添加：
```typescript
private handleSessionAborted(msg: any) {
  const sessionId = (msg as any).sessionId as string | undefined
  if (!sessionId) return
  const s = store()
  s.setSessionStatus(sessionId, 'idle')
  s.setApproval(sessionId, null)
  s.setAskUser(sessionId, null)
  s.setPlanApproval(sessionId, null)
  s.setPlanModalOpen(sessionId, false)
  s.setQueue(sessionId, [])
  s.clearStreaming(sessionId)
  this.currentToolBlockIndex.delete(sessionId)
  // Pop queued prompts back to composer
  const queuedPrompts = (msg as any).queuedPrompts as string[] | undefined
  if (queuedPrompts && queuedPrompts.length > 0) {
    s.setPopBackPrompts(sessionId, queuedPrompts)
  }
  // Refresh session list
  const sessStore = useSessionStore.getState()
  if (sessStore.currentProjectCwd) {
    sessStore.invalidateProjectSessions(sessStore.currentProjectCwd)
    sessStore.loadProjectSessions(sessStore.currentProjectCwd, true)
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/lib/WebSocketManager.ts
git commit -m "feat(queue): ws — split abort/complete handling, remove clearQueue"
```

---

### Task 4: QueuedMessages 组件 — 新建排队消息渲染

**Files:**
- Create: `packages/web/src/components/chat/QueuedMessages.tsx`

- [ ] **Step 1: 创建 QueuedMessages 组件**

```typescript
import { memo } from 'react'
import { useSessionContainerStore } from '../../stores/sessionContainerStore'
import type { QueueItem } from '@claude-agent-ui/shared'

const EMPTY_QUEUE: QueueItem[] = []

export const QueuedMessages = memo(function QueuedMessages({ sessionId }: { sessionId: string }) {
  const queue = useSessionContainerStore(
    (state) => state.containers.get(sessionId)?.queue ?? EMPTY_QUEUE
  )

  if (queue.length === 0) return null

  return (
    <div className="shrink-0 px-5 pb-2 flex flex-col gap-1">
      {queue.map((item) => (
        <div key={item.id} className="flex justify-end">
          <div className="bg-[var(--accent-bg)] rounded-xl rounded-br-sm px-4 py-2 max-w-[70%] opacity-50">
            <p className="text-sm text-[var(--text-primary)] truncate">
              {item.prompt}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
})
```

设计要点：
- `shrink-0` 确保不被压缩，固定在输入框上方
- 复用用户消息样式（`bg-[var(--accent-bg)]`, `rounded-xl rounded-br-sm`, 右对齐）
- `opacity-50` 做变灰效果，区分排队消息和已发送消息
- `truncate`（等价于 `overflow-hidden text-ellipsis whitespace-nowrap`）实现单行截断

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/chat/QueuedMessages.tsx
git commit -m "feat(queue): add QueuedMessages component — visible queued messages above composer"
```

---

### Task 5: ChatInterface — 插入 QueuedMessages + ESC handler 调整

**Files:**
- Modify: `packages/web/src/components/chat/ChatInterface.tsx:1,147-160,188-195`

- [ ] **Step 1: 添加 QueuedMessages import**

在 ChatInterface.tsx 文件顶部 import 区域添加：
```typescript
import { QueuedMessages } from './QueuedMessages'
```

- [ ] **Step 2: 插入 QueuedMessages 到布局中**

在 `ChatMessagesPane` 和 `ChatComposer`/`ApprovalPanel` 之间（约第190行后）插入：

将这段：
```tsx
) : (
  <ChatMessagesPane sessionId={ctx.sessionId} limit={compact ? 50 : undefined} />
)}
{compact ? null : approvalConfig ? (
```

改为：
```tsx
) : (
  <ChatMessagesPane sessionId={ctx.sessionId} limit={compact ? 50 : undefined} />
)}
<QueuedMessages sessionId={ctx.sessionId} />
{compact ? null : approvalConfig ? (
```

- [ ] **Step 3: 修改 ESC handler — 移除 textarea/input 豁免**

将 ESC handler（约第147-160行）从：
```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    const tag = (document.activeElement as HTMLElement)?.tagName
    if (tag === 'TEXTAREA' || tag === 'INPUT') return
    if (ctx.planModalOpen) return
    if (ctx.sessionStatus === 'running' && ctx.lockStatus === 'locked_self') {
      ctx.abort()
    }
  }
  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [ctx])
```

改为：
```typescript
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    if (ctx.planModalOpen) return
    if (ctx.sessionStatus === 'running' && ctx.lockStatus === 'locked_self') {
      e.preventDefault()
      ctx.abort()
    }
  }
  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [ctx])
```

变更说明：移除 `TEXTAREA`/`INPUT` 豁免检查，在输入框内按 ESC 也能 abort（与 CLI 一致）。添加 `e.preventDefault()` 防止 ESC 的默认行为。

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/chat/ChatInterface.tsx
git commit -m "feat(queue): insert QueuedMessages above composer, ESC aborts from anywhere"
```

---

### Task 6: ChatComposer — 移除旧队列 UI + 消费 popBackPrompts

**Files:**
- Modify: `packages/web/src/components/chat/ChatComposer.tsx:5,19,75-77,439-454,500-506`

- [ ] **Step 1: 移除旧的 queue 相关代码**

1. 删除 `wsManager` import（如果只被 clearQueue 使用 — 检查是否有其他用途后再决定；实际上 wsManager 还有其他用途如 abort 和 send，所以保留 import）

2. 删除 `EMPTY_QUEUE` 常量（第19行）：
```typescript
// 删除：
const EMPTY_QUEUE: never[] = []
```

3. 删除 queue 订阅（第75-77行）：
```typescript
// 删除：
const queue = useSessionContainerStore(
  (state) => sessionId ? state.containers.get(sessionId)?.queue ?? EMPTY_QUEUE : EMPTY_QUEUE
)
```

4. 删除队列指示器 UI（第439-454行），整个 `{/* Queue indicator */}` 块：
```tsx
// 删除整个块：
{queue.length > 0 && (
  <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] border-b border-[var(--border)]">
    <span className="inline-flex items-center gap-1">
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
      {queue.length} message{queue.length > 1 ? 's' : ''} queued
    </span>
    <button
      onClick={() => sessionId && wsManager.clearQueue(sessionId)}
      className="text-[var(--text-tertiary)] hover:text-[var(--error)] transition-colors"
      title="Clear queue"
    >
      ✕
    </button>
  </div>
)}
```

5. 修改 minimal 模式 abort 按钮 title（约第500-506行）：
将 `title="Stop (clears queue)"` 改为 `title="Stop"`。

- [ ] **Step 2: 添加 popBackPrompts 消费逻辑**

在 ChatComposer 函数体内（state declarations 区域之后），添加 popBackPrompts 订阅和 effect：

```typescript
const popBackPrompts = useSessionContainerStore(
  (state) => sessionId ? state.containers.get(sessionId)?.popBackPrompts ?? null : null
)

// Consume popBackPrompts: merge queued texts into textarea when abort pops queue
useEffect(() => {
  if (!popBackPrompts || popBackPrompts.length === 0 || !sessionId) return
  const queuedText = popBackPrompts.join('\n')
  setText(prev => {
    const combined = prev ? [queuedText, prev].join('\n') : queuedText
    return combined
  })
  useSessionContainerStore.getState().setPopBackPrompts(sessionId, null)
}, [popBackPrompts, sessionId])
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/ChatComposer.tsx
git commit -m "feat(queue): composer — remove old queue UI, consume popBackPrompts on abort"
```

---

### Task 7: 全量构建验证 + 手动测试

**Files:** None (verification only)

- [ ] **Step 1: TypeScript 类型检查**

Run: `pnpm lint`
Expected: 无类型错误

- [ ] **Step 2: 全量构建**

Run: `pnpm build`
Expected: 所有三个包构建成功

- [ ] **Step 3: 手动测试清单**

1. 启动 dev server: `pnpm dev`
2. 打开浏览器，创建一个会话
3. 发送一条消息，在 AI 运行期间再发送 2-3 条消息
4. 验证：排队消息在输入框上方可见，每条一行，右对齐，半透明
5. 验证：排队消息不随消息列表滚动
6. 验证：按 ESC 中断当前任务
7. 验证：ESC 后所有排队消息文本出现在输入框中（换行分隔）
8. 验证：在输入框内有焦点时按 ESC 也能中断
9. 验证：正常流程（不按 ESC）时，排队消息依次自动执行
10. 验证：手机端红色 ■ 按钮也触发相同的 popAllEditable 行为
