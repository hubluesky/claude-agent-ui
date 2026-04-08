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
    <div className="space-y-5 p-4 max-w-4xl">
      {/* 顶部：状态卡片 + SDK 并排 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <ServerStatusCard />
        <SdkSection />
      </div>
      {/* 中间：连接 + 配置 并排 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <ConnectionsList />
        <ServerConfig />
      </div>
      {/* 底部：日志全宽 */}
      <ServerLogs />
    </div>
  )
}
