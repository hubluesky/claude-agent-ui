import { create } from 'zustand'
import type {
  ServerStatus,
  SdkVersionInfo,
  SdkFeatureStatus,
  ServerConfig,
  LogEntry,
  SdkUpdateProgress,
} from '@claude-cockpit/shared'

/** 持久化到 localStorage 的上次更新结果 */
interface LastSdkUpdateResult {
  timestamp: string
  progress: SdkUpdateProgress
}

interface ServerState {
  status: ServerStatus | null
  sdkVersion: SdkVersionInfo | null
  sdkFeatures: SdkFeatureStatus[]
  config: ServerConfig | null
  logs: LogEntry[]
  sdkUpdateProgress: SdkUpdateProgress | null
  lastUpdateResult: LastSdkUpdateResult | null
  restarting: boolean

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
const LAST_UPDATE_KEY = 'claude-agent-ui:lastSdkUpdate'

/** 检测 401 并触发 admin 重新认证（重启期间跳过） */
async function fetchWithAuth(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init)
  if (res.status === 401 && !useServerStore.getState().restarting) {
    // 动态导入避免循环依赖
    const { useAdminStore } = await import('./adminStore')
    useAdminStore.getState().fetchStatus()
  }
  return res
}

function loadLastUpdateResult(): LastSdkUpdateResult | null {
  try {
    const raw = localStorage.getItem(LAST_UPDATE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveLastUpdateResult(result: LastSdkUpdateResult) {
  try {
    localStorage.setItem(LAST_UPDATE_KEY, JSON.stringify(result))
  } catch { /* ignore */ }
}

export const useServerStore = create<ServerState>((set, get) => ({
  status: null,
  sdkVersion: null,
  sdkFeatures: [],
  config: null,
  logs: [],
  sdkUpdateProgress: null,
  lastUpdateResult: loadLastUpdateResult(),
  restarting: false,

  fetchStatus: async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/server/status`)
      if (res.ok) set({ status: await res.json() })
    } catch { /* ignore */ }
  },

  fetchSdkVersion: async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/sdk/version`)
      if (res.ok) set({ sdkVersion: await res.json() })
    } catch { /* ignore */ }
  },

  fetchSdkFeatures: async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/sdk/features`)
      if (res.ok) set({ sdkFeatures: await res.json() })
    } catch { /* ignore */ }
  },

  fetchConfig: async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/server/config`)
      if (res.ok) set({ config: await res.json() })
    } catch { /* ignore */ }
  },

  restart: async () => {
    set({ restarting: true })
    try {
      await fetchWithAuth(`${API_BASE}/server/restart`, { method: 'POST' })
    } catch { /* 重启时连接会断开 */ }
    // 轮询等待新服务器就绪，然后刷新页面
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      try {
        const res = await fetch(`${API_BASE}/admin/status`)
        if (res.ok) {
          window.location.reload()
          return
        }
      } catch { /* 服务器还没起来 */ }
    }
    set({ restarting: false })
  },

  updateConfig: async (update) => {
    await fetchWithAuth(`${API_BASE}/server/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    })
    get().fetchConfig()
  },

  clearLogs: async () => {
    await fetchWithAuth(`${API_BASE}/server/logs`, { method: 'DELETE' })
    set({ logs: [] })
  },

  startSdkUpdate: () => {
    set({ sdkUpdateProgress: { step: 'stopping', message: '准备更新...' } })
    fetchWithAuth(`${API_BASE}/sdk/update`, { method: 'POST' }).then(async (res) => {
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
              // 更新完成或失败时持久化结果
              if (progress.step === 'done' || progress.step === 'failed') {
                const result: LastSdkUpdateResult = {
                  timestamp: new Date().toISOString(),
                  progress,
                }
                saveLastUpdateResult(result)
                set({ lastUpdateResult: result })
                // 更新成功后刷新版本显示
                if (progress.step === 'done') {
                  get().fetchSdkVersion()
                }
              }
            } catch { /* ignore */ }
          }
        }
      }
    }).catch(() => {
      const failProgress: SdkUpdateProgress = { step: 'failed', message: '连接失败', error: '网络错误' }
      const result: LastSdkUpdateResult = { timestamp: new Date().toISOString(), progress: failProgress }
      saveLastUpdateResult(result)
      set({ sdkUpdateProgress: failProgress, lastUpdateResult: result })
    })
  },

  addLog: (entry) => set((state) => ({ logs: [...state.logs.slice(-999), entry] })),
  setSdkUpdateProgress: (progress) => set({ sdkUpdateProgress: progress }),
}))
