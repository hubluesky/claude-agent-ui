# ExitPlanMode Plan Approval UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replicate Claude Code CLI's plan approval flow — inline plan card with full-screen modal, 4 approval options, and clear context support.

**Architecture:** ExitPlanMode is intercepted in `canUseTool` (like AskUserQuestion), plan file is read from disk, content is sent via new WebSocket protocol messages to the frontend, which renders a dedicated PlanApprovalCard + PlanModal with the 4 CLI-matching options.

**Tech Stack:** TypeScript, Fastify WebSocket, React 19, Zustand, react-markdown (already installed)

---

### Task 1: Shared types — protocol messages and plan approval types

**Files:**
- Modify: `packages/shared/src/tools.ts`
- Modify: `packages/shared/src/protocol.ts`
- Modify: `packages/shared/src/constants.ts`

- [ ] **Step 1: Add PlanApprovalDecision type to tools.ts**

Add after the `AskUserResponse` interface at the end of the file:

```typescript
export type PlanApprovalDecisionType = 'clear-and-accept' | 'auto-accept' | 'manual' | 'feedback'

export interface PlanApprovalRequest {
  requestId: string
  planContent: string
  planFilePath: string
  allowedPrompts: { tool: string; prompt: string }[]
}

export interface PlanApprovalDecision {
  decision: PlanApprovalDecisionType
  feedback?: string
}
```

- [ ] **Step 2: Add PLAN_TOOL constant to constants.ts**

Add after the `TOOL_COLORS` export:

```typescript
export const PLAN_TOOL = 'ExitPlanMode'
```

- [ ] **Step 3: Add plan approval protocol messages to protocol.ts**

Add the import for the new types at the top:

```typescript
import type { ToolApprovalDecision, AskUserQuestion, PlanApprovalDecisionType } from './tools.js'
```

Add these interfaces before the `S2C_Error` interface:

```typescript
export interface S2C_PlanApproval {
  type: 'plan-approval'
  sessionId: string
  requestId: string
  planContent: string
  planFilePath: string
  allowedPrompts: { tool: string; prompt: string }[]
  readonly: boolean
}

export interface S2C_PlanApprovalResolved {
  type: 'plan-approval-resolved'
  requestId: string
}
```

Add this interface after `C2S_LeaveSession`:

```typescript
export interface C2S_ResolvePlanApproval {
  type: 'resolve-plan-approval'
  sessionId: string
  requestId: string
  decision: PlanApprovalDecisionType
  feedback?: string
}
```

Update the `C2SMessage` union — add `| C2S_ResolvePlanApproval` at the end:

```typescript
export type C2SMessage =
  | C2S_JoinSession
  | C2S_SendMessage
  | C2S_ToolApprovalResponse
  | C2S_AskUserResponse
  | C2S_Abort
  | C2S_SetMode
  | C2S_SetEffort
  | C2S_Reconnect
  | C2S_LeaveSession
  | C2S_ResolvePlanApproval
```

Update the `S2CMessage` union — add `| S2C_PlanApproval | S2C_PlanApprovalResolved`:

```typescript
export type S2CMessage =
  | S2C_Init
  | S2C_SessionState
  | S2C_AgentMessage
  | S2C_ToolApprovalRequest
  | S2C_ToolApprovalResolved
  | S2C_AskUserRequest
  | S2C_AskUserResolved
  | S2C_LockStatus
  | S2C_SessionStateChange
  | S2C_SessionComplete
  | S2C_SessionAborted
  | S2C_SlashCommands
  | S2C_PlanApproval
  | S2C_PlanApprovalResolved
  | S2C_Error
```

- [ ] **Step 4: Build shared package**

