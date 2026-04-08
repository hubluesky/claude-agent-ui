import { useEffect, useState } from 'react'
import { useServerStore } from '../../stores/serverStore'
import { SdkUpdateDialog } from './SdkUpdateDialog'

export function SdkSection() {
  const sdkVersion = useServerStore((s) => s.sdkVersion)
  const fetchSdkVersion = useServerStore((s) => s.fetchSdkVersion)
  const [showUpdate, setShowUpdate] = useState(false)

  useEffect(() => { fetchSdkVersion() }, [fetchSdkVersion])

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--accent)' }}>Agent SDK</div>
      <div className="p-3 rounded-lg border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        <div className="flex justify-between items-center">
          <div>
            <span className="font-mono text-sm">@anthropic-ai/claude-agent-sdk</span>
            <span className="ml-2 font-semibold">{sdkVersion?.current ?? '...'}</span>
          </div>
          <div className="flex items-center gap-2">
            {sdkVersion?.updateAvailable && (
              <>
                <span className="px-2 py-0.5 rounded text-[10px]" style={{ background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.25)', color: '#eab308' }}>
                  {sdkVersion.latest} 可用
                </span>
                <button onClick={() => setShowUpdate(true)} className="px-3 py-1 text-xs rounded-md border cursor-pointer" style={{ background: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.3)', color: 'var(--accent)' }}>
                  更新
                </button>
              </>
            )}
          </div>
        </div>
        <div className="mt-1 text-[10px] text-[var(--text-muted)]">
          上次检查: {sdkVersion?.lastChecked ? new Date(sdkVersion.lastChecked).toLocaleTimeString() : '未检查'}
          {' · '}
          <button onClick={fetchSdkVersion} className="underline cursor-pointer">立即检查</button>
        </div>
      </div>
      {showUpdate && <SdkUpdateDialog onClose={() => setShowUpdate(false)} />}
    </div>
  )
}
