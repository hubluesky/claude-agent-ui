import { useCallback, useEffect } from 'react'
import { ChatMessagesPane } from './ChatMessagesPane'
import { ChatComposer } from './ChatComposer'
import { StatusBar } from './StatusBar'
import { PermissionBanner } from './PermissionBanner'
import { AskUserPanel } from './AskUserPanel'
import { ConnectionBanner } from './ConnectionBanner'
import { useWebSocket } from '../../hooks/useWebSocket'
import { useSessionStore } from '../../stores/sessionStore'
import { useMessageStore } from '../../stores/messageStore'
import { useSettingsStore } from '../../stores/settingsStore'

export function ChatInterface() {
  const { sendMessage, joinSession, abort } = useWebSocket()
  const { currentSessionId, currentProjectCwd } = useSessionStore()

  const isNewSession = currentSessionId === '__new__'

  useEffect(() => {
    if (currentSessionId && !isNewSession) {
      joinSession(currentSessionId)
    }
    if (isNewSession) {
      useMessageStore.getState().clear()
    }
  }, [currentSessionId, joinSession, isNewSession])

  const handleSend = useCallback((prompt: string) => {
    // Optimistically add user message — shows immediately with sending indicator
    useMessageStore.getState().appendMessage({
      type: 'user',
      _optimistic: true,
      message: { role: 'user', content: [{ type: 'text', text: prompt }] },
    } as any)

    // For new sessions, send with null sessionId — server will create one
    const sessionId = isNewSession ? null : currentSessionId
    const { thinkingMode, effort } = useSettingsStore.getState()
    sendMessage(prompt, sessionId, { cwd: currentProjectCwd ?? undefined, thinkingMode, effort })
  }, [currentSessionId, currentProjectCwd, sendMessage, isNewSession])

  const handleAbort = useCallback(() => {
    if (currentSessionId && !isNewSession) abort(currentSessionId)
  }, [currentSessionId, abort, isNewSession])

  if (!currentSessionId) return null

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ConnectionBanner />
      {isNewSession ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[#242320] border border-[#3d3b37] flex items-center justify-center">
            <span className="text-xl font-bold font-mono text-[#d97706]">C</span>
          </div>
          <p className="text-sm text-[#7c7872]">New conversation in {currentProjectCwd?.split(/[/\\]/).pop()}</p>
        </div>
      ) : (
        <ChatMessagesPane sessionId={currentSessionId} />
      )}
      <PermissionBanner />
      <AskUserPanel />
      <StatusBar />
      <ChatComposer onSend={handleSend} onAbort={handleAbort} />
    </div>
  )
}
