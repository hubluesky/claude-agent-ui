import { createContext, useContext } from 'react'
import type {
  AgentMessage,
  SessionStatus,
  ConnectionStatus,
  ClientLockStatus,
  ToolApprovalRequest,
  ToolApprovalDecision,
  AskUserRequest,
  PlanApprovalRequest,
  PlanApprovalDecisionType,
  ContextUsageCategory,
  McpServerStatusInfo,
} from '@claude-agent-ui/shared'

export interface ResolvedPlanState {
  planContent: string
  planFilePath: string
  allowedPrompts: { tool: string; prompt: string }[]
  decision: string
}

export interface ContextUsage {
  categories: ContextUsageCategory[]
  totalTokens: number
  maxTokens: number
  percentage: number
  model: string
}

export interface SendOptions {
  cwd?: string
  images?: { data: string; mediaType: string }[]
  thinkingMode?: 'adaptive' | 'enabled' | 'disabled'
  effort?: 'low' | 'medium' | 'high' | 'max'
  permissionMode?: string
  maxBudgetUsd?: number
  maxTurns?: number
}

export interface ChatSessionContextValue {
  // Identity
  sessionId: string | null

  // Connection
  connectionStatus: ConnectionStatus

  // Messages
  messages: AgentMessage[]
  isLoadingHistory: boolean
  isLoadingMore: boolean
  hasMore: boolean
  loadMore(): void

  // Session state
  sessionStatus: SessionStatus
  lockStatus: ClientLockStatus
  lockHolderId: string | null
  pendingApproval: (ToolApprovalRequest & { readonly: boolean }) | null
  pendingAskUser: (AskUserRequest & { readonly: boolean }) | null
  pendingPlanApproval: (PlanApprovalRequest & { readonly: boolean; contextUsagePercent?: number }) | null
  resolvedPlanApproval: ResolvedPlanState | null
  planModalOpen: boolean
  contextUsage: ContextUsage | null
  mcpServers: McpServerStatusInfo[]
  subagentMessages: { agentId: string; messages: any[] } | null

  // Actions
  send(prompt: string, options?: SendOptions): void
  respondToolApproval(requestId: string, decision: ToolApprovalDecision): void
  respondAskUser(requestId: string, answers: Record<string, string>): void
  respondPlanApproval(requestId: string, decision: PlanApprovalDecisionType, feedback?: string): void
  abort(): void
  releaseLock(): void
  setPlanModalOpen(open: boolean): void
  getContextUsage(): void
  getMcpStatus(): void
  toggleMcpServer(serverName: string, enabled: boolean): void
  reconnectMcpServer(serverName: string): void
  getSubagentMessages(agentId: string): void
  forkSession(atMessageId?: string): void
}

export const ChatSessionContext = createContext<ChatSessionContextValue | null>(null)

export function useChatSession(): ChatSessionContextValue {
  const ctx = useContext(ChatSessionContext)
  if (!ctx) throw new Error('useChatSession must be used within ChatSessionProvider')
  return ctx
}
