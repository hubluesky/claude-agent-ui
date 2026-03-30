# Task 2: Shared Types

**Files:**
- Create: `packages/shared/src/constants.ts`
- Create: `packages/shared/src/session.ts`
- Create: `packages/shared/src/tools.ts`
- Create: `packages/shared/src/messages.ts`
- Create: `packages/shared/src/protocol.ts`
- Modify: `packages/shared/src/index.ts`

---

- [ ] **Step 1: Create constants.ts**

```typescript
// packages/shared/src/constants.ts

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk'

export type EffortLevel = 'low' | 'medium' | 'high' | 'max'

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'pause_turn' | 'refusal'

export type SessionStatus = 'idle' | 'running' | 'awaiting_approval' | 'awaiting_user_input'

export type LockStatus = 'idle' | 'locked'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

export type ClientLockStatus = 'idle' | 'locked_self' | 'locked_other'

export const TOOL_CATEGORIES = {
  edit: ['Edit', 'Write', 'ApplyPatch'],
  search: ['Grep', 'Glob'],
  bash: ['Bash'],
  read: ['Read'],
  todo: ['TodoWrite', 'TodoRead'],
  task: ['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'],
  agent: ['Agent'],
  question: ['AskUserQuestion'],
  web: ['WebSearch', 'WebFetch'],
} as const

export type ToolCategory = keyof typeof TOOL_CATEGORIES | 'default'

export function getToolCategory(toolName: string): ToolCategory {
  for (const [category, tools] of Object.entries(TOOL_CATEGORIES)) {
    if ((tools as readonly string[]).includes(toolName)) {
      return category as ToolCategory
    }
  }
  return 'default'
}

export const TOOL_COLORS: Record<ToolCategory, string> = {
  edit: '#d97706',
  search: '#059669',
  bash: '#059669',
  read: '#6b7280',
  todo: '#8b5cf6',
  task: '#8b5cf6',
  agent: '#a855f7',
  question: '#d97706',
  web: '#0ea5e9',
  default: '#6b7280',
}
```

- [ ] **Step 2: Create session.ts**

```typescript
// packages/shared/src/session.ts

import type { SessionStatus, PermissionMode, EffortLevel } from './constants.js'

export interface ProjectInfo {
  cwd: string
  name: string
  lastActiveAt: string
  sessionCount: number
}

export interface SessionSummary {
  sessionId: string
  cwd: string
  tag?: string
  title?: string
  createdAt?: string
  updatedAt?: string
}

export interface SendOptions {
  cwd?: string
  images?: { data: string; mediaType: string }[]
  thinkingMode?: 'adaptive' | 'enabled' | 'disabled'
  effort?: EffortLevel
}

export interface SessionResult {
  subtype: 'success' | 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd'
  result?: string
  errors?: string[]
  duration_ms: number
  total_cost_usd: number
  num_turns: number
  usage: { input_tokens: number; output_tokens: number }
}
```

- [ ] **Step 3: Create tools.ts**

```typescript
// packages/shared/src/tools.ts

export interface PermissionUpdate {
  type: 'addRules' | 'replaceRules' | 'removeRules' | 'setMode'
  [key: string]: unknown
}

export interface ToolApprovalRequest {
  requestId: string
  toolName: string
  toolInput: Record<string, unknown>
  toolUseID: string
  title?: string
  displayName?: string
  description?: string
  suggestions?: PermissionUpdate[]
  agentID?: string
}

export type ToolApprovalDecision =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: PermissionUpdate[] }
  | { behavior: 'deny'; message: string }

export interface AskUserQuestion {
  question: string
  header: string
  options: { label: string; description: string; preview?: string }[]
  multiSelect: boolean
}

export interface AskUserRequest {
  requestId: string
  questions: AskUserQuestion[]
}

export interface AskUserResponse {
  answers: Record<string, string>
}
```

- [ ] **Step 4: Create messages.ts**

