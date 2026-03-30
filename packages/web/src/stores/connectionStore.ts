import { create } from 'zustand'
import type { SessionStatus, ClientLockStatus, ConnectionStatus } from '@claude-agent-ui/shared'
import type { ToolApprovalRequest, AskUserRequest } from '@claude-agent-ui/shared'

interface ConnectionState {
  connectionId: string | null
  connectionStatus: ConnectionStatus
  lockStatus: ClientLockStatus
  lockHolderId: string | null
  sessionStatus: SessionStatus
  pendingApproval: (ToolApprovalRequest & { readonly: boolean }) | null
  pendingAskUser: (AskUserRequest & { readonly: boolean }) | null
}

interface ConnectionActions {
  setConnectionId(id: string | null): void
  setConnectionStatus(status: ConnectionStatus): void
  setLockStatus(status: ClientLockStatus): void
  setLockHolderId(id: string | null): void
  setSessionStatus(status: SessionStatus): void
  setPendingApproval(req: (ToolApprovalRequest & { readonly: boolean }) | null): void
  setPendingAskUser(req: (AskUserRequest & { readonly: boolean }) | null): void
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

  setConnectionId: (id) => set({ connectionId: id }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setLockStatus: (status) => set({ lockStatus: status }),
  setLockHolderId: (id) => set({ lockHolderId: id }),
  setSessionStatus: (status) => set({ sessionStatus: status }),
  setPendingApproval: (req) => set({ pendingApproval: req }),
  setPendingAskUser: (req) => set({ pendingAskUser: req }),
  reset: () => set({
    lockStatus: 'idle', lockHolderId: null, sessionStatus: 'idle',
    pendingApproval: null, pendingAskUser: null,
  }),
}))
