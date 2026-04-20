import { create } from 'zustand'
import type { AdminStatus } from '@claude-cockpit/shared'

interface AdminState {
  status: AdminStatus | null
  loading: boolean
  error: string | null

  fetchStatus: () => Promise<void>
  setup: (password: string) => Promise<boolean>
  login: (password: string) => Promise<boolean>
  logout: () => Promise<void>
  changePassword: (oldPassword: string, newPassword: string) => Promise<boolean>
  clearError: () => void
}

export const useAdminStore = create<AdminState>((set, get) => ({
  status: null,
  loading: false,
  error: null,

  fetchStatus: async () => {
    try {
      const res = await fetch('/api/admin/status')
      if (res.ok) set({ status: await res.json() })
    } catch { /* ignore */ }
  },

  setup: async (password) => {
    set({ loading: true, error: null })
    try {
      const res = await fetch('/api/admin/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json()
      if (!res.ok) { set({ error: data.error, loading: false }); return false }
      sessionStorage.setItem('admin-session', '1')
      set({ loading: false })
      await get().fetchStatus()
      return true
    } catch (err) {
      set({ error: String(err), loading: false }); return false
    }
  },

  login: async (password) => {
    set({ loading: true, error: null })
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json()
      if (!res.ok) { set({ error: data.error, loading: false }); return false }
      sessionStorage.setItem('admin-session', '1')
      set({ loading: false })
      await get().fetchStatus()
      return true
    } catch (err) {
      set({ error: String(err), loading: false }); return false
    }
  },

  logout: async () => {
    sessionStorage.removeItem('admin-session')
    await fetch('/api/admin/logout', { method: 'POST' })
    await get().fetchStatus()
  },

  changePassword: async (oldPassword, newPassword) => {
    set({ loading: true, error: null })
    try {
      const res = await fetch('/api/admin/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) { set({ error: data.error, loading: false }); return false }
      set({ loading: false })
      return true
    } catch (err) {
      set({ error: String(err), loading: false }); return false
    }
  },

  clearError: () => set({ error: null }),
}))
