import type { EffortLevel } from './constants.js'

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
  maxBudgetUsd?: number
  maxTurns?: number
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
