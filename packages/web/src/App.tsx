import { useEffect, useRef } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { ChatInterface } from './components/chat/ChatInterface'
import { MultiPanelGrid } from './components/chat/MultiPanelGrid'
import { ChatSessionProvider } from './providers/ChatSessionProvider'
import { ToastContainer } from './components/chat/Toast'
import { useSessionStore } from './stores/sessionStore'
import { useSettingsStore } from './stores/settingsStore'
import { useCommandStore } from './stores/commandStore'
import { useEmbedStore } from './stores/embedStore'
import { useMultiPanelStore } from './stores/multiPanelStore'
import { useMessageStore } from './stores/messageStore'

export function App() {
  const currentSessionId = useSessionStore((s) => s.currentSessionId)
  const viewMode = useSettingsStore((s) => s.viewMode)
  const isEmbed = useEmbedStore((s) => s.isEmbed)
  const embedCwd = useEmbedStore((s) => s.embedCwd)

  useEffect(() => {
    useEmbedStore.getState().initFromUrl()
    useCommandStore.getState().load()
  }, [])

  useEffect(() => {
    if (isEmbed && embedCwd) {
      useSessionStore.getState().selectProject(embedCwd)
    }
  }, [isEmbed, embedCwd])

  // Auto-add visited sessions to Multi panel list
  useEffect(() => {
    if (!currentSessionId || currentSessionId === '__new__') return
    const { currentProjectCwd, sessions, projects } = useSessionStore.getState()
    if (!currentProjectCwd) return
    const sessionList = sessions.get(currentProjectCwd) ?? []
    const session = sessionList.find((s) => s.sessionId === currentSessionId)
    const project = projects.find((p) => p.cwd === currentProjectCwd)
    const projectName = project?.name ?? currentProjectCwd.split(/[/\\]/).pop() ?? ''
    useMultiPanelStore.getState().addPanel(currentSessionId, {
      sessionId: currentSessionId,
      title: session?.title ?? '',
      projectCwd: currentProjectCwd,
      projectName,
    })
  }, [currentSessionId])

  // When switching TO single mode, force reload messages for the current session.
  // Multi-mode panels may have corrupted the global messageStore.
  const prevViewMode = useRef(viewMode)
  useEffect(() => {
    if (prevViewMode.current !== 'single' && viewMode === 'single') {
      // Ensure currentSessionId is one of the multi panels
      const { panelSessionIds, panelSummaries } = useMultiPanelStore.getState()
      const sid = currentSessionId
      if (sid && sid !== '__new__' && !panelSessionIds.includes(sid) && panelSessionIds.length > 0) {
        const first = panelSessionIds[0]
        const summary = panelSummaries.get(first)
        if (summary) {
          useSessionStore.getState().selectSession(first, summary.projectCwd)
        }
      }
      // Invalidate global messageStore so loadInitial re-fetches
      useMessageStore.setState({ currentLoadedSessionId: null })
    }
    prevViewMode.current = viewMode
  }, [viewMode, currentSessionId])

  const isSingle = viewMode === 'single'
  const isMulti = viewMode === 'multi'

  return (
    <>
      <AppLayout>
        {/* Both views stay mounted — CSS display toggles to avoid unmount/remount flicker */}
        <div className={`flex-1 flex flex-col min-h-0 ${isMulti ? '' : 'hidden'}`}>
          <MultiPanelGrid />
        </div>
        <div className={`flex-1 flex flex-col min-h-0 ${isSingle ? '' : 'hidden'}`}>
          {currentSessionId ? (
            <ChatSessionProvider sessionId={currentSessionId}>
              <ChatInterface />
            </ChatSessionProvider>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <div className="w-16 h-16 rounded-full bg-[#242320] border border-[#3d3b37] flex items-center justify-center">
                <span className="text-[28px] font-bold font-mono text-[#d97706]">C</span>
              </div>
              <h1 className="text-xl font-semibold text-[#e5e2db]">Claude Agent UI</h1>
              <p className="text-sm text-[#7c7872]">Select a session from the sidebar to start</p>
            </div>
          )}
        </div>
      </AppLayout>
      <ToastContainer />
    </>
  )
}
