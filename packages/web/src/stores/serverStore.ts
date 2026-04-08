import { create } from 'zustand'
import type {
  ServerStatus,
  SdkVersionInfo,
  SdkFeatureStatus,
  ServerConfig,
  LogEntry,
  SdkUpdateProgress,
} from '@claude-agent-ui/shared'

interface ServerState {
  status: ServerStatus | null
  sdkVersion: SdkVersionInfo | null
  sdkFeatures: SdkFeatureStatus[]
  config: ServerConfig | null
  logs: LogEntry[]
  sdkUpdateProgress: SdkUpdateProgress | null

  fetchStatus: () => Promise<void>
  fetchSdkVersion: () => Promise<void>
  fetchSdkFeatures: () => Promise<void>
  fetchConfig: () => Promise<void>
  restart: () => Promise<void>
  updateConfig: (update: Partial<ServerConfig>) => Promise<void>
  clearLogs: () => Promise<void>
  startSdkUpdate: () => void
  addLog: (entry: LogEntry) => void
  setSdkUpdateProgress: (progress: SdkUpdateProgress | null) => void
}

const API_BASE = '/api'

export const useServerStore = create<ServerState>((set, get) => ({
  status: null,
  sdkVersion: null,
  sdkFeatures: [],
  config: null,
  logs: [],
  sdkUpdateProgress: null,

  fetchStatus: async () => {
    try {
      const res = await fetch(`${API_BASE}/server/status`)
      if (res.ok) set({ status: await res.json() })
    } catch { /* ignore */ }
  },

  fetchSdkVersion: async () => {
    try {
      const res = await fetch(`${API_BASE}/sdk/version`)
      if (res.ok) set({ sdkVersion: await res.json() })
    } catch { /* ignore */ }
  },

  fetchSdkFeatures: async () => {
    try {
      const res = await fetch(`${API_BASE}/sdk/features`)
      if (res.ok) set({ sdkFeatures: await res.json() })
    } catch { /* ignore */ }
  },

  fetchConfig: async () => {
    try {
      const res = await fetch(`${API_BASE}/server/config`)
      if (res.ok) set({ config: await res.json() })
    } catch { /* ignore */ }
  },

  restart: async () => {
    await fetch(`${API_BASE}/server/restart`, { method: 'POST' })
  },

  updateConfig: async (update) => {
    await fetch(`${API_BASE}/server/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    })
    get().fetchConfig()
  },

  clearLogs: async () => {
    await fetch(`${API_BASE}/server/logs`, { method: 'DELETE' })
    set({ logs: [] })
  },

  startSdkUpdate: () => {
    set({ sdkUpdateProgress: { step: 'stopping', message: '准备更新...' } })
    fetch(`${API_BASE}/sdk/update`, { method: 'POST' }).then(async (res) => {
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) return
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const progress = JSON.parse(line.slice(6)) as SdkUpdateProgress
              set({ sdkUpdateProgress: progress })
            } catch { /* ignore */ }
          }
        }
      }
    }).catch(() => {
      set({ sdkUpdateProgress: { step: 'failed', message: '连接失败', error: '网络错误' } })
    })
  },

  addLog: (entry) => set((state) => ({ logs: [...state.logs.slice(-999), entry] })),
  setSdkUpdateProgress: (progress) => set({ sdkUpdateProgress: progress }),
}))
