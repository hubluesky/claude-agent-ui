import { useCallback, useEffect, useMemo, useRef } from 'react'
import { ChatMessagesPane } from './ChatMessagesPane'
import { ChatComposer } from './ChatComposer'
import { ApprovalPanel } from './ApprovalPanel'
import { buildToolApprovalConfig, buildPlanApprovalConfig, buildAskUserConfig } from './approval-configs'
import { PlanModal } from './PlanModal'
import { PanelHeader } from './PanelHeader'
import { ConnectionBanner } from './ConnectionBanner'
import { StatusBar } from './StatusBar'
import { ShortcutsDialog } from './ShortcutsDialog'
import { SearchBar } from './SearchBar'
import { QueuedMessages } from './QueuedMessages'
import { useChatSession } from '../../providers/ChatSessionContext'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { useSessionStore } from '../../stores/sessionStore'
import { useSessionContainerStore } from '../../stores/sessionContainerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { wsManager } from '../../lib/WebSocketManager'
import type { ApprovalPanelConfig } from './ApprovalPanel'

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
  const ctx = useChatSession()
  const { helpOpen, setHelpOpen, searchOpen, setSearchOpen } = useKeyboardShortcuts()
  const currentProjectCwd = useSessionStore((s) => s.currentProjectCwd)

  const hasMessages = useSessionContainerStore((s) =>
    ctx.sessionId
      ? (s.containers.get(ctx.sessionId)?.messages.length ?? 0) > 0
      : false
  )
  const isNewSession = ctx.sessionId === '__new__'

  // Track previous session ID to distinguish __new__ → real ID (same session)
  // from genuine session switches (A → B, or A → __new__).
  const prevSessionRef = useRef(ctx.sessionId)
  useEffect(() => {
    const prevSession = prevSessionRef.current
    prevSessionRef.current = ctx.sessionId

    if (!ctx.sessionId || ctx.sessionId === '__new__') return

    // 订阅当前 session
    const store = useSessionContainerStore.getState()
    const container = store.containers.get(ctx.sessionId)
    const lastSeq = container?.lastSeq ?? 0

    if (compact) {
      // Multi-panel mode: use subscribe (additive) instead of joinSession
      // (exclusive). joinSession leaves other sessions, so multiple panels
      // calling it would clobber each other's subscriptions.
      wsManager.subscribe(ctx.sessionId, lastSeq)
    } else {
      // Single-panel mode: exclusive join (leaves previous session)
      wsManager.joinSession(ctx.sessionId, lastSeq)
    }

    // 离开旧 session（混合策略） — only for single-panel mode.
    // Multi-panel panels keep their subscriptions independently.
    if (!compact && prevSession && prevSession !== '__new__' && prevSession !== ctx.sessionId) {
      const prevContainer = store.containers.get(prevSession)
      if (prevContainer?.sessionStatus === 'running') {
        // running session 保持订阅
        wsManager.subscribe(prevSession, prevContainer.lastSeq)
      } else {
        // idle session 取消订阅
        wsManager.unsubscribe(prevSession)
      }
    }
  }, [ctx.sessionId, compact])

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
    if (ctx.sessionId) {
      const store = useSessionContainerStore.getState()
      // Ensure container exists for __new__ so optimistic message is visible immediately
      if (ctx.sessionId === '__new__') {
        store.getOrCreate('__new__', currentProjectCwd ?? '')
      }
      // Only add optimistic user message if session is idle (not queued).
      // When session is busy, the message is queued server-side and will be
      // broadcast as a user message when it is actually dequeued and sent.
      const sessionBusy = ctx.sessionStatus === 'running' || ctx.sessionStatus === 'awaiting_approval' || ctx.sessionStatus === 'awaiting_user_input'
      if (!sessionBusy) {
        store.pushMessage(ctx.sessionId, {
          type: 'user',
          _optimistic: true,
          message: { role: 'user', content: contentBlocks },
        } as any)
      }
    }

    const { maxBudgetUsd, maxTurns, permissionMode } = useSettingsStore.getState()
    ctx.send(prompt, {
      images,
      permissionMode,
      ...(maxBudgetUsd ? { maxBudgetUsd } : {}),
      ...(maxTurns ? { maxTurns } : {}),
    })
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

  // Esc handler: pop queue first, abort second (mirrors Claude Code PromptInput.tsx + useCancelRequest.ts)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (ctx.planModalOpen) return
      if (searchOpen || helpOpen) return
      // Allow ESC from textarea (composer) but not from other inputs (search box etc.)
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (tag === 'INPUT') return

      // Phase 1: pop editable commands from queue (mirrors Claude Code popAllCommandsFromQueue)
      const hasEditable = ctx.queue.some(item => item.editable)
      if (hasEditable) {
        e.preventDefault()
        ctx.popQueue()
        return
      }

      // Phase 2: abort running session (no queue items to pop)
      if (ctx.sessionStatus === 'running') {
        e.preventDefault()
        ctx.abort()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [ctx, searchOpen, helpOpen])

  if (!ctx.sessionId) return null

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {compact && panelTitle !== undefined && onExpandPanel && onClosePanel && (
        <PanelHeader
          title={panelTitle}
          projectName={panelProjectName ?? ''}
          onExpand={onExpandPanel}
          onClose={onClosePanel}
        />
      )}
      <ConnectionBanner />
      {!compact && searchOpen && <SearchBar onClose={() => setSearchOpen(false)} />}
      {isNewSession && !hasMessages ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className={`${compact ? 'w-8 h-8' : 'w-12 h-12'} rounded-full bg-[var(--bg-secondary)] border border-[var(--border)] flex items-center justify-center`}>
            <span className={`${compact ? 'text-sm' : 'text-xl'} font-bold font-mono text-[var(--accent)]`}>C</span>
          </div>
          <div className="flex flex-col items-center gap-1 max-w-[90%]">
            <p className={`${compact ? 'text-xs' : 'text-sm'} text-[var(--text-secondary)]`}>New conversation in {currentProjectCwd?.split(/[/\\]/).pop()}</p>
            {currentProjectCwd && (
              <p className={`${compact ? 'text-[10px]' : 'text-xs'} text-[var(--text-muted)] truncate max-w-full`} title={currentProjectCwd}>{currentProjectCwd}</p>
            )}
          </div>
        </div>
      ) : (
        <ChatMessagesPane sessionId={ctx.sessionId} limit={compact ? 50 : undefined} />
      )}
      <QueuedMessages sessionId={ctx.sessionId} />
      {compact ? null : approvalConfig ? (
        <ApprovalPanel config={approvalConfig} />
      ) : (
        <ChatComposer onSend={handleSend} onAbort={handleAbort} />
      )}
      {!compact && <StatusBar />}
      {!compact && <PlanModal />}
      {!compact && helpOpen && <ShortcutsDialog onClose={() => setHelpOpen(false)} />}
    </div>
  )
}
