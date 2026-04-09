import { create } from 'zustand'
import type { PermissionMode, EffortLevel } from '@claude-agent-ui/shared'

interface SettingsState {
  permissionMode: PermissionMode
  effort: EffortLevel
  thinkingMode: 'adaptive' | 'enabled' | 'disabled'
  maxBudgetUsd: number | null
  maxTurns: number | null
  theme: 'dark' | 'light'
  viewMode: 'single' | 'multi'
}

interface SettingsActions {
  setPermissionMode(mode: PermissionMode): void
  setEffort(effort: EffortLevel): void
  setThinkingMode(mode: SettingsState['thinkingMode']): void
  setMaxBudgetUsd(value: number | null): void
  setMaxTurns(value: number | null): void
  setTheme(theme: 'dark' | 'light'): void
  setViewMode(mode: SettingsState['viewMode']): void
  load(): Promise<void>
  save(): Promise<void>
}

const STORAGE_KEY = 'claude-agent-ui-settings'

function loadFromLocal(): Partial<SettingsState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveToLocal(state: SettingsState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    permissionMode: state.permissionMode,
    effort: state.effort,
    thinkingMode: state.thinkingMode,
    maxBudgetUsd: state.maxBudgetUsd,
    maxTurns: state.maxTurns,
    theme: state.theme,
    viewMode: state.viewMode,
  }))
}

export const useSettingsStore = create<SettingsState & SettingsActions>((set, get) => {
  const saved = loadFromLocal()
  return {
    permissionMode: (saved.permissionMode as PermissionMode) ?? 'default',
    effort: (saved.effort as EffortLevel) ?? 'high',
    thinkingMode: (saved.thinkingMode as SettingsState['thinkingMode']) ?? 'adaptive',
    maxBudgetUsd: (saved as any).maxBudgetUsd ?? null,
    maxTurns: (saved as any).maxTurns ?? null,
    theme: ((saved as any).theme as 'dark' | 'light') ?? 'dark',
    viewMode: ((saved as any).viewMode as SettingsState['viewMode']) ?? 'single',
    setPermissionMode(mode) {
      set({ permissionMode: mode })
      saveToLocal(get())
    },
    setEffort(effort) {
      set({ effort })
      saveToLocal(get())
    },
    setThinkingMode(mode) {
      set({ thinkingMode: mode })
      saveToLocal(get())
    },
    setMaxBudgetUsd(value) {
      set({ maxBudgetUsd: value })
      saveToLocal(get())
    },
    setMaxTurns(value) {
      set({ maxTurns: value })
      saveToLocal(get())
    },
    setTheme(theme) {
      set({ theme })
      document.documentElement.setAttribute('data-theme', theme)
      saveToLocal(get())
    },
    setViewMode(mode) {
      set({ viewMode: mode })
      saveToLocal(get())
    },
    async load() {
      try {
        const res = await fetch('/api/settings')
        if (res.ok) {
          const data = await res.json()
          const s = data.settings ?? {}
          if (s.permissionMode) set({ permissionMode: s.permissionMode })
          if (s.effort) set({ effort: s.effort })
          if (s.thinkingMode) set({ thinkingMode: s.thinkingMode })
        }
      } catch { /* server settings unavailable, use local */ }
    },
    async save() {
      const state = get()
      try {
        await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: {
            permissionMode: state.permissionMode,
            effort: state.effort,
            thinkingMode: state.thinkingMode,
          }}),
        })
      } catch { /* ignore */ }
    },
  }
})
