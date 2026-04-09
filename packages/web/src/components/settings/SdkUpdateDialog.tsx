import { useServerStore } from '../../stores/serverStore'

const STEPS = ['stopping', 'backup', 'downloading', 'installing', 'restarting', 'verifying'] as const
const STEP_LABELS: Record<string, string> = { stopping: '停止 Server', backup: '备份当前 SDK', downloading: '下载新版本', installing: '安装并替换', restarting: '重启 Server', verifying: '验证启动' }

export function SdkUpdateDialog({ onClose }: { onClose: () => void }) {
  const progress = useServerStore((s) => s.sdkUpdateProgress)
  const sdkVersion = useServerStore((s) => s.sdkVersion)
  const startUpdate = useServerStore((s) => s.startSdkUpdate)
  const sdkFeatures = useServerStore((s) => s.sdkFeatures)
  const fetchSdkFeatures = useServerStore((s) => s.fetchSdkFeatures)
  const setSdkUpdateProgress = useServerStore((s) => s.setSdkUpdateProgress)

  const handleClose = () => { setSdkUpdateProgress(null); onClose() }
  const isDone = progress?.step === 'done'
  const isFailed = progress?.step === 'failed'
  const isUpdating = progress && !isDone && !isFailed

  const handleStartUpdate = () => { fetchSdkFeatures(); startUpdate() }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={(e) => { if (e.target === e.currentTarget && !isUpdating) handleClose() }}>
      <div className="w-[520px] max-h-[80vh] overflow-auto rounded-lg border p-6" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border)' }}>
        {/* 未开始 */}
        {!progress && (
          <>
            <div className="text-center mb-4">
              <div className="text-lg font-semibold">更新 Agent SDK？</div>
              <div className="text-[var(--text-muted)] mt-1 font-mono text-sm">{sdkVersion?.current} → {sdkVersion?.latest}</div>
            </div>
            <div className="p-3 rounded-lg mb-4 text-xs" style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.15)' }}>
              <div className="font-semibold" style={{ color: 'var(--warning)' }}>更新将暂停服务器</div>
              <div className="text-[var(--text-muted)] mt-1">所有连接的客户端会短暂断开。</div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={handleClose} className="px-4 py-1.5 rounded-md border text-sm cursor-pointer" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>取消</button>
              <button onClick={handleStartUpdate} className="px-4 py-1.5 rounded-md border text-sm font-semibold cursor-pointer" style={{ background: 'rgba(245,158,11,0.2)', borderColor: 'rgba(245,158,11,0.4)', color: 'var(--accent)' }}>确认更新</button>
            </div>
          </>
        )}
        {/* 更新中 */}
        {isUpdating && (
          <>
            <div className="text-center mb-4"><div className="text-lg font-semibold">正在更新 SDK</div></div>
            <div className="space-y-2 mb-4">
              {STEPS.map((step) => {
                const currentIdx = STEPS.indexOf(progress.step as typeof STEPS[number])
                const stepIdx = STEPS.indexOf(step)
                const done = stepIdx < currentIdx
                const current = step === progress.step
                return (
                  <div key={step} className="flex items-center gap-2 text-sm" style={{ opacity: !done && !current ? 0.3 : 1 }}>
                    <span style={{ color: done ? 'var(--success)' : current ? 'var(--accent)' : 'var(--text-muted)' }}>{done ? '✓' : current ? '⟳' : '○'}</span>
                    <span>{STEP_LABELS[step]}</span>
                    {current && <span className="text-xs text-[var(--text-muted)]">{progress.message}</span>}
                  </div>
                )
              })}
            </div>
          </>
        )}
        {/* 完成 */}
        {isDone && (
          <>
            <div className="text-center mb-4">
              <div className="text-lg font-semibold" style={{ color: 'var(--success)' }}>更新完成</div>
              <div className="text-[var(--text-muted)] mt-1 text-sm">{progress.message}</div>
              {progress.result && (
                <div className="mt-1 font-mono text-sm">
                  <span className="line-through opacity-40">{progress.result.previousVersion}</span>
                  <span className="mx-2">→</span>
                  <span style={{ color: 'var(--success)' }}>{progress.result.newVersion}</span>
                </div>
              )}
            </div>
            {sdkFeatures.filter(f => f.uiSupported).length > 0 && (
              <div className="mb-3">
                <div className="flex items-center gap-2 mb-2 text-sm"><span style={{ color: 'var(--success)' }}>✓</span><span className="font-semibold" style={{ color: 'var(--success)' }}>已支持的功能</span></div>
                <div className="rounded-lg border p-2 space-y-1" style={{ background: 'rgba(34,197,94,0.06)', borderColor: 'rgba(34,197,94,0.12)' }}>
                  {sdkFeatures.filter(f => f.uiSupported).map(f => <div key={f.name} className="text-xs px-2 py-1"><span className="font-medium">{f.name}</span> — {f.description}</div>)}
                </div>
              </div>
            )}
            {sdkFeatures.filter(f => !f.uiSupported).length > 0 && (
              <div className="mb-3">
                <div className="flex items-center gap-2 mb-2 text-sm"><span style={{ color: 'var(--accent)' }}>⚡</span><span className="font-semibold" style={{ color: 'var(--accent)' }}>尚未支持（可自行开发）</span></div>
                <div className="space-y-2">
                  {sdkFeatures.filter(f => !f.uiSupported).map(f => (
                    <div key={f.name} className="rounded-lg border p-3 text-xs" style={{ background: 'rgba(245,158,11,0.05)', borderColor: 'rgba(245,158,11,0.12)' }}>
                      <div className="font-medium">{f.name}</div>
                      <div className="text-[var(--text-muted)] mt-0.5">{f.description}</div>
                      {f.docUrl && <a href={f.docUrl} target="_blank" rel="noreferrer" className="inline-block mt-1 underline" style={{ color: 'var(--accent)' }}>查看开发指南</a>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end mt-4">
              <button onClick={handleClose} className="px-4 py-1.5 rounded-md border text-sm font-semibold cursor-pointer" style={{ background: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.3)', color: 'var(--accent)' }}>确定</button>
            </div>
          </>
        )}
        {/* 失败 */}
        {isFailed && (
          <>
            <div className="text-center mb-4">
              <div className="text-lg font-semibold" style={{ color: 'var(--error)' }}>更新失败，已自动回滚</div>
            </div>
            {progress.error && <div className="p-3 rounded-lg mb-4 text-xs font-mono" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>{progress.error}</div>}
            <div className="flex justify-end">
              <button onClick={handleClose} className="px-4 py-1.5 rounded-md border text-sm cursor-pointer" style={{ background: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.3)', color: 'var(--accent)' }}>确定</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
