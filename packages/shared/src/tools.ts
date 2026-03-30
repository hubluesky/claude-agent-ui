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
