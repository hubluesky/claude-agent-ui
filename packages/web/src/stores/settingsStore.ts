import { create } from 'zustand'
import type { PermissionMode, EffortLevel } from '@claude-agent-ui/shared'

interface SettingsState {
  permissionMode: PermissionMode
  effort: EffortLevel
  thinkingMode: 'adaptive' | 'enabled' | 'disabled'
  sidebarWidth: number
  sidebarOpen: boolean
}

interface SettingsActions {
  setPermissionMode(mode: PermissionMode): void
  setEffort(effort: EffortLevel): void
  setThinkingMode(mode: SettingsState['thinkingMode']): void
  setSidebarWidth(width: number): void
  setSidebarOpen(open: boolean): void
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
    sidebarWidth: state.sidebarWidth,
  }))
}

export const useSettingsStore = create<SettingsState & SettingsActions>((set, get) => {
  const saved = loadFromLocal()
  return {
    permissionMode: (saved.permissionMode as PermissionMode) ?? 'default',
    effort: (saved.effort as EffortLevel) ?? 'high',
    thinkingMode: (saved.thinkingMode as SettingsState['thinkingMode']) ?? 'adaptive',
    sidebarWidth: saved.sidebarWidth ?? 280,
    sidebarOpen: true,

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
    setSidebarWidth(width) {
      set({ sidebarWidth: Math.max(200, Math.min(500, width)) })
      saveToLocal(get())
    },
    setSidebarOpen(open) {
      set({ sidebarOpen: open })
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
