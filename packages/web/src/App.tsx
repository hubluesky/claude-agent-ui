import { useEffect } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { ChatInterface } from './components/chat/ChatInterface'
import { MultiPanelGrid } from './components/chat/MultiPanelGrid'
import { ChatSessionProvider } from './providers/ChatSessionProvider'
import { ToastContainer } from './components/chat/Toast'
import { AdminPage } from './components/admin/AdminPage'
import { useSessionStore } from './stores/sessionStore'
import { useSettingsStore } from './stores/settingsStore'
import { useCommandStore } from './stores/commandStore'
import { useEmbedStore } from './stores/embedStore'

export function App() {
  if (window.location.pathname === '/admin') return <AdminPage />
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
      useSettingsStore.getState().setViewMode('single')
    }
  }, [isEmbed, embedCwd])

  // Note: When switching TO single mode, ChatMessagesPane's effect handles
  // reloading messages via loadInitial (triggered by viewMode dep change).
  // No extra invalidation needed here — doing so causes a race condition.

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