```typescript
// packages/shared/src/messages.ts

// Re-export SDK types that we use across the boundary.
// The server imports the real SDK types; the frontend only needs these shapes.
// We keep this thin — the actual SDKMessage is opaque JSON from the frontend's perspective.

export type AgentMessageType =
  | 'assistant'
  | 'user'
  | 'result'
  | 'system'
  | 'stream_event'
  | 'tool_progress'
  | 'tool_use_summary'
  | 'auth_status'
  | 'rate_limit_event'
  | 'prompt_suggestion'

export type SystemSubtype =
  | 'init'
  | 'status'
  | 'session_state_changed'
  | 'compact_boundary'
  | 'api_retry'
  | 'task_started'
  | 'task_progress'
  | 'task_notification'
  | 'hook_started'
  | 'hook_progress'
  | 'hook_response'
  | 'files_persisted'
  | 'elicitation_complete'
  | 'local_command_output'

export type ResultSubtype =
  | 'success'
  | 'error_during_execution'
  | 'error_max_turns'
  | 'error_max_budget_usd'
  | 'error_max_structured_output_retries'

export type ContentBlockType =
  | 'text'
  | 'thinking'
  | 'redacted_thinking'
  | 'tool_use'
  | 'tool_result'
  | 'server_tool_use'
  | 'web_search_tool_result'
  | 'code_execution_tool_result'
  | 'image'

// The frontend treats SDK messages as opaque JSON with a known `type` field.
// This avoids coupling the frontend to the SDK's exact type definitions.
export interface AgentMessage {
  type: AgentMessageType
  subtype?: string
  session_id?: string
  uuid?: string
  [key: string]: unknown
}
```

- [ ] **Step 5: Create protocol.ts**

```typescript
// packages/shared/src/protocol.ts

import type { SessionStatus, PermissionMode, EffortLevel, LockStatus } from './constants.js'
import type { ToolApprovalRequest, ToolApprovalDecision, AskUserQuestion, AskUserResponse } from './tools.js'
import type { AgentMessage } from './messages.js'
import type { SessionResult } from './session.js'

// ============ Client → Server (C2S) ============

export interface C2S_JoinSession {
  type: 'join-session'
  sessionId: string
}

export interface C2S_SendMessage {
  type: 'send-message'
  sessionId: string | null
  prompt: string
  options?: {
    cwd?: string
    images?: { data: string; mediaType: string }[]
    thinkingMode?: 'adaptive' | 'enabled' | 'disabled'
    effort?: EffortLevel
  }
}

export interface C2S_ToolApprovalResponse {
  type: 'tool-approval-response'
  requestId: string
  decision: ToolApprovalDecision
}

export interface C2S_AskUserResponse {
  type: 'ask-user-response'
  requestId: string
  answers: Record<string, string>
}

export interface C2S_Abort {
  type: 'abort'
  sessionId: string
}

export interface C2S_SetMode {
  type: 'set-mode'
  sessionId: string
  mode: PermissionMode
}

export interface C2S_SetEffort {
  type: 'set-effort'
  sessionId: string
  effort: EffortLevel
}

export interface C2S_Reconnect {
  type: 'reconnect'
  previousConnectionId: string
}

export interface C2S_LeaveSession {
  type: 'leave-session'
}

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

// ============ Server → Client (S2C) ============

export interface S2C_Init {
  type: 'init'
  connectionId: string
}

export interface S2C_SessionState {
  type: 'session-state'
  sessionId: string
  sessionStatus: SessionStatus
  lockStatus: LockStatus
  lockHolderId?: string
  isLockHolder: boolean
}

export interface S2C_AgentMessage {
  type: 'agent-message'
  sessionId: string
  message: AgentMessage
}

export interface S2C_ToolApprovalRequest {
  type: 'tool-approval-request'
  requestId: string
  toolName: string
  toolInput: Record<string, unknown>
  toolUseID: string
  title?: string
  displayName?: string
  description?: string
  suggestions?: unknown[]
  agentID?: string
  readonly: boolean
}

export interface S2C_ToolApprovalResolved {
  type: 'tool-approval-resolved'
  requestId: string
  decision: { behavior: 'allow' | 'deny'; message?: string }
}

export interface S2C_AskUserRequest {
  type: 'ask-user-request'
  requestId: string
  questions: AskUserQuestion[]
  readonly: boolean
}

export interface S2C_AskUserResolved {
  type: 'ask-user-resolved'
  requestId: string
  answers: Record<string, string>
}

export interface S2C_LockStatus {
  type: 'lock-status'
  sessionId: string
  status: LockStatus
  holderId?: string
}

export interface S2C_SessionStateChange {
  type: 'session-state-change'
  sessionId: string
  state: SessionStatus
}

export interface S2C_SessionComplete {
  type: 'session-complete'
  sessionId: string
  result: SessionResult
}

export interface S2C_SessionAborted {
  type: 'session-aborted'
  sessionId: string
}

export interface S2C_Error {
  type: 'error'
  message: string
  code?: 'session_locked' | 'session_not_found' | 'not_lock_holder' | 'internal'
}

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
  | S2C_Error
```

- [ ] **Step 6: Verify compilation**

Run:
```bash
cd E:/projects/claude-agent-ui
pnpm --filter @claude-agent-ui/shared run lint
```

Expected: `tsc --noEmit` succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): add all type definitions (protocol, messages, session, tools, constants)"
```
