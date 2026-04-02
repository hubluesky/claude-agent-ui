# ExitPlanMode 计划审批 UI 设计

## 概述

完整复刻 Claude Code CLI 的计划审批流程。当 Agent 在 plan 模式下调用 `ExitPlanMode` 工具时，以内嵌计划卡片 + 可展开全屏 Modal 的形式展示计划内容，并提供与 CLI 一致的 4 个操作选项。

## Claude Code CLI 行为参考

### ExitPlanMode 审批选项（标准会话）

```
Would you like to proceed?

❯ 1. Yes, clear context and auto-accept edits    (shift+tab)
  2. Yes, auto-accept edits
  3. Yes, manually approve edits
  4. Type here to tell Claude what to change
```

### ExitPlanMode 审批选项（bypass permissions 会话）

```
❯ 1. Yes, clear context and bypass permissions
  2. Yes, and bypass permissions
  3. Yes, manually approve edits
  4. Type here to tell Claude what to change
```

### 行为映射

| # | 选项 | 允许/拒绝 | 权限模式切换 | 上下文处理 |
|---|------|----------|------------|----------|
| 1 | Clear context + auto-accept | allow | → acceptEdits | 结束当前 session，以 plan 文件引用新建 session |
| 2 | Auto-accept edits | allow | → acceptEdits | 保持当前上下文 |
| 3 | Manually approve edits | allow | → default | 保持当前上下文 |
| 4 | 输入反馈 | deny (feedback) | 保持 plan | 保持当前上下文 |

### SDK 数据结构

**ExitPlanModeInput**（canUseTool 的 input 参数）：
```typescript
{
  allowedPrompts?: { tool: "Bash"; prompt: string }[]
  [k: string]: unknown  // 运行时可能包含 planFilePath 等字段
}
```

**ExitPlanModeOutput**（工具执行后的输出）：
```typescript
{
  plan: string | null           // 计划 Markdown 内容
  filePath?: string             // 计划文件路径
  isAgent: boolean
  hasTaskTool?: boolean
  planWasEdited?: boolean
  awaitingLeaderApproval?: boolean
  requestId?: string
}
```

## 设计方案

### 1. 数据流

```
1. SDK 调用 canUseTool("ExitPlanMode", input, options)
2. Server: v1-session 特殊处理（不走 getAutoDecision）
3. Server: 从 planFilePath 读取计划文件内容
4. Server: emit('plan-approval', { requestId, planContent, planFilePath, allowedPrompts })
5. WS Handler: 广播 S2C_PlanApproval 给所有客户端
6. Frontend: connectionStore 设置 pendingPlanApproval
7. Frontend: 渲染 PlanApprovalCard（内嵌卡片）
8. User: 选择选项 / 输入反馈
9. Frontend: 发送 C2S_ResolvePlanApproval
10. Server: 映射为 PermissionResult
11. Server: 执行 setPermissionMode + 可选 clear context
12. SDK: 收到 allow/deny 结果
```

### 2. Protocol 变更 (packages/shared/protocol.ts)

```typescript
// ─── S2C: 计划审批请求 ───
export interface S2C_PlanApproval {
  type: 'plan-approval'
  sessionId: string
  requestId: string
  planContent: string                              // 计划 Markdown 全文
  planFilePath: string                             // 文件路径
  allowedPrompts: { tool: string; prompt: string }[]  // 实施所需权限
  readonly: boolean                                // 非锁持有者只读
}

// ─── S2C: 计划审批已解决 ───
export interface S2C_PlanApprovalResolved {
  type: 'plan-approval-resolved'
  requestId: string
  decision: string
}

// ─── C2S: 计划审批响应 ───
export interface C2S_ResolvePlanApproval {
  type: 'resolve-plan-approval'
  sessionId: string
  requestId: string
  decision: 'clear-and-accept' | 'auto-accept' | 'manual' | 'feedback'
  feedback?: string  // decision === 'feedback' 时必填
}
```

