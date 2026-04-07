import { useEffect } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSessionStore } from '../../stores/sessionStore'

export function ViewModeToggle() {
  const viewMode = useSettingsStore((s) => s.viewMode)
  const setViewMode = useSettingsStore((s) => s.setViewMode)
  const setReturnToMulti = useSettingsStore((s) => s.setReturnToMulti)
  const sessionCount = useSessionStore((s) => {
    const cwd = s.currentProjectCwd
    return cwd ? (s.sessions.get(cwd)?.length ?? 0) : 0
  })

  const canMulti = sessionCount >= 2

  const handleSwitch = (mode: 'single' | 'multi') => {
    if (mode === viewMode) return
    if (mode === 'multi' && !canMulti) return
    setViewMode(mode)
    if (mode !== 'single') setReturnToMulti(false)
  }

  // Auto-fallback: if in Multi but sessions dropped below 2, switch back
  useEffect(() => {
    if (viewMode === 'multi' && !canMulti) {
      setViewMode('single')
    }
  }, [viewMode, canMulti, setViewMode])

  // Ctrl+Shift+M to toggle Single/Multi
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        const current = useSettingsStore.getState().viewMode
        if (current === 'single' && canMulti) {
          handleSwitch('multi')
        } else {
          handleSwitch('single')
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [canMulti])

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
        disabled={!canMulti}
        className={`px-2 py-0.5 text-[9px] border-none font-inherit transition-colors ${
          !canMulti
            ? 'text-[var(--text-dim)] cursor-default opacity-40'
            : viewMode === 'multi'
              ? 'bg-[var(--accent-subtle-bg)] text-[var(--accent)] font-semibold cursor-pointer'
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer'
        }`}
        title={canMulti ? '' : '需要至少 2 个会话才能使用 Multi 模式'}
      >
        Multi
      </button>
    </div>
  )
}