Run: `pnpm --filter @claude-agent-ui/shared build`
Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/tools.ts packages/shared/src/protocol.ts packages/shared/src/constants.ts
git commit -m "feat(shared): add plan approval protocol messages and types"
```

---

### Task 2: Server — AgentSession base class + V1QuerySession plan approval handling

**Files:**
- Modify: `packages/server/src/agent/session.ts`
- Modify: `packages/server/src/agent/v1-session.ts`

- [ ] **Step 1: Add plan-approval event and resolvePlanApproval to AgentSession base class**

In `packages/server/src/agent/session.ts`, update the import to include the new types:

```typescript
import type { ToolApprovalRequest, ToolApprovalDecision, AskUserRequest, AskUserResponse, PlanApprovalRequest, PlanApprovalDecision, SendOptions, SessionResult, SlashCommandInfo } from '@claude-agent-ui/shared'
```

Add to the `AgentSessionEvents` interface:

```typescript
export interface AgentSessionEvents {
  'message': (msg: unknown) => void
  'tool-approval': (req: ToolApprovalRequest) => void
  'plan-approval': (req: PlanApprovalRequest) => void
  'ask-user': (req: AskUserRequest) => void
  'commands': (commands: SlashCommandInfo[]) => void
  'complete': (result: SessionResult) => void
  'error': (err: Error) => void
  'state-change': (state: SessionStatus) => void
}
```

Add abstract method to `AgentSession`:

```typescript
abstract resolvePlanApproval(requestId: string, decision: PlanApprovalDecision): void
```

- [ ] **Step 2: Add plan approval handling to V1QuerySession**

In `packages/server/src/agent/v1-session.ts`, add the import for new types at line 26 (update the existing import):

```typescript
import type { ToolApprovalDecision, AskUserRequest, AskUserResponse, PlanApprovalDecision, SendOptions, SessionResult } from '@claude-agent-ui/shared'
```

Add after the `PendingAskUser` interface (line 49):

```typescript
interface PendingPlanApproval {
  resolve: (decision: PlanApprovalDecision) => void
  timeout: ReturnType<typeof setTimeout>
}
```

Add to the class, after `private pendingAskUser` (line 59):

```typescript
private pendingPlanApprovals = new Map<string, PendingPlanApproval>()
```

- [ ] **Step 3: Intercept ExitPlanMode in canUseTool**

In `handleCanUseTool` method (line 199), add after the AskUserQuestion check (after line 207):

```typescript
    // ExitPlanMode must always go to user approval, even in plan mode
    if (toolName === 'ExitPlanMode') {
      return this.handleExitPlanMode(input)
    }
```

- [ ] **Step 4: Implement handleExitPlanMode method**

Add after the `handleAskUserTool` method (after line 297):

```typescript
  /** Handle ExitPlanMode — read plan file and present to user for approval */
  private async handleExitPlanMode(
    input: Record<string, unknown>
  ): Promise<{ behavior: string; updatedInput?: Record<string, unknown>; message?: string }> {
    this.setStatus('awaiting_approval')
    const requestId = randomUUID()

    // Read plan file content
    let planContent = ''
    const planFilePath = (input as any).planFilePath as string || ''
    if (planFilePath) {
      try {
        planContent = readFileSync(planFilePath, 'utf-8')
      } catch {
        planContent = ''
      }
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
        allowedPrompts: ((input as any).allowedPrompts as { tool: string; prompt: string }[]) || [],
      })
    })

    this.setStatus('running')

    if (decision.decision === 'feedback') {
      return { behavior: 'deny', message: decision.feedback || 'User requested changes' }
    }

    return { behavior: 'allow', updatedInput: input }
  }
```

- [ ] **Step 5: Implement resolvePlanApproval method**

Add after `resolveAskUser` method (after line 315):

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

- [ ] **Step 6: Update abort() to clear pending plan approvals**

In the `abort()` method (line 317), add after clearing `pendingAskUser` (after line 334):

```typescript
    for (const [, pending] of this.pendingPlanApprovals) {
      clearTimeout(pending.timeout)
      pending.resolve({ decision: 'feedback', feedback: 'Session aborted' })
    }
    this.pendingPlanApprovals.clear()
