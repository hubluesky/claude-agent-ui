import { create } from 'zustand'
import type { SessionStatus, ClientLockStatus, ConnectionStatus } from '@claude-agent-ui/shared'
import type { ToolApprovalRequest, AskUserRequest, PlanApprovalRequest } from '@claude-agent-ui/shared'

interface ResolvedPlanApproval {
  planContent: string
  planFilePath: string
  allowedPrompts: { tool: string; prompt: string }[]
  decision: string
}

export interface ModelInfo {
  value: string
  displayName: string
  description: string
  supportsAutoMode?: boolean
  supportedEffortLevels?: string[]
}

export interface AccountInfo {
  email?: string
  organization?: string
  subscriptionType?: string
  apiProvider?: string
  model?: string
}

export interface ContextUsageCategory {
  name: string
  tokens: number
  color: string
  isDeferred?: boolean
}

export interface ContextUsage {
  categories: ContextUsageCategory[]
  totalTokens: number
  maxTokens: number
  percentage: number
  model: string
}

export interface McpServerInfo {
  name: string
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'
  serverInfo?: { name: string; version: string }
  error?: string
}

interface ConnectionState {
  connectionId: string | null
  connectionStatus: ConnectionStatus
  lockStatus: ClientLockStatus
  lockHolderId: string | null
  sessionStatus: SessionStatus
  pendingApproval: (ToolApprovalRequest & { readonly: boolean }) | null
  pendingAskUser: (AskUserRequest & { readonly: boolean }) | null
  pendingPlanApproval: (PlanApprovalRequest & { readonly: boolean; contextUsagePercent?: number }) | null
  resolvedPlanApproval: ResolvedPlanApproval | null
  planModalOpen: boolean
  accountInfo: AccountInfo | null
  models: ModelInfo[]
  contextUsage: ContextUsage | null
  mcpServers: McpServerInfo[]
  rewindPreview: { filesChanged?: string[]; insertions?: number; deletions?: number; canRewind?: boolean; error?: string } | null
  subagentMessages: { agentId: string; messages: any[] } | null
}

interface ConnectionActions {
  setConnectionId(id: string | null): void
  setConnectionStatus(status: ConnectionStatus): void
  setLockStatus(status: ClientLockStatus): void
  setLockHolderId(id: string | null): void
  setSessionStatus(status: SessionStatus): void
  setPendingApproval(req: (ToolApprovalRequest & { readonly: boolean }) | null): void
  setPendingAskUser(req: (AskUserRequest & { readonly: boolean }) | null): void
  setPendingPlanApproval(req: (PlanApprovalRequest & { readonly: boolean; contextUsagePercent?: number }) | null): void
  setResolvedPlanApproval(req: ResolvedPlanApproval | null): void
  setPlanModalOpen(open: boolean): void
  setAccountInfo(info: AccountInfo | null): void
  setModels(models: ModelInfo[]): void
  setContextUsage(usage: ContextUsage | null): void
  setMcpServers(servers: McpServerInfo[]): void
  setRewindPreview(preview: ConnectionState['rewindPreview']): void
  setSubagentMessages(data: ConnectionState['subagentMessages']): void
  reset(): void
}

export const useConnectionStore = create<ConnectionState & ConnectionActions>((set) => ({
  connectionId: null,
  connectionStatus: 'disconnected',
  lockStatus: 'idle',
  lockHolderId: null,
  sessionStatus: 'idle',
  pendingApproval: null,
  pendingAskUser: null,
  pendingPlanApproval: null,
  resolvedPlanApproval: null,
  planModalOpen: false,
  accountInfo: null,
  models: [],
  contextUsage: null,
  mcpServers: [],
  rewindPreview: null,
  subagentMessages: null,

  setConnectionId: (id) => set({ connectionId: id }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setLockStatus: (status) => set({ lockStatus: status }),
  setLockHolderId: (id) => set({ lockHolderId: id }),
  setSessionStatus: (status) => set({ sessionStatus: status }),
  setPendingApproval: (req) => set({ pendingApproval: req }),
  setPendingAskUser: (req) => set({ pendingAskUser: req }),
  setPendingPlanApproval: (req) => set({ pendingPlanApproval: req }),
  setResolvedPlanApproval: (req) => set({ resolvedPlanApproval: req }),
  setPlanModalOpen: (open) => set({ planModalOpen: open }),
  setAccountInfo: (info) => set({ accountInfo: info }),
  setModels: (models) => set({ models }),
  setContextUsage: (usage) => set({ contextUsage: usage }),
  setMcpServers: (servers) => set({ mcpServers: servers }),
  setRewindPreview: (preview) => set({ rewindPreview: preview }),
  setSubagentMessages: (data) => set({ subagentMessages: data }),
  reset: () => set({
    lockStatus: 'idle', lockHolderId: null, sessionStatus: 'idle',
    pendingApproval: null, pendingAskUser: null,
    pendingPlanApproval: null, resolvedPlanApproval: null, planModalOpen: false,
  }),
}))
