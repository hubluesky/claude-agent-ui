import { useEffect } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { ChatInterface } from './components/chat/ChatInterface'
import { ToastContainer } from './components/chat/Toast'
import { useSessionStore } from './stores/sessionStore'
import { useCommandStore } from './stores/commandStore'
import { useEmbedStore } from './stores/embedStore'

export function App() {
  const currentSessionId = useSessionStore((s) => s.currentSessionId)
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

  return (
    <>
      <AppLayout>
        {currentSessionId ? (
          <ChatInterface />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <div className="w-16 h-16 rounded-full bg-[#242320] border border-[#3d3b37] flex items-center justify-center">
              <span className="text-[28px] font-bold font-mono text-[#d97706]">C</span>
            </div>
            <h1 className="text-xl font-semibold text-[#e5e2db]">Claude Agent UI</h1>
            <p className="text-sm text-[#7c7872]">Select a session from the sidebar to start</p>
          </div>
        )}
      </AppLayout>
      <ToastContainer />
    </>
  )
}
