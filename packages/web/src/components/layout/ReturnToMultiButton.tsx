import { useSettingsStore } from '../../stores/settingsStore'

export function ReturnToMultiButton() {
  const returnToMulti = useSettingsStore((s) => s.returnToMulti)
  const setViewMode = useSettingsStore((s) => s.setViewMode)
  const setReturnToMulti = useSettingsStore((s) => s.setReturnToMulti)

  if (!returnToMulti) return null

  const handleReturn = () => {
    setViewMode('multi')
    setReturnToMulti(false)
  }

  return (
    <button
      onClick={handleReturn}
      className="flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--accent-subtle-bg)] text-[var(--accent)] text-[9px] font-semibold cursor-pointer border-none font-inherit hover:bg-[var(--accent-subtle-border)]"
    >
      ← 返回 Multi
    </button>
  )
}
