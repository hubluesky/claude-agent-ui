import { useEffect } from 'react'
import { useServerStore } from '../../stores/serverStore'
import { ServerStatusCard } from './ServerStatusCard'
import { ConnectionsList } from './ConnectionsList'
import { ServerLogs } from './ServerLogs'

export function ServerManagement() {
  const fetchStatus = useServerStore((s) => s.fetchStatus)
  const fetchConfig = useServerStore((s) => s.fetchConfig)

  useEffect(() => {
    fetchStatus()
    fetchConfig()
    const interval = setInterval(() => { fetchStatus(); fetchConfig() }, 5000)
    return () => clearInterval(interval)
  }, [fetchStatus, fetchConfig])

  return (
    <div className="h-full flex flex-col p-5 gap-3">
      <ServerStatusCard />
      <ConnectionsList />
      <div className="flex-1 min-h-0">
        <ServerLogs fullHeight />
      </div>
    </div>
  )
}