```

- [ ] **Step 7: Update resolvePendingForMode to handle plan approvals**

In the `resolvePendingForMode` method (line 350), add after the `pendingApprovals` loop (after line 387):

```typescript
    // Also resolve pending plan approvals when switching modes
    for (const [requestId, pending] of this.pendingPlanApprovals) {
      if (mode === 'auto' || mode === 'bypassPermissions') {
        clearTimeout(pending.timeout)
        pending.resolve({ decision: 'auto-accept' })
        this.pendingPlanApprovals.delete(requestId)
      } else if (mode === 'dontAsk') {
        clearTimeout(pending.timeout)
        pending.resolve({ decision: 'feedback', feedback: `Denied by ${mode} mode` })
        this.pendingPlanApprovals.delete(requestId)
      }
    }
```

- [ ] **Step 8: Verify TypeScript compiles**

Run: `pnpm --filter @claude-agent-ui/server exec tsc --noEmit`
Expected: No type errors.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/agent/session.ts packages/server/src/agent/v1-session.ts
git commit -m "feat(server): handle ExitPlanMode as special plan approval flow"
```

---

### Task 3: Server — WebSocket handler for plan approval messages

**Files:**
- Modify: `packages/server/src/ws/handler.ts`

- [ ] **Step 1: Update imports**

At line 3, update the import to include new types:

```typescript
import type { C2SMessage, ToolApprovalDecision, PermissionMode, PlanApprovalDecision } from '@claude-agent-ui/shared'
```

Add import for V1QuerySession:

```typescript
import { V1QuerySession } from '../agent/v1-session.js'
```

- [ ] **Step 2: Update PendingRequest interface to support plan-approval type**

Update the `PendingRequest` interface (line 22) to add plan-approval:

```typescript
  interface PendingRequest {
    sessionId: string
    type: 'tool-approval' | 'ask-user' | 'plan-approval'
    toolName?: string
    payload: Record<string, unknown>
  }
```

- [ ] **Step 3: Add resolve-plan-approval to handleMessage switch**

In the `handleMessage` function (line 54), add a new case after `'leave-session'` (line 82):

```typescript
      case 'resolve-plan-approval':
        await handleResolvePlanApproval(connectionId, msg.sessionId, msg.requestId, msg.decision, msg.feedback)
        break
```

- [ ] **Step 4: Add plan-approval event binding in bindSessionEvents**

In `bindSessionEvents` (line 197), add after the `session.on('ask-user', ...)` block (after line 288):

```typescript
    session.on('plan-approval', (req) => {
      pendingRequestMap.set(req.requestId, {
        sessionId: realSessionId,
        type: 'plan-approval',
        payload: req,
      })
      wsHub.sendTo(connectionId, {
        type: 'plan-approval',
        sessionId: realSessionId,
        ...req,
        readonly: false,
      })
      wsHub.broadcastExcept(realSessionId, connectionId, {
        type: 'plan-approval',
        sessionId: realSessionId,
        ...req,
        readonly: true,
      })
    })
```

- [ ] **Step 5: Add plan-approval to handleJoinSession re-send logic**

In `handleJoinSession` (line 86), add after the ask-user re-send block (after line 116):

```typescript
      } else if (entry.type === 'plan-approval') {
        wsHub.sendTo(connectionId, {
          type: 'plan-approval',
          sessionId: entry.sessionId,
          ...entry.payload,
          readonly: !isLockHolder,
        } as any)
      }
```

- [ ] **Step 6: Implement handleResolvePlanApproval function**

Add after `handleAskUserResponse` function (after line 380):

```typescript
  async function handleResolvePlanApproval(
    connectionId: string,
    sessionId: string,
    requestId: string,
    decision: PlanApprovalDecision['decision'],
    feedback?: string
  ) {
    const entry = pendingRequestMap.get(requestId)
    if (!entry) return

    if (!lockManager.isHolder(entry.sessionId, connectionId)) {
      wsHub.sendTo(connectionId, { type: 'error', message: 'Not lock holder', code: 'not_lock_holder' })
      return
    }

    const session = sessionManager.getActive(entry.sessionId)
    if (!session || !(session instanceof V1QuerySession)) return

    // 1. Resolve the plan approval promise
    session.resolvePlanApproval(requestId, { decision, feedback })
    pendingRequestMap.delete(requestId)

    // 2. Switch permission mode based on decision
    try {
      switch (decision) {
        case 'clear-and-accept':
        case 'auto-accept':
          await session.setPermissionMode('acceptEdits')
          break
        case 'manual':
          await session.setPermissionMode('default')
          break
        // 'feedback': keep plan mode, don't change
      }
    } catch {
      // Silently ignore mode change errors
    }

    // 3. Broadcast resolved to all clients
    wsHub.broadcast(entry.sessionId, {
      type: 'plan-approval-resolved',
      requestId,
    })

    // 4. For clear-and-accept: send /compact to clear context after tool completes
    // The compact will be processed by the SDK on the next turn
    if (decision === 'clear-and-accept') {
      // Schedule compact after a short delay to let the ExitPlanMode tool complete
      setTimeout(() => {
        const activeSession = sessionManager.getActive(entry.sessionId)
        if (activeSession) {
          activeSession.send('/compact')
        }
      }, 500)
    }
  }
```

