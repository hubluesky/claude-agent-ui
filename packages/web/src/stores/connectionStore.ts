import { create } from 'zustand'
import type { SessionStatus, ClientLockStatus, ConnectionStatus } from '@claude-agent-ui/shared'
import type { ToolApprovalRequest, AskUserRequest, PlanApprovalRequest } from '@claude-agent-ui/shared'

interface ResolvedPlanApproval {
  planContent: string
  planFilePath: string
  allowedPrompts: { tool: string; prompt: string }[]
  decision: string
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
  reset: () => set({
    lockStatus: 'idle', lockHolderId: null, sessionStatus: 'idle',
    pendingApproval: null, pendingAskUser: null,
    pendingPlanApproval: null, resolvedPlanApproval: null, planModalOpen: false,
  }),
}))
