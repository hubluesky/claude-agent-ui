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
    <div className="mx-auto w-full max-w-3xl px-6 py-6 space-y-4">
      {/* 状态概览 */}
      <ServerStatusCard />
      {/* SDK + 配置 并排 */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-4">
        <SdkSection />
        <ServerConfig />
      </div>
      {/* 连接 + 日志 并排 */}
      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4">
        <ConnectionsList />
        <ServerLogs />
      </div>
    </div>
  )
}