- [ ] **Step 7: Update resolvePendingApprovalsForMode for plan-approval entries**

In `resolvePendingApprovalsForMode` (line 420), the existing logic works for `type: 'plan-approval'` entries because it operates on `pendingRequestMap` which includes them. But the `entry.toolName` check for `acceptEdits` mode won't match plan-approval entries (no toolName). This is correct — plan approvals should only be auto-resolved by `auto`/`bypassPermissions` modes (which resolve everything). No changes needed here, but verify the logic handles it.

- [ ] **Step 8: Verify TypeScript compiles**

Run: `pnpm --filter @claude-agent-ui/server exec tsc --noEmit`
Expected: No type errors.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/ws/handler.ts
git commit -m "feat(server): add WebSocket plan-approval event handling and resolve flow"
```

---

### Task 4: Frontend — connectionStore and useWebSocket for plan approval state

**Files:**
- Modify: `packages/web/src/stores/connectionStore.ts`
- Modify: `packages/web/src/hooks/useWebSocket.ts`

- [ ] **Step 1: Add plan approval state to connectionStore**

In `packages/web/src/stores/connectionStore.ts`, add the import:

```typescript
import type { ToolApprovalRequest, AskUserRequest, PlanApprovalRequest } from '@claude-agent-ui/shared'
```

Remove the old import of `ToolApprovalRequest, AskUserRequest` from the existing import line.

Add to `ConnectionState` interface (after `pendingAskUser`):

```typescript
  pendingPlanApproval: (PlanApprovalRequest & { readonly: boolean }) | null
  planModalOpen: boolean
```

Add to `ConnectionActions` interface:

```typescript
  setPendingPlanApproval(req: (PlanApprovalRequest & { readonly: boolean }) | null): void
  setPlanModalOpen(open: boolean): void
```

Add initial values in the `create` call:

```typescript
  pendingPlanApproval: null,
  planModalOpen: false,
```

Add setters:

```typescript
  setPendingPlanApproval: (req) => set({ pendingPlanApproval: req }),
  setPlanModalOpen: (open) => set({ planModalOpen: open }),
```

Update `reset` to include new fields:

```typescript
  reset: () => set({
    lockStatus: 'idle', lockHolderId: null, sessionStatus: 'idle',
    pendingApproval: null, pendingAskUser: null, pendingPlanApproval: null, planModalOpen: false,
  }),
```

- [ ] **Step 2: Add plan approval message handling to useWebSocket**

In `packages/web/src/hooks/useWebSocket.ts`, update the import (line 2):

```typescript
import type { S2CMessage, C2SMessage, ToolApprovalDecision, PlanApprovalDecisionType } from '@claude-agent-ui/shared'
```

In `handleServerMessage`, add after the `'ask-user-resolved'` case (after line 175):

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
```

- [ ] **Step 3: Add respondPlanApproval helper function**

Add after the `respondAskUser` function (after line 237):

```typescript
function respondPlanApproval(requestId: string, decision: PlanApprovalDecisionType, feedback?: string) {
  send({
    type: 'resolve-plan-approval',
    sessionId: useSessionStore.getState().currentSessionId!,
    requestId,
    decision,
    feedback,
  })
}
```

- [ ] **Step 4: Export respondPlanApproval from the hook**

Update the return statement of `useWebSocket` (line 258):

