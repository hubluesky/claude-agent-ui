import { EventEmitter } from 'events'
import type { SessionStatus, PermissionMode } from '@claude-agent-ui/shared'
import type { ToolApprovalRequest, ToolApprovalDecision, AskUserRequest, AskUserResponse, PlanApprovalRequest, PlanApprovalDecision, SendOptions, SessionResult, SlashCommandInfo } from '@claude-agent-ui/shared'

export interface AgentSessionEvents {
  'message': (msg: unknown) => void
  'tool-approval': (req: ToolApprovalRequest) => void
  'plan-approval': (req: PlanApprovalRequest) => void
  'ask-user': (req: AskUserRequest) => void
  'commands': (commands: SlashCommandInfo[]) => void
  'complete': (result: SessionResult) => void
  'error': (err: Error) => void
  'state-change': (state: SessionStatus) => void
  'session-id-changed': (oldId: string | null, newId: string) => void
  'clear-and-accept-requested': (decision: PlanApprovalDecision) => void
}

export abstract class AgentSession extends EventEmitter {
  abstract get id(): string | null
  abstract get projectCwd(): string
  abstract get status(): SessionStatus
  abstract get permissionMode(): PermissionMode

  abstract send(prompt: string, options?: SendOptions): boolean
  abstract abort(): Promise<void>
  abstract close(): void

  abstract resolveToolApproval(requestId: string, decision: ToolApprovalDecision): void
  abstract resolvePlanApproval(requestId: string, decision: PlanApprovalDecision): void
  abstract resolveAskUser(requestId: string, response: AskUserResponse): void

  abstract setPermissionMode(mode: PermissionMode): Promise<void>

  setModel?(model: string): Promise<void>
  stopTask?(taskId: string): Promise<void>
  getContextUsage?(): Promise<unknown>
  getMcpStatus?(): Promise<unknown[]>
  toggleMcpServer?(serverName: string, enabled: boolean): Promise<void>
  reconnectMcpServer?(serverName: string): Promise<void>
  rewindFiles?(messageId: string): Promise<unknown>
  setThinking?(tokens: number | null): void
  setEffort?(level: string): void
}
