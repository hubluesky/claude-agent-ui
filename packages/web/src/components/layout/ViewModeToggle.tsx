import { useSettingsStore } from '../../stores/settingsStore'

export function ViewModeToggle() {
  const viewMode = useSettingsStore((s) => s.viewMode)
  const setViewMode = useSettingsStore((s) => s.setViewMode)
  const setReturnToMulti = useSettingsStore((s) => s.setReturnToMulti)

  const handleSwitch = (mode: 'single' | 'multi') => {
    if (mode === viewMode) return
    setViewMode(mode)
    if (mode !== 'single') setReturnToMulti(false)
  }

  return (
    <div className="flex bg-[var(--bg-primary)] rounded-[5px] border border-[var(--border)] overflow-hidden">
      {(['single', 'multi'] as const).map((mode) => (
        <button
          key={mode}
          onClick={() => handleSwitch(mode)}
          className={`px-2 py-0.5 text-[9px] capitalize border-none cursor-pointer font-inherit transition-colors ${
            viewMode === mode
              ? 'bg-[var(--accent-subtle-bg)] text-[var(--accent)] font-semibold'
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
          }`}
        >
          {mode === 'single' ? 'Single' : 'Multi'}
        </button>
      ))}
    </div>
  )
}