同时更新 `C2SMessage` 和 `S2CMessage` union 类型。

### 3. Server 变更

#### v1-session.ts

**canUseTool 中特殊处理 ExitPlanMode**（类似现有的 AskUserQuestion 处理）：

```typescript
async canUseTool(toolName, input, options) {
  if (toolName === 'AskUserQuestion') {
    return this.handleAskUserTool(input)
  }

  // ExitPlanMode 必须始终走用户审批，即使在 plan 模式下
  if (toolName === 'ExitPlanMode') {
    return this.handleExitPlanMode(input, options)
  }

  const autoDecision = this.getAutoDecision(toolName)
  if (autoDecision) return { ...autoDecision, updatedInput: input }
  // ... 现有逻辑
}
```

**新增 handleExitPlanMode 方法**：

```typescript
private async handleExitPlanMode(
  input: Record<string, unknown>,
  options: { toolUseID: string; /* ... */ }
): Promise<PermissionResult> {
  this.setStatus('awaiting_approval')
  const requestId = randomUUID()

  // 读取计划文件内容
  let planContent = ''
  let planFilePath = (input.planFilePath as string) || ''

  // 优先从 input 获取，fallback 从 ~/.claude/plans/ 读取最新文件
  if (planFilePath) {
    try {
      planContent = readFileSync(planFilePath, 'utf-8')
    } catch { /* 文件读取失败 */ }
  }

  const decision = await new Promise<PlanApprovalDecision>((resolve) => {
    const timeout = setTimeout(() => {
      this.pendingPlanApprovals.delete(requestId)
      resolve({ decision: 'feedback', feedback: 'Approval timed out' })
    }, APPROVAL_TIMEOUT_MS)

    this.pendingPlanApprovals.set(requestId, { resolve, timeout })
    this.emit('plan-approval', {
      requestId,
      planContent,
      planFilePath,
      allowedPrompts: (input.allowedPrompts as any[]) || [],
    })
  })

  this.setStatus('running')

  if (decision.decision === 'feedback') {
    return { behavior: 'deny', message: decision.feedback || 'User requested changes' }
  }

  return { behavior: 'allow', updatedInput: input }
}
```

**新增 PlanApprovalDecision 类型和 pending map**：

```typescript
interface PlanApprovalDecision {
  decision: 'clear-and-accept' | 'auto-accept' | 'manual' | 'feedback'
  feedback?: string
}

interface PendingPlanApproval {
  resolve: (decision: PlanApprovalDecision) => void
  timeout: ReturnType<typeof setTimeout>
}

// 在类中
private pendingPlanApprovals = new Map<string, PendingPlanApproval>()
```

**新增 resolvePlanApproval 方法**：

```typescript
resolvePlanApproval(requestId: string, decision: PlanApprovalDecision): void {
  const pending = this.pendingPlanApprovals.get(requestId)
  if (pending) {
    clearTimeout(pending.timeout)
    pending.resolve(decision)
    this.pendingPlanApprovals.delete(requestId)
  }
}
```

#### handler.ts

**处理 C2S_ResolvePlanApproval**：

```typescript
case 'resolve-plan-approval': {
  const session = sessionManager.getActive(msg.sessionId)
  if (!session) break

  // 1. 解决 plan approval
  (session as V1QuerySession).resolvePlanApproval(msg.requestId, {
    decision: msg.decision,
    feedback: msg.feedback,
  })

  // 2. 根据选项切换权限模式
  switch (msg.decision) {
    case 'clear-and-accept':
    case 'auto-accept':
      await session.setPermissionMode('acceptEdits')
      break
    case 'manual':
      await session.setPermissionMode('default')
      break
    // 'feedback': 保持 plan 模式
  }

  // 3. Clear context：结束当前 session，前端用 plan 文件引用新建
  if (msg.decision === 'clear-and-accept') {
    // 广播 clear-context 事件，让前端处理新建 session
    hub.broadcast(msg.sessionId, {
      type: 'plan-clear-context',
      sessionId: msg.sessionId,
      planFilePath: /* 从 pending 中获取 */,
    })
  }

  // 4. 广播已解决
  hub.broadcast(msg.sessionId, {
    type: 'plan-approval-resolved',
    requestId: msg.requestId,
    decision: msg.decision,
  })
  break
}
```

