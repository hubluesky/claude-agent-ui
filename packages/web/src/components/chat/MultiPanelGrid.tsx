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

  const handleExpand = useCallback((sessionId: string, cwd: string) => {
    selectSession(sessionId, cwd)
    setViewMode('single')
    setReturnToMulti(true)
  }, [selectSession, setViewMode, setReturnToMulti])

  const handleNewConversation = useCallback(() => {
    setViewMode('single')
    const cwd = useSessionStore.getState().currentProjectCwd
    if (cwd) selectSession('__new__', cwd)
  }, [setViewMode, selectSession])

  const totalSlots = panelIds.length + 1 // +1 for empty/new slot
  const cols = getGridCols(totalSlots)

  return (
    <div
      className="flex-1 grid gap-px bg-[var(--border)] min-h-0 overflow-y-auto"
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