```typescript
  return { send, sendMessage, joinSession, respondToolApproval, respondAskUser, respondPlanApproval, abort, disconnect }
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `pnpm lint`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/stores/connectionStore.ts packages/web/src/hooks/useWebSocket.ts
git commit -m "feat(web): add plan approval state management and WebSocket handling"
```

---

### Task 5: Frontend — PlanApprovalCard component

**Files:**
- Create: `packages/web/src/components/chat/PlanApprovalCard.tsx`

- [ ] **Step 1: Create PlanApprovalCard.tsx**

```tsx
import { useState } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useWebSocket } from '../../hooks/useWebSocket'
import { MarkdownRenderer } from './MarkdownRenderer'
import type { PlanApprovalDecisionType } from '@claude-agent-ui/shared'

export function PlanApprovalCard() {
  const { pendingPlanApproval } = useConnectionStore()
  const { respondPlanApproval } = useWebSocket()
  const [feedback, setFeedback] = useState('')

  if (!pendingPlanApproval) return null

  const { requestId, planContent, planFilePath, allowedPrompts, readonly } = pendingPlanApproval
  const fileName = planFilePath.split(/[/\\]/).pop() || 'plan.md'

  const handleDecision = (decision: PlanApprovalDecisionType) => {
    if (decision === 'feedback') {
      if (!feedback.trim()) return
      respondPlanApproval(requestId, 'feedback', feedback.trim())
    } else {
      respondPlanApproval(requestId, decision)
    }
    setFeedback('')
  }

  const handleFeedbackKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleDecision('feedback')
    }
  }

  const openModal = () => {
    useConnectionStore.getState().setPlanModalOpen(true)
  }

  return (
    <div className="mx-4 sm:mx-10 mb-4 rounded-lg border bg-[#d977060a] border-[#d9770626]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
        {readonly ? (
          <>
            <svg className="w-4 h-4 text-[#7c7872]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span className="text-[13px] text-[#7c7872]">Waiting for operator to respond...</span>
          </>
        ) : (
          <>
            <svg className="w-4 h-4 text-[#d97706] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <span className="text-[13px] text-[#a8a29e] flex-1">Plan Review</span>
            <span className="text-[11px] text-[#7c7872] font-mono truncate max-w-[200px]">{fileName}</span>
            <button
              onClick={openModal}
              className="text-[11px] text-[#0ea5e9] hover:underline shrink-0 ml-2"
            >
              Full screen ↗
            </button>
          </>
        )}
      </div>

      {/* Plan content */}
      <div className="mx-4 mb-3 bg-[#1e1d1a] border border-[#3d3b37] rounded-md overflow-hidden">
        <div className="px-4 py-3 max-h-[400px] overflow-y-auto text-sm text-[#e5e2db]">
          {planContent ? (
            <MarkdownRenderer content={planContent} />
          ) : (
            <p className="text-[#7c7872] italic">Unable to read plan file</p>
          )}
        </div>
      </div>

      {/* Allowed prompts */}
      {allowedPrompts.length > 0 && (
        <div className="mx-4 mb-3 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-[#7c7872]">Required permissions:</span>
          {allowedPrompts.map((p, i) => (
            <span key={i} className="text-[10px] px-2 py-0.5 bg-[#242320] border border-[#3d3b37] rounded-full text-[#a8a29e] font-mono">
              {p.tool}: {p.prompt}
            </span>
          ))}
        </div>
      )}

      {/* Action buttons */}
      {!readonly && (
        <div className="px-4 pb-3.5">
          <div className="flex gap-2 items-center flex-wrap">
            <button
              onClick={() => handleDecision('clear-and-accept')}
              className="px-3 py-1.5 text-[11px] font-semibold text-[#22c55e] bg-[#22c55e15] border border-[#22c55e30] rounded-md hover:bg-[#22c55e25] transition-colors"
            >
              Clear + Auto-accept
            </button>
            <button
              onClick={() => handleDecision('auto-accept')}
              className="px-3 py-1.5 text-[11px] font-medium text-[#d97706] bg-[#d9770615] border border-[#d9770630] rounded-md hover:bg-[#d9770625] transition-colors"
            >
              Auto-accept edits
            </button>
            <button
              onClick={() => handleDecision('manual')}
              className="px-3 py-1.5 text-[11px] font-medium text-[#a8a29e] border border-[#3d3b37] rounded-md hover:bg-[#3d3b37] transition-colors"
            >
              Manually approve
            </button>
            <div className="flex-1 min-w-[140px]">
              <input
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={handleFeedbackKeyDown}
                placeholder="Tell Claude what to change..."
                className="w-full px-3 py-1.5 text-[11px] bg-[#1e1d1a] border border-[#3d3b37] rounded-md text-[#e5e2db] placeholder-[#7c7872] outline-none focus:border-[#d97706] transition-colors"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm lint`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/PlanApprovalCard.tsx
