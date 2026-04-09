# Lock Mechanism Refactor — Session-Lifecycle Lock

## Problem

当前锁机制 (`LockManager`) 与 WebSocket 连接生命周期深度耦合（grace period、reconnect transfer、dead connection detection），导致多窗口场景反复死锁。核心缺陷：connectionId 是一次性的，bindSessionEvents 闭包捕获的 connectionId 在 WS 重连后变成死引用，且没有绝对超时兜底。

## Design

**核心原则：锁跟随 session 生命周期，不跟随连接生命周期。**

### 锁状态机

```
[idle]  ──send-message──→  [locked(running)]  ──session stops──→  [locked(timeout 60s)]  ──expires──→  [idle]
                                                                        │
                                                                  reply/new msg
                                                                        │
                                                                        ↓
                                                                [locked(running)]
```

Session stops = complete / error / AskUserQuestion / PlanApproval / ToolApproval

### 锁获取规则

| 触发 | 条件 | 行为 |
|------|------|------|
| `send-message` | 无锁 | 获取锁，开始 query |
| `send-message` | 自己持锁 | 继续 query（同一个人追加消息） |
| `send-message` | 他人持锁 | 拒绝 (`session_locked`) |
| `tool-approval-response` | 无锁或自己持锁 | 获取/保持锁，恢复 query |
| `ask-user-response` | 无锁或自己持锁 | 获取/保持锁，恢复 query |
| `plan-approval-response` | 无锁 | 获取锁 |
| `release-lock` | 自己持锁 | 释放锁 |
| `abort` | 自己持锁 | 保持锁（SDK abort 后 session complete → 超时开始） |

### 超时规则

- **Session running 中**：无超时，锁持续
- **Session 停止时**：立即开始 60 秒倒计时
- **倒计时到期**：释放锁，广播 `lock-status: idle`
- **倒计时期间有人操作**（回复审批、发新消息）：取消倒计时，锁转给操作者

### 客户端断开

**不处理。** 不关心连接是否存活。锁的释放只有两种途径：
1. Session 停止后超时 60 秒
2. 手动 `release-lock`

### 客户端显示逻辑

根据服务器广播的 `lock-status` 更新 UI：

```typescript
// lock-status message: { status: 'idle' | 'locked', holderId?: string }
if (status === 'idle') → 可输入、可回复审批（readonly=false）
if (status === 'locked' && holderId === myConnectionId) → 可输入、可回复（readonly=false）
if (status === 'locked' && holderId !== myConnectionId) → 不可输入、审批只读（readonly=true）
```

关键修复：**idle 状态下所有 pending 请求 readonly=false**（当前代码 idle 时错误设为 true）。

### `handleJoinSession` 简化

Join 时**不再自动获取锁**。只做：
1. 发送当前 session-state（含锁状态）
2. 重放缓冲消息
3. 重发 pending 请求（readonly 根据锁状态判断）

### abort 行为变更

当前 abort 先检查 `lockManager.isHolder` 再执行，abort 后立即 `release()`。新设计中：
- abort 仍然要求持锁者才能执行
- abort 后 SDK 会 emit `complete` 或 `error` → 触发 `startTimeout`
- 不再在 abort 中直接 release，让 session 生命周期自然驱动

### `bindSessionEvents` 简化

当前使用 `session.ownerConnectionId` 来判断 readonly（tool-approval/ask-user/plan-approval 事件）。新设计中直接用 `lockManager.getHolder(sessionId)` 替代：

```typescript
session.on('tool-approval', (req) => {
  const holder = lockManager.getHolder(realSessionId)
  for (const connId of wsHub.getSessionClients(realSessionId)) {
    wsHub.sendTo(connId, {
      type: 'tool-approval-request', ...req,
      readonly: holder !== null && connId !== holder,  // idle时all false, locked时只有holder为false
    })
  }
})
```

### `detectPendingFromHistory` 简化

当前在检测到 pending 后会 `lockManager.acquire()` 给 join 的客户端。新设计中不再自动获取锁——只发送 pending 请求（idle 状态下 readonly=false，任何人可回复）。

### `handleSendMessage` 中的双重 acquire 清理

当前 line 395 和 line 409 有两次 `lockManager.acquire()`。新设计合并为一次。

### 客户端变更

| 文件 | 变更 |
|------|------|
| `WebSocketManager.ts` `handleLockStatus` | idle 时 readonly=false（当前是 true） |
| `ApprovalPanel.tsx` | 移除 `canClaim` 逻辑（不再需要 claim-lock） |
| `useClaimLock.ts` | 删除（不再需要） |
| `ChatComposer.tsx` | 保持不变（idle 时允许输入已经是对的） |
| `ComposerToolbar.tsx` | 移除 "Release lock" 按钮？或保留让用户主动释放 |
| `protocol.ts` | 移除 `C2S_ClaimLock` 类型 |
| `ChatSessionProvider.tsx` | 移除 `claimLock` action |
| `PanelHeader.tsx` | lockStatus 指示灯逻辑不变 |

