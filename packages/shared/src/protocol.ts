import type { SessionStatus, PermissionMode, EffortLevel, LockStatus } from './constants.js'
import type { ToolApprovalDecision, AskUserQuestion, PlanApprovalDecisionType } from './tools.js'
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

export interface C2S_ResolvePlanApproval {
  type: 'resolve-plan-approval'
  sessionId: string
  requestId: string
  decision: PlanApprovalDecisionType
  feedback?: string
}

export interface C2S_ReleaseLock {
  type: 'release-lock'
  sessionId: string
}

export interface C2S_ClaimLock {
  type: 'claim-lock'
  sessionId: string
}

export interface C2S_StopTask {
  type: 'stop-task'
  sessionId: string
  taskId: string
}

export interface C2S_SetModel {
  type: 'set-model'
  sessionId: string
  model: string
}

export interface C2S_ForkSession {
  type: 'fork-session'
  sessionId: string
  atMessageId?: string
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
  | C2S_ResolvePlanApproval
  | C2S_ReleaseLock
  | C2S_ClaimLock
  | C2S_StopTask
  | C2S_SetModel
  | C2S_ForkSession

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
  permissionMode?: PermissionMode
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

export interface S2C_ModeChange {
  type: 'mode-change'
  sessionId: string
  mode: PermissionMode
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

export interface SlashCommandInfo {
  name: string
  description: string
  argumentHint?: string
}

export interface S2C_SlashCommands {
  type: 'slash-commands'
  sessionId: string
  commands: SlashCommandInfo[]
}

export interface S2C_PlanApproval {
  type: 'plan-approval'
  sessionId: string
  requestId: string
  planContent: string
  planFilePath: string
  allowedPrompts: { tool: string; prompt: string }[]
  readonly: boolean
  contextUsagePercent?: number
}

export interface S2C_PlanApprovalResolved {
  type: 'plan-approval-resolved'
  requestId: string
  decision: string
}

export interface S2C_Error {
  type: 'error'
  message: string
  code?: 'session_locked' | 'session_not_found' | 'not_lock_holder' | 'internal'
}

export interface ModelInfo {
  value: string
  displayName: string
  description: string
  supportsAutoMode?: boolean
  supportedEffortLevels?: string[]
}

export interface S2C_Models {
  type: 'models'
  sessionId: string
  models: ModelInfo[]
}

export interface S2C_AccountInfo {
  type: 'account-info'
  sessionId: string
  email?: string
  organization?: string
  subscriptionType?: string
  apiProvider?: string
  model?: string
}

export interface S2C_SessionForked {
  type: 'session-forked'
  sessionId: string
  originalSessionId: string
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
  | S2C_SlashCommands
  | S2C_ModeChange
  | S2C_PlanApproval
  | S2C_PlanApprovalResolved
  | S2C_Models
  | S2C_AccountInfo
  | S2C_SessionForked
  | S2C_Error