git commit -m "feat(web): add PlanApprovalCard component with 4 CLI-matching options"
```

---

### Task 6: Frontend — PlanModal component

**Files:**
- Create: `packages/web/src/components/chat/PlanModal.tsx`

- [ ] **Step 1: Create PlanModal.tsx**

```tsx
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useConnectionStore } from '../../stores/connectionStore'
import { useWebSocket } from '../../hooks/useWebSocket'
import { MarkdownRenderer } from './MarkdownRenderer'
import type { PlanApprovalDecisionType } from '@claude-agent-ui/shared'

export function PlanModal() {
  const { pendingPlanApproval, planModalOpen } = useConnectionStore()
  const { respondPlanApproval } = useWebSocket()
  const [feedback, setFeedback] = useState('')

  // Close on ESC
  useEffect(() => {
    if (!planModalOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        useConnectionStore.getState().setPlanModalOpen(false)
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [planModalOpen])

  if (!planModalOpen || !pendingPlanApproval) return null

  const { requestId, planContent, planFilePath, allowedPrompts, readonly } = pendingPlanApproval
  const fileName = planFilePath.split(/[/\\]/).pop() || 'plan.md'

  const handleDecision = (decision: PlanApprovalDecisionType) => {
    if (decision === 'feedback') {
      if (!feedback.trim()) return
      respondPlanApproval(requestId, 'feedback', feedback.trim())
    } else {
      respondPlanApproval(requestId, decision)
    }
    setFeedback('')
  }

  const handleFeedbackKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleDecision('feedback')
    }
  }

  const closeModal = () => {
    useConnectionStore.getState().setPlanModalOpen(false)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}
    >
      <div className="bg-[#1c1b18] border border-[#3d3b37] rounded-lg w-[90vw] h-[90vh] max-w-[900px] flex flex-col max-sm:w-full max-sm:h-full max-sm:rounded-none max-sm:max-w-none">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[#3d3b37] shrink-0">
          <svg className="w-4 h-4 text-[#d97706] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <span className="text-[14px] text-[#d97706] font-semibold">Plan Review</span>
          <span className="text-[12px] text-[#7c7872] font-mono truncate flex-1">{fileName}</span>
          <button
            onClick={closeModal}
            className="text-[#7c7872] hover:text-[#a8a29e] transition-colors p-1"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 text-sm text-[#e5e2db]">
          {planContent ? (
            <MarkdownRenderer content={planContent} />
          ) : (
            <p className="text-[#7c7872] italic">Unable to read plan file</p>
          )}
        </div>

        {/* Allowed prompts */}
        {allowedPrompts.length > 0 && (
          <div className="px-5 py-2 border-t border-[#3d3b37] shrink-0 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-[#7c7872]">Required permissions:</span>
            {allowedPrompts.map((p, i) => (
              <span key={i} className="text-[10px] px-2 py-0.5 bg-[#242320] border border-[#3d3b37] rounded-full text-[#a8a29e] font-mono">
                {p.tool}: {p.prompt}
              </span>
            ))}
          </div>
        )}

        {/* Action bar */}
        {!readonly && (
          <div className="px-5 py-3 border-t border-[#3d3b37] shrink-0">
            <div className="flex gap-2 items-center flex-wrap">
              <button
                onClick={() => handleDecision('clear-and-accept')}
                className="px-3 py-1.5 text-[11px] font-semibold text-[#22c55e] bg-[#22c55e15] border border-[#22c55e30] rounded-md hover:bg-[#22c55e25] transition-colors"
              >
                Clear + Auto-accept
              </button>
              <button
                onClick={() => handleDecision('auto-accept')}
                className="px-3 py-1.5 text-[11px] font-medium text-[#d97706] bg-[#d9770615] border border-[#d9770630] rounded-md hover:bg-[#d9770625] transition-colors"
              >
                Auto-accept edits
              </button>
              <button
                onClick={() => handleDecision('manual')}
                className="px-3 py-1.5 text-[11px] font-medium text-[#a8a29e] border border-[#3d3b37] rounded-md hover:bg-[#3d3b37] transition-colors"
              >
                Manually approve
              </button>
              <div className="flex-1 min-w-[160px]">
                <input
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  onKeyDown={handleFeedbackKeyDown}
                  placeholder="Tell Claude what to change..."
                  className="w-full px-3 py-1.5 text-[12px] bg-[#1e1d1a] border border-[#3d3b37] rounded-md text-[#e5e2db] placeholder-[#7c7872] outline-none focus:border-[#d97706] transition-colors"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm lint`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/PlanModal.tsx
git commit -m "feat(web): add PlanModal full-screen component with ESC close and responsive layout"
```

---

### Task 7: Frontend — Integrate PlanApprovalCard and PlanModal into ChatInterface

**Files:**
- Modify: `packages/web/src/components/chat/ChatInterface.tsx`

- [ ] **Step 1: Add imports**

Add after the existing imports (after line 6):

```typescript
import { PlanApprovalCard } from './PlanApprovalCard'
import { PlanModal } from './PlanModal'
```

- [ ] **Step 2: Add components to the JSX**

Replace the return block (lines 59-77) with:

```tsx
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ConnectionBanner />
      {isNewSession ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[#242320] border border-[#3d3b37] flex items-center justify-center">
            <span className="text-xl font-bold font-mono text-[#d97706]">C</span>
          </div>
          <p className="text-sm text-[#7c7872]">New conversation in {currentProjectCwd?.split(/[/\\]/).pop()}</p>
        </div>
      ) : (
        <ChatMessagesPane sessionId={currentSessionId} />
      )}
      <PlanApprovalCard />
      <PermissionBanner />
      <AskUserPanel />
      <ChatComposer onSend={handleSend} onAbort={handleAbort} />
      <PlanModal />
    </div>
  )
```

- [ ] **Step 3: Verify full build**

Run: `pnpm build`
Expected: All packages build successfully.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/chat/ChatInterface.tsx
git commit -m "feat(web): integrate PlanApprovalCard and PlanModal into ChatInterface"
```

---

### Task 8: Manual testing and final verification

- [ ] **Step 1: Start dev server**

Run: `pnpm dev`
Expected: Server starts on port 3456, web on port 5173.

- [ ] **Step 2: Verify normal tool approval still works**

Send a message that triggers a tool approval (e.g., ask to edit a file in default mode). Verify PermissionBanner still shows and responds correctly.

- [ ] **Step 3: Switch to plan mode and trigger ExitPlanMode**

1. Switch to Plan mode via the mode selector
2. Ask Claude to make a plan for something simple
3. When Claude calls ExitPlanMode, verify:
   - PlanApprovalCard appears with rendered Markdown
   - "Full screen ↗" button opens PlanModal
   - ESC closes the modal
   - 4 buttons are visible: Clear+Auto-accept, Auto-accept edits, Manually approve, feedback input
4. Test each decision:
   - Click "Auto-accept edits" — plan is approved, mode switches to acceptEdits
   - Try "feedback" — type text and press Enter, plan is rejected with feedback message

- [ ] **Step 4: Verify observer (readonly) mode**

Open a second browser tab connected to the same session. Verify the plan card shows content but with "Waiting for operator to respond..." instead of action buttons.

- [ ] **Step 5: Final commit with any fixes**

```bash
git add -A
git commit -m "fix: address issues found during manual testing"
```
