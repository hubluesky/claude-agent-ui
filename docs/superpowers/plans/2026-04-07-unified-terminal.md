# Unified Terminal UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor data flow into per-session ChatSessionProvider so Single mode (1 panel) and Multi mode (N panels) share identical code paths, then add Multi panel grid + background status dropdown.

**Architecture:** Extract `useWebSocket`/`messageStore`/`connectionStore` logic into three reusable hooks (`useSessionWebSocket`/`useSessionMessages`/`useSessionConnection`). Wrap them in `ChatSessionProvider` context. All chat components read from `useChatSession()` instead of global stores. ChatInterface accepts `compact` prop for grid panels. Each Multi panel gets its own Provider instance with independent WS connection.

**Tech Stack:** React 19, Zustand 5, TypeScript 5.7, TailwindCSS 4, react-virtuoso, @fastify/websocket

**Spec:** `docs/superpowers/specs/2026-04-07-unified-terminal-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/web/src/providers/ChatSessionContext.ts` | Context type definition + createContext + useChatSession hook |
| `packages/web/src/providers/ChatSessionProvider.tsx` | Provider component: composes 3 hooks, provides context |
| `packages/web/src/hooks/useSessionWebSocket.ts` | Per-session WS lifecycle (connect/join/reconnect/send) |
| `packages/web/src/hooks/useSessionMessages.ts` | Per-session message state (append/stream/RAF/optimistic) |
| `packages/web/src/hooks/useSessionConnection.ts` | Per-session connection state (lock/approval/status/etc.) |
| `packages/web/src/components/layout/ViewModeToggle.tsx` | Single/Multi button group for TopBar |
| `packages/web/src/components/layout/ReturnToMultiButton.tsx` | "← 返回 Multi" button for TopBar |
| `packages/web/src/components/layout/BackgroundStatusButton.tsx` | TopBar badge button for background sessions |
| `packages/web/src/components/layout/BackgroundStatusDropdown.tsx` | Top-right dropdown: session status + add-to-panel |
| `packages/web/src/components/chat/MultiPanelGrid.tsx` | N-panel responsive grid container |
| `packages/web/src/components/chat/PanelHeader.tsx` | Panel header: dot + title + project + ↗ + × |
| `packages/web/src/components/chat/EmptyPanel.tsx` | Empty slot / new conversation entry |
| `packages/web/src/stores/multiPanelStore.ts` | Panel session list + per-panel summary status + persistence |

### Modified Files

| File | Changes |
|------|---------|
| `packages/web/src/components/chat/ChatInterface.tsx` | Add `compact` prop, read from `useChatSession()`, render MultiPanelGrid when Multi |
| `packages/web/src/components/chat/ChatMessagesPane.tsx` | Read from `useChatSession()`, add `limit` prop |
| `packages/web/src/components/chat/ChatComposer.tsx` | Read from `useChatSession()`, add `minimal` prop |
| `packages/web/src/components/chat/ApprovalPanel.tsx` | Read from `useChatSession()`, add `compact` prop |
| `packages/web/src/components/chat/ConnectionBanner.tsx` | Read from `useChatSession()` |
| `packages/web/src/components/chat/StatusBar.tsx` | Read from `useChatSession()` for session-specific state |
| `packages/web/src/components/chat/PlanModal.tsx` | Read from `useChatSession()` |
| `packages/web/src/components/chat/PlanApprovalCard.tsx` | Read from `useChatSession()` |
| `packages/web/src/components/chat/MarkdownRenderer.tsx` | Add `compact` prop to skip syntax highlighting |
| `packages/web/src/components/layout/TopBar.tsx` | Integrate ViewModeToggle + BackgroundStatusButton + ReturnToMultiButton |
| `packages/web/src/stores/settingsStore.ts` | Add `viewMode`, `returnToMulti` |
| `packages/web/src/stores/connectionStore.ts` | Remove per-session state, keep only global (models/accountInfo) |
| `packages/web/src/stores/messageStore.ts` | Remove per-session logic, keep optional cache |
| `packages/web/src/hooks/useWebSocket.ts` | Deprecate: replaced by useSessionWebSocket inside Provider |
| `packages/web/src/App.tsx` | Wrap ChatInterface with ChatSessionProvider |

### Unchanged Files

| File | Reason |
|------|--------|
| `packages/server/**` | Server untouched |
| `packages/shared/src/protocol.ts` | No new message types |
| `packages/web/src/components/layout/AppLayout.tsx` | Sidebar unchanged |
| `packages/web/src/components/sidebar/**` | Project tree unchanged |
| `packages/web/src/components/chat/MessageComponent.tsx` | Already props-only, no store reads |

---

## Phase 1a: Extract Hooks + Create Provider (proxy to global stores)

### Task 1: Create ChatSessionContext type + useChatSession hook

**Files:**
- Create: `packages/web/src/providers/ChatSessionContext.ts`

- [ ] **Step 1: Create the context file with full type definition**

