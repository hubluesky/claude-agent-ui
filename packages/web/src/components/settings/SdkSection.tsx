import { useEffect, useState } from 'react'
import { useServerStore } from '../../stores/serverStore'
import { SdkUpdateDialog } from './SdkUpdateDialog'

export function SdkSection() {
  const sdkVersion = useServerStore((s) => s.sdkVersion)
  const fetchSdkVersion = useServerStore((s) => s.fetchSdkVersion)
  const lastUpdateResult = useServerStore((s) => s.lastUpdateResult)
  const setSdkUpdateProgress = useServerStore((s) => s.setSdkUpdateProgress)
  const fetchSdkFeatures = useServerStore((s) => s.fetchSdkFeatures)
  const [showUpdate, setShowUpdate] = useState(false)
  const [showLastResult, setShowLastResult] = useState(false)

  useEffect(() => { fetchSdkVersion() }, [fetchSdkVersion])

  const handleViewLastResult = () => {
    if (!lastUpdateResult) return
    setSdkUpdateProgress(lastUpdateResult.progress)
    fetchSdkFeatures()
    setShowLastResult(true)
  }

  return (
    <div className="rounded-lg border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Agent SDK</span>
      </div>
      <div className="px-3 py-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>claude-agent-sdk</span>
            <span className="ml-2 text-sm font-bold">{sdkVersion?.current ?? '...'}</span>
          </div>
          <div className="flex items-center gap-2">
            {sdkVersion?.updateAvailable && (
              <>
                <span className="px-2 py-0.5 rounded text-[10px]" style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.2)', color: 'var(--warning)' }}>
                  {sdkVersion.latest}
                </span>
                <button onClick={() => setShowUpdate(true)} className="px-2.5 py-1 text-[11px] rounded border cursor-pointer transition-colors" style={{ background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.3)', color: 'var(--accent)' }}>
                  更新
                </button>
              </>
            )}
          </div>
        </div>
        <div className="mt-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {sdkVersion?.lastChecked ? new Date(sdkVersion.lastChecked).toLocaleTimeString() : ''} ·{' '}
          <button onClick={fetchSdkVersion} className="underline cursor-pointer">检查更新</button>
          {lastUpdateResult && (
            <> · <button onClick={handleViewLastResult} className="underline cursor-pointer">更新历史</button></>
          )}
        </div>
      </div>
      {showUpdate && <SdkUpdateDialog onClose={() => setShowUpdate(false)} />}
      {showLastResult && <SdkUpdateDialog onClose={() => { setSdkUpdateProgress(null); setShowLastResult(false) }} />}
    </div>
  )
}
