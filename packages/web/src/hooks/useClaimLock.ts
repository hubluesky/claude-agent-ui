import { useCallback } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { useWebSocket } from './useWebSocket'

export function useClaimLock() {
  const { claimLock } = useWebSocket()
  return useCallback(() => {
    const sid = useSessionStore.getState().currentSessionId
    if (sid && sid !== '__new__') claimLock(sid)
  }, [claimLock])
}
