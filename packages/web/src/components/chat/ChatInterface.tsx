import { useCallback, useEffect } from 'react'
import { ChatMessagesPane } from './ChatMessagesPane'
import { ChatComposer } from './ChatComposer'
import { StatusBar } from './StatusBar'
import { PermissionBanner } from './PermissionBanner'
import { AskUserPanel } from './AskUserPanel'
import { ConnectionBanner } from './ConnectionBanner'
import { useWebSocket } from '../../hooks/useWebSocket'
import { useSessionStore } from '../../stores/sessionStore'

export function ChatInterface() {
  const { sendMessage, joinSession, abort } = useWebSocket()
  const { currentSessionId, currentProjectCwd } = useSessionStore()

  useEffect(() => {
    if (currentSessionId) {
      joinSession(currentSessionId)
    }
  }, [currentSessionId, joinSession])

  const handleSend = useCallback((prompt: string) => {
    sendMessage(prompt, currentSessionId, { cwd: currentProjectCwd ?? undefined })
  }, [currentSessionId, currentProjectCwd, sendMessage])

  const handleAbort = useCallback(() => {
    if (currentSessionId) abort(currentSessionId)
  }, [currentSessionId, abort])

  if (!currentSessionId) return null

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ConnectionBanner />
      <ChatMessagesPane sessionId={currentSessionId} />
      <PermissionBanner />
      <AskUserPanel />
      <StatusBar />
      <ChatComposer onSend={handleSend} onAbort={handleAbort} />
    </div>
  )
}