### `server-manager.ts` 影响

`ServerManager` 中 `getHolder` 用于连接信息展示。接口不变，只是 LockManager 内部简化。

### 要删除的代码

| 文件 | 删除内容 |
|------|---------|
| `lock.ts` | `gracePeriodTimer` 字段、`onDisconnect()`、`onReconnect()`、`isConnectionAlive` 回调、`staleCheckTimer`、`resetIdleTimer()`、`debugDump()` |
| `handler.ts` | `handleJoinSession` 中的 dead connection detection + auto-acquire block（L190-335 大幅简化） |
| `handler.ts` | `handleReconnect` 中的 lock/owner migration |
| `handler.ts` | `bindSessionEvents` 中的 `ownerConnectionId` 赋值及所有引用 |
| `handler.ts` | `ws.on('close')` 中的 `lockManager.onDisconnect()` |
| `handler.ts` | `handleClaimLock` 函数 + `claim-lock` case |
| `handler.ts` | `detectPendingFromHistory` 中的 `lockManager.acquire()` + `lock-status` 广播 |
| `handler.ts` | `handleAbort` 中的 `lockManager.release()` + `lock-status: idle` 广播 |
| `handler.ts` | `handleSendMessage` 中的双重 acquire（合并为一次） |
| `handler.ts` | debug 日志（`[LOCK-DEBUG]`） |
| `handler.ts` | `/api/debug/locks` 临时端点 |
| `session.ts` | `ownerConnectionId` 属性 |
| `index.ts` | `/api/debug/locks` 路由 + `lockManager.setIsConnectionAlive()` |
| `protocol.ts` | `C2S_ClaimLock` 类型 |
| `useClaimLock.ts` | 整个文件 |

### 要修改的代码

| 文件 | 修改内容 |
|------|---------|
| `lock.ts` | 重写为极简版（见下方接口） |
| `handler.ts` `session.on('complete')` | `resetIdleTimer` → `startTimeout` |
| `handler.ts` `session.on('error')` | `resetIdleTimer` → `startTimeout` |
| `handler.ts` `session.on('tool-approval')` | 新增 `startTimeout` |
| `handler.ts` `session.on('ask-user')` | 新增 `startTimeout` |
| `handler.ts` `session.on('plan-approval')` | 新增 `startTimeout` |
| `handler.ts` `handleToolApprovalResponse` | 回复时 `acquire()` 给回复者 + 广播 lock-status |
| `handler.ts` `handleAskUserResponse` | 回复时 `acquire()` 给回复者 + 广播 lock-status |
| `handler.ts` `handleResolvePlanApproval` | 回复时 `acquire()` 给回复者 + 广播 lock-status |
| `handler.ts` `handleAbort` | 移除直接 release，让 session complete 自然驱动 |
| `handler.ts` `bindSessionEvents` readonly | `session.ownerConnectionId` → `lockManager.getHolder()` |
| `handler.ts` `handleJoinSession` | 只发 session-state + 重发 pending，不做锁操作 |
| `handler.ts` `resendPendingRequests` | readonly 判断改为：lockHolder 存在且不是自己 → true，否则 false |
| `WebSocketManager.ts` `handleLockStatus` | idle 时 pending readonly=false |
| `ApprovalPanel.tsx` | 移除 `canClaim` 逻辑，idle 时直接可交互 |
| `ChatSessionProvider.tsx` | 移除 `claimLock` action |

### 新 LockManager 接口

```typescript
class LockManager {
  acquire(sessionId: string, connectionId: string): { success: boolean; holder?: string }
  release(sessionId: string): void
  startTimeout(sessionId: string): void  // 开始 60s 倒计时，到期自动 release
  getHolder(sessionId: string): string | null
  getStatus(sessionId: string): 'idle' | 'locked'
  getLockedSessions(connectionId: string): string[]  // 保留，server-manager 用
}
```

## Verification

1. 新建 session → 发消息 → 运行中无超时 → session 完成 → 1分钟后锁释放
2. AskUserQuestion 停止 → 1分钟超时 → 所有窗口可输入
3. 窗口 A 持锁 → 窗口 B 无法输入 → 超时后 B 可以输入
4. 窗口 A 持锁 → A 刷新 → 锁不变 → session 停止后超时释放
5. 多窗口：A 持锁超时后 B 回复 AskUser → 锁转给 B
6. abort 后不立即释放 → SDK complete → 超时开始 → 1分钟后释放
7. 服务器重启 → 所有锁清空 → 所有窗口可输入
8. idle 状态下 pending AskUser → 所有窗口 readonly=false → 任何人可回复
