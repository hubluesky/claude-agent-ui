import { useCallback, useEffect, useMemo } from 'react'
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
import { useChatSession } from '../../providers/ChatSessionContext'
import { useWebSocket } from '../../hooks/useWebSocket'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { useSessionStore } from '../../stores/sessionStore'
import { useMessageStore } from '../../stores/messageStore'
import { useSettingsStore } from '../../stores/settingsStore'
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
  const { joinSession } = useWebSocket()
  const { helpOpen, setHelpOpen, searchOpen, setSearchOpen } = useKeyboardShortcuts()
  const currentProjectCwd = useSessionStore((s) => s.currentProjectCwd)

  const isNewSession = ctx.sessionId === '__new__'

  useEffect(() => {
    if (ctx.sessionId && !isNewSession) {
      joinSession(ctx.sessionId)
    }
    if (isNewSession) {
      useMessageStore.getState().clear()
    }
  }, [ctx.sessionId, joinSession, isNewSession])

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
    useMessageStore.getState().appendMessage({
      type: 'user',
      _optimistic: true,
      message: { role: 'user', content: contentBlocks },
    } as any)

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

  // Unified Esc handler: priority order → input focus → modal → returnToMulti → abort AI
  const returnToMulti = useSettingsStore((s) => s.returnToMulti)
  const setViewMode = useSettingsStore((s) => s.setViewMode)
  const setReturnToMulti = useSettingsStore((s) => s.setReturnToMulti)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Let textarea/input handle their own Esc (e.g. close slash/file popup)
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return
      // PlanModal handles its own Esc
      if (ctx.planModalOpen) return
      // Return to Multi mode from expanded panel
      if (returnToMulti) {
        setViewMode('multi')
        setReturnToMulti(false)
        return
      }
      // Abort running AI session (like Claude Code CLI Esc)
      if (ctx.sessionStatus === 'running' && ctx.lockStatus === 'locked_self') {
        ctx.abort()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [ctx, returnToMulti, setViewMode, setReturnToMulti])

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
      {isNewSession ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className={`${compact ? 'w-8 h-8' : 'w-12 h-12'} rounded-full bg-[#242320] border border-[#3d3b37] flex items-center justify-center`}>
            <span className={`${compact ? 'text-sm' : 'text-xl'} font-bold font-mono text-[#d97706]`}>C</span>
          </div>
          <p className={`${compact ? 'text-xs' : 'text-sm'} text-[#7c7872]`}>New conversation in {currentProjectCwd?.split(/[/\\]/).pop()}</p>
        </div>
      ) : (
        <ChatMessagesPane sessionId={ctx.sessionId} limit={compact ? 50 : undefined} />
      )}
      {approvalConfig ? (
        <ApprovalPanel config={approvalConfig} compact={compact} />
      ) : (
        <ChatComposer onSend={handleSend} onAbort={handleAbort} minimal={compact} />
      )}
      {!compact && <StatusBar />}
      {!compact && <PlanModal />}
      {!compact && helpOpen && <ShortcutsDialog onClose={() => setHelpOpen(false)} />}
    </div>
  )
}
