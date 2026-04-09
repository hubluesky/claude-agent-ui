import { useState, useEffect, useCallback } from 'react'
import { create } from 'zustand'

interface ToastItem {
  id: number
  message: string
  type: 'error' | 'warn' | 'info'
}

interface ToastState {
  toasts: ToastItem[]
  add: (message: string, type: ToastItem['type']) => void
  remove: (id: number) => void
}

let nextId = 0
export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  add: (message, type) => {
    const id = nextId++
    set({ toasts: [...get().toasts, { id, message, type }] })
    setTimeout(() => get().remove(id), 5000)
  },
  remove: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

export function ToastContainer() {
  const { toasts, remove } = useToastStore()

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-[400px]">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => remove(toast.id)} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const colors = {
    error: 'bg-[var(--error-subtle-bg)] border-[var(--error-subtle-border)] text-[var(--error)]',
    warn: 'bg-[var(--warning-subtle-bg)] border-[var(--warning-subtle-border)] text-[var(--warning)]',
    info: 'bg-[var(--info-subtle-bg)] border-[var(--info-subtle-border)] text-[var(--info)]',
  }

  return (
    <div className={`flex items-start gap-2 px-4 py-3 rounded-lg border ${colors[toast.type]} animate-[slideIn_0.2s_ease-out]`}>
      <p className="text-xs flex-1">{toast.message}</p>
      <button onClick={onDismiss} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] shrink-0">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
