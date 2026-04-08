import { useEffect } from 'react'
import { useServerStore } from '../../stores/serverStore'
import { ServerStatusCard } from './ServerStatusCard'
import { SdkSection } from './SdkSection'
import { ConnectionsList } from './ConnectionsList'
import { ServerConfig } from './ServerConfig'
import { ServerLogs } from './ServerLogs'

export function ServerManagement() {
  const fetchStatus = useServerStore((s) => s.fetchStatus)
  const fetchConfig = useServerStore((s) => s.fetchConfig)

  useEffect(() => {
    fetchStatus()
    fetchConfig()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [fetchStatus, fetchConfig])

  return (
    <div className="space-y-5 p-4 max-w-2xl">
      <ServerStatusCard />
      <SdkSection />
      <ConnectionsList />
      <ServerConfig />
      <ServerLogs />
    </div>
  )
}
