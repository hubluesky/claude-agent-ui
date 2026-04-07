import { useEffect } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'

const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)
const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl'

export function ViewModeToggle() {
  const viewMode = useSettingsStore((s) => s.viewMode)
  const setViewMode = useSettingsStore((s) => s.setViewMode)

  const handleSwitch = (mode: 'single' | 'multi') => {
    if (mode === viewMode) return
    setViewMode(mode)
  }

  // Ctrl/Cmd+` to toggle Single/Multi (left-hand friendly)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'Backquote') {
        e.preventDefault()
        const { viewMode: current, setViewMode: set } = useSettingsStore.getState()
        set(current === 'single' ? 'multi' : 'single')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex bg-[var(--bg-primary)] rounded-[5px] border border-[var(--border)] overflow-hidden">
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
      <span className="text-[8px] text-[var(--text-dim)] font-mono">{MOD_LABEL}+~</span>
    </div>
  )
}
