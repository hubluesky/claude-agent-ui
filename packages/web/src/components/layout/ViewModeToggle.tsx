import { useEffect } from 'react'
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

  // Ctrl+Shift+M to toggle Single/Multi
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        const next = useSettingsStore.getState().viewMode === 'single' ? 'multi' : 'single'
        handleSwitch(next)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="flex bg-[var(--bg-primary)] rounded-[5px] border border-[var(--border)] overflow-hidden" title="Ctrl+Shift+M 切换模式">
      <button
        onClick={() => handleSwitch('single')}
        className={`px-2 py-0.5 text-[9px] border-none cursor-pointer font-inherit transition-colors ${
          viewMode === 'single'
            ? 'bg-[var(--accent-subtle-bg)] text-[var(--accent)] font-semibold'
            : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
        }`}
      >
        Single
      </button>
      <button
        onClick={() => handleSwitch('multi')}
        className={`px-2 py-0.5 text-[9px] border-none cursor-pointer font-inherit transition-colors ${
          viewMode === 'multi'
            ? 'bg-[var(--accent-subtle-bg)] text-[var(--accent)] font-semibold'
            : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
        }`}
      >
        Multi
      </button>
    </div>
  )
}