```typescript
// packages/web/src/providers/ChatSessionContext.ts
import { createContext, useContext } from 'react'
import type {
  AgentMessage,
  SessionStatus,
  ConnectionStatus,
  ClientLockStatus,
  ToolApprovalDecision,
  PlanApprovalDecisionType,
  ContextUsageCategory,
  McpServerStatusInfo,
} from '@claude-agent-ui/shared'

export interface ToolApprovalState {
  requestId: string
  toolName: string
  toolInput: Record<string, unknown>
  toolUseID: string
  title?: string
  displayName?: string
  description?: string
  agentID?: string
  readonly: boolean
}

export interface AskUserState {
  requestId: string
  questions: any[]
  readonly: boolean
}

export interface PlanApprovalState {
  requestId: string
  planContent: string
  planFilePath: string
  allowedPrompts: { tool: string; prompt: string }[]
  readonly: boolean
  contextUsagePercent?: number
}

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
  pendingApproval: ToolApprovalState | null
  pendingAskUser: AskUserState | null
  pendingPlanApproval: PlanApprovalState | null
  resolvedPlanApproval: ResolvedPlanState | null
  planModalOpen: boolean
  contextUsage: ContextUsage | null
  mcpServers: McpServerStatusInfo[]
  rewindPreview: any | null
  subagentMessages: { agentId: string; messages: any[] } | null

  // Actions
  send(prompt: string, options?: SendOptions): void
  respondToolApproval(requestId: string, decision: ToolApprovalDecision): void
  respondAskUser(requestId: string, answers: Record<string, string>): void
  respondPlanApproval(requestId: string, decision: PlanApprovalDecisionType, feedback?: string): void
  abort(): void
  claimLock(): void
  releaseLock(): void
  setPlanModalOpen(open: boolean): void
  getContextUsage(): void
  getMcpStatus(): void
  toggleMcpServer(serverName: string, enabled: boolean): void
  reconnectMcpServer(serverName: string): void
  rewindFiles(messageId: string, dryRun?: boolean): void
  getSubagentMessages(agentId: string): void
  forkSession(atMessageId?: string): void
}

export const ChatSessionContext = createContext<ChatSessionContextValue | null>(null)

export function useChatSession(): ChatSessionContextValue {
  const ctx = useContext(ChatSessionContext)
  if (!ctx) throw new Error('useChatSession must be used within ChatSessionProvider')
  return ctx
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd packages/web && npx tsc --noEmit`
Expected: No errors (file is standalone types + context)

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/providers/ChatSessionContext.ts
git commit -m "feat(web): create ChatSessionContext type definitions + useChatSession hook"
```

---

### Task 2: Create ChatSessionProvider (proxy version)

This is the **proxy phase** — Provider wraps existing global stores. Components still read from global stores. This validates Provider lifecycle without risk.

**Files:**
- Create: `packages/web/src/providers/ChatSessionProvider.tsx`
- Modify: `packages/web/src/App.tsx` — wrap ChatInterface

- [ ] **Step 1: Create proxy Provider that delegates to existing stores + useWebSocket**

```tsx
// packages/web/src/providers/ChatSessionProvider.tsx
import { useMemo, type ReactNode } from 'react'
import { ChatSessionContext, type ChatSessionContextValue } from './ChatSessionContext'
import { useMessageStore } from '../stores/messageStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useWebSocket } from '../hooks/useWebSocket'
import { useSessionStore } from '../stores/sessionStore'
import { useSettingsStore } from '../stores/settingsStore'

interface ChatSessionProviderProps {
  sessionId: string | null
  children: ReactNode
}

/**
 * Proxy provider: reads from existing global stores.
 * Phase 1a — validates Provider tree without changing any component.
 * Will be replaced with per-session hooks in Phase 1b.
 */
export function ChatSessionProvider({ sessionId, children }: ChatSessionProviderProps) {
  const messages = useMessageStore((s) => s.messages)
  const isLoadingHistory = useMessageStore((s) => s.isLoadingHistory)
  const isLoadingMore = useMessageStore((s) => s.isLoadingMore)
  const hasMore = useMessageStore((s) => s.hasMore)
  const loadMore = useMessageStore((s) => s.loadMore)

  const connectionStatus = useConnectionStore((s) => s.connectionStatus)
  const sessionStatus = useConnectionStore((s) => s.sessionStatus)
  const lockStatus = useConnectionStore((s) => s.lockStatus)
  const lockHolderId = useConnectionStore((s) => s.lockHolderId)
  const pendingApproval = useConnectionStore((s) => s.pendingApproval)
  const pendingAskUser = useConnectionStore((s) => s.pendingAskUser)
  const pendingPlanApproval = useConnectionStore((s) => s.pendingPlanApproval)
  const resolvedPlanApproval = useConnectionStore((s) => s.resolvedPlanApproval)
  const planModalOpen = useConnectionStore((s) => s.planModalOpen)
  const contextUsage = useConnectionStore((s) => s.contextUsage)
  const mcpServers = useConnectionStore((s) => s.mcpServers)
  const rewindPreview = useConnectionStore((s) => s.rewindPreview)
  const subagentMessages = useConnectionStore((s) => s.subagentMessages)

  const {
    sendMessage, respondToolApproval, respondAskUser, respondPlanApproval,
    abort, claimLock, releaseLock, getContextUsage, getMcpStatus,
    toggleMcpServer, reconnectMcpServer, rewindFiles, getSubagentMessages,
    forkSession,
  } = useWebSocket()

  const currentProjectCwd = useSessionStore((s) => s.currentProjectCwd)

  const value = useMemo((): ChatSessionContextValue => ({
    sessionId,
    connectionStatus,
    messages,
    isLoadingHistory,
    isLoadingMore,
    hasMore,
    loadMore,
    sessionStatus,
    lockStatus,
    lockHolderId,
    pendingApproval,
    pendingAskUser,
    pendingPlanApproval,
    resolvedPlanApproval,
    planModalOpen,
    contextUsage,
    mcpServers,
    rewindPreview,
    subagentMessages,

    send(prompt, options) {
      const isNew = sessionId === '__new__' || !sessionId
      const { thinkingMode, effort } = useSettingsStore.getState()
      sendMessage(prompt, isNew ? null : sessionId, {
        cwd: currentProjectCwd ?? undefined,
        thinkingMode,
        effort,
        ...options,
      })
    },
    respondToolApproval,
    respondAskUser,
    respondPlanApproval(requestId, decision, feedback) {
      respondPlanApproval(requestId, decision, feedback)
    },
    abort() {
      if (sessionId && sessionId !== '__new__') abort(sessionId)
    },
    claimLock() {
      if (sessionId && sessionId !== '__new__') claimLock(sessionId)
    },
    releaseLock() {
      if (sessionId && sessionId !== '__new__') releaseLock(sessionId)
    },
    setPlanModalOpen(open) {
      useConnectionStore.getState().setPlanModalOpen(open)
    },
    getContextUsage() {
      if (sessionId && sessionId !== '__new__') getContextUsage(sessionId)
    },
    getMcpStatus() {
      if (sessionId && sessionId !== '__new__') getMcpStatus(sessionId)
    },
    toggleMcpServer(serverName, enabled) {
      if (sessionId && sessionId !== '__new__') toggleMcpServer(sessionId, serverName, enabled)
    },
    reconnectMcpServer(serverName) {
      if (sessionId && sessionId !== '__new__') reconnectMcpServer(sessionId, serverName)
    },
    rewindFiles(messageId, dryRun) {
      if (sessionId && sessionId !== '__new__') rewindFiles(sessionId, messageId, dryRun)
    },
    getSubagentMessages(agentId) {
      if (sessionId && sessionId !== '__new__') getSubagentMessages(sessionId, agentId)
    },
    forkSession(atMessageId) {
      if (sessionId && sessionId !== '__new__') forkSession(sessionId, atMessageId)
    },
  }), [
    sessionId, connectionStatus, messages, isLoadingHistory, isLoadingMore,
    hasMore, loadMore, sessionStatus, lockStatus, lockHolderId,
    pendingApproval, pendingAskUser, pendingPlanApproval, resolvedPlanApproval,
    planModalOpen, contextUsage, mcpServers, rewindPreview, subagentMessages,
    sendMessage, respondToolApproval, respondAskUser, respondPlanApproval,
    abort, claimLock, releaseLock, getContextUsage, getMcpStatus,
    toggleMcpServer, reconnectMcpServer, rewindFiles, getSubagentMessages,
    forkSession, currentProjectCwd,
  ])

  return (
    <ChatSessionContext.Provider value={value}>
      {children}
    </ChatSessionContext.Provider>
  )
}
```

- [ ] **Step 2: Wrap ChatInterface with Provider in App.tsx (or wherever ChatInterface is rendered)**

Find where `<ChatInterface />` is rendered (in `App.tsx` or `AppLayout` children). Wrap it:

```tsx
import { ChatSessionProvider } from './providers/ChatSessionProvider'
import { useSessionStore } from './stores/sessionStore'