**plan-approval 事件监听**（广播给所有客户端）：

```typescript
session.on('plan-approval', (req) => {
  hub.broadcast(sessionId, {
    type: 'plan-approval',
    sessionId,
    requestId: req.requestId,
    planContent: req.planContent,
    planFilePath: req.planFilePath,
    allowedPrompts: req.allowedPrompts,
    readonly: !isLockHolder,
  })
})
```

#### Clear context 实现

"Clear context" 在 Claude Code CLI 中等价于：结束当前 session，以 `source: 'clear'` 创建新 session，新 session 携带 plan 文件引用。

实现方式：
1. 当 `decision === 'clear-and-accept'` 时，允许 ExitPlanMode（让当前 query 正常完成）
2. 服务端广播 `plan-clear-context` 事件
3. 前端收到后，使用当前 session 的 `sessionId` 作为 `resumeSessionId` 发送新的 `send-message`，内容为 plan 文件引用
4. 或者更简单：当 query 完成后，前端自动发送 `/compact` 命令清理上下文

**注**：根据 GitHub issue #33225，CLI 本身对 clear context 的实现也存在 bug（新 session 仍保持 plan 模式）。我们的实现需要确保模式切换在 session 创建前完成。

### 4. Frontend 变更

#### connectionStore.ts

新增 plan approval 状态：

```typescript
interface ConnectionState {
  // ... 现有字段
  pendingPlanApproval: PlanApprovalState | null
  planModalOpen: boolean
}

interface PlanApprovalState {
  requestId: string
  planContent: string
  planFilePath: string
  allowedPrompts: { tool: string; prompt: string }[]
  readonly: boolean
}
```

#### useWebSocket.ts

处理新消息类型：

```typescript
case 'plan-approval':
  conn.setPendingPlanApproval({
    requestId: msg.requestId,
    planContent: msg.planContent,
    planFilePath: msg.planFilePath,
    allowedPrompts: msg.allowedPrompts,
    readonly: msg.readonly,
  })
  break

case 'plan-approval-resolved':
  conn.setPendingPlanApproval(null)
  conn.setPlanModalOpen(false)
  break

case 'plan-clear-context':
  // 处理 clear context：前端可以发送 compact 或提示用户
  break
```

新增 `respondPlanApproval` 方法：

```typescript
function respondPlanApproval(
  requestId: string,
  decision: 'clear-and-accept' | 'auto-accept' | 'manual' | 'feedback',
  feedback?: string
) {
  send({
    type: 'resolve-plan-approval',
    sessionId: useSessionStore.getState().currentSessionId!,
    requestId,
    decision,
    feedback,
  })
}
```

#### PlanApprovalCard.tsx（新组件）

内嵌在 ChatInterface 中（位于 PermissionBanner 旁边），检测 `pendingPlanApproval` 渲染。

结构：
```
┌─────────────────────────────────────────┐
│ 📄 Plan Review  · filename.md  [全屏 ↗] │
├─────────────────────────────────────────┤
│                                         │
│  # 计划标题                              │
│  ## Context                             │
│  内容...                                 │
│  ## 改动内容                             │
│  ```diff                                │
│  + "test": "turbo run test"             │
│  ```                                    │
│           (max-height: 400px, 可滚动)    │
│                                         │
├─────────────────────────────────────────┤
│ 📋 所需权限: [run tests] [install deps] │
├─────────────────────────────────────────┤
│ [🧹 Clear+Accept] [Auto-accept]        │
│ [Manually approve] [💬 反馈输入...    ] │
└─────────────────────────────────────────┘
```

