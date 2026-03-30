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