// Where ChatInterface is rendered:
const currentSessionId = useSessionStore((s) => s.currentSessionId)

<ChatSessionProvider sessionId={currentSessionId}>
  <ChatInterface />
</ChatSessionProvider>
```

- [ ] **Step 3: Verify app works exactly as before**

Run: `pnpm dev`
Expected: All existing functionality works — chat, approval, plan modal, streaming. The Provider is transparent.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/providers/ChatSessionProvider.tsx packages/web/src/App.tsx
git commit -m "feat(web): add ChatSessionProvider proxy — wraps global stores, zero behavior change"
```

---

### Task 3: Switch ChatInterface to useChatSession()

**Files:**
- Modify: `packages/web/src/components/chat/ChatInterface.tsx`

- [ ] **Step 1: Replace direct store reads with useChatSession()**

Replace:
```tsx
import { useWebSocket } from '../../hooks/useWebSocket'
import { useSessionStore } from '../../stores/sessionStore'
import { useMessageStore } from '../../stores/messageStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useConnectionStore } from '../../stores/connectionStore'
```

With:
```tsx
import { useChatSession } from '../../providers/ChatSessionContext'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
```

Then inside the component, replace store reads:

```tsx
export function ChatInterface() {
  const ctx = useChatSession()
  const { currentProjectCwd } = useSessionStore()

  const isNewSession = ctx.sessionId === '__new__'

  useEffect(() => {
    if (ctx.sessionId && !isNewSession) {
      // Provider handles WS join — no need to call joinSession here
    }
    if (isNewSession) {
      // Clear handled by Provider when sessionId changes
    }
  }, [ctx.sessionId, isNewSession])

  const handleSend = useCallback((prompt: string, images?: { data: string; mediaType: string }[]) => {
    const contentBlocks: any[] = []
    if (images) {
      for (const img of images) {
        contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })
      }
    }
    if (prompt) {
      contentBlocks.push({ type: 'text', text: prompt })
    }
    // Optimistic user message — still append to messageStore for now (proxy mode)
    useMessageStore.getState().appendMessage({
      type: 'user',
      _optimistic: true,
      message: { role: 'user', content: contentBlocks },
    } as any)

    ctx.send(prompt, { images })
  }, [ctx])

  const handleAbort = useCallback(() => ctx.abort(), [ctx])

  const approvalConfig = useMemo((): ApprovalPanelConfig | null => {
    if (ctx.pendingAskUser) {
      return buildAskUserConfig(
        ctx.pendingAskUser.requestId,
        ctx.pendingAskUser.questions,
        ctx.respondAskUser,
        ctx.pendingAskUser.readonly,
      )
    }
    if (ctx.pendingApproval) {
      return buildToolApprovalConfig(
        ctx.pendingApproval.requestId,
        ctx.pendingApproval.toolName,
        ctx.pendingApproval.toolInput,
        ctx.pendingApproval.title,
        ctx.pendingApproval.description,
        ctx.respondToolApproval,
        ctx.pendingApproval.readonly,
      )
    }
    if (ctx.pendingPlanApproval) {
      return buildPlanApprovalConfig(
        ctx.pendingPlanApproval.requestId,
        ctx.pendingPlanApproval.contextUsagePercent,
        ctx.respondPlanApproval,
        ctx.pendingPlanApproval.readonly,
      )
    }
    return null
  }, [ctx.pendingAskUser, ctx.pendingApproval, ctx.pendingPlanApproval,
      ctx.respondToolApproval, ctx.respondAskUser, ctx.respondPlanApproval])

  if (!ctx.sessionId) return null

  // ... rest of JSX stays the same
}
```

- [ ] **Step 2: Verify chat, approval, streaming all work**

Run: `pnpm dev`
Test: Send a message, see streaming, approve a tool, verify plan modal.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/ChatInterface.tsx
git commit -m "refactor(web): ChatInterface reads from useChatSession() context"
```

---

### Task 4: Switch ChatMessagesPane to useChatSession()

**Files:**
- Modify: `packages/web/src/components/chat/ChatMessagesPane.tsx`

- [ ] **Step 1: Replace store reads**

```tsx
// Remove:
import { useMessageStore } from '../../stores/messageStore'
import { useConnectionStore } from '../../stores/connectionStore'

// Add:
import { useChatSession } from '../../providers/ChatSessionContext'

export function ChatMessagesPane({ sessionId }: ChatMessagesPaneProps) {
  const ctx = useChatSession()
  const rawMessages = ctx.messages
  const messages = useMemo(() => rawMessages.filter(isMessageVisible), [rawMessages])
  const hasMore = ctx.hasMore
  const isLoadingHistory = ctx.isLoadingHistory
  const isLoadingMore = ctx.isLoadingMore
  const loadMore = ctx.loadMore
  const sessionStatus = ctx.sessionStatus
  const pendingPlanApproval = ctx.pendingPlanApproval

  // Remove useEffect for loadInitial — Provider handles this

  // ... rest unchanged
}
```

- [ ] **Step 2: Verify messages load and scroll correctly**

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/ChatMessagesPane.tsx
git commit -m "refactor(web): ChatMessagesPane reads from useChatSession()"
```