- 使用现有 `MarkdownRenderer` 渲染计划内容
- `readonly` 时不显示操作按钮，只显示"等待操作者响应"
- `allowedPrompts` 以 pill/tag 形式展示
- 反馈输入框：输入后按 Enter 或点击发送按钮提交

#### PlanModal.tsx（新组件）

点击「全屏 ↗」打开的 Modal：

```
┌──────────────────────────────────────────────────┐
│ 📄 Plan Review   compiled-humming-sunbeam.md   ✕ │
├──────────────────────────────────────────────────┤
│                                                  │
│  （全尺寸 MarkdownRenderer，可滚动）               │
│                                                  │
│                                                  │
│                                                  │
├──────────────────────────────────────────────────┤
│ 📋 所需权限: [run tests] [install deps]          │
├──────────────────────────────────────────────────┤
│ [🧹 Clear+Accept] [Auto-accept]                 │
│ [Manually approve]  [💬 反馈输入...           ]  │
└──────────────────────────────────────────────────┘
```

- ESC 或点击背景关闭（不提交任何决策）
- 底部操作栏固定，不随内容滚动
- 移动端：占满整个视口

#### ChatInterface.tsx 集成

```tsx
<ChatMessagesPane sessionId={currentSessionId} />
<PlanApprovalCard />     {/* 新增 */}
<PermissionBanner />
<AskUserPanel />
<ChatComposer onSend={handleSend} onAbort={handleAbort} />
<PlanModal />            {/* 新增，Portal 到 body */}
```

### 5. shared/constants.ts 变更

将 `ExitPlanMode` 加入工具分类以便前端识别：

```typescript
// 在 TOOL_CATEGORIES 中或作为独立常量
export const PLAN_TOOL = 'ExitPlanMode'
```

### 6. 边界情况处理

| 场景 | 处理 |
|------|------|
| 计划文件不存在/读取失败 | planContent 为空字符串，卡片显示"无法读取计划文件"提示，仍可操作 |
| 审批期间用户切换权限模式 | `resolvePendingForMode` 中需要处理 `pendingPlanApprovals`，plan 模式切换时 deny |
| 审批期间断线重连 | 重连后服务端检测 pending plan approval 并重发 |
| 审批超时（5分钟） | 同现有逻辑，timeout 后 deny |
| 用户关闭 Modal 但不操作 | 不提交任何决策，审批保持 pending |
| 移动端全屏 Modal | 响应式设计，Modal 占满视口，操作栏固定底部 |
| Observer 只读模式 | 显示计划内容但无操作按钮 |
| `allowedPrompts` 为空 | 不显示权限标签区域 |

### 7. 涉及文件清单

| 文件 | 操作 | 改动内容 |
|------|------|---------|
| `packages/shared/protocol.ts` | 修改 | 新增 S2C_PlanApproval, S2C_PlanApprovalResolved, C2S_ResolvePlanApproval |
| `packages/shared/constants.ts` | 修改 | 新增 PLAN_TOOL 常量 |
| `packages/shared/tools.ts` | 修改 | 新增 PlanApprovalDecision 类型 |
| `packages/server/src/agent/v1-session.ts` | 修改 | ExitPlanMode 特殊处理、handleExitPlanMode、resolvePlanApproval |
| `packages/server/src/ws/handler.ts` | 修改 | plan-approval 事件监听、resolve-plan-approval 处理、模式切换、clear context |
| `packages/web/src/stores/connectionStore.ts` | 修改 | pendingPlanApproval、planModalOpen 状态 |
| `packages/web/src/hooks/useWebSocket.ts` | 修改 | 处理 plan-approval / plan-approval-resolved 消息、respondPlanApproval 方法 |
| `packages/web/src/components/chat/PlanApprovalCard.tsx` | 新增 | 内嵌计划审批卡片组件 |
| `packages/web/src/components/chat/PlanModal.tsx` | 新增 | 全屏计划查看 Modal |
| `packages/web/src/components/chat/ChatInterface.tsx` | 修改 | 集成 PlanApprovalCard 和 PlanModal |
