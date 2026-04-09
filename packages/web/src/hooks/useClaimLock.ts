import { useCallback } from 'react'
import { wsManager } from '../lib/WebSocketManager'
import { useSessionStore } from '../stores/sessionStore'

export function useClaimLock() {
  const currentSessionId = useSessionStore((s) => s.currentSessionId)
  return useCallback(() => {
    if (currentSessionId && currentSessionId !== '__new__') {
      wsManager.claimLock(currentSessionId)
    }
  }, [currentSessionId])
}