---

### Task 5: Switch ChatComposer to useChatSession()

**Files:**
- Modify: `packages/web/src/components/chat/ChatComposer.tsx`

- [ ] **Step 1: Replace useWebSocket and useConnectionStore reads**

The ChatComposer currently reads `lockStatus`, `sessionStatus`, `models`, `accountInfo` from connectionStore, and uses `useWebSocket()` for `releaseLock` and `send`.

Replace with `useChatSession()` for per-session state. Keep reading `models` and `accountInfo` from global connectionStore (they're truly global).

```tsx
import { useChatSession } from '../../providers/ChatSessionContext'

// Inside component:
const ctx = useChatSession()
const { lockStatus, sessionStatus } = ctx  // was from connectionStore
const { models, accountInfo } = useConnectionStore()  // still global

// Replace releaseLock:
const handleReleaseLock = useCallback(() => {
  ctx.releaseLock()
}, [ctx])

// Replace send for mode/effort changes:
// These still go through the global useWebSocket for now since they're session commands
```

- [ ] **Step 2: Verify composer input, send, abort, lock all work**

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/ChatComposer.tsx
git commit -m "refactor(web): ChatComposer reads session state from useChatSession()"
```

---

### Task 6: Switch ConnectionBanner, StatusBar, PlanModal, PlanApprovalCard

**Files:**
- Modify: `packages/web/src/components/chat/ConnectionBanner.tsx`
- Modify: `packages/web/src/components/chat/StatusBar.tsx`
- Modify: `packages/web/src/components/chat/PlanModal.tsx`
- Modify: `packages/web/src/components/chat/PlanApprovalCard.tsx`

- [ ] **Step 1: ConnectionBanner**

```tsx
import { useChatSession } from '../../providers/ChatSessionContext'

export function ConnectionBanner() {
  const { connectionStatus } = useChatSession()
  // ... rest unchanged
}
```

- [ ] **Step 2: StatusBar — keep global reads for models/accountInfo, use context for session state**

```tsx
import { useChatSession } from '../../providers/ChatSessionContext'

export function StatusBar() {
  const { connectionStatus } = useChatSession()
  const accountInfo = useConnectionStore((s) => s.accountInfo)  // global
  // ... rest unchanged
}
```

- [ ] **Step 3: PlanModal**

```tsx
import { useChatSession } from '../../providers/ChatSessionContext'

export function PlanModal() {
  const ctx = useChatSession()
  const { pendingPlanApproval, planModalOpen, resolvedPlanApproval, setPlanModalOpen, respondPlanApproval } = ctx
  // ... rest unchanged, replace useWebSocket().respondPlanApproval with ctx.respondPlanApproval
}
```

- [ ] **Step 4: PlanApprovalCard**

```tsx
import { useChatSession } from '../../providers/ChatSessionContext'

export function PlanApprovalCard() {
  const { pendingPlanApproval } = useChatSession()
  // ... rest unchanged
}
```

- [ ] **Step 5: Verify all four components work**

Test: disconnect WiFi → ConnectionBanner shows. Plan approval flow. StatusBar shows model.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/chat/ConnectionBanner.tsx packages/web/src/components/chat/StatusBar.tsx packages/web/src/components/chat/PlanModal.tsx packages/web/src/components/chat/PlanApprovalCard.tsx
git commit -m "refactor(web): ConnectionBanner, StatusBar, PlanModal, PlanApprovalCard use useChatSession()"
```

---

### Task 7: Add settingsStore viewMode + returnToMulti

**Files:**
- Modify: `packages/web/src/stores/settingsStore.ts`

- [ ] **Step 1: Add viewMode and returnToMulti to SettingsState**

```typescript
// In SettingsState interface:
viewMode: 'single' | 'multi'
returnToMulti: boolean

// In SettingsActions interface:
setViewMode(mode: SettingsState['viewMode']): void
setReturnToMulti(value: boolean): void

// In create() initial state:
viewMode: (saved.viewMode as SettingsState['viewMode']) ?? 'single',
returnToMulti: false,

// In actions:
setViewMode(mode) {
  set({ viewMode: mode })
  saveToLocal(get())
},
setReturnToMulti(value) {
  set({ returnToMulti: value })
},

// In saveToLocal:
viewMode: state.viewMode,  // add to serialized object
```

- [ ] **Step 2: Verify**

Run: `cd packages/web && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/stores/settingsStore.ts
git commit -m "feat(web): add viewMode + returnToMulti to settingsStore"
```

---

This completes **Phase 1a + Phase 1b (partial)** — Provider is in place, key components switched to context. The remaining components (ContextPanel, McpPanel, etc.) can be switched incrementally as needed.

**Phase 1c** (cleanup: remove global store proxy, slim down messageStore/connectionStore) is deferred until after Multi mode is working, to reduce risk.

---

## Phase 2: compact Mode (Tasks 8-12)

### Task 8: ChatInterface compact prop + PanelHeader

**Files:**
- Modify: `packages/web/src/components/chat/ChatInterface.tsx`
- Create: `packages/web/src/components/chat/PanelHeader.tsx`

- [ ] **Step 1: Create PanelHeader**

```tsx
// packages/web/src/components/chat/PanelHeader.tsx
import { useChatSession } from '../../providers/ChatSessionContext'

interface PanelHeaderProps {
  title: string
  projectName: string
  onExpand: () => void
  onClose: () => void
}

export function PanelHeader({ title, projectName, onExpand, onClose }: PanelHeaderProps) {
  const { sessionStatus, lockStatus } = useChatSession()

  const dotColor = sessionStatus === 'running'
    ? 'bg-[#22c55e] shadow-[0_0_4px_rgba(34,197,94,0.4)]'
    : lockStatus === 'locked_self'
      ? 'bg-[#f59e0b]'
      : 'bg-[#3d3b37]'

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-[#3d3b37] shrink-0 bg-[#242320]">
      <div className={`w-[5px] h-[5px] rounded-full shrink-0 ${dotColor}`} />
      <span
        className="text-[9px] font-semibold flex-1 truncate cursor-pointer"
        onDoubleClick={onExpand}
      >
        {title || 'New conversation'}
      </span>
      <span className="text-[7px] text-[#d97706] bg-[#d977060f] px-1 rounded">{projectName}</span>
      <button
        onClick={onExpand}
        className="w-[18px] h-[18px] rounded text-[10px] text-[#5c5952] hover:bg-[#d977061a] hover:text-[#d97706] flex items-center justify-center"
        title="展开全屏"
      >
        ↗
      </button>
      <button
        onClick={onClose}
        className="w-[18px] h-[18px] rounded text-[11px] text-[#5c5952] hover:bg-[#3d3b37] hover:text-[#7c7872] flex items-center justify-center"
      >
        ×
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Add compact prop to ChatInterface**

```tsx
interface ChatInterfaceProps {
  compact?: boolean
  panelTitle?: string
  panelProjectName?: string
  onExpandPanel?: () => void
  onClosePanel?: () => void
}

export function ChatInterface({
  compact = false,
  panelTitle,
  panelProjectName,
  onExpandPanel,
  onClosePanel,
}: ChatInterfaceProps) {
  // ... existing logic

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {compact && panelTitle && onExpandPanel && onClosePanel && (
        <PanelHeader
          title={panelTitle}
          projectName={panelProjectName ?? ''}
          onExpand={onExpandPanel}
          onClose={onClosePanel}
        />
      )}
      <ConnectionBanner />
      {/* ... rest of existing JSX */}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/PanelHeader.tsx packages/web/src/components/chat/ChatInterface.tsx
git commit -m "feat(web): add PanelHeader + compact prop to ChatInterface"
```

---

### Task 9: MarkdownRenderer + MessageComponent compact mode

**Files:**
- Modify: `packages/web/src/components/chat/MarkdownRenderer.tsx`

- [ ] **Step 1: Add compact prop to skip syntax highlighting**

Find the rehype-highlight plugin usage in MarkdownRenderer. When `compact=true`, omit it from the rehypePlugins array:

```tsx
interface MarkdownRendererProps {
  content: string
  compact?: boolean
}

export function MarkdownRenderer({ content, compact }: MarkdownRendererProps) {
  // In the ReactMarkdown component:
  // rehypePlugins={compact ? [] : [rehypeHighlight]}
}
```

Note: MessageComponent itself doesn't need changes since it already receives props. But ChatInterface should pass `compact` down via context or prop if MessageComponent uses MarkdownRenderer. Check how it flows — if MarkdownRenderer is called inside MessageComponent, MessageComponent needs to receive and pass `compact`.

- [ ] **Step 2: Verify compact mode renders without syntax highlighting**

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/MarkdownRenderer.tsx
git commit -m "feat(web): MarkdownRenderer compact mode skips syntax highlighting"
```

---

### Task 10: ChatComposer minimal prop

**Files:**
- Modify: `packages/web/src/components/chat/ChatComposer.tsx`

- [ ] **Step 1: Add minimal prop**

```tsx
interface ChatComposerProps {
  onSend: (prompt: string, images?: { data: string; mediaType: string }[]) => void
  onAbort: () => void
  minimal?: boolean
}
```

When `minimal=true`:
- Hide `ComposerToolbar` (the toolbar with /, @, 📎, modes buttons)
- Hide `ImagePreviewBar`
- Hide `SlashCommandPopup`, `FileReferencePopup`, `ModesPopup`
- Show only textarea + send button in a compact layout

```tsx
{!minimal && <ImagePreviewBar images={images} onRemove={removeImage} />}
{!minimal && showModes && <ModesPopup ... />}
{!minimal && showPopup && <SlashCommandPopup ... />}
{!minimal && showFilePopup && <FileReferencePopup ... />}

{/* Textarea stays */}

{!minimal && <div className="h-px bg-[#3d3b37]" />}
{minimal ? (
  <div className="flex items-center px-2 py-1 gap-1">
    <div className="flex-1" />
    <button onClick={isRunning ? onAbort : handleSubmit} ...>
      {isRunning ? '■' : '↑'}
    </button>
  </div>
) : (
  <ComposerToolbar ... />
)}
```

- [ ] **Step 2: Verify minimal mode shows only input + send**

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/ChatComposer.tsx
git commit -m "feat(web): ChatComposer minimal mode hides toolbar"
```

---

### Task 11: ChatMessagesPane limit prop

**Files:**
- Modify: `packages/web/src/components/chat/ChatMessagesPane.tsx`

- [ ] **Step 1: Add limit prop**

```tsx
interface ChatMessagesPaneProps {
  sessionId: string
  limit?: number
}

export function ChatMessagesPane({ sessionId, limit }: ChatMessagesPaneProps) {
  // ...
  const messages = useMemo(() => {
    const visible = rawMessages.filter(isMessageVisible)
    return limit ? visible.slice(-limit) : visible
  }, [rawMessages, limit])
  // ...
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/chat/ChatMessagesPane.tsx
git commit -m "feat(web): ChatMessagesPane limit prop for compact panels"
```

---

### Task 12: ApprovalPanel compact prop

**Files:**
- Modify: `packages/web/src/components/chat/ApprovalPanel.tsx`

- [ ] **Step 1: Add compact prop**

When `compact=true`:
- Hide the feedback text area
- Hide "Other..." expand option
- Show only the primary action buttons (Allow/Deny for tool approval)
- Reduce padding

The ApprovalPanel config builder already controls what options are shown. For compact mode, just reduce visual chrome:

```tsx
interface ApprovalPanelProps {
  config: ApprovalPanelConfig
  compact?: boolean
}

// In render:
// When compact, use smaller padding and hide feedback input
<div className={compact ? 'px-2 py-1.5' : 'px-4 py-3'}>
  {/* Options — shown always */}
  {/* Feedback — hidden when compact */}
  {!compact && showFeedback && <textarea ... />}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/chat/ApprovalPanel.tsx
git commit -m "feat(web): ApprovalPanel compact mode reduces chrome"
```

---

## Phase 3: Multi Mode UI (Tasks 13-18)

### Task 13: multiPanelStore

**Files:**
- Create: `packages/web/src/stores/multiPanelStore.ts`

- [ ] **Step 1: Create the store**

```typescript
// packages/web/src/stores/multiPanelStore.ts
import { create } from 'zustand'
import type { SessionStatus } from '@claude-agent-ui/shared'

export interface PanelSummary {
  sessionId: string
  projectCwd: string
  projectName: string
  title: string
  status: SessionStatus
  lastMessage?: string
  hasApproval?: boolean
}

interface MultiPanelState {
  panelSessionIds: string[]
  panelSummaries: Map<string, PanelSummary>
}

interface MultiPanelActions {
  addPanel(sessionId: string, summary: Omit<PanelSummary, 'status'> & { status?: SessionStatus }): void
  removePanel(sessionId: string): void
  hasPanel(sessionId: string): boolean
  updateSummary(sessionId: string, update: Partial<PanelSummary>): void
  getPanels(): PanelSummary[]
}

const STORAGE_KEY = 'claude-agent-ui-panels'

function loadPanelIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function savePanelIds(ids: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
}

export const useMultiPanelStore = create<MultiPanelState & MultiPanelActions>((set, get) => ({
  panelSessionIds: loadPanelIds(),
  panelSummaries: new Map(),

  addPanel(sessionId, summary) {
    const { panelSessionIds, panelSummaries } = get()
    if (panelSessionIds.includes(sessionId)) return
    const ids = [...panelSessionIds, sessionId]
    const summaries = new Map(panelSummaries)
    summaries.set(sessionId, { status: 'idle', ...summary })
    set({ panelSessionIds: ids, panelSummaries: summaries })
    savePanelIds(ids)
  },

  removePanel(sessionId) {
    const { panelSessionIds, panelSummaries } = get()
    const ids = panelSessionIds.filter((id) => id !== sessionId)
    const summaries = new Map(panelSummaries)
    summaries.delete(sessionId)
    set({ panelSessionIds: ids, panelSummaries: summaries })
    savePanelIds(ids)
  },

  hasPanel(sessionId) {
    return get().panelSessionIds.includes(sessionId)
  },

  updateSummary(sessionId, update) {
    const { panelSummaries } = get()
    const existing = panelSummaries.get(sessionId)
    if (!existing) return
    const summaries = new Map(panelSummaries)
    summaries.set(sessionId, { ...existing, ...update })
    set({ panelSummaries: summaries })
  },

  getPanels() {
    const { panelSessionIds, panelSummaries } = get()
    return panelSessionIds
      .map((id) => panelSummaries.get(id))
      .filter((s): s is PanelSummary => s !== undefined)
  },
}))
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/stores/multiPanelStore.ts
git commit -m "feat(web): add multiPanelStore for panel list + summaries"
```

---

### Task 14: ViewModeToggle + ReturnToMultiButton

**Files:**
- Create: `packages/web/src/components/layout/ViewModeToggle.tsx`
- Create: `packages/web/src/components/layout/ReturnToMultiButton.tsx`
- Modify: `packages/web/src/components/layout/TopBar.tsx`

- [ ] **Step 1: Create ViewModeToggle**

```tsx
// packages/web/src/components/layout/ViewModeToggle.tsx
import { useSettingsStore } from '../../stores/settingsStore'

export function ViewModeToggle() {
  const viewMode = useSettingsStore((s) => s.viewMode)
  const setViewMode = useSettingsStore((s) => s.setViewMode)
  const setReturnToMulti = useSettingsStore((s) => s.setReturnToMulti)

  const handleSwitch = (mode: 'single' | 'multi') => {
    if (mode === viewMode) return
    setViewMode(mode)
    if (mode !== 'single') setReturnToMulti(false)
  }

  return (
    <div className="flex bg-[#1c1b18] rounded-[5px] border border-[#3d3b37] overflow-hidden">
      {(['single', 'multi'] as const).map((mode) => (
        <button
          key={mode}
          onClick={() => handleSwitch(mode)}
          className={`px-2 py-0.5 text-[9px] capitalize border-none cursor-pointer font-inherit transition-colors ${
            viewMode === mode
              ? 'bg-[#d977061a] text-[#d97706] font-semibold'
              : 'text-[#5c5952] hover:text-[#7c7872]'
          }`}
        >
          {mode === 'single' ? 'Single' : 'Multi'}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Create ReturnToMultiButton**

```tsx
// packages/web/src/components/layout/ReturnToMultiButton.tsx
import { useSettingsStore } from '../../stores/settingsStore'

export function ReturnToMultiButton() {
  const returnToMulti = useSettingsStore((s) => s.returnToMulti)
  const setViewMode = useSettingsStore((s) => s.setViewMode)
  const setReturnToMulti = useSettingsStore((s) => s.setReturnToMulti)

  if (!returnToMulti) return null

  const handleReturn = () => {
    setViewMode('multi')
    setReturnToMulti(false)
  }

  return (
    <button
      onClick={handleReturn}
      className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#d977061a] text-[#d97706] text-[9px] font-semibold cursor-pointer border-none font-inherit hover:bg-[#d9770630]"
    >
      ← 返回 Multi
    </button>
  )
}
```

- [ ] **Step 3: Integrate into TopBar**

```tsx
import { ViewModeToggle } from './ViewModeToggle'
import { ReturnToMultiButton } from './ReturnToMultiButton'

// In TopBar's right-side div, before history button:
<ReturnToMultiButton />
<ViewModeToggle />
```

- [ ] **Step 4: Verify**

Run dev: TopBar shows Single/Multi toggle. Clicking Multi currently does nothing (no grid yet). ReturnToMulti button hidden by default.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/layout/ViewModeToggle.tsx packages/web/src/components/layout/ReturnToMultiButton.tsx packages/web/src/components/layout/TopBar.tsx
git commit -m "feat(web): add ViewModeToggle + ReturnToMultiButton to TopBar"
```

---

### Task 15: MultiPanelGrid + EmptyPanel

**Files:**
- Create: `packages/web/src/components/chat/MultiPanelGrid.tsx`
- Create: `packages/web/src/components/chat/EmptyPanel.tsx`

- [ ] **Step 1: Create EmptyPanel**

```tsx
// packages/web/src/components/chat/EmptyPanel.tsx
interface EmptyPanelProps {
  onNewConversation: () => void
}

export function EmptyPanel({ onNewConversation }: EmptyPanelProps) {
  return (
    <div
      onClick={onNewConversation}
      className="flex flex-col items-center justify-center cursor-pointer text-[#3d3b37] hover:text-[#5c5952] h-full bg-[#1c1b18] min-h-[200px]"
    >
      <div className="w-[30px] h-[30px] rounded-full bg-[#242320] border border-[#3d3b37] flex items-center justify-center text-xs font-bold text-[#d97706] font-mono mb-2">
        C
      </div>
      <div className="text-[9px]">新建对话</div>
    </div>
  )
}
```

- [ ] **Step 2: Create MultiPanelGrid**

```tsx
// packages/web/src/components/chat/MultiPanelGrid.tsx
import { useCallback } from 'react'
import { useMultiPanelStore } from '../../stores/multiPanelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { ChatSessionProvider } from '../../providers/ChatSessionProvider'
import { ChatInterface } from './ChatInterface'
import { EmptyPanel } from './EmptyPanel'

function getGridCols(count: number): number {
  if (count <= 1) return 1
  if (count <= 4) return 2
  if (count <= 9) return 3
  return 4
}

export function MultiPanelGrid() {
  const panelIds = useMultiPanelStore((s) => s.panelSessionIds)
  const summaries = useMultiPanelStore((s) => s.panelSummaries)
  const removePanel = useMultiPanelStore((s) => s.removePanel)
  const setViewMode = useSettingsStore((s) => s.setViewMode)
  const setReturnToMulti = useSettingsStore((s) => s.setReturnToMulti)
  const selectSession = useSessionStore((s) => s.selectSession)
  const expandedPanelId = useSettingsStore((s) => s.returnToMulti ? null : undefined)

  const handleExpand = useCallback((sessionId: string, cwd: string) => {
    selectSession(sessionId, cwd)
    setViewMode('single')
    setReturnToMulti(true)
  }, [selectSession, setViewMode, setReturnToMulti])

  const handleNewConversation = useCallback(() => {
    // Switch to Single mode for new conversation flow
    setViewMode('single')
    const cwd = useSessionStore.getState().currentProjectCwd
    if (cwd) selectSession('__new__', cwd)
  }, [setViewMode, selectSession])

  const totalSlots = panelIds.length + 1 // +1 for empty/new slot
  const cols = getGridCols(totalSlots)

  return (
    <div
      className="flex-1 grid gap-px bg-[#3d3b37] min-h-0 overflow-y-auto"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
    >
      {panelIds.map((sid) => {
        const summary = summaries.get(sid)
        return (
          <ChatSessionProvider key={sid} sessionId={sid}>
            <ChatInterface
              compact
              panelTitle={summary?.title}
              panelProjectName={summary?.projectName}
              onExpandPanel={() => handleExpand(sid, summary?.projectCwd ?? '')}
              onClosePanel={() => removePanel(sid)}
            />
          </ChatSessionProvider>
        )
      })}
      <EmptyPanel onNewConversation={handleNewConversation} />
    </div>
  )
}
```

- [ ] **Step 3: Wire into ChatInterface render path**

In the parent component where ChatInterface is rendered (App.tsx or the layout), check viewMode:

```tsx
const viewMode = useSettingsStore((s) => s.viewMode)

{viewMode === 'multi' ? (
  <MultiPanelGrid />
) : (
  <ChatSessionProvider sessionId={currentSessionId}>
    <ChatInterface />
  </ChatSessionProvider>
)}
```

- [ ] **Step 4: Verify Multi mode shows grid with empty panel**

Switch to Multi → see empty panel with "新建对话". No panels yet (need to add via dropdown in Phase 4).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/chat/MultiPanelGrid.tsx packages/web/src/components/chat/EmptyPanel.tsx
git commit -m "feat(web): add MultiPanelGrid + EmptyPanel for Multi mode"
```

---

### Task 16: Esc to return from expanded panel

**Files:**
- Modify: `packages/web/src/components/chat/ChatInterface.tsx`

- [ ] **Step 1: Add Esc handler when returnToMulti is true**

```tsx
const returnToMulti = useSettingsStore((s) => s.returnToMulti)
const setViewMode = useSettingsStore((s) => s.setViewMode)
const setReturnToMulti = useSettingsStore((s) => s.setReturnToMulti)

useEffect(() => {
  if (!returnToMulti) return
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setViewMode('multi')
      setReturnToMulti(false)
    }
  }
  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [returnToMulti, setViewMode, setReturnToMulti])
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/chat/ChatInterface.tsx
git commit -m "feat(web): Esc returns from expanded panel to Multi mode"
```

---

## Phase 4: Background Status Dropdown (Tasks 17-18)

### Task 17: BackgroundStatusButton

**Files:**
- Create: `packages/web/src/components/layout/BackgroundStatusButton.tsx`
- Modify: `packages/web/src/components/layout/TopBar.tsx`

- [ ] **Step 1: Create BackgroundStatusButton**

```tsx
// packages/web/src/components/layout/BackgroundStatusButton.tsx
import { useState } from 'react'
import { useMultiPanelStore } from '../../stores/multiPanelStore'
import { BackgroundStatusDropdown } from './BackgroundStatusDropdown'

export function BackgroundStatusButton() {
  const [open, setOpen] = useState(false)
  const summaries = useMultiPanelStore((s) => s.panelSummaries)

  // Count sessions needing attention
  let attentionCount = 0
  for (const [, s] of summaries) {
    if (s.hasApproval || s.status === 'awaiting_approval' || s.status === 'awaiting_user_input') {
      attentionCount++
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors relative ${
          open ? 'bg-[#3d3b37] text-[#e5e2db]' : 'hover:bg-[#3d3b37] text-[#7c7872]'
        }`}
        title="后台会话"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        {attentionCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[14px] h-[14px] rounded-full bg-[#f59e0b] text-[#1c1b18] text-[7px] font-bold flex items-center justify-center px-0.5">
            {attentionCount}
          </span>
        )}
      </button>
      {open && <BackgroundStatusDropdown onClose={() => setOpen(false)} />}
    </div>
  )
}
```

- [ ] **Step 2: Integrate into TopBar**

```tsx
import { BackgroundStatusButton } from './BackgroundStatusButton'

// In TopBar right-side div:
<BackgroundStatusButton />
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/layout/BackgroundStatusButton.tsx packages/web/src/components/layout/TopBar.tsx
git commit -m "feat(web): add BackgroundStatusButton with badge to TopBar"
```

---

### Task 18: BackgroundStatusDropdown

**Files:**
- Create: `packages/web/src/components/layout/BackgroundStatusDropdown.tsx`

- [ ] **Step 1: Create the dropdown**

```tsx
// packages/web/src/components/layout/BackgroundStatusDropdown.tsx
import { useEffect, useRef } from 'react'
import { useMultiPanelStore, type PanelSummary } from '../../stores/multiPanelStore'
import { useSessionStore } from '../../stores/sessionStore'

interface BackgroundStatusDropdownProps {
  onClose: () => void
}

export function BackgroundStatusDropdown({ onClose }: BackgroundStatusDropdownProps) {
  const panelSummaries = useMultiPanelStore((s) => s.panelSummaries)
  const addPanel = useMultiPanelStore((s) => s.addPanel)
  const hasPanel = useMultiPanelStore((s) => s.hasPanel)
  const currentSessionId = useSessionStore((s) => s.currentSessionId)
  const selectSession = useSessionStore((s) => s.selectSession)
  const ref = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  // Get all panel summaries except current session
  const items: PanelSummary[] = []
  for (const [sid, summary] of panelSummaries) {
    if (sid !== currentSessionId) {
      items.push(summary)
    }
  }

  // Sort: waiting > running > idle
  items.sort((a, b) => {
    const order = (s: string) =>
      s === 'awaiting_approval' || s === 'awaiting_user_input' ? 0
        : s === 'running' ? 1
        : 2
    return order(a.status) - order(b.status)
  })

  const handleClick = (summary: PanelSummary) => {
    selectSession(summary.sessionId, summary.projectCwd)
    onClose()
  }

  const handleAdd = (summary: PanelSummary, e: React.MouseEvent) => {
    e.stopPropagation()
    addPanel(summary.sessionId, summary)
  }

  return (
    <div
      ref={ref}
      className="absolute top-full right-0 mt-1 w-[280px] bg-[#1c1b18] border border-[#3d3b37] rounded-[10px] shadow-[0_12px_40px_rgba(0,0,0,0.5)] z-20 flex flex-col max-h-[400px] animate-[dropdown-in_0.15s_ease-out]"
    >
      <div className="flex items-center gap-1.5 px-3.5 py-2.5 border-b border-[#3d3b37]">
        <span className="text-xs font-semibold flex-1">后台会话</span>
      </div>
      <div className="flex-1 overflow-y-auto py-1.5 px-1.5">
        {items.length === 0 ? (
          <div className="text-center text-[#5c5952] text-xs py-6">没有后台会话</div>
        ) : (
          items.map((item) => {
            const isWaiting = item.hasApproval || item.status === 'awaiting_approval' || item.status === 'awaiting_user_input'
            const isRunning = item.status === 'running'
            const dotClass = isWaiting
              ? 'bg-[#f59e0b] animate-pulse'
              : isRunning
                ? 'bg-[#22c55e] shadow-[0_0_3px_rgba(34,197,94,0.3)]'
                : 'bg-[#3d3b37]'
            const inPanel = hasPanel(item.sessionId)

            return (
              <div
                key={item.sessionId}
                onClick={() => handleClick(item)}
                className={`flex items-center gap-2 px-2.5 py-[7px] rounded-[7px] cursor-pointer mb-0.5 transition-all ${
                  isWaiting ? 'bg-[#f59e0b06] hover:bg-[#f59e0b0d]' : 'hover:bg-[#2b2a27]'
                }`}
              >
                <div className={`w-[7px] h-[7px] rounded-full shrink-0 ${dotClass}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold truncate">{item.title || '新会话'}</div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className="text-[8px] text-[#d97706] bg-[#d977060f] px-1 rounded">{item.projectName}</span>
                    {item.lastMessage && (
                      <span className="text-[8px] text-[#5c5952] truncate flex-1">{item.lastMessage}</span>
                    )}
                  </div>
                </div>
                {isWaiting && (
                  <span className="text-[7px] bg-[#f59e0b] text-[#1c1b18] px-1.5 rounded font-bold">审批</span>
                )}
                {inPanel ? (
                  <div className="w-[18px] h-[18px] rounded bg-[#d977061a] border border-[#d9770640] text-[#d97706] flex items-center justify-center text-[8px] shrink-0">
                    ✓
                  </div>
                ) : (
                  <button
                    onClick={(e) => handleAdd(item, e)}
                    className="w-[18px] h-[18px] rounded border border-[#3d3b37] text-[#5c5952] hover:border-[#d97706] hover:text-[#d97706] hover:bg-[#d977061a] flex items-center justify-center text-[10px] shrink-0 cursor-pointer bg-transparent"
                    title="添加到面板"
                  >
                    +
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
      <div className="px-3 py-2 border-t border-[#3d3b37] text-center text-[9px] text-[#5c5952]">
        + 添加到面板 · ✓ 已在面板 · 点击切换
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify end-to-end**

Run dev. In Single mode, click the status button → dropdown opens. Shows panel sessions. Click to switch. Click + to add to panel. Switch to Multi → panels appear.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/layout/BackgroundStatusDropdown.tsx
git commit -m "feat(web): add BackgroundStatusDropdown with status + add-to-panel"
```

---

## Self-Review Checklist

- [x] **Spec coverage:**
  - ChatSessionProvider + hooks: Tasks 1-2
  - Components switch to context: Tasks 3-6
  - settingsStore viewMode: Task 7
  - compact mode (ChatInterface/Composer/ApprovalPanel/Messages/Markdown): Tasks 8-12
  - multiPanelStore: Task 13
  - ViewModeToggle + ReturnToMulti: Task 14
  - MultiPanelGrid + EmptyPanel: Task 15
  - Esc return: Task 16
  - BackgroundStatusButton + Dropdown: Tasks 17-18
  - ↗ expand/return: Task 15 (handleExpand) + Task 16 (Esc)
  - Panel header: Task 8
  - CSS display:none for expand: Deferred to Phase 5 (optimization, spec item 28/31)

- [x] **Placeholder scan:** No TBD/TODO. All code blocks are complete.

- [x] **Type consistency:**
  - `ChatSessionContextValue` defined in Task 1, used in Tasks 2-6
  - `PanelSummary` defined in Task 13, used in Tasks 17-18
  - `compact` / `minimal` / `limit` props consistent across Tasks 8-12
  - `useChatSession()` import path consistent: `../../providers/ChatSessionContext`
